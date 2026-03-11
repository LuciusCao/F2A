/**
 * F2AOpenClawAdapter 边缘情况和高价值测试
 * 专注于：错误处理、边界条件、安全验证、资源管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2AOpenClawAdapter } from './connector.js';
import type { OpenClawPluginApi, F2APluginConfig, TaskRequest } from './types.js';

// Mock 依赖模块
vi.mock('./node-manager.js', () => ({
  F2ANodeManager: vi.fn().mockImplementation(() => ({
    ensureRunning: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockResolvedValue(false),
    getStatus: vi.fn().mockResolvedValue({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Not running' } }),
    getConfig: vi.fn().mockReturnValue({ nodePath: './F2A' })
  }))
}));

// 创建一个可重用的 network-client mock 工厂函数
const createMockNetworkClient = (overrides: Record<string, any> = {}) => ({
  registerWebhook: vi.fn().mockResolvedValue(undefined),
  updateAgentInfo: vi.fn().mockResolvedValue(undefined),
  discoverAgents: vi.fn().mockResolvedValue({ success: true, data: [] }),
  ...overrides
});

vi.mock('./network-client.js', () => ({
  F2ANetworkClient: vi.fn().mockImplementation(() => createMockNetworkClient())
}));

vi.mock('./webhook-server.js', () => ({
  WebhookServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getUrl: vi.fn().mockReturnValue('http://localhost:9002')
  }))
}));

// 注意：reputation.js 的 mock 必须同时导出 ReputationSystem 和 ReputationManagerAdapter
vi.mock('./reputation.js', () => ({
  ReputationSystem: vi.fn().mockImplementation(() => ({
    getReputation: vi.fn().mockReturnValue({ score: 50 }),
    isAllowed: vi.fn().mockReturnValue(true),
    flush: vi.fn()
  })),
  ReputationManagerAdapter: vi.fn().mockImplementation(() => ({
    hasPermission: vi.fn().mockReturnValue(true),
    getHighReputationNodes: vi.fn().mockReturnValue([]),
    getAllReputations: vi.fn().mockReturnValue([]),
    recordReviewPenalty: vi.fn(),
    recordReviewReward: vi.fn()
  }))
}));

vi.mock('./capability-detector.js', () => ({
  CapabilityDetector: vi.fn().mockImplementation(() => ({
    getDefaultCapabilities: vi.fn().mockReturnValue([]),
    mergeCustomCapabilities: vi.fn().mockImplementation((defaults, custom) => [...defaults, ...custom])
  }))
}));

vi.mock('./task-queue.js', () => ({
  TaskQueue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockReturnValue({ taskId: 'task-1', status: 'pending' }),
    getStats: vi.fn().mockReturnValue({ pending: 0, processing: 0, completed: 0, failed: 0 }),
    getWebhookPending: vi.fn().mockReturnValue([]),
    markWebhookPushed: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    resetProcessingTask: vi.fn(),
    close: vi.fn()
  }))
}));

vi.mock('./announcement-queue.js', () => ({
  AnnouncementQueue: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./webhook-pusher.js', () => ({
  WebhookPusher: vi.fn().mockImplementation(() => ({
    pushTask: vi.fn().mockResolvedValue({ success: true, latency: 50 })
  }))
}));

vi.mock('@f2a/network', () => ({
  ReviewCommittee: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('./task-guard.js', () => ({
  taskGuard: {
    check: vi.fn().mockReturnValue({ passed: true, warnings: [], blocks: [], requiresConfirmation: false }),
    shutdown: vi.fn()
  },
  TaskGuard: vi.fn(),
  DEFAULT_TASK_GUARD_CONFIG: {}
}));

describe('F2AOpenClawAdapter - 高价值边缘情况', () => {
  let adapter: F2AOpenClawAdapter;
  let mockApi: OpenClawPluginApi;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // 重置 reputation mock 为默认值
    const { ReputationSystem, ReputationManagerAdapter } = await import('./reputation.js');
    (ReputationSystem as any).mockImplementation(() => ({
      getReputation: vi.fn().mockReturnValue({ score: 50 }),
      isAllowed: vi.fn().mockReturnValue(true),
      flush: vi.fn()
    }));
    (ReputationManagerAdapter as any).mockImplementation(() => ({
      hasPermission: vi.fn().mockReturnValue(true),
      getHighReputationNodes: vi.fn().mockReturnValue([]),
      getAllReputations: vi.fn().mockReturnValue([]),
      recordReviewPenalty: vi.fn(),
      recordReviewReward: vi.fn()
    }));
    
    // 重置 TaskQueue mock 为默认值
    const { TaskQueue } = await import('./task-queue.js');
    (TaskQueue as any).mockImplementation(() => ({
      add: vi.fn().mockReturnValue({ taskId: 'task-1', status: 'pending' }),
      getStats: vi.fn().mockReturnValue({ pending: 0, processing: 0, completed: 0, failed: 0 }),
      getWebhookPending: vi.fn().mockReturnValue([]),
      markWebhookPushed: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      resetProcessingTask: vi.fn(),
      close: vi.fn()
    }));
    
    mockApi = {
      runtime: {
        system: {
          requestHeartbeatNow: vi.fn()
        }
      }
    } as any;
    adapter = new F2AOpenClawAdapter();
  });

  afterEach(async () => {
    await adapter.shutdown().catch(() => {});
  });

  // ========== 1. Webhook 处理器 - 信誉检查 ==========
  describe('Webhook 处理器 - 信誉检查', () => {
    it('应该拒绝低信誉请求者的 discover 请求', async () => {
      // Mock reputation system 返回不允许
      const { ReputationSystem, ReputationManagerAdapter } = await import('./reputation.js');
      const mockReputationSystem = {
        getReputation: vi.fn().mockReturnValue({ score: 10 }),
        isAllowed: vi.fn().mockReturnValue(false) // 不允许
      };
      (ReputationSystem as any).mockImplementation(() => mockReputationSystem);

      // 重新创建 adapter 以使用 mock
      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      // 访问私有方法
      const handler = (adapter as any).createWebhookHandler();
      const result = await handler.onDiscover({
        requester: 'low-rep-peer',
        query: { capability: 'code-gen' }
      });

      expect(result.capabilities).toEqual([]);
      expect(result.reputation).toBe(10);
    });
  });

  // ========== 2. Webhook 处理器 - 黑白名单检查 ==========
  describe('Webhook 处理器 - 黑白名单检查', () => {
    it('应该拒绝不在白名单中的请求者（当白名单启用时）', async () => {
      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({
        autoStart: false,
        _api: mockApi,
        security: {
          whitelist: ['trusted-peer-1', 'trusted-peer-2'],
          blacklist: []
        }
      });

      const handler = (adapter as any).createWebhookHandler();
      const result = await handler.onDelegate({
        from: 'unknown-peer', // 不在白名单
        taskId: 'task-1',
        taskType: 'test',
        description: 'Test task',
        timestamp: Date.now(),
        timeout: 5000
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('Not in whitelist');
    });

    it('应该拒绝黑名单中的请求者', async () => {
      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({
        autoStart: false,
        _api: mockApi,
        security: {
          whitelist: [],
          blacklist: ['malicious-peer']
        }
      });

      const handler = (adapter as any).createWebhookHandler();
      const result = await handler.onDelegate({
        from: 'malicious-peer',
        taskId: 'task-2',
        taskType: 'test',
        description: 'Test task',
        timestamp: Date.now(),
        timeout: 5000
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('In blacklist');
    });
  });

  // ========== 3. Webhook 处理器 - TaskGuard 集成 ==========
  describe('Webhook 处理器 - TaskGuard 集成', () => {
    it('应该拒绝被 TaskGuard 阻止的任务', async () => {
      const { taskGuard } = await import('./task-guard.js');
      (taskGuard.check as any).mockReturnValue({
        passed: false,
        warnings: [],
        blocks: [{ ruleId: 'dangerous-keywords', message: 'Contains dangerous keywords' }],
        requiresConfirmation: false
      });

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      const handler = (adapter as any).createWebhookHandler();
      const result = await handler.onDelegate({
        from: 'peer-1',
        taskId: 'task-3',
        taskType: 'test',
        description: 'rm -rf /', // 危险命令
        timestamp: Date.now(),
        timeout: 5000
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('TaskGuard blocked');
    });

    it('应该记录 TaskGuard 警告但继续处理需要确认的任务', async () => {
      const { taskGuard } = await import('./task-guard.js');
      (taskGuard.check as any).mockReturnValue({
        passed: true,
        warnings: [{ ruleId: 'reputation', message: 'Low reputation' }],
        blocks: [],
        requiresConfirmation: true
      });

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      const handler = (adapter as any).createWebhookHandler();
      const result = await handler.onDelegate({
        from: 'peer-1',
        taskId: 'task-4',
        taskType: 'test',
        description: 'Test task',
        timestamp: Date.now(),
        timeout: 5000
      });

      // 应该接受任务（记录警告但不阻止）
      expect(result.accepted).toBe(true);
    });
  });

  // ========== 4. Webhook 处理器 - 队列已满 ==========
  describe('Webhook 处理器 - 队列已满', () => {
    it('应该拒绝当任务队列已满时的新任务', async () => {
      const { TaskQueue } = await import('./task-queue.js');
      (TaskQueue as any).mockImplementation(() => ({
        add: vi.fn(),
        getStats: vi.fn().mockReturnValue({ pending: 100, processing: 0, completed: 0, failed: 0 }), // 队列已满
        getWebhookPending: vi.fn(),
        markWebhookPushed: vi.fn(),
        getAll: vi.fn(),
        resetProcessingTask: vi.fn(),
        close: vi.fn()
      }));

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({
        autoStart: false,
        _api: mockApi,
        maxQueuedTasks: 100
      });

      const handler = (adapter as any).createWebhookHandler();
      const result = await handler.onDelegate({
        from: 'peer-1',
        taskId: 'task-5',
        taskType: 'test',
        description: 'Test task',
        timestamp: Date.now(),
        timeout: 5000
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('Task queue is full');
    });
  });

  // ========== 5. 兜底轮询 - 僵尸任务重置 ==========
  describe('resetTimedOutProcessingTasks', () => {
    it('应该重置超时未完成的 processing 任务', async () => {
      const { TaskQueue } = await import('./task-queue.js');
      const mockTaskQueue = {
        add: vi.fn(),
        getStats: vi.fn().mockReturnValue({ pending: 0, processing: 1, completed: 0, failed: 0 }),
        getWebhookPending: vi.fn(),
        markWebhookPushed: vi.fn(),
        getAll: vi.fn().mockReturnValue([
          {
            taskId: 'stuck-task',
            status: 'processing',
            createdAt: Date.now() - 10 * 60 * 1000, // 10 分钟前
            updatedAt: Date.now() - 10 * 60 * 1000,
            timeout: 30000 // 30 秒超时
          }
        ]),
        resetProcessingTask: vi.fn(),
        close: vi.fn()
      };
      (TaskQueue as any).mockImplementation(() => mockTaskQueue);

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      // 调用私有方法
      (adapter as any).resetTimedOutProcessingTasks();

      expect(mockTaskQueue.resetProcessingTask).toHaveBeenCalledWith('stuck-task');
    });

    it('应该忽略正常处理中的任务', async () => {
      const { TaskQueue } = await import('./task-queue.js');
      const mockTaskQueue = {
        add: vi.fn(),
        getStats: vi.fn().mockReturnValue({ pending: 0, processing: 1, completed: 0, failed: 0 }),
        getWebhookPending: vi.fn(),
        markWebhookPushed: vi.fn(),
        getAll: vi.fn().mockReturnValue([
          {
            taskId: 'normal-task',
            status: 'processing',
            createdAt: Date.now() - 1000, // 1 秒前
            updatedAt: Date.now() - 500,
            timeout: 30000
          }
        ]),
        resetProcessingTask: vi.fn(),
        close: vi.fn()
      };
      (TaskQueue as any).mockImplementation(() => mockTaskQueue);

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      (adapter as any).resetTimedOutProcessingTasks();

      expect(mockTaskQueue.resetProcessingTask).not.toHaveBeenCalled();
    });
  });

  // ========== 6. 延迟初始化 - toolHandlers ==========
  describe('延迟初始化 - toolHandlers', () => {
    it('应该在首次访问时初始化 toolHandlers', async () => {
      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      // 首次访问前 _toolHandlers 应该是 undefined
      expect((adapter as any)._toolHandlers).toBeUndefined();

      // 访问 getter 触发初始化
      const handlers = (adapter as any).toolHandlers;

      expect(handlers).toBeDefined();
      expect((adapter as any)._toolHandlers).toBeDefined();
    });

    it('应该返回相同的 toolHandlers 实例', async () => {
      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      const handlers1 = (adapter as any).toolHandlers;
      const handlers2 = (adapter as any).toolHandlers;

      expect(handlers1).toBe(handlers2); // 应该是同一个实例
    });
  });

  // ========== 7. 延迟初始化 - claimHandlers ==========
  describe('延迟初始化 - claimHandlers', () => {
    it('应该在首次访问时初始化 claimHandlers', async () => {
      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      expect((adapter as any)._claimHandlers).toBeUndefined();

      const handlers = (adapter as any).claimHandlers;

      expect(handlers).toBeDefined();
      expect((adapter as any)._claimHandlers).toBeDefined();
    });
  });

  // ========== 8. mergeConfig - 边界条件 ==========
  describe('mergeConfig - 边界条件', () => {
    it('应该处理空配置', () => {
      adapter = new F2AOpenClawAdapter();
      const config = (adapter as any).mergeConfig({});

      expect(config.autoStart).toBe(true); // 默认值
      expect(config.webhookPort).toBe(9002); // 默认值
      expect(config.agentName).toBe('OpenClaw Agent'); // 默认值
    });

    it('应该保留 webhookPush 配置', () => {
      adapter = new F2AOpenClawAdapter();
      const config = (adapter as any).mergeConfig({
        webhookPush: {
          enabled: true,
          url: 'https://example.com/webhook',
          token: 'secret-token',
          timeout: 5000
        }
      });

      expect(config.webhookPush).toEqual({
        enabled: true,
        url: 'https://example.com/webhook',
        token: 'secret-token',
        timeout: 5000
      });
    });

    it('应该处理部分 reputation 配置', () => {
      adapter = new F2AOpenClawAdapter();
      const config = (adapter as any).mergeConfig({
        reputation: {
          enabled: false
          // 其他字段使用默认值
        }
      });

      expect(config.reputation.enabled).toBe(false);
      expect(config.reputation.initialScore).toBe(50); // 默认值
      expect(config.reputation.minScoreForService).toBe(20); // 默认值
    });
  });

  // ========== 9. resolveAgent - 各种匹配模式 ==========
  describe('resolveAgent - 各种匹配模式', () => {
    it('应该解析 #索引格式的 agent 引用', async () => {
      const { F2ANetworkClient } = await import('./network-client.js');
      (F2ANetworkClient as any).mockImplementation(() => createMockNetworkClient({
        discoverAgents: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { peerId: 'peer-1', displayName: 'Agent 1' },
            { peerId: 'peer-2', displayName: 'Agent 2' },
            { peerId: 'peer-3', displayName: 'Agent 3' }
          ]
        })
      }));

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      const agent = await adapter.resolveAgent('#2');

      expect(agent).toEqual({ peerId: 'peer-2', displayName: 'Agent 2' });
    });

    it('应该精确匹配 peerId 或 displayName', async () => {
      const { F2ANetworkClient } = await import('./network-client.js');
      (F2ANetworkClient as any).mockImplementation(() => createMockNetworkClient({
        discoverAgents: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { peerId: 'peer-1', displayName: 'Alice' },
            { peerId: 'peer-2', displayName: 'Bob' }
          ]
        })
      }));

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      // 精确匹配 peerId
      const agent1 = await adapter.resolveAgent('peer-1');
      expect(agent1).toEqual({ peerId: 'peer-1', displayName: 'Alice' });

      // 精确匹配 displayName
      const agent2 = await adapter.resolveAgent('Bob');
      expect(agent2).toEqual({ peerId: 'peer-2', displayName: 'Bob' });
    });

    it('应该模糊匹配 agent 引用', async () => {
      const { F2ANetworkClient } = await import('./network-client.js');
      (F2ANetworkClient as any).mockImplementation(() => createMockNetworkClient({
        discoverAgents: vi.fn().mockResolvedValue({
          success: true,
          data: [
            { peerId: '12D3KooWAbc123', displayName: 'Code Agent Pro' },
            { peerId: '12D3KooWXyz789', displayName: 'File Helper' }
          ]
        })
      }));

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      // 模糊匹配 peerId 前缀
      const agent1 = await adapter.resolveAgent('12D3KooWAbc');
      expect(agent1?.peerId).toBe('12D3KooWAbc123');

      // 模糊匹配 displayName（不区分大小写）
      const agent2 = await adapter.resolveAgent('code');
      expect(agent2?.displayName).toBe('Code Agent Pro');
    });

    it('应该在未找到时返回 null', async () => {
      const { F2ANetworkClient } = await import('./network-client.js');
      (F2ANetworkClient as any).mockImplementation(() => createMockNetworkClient({
        discoverAgents: vi.fn().mockResolvedValue({
          success: true,
          data: []
        })
      }));

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      const agent = await adapter.resolveAgent('non-existent');
      expect(agent).toBeNull();
    });
  });

  // ========== 10. formatBroadcastResults - 格式化 ==========
  describe('formatBroadcastResults', () => {
    it('应该正确格式化广播结果', () => {
      adapter = new F2AOpenClawAdapter();
      
      const results = [
        { agent: 'Agent 1', success: true, latency: 50 },
        { agent: 'Agent 2', success: false, error: 'Timeout' },
        { agent: 'Agent 3', success: true }
      ];

      const formatted = adapter.formatBroadcastResults(results);

      expect(formatted).toContain('✅ Agent 1 (50ms)');
      expect(formatted).toContain('❌ Agent 2');
      expect(formatted).toContain('Timeout');
      expect(formatted).toContain('✅ Agent 3');
    });
  });

  // ========== 11. shutdown - 资源清理 ==========
  describe('shutdown - 资源清理', () => {
    it('应该清理所有资源', async () => {
      const { TaskQueue } = await import('./task-queue.js');
      const { ReputationSystem } = await import('./reputation.js');
      
      const mockTaskQueue = {
        add: vi.fn(),
        getStats: vi.fn(),
        getWebhookPending: vi.fn(),
        markWebhookPushed: vi.fn(),
        getAll: vi.fn(),
        resetProcessingTask: vi.fn(),
        close: vi.fn()
      };
      (TaskQueue as any).mockImplementation(() => mockTaskQueue);

      const mockReputationSystem = {
        getReputation: vi.fn(),
        isAllowed: vi.fn(),
        flush: vi.fn()
      };
      (ReputationSystem as any).mockImplementation(() => mockReputationSystem);

      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      await adapter.shutdown();

      // 验证资源清理
      expect(mockReputationSystem.flush).toHaveBeenCalled();
      expect(mockTaskQueue.close).toHaveBeenCalled();

      const { taskGuard } = await import('./task-guard.js');
      expect(taskGuard.shutdown).toHaveBeenCalled();
    });

    it('应该多次调用 shutdown 而不抛出错误', async () => {
      adapter = new F2AOpenClawAdapter();
      await adapter.initialize({ autoStart: false, _api: mockApi });

      await adapter.shutdown();
      await expect(adapter.shutdown()).resolves.not.toThrow();
    });
  });

  // ========== 12. Webhook 推送失败回退 ==========
  describe('Webhook 推送失败回退', () => {
    it('应该在 webhook 推送失败时记录日志但继续', async () => {
      // 注意：不要在 beforeEach 中 clearAllMocks 后再 mock，需要先 mock 再创建 adapter
      const { WebhookPusher } = await import('./webhook-pusher.js');
      (WebhookPusher as any).mockImplementation(() => ({
        pushTask: vi.fn().mockResolvedValue({
          success: false,
          error: 'Network error'
        })
      }));

      // 创建新的 adapter 实例
      const testAdapter = new F2AOpenClawAdapter();
      await testAdapter.initialize({
        autoStart: false,
        _api: mockApi,
        webhookPush: {
          enabled: true,
          url: 'https://example.com/webhook',
          token: 'token'
        }
      });

      const handler = (testAdapter as any).createWebhookHandler();
      const result = await handler.onDelegate({
        from: 'peer-1',
        taskId: 'task-6',
        taskType: 'test',
        description: 'Test task',
        timestamp: Date.now(),
        timeout: 5000
      });

      // 清理
      await testAdapter.shutdown();

      // 任务应该被接受（推送失败不影响接收）
      expect(result.accepted).toBe(true);
    });
  });
});