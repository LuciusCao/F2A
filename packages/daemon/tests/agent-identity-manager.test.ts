/**
 * Agent Identity Manager 测试 (RFC 004 Phase 6)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentIdentityManager, AgentIdentity, AgentWebhook } from '../src/agent-identity-manager.js';
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
 * 创建 Mock AgentIdentity
 */
function createMockIdentity(agentId?: string): AgentIdentity {
  return {
    agentId: agentId || 'agent:12D3KooWtest:12345678',
    name: 'Test Agent',
    peerId: '12D3KooWtest...',
    signature: 'mock-signature',
    e2eePublicKey: 'mock-public-key',
    webhook: { url: 'http://127.0.0.1:9002/f2a/webhook' },
    capabilities: [{ name: 'chat', version: '1.0.0' }],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

describe('AgentIdentityManager', () => {
  let manager: AgentIdentityManager;
  let testDir: string;
  let agentsDir: string;

  beforeEach(() => {
    // 创建测试目录
    testDir = join(tmpdir(), `agent-identity-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    agentsDir = join(testDir, 'agents');
    
    // 创建 Manager（不使用签名验证）
    manager = new AgentIdentityManager(testDir);
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('save()', () => {
    it('should save identity file', () => {
      const identity = createMockIdentity();
      manager.save(identity);

      const file = join(agentsDir, `${identity.agentId}.json`);
      expect(existsSync(file)).toBe(true);

      const content = JSON.parse(readFileSync(file, 'utf-8'));
      expect(content.agentId).toBe(identity.agentId);
      expect(content.name).toBe(identity.name);
    });

    it('should create agents directory if not exists', () => {
      // 测试目录存在，但 agents 子目录不存在
      expect(existsSync(agentsDir)).toBe(false);

      const identity = createMockIdentity();
      manager.save(identity);

      // agents 目录应该被自动创建
      expect(existsSync(agentsDir)).toBe(true);
    });

    it('should update existing identity', () => {
      const identity = createMockIdentity();
      manager.save(identity);

      // 更新名称
      identity.name = 'Updated Name';
      manager.save(identity);

      const retrieved = manager.get(identity.agentId);
      expect(retrieved?.name).toBe('Updated Name');

      // 文件内容也应该更新
      const file = join(agentsDir, `${identity.agentId}.json`);
      const content = JSON.parse(readFileSync(file, 'utf-8'));
      expect(content.name).toBe('Updated Name');
    });

    it('should throw on invalid identity structure', () => {
      const invalidIdentity = {
        // 缺少必须字段
        agentId: 'agent:xxx',
        name: 'Invalid',
      } as AgentIdentity;

      expect(() => manager.save(invalidIdentity)).toThrow('Invalid AgentIdentity structure');
    });
  });

  describe('loadAll()', () => {
    it('should load all identity files on startup', () => {
      // 手动创建 agents 目录和多个 identity 文件
      mkdirSync(agentsDir, { recursive: true });

      const identity1 = createMockIdentity('agent:xxx:11111111');
      const identity2 = createMockIdentity('agent:xxx:22222222');

      writeFileSync(join(agentsDir, `${identity1.agentId}.json`), JSON.stringify(identity1));
      writeFileSync(join(agentsDir, `${identity2.agentId}.json`), JSON.stringify(identity2));

      manager.loadAll();

      expect(manager.list().length).toBe(2);
      expect(manager.get(identity1.agentId)).toBeDefined();
      expect(manager.get(identity2.agentId)).toBeDefined();
    });

    it('should skip invalid identity files', () => {
      mkdirSync(agentsDir, { recursive: true });

      // 创建无效文件（不是 JSON）
      writeFileSync(join(agentsDir, 'invalid.json'), 'not json');

      // 创建结构无效的文件
      const invalidIdentity = { agentId: 'invalid' }; // 缺少必须字段
      writeFileSync(join(agentsDir, 'agent:invalid:123.json'), JSON.stringify(invalidIdentity));

      manager.loadAll();

      expect(manager.list().length).toBe(0);
    });

    it('should skip files that do not start with agent:', () => {
      mkdirSync(agentsDir, { recursive: true });

      // 创建不符合命名规范的文件
      const identity = createMockIdentity();
      writeFileSync(join(agentsDir, 'other-file.json'), JSON.stringify(identity));

      manager.loadAll();

      expect(manager.list().length).toBe(0);
    });

    it('should handle empty directory', () => {
      mkdirSync(agentsDir, { recursive: true });

      manager.loadAll();

      expect(manager.list().length).toBe(0);
    });

    it('should handle non-existent directory', () => {
      // 不创建 agents 目录，loadAll 应该自动创建
      manager.loadAll();

      expect(existsSync(agentsDir)).toBe(true);
      expect(manager.list().length).toBe(0);
    });
  });

  describe('get()', () => {
    it('should return saved identity', () => {
      const identity = createMockIdentity();
      manager.save(identity);

      const retrieved = manager.get(identity.agentId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.agentId).toBe(identity.agentId);
      expect(retrieved?.name).toBe(identity.name);
    });

    it('should return undefined for non-existent identity', () => {
      const retrieved = manager.get('agent:not-exist:1234');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('should return all identities', () => {
      const identity1 = createMockIdentity('agent:xxx:11111111');
      const identity2 = createMockIdentity('agent:xxx:22222222');

      manager.save(identity1);
      manager.save(identity2);

      const list = manager.list();

      expect(list.length).toBe(2);
      expect(list.some(i => i.agentId === identity1.agentId)).toBe(true);
      expect(list.some(i => i.agentId === identity2.agentId)).toBe(true);
    });

    it('should return empty array when no identities', () => {
      manager.loadAll();

      expect(manager.list().length).toBe(0);
    });
  });

  describe('updateWebhook()', () => {
    it('should update webhook URL', () => {
      const identity = createMockIdentity();
      manager.save(identity);

      const newWebhook: AgentWebhook = { url: 'http://new-url', token: 'new-token' };
      const updated = manager.updateWebhook(identity.agentId, newWebhook);

      expect(updated.webhook?.url).toBe('http://new-url');
      expect(updated.webhook?.token).toBe('new-token');

      // 内存中的 identity 应该更新
      const retrieved = manager.get(identity.agentId);
      expect(retrieved?.webhook?.url).toBe('http://new-url');
    });

    it('should remove webhook when undefined', () => {
      const identity = createMockIdentity();
      identity.webhook = { url: 'http://original-url' };
      manager.save(identity);

      const updated = manager.updateWebhook(identity.agentId, undefined);

      expect(updated.webhook).toBeUndefined();
    });

    it('should throw if identity not found', () => {
      expect(() => manager.updateWebhook('agent:not-exist', { url: 'http://...' }))
        .toThrow('Agent identity not found');
    });

    it('should update lastActiveAt', () => {
      const identity = createMockIdentity();
      identity.lastActiveAt = '2020-01-01T00:00:00Z';
      manager.save(identity);

      const updated = manager.updateWebhook(identity.agentId, { url: 'http://new' });

      // lastActiveAt 应该更新为当前时间
      expect(new Date(updated.lastActiveAt).getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00Z').getTime()
      );
    });
  });

  describe('updateLastActive()', () => {
    it('should update lastActiveAt', () => {
      const identity = createMockIdentity();
      identity.lastActiveAt = '2020-01-01T00:00:00Z';
      manager.save(identity);

      const updated = manager.updateLastActive(identity.agentId);

      expect(new Date(updated.lastActiveAt).getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00Z').getTime()
      );
    });

    it('should throw if identity not found', () => {
      expect(() => manager.updateLastActive('agent:not-exist'))
        .toThrow('Agent identity not found');
    });
  });

  describe('delete()', () => {
    it('should delete identity', () => {
      const identity = createMockIdentity();
      manager.save(identity);

      const result = manager.delete(identity.agentId);

      expect(result).toBe(true);
      expect(manager.get(identity.agentId)).toBeUndefined();

      // 文件也应该被删除
      const file = join(agentsDir, `${identity.agentId}.json`);
      expect(existsSync(file)).toBe(false);
    });

    it('should return false for non-existent identity', () => {
      const result = manager.delete('agent:not-exist');

      expect(result).toBe(false);
    });
  });

  describe('has()', () => {
    it('should return true for existing identity', () => {
      const identity = createMockIdentity();
      manager.save(identity);

      expect(manager.has(identity.agentId)).toBe(true);
    });

    it('should return false for non-existent identity', () => {
      expect(manager.has('agent:not-exist')).toBe(false);
    });
  });

  describe('size()', () => {
    it('should return correct count', () => {
      expect(manager.size()).toBe(0);

      manager.save(createMockIdentity('agent:xxx:1111'));
      expect(manager.size()).toBe(1);

      manager.save(createMockIdentity('agent:xxx:2222'));
      expect(manager.size()).toBe(2);

      manager.delete('agent:xxx:1111');
      expect(manager.size()).toBe(1);
    });
  });

  describe('findBy()', () => {
    it('should find identities matching predicate', () => {
      const identity1 = createMockIdentity('agent:xxx:1111');
      identity1.name = 'Agent A';
      const identity2 = createMockIdentity('agent:xxx:2222');
      identity2.name = 'Agent B';

      manager.save(identity1);
      manager.save(identity2);

      const found = manager.findBy(i => i.name === 'Agent A');

      expect(found.length).toBe(1);
      expect(found[0].agentId).toBe(identity1.agentId);
    });
  });

  describe('findByPeerId()', () => {
    it('should find identities by peerId', () => {
      const identity1 = createMockIdentity('agent:peer1:1111');
      identity1.peerId = 'peer1';
      const identity2 = createMockIdentity('agent:peer2:2222');
      identity2.peerId = 'peer2';
      const identity3 = createMockIdentity('agent:peer1:3333');
      identity3.peerId = 'peer1';

      manager.save(identity1);
      manager.save(identity2);
      manager.save(identity3);

      const found = manager.findByPeerId('peer1');

      expect(found.length).toBe(2);
      expect(found.some(i => i.agentId === identity1.agentId)).toBe(true);
      expect(found.some(i => i.agentId === identity3.agentId)).toBe(true);
    });
  });

  describe('findByCapability()', () => {
    it('should find identities by capability', () => {
      const identity1 = createMockIdentity('agent:xxx:1111');
      identity1.capabilities = [{ name: 'chat', version: '1.0.0' }];
      const identity2 = createMockIdentity('agent:xxx:2222');
      identity2.capabilities = [{ name: 'code-gen', version: '1.0.0' }];

      manager.save(identity1);
      manager.save(identity2);

      const found = manager.findByCapability('chat');

      expect(found.length).toBe(1);
      expect(found[0].agentId).toBe(identity1.agentId);
    });

    it('should find identities with multiple capabilities', () => {
      const identity = createMockIdentity();
      identity.capabilities = [
        { name: 'chat', version: '1.0.0' },
        { name: 'code-gen', version: '1.0.0' },
      ];
      manager.save(identity);

      expect(manager.findByCapability('chat').length).toBe(1);
      expect(manager.findByCapability('code-gen').length).toBe(1);
    });
  });

  describe('clear()', () => {
    it('should clear all identities', () => {
      manager.save(createMockIdentity('agent:xxx:1111'));
      manager.save(createMockIdentity('agent:xxx:2222'));

      manager.clear();

      expect(manager.size()).toBe(0);

      // 文件也应该被删除
      const files = readdirSync(agentsDir).filter(f => f.startsWith('agent:'));
      expect(files.length).toBe(0);
    });
  });

  describe('export()', () => {
    it('should export identity as JSON string', () => {
      const identity = createMockIdentity();
      manager.save(identity);

      const exported = manager.export(identity.agentId);

      expect(exported).toContain(identity.agentId);
      expect(exported).toContain(identity.name);

      // 应该是有效的 JSON
      const parsed = JSON.parse(exported);
      expect(parsed.agentId).toBe(identity.agentId);
    });

    it('should throw if identity not found', () => {
      expect(() => manager.export('agent:not-exist'))
        .toThrow('Agent identity not found');
    });
  });

  describe('import()', () => {
    it('should import identity from JSON string', () => {
      const identity = createMockIdentity('agent:import:1234');
      const json = JSON.stringify(identity);

      const imported = manager.import(json);

      expect(imported.agentId).toBe(identity.agentId);
      expect(manager.get(identity.agentId)).toBeDefined();
    });

    it('should throw on invalid structure', () => {
      const invalidJson = JSON.stringify({ agentId: 'invalid' });

      expect(() => manager.import(invalidJson))
        .toThrow('Invalid AgentIdentity structure in import');
    });
  });

  describe('签名验证（可选）', () => {
    it('should skip identity with invalid signature when verify function provided', () => {
      // 创建带签名验证的 manager
      const verifyFn = vi.fn((agentId, signature, peerId) => {
        // 简单验证：signature 必须以 'valid-' 开头
        return signature.startsWith('valid-');
      });

      const managerWithVerify = new AgentIdentityManager(testDir, verifyFn);

      mkdirSync(agentsDir, { recursive: true });

      // 创建有效签名的 identity
      const validIdentity = createMockIdentity('agent:valid:1111');
      validIdentity.signature = 'valid-signature';
      writeFileSync(join(agentsDir, `${validIdentity.agentId}.json`), JSON.stringify(validIdentity));

      // 创建无效签名的 identity
      const invalidIdentity = createMockIdentity('agent:invalid:2222');
      invalidIdentity.signature = 'invalid-signature';
      writeFileSync(join(agentsDir, `${invalidIdentity.agentId}.json`), JSON.stringify(invalidIdentity));

      managerWithVerify.loadAll();

      expect(managerWithVerify.has(validIdentity.agentId)).toBe(true);
      expect(managerWithVerify.has(invalidIdentity.agentId)).toBe(false);
      expect(verifyFn).toHaveBeenCalled();
    });

    it('should load all identities without verify function', () => {
      // 不提供验证函数，所有有效结构的 identity 都应该被加载
      mkdirSync(agentsDir, { recursive: true });

      const identity = createMockIdentity();
      identity.signature = 'any-signature';
      writeFileSync(join(agentsDir, `${identity.agentId}.json`), JSON.stringify(identity));

      manager.loadAll();

      expect(manager.has(identity.agentId)).toBe(true);
    });
  });

  describe('安全防护', () => {
    it('should filter dangerous keys in JSON.parse', () => {
      mkdirSync(agentsDir, { recursive: true });

      // 创建包含危险 key 的文件
      const maliciousContent = JSON.stringify({
        agentId: 'agent:test:1234',
        name: 'Test',
        peerId: 'test-peer',
        signature: 'test-sig',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        __proto__: { malicious: true },
        constructor: { prototype: { malicious: true } },
      });

      writeFileSync(join(agentsDir, 'agent:test:1234.json'), maliciousContent);

      manager.loadAll();

      const identity = manager.get('agent:test:1234');
      expect(identity).toBeDefined();
      
      // 危险 key 应该被过滤掉 - 检查恶意属性未被注入
      // 注意：所有对象都有内置 __proto__ 属性，所以检查恶意属性
      // @ts-ignore - 检查动态属性
      expect(identity?.__proto__?.malicious).toBeUndefined();
    });
  });
});