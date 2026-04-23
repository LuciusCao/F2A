/**
 * AgentRegistry 测试 - 持久化边缘情况 + 核心方法覆盖
 * 覆盖 toPersistedFormat 和 fromPersistedFormat 私有方法
 * 覆盖 verifySignature, restore, updateName, updateWebhook, cleanupInactive 等核心方法
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry, AGENT_REGISTRY_FILE } from './agent-registry.js';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateAgentId, computeFingerprint } from './identity/agent-id.js';

// ============================================================================
// 测试数据工厂
// ============================================================================

function createTempDataDir(): string {
  const tempDir = join(tmpdir(), `f2a-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupTempDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createTestPublicKey(): string {
  // 生成一个有效的 Base64 Ed25519 公钥（32字节）
  return Buffer.from(Array(32).fill(0).map(() => Math.floor(Math.random() * 256))).toString('base64');
}

const mockPeerId = '12D3KooWTestPeerId';
const mockSignFunction = (data: string) => `mock-sig-${data.slice(0, 8)}`;

// ============================================================================
// 持久化格式转换测试
// ============================================================================

describe('AgentRegistry - Persistence Format Conversion', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('toPersistedFormat - Date → ISO string', () => {
    it('should convert Date fields to ISO strings when persisting RFC008 agent', () => {
      const publicKey = createTestPublicKey();
      
      registry.registerRFC008({
        publicKey,
        name: 'test-agent',
        capabilities: ['chat'], // 使用简化格式
      });

      // 获取注册后的 agentId
      const agents = registry.list();
      const agentId = agents[0].agentId;

      // 读取持久化文件
      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      expect(existsSync(persistedFile)).toBe(true);

      const data = JSON.parse(readFileSync(persistedFile, 'utf-8'));
      const persisted = data.agents[0];

      // 验证 Date 被转换为 ISO string
      expect(typeof persisted.registeredAt).toBe('string');
      expect(typeof persisted.lastActiveAt).toBe('string');
    });

    it('should auto-detect idFormat for new format AgentId', () => {
      const publicKey = createTestPublicKey();
      
      registry.registerRFC008({
        publicKey,
        name: 'new-format-agent',
        capabilities: [],
      });

      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      const data = JSON.parse(readFileSync(persistedFile, 'utf-8'));

      expect(data.agents[0].idFormat).toBe('new');
    });

    it('should auto-detect idFormat for old format AgentId (via register)', () => {
      // 使用旧格式注册
      registry.register({
        name: 'old-format-agent',
        capabilities: [],
      });

      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      const data = JSON.parse(readFileSync(persistedFile, 'utf-8'));

      expect(data.agents[0].idFormat).toBe('old');
    });

    it('should preserve RFC008 fields in persisted format', () => {
      const publicKey = createTestPublicKey();
      
      registry.registerRFC008({
        publicKey,
        name: 'rfc008-agent',
        capabilities: ['chat'],
        webhook: { url: 'http://example.com/webhook', token: 'secret' },
        metadata: { custom: 'data' },
      });

      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      const data = JSON.parse(readFileSync(persistedFile, 'utf-8'));
      const persisted = data.agents[0];

      expect(persisted.publicKey).toBe(publicKey);
      expect(persisted.nodeSignature).toBeDefined();
      expect(persisted.nodeId).toBeDefined();
      expect(persisted.webhook?.url).toBe('http://example.com/webhook');
      expect(persisted.metadata?.custom).toBe('data');
    });
  });

  describe('fromPersistedFormat - ISO string → Date', () => {
    it('should convert ISO strings to Date objects when loading', async () => {
      const now = new Date();
      const isoString = now.toISOString();

      // 直接写入持久化文件
      const publicKey = createTestPublicKey();
      const agentId = `agent:${Buffer.from(publicKey, 'base64').slice(0, 8).toString('hex').padEnd(16, '0')}`;
      
      const persistedData = {
        version: 1,
        agents: [{
          agentId,
          name: 'loaded-agent',
          capabilities: [],
          publicKey,
          nodeSignature: 'test-node-sig',
          nodeId: '12D3KooWNode',
          registeredAt: isoString,
          lastActiveAt: isoString,
        }],
        savedAt: isoString,
      };

      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      writeFileSync(persistedFile, JSON.stringify(persistedData));

      // 创建新的 registry 来加载
      const newRegistry = new AgentRegistry(
        mockPeerId,
        mockSignFunction,
        { dataDir: tempDir }
      );
      await newRegistry.loadAsync();

      const agent = newRegistry.get(agentId);
      expect(agent).toBeDefined();
      expect(agent?.registeredAt).toBeInstanceOf(Date);
      expect(agent?.lastActiveAt).toBeInstanceOf(Date);
    });

    it('should auto-detect idFormat when loading new format AgentId', async () => {
      const publicKey = createTestPublicKey();
      const agentId = `agent:${Buffer.from(publicKey, 'base64').slice(0, 8).toString('hex').padEnd(16, '0')}`;

      const persistedData = {
        version: 1,
        agents: [{
          agentId,
          name: 'loaded-agent',
          capabilities: [],
          publicKey,
          registeredAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }],
        savedAt: new Date().toISOString(),
      };

      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      writeFileSync(persistedFile, JSON.stringify(persistedData));

      const newRegistry = new AgentRegistry(
        mockPeerId,
        mockSignFunction,
        { dataDir: tempDir }
      );
      await newRegistry.loadAsync();

      const agent = newRegistry.get(agentId);
      expect(agent?.idFormat).toBe('new');
    });

    it('should auto-detect idFormat when loading old format AgentId', async () => {
      const agentId = 'agent:12D3KooWTest:abc12345';

      const persistedData = {
        version: 1,
        agents: [{
          agentId,
          name: 'loaded-agent',
          capabilities: [],
          peerId: '12D3KooWTest',
          signature: 'test-sig',
          registeredAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }],
        savedAt: new Date().toISOString(),
      };

      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      writeFileSync(persistedFile, JSON.stringify(persistedData));

      const newRegistry = new AgentRegistry(
        mockPeerId,
        mockSignFunction,
        { dataDir: tempDir }
      );
      await newRegistry.loadAsync();

      const agent = newRegistry.get(agentId);
      expect(agent?.idFormat).toBe('old');
    });
  });

  describe('Edge cases - persistence', () => {
    it('should handle duplicate registration (update existing)', () => {
      const publicKey = createTestPublicKey();
      
      registry.registerRFC008({
        publicKey,
        name: 'first',
        capabilities: [],
      });

      const agents = registry.list();
      const agentId = agents[0].agentId;

      // 重复注册应该更新
      registry.registerRFC008({
        publicKey,
        name: 'second',
        capabilities: ['chat'],
      });

      const agent = registry.get(agentId);
      expect(agent?.name).toBe('second');
    });

    it('should handle load with minimal fields', async () => {
      const publicKey = createTestPublicKey();
      const agentId = `agent:${Buffer.from(publicKey, 'base64').slice(0, 8).toString('hex').padEnd(16, '0')}`;

      const persistedData = {
        version: 1,
        agents: [{
          agentId,
          name: 'minimal-agent',
          capabilities: [],
          publicKey,
          registeredAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        }],
        savedAt: new Date().toISOString(),
      };

      const persistedFile = join(tempDir, AGENT_REGISTRY_FILE);
      writeFileSync(persistedFile, JSON.stringify(persistedData));

      const newRegistry = new AgentRegistry(
        mockPeerId,
        mockSignFunction,
        { dataDir: tempDir }
      );
      await newRegistry.loadAsync();

      const agent = newRegistry.get(agentId);
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('minimal-agent');
      expect(agent?.publicKey).toBe(publicKey);
    });

    it('should persist and restore webhook configuration', async () => {
      const publicKey = createTestPublicKey();
      
      registry.registerRFC008({
        publicKey,
        name: 'webhook-agent',
        capabilities: [],
        webhook: { url: 'http://127.0.0.1:8644/webhook', token: 'test-token' },
      });

      const agents = registry.list();
      const agentId = agents[0].agentId;

      // 创建新的 registry 来加载
      const newRegistry = new AgentRegistry(
        mockPeerId,
        mockSignFunction,
        { dataDir: tempDir }
      );
      await newRegistry.loadAsync();

      const agent = newRegistry.get(agentId);
      expect(agent?.webhook?.url).toBe('http://127.0.0.1:8644/webhook');
      expect(agent?.webhook?.token).toBe('test-token');
    });

    it('should persist and restore metadata', async () => {
      const publicKey = createTestPublicKey();
      
      registry.registerRFC008({
        publicKey,
        name: 'metadata-agent',
        capabilities: [],
        metadata: { 
          customField: 'customValue',
          nested: { key: 'value' },
        },
      });

      const agents = registry.list();
      const agentId = agents[0].agentId;

      const newRegistry = new AgentRegistry(
        mockPeerId,
        mockSignFunction,
        { dataDir: tempDir }
      );
      await newRegistry.loadAsync();

      const agent = newRegistry.get(agentId);
      expect(agent?.metadata?.customField).toBe('customValue');
      if (agent?.metadata?.nested) {
        expect((agent.metadata.nested as Record<string, unknown>).key).toBe('value');
      }
    });
  });
});

// ============================================================================
// RFC008 注册测试
// ============================================================================

describe('AgentRegistry - RFC008 Registration', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('registerRFC008()', () => {
    it('should register agent with RFC008 new format', () => {
      const publicKey = createTestPublicKey();
      
      const registration = registry.registerRFC008({
        publicKey,
        name: 'rfc008-agent',
        capabilities: [{ name: 'chat', version: '1.0.0' }],
      });

      expect(registration.agentId).toMatch(/^agent:[0-9a-f]{16}$/);
      expect(registration.name).toBe('rfc008-agent');
      expect(registration.publicKey).toBe(publicKey);
      expect(registration.idFormat).toBe('new');
      expect(registration.nodeSignature).toBeDefined();
      expect(registration.nodeId).toBe(mockPeerId);
      expect(registration.registeredAt).toBeInstanceOf(Date);
    });

    it('should generate AgentId matching public key fingerprint', () => {
      const publicKey = createTestPublicKey();
      const expectedAgentId = generateAgentId(publicKey);
      
      const registration = registry.registerRFC008({
        publicKey,
        name: 'fingerprint-agent',
        capabilities: [],
      });

      expect(registration.agentId).toBe(expectedAgentId);
    });

    it('should accept any string as publicKey (Base64 validation not enforced)', () => {
      // registerRFC008() does not validate Base64 format, it just generates fingerprint
      // This is intentional - the signature verification will fail if publicKey is invalid
      const registration = registry.registerRFC008({
        publicKey: 'not-valid-base64!!!',
        name: 'any-publicKey',
        capabilities: [],
      });
      
      // Should still register - AgentId is generated from whatever bytes we get
      expect(registration.agentId).toMatch(/^agent:[0-9a-f]{16}$/);
    });

    it('should store webhook in registration', () => {
      const publicKey = createTestPublicKey();
      
      const registration = registry.registerRFC008({
        publicKey,
        name: 'webhook-agent',
        capabilities: [],
        webhook: { url: 'http://example.com/hook', token: 'secret' },
      });

      expect(registration.webhook?.url).toBe('http://example.com/hook');
      expect(registration.webhook?.token).toBe('secret');
    });

    it('should update existing agent on duplicate publicKey', () => {
      const publicKey = createTestPublicKey();
      
      registry.registerRFC008({
        publicKey,
        name: 'first',
        capabilities: [],
      });

      // Same publicKey should update existing
      registry.registerRFC008({
        publicKey,
        name: 'second',
        capabilities: [{ name: 'code', version: '1.0.0' }],
      });

      const agentId = generateAgentId(publicKey);
      const agent = registry.get(agentId);
      expect(agent?.name).toBe('second');
      expect(agent?.capabilities).toHaveLength(1);
    });
  });
});

// ============================================================================
// verifySignature() 测试
// ============================================================================

describe('AgentRegistry - verifySignature', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('RFC008 verification', () => {
    it('should verify RFC008 AgentId with matching publicKey', () => {
      const publicKey = createTestPublicKey();
      const agentId = generateAgentId(publicKey);
      
      // Register first
      registry.registerRFC008({ publicKey, name: 'test', capabilities: [] });
      
      const result = registry.verifySignature(agentId, undefined, undefined, publicKey);
      expect(result).toBe(true);
    });

    it('should reject RFC008 AgentId with mismatched publicKey', () => {
      const publicKey1 = createTestPublicKey();
      const publicKey2 = createTestPublicKey();
      const agentId = generateAgentId(publicKey1);
      
      const result = registry.verifySignature(agentId, undefined, undefined, publicKey2);
      expect(result).toBe(false);
    });

    it('should reject RFC008 AgentId without publicKey', () => {
      const publicKey = createTestPublicKey();
      const agentId = generateAgentId(publicKey);
      
      const result = registry.verifySignature(agentId);
      expect(result).toBe(false);
    });
  });

  describe('RFC003 verification (deprecated)', () => {
    it('should verify old format AgentId with matching peerId prefix', () => {
      // RFC003 format: agent:<PeerId前16位>:<随机8位>
      // PeerId prefix must be 16 base58btc characters
      const agentId = 'agent:12D3KooWHxWdnxJa:abc12345';
      const peerId = '12D3KooWHxWdnxJaCMA4bVc'; // starts with same 16 chars
      
      const result = registry.verifySignature(agentId, 'sig', peerId);
      expect(result).toBe(true);
    });

    it('should reject old format AgentId with mismatched peerId prefix', () => {
      const agentId = 'agent:12D3KooWHxWdnxJa:abc12345';
      const peerId = '12D3KooWDifferent'; // Different prefix
      
      const result = registry.verifySignature(agentId, 'sig', peerId);
      expect(result).toBe(false);
    });

    it('should reject invalid AgentId format', () => {
      const result = registry.verifySignature('invalid-format');
      expect(result).toBe(false);
    });

    it('should reject empty AgentId', () => {
      const result = registry.verifySignature('');
      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// restore() 测试
// ============================================================================

describe('AgentRegistry - restore', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should restore RFC008 identity with publicKey', () => {
    const publicKey = createTestPublicKey();
    const agentId = generateAgentId(publicKey);
    
    const registration = registry.restore({
      agentId,
      name: 'restored-agent',
      publicKey,
      nodeSignature: 'node-sig',
      nodeId: '12D3KooWNode',
      capabilities: [{ name: 'chat', version: '1.0' }],
      createdAt: '2026-04-20T10:00:00.000Z',
      lastActiveAt: '2026-04-20T15:00:00.000Z',
    });

    expect(registration.agentId).toBe(agentId);
    expect(registration.name).toBe('restored-agent');
    expect(registration.publicKey).toBe(publicKey);
    expect(registration.idFormat).toBe('new');
    expect(registration.registeredAt.toISOString()).toBe('2026-04-20T10:00:00.000Z');
  });

  it('should restore RFC003 identity with peerId and signature', () => {
    const agentId = 'agent:12D3KooWTestP:abc12345';
    
    const registration = registry.restore({
      agentId,
      name: 'restored-old',
      peerId: '12D3KooWTestPeerId',
      signature: 'old-sig',
      capabilities: [],
      createdAt: '2026-04-20T10:00:00.000Z',
      lastActiveAt: '2026-04-20T15:00:00.000Z',
    });

    expect(registration.agentId).toBe(agentId);
    expect(registration.peerId).toBe('12D3KooWTestPeerId');
    expect(registration.signature).toBe('old-sig');
    expect(registration.idFormat).toBe('old');
  });

  it('should restore identity with webhook', () => {
    const publicKey = createTestPublicKey();
    const agentId = generateAgentId(publicKey);
    
    registry.restore({
      agentId,
      name: 'webhook-restored',
      publicKey,
      capabilities: [],
      webhook: { url: 'http://127.0.0.1:8644/webhook' },
      createdAt: '2026-04-20T10:00:00.000Z',
      lastActiveAt: '2026-04-20T15:00:00.000Z',
    });

    const agent = registry.get(agentId);
    expect(agent?.webhook?.url).toBe('http://127.0.0.1:8644/webhook');
  });

  it('should restore identity with metadata', () => {
    const publicKey = createTestPublicKey();
    const agentId = generateAgentId(publicKey);
    
    registry.restore({
      agentId,
      name: 'metadata-restored',
      publicKey,
      capabilities: [],
      metadata: { customKey: 'customValue', nested: { key: 'val' } },
      createdAt: '2026-04-20T10:00:00.000Z',
      lastActiveAt: '2026-04-20T15:00:00.000Z',
    });

    const agent = registry.get(agentId);
    expect(agent?.metadata?.customKey).toBe('customValue');
  });
});

// ============================================================================
// updateName() 和 updateWebhook() 测试
// ============================================================================

describe('AgentRegistry - update operations', () => {
  let registry: AgentRegistry;
  let tempDir: string;
  let publicKey: string;
  let agentId: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
    publicKey = createTestPublicKey();
    agentId = generateAgentId(publicKey);
    
    registry.registerRFC008({
      publicKey,
      name: 'original-name',
      capabilities: [],
    });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('updateName()', () => {
    it('should update agent name', () => {
      const result = registry.updateName(agentId, 'new-name');
      expect(result).toBe(true);
      
      const agent = registry.get(agentId);
      expect(agent?.name).toBe('new-name');
    });

    it('should update lastActiveAt on name update', () => {
      const before = registry.get(agentId)?.lastActiveAt;
      
      // Small delay to ensure time difference
      registry.updateName(agentId, 'updated');
      
      const after = registry.get(agentId)?.lastActiveAt;
      expect(after?.getTime()).toBeGreaterThanOrEqual(before?.getTime() || 0);
    });

    it('should return false for non-existent agent', () => {
      const result = registry.updateName('agent:nonexistent1234', 'new-name');
      expect(result).toBe(false);
    });

    it('should persist name update', async () => {
      registry.updateName(agentId, 'persisted-name');
      
      // Create new registry to reload
      const newRegistry = new AgentRegistry(
        mockPeerId,
        mockSignFunction,
        { dataDir: tempDir }
      );
      await newRegistry.loadAsync();
      
      const agent = newRegistry.get(agentId);
      expect(agent?.name).toBe('persisted-name');
    });
  });

  describe('updateWebhook()', () => {
    it('should update webhook URL', () => {
      const result = registry.updateWebhook(agentId, { url: 'http://new.url/webhook' });
      expect(result).toBe(true);
      
      const agent = registry.get(agentId);
      expect(agent?.webhook?.url).toBe('http://new.url/webhook');
    });

    it('should update webhook with token', () => {
      const result = registry.updateWebhook(agentId, { 
        url: 'http://new.url/webhook', 
        token: 'new-token' 
      });
      expect(result).toBe(true);
      
      const agent = registry.get(agentId);
      expect(agent?.webhook?.token).toBe('new-token');
    });

    it('should remove webhook by setting undefined', () => {
      registry.updateWebhook(agentId, { url: 'http://temp.url/webhook' });
      
      // Remove webhook
      registry.updateWebhook(agentId, undefined);
      
      const agent = registry.get(agentId);
      expect(agent?.webhook).toBeUndefined();
    });

    it('should return false for non-existent agent', () => {
      const result = registry.updateWebhook('agent:nonexistent1234', { url: 'http://url' });
      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// cleanupInactive() 测试
// ============================================================================

describe('AgentRegistry - cleanupInactive', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should cleanup inactive agents', async () => {
    // Register an agent
    const publicKey = createTestPublicKey();
    registry.registerRFC008({
      publicKey,
      name: 'inactive-agent',
      capabilities: [],
    });
    const agentId = generateAgentId(publicKey);

    // Manually set old lastActiveAt
    const agent = registry.get(agentId);
    if (agent) {
      agent.lastActiveAt = new Date(Date.now() - 3600000); // 1 hour ago
    }

    // Cleanup agents inactive for more than 30 minutes
    const cleaned = registry.cleanupInactive(1800000); // 30 minutes in ms
    expect(cleaned).toBe(1);
    expect(registry.get(agentId)).toBeUndefined();
  });

  it('should not cleanup active agents', async () => {
    const publicKey = createTestPublicKey();
    registry.registerRFC008({
      publicKey,
      name: 'active-agent',
      capabilities: [],
    });
    const agentId = generateAgentId(publicKey);

    // Agent is active (lastActiveAt is now)
    const cleaned = registry.cleanupInactive(3600000); // 1 hour
    expect(cleaned).toBe(0);
    expect(registry.get(agentId)).toBeDefined();
  });

  it('should cleanup multiple inactive agents', async () => {
    // Register multiple agents
    const keys = [createTestPublicKey(), createTestPublicKey(), createTestPublicKey()];
    const agentIds = [];
    
    for (const key of keys) {
      registry.registerRFC008({ publicKey: key, name: 'agent', capabilities: [] });
      agentIds.push(generateAgentId(key));
    }

    // Make first two inactive
    const agent1 = registry.get(agentIds[0]);
    const agent2 = registry.get(agentIds[1]);
    if (agent1) agent1.lastActiveAt = new Date(Date.now() - 7200000); // 2 hours
    if (agent2) agent2.lastActiveAt = new Date(Date.now() - 7200000); // 2 hours

    // Cleanup
    const cleaned = registry.cleanupInactive(3600000); // 1 hour threshold
    expect(cleaned).toBe(2);
    expect(registry.get(agentIds[0])).toBeUndefined();
    expect(registry.get(agentIds[1])).toBeUndefined();
    expect(registry.get(agentIds[2])).toBeDefined();
  });

  it('should save after cleanup', async () => {
    const publicKey = createTestPublicKey();
    registry.registerRFC008({ publicKey, name: 'to-clean', capabilities: [] });
    const agentId = generateAgentId(publicKey);

    const agent = registry.get(agentId);
    if (agent) agent.lastActiveAt = new Date(Date.now() - 7200000);

    registry.cleanupInactive(3600000);

    // Reload and verify
    const newRegistry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: tempDir });
    await newRegistry.loadAsync();
    
    expect(newRegistry.get(agentId)).toBeUndefined();
  });

  it('should return 0 if no agents to cleanup', () => {
    // Empty registry
    const cleaned = registry.cleanupInactive(3600000);
    expect(cleaned).toBe(0);
  });
});

// ============================================================================
// 查询方法测试
// ============================================================================

describe('AgentRegistry - query methods', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('findByCapability()', () => {
    it('should find agents by capability name', () => {
      const key1 = createTestPublicKey();
      const key2 = createTestPublicKey();
      const key3 = createTestPublicKey();

      registry.registerRFC008({
        publicKey: key1,
        name: 'chat-agent',
        capabilities: [{ name: 'chat', version: '1.0' }],
      });
      registry.registerRFC008({
        publicKey: key2,
        name: 'code-agent',
        capabilities: [{ name: 'code-generation', version: '1.0' }],
      });
      registry.registerRFC008({
        publicKey: key3,
        name: 'multi-agent',
        capabilities: [{ name: 'chat', version: '1.0' }, { name: 'code-generation', version: '1.0' }],
      });

      const chatAgents = registry.findByCapability('chat');
      expect(chatAgents).toHaveLength(2);
      expect(chatAgents.map(a => a.name)).toContain('chat-agent');
      expect(chatAgents.map(a => a.name)).toContain('multi-agent');

      const codeAgents = registry.findByCapability('code-generation');
      expect(codeAgents).toHaveLength(2);

      const nonexistent = registry.findByCapability('nonexistent');
      expect(nonexistent).toHaveLength(0);
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', () => {
      const key1 = createTestPublicKey();
      const key2 = createTestPublicKey();

      registry.registerRFC008({
        publicKey: key1,
        name: 'agent1',
        capabilities: [{ name: 'chat', version: '1.0' }],
      });
      registry.registerRFC008({
        publicKey: key2,
        name: 'agent2',
        capabilities: [{ name: 'chat', version: '1.0' }, { name: 'code', version: '1.0' }],
      });

      const stats = registry.getStats();
      expect(stats.total).toBe(2);
      expect(stats.capabilities['chat']).toBe(2);
      expect(stats.capabilities['code']).toBe(1);
    });

    it('should return empty stats for empty registry', () => {
      const stats = registry.getStats();
      expect(stats.total).toBe(0);
      expect(Object.keys(stats.capabilities)).toHaveLength(0);
    });
  });

  describe('list()', () => {
    it('should list all registered agents', () => {
      const key1 = createTestPublicKey();
      const key2 = createTestPublicKey();

      registry.registerRFC008({ publicKey: key1, name: 'agent1', capabilities: [] });
      registry.registerRFC008({ publicKey: key2, name: 'agent2', capabilities: [] });

      const agents = registry.list();
      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name)).toContain('agent1');
      expect(agents.map(a => a.name)).toContain('agent2');
    });

    it('should return empty array for empty registry', () => {
      expect(registry.list()).toHaveLength(0);
    });
  });
});

// ============================================================================
// 格式判断方法测试
// ============================================================================

describe('AgentRegistry - format detection methods', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('isNewFormatAgent()', () => {
    it('should return true for RFC008 format', () => {
      expect(registry.isNewFormatAgent('agent:a3b2c1d4e5f67890')).toBe(true);
    });

    it('should return false for RFC003 format', () => {
      expect(registry.isNewFormatAgent('agent:12D3KooWTestP:abc12345')).toBe(false);
    });

    it('should return false for invalid format', () => {
      expect(registry.isNewFormatAgent('invalid')).toBe(false);
    });
  });

  describe('isOldFormatAgent()', () => {
    it('should return true for RFC003 format', () => {
      // RFC003: agent:<PeerId前16位>:<随机8位> - PeerId prefix must be 16 base58btc chars
      expect(registry.isOldFormatAgent('agent:12D3KooWHxWdnxJa:abc12345')).toBe(true);
    });

    it('should return false for RFC008 format', () => {
      expect(registry.isOldFormatAgent('agent:a3b2c1d4e5f67890')).toBe(false);
    });
  });

  describe('getAgentFormat()', () => {
    it('should return "new" for RFC008 format', () => {
      expect(registry.getAgentFormat('agent:a3b2c1d4e5f67890')).toBe('new');
    });

    it('should return "old" for RFC003 format', () => {
      // RFC003: PeerId prefix must be 16 base58btc chars
      expect(registry.getAgentFormat('agent:12D3KooWHxWdnxJa:abc12345')).toBe('old');
    });

    it('should return "invalid" for invalid format', () => {
      expect(registry.getAgentFormat('invalid')).toBe('invalid');
    });
  });

  describe('getPublicKey()', () => {
    it('should return publicKey for registered RFC008 agent', () => {
      const publicKey = createTestPublicKey();
      registry.registerRFC008({ publicKey, name: 'test', capabilities: [] });
      const agentId = generateAgentId(publicKey);

      expect(registry.getPublicKey(agentId)).toBe(publicKey);
    });

    it('should return undefined for RFC003 agent', () => {
      registry.register({ name: 'old-agent', capabilities: [] });
      const agents = registry.list();
      const oldAgent = agents.find(a => a.idFormat === 'old');

      expect(registry.getPublicKey(oldAgent?.agentId || '')).toBeUndefined();
    });

    it('should return undefined for non-existent agent', () => {
      expect(registry.getPublicKey('agent:nonexistent1234')).toBeUndefined();
    });
  });

  describe('validatePublicKeyFingerprint()', () => {
    it('should return true for matching fingerprint', () => {
      const publicKey = createTestPublicKey();
      const agentId = generateAgentId(publicKey);

      expect(registry.validatePublicKeyFingerprint(agentId, publicKey)).toBe(true);
    });

    it('should return false for mismatched fingerprint', () => {
      const publicKey1 = createTestPublicKey();
      const publicKey2 = createTestPublicKey();
      const agentId = generateAgentId(publicKey1);

      expect(registry.validatePublicKeyFingerprint(agentId, publicKey2)).toBe(false);
    });
  });
});

// ============================================================================
// unregister() 测试
// ============================================================================

describe('AgentRegistry - unregister', () => {
  let registry: AgentRegistry;
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should unregister existing agent', () => {
    const publicKey = createTestPublicKey();
    registry.registerRFC008({ publicKey, name: 'to-remove', capabilities: [] });
    const agentId = generateAgentId(publicKey);

    const result = registry.unregister(agentId);
    expect(result).toBe(true);
    expect(registry.get(agentId)).toBeUndefined();
  });

  it('should return false for non-existent agent', () => {
    const result = registry.unregister('agent:nonexistent1234');
    expect(result).toBe(false);
  });

  it('should persist unregister', async () => {
    const publicKey = createTestPublicKey();
    registry.registerRFC008({ publicKey, name: 'persisted-remove', capabilities: [] });
    const agentId = generateAgentId(publicKey);

    registry.unregister(agentId);

    // Reload
    const newRegistry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: tempDir });
    await newRegistry.loadAsync();

    expect(newRegistry.get(agentId)).toBeUndefined();
  });
});

// ============================================================================
// updateLastActive() 测试
// ============================================================================

describe('AgentRegistry - updateLastActive', () => {
  let registry: AgentRegistry;
  let tempDir: string;
  let publicKey: string;
  let agentId: string;

  beforeEach(() => {
    tempDir = createTempDataDir();
    registry = new AgentRegistry(
      mockPeerId,
      mockSignFunction,
      { dataDir: tempDir }
    );
    publicKey = createTestPublicKey();
    registry.registerRFC008({ publicKey, name: 'test', capabilities: [] });
    agentId = generateAgentId(publicKey);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should update lastActiveAt for existing agent', () => {
    const before = registry.get(agentId)?.lastActiveAt.getTime() || 0;
    
    // Small delay
    registry.updateLastActive(agentId);
    
    const after = registry.get(agentId)?.lastActiveAt.getTime() || 0;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('should do nothing for non-existent agent', () => {
    // Should not throw
    registry.updateLastActive('agent:nonexistent1234');
    expect(registry.get('agent:nonexistent1234')).toBeUndefined();
  });
});