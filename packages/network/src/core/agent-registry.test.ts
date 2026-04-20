/**
 * AgentRegistry 测试 - 持久化边缘情况
 * 覆盖 toPersistedFormat 和 fromPersistedFormat 私有方法
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentRegistry, AGENT_REGISTRY_FILE } from './agent-registry.js';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
      expect(persisted.nodePeerId).toBeDefined();
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
          nodePeerId: '12D3KooWNode',
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