/**
 * Agent Identity Store 测试 (RFC 004 Phase 6)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentIdentityStore, AgentIdentity, AgentWebhook } from '../src/agent-identity-store.js';
import type { AgentCapability } from '@f2a/network';

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

/**
 * 创建 Mock AgentIdentity (RFC008)
 */
function createMockIdentity(agentId?: string): AgentIdentity {
  return {
    agentId: agentId || 'agent:a1b2c3d4e5f6g7h8',
    name: 'Test Agent',
    publicKey: 'dGVzdC1wdWJsaWMta2V5LWJhc2U2NA==', // Base64 encoded test key
    privateKey: 'dGVzdC1wcml2YXRlLWtleS1iYXNlNjQ=', // Base64 encoded test key
    peerId: '12D3KooWtest...',
    nodeSignature: 'mock-node-signature',
    nodeId: 'node:test-node-id',
    webhook: { url: 'http://127.0.0.1:9002/f2a/webhook' },
    capabilities: [{ name: 'chat', version: '1.0.0' }],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

describe('AgentIdentityStore', () => {
  let store: AgentIdentityStore;
  let testDir: string;
  let agentIdentitiesDir: string;

  beforeEach(() => {
    // 创建测试目录
    testDir = join(tmpdir(), `agent-identity-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    agentIdentitiesDir = join(testDir, 'agent-identities');
    
    // 创建 Store（不使用签名验证）
    store = new AgentIdentityStore(testDir);
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('save()', () => {
    it('should save identity file', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      const file = join(agentIdentitiesDir, `${identity.agentId}.json`);
      expect(existsSync(file)).toBe(true);

      const content = JSON.parse(readFileSync(file, 'utf-8'));
      expect(content.agentId).toBe(identity.agentId);
      expect(content.name).toBe(identity.name);
    });

    it('should create agents directory if not exists', async () => {
      // 测试目录存在，但 agents 子目录不存在
      expect(existsSync(agentIdentitiesDir)).toBe(false);

      const identity = createMockIdentity();
      await store.save(identity);

      // agents 目录应该被自动创建
      expect(existsSync(agentIdentitiesDir)).toBe(true);
    });

    it('should update existing identity', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      // 更新名称
      identity.name = 'Updated Name';
      await store.save(identity);

      const retrieved = store.get(identity.agentId);
      expect(retrieved?.name).toBe('Updated Name');

      // 文件内容也应该更新
      const file = join(agentIdentitiesDir, `${identity.agentId}.json`);
      const content = JSON.parse(readFileSync(file, 'utf-8'));
      expect(content.name).toBe('Updated Name');
    });

    it('should throw on invalid identity structure', async () => {
      const invalidIdentity = {
        // 缺少必须字段
        agentId: 'agent:xxx',
        name: 'Invalid',
      } as AgentIdentity;

      await expect(store.save(invalidIdentity)).rejects.toThrow('Invalid AgentIdentity structure');
    });
  });

  describe('loadAll()', () => {
    it('should load all identity files on startup', () => {
      // 手动创建 agents 目录和多个 identity 文件
      mkdirSync(agentIdentitiesDir, { recursive: true });

      const identity1 = createMockIdentity('agent:xxx:11111111');
      const identity2 = createMockIdentity('agent:xxx:22222222');

      writeFileSync(join(agentIdentitiesDir, `${identity1.agentId}.json`), JSON.stringify(identity1));
      writeFileSync(join(agentIdentitiesDir, `${identity2.agentId}.json`), JSON.stringify(identity2));

      store.loadAll();

      expect(store.list().length).toBe(2);
      expect(store.get(identity1.agentId)).toBeDefined();
      expect(store.get(identity2.agentId)).toBeDefined();
    });

    it('should skip invalid identity files', () => {
      mkdirSync(agentIdentitiesDir, { recursive: true });

      // 创建无效文件（不是 JSON）
      writeFileSync(join(agentIdentitiesDir, 'invalid.json'), 'not json');

      // 创建结构无效的文件
      const invalidIdentity = { agentId: 'invalid' }; // 缺少必须字段
      writeFileSync(join(agentIdentitiesDir, 'agent:invalid:123.json'), JSON.stringify(invalidIdentity));

      store.loadAll();

      expect(store.list().length).toBe(0);
    });

    it('should skip files that do not start with agent:', () => {
      mkdirSync(agentIdentitiesDir, { recursive: true });

      // 创建不符合命名规范的文件
      const identity = createMockIdentity();
      writeFileSync(join(agentIdentitiesDir, 'other-file.json'), JSON.stringify(identity));

      store.loadAll();

      expect(store.list().length).toBe(0);
    });

    it('should handle empty directory', () => {
      mkdirSync(agentIdentitiesDir, { recursive: true });

      store.loadAll();

      expect(store.list().length).toBe(0);
    });

    it('should handle non-existent directory', () => {
      // 不创建 agents 目录，loadAll 应该自动创建
      store.loadAll();

      expect(existsSync(agentIdentitiesDir)).toBe(true);
      expect(store.list().length).toBe(0);
    });
  });

  describe('get()', () => {
    it('should return saved identity', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      const retrieved = store.get(identity.agentId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.agentId).toBe(identity.agentId);
      expect(retrieved?.name).toBe(identity.name);
    });

    it('should return undefined for non-existent identity', () => {
      const retrieved = store.get('agent:not-exist:1234');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('should return all identities', async () => {
      const identity1 = createMockIdentity('agent:xxx:11111111');
      const identity2 = createMockIdentity('agent:xxx:22222222');

      await store.save(identity1);
      await store.save(identity2);

      const list = store.list();

      expect(list.length).toBe(2);
      expect(list.some(i => i.agentId === identity1.agentId)).toBe(true);
      expect(list.some(i => i.agentId === identity2.agentId)).toBe(true);
    });

    it('should return empty array when no identities', () => {
      store.loadAll();

      expect(store.list().length).toBe(0);
    });
  });

  describe('updateWebhook()', () => {
    it('should update webhook URL', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      const newWebhook: AgentWebhook = { url: 'http://new-url', token: 'new-token' };
      const updated = await store.updateWebhook(identity.agentId, newWebhook);

      expect(updated.webhook?.url).toBe('http://new-url');
      expect(updated.webhook?.token).toBe('new-token');

      // 内存中的 identity 应该更新
      const retrieved = store.get(identity.agentId);
      expect(retrieved?.webhook?.url).toBe('http://new-url');
    });

    it('should remove webhook when undefined', async () => {
      const identity = createMockIdentity();
      identity.webhook = { url: 'http://original-url' };
      await store.save(identity);

      const updated = await store.updateWebhook(identity.agentId, undefined);

      expect(updated.webhook).toBeUndefined();
    });

    it('should throw if identity not found', async () => {
      await expect(store.updateWebhook('agent:not-exist', { url: 'http://...' }))
        .rejects.toThrow('Agent identity not found');
    });

    it('should update lastActiveAt', async () => {
      const identity = createMockIdentity();
      identity.lastActiveAt = '2020-01-01T00:00:00Z';
      await store.save(identity);

      const updated = await store.updateWebhook(identity.agentId, { url: 'http://new' });

      // lastActiveAt 应该更新为当前时间
      expect(new Date(updated.lastActiveAt).getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00Z').getTime()
      );
    });
  });

  describe('updateLastActive()', () => {
    it('should update lastActiveAt', async () => {
      const identity = createMockIdentity();
      identity.lastActiveAt = '2020-01-01T00:00:00Z';
      await store.save(identity);

      const updated = await store.updateLastActive(identity.agentId);

      expect(new Date(updated.lastActiveAt).getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00Z').getTime()
      );
    });

    it('should throw if identity not found', async () => {
      await expect(store.updateLastActive('agent:not-exist'))
        .rejects.toThrow('Agent identity not found');
    });
  });

  describe('delete()', () => {
    it('should delete identity', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      const result = await store.delete(identity.agentId);

      expect(result).toBe(true);
      expect(store.get(identity.agentId)).toBeUndefined();

      // 文件也应该被删除
      const file = join(agentIdentitiesDir, `${identity.agentId}.json`);
      expect(existsSync(file)).toBe(false);
    });

    it('should return false for non-existent identity', async () => {
      const result = await store.delete('agent:not-exist');

      expect(result).toBe(false);
    });
  });

  describe('has()', () => {
    it('should return true for existing identity', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      expect(store.has(identity.agentId)).toBe(true);
    });

    it('should return false for non-existent identity', () => {
      expect(store.has('agent:not-exist')).toBe(false);
    });
  });

  describe('size()', () => {
    it('should return correct count', async () => {
      expect(store.size()).toBe(0);

      await store.save(createMockIdentity('agent:xxx:1111'));
      expect(store.size()).toBe(1);

      await store.save(createMockIdentity('agent:xxx:2222'));
      expect(store.size()).toBe(2);

      await store.delete('agent:xxx:1111');
      expect(store.size()).toBe(1);
    });
  });

  describe('findBy()', () => {
    it('should find identities matching predicate', async () => {
      const identity1 = createMockIdentity('agent:xxx:1111');
      identity1.name = 'Agent A';
      const identity2 = createMockIdentity('agent:xxx:2222');
      identity2.name = 'Agent B';

      await store.save(identity1);
      await store.save(identity2);

      const found = store.findBy(i => i.name === 'Agent A');

      expect(found.length).toBe(1);
      expect(found[0].agentId).toBe(identity1.agentId);
    });
  });

  describe('findByPeerId()', () => {
    it('should find identities by peerId', async () => {
      const identity1 = createMockIdentity('agent:peer1:1111');
      identity1.peerId = 'peer1';
      const identity2 = createMockIdentity('agent:peer2:2222');
      identity2.peerId = 'peer2';
      const identity3 = createMockIdentity('agent:peer1:3333');
      identity3.peerId = 'peer1';

      await store.save(identity1);
      await store.save(identity2);
      await store.save(identity3);

      const found = store.findByPeerId('peer1');

      expect(found.length).toBe(2);
      expect(found.some(i => i.agentId === identity1.agentId)).toBe(true);
      expect(found.some(i => i.agentId === identity3.agentId)).toBe(true);
    });
  });

  describe('findByCapability()', () => {
    it('should find identities by capability', async () => {
      const identity1 = createMockIdentity('agent:xxx:1111');
      identity1.capabilities = [{ name: 'chat', version: '1.0.0' }];
      const identity2 = createMockIdentity('agent:xxx:2222');
      identity2.capabilities = [{ name: 'code-gen', version: '1.0.0' }];

      await store.save(identity1);
      await store.save(identity2);

      const found = store.findByCapability('chat');

      expect(found.length).toBe(1);
      expect(found[0].agentId).toBe(identity1.agentId);
    });

    it('should find identities with multiple capabilities', async () => {
      const identity = createMockIdentity();
      identity.capabilities = [
        { name: 'chat', version: '1.0.0' },
        { name: 'code-gen', version: '1.0.0' },
      ];
      await store.save(identity);

      expect(store.findByCapability('chat').length).toBe(1);
      expect(store.findByCapability('code-gen').length).toBe(1);
    });
  });

  describe('clear()', () => {
    it('should clear all identities', async () => {
      await store.save(createMockIdentity('agent:xxx:1111'));
      await store.save(createMockIdentity('agent:xxx:2222'));

      await store.clear();

      expect(store.size()).toBe(0);

      // 文件也应该被删除
      const files = readdirSync(agentIdentitiesDir).filter(f => f.startsWith('agent:'));
      expect(files.length).toBe(0);
    });
  });

  describe('export()', () => {
    it('should export identity as JSON string', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      const exported = store.export(identity.agentId);

      expect(exported).toContain(identity.agentId);
      expect(exported).toContain(identity.name);

      // 应该是有效的 JSON
      const parsed = JSON.parse(exported);
      expect(parsed.agentId).toBe(identity.agentId);
    });

    it('should throw if identity not found', () => {
      expect(() => store.export('agent:not-exist'))
        .toThrow('Agent identity not found');
    });
  });

  describe('import()', () => {
    it('should import identity from JSON string', async () => {
      const identity = createMockIdentity('agent:import:1234');
      const json = JSON.stringify(identity);

      const imported = await store.import(json);

      expect(imported.agentId).toBe(identity.agentId);
      expect(store.get(identity.agentId)).toBeDefined();
    });

    it('should throw on invalid structure', async () => {
      const invalidJson = JSON.stringify({ agentId: 'invalid' });

      await expect(store.import(invalidJson))
        .rejects.toThrow('Invalid AgentIdentity structure in import');
    });
  });

  describe('签名验证（可选）', () => {
    it('should skip identity with invalid nodeSignature when verify function provided', () => {
      // 创建带签名验证的 store
      const verifyFn = vi.fn((agentId, nodeSignature, peerId) => {
        // 简单验证：nodeSignature 必须以 'valid-' 开头
        return nodeSignature.startsWith('valid-');
      });

      const storeWithVerify = new AgentIdentityStore(testDir, verifyFn);

      mkdirSync(agentIdentitiesDir, { recursive: true });

      // 创建有效签名的 identity
      const validIdentity = createMockIdentity('agent:valid:1111');
      validIdentity.nodeSignature = 'valid-signature';
      writeFileSync(join(agentIdentitiesDir, `${validIdentity.agentId}.json`), JSON.stringify(validIdentity));

      // 创建无效签名的 identity
      const invalidIdentity = createMockIdentity('agent:invalid:2222');
      invalidIdentity.nodeSignature = 'invalid-signature';
      writeFileSync(join(agentIdentitiesDir, `${invalidIdentity.agentId}.json`), JSON.stringify(invalidIdentity));

      storeWithVerify.loadAll();

      expect(storeWithVerify.has(validIdentity.agentId)).toBe(true);
      expect(storeWithVerify.has(invalidIdentity.agentId)).toBe(false);
      expect(verifyFn).toHaveBeenCalled();
    });

    it('should load all identities without verify function', () => {
      // 不提供验证函数，所有有效结构的 identity 都应该被加载
      mkdirSync(agentIdentitiesDir, { recursive: true });

      const identity = createMockIdentity();
      identity.nodeSignature = 'any-signature';
      writeFileSync(join(agentIdentitiesDir, `${identity.agentId}.json`), JSON.stringify(identity));

      store.loadAll();

      expect(store.has(identity.agentId)).toBe(true);
    });

    it('should load identity without nodeSignature when verify function provided', () => {
      // nodeSignature 是可选的，没有签名也应该能加载
      const verifyFn = vi.fn();
      const storeWithVerify = new AgentIdentityStore(testDir, verifyFn);

      mkdirSync(agentIdentitiesDir, { recursive: true });

      const identity = createMockIdentity('agent:nosig:1111');
      delete identity.nodeSignature;
      writeFileSync(join(agentIdentitiesDir, `${identity.agentId}.json`), JSON.stringify(identity));

      storeWithVerify.loadAll();

      // 应该成功加载，且不调用验证函数
      expect(storeWithVerify.has(identity.agentId)).toBe(true);
      expect(verifyFn).not.toHaveBeenCalled();
    });
  });

  describe('安全防护', () => {
    it('should filter dangerous keys in JSON.parse', () => {
      mkdirSync(agentIdentitiesDir, { recursive: true });

      // 创建包含危险 key 的文件
      const maliciousContent = JSON.stringify({
        agentId: 'agent:test:1234',
        name: 'Test',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        peerId: 'test-peer',
        nodeSignature: 'test-sig',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        __proto__: { malicious: true },
        constructor: { prototype: { malicious: true } },
      });

      writeFileSync(join(agentIdentitiesDir, 'agent:test:1234.json'), maliciousContent);

      store.loadAll();

      const identity = store.get('agent:test:1234');
      expect(identity).toBeDefined();
      
      // 危险 key 应该被过滤掉 - 检查恶意属性未被注入
      // 注意：所有对象都有内置 __proto__ 属性，所以检查恶意属性
      // @ts-ignore - 检查动态属性
      expect(identity?.__proto__?.malicious).toBeUndefined();
    });
  });

  describe('RFC008 新字段验证', () => {
    it('should save and retrieve publicKey and privateKey correctly', async () => {
      const identity = createMockIdentity();
      await store.save(identity);

      const retrieved = store.get(identity.agentId);
      
      // 验证新字段被正确保存和读取（具体值验证）
      expect(retrieved?.publicKey).toBe('dGVzdC1wdWJsaWMta2V5LWJhc2U2NA==');
      expect(retrieved?.privateKey).toBe('dGVzdC1wcml2YXRlLWtleS1iYXNlNjQ=');
      expect(retrieved?.nodeSignature).toBe('mock-node-signature');
      expect(retrieved?.nodeId).toBe('node:test-node-id');
    });

    it('should validate publicKey is required', async () => {
      const invalidIdentity = {
        agentId: 'agent:xxx',
        name: 'Invalid',
        peerId: 'peer1',
        // 缺少 publicKey
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      } as AgentIdentity;

      await expect(store.save(invalidIdentity)).rejects.toThrow('Invalid AgentIdentity structure');
    });

    it('should allow missing optional fields (privateKey, nodeSignature, nodeId)', async () => {
      const minimalIdentity: AgentIdentity = {
        agentId: 'agent:minimal:1111',
        name: 'Minimal Agent',
        publicKey: 'bWluaW1hbC1wdWJsaWMta2V5',
        peerId: 'peer-minimal',
        capabilities: [],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };

      await store.save(minimalIdentity);

      const retrieved = store.get(minimalIdentity.agentId);
      expect(retrieved?.publicKey).toBe('bWluaW1hbC1wdWJsaWMta2V5');
      expect(retrieved?.privateKey).toBeUndefined();
      expect(retrieved?.nodeSignature).toBeUndefined();
      expect(retrieved?.nodeId).toBeUndefined();
    });

    it('should persist identity with new RFC008 fields to file', async () => {
      const identity = createMockIdentity('agent:rfc008:test');
      identity.nodeId = 'node:rfc008-node';
      identity.nodeSignature = 'rfc008-signature-base64';
      
      await store.save(identity);

      const file = join(agentIdentitiesDir, `${identity.agentId}.json`);
      const content = JSON.parse(readFileSync(file, 'utf-8'));

      // 验证文件内容包含所有 RFC008 字段
      expect(content.publicKey).toBe('dGVzdC1wdWJsaWMta2V5LWJhc2U2NA==');
      expect(content.privateKey).toBe('dGVzdC1wcml2YXRlLWtleS1iYXNlNjQ=');
      expect(content.nodeId).toBe('node:rfc008-node');
      expect(content.nodeSignature).toBe('rfc008-signature-base64');
    });

    it('should reject identity with empty publicKey', async () => {
      const invalidIdentity: AgentIdentity = {
        agentId: 'agent:emptykey',
        name: 'Empty Key',
        publicKey: '', // 空 publicKey
        peerId: 'peer1',
        capabilities: [],
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };

      await expect(store.save(invalidIdentity)).rejects.toThrow('Invalid AgentIdentity structure');
    });

    it('should reject identity with missing name', async () => {
      const invalidIdentity = {
        agentId: 'agent:noname',
        publicKey: 'c29tZS1rZXk=',
        peerId: 'peer1',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      } as AgentIdentity;

      await expect(store.save(invalidIdentity)).rejects.toThrow('Invalid AgentIdentity structure');
    });
  });
});