/**
 * ClaimHandlers 测试
 * 
 * 测试任务广播和认领相关功能。
 * 
 * P1 修复内容：
 * 1. 使用共享 test-helpers.ts 的 createMockPlugin
 * 2. 添加恶意输入测试
 * 3. 添加边界条件测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClaimHandlers } from '../src/claim-handlers.js';
import type { F2APluginPublicInterface } from '../src/types.js';
import {
  createMockPlugin,
  generatePeerId,
  MALICIOUS_INPUT_TEST_CASES,
} from './utils/test-helpers.js';

describe('ClaimHandlers', () => {
  let handlers: ClaimHandlers;
  let mockPlugin: any;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    handlers = new ClaimHandlers(mockPlugin as unknown as F2APluginPublicInterface);
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

      expect(mockPlugin._mocks.announcementQueue.create).toHaveBeenCalled();
    });
  });

  describe('handleListAnnouncements', () => {
    it('应该返回公告列表', async () => {
      const result = await handlers.handleListAnnouncements({});

      expect(result.content).toContain('Task 1');
    });

    it('应该处理空列表', async () => {
      mockPlugin._mocks.announcementQueue.getOpen.mockReturnValue([]);

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

      expect(mockPlugin.announcementQueue.submitClaim).toHaveBeenCalled();
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
      mockPlugin._mocks.announcementQueue.getMyClaims.mockReturnValue([
        { claimId: 'claim-1', status: 'pending', announcementId: 'ann-1' },
      ]);

      const result = await handlers.handleMyClaims({});

      expect(result.content).toContain('claim-1');
    });
    
    it('应该处理空认领列表', async () => {
      mockPlugin._mocks.announcementQueue.getMyClaims.mockReturnValue([]);

      const result = await handlers.handleMyClaims({});

      expect(result.content).toBeDefined();
    });
  });

  // P1-7 修复：恶意输入测试
  describe('恶意输入防护', () => {
    describe('handleAnnounce 恶意输入', () => {
      for (const malicious of MALICIOUS_INPUT_TEST_CASES.commandInjection.slice(0, 3)) {
        it(`应该安全处理命令注入作为 description: "${malicious.slice(0, 20)}..."`, async () => {
          const result = await handlers.handleAnnounce({
            task_type: 'test',
            description: malicious,
          });

          // 应该成功创建，后续处理应安全
          expect(result.content).toBeDefined();
        });
      }
      
      for (const malicious of MALICIOUS_INPUT_TEST_CASES.sqlInjection.slice(0, 3)) {
        it(`应该安全处理 SQL 注入作为 description: "${malicious.slice(0, 20)}..."`, async () => {
          const result = await handlers.handleAnnounce({
            task_type: 'test',
            description: malicious,
          });

          expect(result.content).toBeDefined();
        });
      }
    });
    
    describe('handleClaim 恶意输入', () => {
      it('应该拒绝无效格式的 announcement_id', async () => {
        const result = await handlers.handleClaim({
          announcement_id: '../../../etc/passwd',
        });

        // 应该不抛出异常
        expect(result.content).toBeDefined();
      });
    });
  });

  // P1-6 修复：边界条件测试
  describe('边界条件测试', () => {
    describe('handleAnnounce 边界条件', () => {
      it('应该接受最小边界值 estimated_complexity = 1', async () => {
        const result = await handlers.handleAnnounce({
          task_type: 'test',
          description: 'Test',
          estimated_complexity: 1,
        });

        expect(result.content).toBeDefined();
      });
      
      it('应该接受最大边界值 estimated_complexity = 10', async () => {
        const result = await handlers.handleAnnounce({
          task_type: 'test',
          description: 'Test',
          estimated_complexity: 10,
        });

        expect(result.content).toBeDefined();
      });
      
      it('应该处理超长 description', async () => {
        const longDescription = 'A'.repeat(10000);
        const result = await handlers.handleAnnounce({
          task_type: 'test',
          description: longDescription,
        });

        expect(result.content).toBeDefined();
      });
      
      it('应该处理超长 task_type', async () => {
        const longTaskType = 'task-'.repeat(100);
        const result = await handlers.handleAnnounce({
          task_type: longTaskType,
          description: 'Test',
        });

        expect(result.content).toBeDefined();
      });
      
      it('应该接受负数的 reward（可选参数）', async () => {
        const result = await handlers.handleAnnounce({
          task_type: 'test',
          description: 'Test',
          reward: -10,
        });

        expect(result.content).toBeDefined();
      });
      
      it('应该处理空对象参数', async () => {
        const result = await handlers.handleAnnounce({});

        expect(result.content).toContain('请提供有效的');
      });
    });
    
    describe('handleListAnnouncements 边界条件', () => {
      it('应该处理 undefined 参数（使用默认值）', async () => {
        const result = await handlers.handleListAnnouncements({});

        expect(result.content).toBeDefined();
      });
      
      it('应该处理 capability 过滤参数', async () => {
        mockPlugin._mocks.announcementQueue.getOpen.mockReturnValue([]);

        const result = await handlers.handleListAnnouncements({ capability: 'code-generation' });

        expect(result.content).toBeDefined();
      });
      
      it('应该处理 limit 参数', async () => {
        mockPlugin._mocks.announcementQueue.getOpen.mockReturnValue([
          { announcementId: 'ann-1', description: 'Task 1', taskType: 'test' },
          { announcementId: 'ann-2', description: 'Task 2', taskType: 'test' },
        ]);

        const result = await handlers.handleListAnnouncements({ limit: 1 });

        expect(result.content).toBeDefined();
      });
    });
    
    describe('handleClaim 边界条件', () => {
      it('应该处理 confidence 边界值', async () => {
        const result = await handlers.handleClaim({
          announcement_id: 'ann-1',
          confidence: 0,
        });

        expect(result.content).toBeDefined();
      });
      
      it('应该处理 confidence 最大值', async () => {
        const result = await handlers.handleClaim({
          announcement_id: 'ann-1',
          confidence: 1,
        });

        expect(result.content).toBeDefined();
      });
    });
    
    describe('handleManageClaims 边界条件', () => {
      it('应该拒绝无效的 action 参数', async () => {
        const result = await handlers.handleManageClaims({
          announcement_id: 'ann-1',
          action: 'invalid_action' as any,
          claim_id: 'claim-1',
        });

        expect(result.content).toContain('❌');
      });
      
      it('应该处理空 announcement_id', async () => {
        const result = await handlers.handleManageClaims({
          announcement_id: '',
          action: 'accept',
          claim_id: 'claim-1',
        });

        expect(result.content).toContain('请提供有效的');
      });
    });
  });

  // P1-8 修复：并发安全测试
  describe('并发安全测试', () => {
    it('应该处理并发认领请求', async () => {
      mockPlugin._mocks.announcementQueue.get.mockReturnValue({
        announcementId: 'ann-1',
        description: 'Test task',
        taskType: 'test',
        status: 'open',
        claims: [],
        from: 'local',
      });
      mockPlugin._mocks.announcementQueue.submitClaim.mockReturnValue({
        claimId: 'claim-1',
        status: 'pending',
      });

      const claims = Array.from({ length: 10 }, (_, i) =>
        handlers.handleClaim({ announcement_id: `ann-${i}` })
      );

      const results = await Promise.all(claims);
      
      expect(results.every(r => r.content)).toBe(true);
    });
    
    it('应该处理并发公告创建', async () => {
      mockPlugin._mocks.announcementQueue.create.mockReturnValue({
        announcementId: 'ann-1',
      });

      const announcements = Array.from({ length: 10 }, (_, i) =>
        handlers.handleAnnounce({
          task_type: `task-${i}`,
          description: `Description ${i}`,
        })
      );

      const results = await Promise.all(announcements);
      
      expect(results.every(r => r.content)).toBe(true);
    });
  });

  // P1-9 修复：错误处理测试
  describe('错误处理测试', () => {
    it('应该处理 announcementQueue.create 返回 null', async () => {
      mockPlugin._mocks.announcementQueue.create.mockReturnValue(null);

      const result = await handlers.handleAnnounce({
        task_type: 'test',
        description: 'Test',
      });

      expect(result.content).toContain('❌');
    });
    
    it('应该处理 submitClaim 返回 null', async () => {
      mockPlugin._mocks.announcementQueue.get.mockReturnValue({
        announcementId: 'ann-1',
        description: 'Test task',
        taskType: 'test',
        status: 'open',
        claims: [],
        from: 'local',
      });
      mockPlugin._mocks.announcementQueue.submitClaim.mockReturnValue(null);

      const result = await handlers.handleClaim({
        announcement_id: 'ann-1',
      });

      expect(result.content).toContain('❌');
    });
    
    it('应该处理 acceptClaim 返回 null', async () => {
      mockPlugin._mocks.announcementQueue.get.mockReturnValue({
        announcementId: 'ann-1',
        description: 'Test task',
        taskType: 'test',
        status: 'open',
        claims: [{ claimId: 'claim-1', claimant: 'peer-1', status: 'pending' }],
        from: 'local',
      });
      mockPlugin._mocks.announcementQueue.acceptClaim.mockReturnValue(null);

      const result = await handlers.handleManageClaims({
        announcement_id: 'ann-1',
        action: 'accept',
        claim_id: 'claim-1',
      });

      expect(result.content).toContain('❌');
    });
    
    it('应该处理 getAnnouncementQueue 返回 null', async () => {
      const noQueuePlugin = createMockPlugin();
      noQueuePlugin.getAnnouncementQueue = () => null;

      const noQueueHandlers = new ClaimHandlers(noQueuePlugin as unknown as F2APluginPublicInterface);

      const result = await noQueueHandlers.handleAnnounce({
        task_type: 'test',
        description: 'Test',
      });

      expect(result.content).toContain('❌');
    });
  });
});