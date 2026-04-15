/**
 * Agent Registry 测试
 * 测试注册/注销、能力查询、过期清理、并发操作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistry, AgentRegistration, AgentRegistrationRequest, AgentWebhook } from '../core/agent-registry.js';
import type { AgentCapability } from '../types/index.js';

// Mock Logger
vi.mock('../utils/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('AgentRegistry', () => {
  let registry: AgentRegistry;
  const mockPeerId = '12D3KooWTestPeerId12345678';
  const mockSignFunction = (data: string) => `signature-${data}`;

  const createCapability = (name: string, description?: string): AgentCapability => ({
    name,
    description: description || `${name} capability`,
    tools: [],
  });

  const createAgentRegistrationRequest = (
    name: string,
    capabilities: AgentCapability[] = []
  ) => ({
    name,
    capabilities,
    webhook: { url: `http://localhost/${name}` },
    metadata: { version: '1.0' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // 禁用持久化以避免测试间数据污染
    registry = new AgentRegistry(mockPeerId, mockSignFunction, { enablePersistence: false });
  });

  describe('register', () => {
    it('应该成功注册 Agent', () => {
      const request = createAgentRegistrationRequest('Test Agent', [
        createCapability('code-generation'),
      ]);

      const result = registry.register(request);

      expect(result.agentId).toMatch(/^agent:12D3KooWTestPeer:/); // AgentId 格式 (前16位)
      expect(result.name).toBe('Test Agent');
      expect(result.registeredAt).toBeDefined();
      expect(result.lastActiveAt).toBeDefined();
      expect(result.capabilities).toHaveLength(1);
      expect(result.peerId).toBe(mockPeerId);
      expect(result.signature).toBeDefined();
    });

    it('注册时间应该等于最后活跃时间', () => {
      const request = createAgentRegistrationRequest('Agent');

      const result = registry.register(request);

      expect(result.registeredAt.getTime()).toBe(result.lastActiveAt.getTime());
    });

    it('应该支持注册多个 Agent', () => {
      const request1 = createAgentRegistrationRequest('First Agent');
      const request2 = createAgentRegistrationRequest('Second Agent');

      registry.register(request1);
      const result2 = registry.register(request2);

      expect(result2.name).toBe('Second Agent');
      expect(registry.list()).toHaveLength(2);
    });

    it('应该保留 webhook 和 metadata', () => {
      const request = createAgentRegistrationRequest('Agent');
      request.webhook = { url: 'http://example.com/webhook', token: 'secret123' };
      request.metadata = { custom: 'data' };

      const result = registry.register(request);

      expect(result.webhook?.url).toBe('http://example.com/webhook');
      expect(result.webhook?.token).toBe('secret123');
      expect(result.metadata).toEqual({ custom: 'data' });
    });

    it('应该正确处理空能力列表', () => {
      const request = createAgentRegistrationRequest('Agent', []);

      const result = registry.register(request);

      expect(result.capabilities).toHaveLength(0);
    });
  });

  describe('unregister', () => {
    it('应该成功注销已注册的 Agent', () => {
      const request = createAgentRegistrationRequest('Agent');
      const registration = registry.register(request);

      const result = registry.unregister(registration.agentId);

      expect(result).toBe(true);
      expect(registry.list()).toHaveLength(0);
    });

    it('注销不存在 Agent 应返回 false', () => {
      const result = registry.unregister('non-existent');

      expect(result).toBe(false);
    });

    it('注销后重新注册应该成功', () => {
      const request = createAgentRegistrationRequest('Agent');
      const registration = registry.register(request);
      registry.unregister(registration.agentId);

      registry.register(request);

      expect(registry.list()).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('应该返回已注册的 Agent', () => {
      const request = createAgentRegistrationRequest('Agent');
      const registration = registry.register(request);

      const result = registry.get(registration.agentId);

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
      registry.register(createAgentRegistrationRequest('Agent 1'));
      registry.register(createAgentRegistrationRequest('Agent 2'));
      registry.register(createAgentRegistrationRequest('Agent 3'));

      const result = registry.list();

      expect(result).toHaveLength(3);
    });

    it('空注册表应返回空数组', () => {
      const result = registry.list();

      expect(result).toHaveLength(0);
    });

    it('应该返回 Agent 数组副本', () => {
      registry.register(createAgentRegistrationRequest('Agent'));

      const result = registry.list();
      result.pop();

      expect(registry.list()).toHaveLength(1);
    });
  });

  describe('findByCapability', () => {
    it('应该返回具备指定能力的 Agent', () => {
      registry.register(createAgentRegistrationRequest('Agent 1', [
        createCapability('code-generation'),
        createCapability('file-operation'),
      ]));
      registry.register(createAgentRegistrationRequest('Agent 2', [
        createCapability('data-analysis'),
      ]));
      registry.register(createAgentRegistrationRequest('Agent 3', [
        createCapability('code-generation'),
      ]));

      const result = registry.findByCapability('code-generation');

      expect(result).toHaveLength(2);
      expect(result.every(a => a.capabilities.some(c => c.name === 'code-generation'))).toBe(true);
    });

    it('无匹配能力应返回空数组', () => {
      registry.register(createAgentRegistrationRequest('Agent'));

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
      const request = createAgentRegistrationRequest('Agent');
      const registration = registry.register(request);
      const originalTime = registration.lastActiveAt.getTime();

      // 等待一小段时间确保时间差异
      await new Promise(resolve => setTimeout(resolve, 10));

      registry.updateLastActive(registration.agentId);

      const updated = registry.get(registration.agentId);
      expect(updated?.lastActiveAt.getTime()).toBeGreaterThan(originalTime);
    });

    it('更新不存在的 Agent 应静默忽略', () => {
      registry.updateLastActive('non-existent');
      // 不应该抛出错误
    });
  });

  describe('getStats', () => {
    it('应该返回正确的统计信息', () => {
      registry.register(createAgentRegistrationRequest('Agent 1', [
        createCapability('code-generation'),
        createCapability('file-operation'),
      ]));
      registry.register(createAgentRegistrationRequest('Agent 2', [
        createCapability('code-generation'),
      ]));
      registry.register(createAgentRegistrationRequest('Agent 3'));

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
      const request = createAgentRegistrationRequest('Old Agent');
      registry.register(request);

      // 等待确保时间差异
      await new Promise(resolve => setTimeout(resolve, 100));

      const cleaned = registry.cleanupInactive(50); // 50ms 超时

      expect(cleaned).toBe(1);
      expect(registry.list()).toHaveLength(0);
    });

    it('应该保留活跃 Agent', async () => {
      const request = createAgentRegistrationRequest('Active Agent');
      const registration = registry.register(request);

      // 更新活跃时间
      await new Promise(resolve => setTimeout(resolve, 100));
      registry.updateLastActive(registration.agentId);

      const cleaned = registry.cleanupInactive(50);

      expect(cleaned).toBe(0);
      expect(registry.list()).toHaveLength(1);
    });

    it('应该返回清理数量', async () => {
      registry.register(createAgentRegistrationRequest('Agent 1'));
      registry.register(createAgentRegistrationRequest('Agent 2'));

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
      const requests = Array.from({ length: 10 }, (_, i) =>
        createAgentRegistrationRequest(`Agent ${i}`)
      );

      // 并发注册
      await Promise.all(requests.map(r => Promise.resolve(registry.register(r))));

      expect(registry.list()).toHaveLength(10);
    });

    it('应该支持并发注销', async () => {
      // 注册 10 个 Agent
      const agentIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const registration = registry.register(createAgentRegistrationRequest(`Agent ${i}`));
        agentIds.push(registration.agentId);
      }

      // 并发注销
      await Promise.all(
        agentIds.map(id => Promise.resolve(registry.unregister(id)))
      );

      expect(registry.list()).toHaveLength(0);
    });

    it('应该支持并发更新活跃时间', async () => {
      const request = createAgentRegistrationRequest('Agent');
      const registration = registry.register(request);

      // 并发更新 100 次
      await Promise.all(
        Array.from({ length: 100 }, () =>
          Promise.resolve(registry.updateLastActive(registration.agentId))
        )
      );

      const result = registry.get(registration.agentId);
      expect(result).toBeDefined();
    });

    it('应该支持并发注册和注销', async () => {
      // 注册一些 Agent
      const oldAgentIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const registration = registry.register(createAgentRegistrationRequest(`Agent ${i}`));
        oldAgentIds.push(registration.agentId);
      }

      // 并发执行注册新 Agent 和注销旧 Agent
      const operations = [
        ...Array.from({ length: 5 }, (_, i) =>
          Promise.resolve(registry.register(createAgentRegistrationRequest(`New Agent ${i}`)))
        ),
        ...oldAgentIds.slice(0, 3).map(id =>
          Promise.resolve(registry.unregister(id))
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
        registry.register(createAgentRegistrationRequest(`Agent ${i}`));
      }

      expect(registry.list()).toHaveLength(1000);
      expect(registry.getStats().total).toBe(1000);
    });

    it('应该处理同名 Agent 注册', () => {
      registry.register(createAgentRegistrationRequest('Same Name'));
      registry.register(createAgentRegistrationRequest('Same Name'));

      const result = registry.list();
      expect(result).toHaveLength(2);
      expect(result.every(a => a.name === 'Same Name')).toBe(true);
    });

    it('应该处理大量能力', () => {
      const capabilities = Array.from({ length: 100 }, (_, i) =>
        createCapability(`cap-${i}`)
      );

      registry.register(createAgentRegistrationRequest('Agent', capabilities));

      const stats = registry.getStats();
      expect(Object.keys(stats.capabilities)).toHaveLength(100);
    });
  });
});