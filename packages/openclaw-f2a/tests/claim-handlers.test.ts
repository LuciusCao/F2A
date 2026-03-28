/**
 * ClaimHandlers 测试
 * 
 * 测试任务广播和认领相关功能。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClaimHandlers } from '../src/claim-handlers.js';
import type { F2APlugin } from '../src/connector.js';

// 创建模拟适配器
function createMockAdapter() {
  const mockAnnouncementQueue = {
    create: vi.fn(() => ({ announcementId: 'ann-1' })),
    get: vi.fn(() => ({
      announcementId: 'ann-1',
      description: 'Test task',
      taskType: 'test',
      status: 'open',
      claims: [],
      from: 'local',
    })),
    getOpen: vi.fn(() => [
      { announcementId: 'ann-1', description: 'Task 1', taskType: 'test' },
      { announcementId: 'ann-2', description: 'Task 2', taskType: 'test' },
    ]),
    submitClaim: vi.fn(() => ({ claimId: 'claim-1', status: 'pending' })),
    getClaims: vi.fn(() => [
      { claimId: 'claim-1', claimant: 'peer-1', status: 'pending' },
    ]),
    acceptClaim: vi.fn(() => ({ 
      claimId: 'claim-1', 
      claimant: 'peer-1',
      claimantName: 'TestAgent',
      status: 'accepted' 
    })),
    rejectClaim: vi.fn(() => ({ 
      claimId: 'claim-1', 
      claimant: 'peer-1',
      claimantName: 'TestAgent',
      status: 'rejected' 
    })),
    getMyClaims: vi.fn(() => []),
  };

  return {
    announcementQueue: mockAnnouncementQueue,
    config: {},
    api: {
      config: {
        agents: {
          defaults: {
            workspace: '/test/workspace',
          },
        },
      },
    },
  };
}

describe('ClaimHandlers', () => {
  let handlers: ClaimHandlers;
  let mockAdapter: any;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    handlers = new ClaimHandlers(mockAdapter as unknown as F2APlugin);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAnnounce', () => {
    it('应该验证缺少 task_type 参数', async () => {
      const result = await handlers.handleAnnounce({
        task_type: '',
        description: 'Test task',
      });

      expect(result.content).toContain('请提供有效的 task_type');
    });

    it('应该验证缺少 description 参数', async () => {
      const result = await handlers.handleAnnounce({
        task_type: 'test',
        description: '',
      });

      expect(result.content).toContain('请提供有效的 description');
    });

    it('应该验证 estimated_complexity 范围', async () => {
      const result = await handlers.handleAnnounce({
        task_type: 'test',
        description: 'Test',
        estimated_complexity: 15, // 超出范围
      });

      expect(result.content).toContain('estimated_complexity');
    });

    it('应该成功广播任务', async () => {
      const result = await handlers.handleAnnounce({
        task_type: 'code-review',
        description: 'Review my PR',
      });

      expect(mockAdapter.announcementQueue.create).toHaveBeenCalled();
    });
  });

  describe('handleListAnnouncements', () => {
    it('应该返回公告列表', async () => {
      const result = await handlers.handleListAnnouncements({});

      expect(result.content).toContain('Task 1');
    });

    it('应该处理空列表', async () => {
      mockAdapter.announcementQueue.getOpen.mockReturnValue([]);

      const result = await handlers.handleListAnnouncements({});

      expect(result.content).toContain('没有');
    });
  });

  describe('handleClaim', () => {
    it('应该验证缺少 announcement_id', async () => {
      const result = await handlers.handleClaim({
        announcement_id: '',
      });

      expect(result.content).toContain('请提供有效的 announcement_id');
    });

    it('应该成功认领任务', async () => {
      const result = await handlers.handleClaim({
        announcement_id: 'ann-1',
      });

      expect(mockAdapter.announcementQueue.submitClaim).toHaveBeenCalled();
    });
  });

  describe('handleManageClaims', () => {
    it('应该接受认领请求', async () => {
      const result = await handlers.handleManageClaims({
        announcement_id: 'ann-1',
        action: 'accept',
        claim_id: 'claim-1',
      });

      expect(result.content).toContain('已接受认领');
    });

    it('应该拒绝认领请求', async () => {
      const result = await handlers.handleManageClaims({
        announcement_id: 'ann-1',
        action: 'reject',
        claim_id: 'claim-1',
      });

      expect(result.content).toContain('已拒绝认领');
    });

    it('应该验证缺少 claim_id', async () => {
      const result = await handlers.handleManageClaims({
        announcement_id: 'ann-1',
        action: 'accept',
      });

      expect(result.content).toContain('claim_id');
    });
  });

  describe('handleMyClaims', () => {
    it('应该返回我的认领列表', async () => {
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue([
        { claimId: 'claim-1', status: 'pending', announcementId: 'ann-1' },
      ]);

      const result = await handlers.handleMyClaims({});

      expect(result.content).toContain('claim-1');
    });
  });
});