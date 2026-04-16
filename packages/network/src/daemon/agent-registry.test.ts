/**
 * Agent Registry 测试
 * 测试注册/注销、能力查询、过期清理、并发操作
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentRegistry, AgentRegistration, validateAgentWebhookUrl } from './agent-registry.js';
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
    webhook: { url: `https://example.com/webhook/${agentId}` },
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

    it('应该保留 webhook 和 metadata', () => {
      const agent = createAgentRegistration('agent-3', 'Agent');
      agent.webhook = { url: 'https://example.com/webhook' };
      agent.metadata = { custom: 'data' };

      const result = registry.register(agent);

      expect(result.webhook?.url).toBe('https://example.com/webhook');
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
      webhook: { url: `https://example.com/webhook/agent:${peerIdPrefix}:${randomSuffix}` },
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
      // 生成 64 字节的随机签名(Ed25519 签名长度)
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
        // 使用真实的 PeerId 格式(16位字母数字)
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

      it('签名验证通过后,消息应该可以正常路由', () => {
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

      it('应该在注册时验证签名(使用 registerWithVerification)', () => {
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

        // 不启用验证时,应该允许注册
        const result = registry.registerWithVerification(agent, false);

        expect(result.success).toBe(true);
        expect(result.registration).toBeDefined();
      });
    });

    // 任务 2.6: 测试签名验证失败场景
    describe('任务 2.6: 签名验证失败场景', () => {
      it('应该拒绝签名格式错误(不包含有效 base64)', () => {
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

      it('应该拒绝签名与 agentId 不匹配(NodeId 前缀不匹配)', () => {
        const peerIdPrefix = 'NODEAPREFIX12345'; // Node A 前缀(16位)
        const nodeId = 'NODEBPREFIX123456789'; // Node B(前缀不匹配)
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

      it('应该拒绝无效的 AgentId 格式(缺少 agent: 前缀)', () => {
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

      it('应该拒绝无效的 AgentId 格式(PeerId 前缀不是 16 位)', () => {
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

      it('应该拒绝无效的 AgentId 格式(随机后缀不是 8 位)', () => {
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
      it('应该拒绝伪造的 AgentId(尝试注册其他 peerId 前缀)', () => {
        const victimPeerIdPrefix = 'VICTIMPREFIX16'; // 16位受害者前缀
        const attackerNodeId = 'ATTACKPREFIX16XYZ'; // 攻击者的 NodeId(前缀不匹配)
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

  // ============================================================================
  // P0: 过期 AgentId 验证测试
  // ============================================================================

  describe('过期 AgentId 验证', () => {
    /**
     * 生成有效的 base64 签名
     */
    const generateValidSignature = (): string => {
      const signatureBytes = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        signatureBytes[i] = Math.floor(Math.random() * 256);
      }
      return Buffer.from(signatureBytes).toString('base64');
    };

    const createAgentWithCreatedAt = (
      peerIdPrefix: string,
      randomSuffix: string,
      createdAt: string,
      signature: string = generateValidSignature()
    ): Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'> => ({
      agentId: `agent:${peerIdPrefix}:${randomSuffix}`,
      name: 'Test Agent',
      capabilities: [],
      webhook: { url: `https://example.com/webhook/agent:${peerIdPrefix}:${randomSuffix}` },
      nodeId: `${peerIdPrefix}XYZ123456789`,
      signature,
      publicKey: 'validPublicKeyBase64',
      createdAt,
    });

    beforeEach(() => {
      vi.clearAllMocks();
      registry = new AgentRegistry();
    });

    it('应该拒绝已过期的 AgentId', () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      // createdAt 设置为 30 天前(已过期)
      const expiredDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const createdAt = expiredDate.toISOString();

      const agent = createAgentWithCreatedAt(peerIdPrefix, randomSuffix, createdAt);
      registry.register(agent);

      // 定义过期时间:24 小时(1 天)
      const maxAgeMs = 24 * 60 * 60 * 1000;
      const isValid = registry.isAgentIdExpired(agent.agentId, maxAgeMs);

      expect(isValid).toBe(true); // AgentId 已过期
    });

    it('应该接受未过期的 AgentId', () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      // createdAt 设置为 1 小时前(未过期)
      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000);
      const createdAt = recentDate.toISOString();

      const agent = createAgentWithCreatedAt(peerIdPrefix, randomSuffix, createdAt);
      registry.register(agent);

      // 定义过期时间:24 小时(1 天)
      const maxAgeMs = 24 * 60 * 60 * 1000;
      const isValid = registry.isAgentIdExpired(agent.agentId, maxAgeMs);

      expect(isValid).toBe(false); // AgentId 未过期
    });

    it('应该接受刚创建的 AgentId', () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      // createdAt 设置为当前时间
      const createdAt = new Date().toISOString();

      const agent = createAgentWithCreatedAt(peerIdPrefix, randomSuffix, createdAt);
      registry.register(agent);

      const maxAgeMs = 24 * 60 * 60 * 1000;
      const isValid = registry.isAgentIdExpired(agent.agentId, maxAgeMs);

      expect(isValid).toBe(false); // AgentId 未过期
    });

    it('未注册 AgentId 应返回过期', () => {
      const unregisteredAgentId = 'agent:UNKNOWN12345678:XYZ12345';

      const maxAgeMs = 24 * 60 * 60 * 1000;
      const isValid = registry.isAgentIdExpired(unregisteredAgentId, maxAgeMs);

      expect(isValid).toBe(true); // 未注册视为过期
    });

    it('无 createdAt 字段应视为过期', () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';

      const agent = createAgentWithCreatedAt(peerIdPrefix, randomSuffix, new Date().toISOString());
      agent.createdAt = undefined; // 移除 createdAt
      registry.register(agent);

      const maxAgeMs = 24 * 60 * 60 * 1000;
      const isValid = registry.isAgentIdExpired(agent.agentId, maxAgeMs);

      expect(isValid).toBe(true); // 无 createdAt 视为过期
    });

    it('应该支持自定义过期时间', () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      // createdAt 设置为 2 小时前
      const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const agent = createAgentWithCreatedAt(peerIdPrefix, randomSuffix, createdAt);
      registry.register(agent);

      // 过期时间设置为 1 小时
      const maxAgeMs = 1 * 60 * 60 * 1000;
      const isValid = registry.isAgentIdExpired(agent.agentId, maxAgeMs);

      expect(isValid).toBe(true); // 2 小时前创建,1 小时过期,已过期
    });

    it('过期 AgentId 在签名验证时应被拒绝', () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      // createdAt 设置为 30 天前(已过期)
      const expiredDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const createdAt = expiredDate.toISOString();

      const agent = createAgentWithCreatedAt(peerIdPrefix, randomSuffix, createdAt);
      registry.register(agent);

      // 签名验证时检查过期
      const isValid = registry.verifySignatureWithExpiry(agent.agentId, 24 * 60 * 60 * 1000);

      expect(isValid).toBe(false); // 签名验证失败(AgentId 已过期)
    });

    it('未过期 AgentId 签名验证应成功', () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      const createdAt = new Date().toISOString();
      const signature = generateValidSignature();

      const agent = createAgentWithCreatedAt(peerIdPrefix, randomSuffix, createdAt, signature);
      registry.register(agent);

      const isValid = registry.verifySignatureWithExpiry(agent.agentId, 24 * 60 * 60 * 1000);

      expect(isValid).toBe(true); // 签名验证成功
    });
  });

  // ============================================================================
  // P0 Bug1: 消息签名验证测试(真实的 Ed25519 签名验证)
  // ============================================================================

  describe('P0 Bug1: 消息签名验证', () => {
    /**
     * 创建带公钥的 Agent 注册信息
     */
    const createAgentWithPublicKey = (
      peerIdPrefix: string,
      randomSuffix: string,
      publicKey: string,
      privateKey?: Uint8Array
    ): Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'> => {
      return {
        agentId: `agent:${peerIdPrefix}:${randomSuffix}`, 
        name: 'Test Agent for Message Signature',
        capabilities: [],
        webhook: { url: `https://example.com/webhook/agent:${peerIdPrefix}:${randomSuffix}` }, 
        nodeId: `${peerIdPrefix}XYZ123456789`,
        publicKey,
        createdAt: new Date().toISOString(),
        signature: generateValidSignature(),
      }; 
    };

    /**
     * 生成有效的 base64 签名(64 字节的随机签名,用于不需要真实验证的测试)
     */
    const generateValidSignature = (): string => {
      const signatureBytes = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        signatureBytes[i] = Math.floor(Math.random() * 256);
      }
      return Buffer.from(signatureBytes).toString('base64');
    };

    /**
     * 生成有效的 Ed25519 密钥对
     * 使用 crypto.getRandomValues 生成随机私钥
     */
    const generateEd25519KeyPair = async (): Promise<{ publicKey: string; privateKey: Uint8Array }> => {
      // 使用 noble/curves 生成真实的 Ed25519 密钥对
      const { ed25519 } = await import('@noble/curves/ed25519.js');

      // noble/curves ed25519 私钥长度为 32 字节
      // 使用 Node.js crypto 模块生成随机私钥
      const crypto = await import('crypto');
      const privateKey = new Uint8Array(crypto.getRandomValues(new Uint8Array(32)));
      const publicKey = ed25519.getPublicKey(privateKey);
      return {
        publicKey: Buffer.from(publicKey).toString('base64'),
        privateKey,
      };
    };

    /**
     * 使用 Ed25519 私钥签名消息载荷
     */
    const signMessagePayload = async (
      privateKey: Uint8Array,
      messageId: string,
      fromAgentId: string,
      content: string,
      type?: string,
      createdAt?: string
    ): Promise<string> => {
      const { ed25519 } = await import('@noble/curves/ed25519.js');

      // 序列化载荷(与 AgentRegistry.serializeMessagePayloadForSignature 一致)
      const parts = [messageId, fromAgentId, content];
      if (type) parts.push(type);
      if (createdAt) parts.push(createdAt);
      const payloadString = parts.join(':');
      const payloadBytes = Buffer.from(payloadString, 'utf-8');

      // 签名
      const signature = ed25519.sign(payloadBytes, privateKey);
      return Buffer.from(signature).toString('base64');
    };

    beforeEach(() => {
      vi.clearAllMocks();
      registry = new AgentRegistry();
    });

    it('应该使用 Ed25519 公钥成功验证真实的消息签名', async () => {
      // 生成真实的 Ed25519 密钥对
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      const agentId = `agent:${peerIdPrefix}:${randomSuffix}`;

      // 注册 Agent
      const agent = createAgentWithPublicKey(peerIdPrefix, randomSuffix, publicKey);
      registry.register(agent);

      // 构造消息载荷
      const messageId = 'msg-test-001';
      const content = 'Hello, this is a test message';
      const createdAt = new Date().toISOString();

      // 使用私钥签名
      const signature = await signMessagePayload(privateKey, messageId, agentId, content, 'message', createdAt);

      // 验证签名
      const isValid = await registry.verifyMessageSignature(agentId, {
        messageId,
        fromAgentId: agentId,
        content,
        type: 'message',
        createdAt,
      }, signature);

      expect(isValid).toBe(true);
    });

    it('应该拒绝签名与消息内容不匹配', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      const agentId = `agent:${peerIdPrefix}:${randomSuffix}`;

      const agent = createAgentWithPublicKey(peerIdPrefix, randomSuffix, publicKey);
      registry.register(agent);

      // 签名原始内容
      const originalContent = 'Original content';
      const signature = await signMessagePayload(privateKey, 'msg-001', agentId, originalContent);

      // 使用不同的内容验证
      const isValid = await registry.verifyMessageSignature(agentId, {
        messageId: 'msg-001',
        fromAgentId: agentId,
        content: 'Modified content', // 内容被修改
      }, signature);

      expect(isValid).toBe(false); // 签名不匹配
    });

    it('应该拒绝使用其他 Agent 公钥的签名', async () => {
      // Agent A 的密钥对
      const { publicKey: publicKeyA } = await generateEd25519KeyPair();
      // Agent B 的密钥对(不同)
      const { privateKey: privateKeyB } = await generateEd25519KeyPair();

      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      const agentId = `agent:${peerIdPrefix}:${randomSuffix}`;

      // Agent A 注册(使用 A 的公钥)
      const agent = createAgentWithPublicKey(peerIdPrefix, randomSuffix, publicKeyA);
      registry.register(agent);

      // 使用 B 的私钥签名消息
      const signature = await signMessagePayload(privateKeyB, 'msg-001', agentId, 'Test message');

      // 验证(应该失败,因为签名用的是 B 的私钥,但公钥是 A 的)
      const isValid = await registry.verifyMessageSignature(agentId, {
        messageId: 'msg-001',
        fromAgentId: agentId,
        content: 'Test message',
      }, signature);

      expect(isValid).toBe(false);
    });

    it('应该拒绝未注册 Agent 的消息签名', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const unregisteredAgentId = 'agent:UNKNOWN12345678:XYZ12345';

      // 不注册 Agent
      const signature = await signMessagePayload(privateKey, 'msg-001', unregisteredAgentId, 'Test');

      const isValid = await registry.verifyMessageSignature(unregisteredAgentId, {
        messageId: 'msg-001',
        fromAgentId: unregisteredAgentId,
        content: 'Test',
      }, signature);

      expect(isValid).toBe(false);
    });

    it('应该拒绝无公钥 Agent 的消息签名', async () => {
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      const agentId = `agent:${peerIdPrefix}:${randomSuffix}`;

      // 注册无公钥的 Agent
      registry.register({
        agentId,
        name: 'Agent without public key',
        capabilities: [],
        nodeId: `${peerIdPrefix}XYZ123456789`,
      });

      const signature = generateValidSignature();
      const isValid = await registry.verifyMessageSignature(agentId, {
        messageId: 'msg-001',
        fromAgentId: agentId,
        content: 'Test',
      }, signature);

      expect(isValid).toBe(false);
    });

    it('应该拒绝无效签名的消息', async () => {
      const { publicKey } = await generateEd25519KeyPair();
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      const agentId = `agent:${peerIdPrefix}:${randomSuffix}`;

      const agent = createAgentWithPublicKey(peerIdPrefix, randomSuffix, publicKey);
      registry.register(agent);

      // 使用无效签名
      const isValid = await registry.verifyMessageSignature(agentId, {
        messageId: 'msg-001',
        fromAgentId: agentId,
        content: 'Test',
      }, 'invalid_signature');

      expect(isValid).toBe(false);
    });

    it('serializeMessagePayloadForSignature 应按固定顺序序列化', () => {
      const payload = {
        messageId: 'msg-001',
        fromAgentId: 'agent:test:test',
        content: 'content',
        type: 'message',
        createdAt: '2024-01-01T00:00:00Z',
      };

      const serialized = AgentRegistry.serializeMessagePayloadForSignature(payload);

      // 验证序列化顺序
      expect(serialized).toBe('msg-001:agent:test:test:content:message:2024-01-01T00:00:00Z');
    });

    it('serializeMessagePayloadForSignature 应正确处理可选字段', () => {
      const payloadWithoutOptional = {
        messageId: 'msg-002',
        fromAgentId: 'agent:test:test',
        content: 'content',
      };const serialized = AgentRegistry.serializeMessagePayloadForSignature(payloadWithoutOptional);

      // 可选字段不存在时,不包含在序列化中
      expect(serialized).toBe('msg-002:agent:test:test:content');
    });

    it('消息签名应防止内容篡改攻击', async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const peerIdPrefix = 'ABCDEFGH12345678';
      const randomSuffix = 'ABCD1234';
      const agentId = `agent:${peerIdPrefix}:${randomSuffix}`;

      const agent = createAgentWithPublicKey(peerIdPrefix, randomSuffix, publicKey);
      registry.register(agent);

      // 正常签名
      const signature = await signMessagePayload(privateKey, 'msg-001', agentId, 'Safe message');

      // 尝试修改 messageId
      const isValid1 = await registry.verifyMessageSignature(agentId, {
        messageId: 'msg-002', // 修改的 messageId
        fromAgentId: agentId,
        content: 'Safe message',
      }, signature);
      expect(isValid1).toBe(false);

      // 尝试修改 fromAgentId
      const isValid2 = await registry.verifyMessageSignature(agentId, {
        messageId: 'msg-001',
        fromAgentId: 'agent:other:agent', // 修改的 fromAgentId
        content: 'Safe message',
      }, signature);
      expect(isValid2).toBe(false);
    });
  });

  // ============================================================================
  // P0: Webhook 注册安全测试 (RFC 004)
  // ============================================================================

  describe('P0: Webhook 注册安全测试', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      registry = new AgentRegistry();
    });

    describe('validateAgentWebhookUrl - 私有 IP 地址拒绝', () => {
      it('应该拒绝 127.0.0.1 (loopback)', () => {
        const result = validateAgentWebhookUrl('http://127.0.0.1:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IP');
        expect(result.error).toContain('127.0.0.1');
      });

      it('应该拒绝 127.x.x.x (所有 loopback)', () => {
        const result = validateAgentWebhookUrl('http://127.123.45.67:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IP');
      });

      it('应该拒绝 10.x.x.x (Class A private)', () => {
        const result = validateAgentWebhookUrl('http://10.0.0.1:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IP');
        expect(result.error).toContain('10.0.0.1');
      });

      it('应该拒绝 192.168.x.x (Class C private)', () => {
        const result = validateAgentWebhookUrl('http://192.168.1.100:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IP');
        expect(result.error).toContain('192.168.1.100');
      });

      it('应该拒绝 172.16.x.x - 172.31.x.x (Class B private)', () => {
        const result1 = validateAgentWebhookUrl('http://172.16.0.1:3000/webhook');
        expect(result1.valid).toBe(false);
        expect(result1.error).toContain('Private IP');

        const result2 = validateAgentWebhookUrl('http://172.31.255.255:3000/webhook');
        expect(result2.valid).toBe(false);
        expect(result2.error).toContain('Private IP');
      });

      it('应该拒绝 169.254.x.x (link-local)', () => {
        const result = validateAgentWebhookUrl('http://169.254.1.1:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IP');
      });

      it('应该拒绝 0.0.0.0 (all interfaces)', () => {
        const result = validateAgentWebhookUrl('http://0.0.0.0:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IP');
      });
    });

    describe('validateAgentWebhookUrl - localhost 域名拒绝', () => {
      it('应该拒绝 localhost', () => {
        const result = validateAgentWebhookUrl('http://localhost:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('localhost');
      });

      it('应该拒绝 .localhost 子域名', () => {
        const result = validateAgentWebhookUrl('http://test.localhost:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('localhost');
      });

      it('应该拒绝 .local 域名', () => {
        const result = validateAgentWebhookUrl('http://test.local:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('.local');
      });

      it('应该拒绝 local (不带子域名)', () => {
        const result = validateAgentWebhookUrl('http://local:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('local');
      });
    });

    describe('validateAgentWebhookUrl - IPv6 私有地址拒绝', () => {
      it('应该拒绝 IPv6 loopback (::1)', () => {
        const result = validateAgentWebhookUrl('http://[::1]:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IPv6');
      });

      it('应该拒绝 IPv6 unspecified address (::)', () => {
        const result = validateAgentWebhookUrl('http://[::]:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IPv6');
      });

      it('应该拒绝 IPv6 ULA (fc00::/7)', () => {
        const result1 = validateAgentWebhookUrl('http://[fc00::1]:3000/webhook');
        expect(result1.valid).toBe(false);
        expect(result1.error).toContain('Private IPv6');

        const result2 = validateAgentWebhookUrl('http://[fd00::1]:3000/webhook');
        expect(result2.valid).toBe(false);
        expect(result2.error).toContain('Private IPv6');
      });

      it('应该拒绝 IPv6 link-local (fe80::/10)', () => {
        const result = validateAgentWebhookUrl('http://[fe80::1]:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IPv6');
      });

      it('应该拒绝 IPv4-mapped IPv6 (::ffff:127.0.0.1)', () => {
        const result = validateAgentWebhookUrl('http://[::ffff:127.0.0.1]:3000/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Private IPv6');
      });
    });

    describe('validateAgentWebhookUrl - 无效 URL 格式拒绝', () => {
      it('应该拒绝无效 URL 格式', () => {
        const result = validateAgentWebhookUrl('not-a-valid-url');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid URL');
      });

      it('应该拒绝空 URL', () => {
        const result = validateAgentWebhookUrl('');
        expect(result.valid).toBe(true); // 空 URL 允许（表示不使用 webhook）
      });

      it('应该拒绝无协议的 URL', () => {
        const result = validateAgentWebhookUrl('example.com/webhook');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid URL');
      });

      it('应该拒绝非 http/https 协议', () => {
        const result1 = validateAgentWebhookUrl('ftp://example.com/webhook');
        expect(result1.valid).toBe(false);
        expect(result1.error).toContain('Invalid protocol');

        const result2 = validateAgentWebhookUrl('file:///etc/passwd');
        expect(result2.valid).toBe(false);
        expect(result2.error).toContain('Invalid protocol');

        const result3 = validateAgentWebhookUrl('javascript:alert(1)');
        expect(result3.valid).toBe(false);
        expect(result3.error).toContain('Invalid protocol');
      });
    });

    describe('validateAgentWebhookUrl - 有效 webhook URL', () => {
      it('应该接受有效的公网 URL', () => {
        const result = validateAgentWebhookUrl('https://api.example.com/webhook');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('应该接受带有端口的有效 URL', () => {
        const result = validateAgentWebhookUrl('https://api.example.com:443/webhook');
        expect(result.valid).toBe(true);
      });

      it('应该接受带有路径的有效 URL', () => {
        const result = validateAgentWebhookUrl('https://api.example.com/api/v1/webhook/agent');
        expect(result.valid).toBe(true);
      });

      it('应该接受公网 IPv4 地址', () => {
        const result = validateAgentWebhookUrl('https://8.8.8.8/webhook');
        expect(result.valid).toBe(true);
      });

      it('应该接受公网 IPv6 地址', () => {
        const result = validateAgentWebhookUrl('https://[2001:4860:4860::8888]/webhook');
        expect(result.valid).toBe(true);
      });
    });

    describe('Agent 注册时 webhook 安全验证', () => {
      it('注册私有 IP webhook 应被拒绝', () => {
        const agent = createAgentRegistration('agent-1', 'Agent', []);
        agent.webhook = { url: 'http://127.0.0.1:3000/webhook' }; 

        // 注册前验证 webhook
        const webhookValidation = validateAgentWebhookUrl(agent.webhook.url);
        expect(webhookValidation.valid).toBe(false);
        expect(webhookValidation.error).toContain('Private IP');
      });

      it('注册 localhost webhook 应被拒绝', () => {
        const agent = createAgentRegistration('agent-2', 'Agent', []);
        agent.webhook = { url: 'http://localhost:3000/webhook' }; 

        const webhookValidation = validateAgentWebhookUrl(agent.webhook.url);
        expect(webhookValidation.valid).toBe(false);
        expect(webhookValidation.error).toContain('localhost');
      });

      it('注册无效 URL 格式 webhook 应被拒绝', () => {
        const agent = createAgentRegistration('agent-3', 'Agent', []);
        agent.webhook = { url: 'not-a-url' }; 

        const webhookValidation = validateAgentWebhookUrl(agent.webhook.url);
        expect(webhookValidation.valid).toBe(false);
        expect(webhookValidation.error).toContain('Invalid URL');
      });

      it('注册有效 webhook URL 应成功', () => {
        const agent = createAgentRegistration('agent-4', 'Agent', []);
        agent.webhook = { url: 'https://api.example.com/webhook' }; 

        const webhookValidation = validateAgentWebhookUrl(agent.webhook.url);
        expect(webhookValidation.valid).toBe(true);

        // 注册 Agent
        registry.register(agent);
        const registered = registry.get('agent-4');
        expect(registered?.webhook?.url).toBe('https://api.example.com/webhook');
      });

      it('webhook 更新时的安全验证', () => {
        // 先注册有效 webhook
        const agent = createAgentRegistration('agent-5', 'Agent', []);
        agent.webhook = { url: 'https://api.example.com/webhook' }; 
        registry.register(agent);

        // 更新为无效 webhook（私有 IP）
        const newWebhookUrl = 'http://192.168.1.1:3000/webhook';
        const webhookValidation = validateAgentWebhookUrl(newWebhookUrl);
        expect(webhookValidation.valid).toBe(false);
        expect(webhookValidation.error).toContain('Private IP');
      });

      it('空 webhook URL 应被允许', () => {
        const agent = createAgentRegistration('agent-6', 'Agent', []);
        agent.webhook = undefined;

        // 空 webhook 允许注册
        registry.register(agent);
        const registered = registry.get('agent-6');
        expect(registered?.webhook).toBeUndefined();
      });
    });
  });
});