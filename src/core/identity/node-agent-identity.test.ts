/**
 * NodeIdentityManager 和 AgentIdentityManager 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { NodeIdentityManager } from './node-identity.js';
import { AgentIdentityManager } from './agent-identity.js';
import { IdentityDelegator } from './delegator.js';

describe('NodeIdentityManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `f2a-node-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('loadOrCreate', () => {
    it('should create new node identity when none exists', async () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      const result = await manager.loadOrCreate();

      expect(result.success).toBe(true);
      if (!result.success) return;

      const identity = result.data;
      expect(identity.nodeId).toBeDefined();
      expect(identity.nodeId.length).toBeGreaterThan(0);
      expect(identity.peerId).toBeDefined();
      expect(identity.peerId.startsWith('12D3Koo')).toBe(true);
      expect(identity.privateKey).toBeDefined();
      expect(identity.e2eeKeyPair.publicKey).toBeDefined();
      expect(identity.e2eeKeyPair.privateKey).toBeDefined();
      expect(identity.createdAt).toBeInstanceOf(Date);
    });

    it('should load existing node identity', async () => {
      // 首次创建
      const manager1 = new NodeIdentityManager({ dataDir: tempDir });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);
      if (!result1.success) return;

      const nodeId1 = result1.data.nodeId;
      const peerId1 = result1.data.peerId;

      // 再次加载
      const manager2 = new NodeIdentityManager({ dataDir: tempDir });
      const result2 = await manager2.loadOrCreate();
      expect(result2.success).toBe(true);
      if (!result2.success) return;

      expect(result2.data.nodeId).toBe(nodeId1);
      expect(result2.data.peerId).toBe(peerId1);
    });

    it('should encrypt node identity with password', async () => {
      const manager = new NodeIdentityManager({ 
        dataDir: tempDir, 
        password: 'Secure-password-123' 
      });
      const result = await manager.loadOrCreate();

      expect(result.success).toBe(true);

      // 验证文件内容是加密的
      const nodeFile = join(tempDir, 'node-identity.json');
      const content = await fs.readFile(nodeFile, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.encrypted).toBe(true);
      expect(parsed.ciphertext).toBeDefined();
    });

    it('should decrypt node identity with correct password', async () => {
      const password = 'Secure-password-123';
      
      // 创建加密的身份
      const manager1 = new NodeIdentityManager({ dataDir: tempDir, password });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);
      if (!result1.success) return;

      const nodeId = result1.data.nodeId;

      // 使用正确密码解密
      const manager2 = new NodeIdentityManager({ dataDir: tempDir, password });
      const result2 = await manager2.loadOrCreate();
      expect(result2.success).toBe(true);
      if (!result2.success) return;

      expect(result2.data.nodeId).toBe(nodeId);
    });

    it('should fail to decrypt with wrong password', async () => {
      const password = 'Correct-password-1';
      
      // 创建加密的身份
      const manager1 = new NodeIdentityManager({ dataDir: tempDir, password });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);

      // 使用错误密码尝试解密
      const manager2 = new NodeIdentityManager({ dataDir: tempDir, password: 'Wrong-password-1' });
      const result2 = await manager2.loadOrCreate();
      
      expect(result2.success).toBe(false);
      if (result2.success) return;
      expect(result2.error.code).toBe('NODE_IDENTITY_DECRYPT_FAILED');
    });

    it('should return NODE_IDENTITY_PASSWORD_REQUIRED when encrypted file has no password', async () => {
      const password = 'Secure-password-1';
      
      // 创建加密的身份
      const manager1 = new NodeIdentityManager({ dataDir: tempDir, password });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);

      // 不提供密码尝试加载
      const manager2 = new NodeIdentityManager({ dataDir: tempDir });
      const result2 = await manager2.loadOrCreate();
      
      expect(result2.success).toBe(false);
      if (result2.success) return;
      expect(result2.error.code).toBe('NODE_IDENTITY_PASSWORD_REQUIRED');
    });
  });

  describe('getNodeId', () => {
    it('should return node ID after loading', async () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();

      expect(manager.getNodeId()).not.toBeNull();
      expect(typeof manager.getNodeId()).toBe('string');
    });

    it('should return null before loading', () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      expect(manager.getNodeId()).toBeNull();
    });
  });

  describe('isNodeLoaded', () => {
    it('should return false before loading', () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      expect(manager.isNodeLoaded()).toBe(false);
    });

    it('should return true after loading', async () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();
      expect(manager.isNodeLoaded()).toBe(true);
    });
  });

  describe('deleteNodeIdentity', () => {
    it('should delete node identity file and clear memory', async () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();
      expect(manager.isNodeLoaded()).toBe(true);

      const result = await manager.deleteNodeIdentity();
      expect(result.success).toBe(true);
      expect(manager.isNodeLoaded()).toBe(false);
      expect(manager.getNodeId()).toBeNull();

      // 验证文件已删除
      const nodeFile = join(tempDir, 'node-identity.json');
      await expect(fs.access(nodeFile)).rejects.toThrow();
    });
  });

  describe('file permissions', () => {
    it('should set node identity file permissions to 600', async () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();

      const nodeFile = join(tempDir, 'node-identity.json');
      const stats = await fs.stat(nodeFile);
      const mode = stats.mode & 0o777;
      
      expect(mode).toBe(0o600);
    });
  });

  describe('concurrent loadOrCreate', () => {
    it('should handle concurrent calls safely', async () => {
      const manager = new NodeIdentityManager({ dataDir: tempDir });
      
      const promises = await Promise.all([
        manager.loadOrCreate(),
        manager.loadOrCreate(),
        manager.loadOrCreate()
      ]);
      
      for (const result of promises) {
        expect(result.success).toBe(true);
      }
      
      const nodeIds = promises.map(r => r.success ? r.data.nodeId : null);
      expect(nodeIds[0]).toBe(nodeIds[1]);
      expect(nodeIds[1]).toBe(nodeIds[2]);
    });
  });
});

describe('AgentIdentityManager', () => {
  let tempDir: string;
  let nodeManager: NodeIdentityManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `f2a-agent-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    nodeManager = new NodeIdentityManager({ dataDir: tempDir });
    await nodeManager.loadOrCreate();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 创建签名函数
  const createSignFunction = (manager: NodeIdentityManager) => {
    return async (data: Uint8Array): Promise<Uint8Array> => {
      const privateKey = manager.getPrivateKey();
      if (!privateKey) throw new Error('No private key');
      return await privateKey.sign(data);
    };
  };

  describe('createAgentIdentity', () => {
    it('should create new agent identity', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      const result = await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        {
          name: 'TestAgent',
          capabilities: ['test', 'demo']
        }
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      const agent = result.data;
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('TestAgent');
      expect(agent.capabilities).toContain('test');
      expect(agent.capabilities).toContain('demo');
      expect(agent.nodeId).toBe(nodeId);
      expect(agent.publicKey).toBeDefined();
      expect(agent.signature).toBeDefined();
      expect(agent.privateKey).toBeDefined();
    });

    it('should create agent with custom ID', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      const customId = 'custom-agent-123';
      const result = await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        {
          id: customId,
          name: 'CustomAgent'
        }
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.id).toBe(customId);
    });

    it('should create agent with expiration', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const result = await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        {
          name: 'ExpiringAgent',
          expiresAt
        }
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.expiresAt).toBeDefined();
    });
  });

  describe('loadAgentIdentity', () => {
    it('should load existing agent identity', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      // 创建
      const result1 = await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        { name: 'TestAgent' }
      );
      expect(result1.success).toBe(true);

      // 加载
      const manager2 = new AgentIdentityManager(tempDir);
      const result2 = await manager2.loadAgentIdentity();
      
      expect(result2.success).toBe(true);
      if (!result2.success) return;
      expect(result2.data.id).toBe(result1.data!.id);
      expect(result2.data.name).toBe('TestAgent');
    });

    it('should return error when no agent identity exists', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const result = await agentManager.loadAgentIdentity();
      
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('AGENT_IDENTITY_NOT_FOUND');
    });
  });

  describe('getters', () => {
    it('should return correct values after loading', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        {
          name: 'TestAgent',
          capabilities: ['cap1', 'cap2']
        }
      );

      expect(agentManager.getAgentId()).toBeDefined();
      expect(agentManager.getAgentName()).toBe('TestAgent');
      expect(agentManager.getCapabilities()).toEqual(['cap1', 'cap2']);
      expect(agentManager.getNodeId()).toBe(nodeId);
      expect(agentManager.getAgentPublicKey()).toBeDefined();
      expect(agentManager.isLoaded()).toBe(true);
    });

    it('should return null before loading', () => {
      const agentManager = new AgentIdentityManager(tempDir);
      
      expect(agentManager.getAgentId()).toBeNull();
      expect(agentManager.getAgentName()).toBeNull();
      expect(agentManager.getCapabilities()).toEqual([]);
      expect(agentManager.getNodeId()).toBeNull();
      expect(agentManager.getAgentPublicKey()).toBeNull();
      expect(agentManager.isLoaded()).toBe(false);
    });
  });

  describe('isExpired', () => {
    it('should return false for non-expiring agent', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        { name: 'NonExpiringAgent' }
      );

      expect(agentManager.isExpired()).toBe(false);
    });

    it('should return false for future expiration', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        {
          name: 'FutureExpiringAgent',
          expiresAt: futureDate
        }
      );

      expect(agentManager.isExpired()).toBe(false);
    });

    it('should return true for past expiration', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        {
          name: 'ExpiredAgent',
          expiresAt: pastDate
        }
      );

      expect(agentManager.isExpired()).toBe(true);
    });
  });

  describe('deleteAgentIdentity', () => {
    it('should delete agent identity file and clear memory', async () => {
      const agentManager = new AgentIdentityManager(tempDir);
      const nodeId = nodeManager.getNodeId()!;
      
      await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        { name: 'TestAgent' }
      );

      expect(agentManager.isLoaded()).toBe(true);

      const result = await agentManager.deleteAgentIdentity();
      expect(result.success).toBe(true);
      expect(agentManager.isLoaded()).toBe(false);

      // 验证文件已删除
      const agentFile = join(tempDir, 'agent-identity.json');
      await expect(fs.access(agentFile)).rejects.toThrow();
    });
  });
});

describe('IdentityDelegator', () => {
  let tempDir: string;
  let nodeManager: NodeIdentityManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `f2a-delegator-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    nodeManager = new NodeIdentityManager({ dataDir: tempDir });
    await nodeManager.loadOrCreate();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('createAgent', () => {
    it('should create agent with delegation', async () => {
      const delegator = new IdentityDelegator(nodeManager);
      
      const result = await delegator.createAgent({
        name: 'DelegatedAgent',
        capabilities: ['task1', 'task2']
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      const { agentIdentity, agentPrivateKey } = result.data;
      expect(agentIdentity.id).toBeDefined();
      expect(agentIdentity.name).toBe('DelegatedAgent');
      expect(agentIdentity.capabilities).toEqual(['task1', 'task2']);
      expect(agentIdentity.nodeId).toBe(nodeManager.getNodeId());
      expect(agentIdentity.signature).toBeDefined();
      expect(agentPrivateKey).toBeDefined();
    });
  });

  describe('verifyAgent', () => {
    it('should verify valid agent signature', async () => {
      const delegator = new IdentityDelegator(nodeManager);
      
      const createResult = await delegator.createAgent({
        name: 'VerifiableAgent'
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const agentIdentity = createResult.data.agentIdentity;

      // 创建公钥获取函数
      // 注意：需要从私钥获取公钥，然后使用 marshal() 获取原始公钥字节
      const getNodePublicKey = async (nodeId: string): Promise<Uint8Array | null> => {
        if (nodeId === nodeManager.getNodeId()) {
          // 从私钥获取公钥
          const privateKey = nodeManager.getPrivateKey();
          if (privateKey) {
            // Ed25519 私钥的 publicKey 属性返回 Ed25519PublicKey
            return privateKey.publicKey.raw;
          }
        }
        return null;
      };

      const verifyResult = await delegator.verifyAgent(agentIdentity, getNodePublicKey);
      expect(verifyResult.success).toBe(true);
      if (!verifyResult.success) return;
      expect(verifyResult.data).toBe(true);
    });

    it('should reject expired agent', async () => {
      const delegator = new IdentityDelegator(nodeManager);
      
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const createResult = await delegator.createAgent({
        name: 'ExpiredAgent',
        expiresAt: pastDate
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const agentIdentity = createResult.data.agentIdentity;

      const getNodePublicKey = async (): Promise<Uint8Array | null> => {
        const peerId = nodeManager.getPeerId();
        return peerId?.publicKey ? peerId.publicKey.raw : null;
      };

      const verifyResult = await delegator.verifyAgent(agentIdentity, getNodePublicKey);
      // P1-3 修复: verifyAgent 现在对过期返回 failure 而非 success(false)
      expect(verifyResult.success).toBe(false); // 过期时返回 failure
      if (verifyResult.success) return;
      expect(verifyResult.error.code).toBe('AGENT_IDENTITY_EXPIRED');
    });
  });

  describe('isAgentExpiringSoon', () => {
    it('should detect expiring soon agent', async () => {
      const delegator = new IdentityDelegator(nodeManager);
      
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 3); // 3天后过期

      const createResult = await delegator.createAgent({
        name: 'SoonExpiringAgent',
        expiresAt: soonDate
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const agentIdentity = createResult.data.agentIdentity;
      
      expect(delegator.isAgentExpiringSoon(agentIdentity, 7)).toBe(true);
      expect(delegator.isAgentExpiringSoon(agentIdentity, 1)).toBe(false);
    });

    it('should return false for non-expiring agent', async () => {
      const delegator = new IdentityDelegator(nodeManager);
      
      const createResult = await delegator.createAgent({
        name: 'NonExpiringAgent'
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      expect(delegator.isAgentExpiringSoon(createResult.data.agentIdentity)).toBe(false);
    });
  });

  describe('renewAgent', () => {
    it('should renew agent with new expiration', async () => {
      const delegator = new IdentityDelegator(nodeManager);
      
      const createResult = await delegator.createAgent({
        name: 'RenewableAgent'
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) return;

      const agentIdentity = createResult.data.agentIdentity;
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 60);

      const privateKey = nodeManager.getPrivateKey()!;
      const signFunction = async (data: Uint8Array) => privateKey.sign(data);

      const renewResult = await delegator.renewAgent(
        agentIdentity,
        newExpiresAt,
        signFunction
      );

      expect(renewResult.success).toBe(true);
      if (!renewResult.success) return;
      expect(renewResult.data.expiresAt).toBe(newExpiresAt.toISOString());
    });
  });
});

describe('Signature Verification', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `f2a-sig-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should produce consistent signature payload serialization', async () => {
    const payload1 = AgentIdentityManager.createSignaturePayload(
      'agent-123',
      'TestAgent',
      ['cap1', 'cap2'],
      'node-456',
      'cHVibGljLWtleQ==',
      '2024-01-01T00:00:00Z',
      '2025-01-01T00:00:00Z'
    );

    const payload2 = AgentIdentityManager.createSignaturePayload(
      'agent-123',
      'TestAgent',
      ['cap2', 'cap1'], // 不同顺序
      'node-456',
      'cHVibGljLWtleQ==',
      '2024-01-01T00:00:00Z',
      '2025-01-01T00:00:00Z'
    );

    // capabilities 排序后应该一致
    const serialized1 = AgentIdentityManager.serializePayloadForSignature(payload1);
    const serialized2 = AgentIdentityManager.serializePayloadForSignature(payload2);

    expect(serialized1).toBe(serialized2);
  });
});

// SEC-2: migrateAgent 授权验证测试
describe('migrateAgent', () => {
  let tempDir: string;
  let nodeManager: NodeIdentityManager;
  let delegator: IdentityDelegator;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `f2a-migrate-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    nodeManager = new NodeIdentityManager({ dataDir: tempDir });
    await nodeManager.loadOrCreate();
    delegator = new IdentityDelegator(nodeManager);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 辅助函数：从 base64 私钥恢复 Ed25519 私钥对象
  const restorePrivateKey = async (privateKeyBase64: string) => {
    const { privateKeyFromRaw } = await import('@libp2p/crypto/keys');
    const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
    return privateKeyFromRaw(privateKeyBytes);
  };

  it('should reject migration with invalid ownership proof', async () => {
    // 创建 Agent
    const createResult = await delegator.createAgent({
      name: 'MigratableAgent'
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const agentIdentity = createResult.data.agentIdentity;
    const now = new Date();
    const challenge = JSON.stringify({ timestamp: now.toISOString() });

    // 使用无效的签名
    const invalidProof = new Uint8Array(64); // 全零的无效签名

    const signFunction = async (data: Uint8Array) => {
      const privateKey = nodeManager.getPrivateKey()!;
      return privateKey.sign(data);
    };

    const migrateResult = await delegator.migrateAgent(
      agentIdentity,
      createResult.data.agentPrivateKey,
      invalidProof,
      challenge,
      'new-node-id-123',
      signFunction
    );

    expect(migrateResult.success).toBe(false);
    if (migrateResult.success) return;
    expect(migrateResult.error.code).toBe('AGENT_MIGRATION_UNAUTHORIZED');
  });

  it('should reject migration with expired challenge', async () => {
    // 创建 Agent
    const createResult = await delegator.createAgent({
      name: 'MigratableAgent'
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const agentIdentity = createResult.data.agentIdentity;
    const agentPrivateKeyBase64 = createResult.data.agentPrivateKey;

    // 创建过期的 challenge (10 分钟前)
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    const challenge = JSON.stringify({ timestamp: oldTimestamp.toISOString() });
    const challengeBytes = Buffer.from(challenge, 'utf-8');

    // 使用 Agent 私钥签名 challenge（使用 libp2p 的私钥对象）
    const agentPrivateKey = await restorePrivateKey(agentPrivateKeyBase64);
    const proofOfOwnership = await agentPrivateKey.sign(challengeBytes);

    const signFunction = async (data: Uint8Array) => {
      const privateKey = nodeManager.getPrivateKey()!;
      return privateKey.sign(data);
    };

    const migrateResult = await delegator.migrateAgent(
      agentIdentity,
      agentPrivateKeyBase64,
      proofOfOwnership,
      challenge,
      'new-node-id-123',
      signFunction
    );

    expect(migrateResult.success).toBe(false);
    if (migrateResult.success) return;
    expect(migrateResult.error.code).toBe('CHALLENGE_EXPIRED');
  });

  // SEC-5: 未来时间戳测试
  it('should reject challenge with future timestamp', async () => {
    // 创建 Agent
    const createResult = await delegator.createAgent({
      name: 'MigratableAgent'
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const agentIdentity = createResult.data.agentIdentity;
    const agentPrivateKeyBase64 = createResult.data.agentPrivateKey;

    // 创建未来时间戳的 challenge (10 分钟后)
    const futureTimestamp = new Date(Date.now() + 10 * 60 * 1000);
    const challenge = JSON.stringify({ timestamp: futureTimestamp.toISOString() });
    const challengeBytes = Buffer.from(challenge, 'utf-8');

    // 使用 Agent 私钥签名 challenge（使用 libp2p 的私钥对象）
    const agentPrivateKey = await restorePrivateKey(agentPrivateKeyBase64);
    const proofOfOwnership = await agentPrivateKey.sign(challengeBytes);

    const signFunction = async (data: Uint8Array) => {
      const privateKey = nodeManager.getPrivateKey()!;
      return privateKey.sign(data);
    };

    const migrateResult = await delegator.migrateAgent(
      agentIdentity,
      agentPrivateKeyBase64,
      proofOfOwnership,
      challenge,
      'new-node-id-123',
      signFunction
    );

    expect(migrateResult.success).toBe(false);
    if (migrateResult.success) return;
    expect(migrateResult.error.code).toBe('CHALLENGE_FUTURE_TIMESTAMP');
  });

  it('should reject migration with challenge missing timestamp', async () => {
    // 创建 Agent
    const createResult = await delegator.createAgent({
      name: 'MigratableAgent'
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const agentIdentity = createResult.data.agentIdentity;
    const agentPrivateKeyBase64 = createResult.data.agentPrivateKey;

    // 创建没有 timestamp 的 challenge
    const challenge = JSON.stringify({ data: 'some-data' });
    const challengeBytes = Buffer.from(challenge, 'utf-8');

    // 使用 Agent 私钥签名 challenge（使用 libp2p 的私钥对象）
    const agentPrivateKey = await restorePrivateKey(agentPrivateKeyBase64);
    const proofOfOwnership = await agentPrivateKey.sign(challengeBytes);

    const signFunction = async (data: Uint8Array) => {
      const privateKey = nodeManager.getPrivateKey()!;
      return privateKey.sign(data);
    };

    const migrateResult = await delegator.migrateAgent(
      agentIdentity,
      agentPrivateKeyBase64,
      proofOfOwnership,
      challenge,
      'new-node-id-123',
      signFunction
    );

    expect(migrateResult.success).toBe(false);
    if (migrateResult.success) return;
    expect(migrateResult.error.code).toBe('INVALID_CHALLENGE_FORMAT');
  });

  it('should reject migration with non-JSON challenge', async () => {
    // 创建 Agent
    const createResult = await delegator.createAgent({
      name: 'MigratableAgent'
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const agentIdentity = createResult.data.agentIdentity;
    const agentPrivateKeyBase64 = createResult.data.agentPrivateKey;

    // 创建非 JSON 的 challenge
    const challenge = 'not-a-json-challenge';
    const challengeBytes = Buffer.from(challenge, 'utf-8');

    // 使用 Agent 私钥签名 challenge（使用 libp2p 的私钥对象）
    const agentPrivateKey = await restorePrivateKey(agentPrivateKeyBase64);
    const proofOfOwnership = await agentPrivateKey.sign(challengeBytes);

    const signFunction = async (data: Uint8Array) => {
      const privateKey = nodeManager.getPrivateKey()!;
      return privateKey.sign(data);
    };

    const migrateResult = await delegator.migrateAgent(
      agentIdentity,
      agentPrivateKeyBase64,
      proofOfOwnership,
      challenge,
      'new-node-id-123',
      signFunction
    );

    expect(migrateResult.success).toBe(false);
    if (migrateResult.success) return;
    expect(migrateResult.error.code).toBe('INVALID_CHALLENGE_FORMAT');
  });

  it('should reject migration with invalid newNodeId format', async () => {
    // 创建 Agent
    const createResult = await delegator.createAgent({
      name: 'MigratableAgent'
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const agentIdentity = createResult.data.agentIdentity;
    const agentPrivateKeyBase64 = createResult.data.agentPrivateKey;

    // 创建有效的 challenge
    const challenge = JSON.stringify({ timestamp: new Date().toISOString() });
    const challengeBytes = Buffer.from(challenge, 'utf-8');

    // 使用 Agent 私钥签名 challenge（使用 libp2p 的私钥对象）
    const agentPrivateKey = await restorePrivateKey(agentPrivateKeyBase64);
    const proofOfOwnership = await agentPrivateKey.sign(challengeBytes);

    const signFunction = async (data: Uint8Array) => {
      const privateKey = nodeManager.getPrivateKey()!;
      return privateKey.sign(data);
    };

    const migrateResult = await delegator.migrateAgent(
      agentIdentity,
      agentPrivateKeyBase64,
      proofOfOwnership,
      challenge,
      'invalid node id with spaces!', // 无效的 Node ID
      signFunction
    );

    expect(migrateResult.success).toBe(false);
    if (migrateResult.success) return;
    expect(migrateResult.error.code).toBe('INVALID_NODE_ID');
  });

  it('should successfully migrate with valid ownership proof', async () => {
    // 创建 Agent
    const createResult = await delegator.createAgent({
      name: 'MigratableAgent'
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    const agentIdentity = createResult.data.agentIdentity;
    const agentPrivateKeyBase64 = createResult.data.agentPrivateKey;

    // 创建有效的 challenge
    const challenge = JSON.stringify({ timestamp: new Date().toISOString() });
    const challengeBytes = Buffer.from(challenge, 'utf-8');

    // 使用 Agent 私钥签名 challenge（使用 libp2p 的私钥对象）
    const agentPrivateKey = await restorePrivateKey(agentPrivateKeyBase64);
    const proofOfOwnership = await agentPrivateKey.sign(challengeBytes);

    const signFunction = async (data: Uint8Array) => {
      const privateKey = nodeManager.getPrivateKey()!;
      return privateKey.sign(data);
    };

    const newNodeId = 'new-node-123';
    const migrateResult = await delegator.migrateAgent(
      agentIdentity,
      agentPrivateKeyBase64,
      proofOfOwnership,
      challenge,
      newNodeId,
      signFunction
    );

    expect(migrateResult.success).toBe(true);
    if (!migrateResult.success) return;
    expect(migrateResult.data.agentIdentity.nodeId).toBe(newNodeId);
    expect(migrateResult.data.agentIdentity.id).toBe(agentIdentity.id);
    expect(migrateResult.data.agentIdentity.name).toBe(agentIdentity.name);
  });
});

// SEC-3: Agent 名称字符白名单测试
describe('Agent name validation (SEC-3 + SEC-5 tests)', () => {
  let tempDir: string;
  let nodeManager: NodeIdentityManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `f2a-name-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    nodeManager = new NodeIdentityManager({ dataDir: tempDir });
    await nodeManager.loadOrCreate();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const createSignFunction = (manager: NodeIdentityManager) => {
    return async (data: Uint8Array): Promise<Uint8Array> => {
      const privateKey = manager.getPrivateKey();
      if (!privateKey) throw new Error('No private key');
      return await privateKey.sign(data);
    };
  };

  it('should reject empty agent name', async () => {
    const delegator = new IdentityDelegator(nodeManager);

    const result = await delegator.createAgent({ name: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('AGENT_IDENTITY_INVALID_NAME');
  });

  it('should reject agent name longer than 64 characters', async () => {
    const delegator = new IdentityDelegator(nodeManager);
    const longName = 'a'.repeat(65);

    const result = await delegator.createAgent({ name: longName });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe('AGENT_IDENTITY_INVALID_NAME');
  });

  it('should reject agent name with special characters', async () => {
    const agentManager = new AgentIdentityManager(tempDir);
    const nodeId = nodeManager.getNodeId()!;

    const invalidNames = [
      'agent with spaces',
      'agent@name',
      'agent.name',
      'agent!name',
      'agent#name',
      'agent$name',
      'agent%name',
      'agent^name',
      'agent&name',
      'agent*name',
      'agent(name)',
      'agent[name]',
      'agent{name}',
      'agent/name',
      'agent\\name',
      'agent|name',
      'agent<name>',
      'agent+name',
      'agent=name',
      'agent"name',
      "agent'name",
      'agent`name',
      'agent~name'
    ];

    for (const name of invalidNames) {
      const result = await agentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        { name }
      );

      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.code).toBe('AGENT_IDENTITY_INVALID_NAME');
    }
  });

  it('should accept agent name with valid characters', async () => {
    const agentManager = new AgentIdentityManager(tempDir);
    const nodeId = nodeManager.getNodeId()!;

    const validNames = [
      'ValidAgent',
      'valid_agent',
      'valid-agent',
      'valid:agent',
      'Agent123',
      'AGENT',
      'agent_test-123:prod'
    ];

    for (const name of validNames) {
      // 每次使用新的目录避免冲突
      const newTempDir = join(tmpdir(), `f2a-name-test-${Date.now()}-${Math.random()}`);
      await fs.mkdir(newTempDir, { recursive: true });
      const newAgentManager = new AgentIdentityManager(newTempDir);

      const result = await newAgentManager.createAgentIdentity(
        nodeId,
        createSignFunction(nodeManager),
        { name }
      );

      expect(result.success).toBe(true);
      if (!result.success) continue;
      expect(result.data.name).toBe(name);

      // 清理
      await fs.rm(newTempDir, { recursive: true, force: true });
    }
  });
});
describe('batchVerify and revokeAgent', () => {
  let tempDir: string;
  let nodeManager: NodeIdentityManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `f2a-batch-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    nodeManager = new NodeIdentityManager({ dataDir: tempDir });
    await nodeManager.loadOrCreate();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should batch verify multiple agents', async () => {
    const delegator = new IdentityDelegator(nodeManager);
    
    // 创建多个 Agent
    const agent1Result = await delegator.createAgent({ name: 'BatchAgent1' });
    const agent2Result = await delegator.createAgent({ name: 'BatchAgent2' });
    
    expect(agent1Result.success).toBe(true);
    expect(agent2Result.success).toBe(true);
    
    if (!agent1Result.success || !agent2Result.success) return;

    // 批量验证
    const getNodePublicKey = async (nodeId: string) => {
      if (nodeId === nodeManager.getNodeId()) {
        const peerId = nodeManager.getPeerId();
        return peerId?.publicKey ? peerId.publicKey.raw : null;
      }
      return null;
    };

    const results = await delegator.batchVerify(
      [agent1Result.data.agentIdentity, agent2Result.data.agentIdentity],
      getNodePublicKey
    );

    expect(results.size).toBe(2);
    // 验证返回了结果
    expect(results.has(agent1Result.data.agentIdentity.id)).toBe(true);
    expect(results.has(agent2Result.data.agentIdentity.id)).toBe(true);
  });

  it('should return false for unknown node in batch verify', async () => {
    const delegator = new IdentityDelegator(nodeManager);
    
    // 创建一个伪造的 Agent（来自未知 Node）
    const fakeAgent: AgentIdentity = {
      id: 'fake-agent-id',
      name: 'FakeAgent',
      capabilities: [],
      nodeId: 'unknown-node-id', // 未知 Node
      publicKey: 'aW52YWxpZC1wdWJsaWMta2V5',
      createdAt: new Date().toISOString(),
      signature: 'aW52YWxpZC1zaWduYXR1cmU='
    };

    const getNodePublicKey = async (nodeId: string) => {
      if (nodeId === nodeManager.getNodeId()) {
        const peerId = nodeManager.getPeerId();
        return peerId?.publicKey ? peerId.publicKey.raw : null;
      }
      return null; // 未知 Node 返回 null
    };

    const results = await delegator.batchVerify([fakeAgent], getNodePublicKey);

    expect(results.size).toBe(1);
    expect(results.get(fakeAgent.id)).toBe(false); // 未知 Node 应返回 false
  });

  it.skip('should revoke agent successfully', async () => {
    // TODO: 这个测试需要修改 IdentityDelegator.createAgent() 方法
    // 让它接受 dataDir 参数或使用与 NodeIdentityManager 相同的目录
    // 当前实现会创建一个新的 AgentIdentityManager() 使用默认目录
    // 这导致测试中的 tempDir 目录下没有 Agent 文件
    const delegator = new IdentityDelegator(nodeManager);
    
    // 创建 Agent
    const createResult = await delegator.createAgent({ name: 'RevokableAgent' });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;

    // 使用正确的 dataDir 创建 AgentManager
    const agentManager = new AgentIdentityManager(tempDir);
    const loadResult = await agentManager.loadAgentIdentity();
    expect(loadResult.success).toBe(true);

    // 撤销 Agent
    const revokeResult = await delegator.revokeAgent(agentManager);
    expect(revokeResult.success).toBe(true);

    // 验证 Agent 已被删除
    const agentManager2 = new AgentIdentityManager(tempDir);
    const loadResult2 = await agentManager2.loadAgentIdentity();
    expect(loadResult2.success).toBe(false);
  });
});