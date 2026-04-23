/**
 * Agent Registry 测试 (RFC 003 & RFC 008)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistry, AgentRegistration, AgentRegistrationRequest, RFC008AgentRegistrationRequest } from './agent-registry.js';
import type { AgentCapability } from '@f2a/network';
import { randomBytes } from 'crypto';
import { generateAgentId } from '@f2a/network';

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

describe('AgentRegistry', () => {
  let registry: AgentRegistry;
  const mockPeerId = '12D3KooWHxWdnxJaCMA4bVcnucEV35j2m6mYpNqZZbQW9zJ9nLVW';
  const mockSignFunction = vi.fn((data: string) => `sig-${data.slice(0, 16)}`);

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new AgentRegistry(mockPeerId, mockSignFunction);
  });

  describe('RFC 003: AgentId 签发', () => {
    it('应该生成正确格式的 AgentId', () => {
      const request = { name: '猫咕噜', capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }] };
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
      const request = { name: '猫咕噜', capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }] };
      const registration = registry.register(request);

      expect(registration.name).toBe('猫咕噜');
      expect(registration.nodeId).toBe(mockPeerId);
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
      registry.register({ name: 'Agent1', capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }] });
      registry.register({ name: 'Agent2', capabilities: [{ name: 'code-gen', description: 'code-gen capability', tools: [] }] });
      
      const chatAgents = registry.findByCapability('chat');
      expect(chatAgents).toHaveLength(1);
      expect(chatAgents[0].name).toBe('Agent1');
    });
  });

  describe('getStats', () => {
    it('应该返回正确的统计', () => {
      registry.register({ name: 'Agent1', capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }] });
      registry.register({ name: 'Agent2', capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }] });
      
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

  describe('restore (Phase 6)', () => {
    it('should restore RFC003 (old format) agent from identity', () => {
      // agentId 的 peerId 前缀需要匹配 mockPeerId 的前 16 位（旧格式）
      const peerIdPrefix = mockPeerId.slice(0, 16); // '12D3KooWHxWdnxJ'
      const identity = {
        agentId: `agent:${peerIdPrefix}:12345678`,
        name: 'Restored Agent',
        peerId: mockPeerId,
        signature: 'mock-signature',
        webhook: { url: 'http://127.0.0.1:9002/f2a/webhook' },
        capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-01T00:00:00Z',
      };

      const restored = registry.restore(identity);

      expect(restored.agentId).toBe(identity.agentId);
      expect(restored.name).toBe(identity.name);
      expect(restored.nodeId).toBe(mockPeerId);
      expect(restored.idFormat).toBe('old');
      expect(registry.get(identity.agentId)).toBeDefined();
      expect(registry.get(identity.agentId)?.name).toBe(identity.name);
    });

    it('should restore agent with metadata', () => {
      const peerIdPrefix = mockPeerId.slice(0, 16);
      const identity = {
        agentId: `agent:${peerIdPrefix}:abc12345`,
        name: 'Agent with Metadata',
        nodeId: mockPeerId,
        signature: 'mock-signature',
        capabilities: [],
        metadata: { platform: 'OpenClaw', version: '1.0' },
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-01T00:00:00Z',
      };

      const restored = registry.restore(identity);

      expect(restored.metadata).toEqual(identity.metadata);
    });

    it('should restore multiple agents from identities', () => {
      const peerIdPrefix = mockPeerId.slice(0, 16);
      const identity1 = {
        agentId: `agent:${peerIdPrefix}:11111111`,
        name: 'Agent 1',
        nodeId: mockPeerId,
        signature: 'sig1',
        capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-01T00:00:00Z',
      };

      const identity2 = {
        agentId: `agent:${peerIdPrefix}:22222222`,
        name: 'Agent 2',
        nodeId: mockPeerId,
        signature: 'sig2',
        capabilities: [{ name: 'code-gen', description: 'code-gen capability', tools: [] }],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-01T00:00:00Z',
      };

      registry.restore(identity1);
      registry.restore(identity2);

      expect(registry.size()).toBe(2);
      expect(registry.findByCapability('chat')).toHaveLength(1);
      expect(registry.findByCapability('code-gen')).toHaveLength(1);
    });
  });

  describe('RFC 008: registerRFC008', () => {
    it('应该使用 publicKey 生成 AgentId', () => {
      const publicKey = randomBytes(32).toString('base64');
      const request: RFC008AgentRegistrationRequest = {
        publicKey,
        name: 'RFC008 Agent',
        capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }],
      };

      const registration = registry.registerRFC008(request);

      // AgentId 应该是 publicKey 的指纹
      const expectedAgentId = generateAgentId(publicKey);
      expect(registration.agentId).toBe(expectedAgentId);
      expect(registration.idFormat).toBe('new');
    });

    it('应该存储 publicKey', () => {
      const publicKey = randomBytes(32).toString('base64');
      const request: RFC008AgentRegistrationRequest = {
        publicKey,
        name: 'RFC008 Agent',
        capabilities: [],
      };

      const registration = registry.registerRFC008(request);

      expect(registration.publicKey).toBe(publicKey);
    });

    it('应该生成 nodeSignature 和 nodeId', () => {
      const publicKey = randomBytes(32).toString('base64');
      const request: RFC008AgentRegistrationRequest = {
        publicKey,
        name: 'RFC008 Agent',
        capabilities: [],
      };

      const registration = registry.registerRFC008(request);

      expect(registration.nodeSignature).toBeDefined();
      expect(registration.nodeId).toBe(mockPeerId);
    });

    it('每次注册相同的 publicKey 应该生成相同的 AgentId', () => {
      const publicKey = randomBytes(32).toString('base64');
      
      const request1: RFC008AgentRegistrationRequest = {
        publicKey,
        name: 'Agent 1',
        capabilities: [],
      };
      
      const request2: RFC008AgentRegistrationRequest = {
        publicKey,
        name: 'Agent 2',
        capabilities: [],
      };

      const reg1 = registry.registerRFC008(request1);
      // 第二次注册会覆盖第一个（因为 AgentId 相同）
      const reg2 = registry.registerRFC008(request2);

      expect(reg1.agentId).toBe(reg2.agentId);
    });

    it('应该支持 webhook 配置', () => {
      const publicKey = randomBytes(32).toString('base64');
      const request: RFC008AgentRegistrationRequest = {
        publicKey,
        name: 'RFC008 Agent',
        capabilities: [],
        webhook: { url: 'http://127.0.0.1:9002/webhook', token: 'secret' },
      };

      const registration = registry.registerRFC008(request);

      expect(registration.webhook).toBeDefined();
      expect(registration.webhook?.url).toBe('http://127.0.0.1:9002/webhook');
      expect(registration.webhook?.token).toBe('secret');
    });

    it('应该支持 metadata', () => {
      const publicKey = randomBytes(32).toString('base64');
      const request: RFC008AgentRegistrationRequest = {
        publicKey,
        name: 'RFC008 Agent',
        capabilities: [],
        metadata: { platform: 'OpenClaw', version: '1.0' },
      };

      const registration = registry.registerRFC008(request);

      expect(registration.metadata).toEqual({ platform: 'OpenClaw', version: '1.0' });
    });
  });

  describe('RFC 008: restore with publicKey', () => {
    it('应该恢复 RFC008 格式的 Agent', () => {
      const publicKey = randomBytes(32).toString('base64');
      const agentId = generateAgentId(publicKey);
      
      const identity = {
        agentId,
        name: 'RFC008 Restored Agent',
        publicKey,
        capabilities: [{ name: 'chat', description: 'chat capability', tools: [] }],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-01T00:00:00Z',
      };

      const restored = registry.restore(identity);

      expect(restored.agentId).toBe(agentId);
      expect(restored.publicKey).toBe(publicKey);
      expect(restored.idFormat).toBe('new');
      expect(restored.nodeSignature).toBeDefined();
      expect(restored.nodeId).toBe(mockPeerId);
    });

    it('恢复 RFC008 Agent 应该自动生成 nodeSignature', () => {
      const publicKey = randomBytes(32).toString('base64');
      const agentId = generateAgentId(publicKey);
      
      const identity = {
        agentId,
        name: 'RFC008 Agent without nodeSignature',
        publicKey,
        capabilities: [],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-01T00:00:00Z',
      };

      const restored = registry.restore(identity);

      expect(restored.nodeSignature).toBeDefined();
      expect(mockSignFunction).toHaveBeenCalled();
    });

    it('恢复 RFC008 Agent 应该保留已有的 nodeSignature', () => {
      const publicKey = randomBytes(32).toString('base64');
      const agentId = generateAgentId(publicKey);
      const existingNodeSignature = 'existing-node-signature';
      const existingNodeId = 'existing-node-id';
      
      const identity = {
        agentId,
        name: 'RFC008 Agent with nodeSignature',
        publicKey,
        nodeSignature: existingNodeSignature,
        nodeId: existingNodeId,
        capabilities: [],
        createdAt: '2026-01-01T00:00:00Z',
        lastActiveAt: '2026-01-01T00:00:00Z',
      };

      mockSignFunction.mockClear();
      const restored = registry.restore(identity);

      expect(restored.nodeSignature).toBe(existingNodeSignature);
      expect(restored.nodeId).toBe(existingNodeId);
      // 不应该调用 signFunction，因为已有 nodeSignature
      expect(mockSignFunction).not.toHaveBeenCalled();
    });
  });
});
