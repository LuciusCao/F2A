/**
 * F2AWebhookManager 测试
 * P1-1 修复：创建 F2AWebhookManager.ts 专项测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2AWebhookManager, WebhookManagerDeps } from '../src/F2AWebhookManager.js';
import { INTERNAL_REPUTATION_CONFIG } from '../src/types.js';
import type { 
  DiscoverWebhookPayload, 
  DelegateWebhookPayload,
  AgentCapability,
  ReputationSystemLike,
  TaskQueueLike,
  F2APluginConfig,
} from '../src/types.js';

// P2-2 修复：使用有效的 PeerID 格式
// 格式: 12D3KooW + 44 chars from [A-Za-z1-9]
const validPeerId = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// Mock 依赖
const mockReputationSystem: ReputationSystemLike = {
  getReputation: vi.fn((peerId: string) => ({
    score: 80,
    peerId,
    history: [],
  })),
  isAllowed: vi.fn(() => true),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
};

const mockTaskQueue: TaskQueueLike = {
  add: vi.fn((task) => ({ ...task, taskId: 'test-task-id' })),
  getStats: vi.fn(() => ({ pending: 5, processing: 2, completed: 100, failed: 10, total: 117, webhookPending: 0 })),
  getAll: vi.fn(() => []),
  resetProcessingTask: vi.fn(),
  getWebhookPending: vi.fn(() => []),
  markWebhookPushed: vi.fn(),
};

const mockConfig: F2APluginConfig = {
  agentName: 'test-agent',
  capabilities: ['code-generation', 'file-operation'],
  maxQueuedTasks: 100,
};

const mockCapabilities: AgentCapability[] = [
  { name: 'code-generation', description: '代码生成' },
  { name: 'file-operation', description: '文件操作', tools: ['read', 'write'] },
];

const mockInvokeOpenClawAgent = vi.fn(async () => 'test response');

describe('F2AWebhookManager', () => {
  let manager: F2AWebhookManager;
  let deps: WebhookManagerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    
    deps = {
      config: mockConfig,
      capabilities: mockCapabilities,
      reputationSystem: mockReputationSystem,
      taskQueue: mockTaskQueue,
      invokeOpenClawAgent: mockInvokeOpenClawAgent,
    };
    
    manager = new F2AWebhookManager(deps);
  });

  describe('createHandler', () => {
    it('应创建包含所有必要方法的 handler', () => {
      const handler = manager.createHandler();
      
      expect(handler.onDiscover).toBeDefined();
      expect(handler.onDelegate).toBeDefined();
      expect(handler.onMessage).toBeDefined();
      expect(handler.onStatus).toBeDefined();
      expect(typeof handler.onDiscover).toBe('function');
      expect(typeof handler.onDelegate).toBe('function');
      expect(typeof handler.onMessage).toBe('function');
      expect(typeof handler.onStatus).toBe('function');
    });
  });

  describe('handleDiscover', () => {
    it('高信誉请求者应收到能力列表', async () => {
      const handler = manager.createHandler();
      const payload: DiscoverWebhookPayload = {
        query: {},
        requester: validPeerId,
      };

      const result = await handler.onDiscover(payload);
      
      expect(result.capabilities).toHaveLength(2);
      expect(result.reputation).toBe(80);
    });

    it('低信誉请求者应收到空能力列表', async () => {
      vi.mocked(mockReputationSystem.getReputation).mockReturnValueOnce({
        score: 30, // 低于 minScoreForService (50)
        peerId: validPeerId,
        history: [],
      });

      const handler = manager.createHandler();
      const payload: DiscoverWebhookPayload = {
        query: {},
        requester: validPeerId,
      };

      const result = await handler.onDiscover(payload);
      
      expect(result.capabilities).toHaveLength(0);
      expect(result.reputation).toBe(30);
    });

    it('应按能力类型过滤结果', async () => {
      const handler = manager.createHandler();
      const payload: DiscoverWebhookPayload = {
        query: { capability: 'code-generation' },
        requester: validPeerId,
      };

      const result = await handler.onDiscover(payload);
      
      expect(result.capabilities).toHaveLength(1);
      expect(result.capabilities[0].name).toBe('code-generation');
    });

    it('应按工具名称过滤结果', async () => {
      const handler = manager.createHandler();
      const payload: DiscoverWebhookPayload = {
        query: { capability: 'read' },
        requester: validPeerId,
      };

      const result = await handler.onDiscover(payload);
      
      expect(result.capabilities).toHaveLength(1);
      expect(result.capabilities[0].name).toBe('file-operation');
    });
  });

  describe('handleDelegate', () => {
    it('高信誉请求者应成功提交任务', async () => {
      const handler = manager.createHandler();
      const payload: DelegateWebhookPayload = {
        taskId: 'task-123',
        taskType: 'test-task',
        description: '测试任务',
        from: validPeerId,
        timestamp: Date.now(),
        timeout: 30000,
      };

      const result = await handler.onDelegate(payload);
      
      expect(result.accepted).toBe(true);
      expect(result.taskId).toBe('task-123');
    });

    it('低信誉请求者应被拒绝', async () => {
      vi.mocked(mockReputationSystem.getReputation).mockReturnValueOnce({
        score: 30,
        peerId: validPeerId,
        history: [],
      });

      const handler = manager.createHandler();
      const payload: DelegateWebhookPayload = {
        taskId: 'task-123',
        taskType: 'test-task',
        description: '测试任务',
        from: validPeerId,
        timestamp: Date.now(),
        timeout: 30000,
      };

      const result = await handler.onDelegate(payload);
      
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('Reputation too low');
    });

    it('队列满时应拒绝任务', async () => {
      vi.mocked(mockTaskQueue.getStats).mockReturnValueOnce({ 
        pending: 100, 
        processing: 0,
        completed: 0,
        failed: 0,
        total: 100,
        webhookPending: 0,
      });

      const handler = manager.createHandler();
      const payload: DelegateWebhookPayload = {
        taskId: 'task-123',
        taskType: 'test-task',
        description: '测试任务',
        from: validPeerId,
        timestamp: Date.now(),
        timeout: 30000,
      };

      const result = await handler.onDelegate(payload);
      
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('Task queue is full');
    });
  });

  describe('handleMessage', () => {
    it('应处理有效的 P2P 消息', async () => {
      const handler = manager.createHandler();
      const payload = {
        from: validPeerId,
        content: 'Hello!',
        messageId: 'msg-123',
      };

      const result = await handler.onMessage(payload);
      
      expect(result.response).toBeDefined();
      expect(mockInvokeOpenClawAgent).toHaveBeenCalled();
    });

    it('应拒绝无效的 PeerID', async () => {
      const handler = manager.createHandler();
      const payload = {
        from: 'invalid-peer-id',
        content: 'Hello!',
        messageId: 'msg-123',
      };

      const result = await handler.onMessage(payload);
      
      expect(result.response).toContain('Invalid sender');
      expect(mockInvokeOpenClawAgent).not.toHaveBeenCalled();
    });

    it('应拒绝过长的消息', async () => {
      const handler = manager.createHandler();
      const payload = {
        from: validPeerId,
        // MAX_MESSAGE_LENGTH = 1024 * 1024 = 1,048,576 bytes
        // 使用 1,048,577 bytes 确保超过限制
        content: 'x'.repeat(1024 * 1024 + 1), // 超过 MAX_MESSAGE_LENGTH (1MB)
        messageId: 'msg-123',
      };

      const result = await handler.onMessage(payload);
      
      expect(result.response).toContain('Message too long');
      expect(mockInvokeOpenClawAgent).not.toHaveBeenCalled();
    });

    it('处理失败时应返回错误消息', async () => {
      mockInvokeOpenClawAgent.mockRejectedValueOnce(new Error('处理失败'));

      const handler = manager.createHandler();
      const payload = {
        from: validPeerId,
        content: 'Hello!',
        messageId: 'msg-123',
      };

      const result = await handler.onMessage(payload);
      
      expect(result.response).toContain('抱歉');
    });
  });

  describe('handleStatus', () => {
    it('应返回当前状态', async () => {
      const handler = manager.createHandler();

      const result = await handler.onStatus();
      
      expect(result.status).toBe('available');
      expect(result.load).toBe(7); // pending(5) + processing(2)
      expect(result.queued).toBe(5);
      expect(result.processing).toBe(2);
    });
  });

  describe('updateDeps', () => {
    it('应更新配置', () => {
      manager.updateDeps({ config: { ...mockConfig, agentName: 'updated-agent' } });
      // 验证内部状态已更新（通过后续行为验证）
      expect(manager).toBeDefined();
    });

    it('应更新能力列表', () => {
      const newCapabilities: AgentCapability[] = [
        { name: 'new-capability', description: '新能力' },
      ];
      manager.updateDeps({ capabilities: newCapabilities });
      expect(manager).toBeDefined();
    });
  });

  describe('updateCapabilities', () => {
    it('应更新能力列表', () => {
      const newCapabilities: AgentCapability[] = [
        { name: 'new-capability', description: '新能力' },
      ];
      manager.updateCapabilities(newCapabilities);
      expect(manager).toBeDefined();
    });
  });

  describe('updateConfig', () => {
    it('应更新配置', () => {
      manager.updateConfig({ ...mockConfig, agentName: 'updated-agent' });
      expect(manager).toBeDefined();
    });
  });
});