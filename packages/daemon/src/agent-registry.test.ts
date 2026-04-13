/**
 * Agent Registry 测试
 * 测试注册/注销、能力查询、过期清理、并发操作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistry, AgentRegistration } from './agent-registry.js';
import type { AgentCapability } from '@f2a/network';

// Mock Logger
vi.mock('@f2a/network', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  const createCapability = (name: string, description?: string): AgentCapability => ({
    name,
    description: description || `${name} capability`,
    tools: [],
  });

  const createAgentRegistration = (
    agentId: string,
    name: string,
    capabilities: AgentCapability[] = []
  ): Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'> => ({
    agentId,
    name,
    capabilities,
    webhookUrl: `http://localhost/${agentId}`,
    metadata: { version: '1.0' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new AgentRegistry();
  });

  describe('register', () => {
    it('应该成功注册 Agent', () => {
      const agent = createAgentRegistration('agent-1', 'Test Agent', [
        createCapability('code-generation'),
      ]);

      const result = registry.register(agent);

      expect(result.agentId).toBe('agent-1');
      expect(result.name).toBe('Test Agent');
      expect(result.registeredAt).toBeDefined();
      expect(result.lastActiveAt).toBeDefined();
      expect(result.capabilities).toHaveLength(1);
    });

    it('注册时间应该等于最后活跃时间', () => {
      const agent = createAgentRegistration('agent-2', 'Agent');

      const result = registry.register(agent);

      expect(result.registeredAt.getTime()).toBe(result.lastActiveAt.getTime());
    });

    it('应该覆盖已存在的 Agent', () => {
      const agent1 = createAgentRegistration('agent-1', 'First Agent');
      const agent2 = createAgentRegistration('agent-1', 'Second Agent');

      registry.register(agent1);
      const result = registry.register(agent2);

      expect(result.name).toBe('Second Agent');
      expect(registry.list()).toHaveLength(1);
    });

    it('应该保留 webhookUrl 和 metadata', () => {
      const agent = createAgentRegistration('agent-3', 'Agent');
      agent.webhookUrl = 'http://example.com/webhook';
      agent.metadata = { custom: 'data' };

      const result = registry.register(agent);

      expect(result.webhookUrl).toBe('http://example.com/webhook');
      expect(result.metadata).toEqual({ custom: 'data' });
    });

    it('应该正确处理空能力列表', () => {
      const agent = createAgentRegistration('agent-4', 'Agent', []);

      const result = registry.register(agent);

      expect(result.capabilities).toHaveLength(0);
    });
  });

  describe('unregister', () => {
    it('应该成功注销已注册的 Agent', () => {
      const agent = createAgentRegistration('agent-1', 'Agent');
      registry.register(agent);

      const result = registry.unregister('agent-1');

      expect(result).toBe(true);
      expect(registry.list()).toHaveLength(0);
    });

    it('注销不存在 Agent 应返回 false', () => {
      const result = registry.unregister('non-existent');

      expect(result).toBe(false);
    });

    it('注销后重新注册应该成功', () => {
      const agent = createAgentRegistration('agent-1', 'Agent');
      registry.register(agent);
      registry.unregister('agent-1');

      registry.register(agent);

      expect(registry.list()).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('应该返回已注册的 Agent', () => {
      const agent = createAgentRegistration('agent-1', 'Agent');
      registry.register(agent);

      const result = registry.get('agent-1');

      expect(result).toBeDefined();
      expect(result?.name).toBe('Agent');
    });

    it('查询不存在的 Agent 应返回 undefined', () => {
      const result = registry.get('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('应该返回所有注册的 Agent', () => {
      registry.register(createAgentRegistration('agent-1', 'Agent 1'));
      registry.register(createAgentRegistration('agent-2', 'Agent 2'));
      registry.register(createAgentRegistration('agent-3', 'Agent 3'));

      const result = registry.list();

      expect(result).toHaveLength(3);
    });

    it('空注册表应返回空数组', () => {
      const result = registry.list();

      expect(result).toHaveLength(0);
    });

    it('应该返回 Agent 数组副本', () => {
      registry.register(createAgentRegistration('agent-1', 'Agent'));

      const result = registry.list();
      result.pop();

      expect(registry.list()).toHaveLength(1);
    });
  });

  describe('findByCapability', () => {
    it('应该返回具备指定能力的 Agent', () => {
      registry.register(createAgentRegistration('agent-1', 'Agent 1', [
        createCapability('code-generation'),
        createCapability('file-operation'),
      ]));
      registry.register(createAgentRegistration('agent-2', 'Agent 2', [
        createCapability('data-analysis'),
      ]));
      registry.register(createAgentRegistration('agent-3', 'Agent 3', [
        createCapability('code-generation'),
      ]));

      const result = registry.findByCapability('code-generation');

      expect(result).toHaveLength(2);
      expect(result.map(a => a.agentId)).toContain('agent-1');
      expect(result.map(a => a.agentId)).toContain('agent-3');
    });

    it('无匹配能力应返回空数组', () => {
      registry.register(createAgentRegistration('agent-1', 'Agent'));

      const result = registry.findByCapability('unknown-capability');

      expect(result).toHaveLength(0);
    });

    it('空注册表应返回空数组', () => {
      const result = registry.findByCapability('code-generation');

      expect(result).toHaveLength(0);
    });
  });

  describe('updateLastActive', () => {
    it('应该更新最后活跃时间', async () => {
      const agent = createAgentRegistration('agent-1', 'Agent');
      const registration = registry.register(agent);
      const originalTime = registration.lastActiveAt.getTime();

      // 等待一小段时间确保时间差异
      await new Promise(resolve => setTimeout(resolve, 10));

      registry.updateLastActive('agent-1');

      const updated = registry.get('agent-1');
      expect(updated?.lastActiveAt.getTime()).toBeGreaterThan(originalTime);
    });

    it('更新不存在的 Agent 应静默忽略', () => {
      registry.updateLastActive('non-existent');
      // 不应该抛出错误
    });
  });

  describe('getStats', () => {
    it('应该返回正确的统计信息', () => {
      registry.register(createAgentRegistration('agent-1', 'Agent 1', [
        createCapability('code-generation'),
        createCapability('file-operation'),
      ]));
      registry.register(createAgentRegistration('agent-2', 'Agent 2', [
        createCapability('code-generation'),
      ]));
      registry.register(createAgentRegistration('agent-3', 'Agent 3'));

      const stats = registry.getStats();

      expect(stats.total).toBe(3);
      expect(stats.capabilities['code-generation']).toBe(2);
      expect(stats.capabilities['file-operation']).toBe(1);
    });

    it('空注册表应返回零统计', () => {
      const stats = registry.getStats();

      expect(stats.total).toBe(0);
      expect(Object.keys(stats.capabilities)).toHaveLength(0);
    });
  });

  describe('cleanupInactive', () => {
    it('应该清理过期 Agent', async () => {
      const agent = createAgentRegistration('agent-1', 'Old Agent');
      registry.register(agent);

      // 等待确保时间差异
      await new Promise(resolve => setTimeout(resolve, 100));

      const cleaned = registry.cleanupInactive(50); // 50ms 超时

      expect(cleaned).toBe(1);
      expect(registry.list()).toHaveLength(0);
    });

    it('应该保留活跃 Agent', async () => {
      const agent = createAgentRegistration('agent-1', 'Active Agent');
      registry.register(agent);

      // 更新活跃时间
      await new Promise(resolve => setTimeout(resolve, 100));
      registry.updateLastActive('agent-1');

      const cleaned = registry.cleanupInactive(50);

      expect(cleaned).toBe(0);
      expect(registry.list()).toHaveLength(1);
    });

    it('应该返回清理数量', async () => {
      registry.register(createAgentRegistration('agent-1', 'Agent 1'));
      registry.register(createAgentRegistration('agent-2', 'Agent 2'));

      await new Promise(resolve => setTimeout(resolve, 100));

      const cleaned = registry.cleanupInactive(50);

      expect(cleaned).toBe(2);
    });

    it('空注册表应返回 0', () => {
      const cleaned = registry.cleanupInactive(1000);

      expect(cleaned).toBe(0);
    });
  });

  describe('并发操作', () => {
    it('应该支持并发注册', async () => {
      const registrations = Array.from({ length: 10 }, (_, i) =>
        createAgentRegistration(`agent-${i}`, `Agent ${i}`)
      );

      // 并发注册
      await Promise.all(registrations.map(r => Promise.resolve(registry.register(r))));

      expect(registry.list()).toHaveLength(10);
    });

    it('应该支持并发注销', async () => {
      // 注册 10 个 Agent
      for (let i = 0; i < 10; i++) {
        registry.register(createAgentRegistration(`agent-${i}`, `Agent ${i}`));
      }

      // 并发注销
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          Promise.resolve(registry.unregister(`agent-${i}`))
        )
      );

      expect(registry.list()).toHaveLength(0);
    });

    it('应该支持并发更新活跃时间', async () => {
      const agent = createAgentRegistration('agent-1', 'Agent');
      registry.register(agent);

      // 并发更新 100 次
      await Promise.all(
        Array.from({ length: 100 }, () =>
          Promise.resolve(registry.updateLastActive('agent-1'))
        )
      );

      const result = registry.get('agent-1');
      expect(result).toBeDefined();
    });

    it('应该支持并发注册和注销', async () => {
      // 注册一些 Agent
      for (let i = 0; i < 5; i++) {
        registry.register(createAgentRegistration(`agent-${i}`, `Agent ${i}`));
      }

      // 并发执行注册新 Agent 和注销旧 Agent
      const operations = [
        ...Array.from({ length: 5 }, (_, i) =>
          Promise.resolve(registry.register(createAgentRegistration(`new-agent-${i}`, `New Agent ${i}`)))
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          Promise.resolve(registry.unregister(`agent-${i}`))
        ),
      ];

      await Promise.all(operations);

      // 最终应该有 5 - 3 + 5 = 7 个 Agent
      expect(registry.list()).toHaveLength(7);
    });
  });

  describe('边界情况', () => {
    it('应该处理大量 Agent 注册', () => {
      for (let i = 0; i < 1000; i++) {
        registry.register(createAgentRegistration(`agent-${i}`, `Agent ${i}`));
      }

      expect(registry.list()).toHaveLength(1000);
      expect(registry.getStats().total).toBe(1000);
    });

    it('应该处理同名 Agent 注册', () => {
      registry.register(createAgentRegistration('agent-1', 'Same Name'));
      registry.register(createAgentRegistration('agent-2', 'Same Name'));

      const result = registry.list();
      expect(result).toHaveLength(2);
      expect(result.every(a => a.name === 'Same Name')).toBe(true);
    });

    it('应该处理大量能力', () => {
      const capabilities = Array.from({ length: 100 }, (_, i) =>
        createCapability(`cap-${i}`)
      );

      registry.register(createAgentRegistration('agent-1', 'Agent', capabilities));

      const stats = registry.getStats();
      expect(Object.keys(stats.capabilities)).toHaveLength(100);
    });
  });
});