/**
 * Tool Handlers 单元测试
 * 
 * 测试 F2A 工具处理器的核心功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolHandlers } from '../src/tool-handlers.js';
import type { F2APlugin } from '../src/connector.js';

// 创建模拟适配器
function createMockAdapter() {
  const mockReputationSystem = {
    getReputation: vi.fn(() => ({ 
      score: 85, 
      history: [],
      successfulTasks: 10,
      failedTasks: 2,
      avgResponseTime: 150,
      lastInteraction: Date.now(),
    })),
    updateReputation: vi.fn(() => true),
    getTopAgents: vi.fn(() => []),
    recordInteraction: vi.fn(),
    getAllReputations: vi.fn(() => []),
    blockPeer: vi.fn(() => true),
    unblockPeer: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };

  const mockNetworkClient = {
    discoverAgents: vi.fn(),
    getConnectedPeers: vi.fn(() => []),
    sendMessage: vi.fn(),
    sendTaskResponse: vi.fn(() => ({ success: true })),
  };

  const mockTaskQueue = {
    getTasks: vi.fn(() => []),
    getPending: vi.fn(() => []),
    getAll: vi.fn(() => []),
    addTask: vi.fn(),
    completeTask: vi.fn(() => true),
    failTask: vi.fn(() => true),
    getTaskById: vi.fn(),
    get: vi.fn(() => ({
      taskId: 'task-1',
      from: '12D3KooW' + 'A'.repeat(44),
      createdAt: Date.now() - 1000,
    })),
    complete: vi.fn(),
    markProcessing: vi.fn(),
    getStats: vi.fn(() => ({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    })),
  };

  const mockAnnouncementQueue = {
    getAnnouncements: vi.fn(() => []),
    addAnnouncement: vi.fn(),
    claimAnnouncement: vi.fn(),
  };

  return {
    reputationSystem: mockReputationSystem,
    networkClient: mockNetworkClient,
    taskQueue: mockTaskQueue,
    announcementQueue: mockAnnouncementQueue,
    config: {
      minReputation: 0,
    },
    api: {
      config: {
        agents: {
          defaults: {
            workspace: '/test/workspace',
          },
        },
      },
    },
    getF2AStatus: () => ({ running: true, peerId: 'test-peer-id' }),
  };
}

describe('ToolHandlers', () => {
  let handlers: ToolHandlers;
  let mockAdapter: any;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    handlers = new ToolHandlers(mockAdapter as unknown as F2APlugin);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handleDiscover', () => {
    it('应该返回发现的 Agents 列表', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: '12D3KooW' + 'A'.repeat(44), displayName: 'Agent1', capabilities: [] },
          { peerId: '12D3KooW' + 'B'.repeat(44), displayName: 'Agent2', capabilities: [] },
        ],
      });

      const result = await handlers.handleDiscover({});

      expect(result.content).toContain('发现');
      expect(result.content).toContain('Agent1');
      expect(result.content).toContain('Agent2');
    });

    it('应该处理没有发现 Agents 的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await handlers.handleDiscover({});

      expect(result.content).toContain('未发现');
    });

    it('应该处理发现失败的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: false,
        error: { message: 'Network error' },
      });

      const result = await handlers.handleDiscover({});

      expect(result.content).toContain('失败');
    });

    it('应该按能力过滤 Agents', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: '12D3KooW' + 'A'.repeat(44), displayName: 'Agent1', capabilities: [{ name: 'code-generation' }] },
        ],
      });

      await handlers.handleDiscover({ capability: 'code-generation' });

      expect(mockAdapter.networkClient.discoverAgents).toHaveBeenCalledWith('code-generation');
    });

    it('应该按最低信誉过滤 Agents', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: '12D3KooW' + 'A'.repeat(44), displayName: 'Agent1', capabilities: [] },
        ],
      });

      await handlers.handleDiscover({ min_reputation: 90 });

      // getReputation 会被调用以检查信誉
      expect(mockAdapter.reputationSystem.getReputation).toHaveBeenCalled();
    });
  });

  describe('handleDelegate', () => {
    it('应该验证缺少 agent 参数', async () => {
      const result = await handlers.handleDelegate({
        agent: '',
        task: 'Test task',
      });

      expect(result.content).toContain('请提供有效的 agent');
    });

    it('应该验证缺少 task 参数', async () => {
      const result = await handlers.handleDelegate({
        agent: 'test-agent',
        task: '',
      });

      expect(result.content).toContain('请提供有效的 task');
    });
  });

  describe('handleReputation', () => {
    it('应该返回指定 Peer 的信誉分数', async () => {
      mockAdapter.reputationSystem.getReputation.mockReturnValue({ 
        score: 90, 
        successfulTasks: 10, 
        failedTasks: 2, 
        avgResponseTime: 150,
        lastInteraction: Date.now(),
      });

      const result = await handlers.handleReputation({
        action: 'view',
        peer_id: '12D3KooW' + 'A'.repeat(44),
      });

      expect(result.content).toContain('90');
    });

    it('应该列出所有 Peers 的信誉', async () => {
      mockAdapter.reputationSystem.getTopAgents.mockReturnValue([
        { peerId: '12D3KooW' + 'A'.repeat(44), reputation: 90 },
        { peerId: '12D3KooW' + 'B'.repeat(44), reputation: 80 },
      ]);

      const result = await handlers.handleReputation({
        action: 'list',
      });

      expect(result.content).toContain('信誉');
    });

    it('应该能够拉黑 Peer', async () => {
      const result = await handlers.handleReputation({
        action: 'block',
        peer_id: '12D3KooW' + 'A'.repeat(44),
      });

      expect(result.content).toContain('屏蔽');
    });

    it('应该能够解除拉黑', async () => {
      const result = await handlers.handleReputation({
        action: 'unblock',
        peer_id: '12D3KooW' + 'A'.repeat(44),
      });

      expect(result.content).toContain('解除');
    });
  });

  describe('handlePollTasks', () => {
    it('应该返回任务列表', async () => {
      mockAdapter.taskQueue.getPending.mockReturnValue([
        { taskId: 'task-1', status: 'pending', description: 'Task 1', from: 'test-peer', taskType: 'test', createdAt: Date.now() },
      ]);

      const result = await handlers.handlePollTasks({});

      expect(result.content).toContain('任务');
    });

    it('应该处理空任务列表', async () => {
      mockAdapter.taskQueue.getPending.mockReturnValue([]);

      const result = await handlers.handlePollTasks({});

      expect(result.content).toContain('没有');
    });

    it('应该按状态过滤任务', async () => {
      mockAdapter.taskQueue.getAll.mockReturnValue([
        { taskId: 'task-1', status: 'pending', description: 'Task 1', from: 'test-peer', taskType: 'test', createdAt: Date.now() },
      ]);

      const result = await handlers.handlePollTasks({ status: 'pending' });

      expect(result.content).toContain('任务');
    });
  });

  describe('handleSubmitResult', () => {
    it('应该成功提交成功结果', async () => {
      const result = await handlers.handleSubmitResult({
        task_id: 'task-1',
        result: 'Success',
        status: 'success',
      });

      expect(result.content).toContain('已提交');
    });

    it('应该提交失败结果', async () => {
      const result = await handlers.handleSubmitResult({
        task_id: 'task-1',
        result: 'Failed',
        status: 'error',
      });

      expect(result.content).toContain('已提交');
    });
  });

  describe('handleEstimateTask', () => {
    it('应该返回任务评估结果', async () => {
      const result = await handlers.handleEstimateTask({
        task_type: 'code-review',
        description: 'Review code',
      });

      expect(result.content).toContain('工作量');
      expect(result.content).toContain('复杂度');
    });
  });

  describe('handleReviewTask', () => {
    it('应该提交任务评审', async () => {
      const result = await handlers.handleReviewTask({
        task_id: 'task-1',
        workload: 50,
        value: 30,
      });

      expect(result.content).toContain('评审');
    });
  });

  describe('handleGetReviews', () => {
    it('应该返回任务评审汇总', async () => {
      const result = await handlers.handleGetReviews({
        task_id: 'task-1',
      });

      expect(result.content).toBeDefined();
    });
  });

  describe('handleGetCapabilities', () => {
    it('应该返回指定 Agent 的能力', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: '12D3KooW' + 'A'.repeat(44), displayName: 'Agent1', capabilities: [{ name: 'code-generation' }] },
        ],
      });

      const result = await handlers.handleGetCapabilities({
        peer_id: '12D3KooW' + 'A'.repeat(44),
      });

      expect(result.content).toBeDefined();
    });

    it('应该处理 Agent 不存在的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await handlers.handleGetCapabilities({
        peer_id: '12D3KooW' + 'X'.repeat(44),
      });

      expect(result.content).toContain('找不到');
    });
  });

  describe('handleTaskStats', () => {
    it('应该返回任务队列统计', async () => {
      mockAdapter.taskQueue.getStats = vi.fn(() => ({
        pending: 5,
        processing: 2,
        completed: 10,
        failed: 1,
      }));

      const result = await handlers.handleTaskStats({});

      expect(result.content).toContain('统计');
    });

    it('应该处理空统计', async () => {
      mockAdapter.taskQueue.getStats = vi.fn(() => ({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      }));

      const result = await handlers.handleTaskStats({});

      expect(result.content).toBeDefined();
    });
  });

  // 追加测试到最后
describe('handleBroadcast', () => {
    it('应该广播任务给所有具备某能力的 Agents', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: '12D3KooW' + 'A'.repeat(44), displayName: 'Agent1' },
          { peerId: '12D3KooW' + 'B'.repeat(44), displayName: 'Agent2' },
        ],
      });
      mockAdapter.networkClient.sendMessage.mockResolvedValue({ success: true });

      const result = await handlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Review code',
      });

      // 验证调用了 discoverAgents
      expect(mockAdapter.networkClient.discoverAgents).toHaveBeenCalled();
    });

    it('应该处理没有 Agents 具备所需能力的情况', async () => {
      mockAdapter.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await handlers.handleBroadcast({
        capability: 'nonexistent-capability',
        task: 'Test task',
      });

      expect(result.content).toContain('未发现');
    });
  });
});