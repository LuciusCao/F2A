/**
 * ToolHandlers 单元测试
 * 测试工具处理器的所有方法
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolHandlers, type ToolHandlerParams } from './tool-handlers.js';
import type { F2AOpenClawAdapter } from './connector.js';
import type { SessionContext, AgentInfo, TaskResponse } from './types.js';
import type { QueuedTask } from './task-queue.js';

// 创建 mock 依赖
const createMockNetworkClient = () => ({
  discoverAgents: vi.fn(),
  delegateTask: vi.fn(),
  getConnectedPeers: vi.fn(),
  sendTaskResponse: vi.fn()
});

const createMockReputationSystem = () => ({
  getReputation: vi.fn(),
  isAllowed: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getAllReputations: vi.fn()
});

const createMockTaskQueue = () => ({
  getStats: vi.fn(),
  getPending: vi.fn(),
  getAll: vi.fn(),
  get: vi.fn(),
  complete: vi.fn(),
  markProcessing: vi.fn()
});

const createMockNodeManager = () => ({
  getStatus: vi.fn()
});

const createMockAdapter = () => ({
  networkClient: createMockNetworkClient(),
  reputationSystem: createMockReputationSystem(),
  taskQueue: createMockTaskQueue(),
  nodeManager: createMockNodeManager(),
  config: {
    security: {
      requireConfirmation: false,
      whitelist: [] as string[],
      blacklist: [] as string[],
      maxTasksPerMinute: 10
    }
  }
});

// 创建 mock SessionContext
const createMockSessionContext = (): SessionContext => ({
  sessionId: 'test-session-123',
  workspace: '/tmp/test-workspace',
  toJSON: vi.fn(() => ({ sessionId: 'test-session-123', workspace: '/tmp/test-workspace' }))
});

// 创建测试用的 AgentInfo
const createMockAgent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  peerId: 'peer-test-12345678901234567890',
  displayName: 'Test Agent',
  capabilities: [{ name: 'code-generation', description: 'Code generation capability' }],
  ...overrides
});

// 创建测试用的 QueuedTask
const createMockTask = (overrides: Partial<QueuedTask> = {}): QueuedTask => ({
  taskId: 'task-test-123',
  taskType: 'openclaw-task',
  description: 'Test task description',
  from: 'peer-sender-123',
  parameters: {},
  status: 'pending',
  createdAt: Date.now(),
  timeout: 60000,
  ...overrides
});

describe('ToolHandlers', () => {
  let toolHandlers: ToolHandlers;
  let mockAdapter: any;
  let mockContext: SessionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockContext = createMockSessionContext();
    toolHandlers = new ToolHandlers(mockAdapter as F2AOpenClawAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleDiscover', () => {
    it('应该成功发现 Agents 并返回格式化内容', async () => {
      const agents = [
        createMockAgent({ displayName: 'Agent A', peerId: 'peer-a-12345678901234567890' }),
        createMockAgent({ displayName: 'Agent B', peerId: 'peer-b-12345678901234567890' })
      ];

      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });

      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      const result = await toolHandlers.handleDiscover({}, mockContext);

      expect(result.content).toContain('发现 2 个 Agents');
      expect(result.data).toEqual({ agents, count: 2 });
    });

    it('应该按能力过滤 Agents', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [createMockAgent()]
      });

      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      await toolHandlers.handleDiscover({ capability: 'code-generation' }, mockContext);

      expect(mockAdapter.networkClient.discoverAgents).toHaveBeenCalledWith('code-generation');
    });

    it('应该按最低信誉过滤 Agents', async () => {
      const agents = [
        createMockAgent({ peerId: 'peer-high', displayName: 'High Rep Agent' }),
        createMockAgent({ peerId: 'peer-low', displayName: 'Low Rep Agent' })
      ];

      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });

      // getReputation 会被调用多次：过滤时调用，显示时也调用
      // peer-high: 过滤时返回 90，显示时返回 90
      // peer-low: 过滤时返回 30（被过滤掉，不会显示）
      mockAdapter.reputationSystem.getReputation.mockImplementation((peerId: string) => {
        if (peerId === 'peer-high') {
          return { score: 90 };
        }
        return { score: 30 };
      });

      const result = await toolHandlers.handleDiscover({ min_reputation: 50 }, mockContext);

      expect(result.data?.count).toBe(1);
      expect(result.content).toContain('High Rep Agent');
      expect(result.content).not.toContain('Low Rep Agent');
    });

    it('应该处理发现失败的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: false,
        error: 'Network error'
      });

      const result = await toolHandlers.handleDiscover({}, mockContext);

      expect(result.content).toBe('发现失败: Network error');
    });

    it('应该处理未发现 Agents 的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: []
      });

      const result = await toolHandlers.handleDiscover({}, mockContext);

      expect(result.content).toBe('🔍 未发现符合条件的 Agents');
    });

    it('应该处理 null data 的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: null
      });

      const result = await toolHandlers.handleDiscover({}, mockContext);

      expect(result.content).toBe('🔍 未发现符合条件的 Agents');
    });
  });

  describe('handleDelegate', () => {
    it('应该成功委托任务给 Agent', async () => {
      const agent = createMockAgent();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });
      
      mockAdapter.networkClient.delegateTask.mockResolvedValue({
        success: true,
        data: { result: 'Task completed' }
      });

      const result = await toolHandlers.handleDelegate({
        agent: 'Test Agent',
        task: 'Write some code'
      }, mockContext);

      expect(result.content).toContain('Test Agent 已完成任务');
      expect(result.data).toEqual({ result: 'Task completed' });
    });

    it('应该处理找不到 Agent 的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: []
      });

      const result = await toolHandlers.handleDelegate({
        agent: 'Non-existent Agent',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toBe('❌ 找不到 Agent: Non-existent Agent');
    });

    it('应该处理信誉过低的情况', async () => {
      const agent = createMockAgent();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(false);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 20 });

      const result = await toolHandlers.handleDelegate({
        agent: 'Test Agent',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('信誉过低');
    });

    it('应该处理委托失败的情况', async () => {
      const agent = createMockAgent();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });
      
      mockAdapter.networkClient.delegateTask.mockResolvedValue({
        success: false,
        error: 'Connection timeout'
      });

      const result = await toolHandlers.handleDelegate({
        agent: 'Test Agent',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toBe('❌ 委托失败: Connection timeout');
      expect(mockAdapter.reputationSystem.recordFailure).toHaveBeenCalled();
    });

    it('应该支持 #索引 格式引用 Agent', async () => {
      const agents = [
        createMockAgent({ displayName: 'First Agent' }),
        createMockAgent({ displayName: 'Second Agent' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });
      
      mockAdapter.networkClient.delegateTask.mockResolvedValue({
        success: true,
        data: {}
      });

      await toolHandlers.handleDelegate({
        agent: '#1',
        task: 'Test task'
      }, mockContext);

      expect(mockAdapter.networkClient.delegateTask).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: agents[0].peerId })
      );
    });

    it('应该支持 peerId 精确匹配', async () => {
      const agent = createMockAgent({ peerId: 'exact-peer-id-123' });
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });
      
      mockAdapter.networkClient.delegateTask.mockResolvedValue({
        success: true,
        data: {}
      });

      await toolHandlers.handleDelegate({
        agent: 'exact-peer-id-123',
        task: 'Test task'
      }, mockContext);

      expect(mockAdapter.networkClient.delegateTask).toHaveBeenCalledWith(
        expect.objectContaining({ peerId: 'exact-peer-id-123' })
      );
    });

    it('应该支持模糊匹配 Agent 名称', async () => {
      const agent = createMockAgent({ displayName: 'Code Helper Bot' });
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });
      
      mockAdapter.networkClient.delegateTask.mockResolvedValue({
        success: true,
        data: {}
      });

      await toolHandlers.handleDelegate({
        agent: 'helper',
        task: 'Test task'
      }, mockContext);

      expect(mockAdapter.networkClient.delegateTask).toHaveBeenCalled();
    });

    it('应该传递自定义超时时间', async () => {
      const agent = createMockAgent();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });
      
      mockAdapter.networkClient.delegateTask.mockResolvedValue({
        success: true,
        data: {}
      });

      await toolHandlers.handleDelegate({
        agent: 'Test Agent',
        task: 'Test task',
        timeout: 120000
      }, mockContext);

      expect(mockAdapter.networkClient.delegateTask).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 120000 })
      );
    });
  });

  describe('handleBroadcast', () => {
    it('应该成功广播任务给所有具备能力的 Agents', async () => {
      const agents = [
        createMockAgent({ displayName: 'Agent A' }),
        createMockAgent({ displayName: 'Agent B' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      mockAdapter.networkClient.delegateTask
        .mockResolvedValueOnce({ success: true, data: { result: 'A done' } })
        .mockResolvedValueOnce({ success: true, data: { result: 'B done' } });

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('2/2 个成功响应');
      expect(mockAdapter.networkClient.delegateTask).toHaveBeenCalledTimes(2);
    });

    it('应该处理没有具备该能力的 Agents', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: []
      });

      const result = await toolHandlers.handleBroadcast({
        capability: 'non-existent-capability',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('未发现具备 "non-existent-capability" 能力的 Agents');
    });

    it('应该处理 discoverAgents 失败的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: false,
        error: 'Discovery failed'
      });

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('未发现具备 "code-generation" 能力的 Agents');
    });

    it('应该处理部分成功的情况', async () => {
      const agents = [
        createMockAgent({ displayName: 'Agent A' }),
        createMockAgent({ displayName: 'Agent B' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      mockAdapter.networkClient.delegateTask
        .mockResolvedValueOnce({ success: true, data: {} })
        .mockResolvedValueOnce({ success: false, error: 'Failed' });

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('1/2 个成功响应');
    });

    it('应该处理 min_responses 要求未满足的情况', async () => {
      const agents = [
        createMockAgent({ displayName: 'Agent A' }),
        createMockAgent({ displayName: 'Agent B' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      mockAdapter.networkClient.delegateTask
        .mockResolvedValueOnce({ success: false, error: 'Failed' })
        .mockResolvedValueOnce({ success: false, error: 'Failed' });

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code',
        min_responses: 2
      }, mockContext);

      expect(result.content).toContain('仅 0 个成功响应（需要 2）');
    });

    it('应该处理委托异常的情况', async () => {
      const agents = [createMockAgent()];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      mockAdapter.networkClient.delegateTask.mockRejectedValue(new Error('Network error'));

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('仅 0 个成功响应');
    });
  });

  describe('handleStatus', () => {
    it('应该返回完整的网络状态', async () => {
      mockAdapter.nodeManager.getStatus.mockResolvedValue({
        success: true,
        data: {
          running: true,
          peerId: 'local-peer-12345678901234567890',
          uptime: 3600
        }
      });
      
      mockAdapter.networkClient.getConnectedPeers.mockResolvedValue({
        success: true,
        data: [
          { peerId: 'peer-1', agentInfo: { displayName: 'Remote Agent' } }
        ]
      });
      
      mockAdapter.taskQueue.getStats.mockReturnValue({
        pending: 5,
        processing: 2,
        completed: 10,
        failed: 1,
        total: 18
      });
      
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 75 });

      const result = await toolHandlers.handleStatus({}, mockContext);

      expect(result.content).toContain('运行中');
      expect(result.content).toContain('60 分钟');
      expect(result.content).toContain('5 待处理');
      expect(result.data?.peers).toHaveLength(1);
    });

    it('应该处理获取状态失败的情况', async () => {
      mockAdapter.nodeManager.getStatus.mockResolvedValue({
        success: false,
        error: 'Node not running'
      });

      const result = await toolHandlers.handleStatus({}, mockContext);

      expect(result.content).toBe('❌ 获取状态失败: Node not running');
    });

    it('应该处理 getConnectedPeers 失败的情况', async () => {
      mockAdapter.nodeManager.getStatus.mockResolvedValue({
        success: true,
        data: { running: true, peerId: 'local-peer', uptime: 100 }
      });
      
      mockAdapter.networkClient.getConnectedPeers.mockResolvedValue({
        success: false,
        error: 'No peers'
      });
      
      mockAdapter.taskQueue.getStats.mockReturnValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        total: 0
      });

      const result = await toolHandlers.handleStatus({}, mockContext);

      expect(result.content).toContain('已连接 Peers: 0');
    });

    it('应该处理节点未运行的情况', async () => {
      mockAdapter.nodeManager.getStatus.mockResolvedValue({
        success: true,
        data: { running: false, peerId: null, uptime: 0 }
      });
      
      mockAdapter.networkClient.getConnectedPeers.mockResolvedValue({
        success: true,
        data: []
      });
      
      mockAdapter.taskQueue.getStats.mockReturnValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        total: 0
      });

      const result = await toolHandlers.handleStatus({}, mockContext);

      expect(result.content).toContain('已停止');
    });
  });

  describe('handleReputation', () => {
    describe('action: list', () => {
      it('应该返回所有信誉记录', async () => {
        mockAdapter.reputationSystem.getAllReputations.mockReturnValue([
          { peerId: 'peer-1-12345678901234567890', score: 80, successfulTasks: 10, failedTasks: 2 },
          { peerId: 'peer-2-12345678901234567890', score: 60, successfulTasks: 5, failedTasks: 3 }
        ]);

        const result = await toolHandlers.handleReputation({ action: 'list' }, mockContext);

        expect(result.content).toContain('信誉记录 (2 条)');
        expect(result.content).toContain('80');
        expect(result.content).toContain('60');
      });

      it('应该处理空信誉记录', async () => {
        mockAdapter.reputationSystem.getAllReputations.mockReturnValue([]);

        const result = await toolHandlers.handleReputation({ action: 'list' }, mockContext);

        expect(result.content).toContain('信誉记录 (0 条)');
      });
    });

    describe('action: view', () => {
      it('应该返回指定 Peer 的信誉详情', async () => {
        mockAdapter.reputationSystem.getReputation.mockReturnValue({
          score: 85,
          successfulTasks: 20,
          failedTasks: 3,
          avgResponseTime: 150,
          lastInteraction: Date.now()
        });

        const result = await toolHandlers.handleReputation({
          action: 'view',
          peer_id: 'peer-target-12345678901234567890'
        }, mockContext);

        expect(result.content).toContain('信誉分: 85');
        expect(result.content).toContain('成功任务: 20');
        expect(result.content).toContain('失败任务: 3');
      });

      it('应该要求提供 peer_id', async () => {
        const result = await toolHandlers.handleReputation({ action: 'view' }, mockContext);

        expect(result.content).toBe('❌ view/block/unblock 操作需要提供 peer_id 参数');
      });
    });

    describe('action: block', () => {
      it('应该成功屏蔽 Peer', async () => {
        const result = await toolHandlers.handleReputation({
          action: 'block',
          peer_id: 'peer-to-block-12345678901234567890'
        }, mockContext);

        expect(result.content).toContain('已屏蔽');
        expect(mockAdapter.config.security.blacklist).toContain('peer-to-block-12345678901234567890');
      });

      it('应该要求提供 peer_id', async () => {
        const result = await toolHandlers.handleReputation({ action: 'block' }, mockContext);

        expect(result.content).toBe('❌ view/block/unblock 操作需要提供 peer_id 参数');
      });

      it('应该在没有 security 配置时创建默认配置', async () => {
        mockAdapter.config.security = undefined;

        const result = await toolHandlers.handleReputation({
          action: 'block',
          peer_id: 'peer-to-block'
        }, mockContext);

        expect(mockAdapter.config.security).toBeDefined();
        expect(mockAdapter.config.security.blacklist).toContain('peer-to-block');
      });
    });

    describe('action: unblock', () => {
      it('应该成功解除屏蔽', async () => {
        mockAdapter.config.security.blacklist = ['peer-to-unblock', 'other-peer'];

        const result = await toolHandlers.handleReputation({
          action: 'unblock',
          peer_id: 'peer-to-unblock'
        }, mockContext);

        expect(result.content).toContain('已解除屏蔽');
        expect(mockAdapter.config.security.blacklist).not.toContain('peer-to-unblock');
        expect(mockAdapter.config.security.blacklist).toContain('other-peer');
      });

      it('应该要求提供 peer_id', async () => {
        const result = await toolHandlers.handleReputation({ action: 'unblock' }, mockContext);

        expect(result.content).toBe('❌ view/block/unblock 操作需要提供 peer_id 参数');
      });
    });

    describe('未知操作', () => {
      it('应该返回错误信息', async () => {
        const result = await toolHandlers.handleReputation({
          action: 'unknown-action'
        }, mockContext);

        expect(result.content).toBe('❌ action 参数必须是 list, view, block 或 unblock');
      });
    });
  });

  describe('handlePollTasks', () => {
    it('应该返回待处理任务并标记为 processing', async () => {
      const tasks = [
        createMockTask({ taskId: 'task-1', status: 'pending' }),
        createMockTask({ taskId: 'task-2', status: 'pending' })
      ];
      
      mockAdapter.taskQueue.getPending.mockReturnValue(tasks);

      const result = await toolHandlers.handlePollTasks({}, mockContext);

      expect(result.content).toContain('任务列表 (2 个)');
      expect(result.data?.count).toBe(2);
      expect(mockAdapter.taskQueue.markProcessing).toHaveBeenCalledTimes(2);
    });

    it('应该按状态过滤任务', async () => {
      const tasks = [
        createMockTask({ taskId: 'task-1', status: 'completed' })
      ];
      
      mockAdapter.taskQueue.getAll.mockReturnValue(tasks);

      const result = await toolHandlers.handlePollTasks({ status: 'completed' }, mockContext);

      expect(result.content).toContain('任务列表 (1 个)');
      expect(mockAdapter.taskQueue.getAll).toHaveBeenCalled();
      expect(mockAdapter.taskQueue.markProcessing).not.toHaveBeenCalled();
    });

    it('应该限制返回的任务数量', async () => {
      const tasks = Array.from({ length: 20 }, (_, i) => 
        createMockTask({ taskId: `task-${i}`, status: 'pending' })
      );
      
      mockAdapter.taskQueue.getPending.mockReturnValue(tasks.slice(0, 5));

      const result = await toolHandlers.handlePollTasks({ limit: 5 }, mockContext);

      expect(mockAdapter.taskQueue.getPending).toHaveBeenCalledWith(5);
    });

    it('应该处理没有任务的情况', async () => {
      mockAdapter.taskQueue.getPending.mockReturnValue([]);

      const result = await toolHandlers.handlePollTasks({}, mockContext);

      expect(result.content).toBe('📭 没有符合条件的任务');
    });

    it('应该正确显示不同状态的任务图标', async () => {
      const tasks = [
        createMockTask({ taskId: 'task-pending', status: 'pending' }),
        createMockTask({ taskId: 'task-processing', status: 'processing' }),
        createMockTask({ taskId: 'task-completed', status: 'completed' }),
        createMockTask({ taskId: 'task-failed', status: 'failed' })
      ];
      
      mockAdapter.taskQueue.getAll.mockReturnValue(tasks);

      const result = await toolHandlers.handlePollTasks({ status: 'pending' }, mockContext);

      expect(result.content).toContain('⏳');
    });
  });

  describe('handleSubmitResult', () => {
    it('应该成功提交任务结果', async () => {
      const task = createMockTask();
      
      mockAdapter.taskQueue.get.mockReturnValue(task);
      mockAdapter.networkClient.sendTaskResponse.mockResolvedValue({ success: true });
      mockAdapter.reputationSystem.recordSuccess.mockReturnValue(undefined);

      const result = await toolHandlers.handleSubmitResult({
        task_id: 'task-test-123',
        result: 'Task completed successfully',
        status: 'success'
      }, mockContext);

      expect(result.content).toContain('任务结果已提交并发送给原节点');
      expect(result.data?.sent).toBe(true);
      expect(mockAdapter.taskQueue.complete).toHaveBeenCalled();
      expect(mockAdapter.reputationSystem.recordSuccess).toHaveBeenCalled();
    });

    it('应该处理任务不存在的情况', async () => {
      mockAdapter.taskQueue.get.mockReturnValue(null);

      const result = await toolHandlers.handleSubmitResult({
        task_id: 'non-existent-task',
        result: 'Result',
        status: 'success'
      }, mockContext);

      expect(result.content).toContain('找不到任务');
    });

    it('应该处理发送响应失败的情况', async () => {
      const task = createMockTask();
      
      mockAdapter.taskQueue.get.mockReturnValue(task);
      mockAdapter.networkClient.sendTaskResponse.mockResolvedValue({
        success: false,
        error: 'Connection lost'
      });

      const result = await toolHandlers.handleSubmitResult({
        task_id: 'task-test-123',
        result: 'Result',
        status: 'success'
      }, mockContext);

      expect(result.content).toContain('结果已记录，但发送给原节点失败');
      expect(result.data?.sent).toBe(false);
    });

    it('应该正确处理错误状态的结果', async () => {
      const task = createMockTask();
      
      mockAdapter.taskQueue.get.mockReturnValue(task);
      mockAdapter.networkClient.sendTaskResponse.mockResolvedValue({ success: true });
      mockAdapter.reputationSystem.recordFailure.mockReturnValue(undefined);

      const result = await toolHandlers.handleSubmitResult({
        task_id: 'task-test-123',
        result: 'Task failed with error',
        status: 'error'
      }, mockContext);

      expect(result.content).toContain('任务结果已提交');
      expect(mockAdapter.reputationSystem.recordFailure).toHaveBeenCalled();
    });

    it('应该计算正确的响应延迟', async () => {
      const createdAt = Date.now() - 5000; // 5 秒前创建
      const task = createMockTask({ createdAt });
      
      mockAdapter.taskQueue.get.mockReturnValue(task);
      mockAdapter.networkClient.sendTaskResponse.mockResolvedValue({ success: true });

      const result = await toolHandlers.handleSubmitResult({
        task_id: 'task-test-123',
        result: 'Done',
        status: 'success'
      }, mockContext);

      expect(result.data?.latency).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('handleTaskStats', () => {
    it('应该返回任务队列统计信息', async () => {
      mockAdapter.taskQueue.getStats.mockReturnValue({
        pending: 10,
        processing: 3,
        completed: 50,
        failed: 2,
        total: 65
      });

      const result = await toolHandlers.handleTaskStats({}, mockContext);

      expect(result.content).toContain('待处理: 10');
      expect(result.content).toContain('处理中: 3');
      expect(result.content).toContain('已完成: 50');
      expect(result.content).toContain('失败: 2');
      expect(result.content).toContain('总计: 65');
      expect(result.data).toEqual({
        pending: 10,
        processing: 3,
        completed: 50,
        failed: 2,
        total: 65
      });
    });

    it('应该处理空队列的情况', async () => {
      mockAdapter.taskQueue.getStats.mockReturnValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        total: 0
      });

      const result = await toolHandlers.handleTaskStats({}, mockContext);

      expect(result.content).toContain('待处理: 0');
      expect(result.content).toContain('总计: 0');
    });
  });
});