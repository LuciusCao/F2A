/**
 * 技能交换管理器测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkillExchangeManager } from './skill-exchange-manager.js';
import type { SkillDefinition } from '../types/skill-exchange.js';

describe('SkillExchangeManager', () => {
  let manager: SkillExchangeManager;
  let mockSendFn: ReturnType<typeof vi.fn>;
  let mockBroadcastFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSendFn = vi.fn().mockResolvedValue(undefined);
    mockBroadcastFn = vi.fn().mockResolvedValue(undefined);
    manager = new SkillExchangeManager('test-peer', {}, mockSendFn, mockBroadcastFn);
    manager.start();
  });

  afterEach(() => {
    manager.stop();
  });

  describe('技能注册', () => {
    it('应该成功注册技能', () => {
      const skill: SkillDefinition = {
        id: 'echo',
        name: 'echo',
        description: 'Echo back input',
        category: 'transformation',
        proficiency: 4,
        inputSchema: { type: 'object' },
      };

      manager.registerSkill(skill, async (input) => ({ echoed: input.message }));

      const localSkills = manager.getLocalSkills();
      expect(localSkills).toHaveLength(1);
      expect(localSkills[0].id).toBe('echo');
    });

    it('应该触发 skill:registered 事件', () => {
      const eventSpy = vi.fn();
      manager.on('skill:registered', eventSpy);

      manager.registerSkill({
        id: 'test',
        name: 'test',
        description: 'Test',
        category: 'computation',
        proficiency: 3,
        inputSchema: {},
      }, async () => {});

      expect(eventSpy).toHaveBeenCalled();
    });
  });

  describe('技能注销', () => {
    it('应该成功注销技能', () => {
      manager.registerSkill({
        id: 'temp',
        name: 'temp',
        description: 'Temporary',
        category: 'computation',
        proficiency: 1,
        inputSchema: {},
      }, async () => {});

      expect(manager.getLocalSkills()).toHaveLength(1);
      manager.unregisterSkill('temp');
      expect(manager.getLocalSkills()).toHaveLength(0);
    });
  });

  describe('技能发现', () => {
    it('应该广播技能公告', async () => {
      manager.registerSkill({
        id: 'echo',
        name: 'echo',
        description: 'Echo',
        category: 'transformation',
        proficiency: 4,
        inputSchema: {},
      }, async () => {});

      await manager.announceSkills();

      expect(mockBroadcastFn).toHaveBeenCalled();
      const call = mockBroadcastFn.mock.calls[0][0];
      expect(call.type).toBe('SKILL_ANNOUNCE');
      expect(call.payload.skills).toHaveLength(1);
    });

    it('应该处理远程技能公告', () => {
      const eventSpy = vi.fn();
      manager.on('skill:discovered', eventSpy);

      manager.handleAnnounce('remote-peer', {
        peerId: 'remote-peer',
        skills: [{
          id: 'remote-skill',
          name: 'Remote Skill',
          description: 'A remote skill',
          category: 'computation',
          proficiency: 5,
          inputSchema: {},
        }],
        timestamp: Date.now(),
      });

      expect(eventSpy).toHaveBeenCalled();
      expect(manager.getRemoteSkillCount()).toBe(1);
    });

    it('应该忽略自己的公告', () => {
      manager.handleAnnounce('test-peer', {
        peerId: 'test-peer',
        skills: [{
          id: 'self-skill',
          name: 'Self',
          description: 'Own skill',
          category: 'computation',
          proficiency: 3,
          inputSchema: {},
        }],
        timestamp: Date.now(),
      });

      expect(manager.getRemoteSkillCount()).toBe(0);
    });
  });

  describe('技能查找', () => {
    beforeEach(() => {
      manager.registerSkill({
        id: 'code-gen',
        name: 'code-generation',
        description: 'Generate code',
        category: 'generation',
        proficiency: 4,
        inputSchema: {},
      }, async () => {});

      manager.registerSkill({
        id: 'data-analysis',
        name: 'data-analysis',
        description: 'Analyze data',
        category: 'analysis',
        proficiency: 3,
        inputSchema: {},
      }, async () => {});
    });

    it('应该按名称查找技能', () => {
      const results = manager.findSkills({ skillName: 'code' });
      expect(results).toHaveLength(1);
      expect(results[0].local?.name).toBe('code-generation');
    });

    it('应该按分类查找技能', () => {
      const results = manager.findSkills({ category: 'analysis' });
      expect(results).toHaveLength(1);
      expect(results[0].local?.id).toBe('data-analysis');
    });

    it('应该返回所有技能（空查询）', () => {
      const results = manager.findSkills({});
      expect(results).toHaveLength(2);
    });
  });

  describe('技能调用', () => {
    it('应该成功执行本地技能', async () => {
      manager.registerSkill({
        id: 'echo',
        name: 'echo',
        description: 'Echo',
        category: 'transformation',
        proficiency: 4,
        inputSchema: {},
      }, async (input) => ({ echoed: input.message }));

      const result = await manager.invokeSkill('echo', { message: 'hello' });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ echoed: 'hello' });
    });

    it('应该返回错误（技能不存在）', async () => {
      const result = await manager.invokeSkill('non-existent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('应该处理技能执行错误', async () => {
      manager.registerSkill({
        id: 'failing',
        name: 'failing',
        description: 'Always fails',
        category: 'computation',
        proficiency: 1,
        inputSchema: {},
      }, async () => {
        throw new Error('Skill execution failed');
      });

      const result = await manager.invokeSkill('failing', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('failed');
    });

    it('应该触发 skill:invoke_completed 事件', async () => {
      const eventSpy = vi.fn();
      manager.on('skill:invoke_completed', eventSpy);

      manager.registerSkill({
        id: 'test',
        name: 'test',
        description: 'Test',
        category: 'computation',
        proficiency: 2,
        inputSchema: {},
      }, async () => 'result');

      await manager.invokeSkill('test', {});

      expect(eventSpy).toHaveBeenCalledWith(
        expect.any(String),
        true,
        expect.any(Number)
      );
    });
  });

  describe('统计信息', () => {
    it('应该正确统计调用次数', async () => {
      manager.registerSkill({
        id: 'counter',
        name: 'counter',
        description: 'Counter',
        category: 'computation',
        proficiency: 3,
        inputSchema: {},
      }, async () => 1);

      await manager.invokeSkill('counter', {});
      await manager.invokeSkill('counter', {});

      const stats = manager.getStats();
      expect(stats.totalInvokes).toBe(2);
      expect(stats.successfulInvokes).toBe(2);
    });
  });
});