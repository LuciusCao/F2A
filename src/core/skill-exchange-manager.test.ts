import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkillExchangeManager } from './skill-exchange-manager.js';
import type { SkillDefinition, SkillQueryPayload, SkillAnnouncePayload } from '../types/skill-exchange.js';

describe('SkillExchangeManager', () => {
  let manager: SkillExchangeManager;
  const mockSendFn = vi.fn();
  const mockBroadcastFn = vi.fn();
  const testPeerId = 'test-peer-123';

  const testSkill: SkillDefinition = {
    id: 'test-skill-1',
    name: 'Test Skill',
    description: 'A test skill',
    category: 'test',
    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { output: { type: 'string' } } },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new SkillExchangeManager(testPeerId, { enableAnnounce: false }, mockSendFn, mockBroadcastFn);
    mockSendFn.mockReset();
    mockBroadcastFn.mockReset();
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  describe('构造函数和生命周期', () => {
    it('应该创建 SkillExchangeManager 实例', () => {
      expect(manager).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const defaultManager = new SkillExchangeManager(testPeerId);
      expect(defaultManager).toBeDefined();
    });

    it('应该正确启动和停止', () => {
      const announceManager = new SkillExchangeManager(
        testPeerId,
        { enableAnnounce: true, announceInterval: 10 },
        mockSendFn,
        mockBroadcastFn
      );
      announceManager.start();
      announceManager.stop();
      // 不应该抛出错误
    });
  });

  describe('本地技能管理', () => {
    it('应该注册技能', () => {
      const handler = vi.fn().mockResolvedValue({ result: 'ok' });
      manager.registerSkill(testSkill, handler);

      const skills = manager.getLocalSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe('test-skill-1');
    });

    it('应该触发 skill:registered 事件', () => {
      const handler = vi.fn();
      const listener = vi.fn();
      manager.on('skill:registered', listener);

      manager.registerSkill(testSkill, handler);
      expect(listener).toHaveBeenCalledWith(testSkill);
    });

    it('应该注销技能', () => {
      const handler = vi.fn();
      manager.registerSkill(testSkill, handler);
      expect(manager.getLocalSkills()).toHaveLength(1);

      manager.unregisterSkill('test-skill-1');
      expect(manager.getLocalSkills()).toHaveLength(0);
    });

    it('应该返回空数组当没有技能时', () => {
      expect(manager.getLocalSkills()).toEqual([]);
    });
  });

  describe('技能发现', () => {
    it('应该广播技能公告', async () => {
      const handler = vi.fn();
      manager.registerSkill(testSkill, handler);

      // 重新创建一个启用公告的管理器
      const announceManager = new SkillExchangeManager(
        testPeerId,
        { enableAnnounce: true, announceInterval: 60 },
        mockSendFn,
        mockBroadcastFn
      );
      announceManager.registerSkill(testSkill, handler);

      await announceManager.announceSkills();

      expect(mockBroadcastFn).toHaveBeenCalled();
      const call = mockBroadcastFn.mock.calls[0][0];
      expect(call.type).toBe('SKILL_ANNOUNCE');
      expect(call.payload.skills).toHaveLength(1);

      announceManager.stop();
    });

    it('不应该广播当没有技能时', async () => {
      await manager.announceSkills();
      expect(mockBroadcastFn).not.toHaveBeenCalled();
    });

    it('不应该广播当没有 broadcastFn 时', async () => {
      const noBroadcastManager = new SkillExchangeManager(testPeerId, {}, mockSendFn);
      const handler = vi.fn();
      noBroadcastManager.registerSkill(testSkill, handler);

      await noBroadcastManager.announceSkills();
      // 不应该抛出错误
    });

    it('应该查询技能', async () => {
      const handler = vi.fn();
      manager.registerSkill(testSkill, handler);

      const queryManager = new SkillExchangeManager(
        testPeerId,
        {},
        mockSendFn,
        mockBroadcastFn
      );

      const query: SkillQueryPayload = { skillName: 'test' };
      await queryManager.querySkills(query);

      expect(mockBroadcastFn).toHaveBeenCalled();
      const call = mockBroadcastFn.mock.calls[0][0];
      expect(call.type).toBe('SKILL_QUERY');
    });

    it('应该查找匹配的技能', () => {
      const handler = vi.fn();
      manager.registerSkill(testSkill, handler);

      const results = manager.findSkills({ skillName: 'Test' });
      expect(results).toHaveLength(1);
      expect(results[0].local).toBeDefined();
      expect(results[0].local?.name).toBe('Test Skill');
    });

    it('应该按类别过滤技能', () => {
      const handler = vi.fn();
      manager.registerSkill(testSkill, handler);

      const results = manager.findSkills({ category: 'test' });
      expect(results).toHaveLength(1);

      const noResults = manager.findSkills({ category: 'other' });
      expect(noResults).toHaveLength(0);
    });

    it('应该返回所有技能当查询为空时', () => {
      const handler = vi.fn();
      manager.registerSkill(testSkill, handler);

      const results = manager.findSkills({});
      expect(results).toHaveLength(1);
    });
  });

  describe('技能调用', () => {
    it('应该成功调用本地技能', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'ok' });
      manager.registerSkill(testSkill, handler);

      const result = await manager.invokeSkill('test-skill-1', { input: 'test' });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ result: 'ok' });
      expect(handler).toHaveBeenCalledWith({ input: 'test' }, expect.any(Object));
    });

    it('应该返回错误当技能不存在时', async () => {
      const result = await manager.invokeSkill('non-existent', { input: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
    });

    it('应该处理技能执行错误', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Execution failed'));
      manager.registerSkill(testSkill, handler);

      const result = await manager.invokeSkill('test-skill-1', { input: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution failed');
    });

    it('应该触发 skill:invoke_completed 事件', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'ok' });
      manager.registerSkill(testSkill, handler);

      const listener = vi.fn();
      manager.on('skill:invoke_completed', listener);

      await manager.invokeSkill('test-skill-1', { input: 'test' });

      expect(listener).toHaveBeenCalled();
      const [invokeId, success, durationMs] = listener.mock.calls[0];
      expect(invokeId).toContain('invoke-');
      expect(success).toBe(true);
      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('应该更新统计信息', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'ok' });
      manager.registerSkill(testSkill, handler);

      await manager.invokeSkill('test-skill-1', { input: 'test' });

      const stats = manager.getStats();
      expect(stats.totalInvokes).toBe(1);
      expect(stats.successfulInvokes).toBe(1);
      expect(stats.failedInvokes).toBe(0);
    });

    it('应该统计失败调用', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      manager.registerSkill(testSkill, handler);

      await manager.invokeSkill('test-skill-1', { input: 'test' });

      const stats = manager.getStats();
      expect(stats.totalInvokes).toBe(1);
      expect(stats.successfulInvokes).toBe(0);
      expect(stats.failedInvokes).toBe(1);
    });
  });

  describe('消息处理', () => {
    it('应该处理技能公告', () => {
      const listener = vi.fn();
      manager.on('skill:discovered', listener);

      const payload: SkillAnnouncePayload = {
        peerId: 'remote-peer',
        skills: [testSkill],
        timestamp: Date.now(),
        ttl: 300,
      };

      manager.handleAnnounce('remote-peer', payload);

      expect(listener).toHaveBeenCalledWith('remote-peer', testSkill);
      expect(manager.getRemoteSkillCount()).toBe(1);
    });

    it('应该忽略自己的公告', () => {
      const listener = vi.fn();
      manager.on('skill:discovered', listener);

      const payload: SkillAnnouncePayload = {
        peerId: testPeerId,
        skills: [testSkill],
        timestamp: Date.now(),
        ttl: 300,
      };

      manager.handleAnnounce(testPeerId, payload);

      expect(listener).not.toHaveBeenCalled();
      expect(manager.getRemoteSkillCount()).toBe(0);
    });

    it('应该更新已存在的远程技能', () => {
      const payload1: SkillAnnouncePayload = {
        peerId: 'remote-peer',
        skills: [testSkill],
        timestamp: Date.now() - 1000,
        ttl: 300,
      };
      manager.handleAnnounce('remote-peer', payload1);

      const payload2: SkillAnnouncePayload = {
        peerId: 'remote-peer',
        skills: [testSkill],
        timestamp: Date.now(),
        ttl: 300,
      };
      manager.handleAnnounce('remote-peer', payload2);

      // 应该只有一个远程技能（更新而非添加）
      expect(manager.getRemoteSkillCount()).toBe(1);
    });

    it('应该查找远程技能', () => {
      // 先注册本地技能
      const handler = vi.fn();
      manager.registerSkill(testSkill, handler);

      const payload: SkillAnnouncePayload = {
        peerId: 'remote-peer',
        skills: [testSkill],
        timestamp: Date.now(),
        ttl: 300,
      };
      manager.handleAnnounce('remote-peer', payload);

      const results = manager.findSkills({ skillName: 'Test' });
      expect(results).toHaveLength(2); // 本地 + 远程
      expect(results.find(r => r.remote)).toBeDefined();
      expect(results.find(r => r.local)).toBeDefined();
    });
  });

  describe('统计和状态', () => {
    it('应该返回初始统计', () => {
      const stats = manager.getStats();
      expect(stats.totalInvokes).toBe(0);
      expect(stats.successfulInvokes).toBe(0);
      expect(stats.failedInvokes).toBe(0);
      expect(stats.totalExecutionTimeMs).toBe(0);
    });

    it('应该返回远程技能数量', () => {
      expect(manager.getRemoteSkillCount()).toBe(0);
    });
  });

  describe('定时公告', () => {
    it('应该定期广播技能', async () => {
      const handler = vi.fn().mockResolvedValue({ result: 'ok' });

      const announceManager = new SkillExchangeManager(
        testPeerId,
        { enableAnnounce: true, announceInterval: 1 }, // 1秒间隔
        mockSendFn,
        mockBroadcastFn
      );
      announceManager.registerSkill(testSkill, handler);
      announceManager.start();

      // 初始公告在 start 时触发
      await vi.advanceTimersByTimeAsync(100);

      // 等待初始广播
      expect(mockBroadcastFn.mock.calls.length).toBeGreaterThanOrEqual(1);

      announceManager.stop();
    });
  });
});