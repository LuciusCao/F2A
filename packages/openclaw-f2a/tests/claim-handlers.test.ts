/**
 * ClaimHandlers 单元测试
 * 测试认领模式处理器的所有方法
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaimHandlers, type ClaimHandlerParams } from '../src/claim-handlers.js';
import type { F2AOpenClawAdapter } from '../src/connector.js';
import type { SessionContext } from '../src/types.js';

// 创建 mock 依赖
const createMockAnnouncementQueue = () => ({
  create: vi.fn(),
  getOpen: vi.fn(),
  get: vi.fn(),
  submitClaim: vi.fn(),
  acceptClaim: vi.fn(),
  rejectClaim: vi.fn(),
  getMyClaims: vi.fn(),
  getStats: vi.fn()
});

const createMockAdapter = () => {
  const announcementQueue = createMockAnnouncementQueue();
  const api = {
    runtime: {
      system: {
        requestHeartbeatNow: vi.fn()
      }
    }
  };
  const config = {
    agentName: 'Test Agent'
  };
  return {
    announcementQueue,
    getAnnouncementQueue: vi.fn(() => announcementQueue),
    api,
    getApi: vi.fn(() => api),
    config,
    getConfig: vi.fn(() => config)
  };
};

// 创建 mock SessionContext
const createMockSessionContext = (): SessionContext => ({
  sessionId: 'test-session-123',
  workspace: '/tmp/test-workspace',
  toJSON: vi.fn(() => ({ sessionId: 'test-session-123', workspace: '/tmp/test-workspace' }))
});

// 创建测试用的广播对象
const createMockAnnouncement = (overrides: any = {}) => ({
  announcementId: 'ann-test-12345678901234567890',
  taskType: 'code-generation',
  description: 'Test task description for announcement',
  from: 'local',
  status: 'open',
  timeout: 300000,
  claims: [],
  ...overrides
});

// 创建测试用的认领对象
const createMockClaim = (overrides: any = {}) => ({
  claimId: 'claim-test-12345678901234567890',
  announcementId: 'ann-test-12345678901234567890',
  claimant: 'local',
  claimantName: 'Test Agent',
  status: 'pending',
  estimatedTime: 60000,
  confidence: 0.8,
  ...overrides
});

describe('ClaimHandlers', () => {
  let claimHandlers: ClaimHandlers;
  let mockAdapter: any;
  let mockContext: SessionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockContext = createMockSessionContext();
    claimHandlers = new ClaimHandlers(mockAdapter as F2AOpenClawAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleAnnounce', () => {
    it('应该成功创建任务广播', async () => {
      const announcement = createMockAnnouncement();
      
      mockAdapter.announcementQueue.create.mockReturnValue(announcement);

      const result = await claimHandlers.handleAnnounce({
        task_type: 'code-generation',
        description: 'Write a function to sort an array'
      }, mockContext);

      expect(result.content).toContain('任务广播已创建');
      expect(result.content).toContain('code-generation');
      expect(result.data?.announcementId).toBe(announcement.announcementId);
      expect(mockAdapter.announcementQueue.create).toHaveBeenCalled();
    });

    it('应该包含所有可选参数', async () => {
      const announcement = createMockAnnouncement({
        requiredCapabilities: ['typescript', 'algorithms'],
        estimatedComplexity: 7,
        reward: 100
      });
      
      mockAdapter.announcementQueue.create.mockReturnValue(announcement);

      const result = await claimHandlers.handleAnnounce({
        task_type: 'code-generation',
        description: 'Complex task',
        required_capabilities: ['typescript', 'algorithms'],
        estimated_complexity: 7,
        reward: 100,
        timeout: 600000
      }, mockContext);

      expect(result.content).toContain('所需能力: typescript, algorithms');
      expect(result.content).toContain('复杂度: 7/10');
      expect(result.content).toContain('奖励: 100');
    });

    it('应该触发心跳通知其他 Agents', async () => {
      const announcement = createMockAnnouncement();
      
      mockAdapter.announcementQueue.create.mockReturnValue(announcement);

      await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'Test task'
      }, mockContext);

      expect(mockAdapter.api.runtime.system.requestHeartbeatNow).toHaveBeenCalled();
    });

    it('应该处理创建广播失败的情况', async () => {
      mockAdapter.announcementQueue.create.mockImplementation(() => {
        throw new Error('Queue is full');
      });

      const result = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'Test task'
      }, mockContext);

      expect(result.content).toContain('创建广播失败');
      expect(result.content).toContain('Queue is full');
    });

    it('应该使用默认超时时间', async () => {
      let capturedParams: any;
      
      mockAdapter.announcementQueue.create.mockImplementation((params) => {
        capturedParams = params;
        return createMockAnnouncement(params);
      });

      await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'Test task'
      }, mockContext);

      expect(capturedParams.timeout).toBe(300000);
    });

    it('应该处理缺少 api.runtime 的情况', async () => {
      mockAdapter.api = null;
      
      const announcement = createMockAnnouncement();
      mockAdapter.announcementQueue.create.mockReturnValue(announcement);

      // 不应该抛出错误
      const result = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'Test task'
      }, mockContext);

      expect(result.content).toContain('任务广播已创建');
    });

    it('应该正确截断长描述', async () => {
      const longDescription = 'A'.repeat(150);
      const announcement = createMockAnnouncement({ description: longDescription });
      
      mockAdapter.announcementQueue.create.mockReturnValue(announcement);

      const result = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: longDescription
      }, mockContext);

      expect(result.content).toContain('...');
    });
  });

  describe('handleListAnnouncements', () => {
    it('应该返回所有开放的任务广播', async () => {
      const announcements = [
        createMockAnnouncement({ announcementId: 'ann-1' }),
        createMockAnnouncement({ announcementId: 'ann-2' })
      ];
      
      mockAdapter.announcementQueue.getOpen.mockReturnValue(announcements);

      const result = await claimHandlers.handleListAnnouncements({}, mockContext);

      expect(result.content).toContain('开放的任务广播 (2 个)');
      expect(result.data?.count).toBe(2);
    });

    it('应该按能力过滤广播', async () => {
      const announcements = [
        createMockAnnouncement({ 
          announcementId: 'ann-1',
          requiredCapabilities: ['typescript'] 
        }),
        createMockAnnouncement({ 
          announcementId: 'ann-2',
          requiredCapabilities: ['python'] 
        })
      ];
      
      mockAdapter.announcementQueue.getOpen.mockReturnValue(announcements);

      const result = await claimHandlers.handleListAnnouncements({
        capability: 'typescript'
      }, mockContext);

      expect(result.data?.count).toBe(1);
      expect(result.data?.announcements[0].announcementId).toBe('ann-1');
    });

    it('应该限制返回数量', async () => {
      const announcements = Array.from({ length: 20 }, (_, i) => 
        createMockAnnouncement({ announcementId: `ann-${i}` })
      );
      
      mockAdapter.announcementQueue.getOpen.mockReturnValue(announcements);

      const result = await claimHandlers.handleListAnnouncements({
        limit: 5
      }, mockContext);

      expect(result.data?.count).toBe(5);
    });

    it('应该处理没有开放广播的情况', async () => {
      mockAdapter.announcementQueue.getOpen.mockReturnValue([]);

      const result = await claimHandlers.handleListAnnouncements({}, mockContext);

      expect(result.content).toBe('📭 当前没有开放的任务广播');
    });

    it('应该显示每个广播的认领数量', async () => {
      const announcements = [
        createMockAnnouncement({ 
          announcementId: 'ann-1',
          claims: [{ claimId: 'claim-1' }, { claimId: 'claim-2' }]
        })
      ];
      
      mockAdapter.announcementQueue.getOpen.mockReturnValue(announcements);

      const result = await claimHandlers.handleListAnnouncements({}, mockContext);

      expect(result.content).toContain('认领: 2');
      expect(result.data?.announcements[0].claimCount).toBe(2);
    });

    it('应该显示复杂度和奖励信息', async () => {
      const announcements = [
        createMockAnnouncement({ 
          estimatedComplexity: 8,
          reward: 500
        })
      ];
      
      mockAdapter.announcementQueue.getOpen.mockReturnValue(announcements);

      const result = await claimHandlers.handleListAnnouncements({}, mockContext);

      expect(result.content).toContain('复杂度: 8/10');
      expect(result.content).toContain('奖励: 500');
    });
  });

  describe('handleClaim', () => {
    it('应该成功认领开放的任务广播', async () => {
      const announcement = createMockAnnouncement();
      const claim = createMockClaim();
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);
      mockAdapter.announcementQueue.submitClaim.mockReturnValue(claim);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test-12345678901234567890'
      }, mockContext);

      expect(result.content).toContain('认领已提交');
      expect(result.data?.claimId).toBe(claim.claimId);
      expect(mockAdapter.announcementQueue.submitClaim).toHaveBeenCalled();
    });

    it('应该包含预计时间和信心指数', async () => {
      const announcement = createMockAnnouncement();
      const claim = createMockClaim({ 
        estimatedTime: 120000, 
        confidence: 0.95 
      });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);
      mockAdapter.announcementQueue.submitClaim.mockReturnValue(claim);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test-123',
        estimated_time: 120000,
        confidence: 0.95
      }, mockContext);

      expect(result.content).toContain('预计时间: 120秒');
      expect(result.content).toContain('信心指数: 95%');
    });

    it('应该处理广播不存在的情况', async () => {
      mockAdapter.announcementQueue.get.mockReturnValue(null);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'non-existent'
      }, mockContext);

      expect(result.content).toContain('找不到广播');
    });

    it('应该处理广播已被认领的情况', async () => {
      const announcement = createMockAnnouncement({ status: 'claimed' });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test'
      }, mockContext);

      expect(result.content).toContain('该广播已被认领');
    });

    it('应该处理广播已过期的情况', async () => {
      const announcement = createMockAnnouncement({ status: 'expired' });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test'
      }, mockContext);

      expect(result.content).toContain('该广播已过期');
    });

    it('应该检测重复认领', async () => {
      const announcement = createMockAnnouncement({
        claims: [{ claimant: 'local', claimId: 'existing-claim' }]
      });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test'
      }, mockContext);

      expect(result.content).toContain('你已经认领过这个广播了');
    });

    it('应该处理认领失败的情况', async () => {
      const announcement = createMockAnnouncement();
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);
      mockAdapter.announcementQueue.submitClaim.mockReturnValue(null);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test'
      }, mockContext);

      expect(result.content).toBe('❌ 认领失败');
    });

    it('应该触发心跳通知发布者', async () => {
      const announcement = createMockAnnouncement();
      const claim = createMockClaim();
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);
      mockAdapter.announcementQueue.submitClaim.mockReturnValue(claim);

      await claimHandlers.handleClaim({
        announcement_id: 'ann-test'
      }, mockContext);

      expect(mockAdapter.api.runtime.system.requestHeartbeatNow).toHaveBeenCalled();
    });
  });

  describe('handleManageClaims', () => {
    describe('action: list', () => {
      it('应该返回广播的所有认领', async () => {
        const announcement = createMockAnnouncement({
          from: 'local',
          claims: [
            createMockClaim({ claimId: 'claim-1', claimantName: 'Agent A' }),
            createMockClaim({ claimId: 'claim-2', claimantName: 'Agent B' })
          ]
        });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'list'
        }, mockContext);

        expect(result.content).toContain('认领列表 (2 个)');
        expect(result.data?.claims).toHaveLength(2);
      });

      it('应该处理没有认领的情况', async () => {
        const announcement = createMockAnnouncement({
          from: 'local',
          claims: []
        });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'list'
        }, mockContext);

        expect(result.content).toBe('📭 暂无认领');
      });

      it('应该显示认领者的预计时间和信心指数', async () => {
        const announcement = createMockAnnouncement({
          from: 'local',
          claims: [
            createMockClaim({ 
              estimatedTime: 180000, 
              confidence: 0.85 
            })
          ]
        });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'list'
        }, mockContext);

        expect(result.content).toContain('预计: 180s');
        expect(result.content).toContain('信心: 85%');
      });
    });

    describe('action: accept', () => {
      it('应该成功接受认领', async () => {
        const announcement = createMockAnnouncement({ from: 'local' });
        const claim = createMockClaim({ status: 'accepted' });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);
        mockAdapter.announcementQueue.acceptClaim.mockReturnValue(claim);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'accept',
          claim_id: 'claim-test'
        }, mockContext);

        expect(result.content).toContain('已接受认领');
        expect(mockAdapter.announcementQueue.acceptClaim).toHaveBeenCalledWith(
          'ann-test',
          'claim-test'
        );
      });

      it('应该要求提供 claim_id', async () => {
        const announcement = createMockAnnouncement({ from: 'local' });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'accept'
        }, mockContext);

        expect(result.content).toBe('❌ accept/reject 操作需要提供 claim_id 参数');
      });

      it('应该处理接受失败的情况', async () => {
        const announcement = createMockAnnouncement({ from: 'local' });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);
        mockAdapter.announcementQueue.acceptClaim.mockReturnValue(null);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'accept',
          claim_id: 'claim-test'
        }, mockContext);

        expect(result.content).toBe('❌ 接受认领失败');
      });
    });

    describe('action: reject', () => {
      it('应该成功拒绝认领', async () => {
        const announcement = createMockAnnouncement({ from: 'local' });
        const claim = createMockClaim({ status: 'rejected' });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);
        mockAdapter.announcementQueue.rejectClaim.mockReturnValue(claim);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'reject',
          claim_id: 'claim-test'
        }, mockContext);

        expect(result.content).toContain('已拒绝认领');
        expect(mockAdapter.announcementQueue.rejectClaim).toHaveBeenCalledWith(
          'ann-test',
          'claim-test'
        );
      });

      it('应该要求提供 claim_id', async () => {
        const announcement = createMockAnnouncement({ from: 'local' });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'reject'
        }, mockContext);

        expect(result.content).toBe('❌ accept/reject 操作需要提供 claim_id 参数');
      });

      it('应该处理拒绝失败的情况', async () => {
        const announcement = createMockAnnouncement({ from: 'local' });
        
        mockAdapter.announcementQueue.get.mockReturnValue(announcement);
        mockAdapter.announcementQueue.rejectClaim.mockReturnValue(null);

        const result = await claimHandlers.handleManageClaims({
          announcement_id: 'ann-test',
          action: 'reject',
          claim_id: 'claim-test'
        }, mockContext);

        expect(result.content).toBe('❌ 拒绝认领失败');
      });
    });

    it('应该处理广播不存在的情况', async () => {
      mockAdapter.announcementQueue.get.mockReturnValue(null);

      const result = await claimHandlers.handleManageClaims({
        announcement_id: 'non-existent',
        action: 'list'
      }, mockContext);

      expect(result.content).toContain('找不到广播');
    });

    it('应该拒绝管理非本机发布的广播', async () => {
      const announcement = createMockAnnouncement({ from: 'remote-peer' });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      const result = await claimHandlers.handleManageClaims({
        announcement_id: 'ann-test',
        action: 'list'
      }, mockContext);

      expect(result.content).toContain('只能管理自己发布的广播');
    });

    it('应该处理未知操作', async () => {
      const announcement = createMockAnnouncement({ from: 'local' });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      const result = await claimHandlers.handleManageClaims({
        announcement_id: 'ann-test',
        action: 'unknown' as any
      }, mockContext);

      expect(result.content).toBe('❌ action 参数必须是 list, accept 或 reject');
    });
  });

  describe('handleMyClaims', () => {
    it('应该返回我的所有认领', async () => {
      const claims = [
        createMockClaim({ claimId: 'claim-1', status: 'pending' }),
        createMockClaim({ claimId: 'claim-2', status: 'accepted' })
      ];
      
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue(claims);
      mockAdapter.announcementQueue.get.mockReturnValue(createMockAnnouncement());

      const result = await claimHandlers.handleMyClaims({}, mockContext);

      expect(result.content).toContain('我的认领 (2 个)');
      expect(result.data?.count).toBe(2);
    });

    it('应该按状态过滤认领', async () => {
      const claims = [
        createMockClaim({ claimId: 'claim-1', status: 'pending' }),
        createMockClaim({ claimId: 'claim-2', status: 'accepted' })
      ];
      
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue(claims);

      const result = await claimHandlers.handleMyClaims({
        status: 'pending'
      }, mockContext);

      expect(result.data?.count).toBe(1);
      expect(result.data?.claims[0].status).toBe('pending');
    });

    it('应该处理没有认领的情况', async () => {
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue([]);

      const result = await claimHandlers.handleMyClaims({}, mockContext);

      expect(result.content).toContain('没有的认领');
    });

    it('应该显示认领状态图标', async () => {
      const claims = [
        createMockClaim({ claimId: 'claim-1', status: 'pending' }),
        createMockClaim({ claimId: 'claim-2', status: 'accepted' }),
        createMockClaim({ claimId: 'claim-3', status: 'rejected' })
      ];
      
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue(claims);
      mockAdapter.announcementQueue.get.mockReturnValue(createMockAnnouncement());

      const result = await claimHandlers.handleMyClaims({ status: 'all' }, mockContext);

      expect(result.content).toContain('⏳');  // pending
      expect(result.content).toContain('✅');  // accepted
      expect(result.content).toContain('❌');  // rejected
    });

    it('应该显示已接受认领的提示', async () => {
      const claims = [
        createMockClaim({ claimId: 'claim-1', status: 'accepted' })
      ];
      
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue(claims);
      mockAdapter.announcementQueue.get.mockReturnValue(createMockAnnouncement());

      const result = await claimHandlers.handleMyClaims({}, mockContext);

      expect(result.content).toContain('可以开始执行');
    });

    it('应该处理特定状态无认领的情况', async () => {
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue([]);

      const result = await claimHandlers.handleMyClaims({
        status: 'accepted'
      }, mockContext);

      expect(result.content).toContain('没有accepted的认领');
    });
  });

  describe('handleAnnouncementStats', () => {
    it('应该返回任务广播统计信息', async () => {
      mockAdapter.announcementQueue.getStats.mockReturnValue({
        open: 5,
        claimed: 3,
        delegated: 2,
        expired: 1,
        total: 11
      });

      const result = await claimHandlers.handleAnnouncementStats({}, mockContext);

      expect(result.content).toContain('开放中: 5');
      expect(result.content).toContain('已认领: 3');
      expect(result.content).toContain('已委托: 2');
      expect(result.content).toContain('已过期: 1');
      expect(result.content).toContain('总计: 11');
      expect(result.data).toEqual({
        open: 5,
        claimed: 3,
        delegated: 2,
        expired: 1,
        total: 11
      });
    });

    it('应该处理空统计的情况', async () => {
      mockAdapter.announcementQueue.getStats.mockReturnValue({
        open: 0,
        claimed: 0,
        delegated: 0,
        expired: 0,
        total: 0
      });

      const result = await claimHandlers.handleAnnouncementStats({}, mockContext);

      expect(result.content).toContain('开放中: 0');
      expect(result.content).toContain('总计: 0');
    });
  });

  describe('边界条件测试', () => {
    it('handleAnnounce 应该拒绝空描述', async () => {
      const result = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: ''
      }, mockContext);

      expect(result.content).toContain('❌ 请提供有效的 description 参数');
    });

    it('handleAnnounce 应该拒绝空任务类型', async () => {
      const result = await claimHandlers.handleAnnounce({
        task_type: '',
        description: 'test description'
      }, mockContext);

      expect(result.content).toContain('❌ 请提供有效的 task_type 参数');
    });

    it('handleAnnounce 应该接受有效的参数', async () => {
      const announcement = createMockAnnouncement({ description: 'valid description' });
      mockAdapter.announcementQueue.create.mockReturnValue(announcement);

      const result = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'valid description'
      }, mockContext);

      expect(result.content).toContain('任务广播已创建');
    });

    it('handleListAnnouncements 应该处理没有 requiredCapabilities 的广播', async () => {
      const announcements = [
        createMockAnnouncement({ requiredCapabilities: undefined })
      ];
      
      mockAdapter.announcementQueue.getOpen.mockReturnValue(announcements);

      const result = await claimHandlers.handleListAnnouncements({}, mockContext);

      expect(result.content).toContain('开放的任务广播');
    });

    it('handleClaim 应该处理缺少 api 的情况', async () => {
      mockAdapter.api = undefined;
      
      const announcement = createMockAnnouncement();
      const claim = createMockClaim();
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);
      mockAdapter.announcementQueue.submitClaim.mockReturnValue(claim);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test'
      }, mockContext);

      expect(result.content).toContain('认领已提交');
    });

    it('handleManageClaims 应该处理空 claims 数组', async () => {
      const announcement = createMockAnnouncement({
        from: 'local',
        claims: undefined
      });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      const result = await claimHandlers.handleManageClaims({
        announcement_id: 'ann-test',
        action: 'list'
      }, mockContext);

      expect(result.content).toBe('📭 暂无认领');
    });

    it('handleMyClaims 应该处理 announcement 不存在的情况', async () => {
      const claims = [createMockClaim()];
      
      mockAdapter.announcementQueue.getMyClaims.mockReturnValue(claims);
      mockAdapter.announcementQueue.get.mockReturnValue(null);

      const result = await claimHandlers.handleMyClaims({}, mockContext);

      // 应该处理 announcement 不存在的情况
      expect(result.content).toContain('我的认领');
    });

    // ========== 新增：输入验证测试 ==========

    it('handleAnnounce 应该拒绝无效的 estimated_complexity', async () => {
      // 超出范围
      const result1 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        estimated_complexity: 15
      }, mockContext);
      expect(result1.content).toContain('estimated_complexity 必须在 1 到 10 之间');

      // 负数
      const result2 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        estimated_complexity: -1
      }, mockContext);
      expect(result2.content).toContain('estimated_complexity 必须在 1 到 10 之间');

      // 非数字
      const result3 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        estimated_complexity: 'high' as any
      }, mockContext);
      expect(result3.content).toContain('estimated_complexity 必须是有效数字');
    });

    it('handleAnnounce 应该拒绝无效的 reward', async () => {
      // 负数
      const result1 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        reward: -100
      }, mockContext);
      expect(result1.content).toContain('reward 不能为负数');

      // 非数字
      const result2 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        reward: 'free' as any
      }, mockContext);
      expect(result2.content).toContain('reward 必须是有效数字');
    });

    it('handleAnnounce 应该拒绝无效的 timeout', async () => {
      // 负数
      const result1 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        timeout: -1000
      }, mockContext);
      expect(result1.content).toContain('timeout 必须大于 0');

      // 超过 24 小时
      const result2 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        timeout: 25 * 60 * 60 * 1000
      }, mockContext);
      expect(result2.content).toContain('timeout 不能超过 24 小时');

      // 非数字
      const result3 = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'test',
        timeout: 'forever' as any
      }, mockContext);
      expect(result3.content).toContain('timeout 必须是有效数字');
    });

    it('handleClaim 应该拒绝无效的 estimated_time', async () => {
      const announcement = createMockAnnouncement();
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      // 负数
      const result1 = await claimHandlers.handleClaim({
        announcement_id: 'ann-test',
        estimated_time: -1000
      }, mockContext);
      expect(result1.content).toContain('estimated_time 必须大于 0');

      // 超过 24 小时
      const result2 = await claimHandlers.handleClaim({
        announcement_id: 'ann-test',
        estimated_time: 25 * 60 * 60 * 1000
      }, mockContext);
      expect(result2.content).toContain('estimated_time 不能超过 24 小时');

      // 非数字
      const result3 = await claimHandlers.handleClaim({
        announcement_id: 'ann-test',
        estimated_time: 'soon' as any
      }, mockContext);
      expect(result3.content).toContain('estimated_time 必须是有效数字');
    });

    it('handleClaim 应该拒绝无效的 confidence', async () => {
      const announcement = createMockAnnouncement();
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);

      // 超过 1
      const result1 = await claimHandlers.handleClaim({
        announcement_id: 'ann-test',
        confidence: 1.5
      }, mockContext);
      expect(result1.content).toContain('confidence 必须在 0 到 1 之间');

      // 负数
      const result2 = await claimHandlers.handleClaim({
        announcement_id: 'ann-test',
        confidence: -0.5
      }, mockContext);
      expect(result2.content).toContain('confidence 必须在 0 到 1 之间');

      // 非数字
      const result3 = await claimHandlers.handleClaim({
        announcement_id: 'ann-test',
        confidence: 'high' as any
      }, mockContext);
      expect(result3.content).toContain('confidence 必须是有效数字');
    });

    it('handleAnnounce 应该接受有效的可选参数', async () => {
      const announcement = createMockAnnouncement({ 
        description: 'valid description',
        estimatedComplexity: 5,
        reward: 100,
        timeout: 60000
      });
      mockAdapter.announcementQueue.create.mockReturnValue(announcement);

      const result = await claimHandlers.handleAnnounce({
        task_type: 'test',
        description: 'valid description',
        estimated_complexity: 5,
        reward: 100,
        timeout: 60000
      }, mockContext);

      expect(result.content).toContain('任务广播已创建');
    });

    it('handleClaim 应该接受有效的可选参数', async () => {
      const announcement = createMockAnnouncement();
      const claim = createMockClaim({ 
        estimatedTime: 60000, 
        confidence: 0.8 
      });
      
      mockAdapter.announcementQueue.get.mockReturnValue(announcement);
      mockAdapter.announcementQueue.submitClaim.mockReturnValue(claim);

      const result = await claimHandlers.handleClaim({
        announcement_id: 'ann-test',
        estimated_time: 60000,
        confidence: 0.8
      }, mockContext);

      expect(result.content).toContain('认领已提交');
    });
  });
});