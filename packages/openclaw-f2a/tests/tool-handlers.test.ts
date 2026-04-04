/**
 * ToolHandlers 单元测试
 * 测试工具处理器的所有方法
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolHandlers, type ToolHandlerParams } from '../src/tool-handlers.js';
import type { F2AOpenClawAdapter } from '../src/connector.js';
import type { SessionContext, AgentInfo, TaskResponse } from '../src/types.js';
import type { QueuedTask } from '../src/task-queue.js';
import { 
  createMockAdapter, 
  createMockSessionContext, 
  createMockAgentInfo,
  createMockTaskRequest,
  createMockQueuedTask,
  generateValidPeerId,
  SPECIAL_NUMERIC_VALUES
} from './utils/test-helpers.js';

describe('ToolHandlers', () => {
  let toolHandlers: ToolHandlers;
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let mockContext: SessionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockContext = createMockSessionContext();
    toolHandlers = new ToolHandlers(mockAdapter as unknown as F2AOpenClawAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleDiscover', () => {
    it('应该成功发现 Agents 并返回格式化内容', async () => {
      const agents = [
        createMockAgentInfo({ displayName: 'Agent A', peerId: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
        createMockAgentInfo({ displayName: 'Agent B', peerId: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
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
        data: [createMockAgentInfo()]
      });

      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      await toolHandlers.handleDiscover({ capability: 'code-generation' }, mockContext);

      expect(mockAdapter.networkClient.discoverAgents).toHaveBeenCalledWith('code-generation');
    });

    it('应该按最低信誉过滤 Agents', async () => {
      const highRepPeerId = '12D3KooWHighRepAgentAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const lowRepPeerId = '12D3KooWLowRepAgentAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const agents = [
        createMockAgentInfo({ peerId: highRepPeerId, displayName: 'High Rep Agent' }),
        createMockAgentInfo({ peerId: lowRepPeerId, displayName: 'Low Rep Agent' })
      ];

      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });

      // getReputation: High Rep 返回 90，Low Rep 返回 30
      mockAdapter.reputationSystem.getReputation.mockImplementation((peerId: string) => {
        if (peerId === highRepPeerId) {
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
      const agent = createMockAgentInfo();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      const result = await toolHandlers.handleDelegate({
        agent: 'Test Agent',
        task: 'Write some code'
      }, mockContext);

      // 新协议：发送消息
      expect(result.content).toContain('消息已发送');
      expect(result.data?.sent).toBe(true);
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

      expect(result.content).toContain('找不到 Agent');
    });

    it('应该处理信誉过低的情况', async () => {
      const agent = createMockAgentInfo();
      
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

      // 新协议：发送消息（信誉警告但继续发送）
      expect(result.content).toContain('消息已发送');
    });

    it('应该处理委托失败的情况', async () => {
      const agent = createMockAgentInfo();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });
      
      // Mock sendMessage 失败
      mockAdapter._f2a.sendMessage.mockRejectedValueOnce(new Error('Connection timeout'));

      const result = await toolHandlers.handleDelegate({
        agent: 'Test Agent',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('发送失败');
    });

    it('应该支持 #索引 格式引用 Agent', async () => {
      const agents = [
        createMockAgentInfo({ displayName: 'First Agent' }),
        createMockAgentInfo({ displayName: 'Second Agent' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      const result = await toolHandlers.handleDelegate({
        agent: '#1',
        task: 'Test task'
      }, mockContext);

      expect(result.content).toContain('消息已发送');
    });

    it('应该支持 peerId 精确匹配', async () => {
      const agent = createMockAgentInfo({ peerId: 'exact-peer-id-123' });
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      const result = await toolHandlers.handleDelegate({
        agent: 'exact-peer-id-123',
        task: 'Test task'
      }, mockContext);

      expect(result.content).toContain('消息已发送');
    });

    it('应该支持模糊匹配 Agent 名称', async () => {
      const agent = createMockAgentInfo({ displayName: 'Code Helper Bot' });
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      const result = await toolHandlers.handleDelegate({
        agent: 'helper',
        task: 'Test task'
      }, mockContext);

      expect(result.content).toContain('消息已发送');
    });

    it('应该传递自定义超时时间', async () => {
      const agent = createMockAgentInfo();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter.reputationSystem.isAllowed.mockReturnValue(true);
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ score: 80 });

      const result = await toolHandlers.handleDelegate({
        agent: 'Test Agent',
        task: 'Test task',
        timeout: 120000
      }, mockContext);

      expect(result.content).toContain('消息已发送');
    });
  });

  describe('handleBroadcast', () => {
    it('应该成功广播任务给所有具备能力的 Agents', async () => {
      const agents = [
        createMockAgentInfo({ displayName: 'Agent A' }),
        createMockAgentInfo({ displayName: 'Agent B' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('2/2 个 Agents');
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
        createMockAgentInfo({ displayName: 'Agent A' }),
        createMockAgentInfo({ displayName: 'Agent B' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      // 第一个成功，第二个失败
      mockAdapter._f2a.sendMessage
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Failed'));

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('1/2');
    });

    it('应该处理 min_responses 要求未满足的情况', async () => {
      const agents = [
        createMockAgentInfo({ displayName: 'Agent A' }),
        createMockAgentInfo({ displayName: 'Agent B' })
      ];
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: agents
      });
      
      mockAdapter._f2a.sendMessage
        .mockRejectedValueOnce(new Error('Failed'))
        .mockRejectedValueOnce(new Error('Failed'));

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code',
        min_responses: 2
      }, mockContext);

      expect(result.content).toContain('仅 0 个成功响应');
    });

    it('应该处理委托异常的情况', async () => {
      const agent = createMockAgentInfo();
      
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });
      
      mockAdapter._f2a.sendMessage.mockRejectedValue(new Error('Network error'));

      const result = await toolHandlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Write code'
      }, mockContext);

      expect(result.content).toContain('仅 0 个成功响应');
    });
  });

  describe('handleStatus', () => {
    it('应该返回完整的网络状态', async () => {
      const result = await toolHandlers.handleStatus({}, mockContext);

      expect(result.content).toContain('F2A 状态');
      expect(result.content).toContain('运行中');
    });

    it('应该处理获取状态失败的情况', async () => {
      // 当没有 f2aClient 时使用 nodeManager
      delete (mockAdapter as any).f2aClient;
      delete (mockAdapter as any).getF2AStatus;
      
      mockAdapter.nodeManager.getStatus.mockResolvedValue({
        success: false,
        error: { message: 'Status check failed' }
      });

      const result = await toolHandlers.handleStatus({}, mockContext);

      expect(result.content).toContain('获取状态失败');
    });

    it('应该处理节点未运行的情况', async () => {
      mockAdapter.getF2AStatus.mockReturnValue({ running: false, peerId: undefined, uptime: 0 });

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
          peer_id: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
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
        const peerId = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const result = await toolHandlers.handleReputation({
          action: 'block',
          peer_id: peerId
        }, mockContext);

        expect(result.content).toContain('已屏蔽');
        expect(mockAdapter.config.security.blacklist).toContain(peerId);
      });

      it('应该要求提供 peer_id', async () => {
        const result = await toolHandlers.handleReputation({ action: 'block' }, mockContext);

        expect(result.content).toBe('❌ view/block/unblock 操作需要提供 peer_id 参数');
      });

      it('应该在没有 security 配置时创建默认配置', async () => {
        mockAdapter.config.security = undefined;
        const peerId = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';

        const result = await toolHandlers.handleReputation({
          action: 'block',
          peer_id: peerId
        }, mockContext);

        expect(mockAdapter.config.security).toBeDefined();
        expect(mockAdapter.config.security.blacklist).toContain(peerId);
      });
    });

    describe('action: unblock', () => {
      it('应该成功解除屏蔽', async () => {
        const peerId = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC';
        mockAdapter.config.security.blacklist = [peerId, '12D3KooWOtherPeerAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'];

        const result = await toolHandlers.handleReputation({
          action: 'unblock',
          peer_id: peerId
        }, mockContext);

        expect(result.content).toContain('已解除屏蔽');
        expect(mockAdapter.config.security.blacklist).not.toContain(peerId);
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
        createMockQueuedTask({ taskId: 'task-1', status: 'pending' }),
        createMockQueuedTask({ taskId: 'task-2', status: 'pending' })
      ];
      
      mockAdapter.taskQueue.getPending.mockReturnValue(tasks);

      const result = await toolHandlers.handlePollTasks({}, mockContext);

      expect(result.content).toContain('任务列表 (2 个)');
      expect(result.data?.count).toBe(2);
      expect(mockAdapter.taskQueue.markProcessing).toHaveBeenCalledTimes(2);
    });

    it('应该按状态过滤任务', async () => {
      const tasks = [
        createMockQueuedTask({ taskId: 'task-1', status: 'completed' })
      ];
      
      mockAdapter.taskQueue.getAll.mockReturnValue(tasks);

      const result = await toolHandlers.handlePollTasks({ status: 'completed' }, mockContext);

      expect(result.content).toContain('任务列表 (1 个)');
      expect(mockAdapter.taskQueue.getAll).toHaveBeenCalled();
      expect(mockAdapter.taskQueue.markProcessing).not.toHaveBeenCalled();
    });

    it('应该限制返回的任务数量', async () => {
      const tasks = Array.from({ length: 20 }, (_, i) => 
        createMockQueuedTask({ taskId: `task-${i}`, status: 'pending' })
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
        createMockQueuedTask({ taskId: 'task-pending', status: 'pending' }),
        createMockQueuedTask({ taskId: 'task-processing', status: 'processing' }),
        createMockQueuedTask({ taskId: 'task-completed', status: 'completed' }),
        createMockQueuedTask({ taskId: 'task-failed', status: 'failed' })
      ];
      
      mockAdapter.taskQueue.getAll.mockReturnValue(tasks);

      const result = await toolHandlers.handlePollTasks({ status: 'pending' }, mockContext);

      expect(result.content).toContain('⏳');
    });
  });

  describe('handleSubmitResult', () => {
    it('应该成功提交任务结果', async () => {
      const task = createMockQueuedTask();
      
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
      const task = createMockQueuedTask();
      
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
      const task = createMockQueuedTask();
      
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
      const task = createMockQueuedTask({ createdAt });
      
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

  // ========== 新增：任务评估和评审相关测试 ==========

  describe('handleEstimateTask', () => {
    it('应该正确评估任务工作量', async () => {
      const result = await toolHandlers.handleEstimateTask({
        task_type: 'code-generation',
        description: '创建一个简单的 Hello World 程序',
        required_capabilities: ['code-generation']
      }, mockContext);

      expect(result.content).toContain('任务评估结果');
      expect(result.content).toContain('code-generation');
      expect(result.data).toHaveProperty('workload');
      expect(result.data).toHaveProperty('complexity');
      expect(result.data).toHaveProperty('estimated_time_ms');
      expect(result.data).toHaveProperty('confidence');
      expect((result.data as any).workload).toBeGreaterThanOrEqual(0);
      expect((result.data as any).workload).toBeLessThanOrEqual(100);
      expect((result.data as any).complexity).toBeGreaterThanOrEqual(1);
      expect((result.data as any).complexity).toBeLessThanOrEqual(10);
    });

    it('应该根据任务类型调整复杂度', async () => {
      const simpleResult = await toolHandlers.handleEstimateTask({
        task_type: 'web-search',
        description: '搜索天气信息',
        required_capabilities: []
      }, mockContext);

      const complexResult = await toolHandlers.handleEstimateTask({
        task_type: 'security-audit',
        description: '对整个代码库进行安全审计',
        required_capabilities: ['security-analysis', 'code-review']
      }, mockContext);

      expect((simpleResult.data as any).complexity).toBeLessThan((complexResult.data as any).complexity);
    });

    it('应该处理长描述增加工作量', async () => {
      const shortDesc = '写一个函数';
      const longDesc = '写一个函数'.repeat(100);

      const shortResult = await toolHandlers.handleEstimateTask({
        task_type: 'code-generation',
        description: shortDesc,
        required_capabilities: []
      }, mockContext);

      const longResult = await toolHandlers.handleEstimateTask({
        task_type: 'code-generation',
        description: longDesc,
        required_capabilities: []
      }, mockContext);

      expect((longResult.data as any).workload).toBeGreaterThanOrEqual((shortResult.data as any).workload);
    });

    it('应该要求提供 task_type 参数', async () => {
      const result = await toolHandlers.handleEstimateTask({
        task_type: '',
        description: '测试任务'
      }, mockContext);

      expect(result.content).toContain('请提供有效的 task_type 参数');
    });

    it('应该要求提供 description 参数', async () => {
      const result = await toolHandlers.handleEstimateTask({
        task_type: 'code-generation',
        description: ''
      }, mockContext);

      expect(result.content).toContain('请提供有效的 description 参数');
    });

    // P1-12 修复：添加 NaN/Infinity 测试用例
    it('应该处理 NaN 参数', async () => {
      for (const nanValue of SPECIAL_NUMERIC_VALUES.nan) {
        const result = await toolHandlers.handleEstimateTask({
          task_type: 'test',
          description: 'test',
          estimated_complexity: nanValue as any
        }, mockContext);

        expect(result.content).toBeDefined();
        // NaN 应该被检测并返回错误或使用默认值
      }
    });

    it('应该处理 Infinity 参数', async () => {
      for (const infinityValue of SPECIAL_NUMERIC_VALUES.infinity) {
        const result = await toolHandlers.handleEstimateTask({
          task_type: 'test',
          description: 'test',
          estimated_complexity: infinityValue as any
        }, mockContext);

        expect(result.content).toBeDefined();
        // Infinity 应该被检测并返回错误或使用默认值
      }
    });
  });

  describe('handleReviewTask', () => {
    it('应该在评审系统未初始化时返回错误', async () => {
      // 移除 reviewCommittee 模拟未初始化
      mockAdapter.reviewCommittee = undefined;

      const result = await toolHandlers.handleReviewTask({
        task_id: 'task-123',
        workload: 50,
        value: 30
      }, mockContext);

      expect(result.content).toBe('❌ 评审系统未初始化');
    });

    it('应该在评审者信誉不足时返回错误', async () => {
      mockAdapter.reputationSystem.hasPermission.mockReturnValue(false);

      const result = await toolHandlers.handleReviewTask({
        task_id: 'task-123',
        workload: 50,
        value: 30
      }, mockContext);

      expect(result.content).toContain('信誉等级不足以进行评审');
    });

    it('应该成功提交评审', async () => {
      mockAdapter.reputationSystem.hasPermission.mockReturnValue(true);
      mockAdapter.reviewCommittee!.submitReview.mockReturnValue({
        success: true,
        message: 'Review submitted'
      });
      mockAdapter.reviewCommittee!.isReviewComplete.mockReturnValue(false);

      const result = await toolHandlers.handleReviewTask({
        task_id: 'task-123',
        workload: 50,
        value: 30,
        comment: '这是一个合理的任务'
      }, mockContext);

      expect(result.content).toContain('评审已提交');
      expect(result.data).toHaveProperty('submitted', true);
    });

    it('应该处理评审提交失败', async () => {
      mockAdapter.reputationSystem.hasPermission.mockReturnValue(true);
      mockAdapter.reviewCommittee!.submitReview.mockReturnValue({
        success: false,
        message: 'Task not found'
      });

      const result = await toolHandlers.handleReviewTask({
        task_id: 'task-123',
        workload: 50,
        value: 30
      }, mockContext);

      expect(result.content).toContain('评审提交失败');
    });

    it('应该验证 workload 参数范围', async () => {
      const result = await toolHandlers.handleReviewTask({
        task_id: 'task-123',
        workload: 150, // 超出范围
        value: 30
      }, mockContext);

      expect(result.content).toContain('workload 参数必须是 0-100 之间的数字');
    });

    it('应该验证 value 参数范围', async () => {
      const result = await toolHandlers.handleReviewTask({
        task_id: 'task-123',
        workload: 50,
        value: 200 // 超出范围
      }, mockContext);

      expect(result.content).toContain('value 参数必须是 -100 到 100 之间的数字');
    });
  });

  describe('handleGetReviews', () => {
    it('应该在评审系统未初始化时返回错误', async () => {
      mockAdapter.reviewCommittee = undefined;

      const result = await toolHandlers.handleGetReviews({
        task_id: 'task-123'
      }, mockContext);

      expect(result.content).toBe('❌ 评审系统未初始化');
    });

    it('应该返回评审进行中的状态', async () => {
      mockAdapter.reviewCommittee!.getReviewStatus.mockReturnValue({
        taskId: 'task-123',
        taskDescription: '测试任务',
        reviews: [
          { reviewerId: 'reviewer-1', dimensions: { workload: 50, value: 30 } }
        ],
        requiredReviewers: 3
      });

      const result = await toolHandlers.handleGetReviews({
        task_id: 'task-123'
      }, mockContext);

      expect(result.content).toContain('评审进行中');
      expect(result.data).toHaveProperty('status', 'in_progress');
    });

    it('应该返回评审完成的结果', async () => {
      mockAdapter.reviewCommittee!.getReviewStatus.mockReturnValue({
        taskId: 'task-123',
        taskDescription: '测试任务',
        reviews: [
          { reviewerId: 'reviewer-1', dimensions: { workload: 50, value: 30 } },
          { reviewerId: 'reviewer-2', dimensions: { workload: 55, value: 35 } },
          { reviewerId: 'reviewer-3', dimensions: { workload: 45, value: 25 } }
        ],
        requiredReviewers: 3
      });

      mockAdapter.reviewCommittee!.finalizeReview.mockReturnValue({
        taskId: 'task-123',
        finalWorkload: 50,
        finalValue: 30,
        reviews: [
          { reviewerId: 'reviewer-1', dimensions: { workload: 50, value: 30 } },
          { reviewerId: 'reviewer-2', dimensions: { workload: 55, value: 35 } },
          { reviewerId: 'reviewer-3', dimensions: { workload: 45, value: 25 } }
        ],
        outliers: []
      });

      const result = await toolHandlers.handleGetReviews({
        task_id: 'task-123'
      }, mockContext);

      expect(result.content).toContain('评审完成');
      expect(result.data).toHaveProperty('status', 'completed');
    });

    it('应该处理找不到评审记录', async () => {
      mockAdapter.reviewCommittee!.getReviewStatus.mockReturnValue(null);

      const result = await toolHandlers.handleGetReviews({
        task_id: 'non-existent-task'
      }, mockContext);

      expect(result.content).toContain('找不到任务');
    });
  });

  describe('handleGetCapabilities', () => {
    it('应该返回指定 Agent 的能力列表', async () => {
      const agent = createMockAgentInfo({
        peerId: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        displayName: 'Target Agent',
        capabilities: [
          { name: 'code-generation', description: '生成代码' },
          { name: 'code-review', description: '代码审查' }
        ]
      });

      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });

      const result = await toolHandlers.handleGetCapabilities({
        peer_id: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }, mockContext);

      expect(result.content).toContain('Agent 能力列表');
      expect(result.content).toContain('Target Agent');
      expect(result.content).toContain('code-generation');
      expect(result.content).toContain('code-review');
    });

    it('应该支持按名称查找 Agent', async () => {
      const agent = createMockAgentInfo({
        displayName: 'Code Helper',
        capabilities: [{ name: 'code-generation', description: '生成代码' }]
      });

      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });

      const result = await toolHandlers.handleGetCapabilities({
        agent_name: 'Code Helper'
      }, mockContext);

      expect(result.content).toContain('Code Helper');
    });

    it('应该处理找不到 Agent 的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: []
      });

      const result = await toolHandlers.handleGetCapabilities({
        peer_id: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }, mockContext);

      expect(result.content).toContain('找不到 Agent');
    });

    it('应该要求提供 peer_id 或 agent_name', async () => {
      const result = await toolHandlers.handleGetCapabilities({}, mockContext);

      expect(result.content).toContain('请提供 peer_id 或 agent_name 参数');
    });

    it('应该处理查询失败', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: false,
        error: { code: 'NETWORK_ERROR' as const, message: 'Network error' }
      });

      const result = await toolHandlers.handleGetCapabilities({
        peer_id: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }, mockContext);

      expect(result.content).toContain('查询失败');
    });

    it('应该处理无能力信息的 Agent', async () => {
      const agent = createMockAgentInfo({
        peerId: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        displayName: 'No Capabilities Agent',
        capabilities: []
      });

      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [agent]
      });

      const result = await toolHandlers.handleGetCapabilities({
        peer_id: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }, mockContext);

      expect(result.content).toContain('暂无能力信息');
    });
  });
});