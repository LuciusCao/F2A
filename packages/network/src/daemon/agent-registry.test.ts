/**
 * Agent Registry 测试
 * 测试注册/注销、能力查询、过期清理、并发操作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistry, AgentRegistration } from './agent-registry.js';
import type { AgentCapability } from '../types/index.js';
import type { AgentIdentity } from '../core/identity/types.js';

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

  // ============================================================================
  // Phase 2 - Part C: 签名验证测试
  // ============================================================================

  describe('签名验证', () => {
    // Mock 验证函数
    const mockVerifyWithNodeKey = vi.fn().mockResolvedValue(true);

    /**
     * 创建带签名的 Agent 注册信息
     * AgentId 格式: agent:<PeerId前16位>:<随机8位>
     */
    const createAgentWithSignature = (
      peerIdPrefix: string, // 必须是 16 位
      randomSuffix: string, // 必须是 8 位
      name: string,
      signature: string,
      nodeId: string,
      capabilities: AgentCapability[] = []
    ): Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'> => ({
      agentId: `agent:${peerIdPrefix}:${randomSuffix}`,
      name,
      capabilities,
      webhookUrl: `http://localhost/agent:${peerIdPrefix}:${randomSuffix}`,
      metadata: { version: '1.0' },
      signature,
      nodeId,
      publicKey: 'validPublicKeyBase64String',
      createdAt: new Date().toISOString(),
    });

    /**
     * 生成有效的 base64 签名
     */
    const generateValidSignature = (): string => {
      // 生成 64 字节的随机签名（Ed25519 签名长度）
      const signatureBytes = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        signatureBytes[i] = Math.floor(Math.random() * 256);
      }
      return Buffer.from(signatureBytes).toString('base64');
    };

    beforeEach(() => {
      vi.clearAllMocks();
      registry = new AgentRegistry();
    });

    // 任务 2.5: 测试签名验证通过场景
    describe('任务 2.5: 签名验证通过场景', () => {
      it('应该成功验证正确格式的 AgentId 和签名', () => {
        // 使用真实的 PeerId 格式（16位字母数字）
        const peerIdPrefix = '12D3KooWABCDEF12'; // 16位 PeerId 前缀
        const randomSuffix = 'XYZ789AB'; // 8位随机后缀
        const nodeId = '12D3KooWABCDEF123456789'; // NodeId 前16位与 AgentId 匹配
        const signature = generateValidSignature();

        const agent = createAgentWithSignature(peerIdPrefix, randomSuffix, 'Test Agent', signature, nodeId);
        registry.register(agent);

        // verifySignature 应返回 true
        const isValid = registry.verifySignature(agent.agentId);
        expect(isValid).toBe(true);
      });

      it('应该验证 AgentId 格式符合 RFC 003 规范', () => {
        const validAgentId = 'agent:12D3KooWABCDEF12:XYZ789AB';
        const signature = generateValidSignature();
        const nodeId = '12D3KooWABCDEF123456789';

        const agent = createAgentWithSignature('12D3KooWABCDEF12', 'XYZ789AB', 'Agent', signature, nodeId);
        registry.register(agent);

        // AgentId 格式应该通过验证
        expect(registry.verifySignature(validAgentId)).toBe(true);
      });

      it('签名验证通过后，消息应该可以正常路由', () => {
        const peerIdPrefix = 'ABCDEFGH12345678'; // 16位 PeerId 前缀
        const nodeId = 'ABCDEFGH123456789'; // NodeId 前16位与 AgentId 匹配
        const signature = generateValidSignature();

        const agent = createAgentWithSignature(peerIdPrefix, 'RANDOM08', 'Router Agent', signature, nodeId);
        registry.register(agent);

        // 验证签名
        expect(registry.verifySignature(agent.agentId)).toBe(true);

        // Agent 应该可以正常查找和路由
        const registered = registry.get(agent.agentId);
        expect(registered).toBeDefined();
        expect(registered?.name).toBe('Router Agent');
      });

      it('应该在注册时验证签名（使用 registerWithVerification）', () => {
        const peerIdPrefix = 'ABCDEFGH12345678'; // 16位 PeerId 前缀
        const nodeId = 'ABCDEFGH123456789'; // NodeId 前16位与 AgentId 匹配
        const signature = generateValidSignature();

        const agent = createAgentWithSignature(peerIdPrefix, 'ABCD1234', 'Verified Agent', signature, nodeId);

        // 使用 registerWithVerification 并启用验证
        const result = registry.registerWithVerification(agent, true);

        expect(result.success).toBe(true);
        expect(result.registration).toBeDefined();
        expect(result.registration?.agentId).toBe(`agent:${peerIdPrefix}:ABCD1234`);
      });

      it('应该在未启用验证时允许无签名注册', () => {
        const peerIdPrefix = 'ABCDEFGH12345678';
        const nodeId = 'ABCDEFGH123456789';

        const agent = createAgentWithSignature(peerIdPrefix, 'ABCD1234', 'Agent', '', nodeId);
        agent.signature = undefined;

        // 不启用验证时，应该允许注册
        const result = registry.registerWithVerification(agent, false);

        expect(result.success).toBe(true);
        expect(result.registration).toBeDefined();
      });
    });

    // 任务 2.6: 测试签名验证失败场景
    describe('任务 2.6: 签名验证失败场景', () => {
      it('应该拒绝签名格式错误（不包含有效 base64）', () => {
        const peerIdPrefix = 'ABCDEFGH12345678'; // 16位 PeerId 前缀
        const nodeId = 'ABCDEFGH123456789';
        const invalidSignature = 'not-valid-base64!!!';

        const agent = createAgentWithSignature(peerIdPrefix, 'ABCD1234', 'Agent', invalidSignature, nodeId);
        registry.register(agent);

        const isValid = registry.verifySignature(agent.agentId);
        expect(isValid).toBe(false);
      });

      it('应该拒绝空签名', () => {
        const peerIdPrefix = 'ABCDEFGH12345678';
        const nodeId = 'ABCDEFGH123456789';

        const agent = createAgentWithSignature(peerIdPrefix, 'ABCD1234', 'Agent', '', nodeId);
        agent.signature = undefined;
        registry.register(agent);

        expect(registry.verifySignature(agent.agentId)).toBe(false);
      });

      it('应该拒绝签名与 agentId 不匹配（NodeId 前缀不匹配）', () => {
        const peerIdPrefix = 'NODEAPREFIX12345'; // Node A 前缀（16位）
        const nodeId = 'NODEBPREFIX123456789'; // Node B（前缀不匹配）
        const signature = generateValidSignature();

        const agent = createAgentWithSignature(peerIdPrefix, 'ABCD1234', 'Forged Agent', signature, nodeId);
        registry.register(agent);

        const isValid = registry.verifySignature(agent.agentId);
        expect(isValid).toBe(false);
      });

      it('应该拒绝未注册 Agent 的签名验证', () => {
        const unregisteredAgentId = 'agent:UNKNOWNPEER123:XYZ12345';

        const isValid = registry.verifySignature(unregisteredAgentId);
        expect(isValid).toBe(false);
      });

      it('应该在 registerWithVerification 中拒绝签名验证失败', () => {
        const peerIdPrefix = 'NODEAPREFIX12345';
        const nodeId = 'NODEBPREFIX123456789';
        const signature = generateValidSignature();

        const agent = createAgentWithSignature(peerIdPrefix, 'ABCD1234', 'Invalid Agent', signature, nodeId);

        const result = registry.registerWithVerification(agent, true);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Signature verification failed');
        expect(registry.list()).toHaveLength(0);
      });

      it('应该拒绝无效的 AgentId 格式（缺少 agent: 前缀）', () => {
        const invalidAgentId = '12D3KooWABCDEF12:XYZ789AB'; // 缺少 'agent:' 前缀
        const signature = generateValidSignature();
        const nodeId = '12D3KooWABCDEF123456789';

        registry.register({
          agentId: invalidAgentId,
          name: 'Bad Format Agent',
          capabilities: [],
          signature,
          nodeId,
        });

        expect(registry.verifySignature(invalidAgentId)).toBe(false);
      });

      it('应该拒绝无效的 AgentId 格式（PeerId 前缀不是 16 位）', () => {
        const invalidAgentId = 'agent:ShortPrefix:XYZ789AB'; // PeerId 前缀不是 16 位
        const signature = generateValidSignature();
        const nodeId = 'ShortPrefixXYZ123456789';

        registry.register({
          agentId: invalidAgentId,
          name: 'Bad Prefix Agent',
          capabilities: [],
          signature,
          nodeId,
        });

        expect(registry.verifySignature(invalidAgentId)).toBe(false);
      });

      it('应该拒绝无效的 AgentId 格式（随机后缀不是 8 位）', () => {
        const invalidAgentId = 'agent:12D3KooWABCDEF12:SHORT'; // 随机后缀不是 8 位
        const signature = generateValidSignature();
        const nodeId = '12D3KooWABCDEF123456789';

        registry.register({
          agentId: invalidAgentId,
          name: 'Bad Suffix Agent',
          capabilities: [],
          signature,
          nodeId,
        });

        expect(registry.verifySignature(invalidAgentId)).toBe(false);
      });
    });

    // 任务 2.7: 测试伪造 AgentId 场景
    describe('任务 2.7: 伪造 AgentId 场景', () => {
      it('应该拒绝伪造的 AgentId（尝试注册其他 peerId 前缀）', () => {
        const victimPeerIdPrefix = 'VICTIMPREFIX16'; // 16位受害者前缀
        const attackerNodeId = 'ATTACKPREFIX16XYZ'; // 攻击者的 NodeId（前缀不匹配）
        const forgedSignature = generateValidSignature();

        const forgedAgent = createAgentWithSignature(
          victimPeerIdPrefix,
          'FORGED12',
          'Forged Agent',
          forgedSignature,
          attackerNodeId
        );

        registry.register(forgedAgent);

        expect(registry.verifySignature(forgedAgent.agentId)).toBe(false);
      });

      it('应该拒绝使用伪造签名的 Agent 注册', () => {
        const peerIdPrefix = 'ABCDEFGH12345678';
        const nodeId = 'ABCDEFGH123456789';
        const forgedSignature = 'FORGED_SIGNATURE_NOT_VALID_BASE64';

        const agent = createAgentWithSignature(peerIdPrefix, 'ABCD1234', 'Agent', forgedSignature, nodeId);

        const result = registry.registerWithVerification(agent, true);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Signature verification failed');
      });

      it('应该拒绝尝试冒充其他 Node 的 Agent', () => {
        const nodeAPeerIdPrefix = 'NODEAPREFIX12345';
        const attackerNodeId = 'NODEBPREFIX123456789';

        const agent = createAgentWithSignature(
          nodeAPeerIdPrefix,
          'ABCD1234',
          'Impersonated Agent',
          generateValidSignature(),
          attackerNodeId
        );

        registry.register(agent);

        expect(registry.verifySignature(agent.agentId)).toBe(false);
      });

      it('应该拒绝尝试使用受害者签名注册攻击者的 AgentId', () => {
        const victimPeerIdPrefix = 'VICTIMPREFIX16';
        const victimNodeId = 'VICTIMPREFIX16XYZ';
        const attackerPeerIdPrefix = 'ATTACKPREFIX16';
        const stolenSignature = generateValidSignature();

        const agent = createAgentWithSignature(
          attackerPeerIdPrefix,
          'ABCD1234',
          'Attacker Agent',
          stolenSignature,
          victimNodeId
        );

        registry.register(agent);

        expect(registry.verifySignature(agent.agentId)).toBe(false);
      });

      it('应该在批量注册时验证所有 AgentId', () => {
        const validPeerIdPrefix = 'ABCDEFGH12345678';
        const validNodeId = 'ABCDEFGH123456789';
        const invalidPeerIdPrefix = 'INVALIDPREFIX1AB'; // 16位

        const validAgent = createAgentWithSignature(validPeerIdPrefix, 'VALID001', 'Valid Agent', generateValidSignature(), validNodeId);
        const invalidAgent = createAgentWithSignature(invalidPeerIdPrefix, 'INVALID02', 'Invalid Agent', generateValidSignature(), validNodeId);

        registry.register(validAgent);
        registry.register(invalidAgent);

        expect(registry.verifySignature(validAgent.agentId)).toBe(true);
        expect(registry.verifySignature(invalidAgent.agentId)).toBe(false);
      });

      it('应该防止 AgentId 前缀注入攻击', () => {
        const maliciousAgentIds = [
          'agent:PeerId16:Random8:extra',
          'agent:PeerId16:Random8/../..',
          'agent:PeerId16:Random8%00',
          'agent::PeerId16:Random8',
        ];

        for (const maliciousId of maliciousAgentIds) {
          registry.register({
            agentId: maliciousId,
            name: 'Malicious Agent',
            capabilities: [],
            signature: generateValidSignature(),
            nodeId: 'PeerId16AB123456789',
          });

          expect(registry.verifySignature(maliciousId)).toBe(false);
        }
      });
    });

    // 异步验证测试
    describe('异步签名验证', () => {
      it('应该支持异步验证 AgentIdentity', async () => {
        const mockVerify = vi.fn().mockResolvedValue(true);
        const registryWithVerify = new AgentRegistry({ verifyWithNodeKey: mockVerify });

        const agentIdentity: AgentIdentity = {
          id: 'agent-test-id',
          name: 'Test Agent',
          capabilities: ['test'],
          nodeId: 'node-test-id',
          publicKey: 'publicKeyBase64',
          signature: 'signatureBase64',
          createdAt: new Date().toISOString(),
        };

        const isValid = await registryWithVerify.verifyAgentIdentity(agentIdentity);
        expect(isValid).toBe(true);
        expect(mockVerify).toHaveBeenCalled();
      });

      it('应该在无验证函数时返回 false', async () => {
        const agentIdentity: AgentIdentity = {
          id: 'agent-test-id',
          name: 'Test Agent',
          capabilities: ['test'],
          nodeId: 'node-test-id',
          publicKey: 'publicKeyBase64',
          signature: 'signatureBase64',
          createdAt: new Date().toISOString(),
        };

        const isValid = await registry.verifyAgentIdentity(agentIdentity);
        expect(isValid).toBe(false);
      });

      it('应该处理验证函数抛出异常', async () => {
        const mockVerifyError = vi.fn().mockRejectedValue(new Error('Verification error'));
        const registryWithError = new AgentRegistry({ verifyWithNodeKey: mockVerifyError });

        const agentIdentity: AgentIdentity = {
          id: 'agent-test-id',
          name: 'Test Agent',
          capabilities: ['test'],
          nodeId: 'node-test-id',
          publicKey: 'publicKeyBase64',
          signature: 'signatureBase64',
          createdAt: new Date().toISOString(),
        };

        const isValid = await registryWithError.verifyAgentIdentity(agentIdentity);
        expect(isValid).toBe(false);
      });

      it('应该支持动态设置验证函数', async () => {
        const mockVerify = vi.fn().mockResolvedValue(true);

        registry.setVerifyFunction(mockVerify);

        const agentIdentity: AgentIdentity = {
          id: 'agent-test-id',
          name: 'Test Agent',
          capabilities: ['test'],
          nodeId: 'node-test-id',
          publicKey: 'publicKeyBase64',
          signature: 'signatureBase64',
          createdAt: new Date().toISOString(),
        };

        const isValid = await registry.verifyAgentIdentity(agentIdentity);
        expect(isValid).toBe(true);
      });
    });
  });
});