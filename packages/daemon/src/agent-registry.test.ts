/**
 * Agent Registry 测试 (RFC 003)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry, AgentRegistration, AgentRegistrationRequest } from './agent-registry.js';
import type { AgentCapability } from '@f2a/network';
import { randomBytes } from 'crypto';

// Mock Logger
vi.mock('@f2a/network', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    Logger: vi.fn().mockImplementation(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
  };
});

// 不 mock crypto，使用真实的 randomBytes

describe('AgentRegistry (RFC 003)', () => {
  let registry: AgentRegistry;
  const mockPeerId = '12D3KooWHxWdnxJaCMA4bVcnucEV35j2m6mYpNqZZbQW9zJ9nLVW';
  const mockSignFunction = vi.fn((data: string) => `sig-${data.slice(0, 16)}`);

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new AgentRegistry(mockPeerId, mockSignFunction);
  });

  describe('RFC 003: AgentId 签发', () => {
    it('应该生成正确格式的 AgentId', () => {
      const request = { name: '猫咕噜', capabilities: [{ name: 'chat', version: '1.0.0' }] };
      const registration = registry.register(request);

      expect(registration.agentId).toMatch(/^agent:[a-zA-Z0-9]{16}:[a-f0-9]{8}$/);
    });

    it('应该包含签名', () => {
      const request = { name: 'Agent', capabilities: [] };
      const registration = registry.register(request);

      expect(registration.signature).toBeDefined();
      expect(mockSignFunction).toHaveBeenCalled();
    });

    it('每次注册应该生成不同的 AgentId', () => {
      const reg1 = registry.register({ name: 'Agent1', capabilities: [] });
      const reg2 = registry.register({ name: 'Agent2', capabilities: [] });

      expect(reg1.agentId).not.toBe(reg2.agentId);
    });
  });

  describe('register', () => {
    it('应该成功注册 Agent', () => {
      const request = { name: '猫咕噜', capabilities: [{ name: 'chat', version: '1.0.0' }] };
      const registration = registry.register(request);

      expect(registration.name).toBe('猫咕噜');
      expect(registration.peerId).toBe(mockPeerId);
    });

    it('应该记录注册时间', () => {
      const registration = registry.register({ name: 'Agent', capabilities: [] });
      expect(registration.registeredAt).toBeDefined();
    });
  });

  describe('get', () => {
    it('应该返回注册的 Agent', () => {
      const registration = registry.register({ name: 'Agent', capabilities: [] });
      const found = registry.get(registration.agentId);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Agent');
    });

    it('应该返回 undefined 对于未注册的 AgentId', () => {
      const found = registry.get('agent:not-exist:1234');
      expect(found).toBeUndefined();
    });
  });

  describe('list', () => {
    it('应该返回所有注册的 Agent', () => {
      registry.register({ name: 'Agent1', capabilities: [] });
      registry.register({ name: 'Agent2', capabilities: [] });
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe('unregister', () => {
    it('应该成功注销 Agent', () => {
      const registration = registry.register({ name: 'Agent', capabilities: [] });
      const result = registry.unregister(registration.agentId);
      expect(result).toBe(true);
      expect(registry.get(registration.agentId)).toBeUndefined();
    });
  });

  describe('updateName', () => {
    it('应该成功更新名称', () => {
      const registration = registry.register({ name: '旧名称', capabilities: [] });
      const result = registry.updateName(registration.agentId, '新名称');
      expect(result).toBe(true);
      expect(registry.get(registration.agentId)?.name).toBe('新名称');
    });
  });

  describe('findByCapability', () => {
    it('应该找到具有特定能力的 Agent', () => {
      registry.register({ name: 'Agent1', capabilities: [{ name: 'chat', version: '1.0.0' }] });
      registry.register({ name: 'Agent2', capabilities: [{ name: 'code-gen', version: '1.0.0' }] });
      
      const chatAgents = registry.findByCapability('chat');
      expect(chatAgents).toHaveLength(1);
      expect(chatAgents[0].name).toBe('Agent1');
    });
  });

  describe('getStats', () => {
    it('应该返回正确的统计', () => {
      registry.register({ name: 'Agent1', capabilities: [{ name: 'chat', version: '1.0.0' }] });
      registry.register({ name: 'Agent2', capabilities: [{ name: 'chat', version: '1.0.0' }] });
      
      const stats = registry.getStats();
      expect(stats.total).toBe(2);
      expect(stats.capabilities['chat']).toBe(2);
    });
  });

  describe('cleanupInactive', () => {
    it('应该清理过期的 Agent', async () => {
      const reg1 = registry.register({ name: 'Agent1', capabilities: [] });
      const reg2 = registry.register({ name: 'Agent2', capabilities: [] });
      
      // 修改 reg1 的 lastActiveAt
      reg1.lastActiveAt = new Date(Date.now() - 3600000); // 1小时前
      
      const cleaned = registry.cleanupInactive(1800000); // 30分钟阈值
      expect(cleaned).toBe(1);
      expect(registry.list()).toHaveLength(1);
    });
  });
});
