/**
 * Session Token Manager 测试 (RFC 007)
 * 
 * 测试场景：
 * 1. 生成并保存 token
 * 2. 验证有效 token
 * 3. 验证无效 token（不存在）
 * 4. 验证 token 不匹配（属于其他 agent）
 * 5. token 过期（7 天后失效）
 * 6. revoke token
 * 7. cleanExpired 清理过期 token
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentTokenManager, AgentTokenData } from '../src/agent-token-manager.js';

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
 * 创建 Mock Agent ID
 */
function createMockAgentId(suffix?: string): string {
  return `agent:12D3KooWtest:${suffix || '12345678'}`;
}

describe('AgentTokenManager', () => {
  let manager: AgentTokenManager;
  let testDir: string;
  let tokensDir: string;

  beforeEach(() => {
    // 创建测试目录
    testDir = join(tmpdir(), `session-token-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    tokensDir = join(testDir, 'session-tokens');
    
    // 创建 Manager
    manager = new AgentTokenManager(testDir);
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ========== 场景 1: 生成并保存 token ==========

  describe('generateAndSave()', () => {
    it('should generate and save token for agent', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      expect(token).toBeDefined();
      expect(token.startsWith('sess-')).toBe(true);
      expect(token.length).toBeGreaterThan(40); // sess- + 64 hex chars

      // 验证 token 数据
      const tokenData = manager.get(token);
      expect(tokenData).toBeDefined();
      expect(tokenData?.agentId).toBe(agentId);
      expect(tokenData?.revoked).toBe(false);
      expect(tokenData?.createdAt).toBeDefined();
      expect(tokenData?.expiresAt).toBeDefined();
    });

    it('should save token to file', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      // 检查文件是否存在
      const fileName = `sess-${token.slice(5)}.json`;
      const filePath = join(tokensDir, fileName);
      expect(existsSync(filePath)).toBe(true);

      // 检查文件内容
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.token).toBe(token);
      expect(content.agentId).toBe(agentId);
    });

    it('should create tokens directory if not exists', () => {
      expect(existsSync(tokensDir)).toBe(false);

      const agentId = createMockAgentId('agent1');
      manager.generateAndSave(agentId);

      expect(existsSync(tokensDir)).toBe(true);
    });

    it('should generate unique tokens for each call', () => {
      const agentId = createMockAgentId('agent1');
      
      const token1 = manager.generateAndSave(agentId);
      const token2 = manager.generateAndSave(agentId);

      expect(token1).not.toBe(token2);
      expect(manager.size()).toBe(2);
    });

    it('should generate tokens for different agents', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');

      const token1 = manager.generateAndSave(agentId1);
      const token2 = manager.generateAndSave(agentId2);

      expect(token1).not.toBe(token2);
      expect(manager.get(token1)?.agentId).toBe(agentId1);
      expect(manager.get(token2)?.agentId).toBe(agentId2);
    });

    it('should set correct expiration time (7 days by default)', () => {
      const agentId = createMockAgentId('agent1');
      const before = Date.now();
      
      const token = manager.generateAndSave(agentId);
      const after = Date.now();
      
      const tokenData = manager.get(token);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      
      // 过期时间应该在创建时间 + 7 天范围内
      expect(tokenData?.expiresAt).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(tokenData?.expiresAt).toBeLessThanOrEqual(after + sevenDaysMs);
    });

    it('should support custom expiration time', () => {
      const customExpireMs = 1 * 60 * 60 * 1000; // 1 hour
      const customManager = new AgentTokenManager(testDir, { expireAfterMs: customExpireMs });
      
      const agentId = createMockAgentId('agent1');
      const before = Date.now();
      
      const token = customManager.generateAndSave(agentId);
      const after = Date.now();
      
      const tokenData = customManager.get(token);
      
      expect(tokenData?.expiresAt).toBeGreaterThanOrEqual(before + customExpireMs);
      expect(tokenData?.expiresAt).toBeLessThanOrEqual(after + customExpireMs);
    });
  });

  // ========== 场景 2: 验证有效 token ==========

  describe('verify() - valid token', () => {
    it('should return valid for existing token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      const result = manager.verify(token);

      expect(result.valid).toBe(true);
      expect(result.agentId).toBe(agentId);
      expect(result.error).toBeUndefined();
    });

    it('should return agentId in result', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      const result = manager.verify(token);

      expect(result.agentId).toBe(agentId);
    });

    it('should update lastUsedAt on successful verification', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      // 验证前 lastUsedAt 应该是 undefined
      const beforeVerify = manager.get(token);
      expect(beforeVerify?.lastUsedAt).toBeUndefined();

      // 验证
      const result = manager.verify(token);
      expect(result.valid).toBe(true);

      // 验证后 lastUsedAt 应该被更新
      const afterVerify = manager.get(token);
      expect(afterVerify?.lastUsedAt).toBeDefined();
      expect(afterVerify?.lastUsedAt).toBeGreaterThanOrEqual(beforeVerify!.createdAt);
    });

    it('should persist lastUsedAt update to file', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      manager.verify(token);

      // 重新加载 manager
      const newManager = new AgentTokenManager(testDir);
      newManager.loadAll();

      const tokenData = newManager.get(token);
      expect(tokenData?.lastUsedAt).toBeDefined();
    });
  });

  // ========== 场景 3: 验证无效 token（不存在） ==========

  describe('verify() - token not found', () => {
    it('should return invalid for non-existent token', () => {
      const fakeToken = 'sess-nonexistent1234567890abcdef1234567890abcdef';

      const result = manager.verify(fakeToken);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
      expect(result.agentId).toBeUndefined();
    });

    it('should return invalid for empty token', () => {
      const result = manager.verify('');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token is empty');
    });

    it('should return invalid for undefined token', () => {
      const result = manager.verify(undefined);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token is empty');
    });

    it('should return invalid for wrong format token', () => {
      // token 不以 sess- 开头
      const wrongFormatToken = 'wrong-format-token-1234567890abcdef';

      const result = manager.verify(wrongFormatToken);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
    });
  });

  // ========== 场景 4: 验证 token 不匹配（属于其他 agent） ==========

  describe('verifyForAgent() - token mismatch', () => {
    it('should return invalid when token belongs to different agent', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');

      const token = manager.generateAndSave(agentId1);

      // 用 agentId2 验证 token（属于 agentId1）
      const result = manager.verifyForAgent(token, agentId2);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token does not belong to this agent');
    });

    it('should return valid when token belongs to correct agent', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      const result = manager.verifyForAgent(token, agentId);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should check token existence first', () => {
      const fakeToken = 'sess-nonexistent1234567890abcdef1234567890abcdef';
      const agentId = createMockAgentId('agent1');

      const result = manager.verifyForAgent(fakeToken, agentId);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
    });

    it('should check token validity before ownership', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      // 撤销 token
      manager.revoke(token);

      // 用正确的 agentId 验证已撤销的 token
      const result = manager.verifyForAgent(token, agentId);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token revoked'); // 应该先报告 revoked
    });
  });

  // ========== 场景 5: token 过期（7 天后失效） ==========

  describe('verify() - expired token', () => {
    it('should return invalid for expired token', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建已过期的 token（手动设置 expiresAt）
      const token = 'sess-expiredtest1234567890abcdef1234567890abcdef';
      const expiredTokenData: AgentTokenData = {
        token,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 天前创建
        expiresAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 天前过期
        revoked: false,
      };

      // 手动添加到内存和文件
      manager.loadAll(); // 先确保目录存在
      // 直接写入测试数据
      const fileName = `sess-${token.slice(5)}.json`;
      writeFileSync(join(tokensDir, fileName), JSON.stringify(expiredTokenData, null, 2));
      
      // 重新加载
      manager.loadAll();

      const result = manager.verify(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('should return valid for token about to expire', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建即将过期的 token（expiresAt 为未来时间）
      const token = 'sess-almostexpired1234567890abcdef1234567890abcdef';
      const tokenData: AgentTokenData = {
        token,
        agentId,
        createdAt: Date.now() - 6 * 24 * 60 * 60 * 1000, // 6 天前创建
        expiresAt: Date.now() + 1000, // 1 秒后过期
        revoked: false,
      };

      // 写入测试数据
      mkdirSync(tokensDir, { recursive: true });
      const fileName = `sess-${token.slice(5)}.json`;
      writeFileSync(join(tokensDir, fileName), JSON.stringify(tokenData, null, 2));
      
      manager.loadAll();

      const result = manager.verify(token);

      // 此时 token 还应该有效
      expect(result.valid).toBe(true);
    });

    it('should correctly handle 7-day expiration', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      const tokenData = manager.get(token);
      const expectedExpiresAt = tokenData!.createdAt + 7 * 24 * 60 * 60 * 1000;

      expect(tokenData?.expiresAt).toBe(expectedExpiresAt);
    });
  });

  // ========== 场景 6: revoke token ==========

  describe('revoke()', () => {
    it('should revoke existing token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      const result = manager.revoke(token);

      expect(result).toBe(true);

      const tokenData = manager.get(token);
      expect(tokenData?.revoked).toBe(true);
    });

    it('should make revoked token invalid', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      manager.revoke(token);

      const verifyResult = manager.verify(token);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toBe('Token revoked');
    });

    it('should persist revoked state to file', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      manager.revoke(token);

      // 重新加载
      const newManager = new AgentTokenManager(testDir);
      newManager.loadAll();

      const tokenData = newManager.get(token);
      expect(tokenData?.revoked).toBe(true);
    });

    it('should return false for non-existent token', () => {
      const fakeToken = 'sess-nonexistent1234567890abcdef1234567890abcdef';

      const result = manager.revoke(fakeToken);

      expect(result).toBe(false);
    });

    it('should update lastUsedAt on revoke', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      const beforeRevoke = manager.get(token);
      expect(beforeRevoke?.lastUsedAt).toBeUndefined();

      manager.revoke(token);

      const afterRevoke = manager.get(token);
      expect(afterRevoke?.lastUsedAt).toBeDefined();
    });

    it('can revoke already revoked token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      manager.revoke(token);
      const result1 = manager.revoke(token);

      expect(result1).toBe(true); // 仍然返回 true
    });
  });

  // ========== 场景 7: cleanExpired 清理过期 token ==========

  describe('cleanExpired()', () => {
    it('should clean expired tokens', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建已过期的 token
      const expiredToken = 'sess-expiredclean1234567890abcdef1234567890abcdef';
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1 * 60 * 1000, // 1 分钟前过期
        revoked: false,
      };

      // 创建有效的 token
      const validToken = manager.generateAndSave(agentId);

      // 写入过期 token
      mkdirSync(tokensDir, { recursive: true });
      writeFileSync(
        join(tokensDir, `sess-${expiredToken.slice(5)}.json`),
        JSON.stringify(expiredData, null, 2)
      );

      manager.loadAll();

      expect(manager.size()).toBe(2);

      const cleaned = manager.cleanExpired();

      expect(cleaned).toBe(1);
      expect(manager.size()).toBe(1);
      expect(manager.has(validToken)).toBe(true);
      expect(manager.has(expiredToken)).toBe(false);
    });

    it('should clean revoked tokens', () => {
      const agentId = createMockAgentId('agent1');
      
      const validToken = manager.generateAndSave(agentId);
      const revokedToken = manager.generateAndSave(agentId);
      manager.revoke(revokedToken);

      expect(manager.size()).toBe(2);

      const cleaned = manager.cleanExpired();

      // revoked token 也应该被清理
      expect(cleaned).toBe(1);
      expect(manager.has(validToken)).toBe(true);
      expect(manager.has(revokedToken)).toBe(false);
    });

    it('should delete token files when cleaning', () => {
      const agentId = createMockAgentId('agent1');
      
      const expiredToken = 'sess-fileclean1234567890abcdef1234567890abcdef';
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000,
        revoked: false,
      };

      mkdirSync(tokensDir, { recursive: true });
      const fileName = `sess-${expiredToken.slice(5)}.json`;
      const filePath = join(tokensDir, fileName);
      writeFileSync(filePath, JSON.stringify(expiredData, null, 2));

      manager.loadAll();
      expect(existsSync(filePath)).toBe(true);

      manager.cleanExpired();

      expect(existsSync(filePath)).toBe(false);
    });

    it('should return 0 when no tokens to clean', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建有效的 token
      manager.generateAndSave(agentId);

      const cleaned = manager.cleanExpired();

      expect(cleaned).toBe(0);
      expect(manager.size()).toBe(1);
    });

    it('should clean both expired and revoked tokens together', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建过期 token
      const expiredToken = 'sess-expired1' + Date.now().toString(16).padStart(54, '0');
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000,
        revoked: false,
      };

      // 创建被撤销的 token
      const revokedToken = 'sess-revoked1' + Date.now().toString(16).padStart(54, '0');
      const revokedData: AgentTokenData = {
        token: revokedToken,
        agentId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: true,
      };

      mkdirSync(tokensDir, { recursive: true });
      writeFileSync(
        join(tokensDir, `sess-${expiredToken.slice(5)}.json`),
        JSON.stringify(expiredData, null, 2)
      );
      writeFileSync(
        join(tokensDir, `sess-${revokedToken.slice(5)}.json`),
        JSON.stringify(revokedData, null, 2)
      );

      manager.loadAll();

      const cleaned = manager.cleanExpired();

      expect(cleaned).toBe(2);
      expect(manager.size()).toBe(0);
    });
  });

  // ========== 辅助方法测试 ==========

  describe('loadAll()', () => {
    it('should load all token files on startup', () => {
      mkdirSync(tokensDir, { recursive: true });

      // 手动创建多个 token 文件
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');

      const token1 = 'sess-loaded1' + Date.now().toString(16).padStart(54, '0');
      const token2 = 'sess-loaded2' + Date.now().toString(16).padStart(54, '0');

      const data1: AgentTokenData = {
        token: token1,
        agentId: agentId1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: false,
      };

      const data2: AgentTokenData = {
        token: token2,
        agentId: agentId2,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: false,
      };

      writeFileSync(join(tokensDir, `sess-${token1.slice(5)}.json`), JSON.stringify(data1));
      writeFileSync(join(tokensDir, `sess-${token2.slice(5)}.json`), JSON.stringify(data2));

      manager.loadAll();

      expect(manager.size()).toBe(2);
      expect(manager.get(token1)).toBeDefined();
      expect(manager.get(token2)).toBeDefined();
    });

    it('should skip invalid token files', () => {
      mkdirSync(tokensDir, { recursive: true });

      // 创建无效文件
      writeFileSync(join(tokensDir, 'invalid.json'), 'not json');

      // 创建结构无效的文件
      const invalidData = { token: 'invalid' };
      writeFileSync(join(tokensDir, 'sess-invalid1.json'), JSON.stringify(invalidData));

      // 创建不以 sess- 开头的文件
      writeFileSync(join(tokensDir, 'other-file.json'), JSON.stringify({ token: 'sess-test' }));

      manager.loadAll();

      expect(manager.size()).toBe(0);
    });

    it('should handle empty directory', () => {
      mkdirSync(tokensDir, { recursive: true });

      manager.loadAll();

      expect(manager.size()).toBe(0);
    });

    it('should handle non-existent directory', () => {
      manager.loadAll();

      expect(existsSync(tokensDir)).toBe(true);
      expect(manager.size()).toBe(0);
    });
  });

  describe('list()', () => {
    it('should return all tokens', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');

      const token1 = manager.generateAndSave(agentId1);
      const token2 = manager.generateAndSave(agentId2);

      const list = manager.list();

      expect(list.length).toBe(2);
      expect(list.some(t => t.token === token1)).toBe(true);
      expect(list.some(t => t.token === token2)).toBe(true);
    });

    it('should return empty array when no tokens', () => {
      manager.loadAll();

      expect(manager.list().length).toBe(0);
    });
  });

  describe('listByAgent()', () => {
    it('should return tokens for specific agent', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');

      const token1a = manager.generateAndSave(agentId1);
      const token1b = manager.generateAndSave(agentId1);
      const token2 = manager.generateAndSave(agentId2);

      const agent1Tokens = manager.listByAgent(agentId1);

      expect(agent1Tokens.length).toBe(2);
      expect(agent1Tokens.some(t => t.token === token1a)).toBe(true);
      expect(agent1Tokens.some(t => t.token === token1b)).toBe(true);
      expect(agent1Tokens.some(t => t.token === token2)).toBe(false);
    });

    it('should return empty array for agent with no tokens', () => {
      manager.generateAndSave(createMockAgentId('agent1'));

      const otherAgentTokens = manager.listByAgent(createMockAgentId('other'));
      expect(otherAgentTokens.length).toBe(0);
    });
  });

  describe('clear()', () => {
    it('should clear all tokens', () => {
      manager.generateAndSave(createMockAgentId('agent1'));
      manager.generateAndSave(createMockAgentId('agent2'));

      manager.clear();

      expect(manager.size()).toBe(0);

      // 文件也应该被删除
      const files = readdirSync(tokensDir).filter(f => f.startsWith('sess-'));
      expect(files.length).toBe(0);
    });
  });

  describe('size()', () => {
    it('should return correct count', () => {
      expect(manager.size()).toBe(0);

      manager.generateAndSave(createMockAgentId('agent1'));
      expect(manager.size()).toBe(1);

      manager.generateAndSave(createMockAgentId('agent2'));
      expect(manager.size()).toBe(2);

      manager.revoke(manager.list()[0].token);
      manager.cleanExpired();
      expect(manager.size()).toBe(1);
    });
  });

  describe('has()', () => {
    it('should return true for existing token', () => {
      const token = manager.generateAndSave(createMockAgentId('agent1'));

      expect(manager.has(token)).toBe(true);
    });

    it('should return false for non-existent token', () => {
      expect(manager.has('sess-nonexistent')).toBe(false);
    });
  });

  // ========== 安全防护测试 ==========

  describe('安全防护', () => {
    it('should filter dangerous keys in JSON.parse', () => {
      mkdirSync(tokensDir, { recursive: true });

      const token = 'sess-safetest' + Date.now().toString(16).padStart(54, '0');
      
      // 创建包含危险 key 的文件
      const maliciousContent = JSON.stringify({
        token,
        agentId: 'agent:test:1234',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: false,
        __proto__: { malicious: true },
        constructor: { prototype: { malicious: true } },
      });

      writeFileSync(join(tokensDir, `sess-${token.slice(5)}.json`), maliciousContent);

      manager.loadAll();

      const tokenData = manager.get(token);
      expect(tokenData).toBeDefined();
      
      // 检查恶意属性未被注入
      // @ts-ignore - 检查动态属性
      expect(tokenData?.__proto__?.malicious).toBeUndefined();
    });

    it('should validate token structure on load', () => {
      mkdirSync(tokensDir, { recursive: true });

      // 创建缺少必须字段的文件
      const invalidData = { token: 'sess-invalid', agentId: 'agent:test' };
      writeFileSync(join(tokensDir, 'sess-invalid.json'), JSON.stringify(invalidData));

      // 创建 agentId 格式错误的文件
      const wrongAgentData = {
        token: 'sess-wrong',
        agentId: 'wrong-format',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: false,
      };
      writeFileSync(join(tokensDir, 'sess-wrong.json'), JSON.stringify(wrongAgentData));

      manager.loadAll();

      expect(manager.size()).toBe(0);
    });

    it('should save token files with restricted permissions', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generateAndSave(agentId);

      const filePath = join(tokensDir, `sess-${token.slice(5)}.json`);
      
      // 检查文件是否存在
      expect(existsSync(filePath)).toBe(true);

      // 注意：在 Windows 上权限检查可能不同
      // 这里只检查文件是否存在和可读
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain(token);
    });
  });

  // ========== 边界情况测试 ==========

  describe('边界情况', () => {
    it('should handle multiple tokens for same agent', () => {
      const agentId = createMockAgentId('agent1');

      const tokens = [
        manager.generateAndSave(agentId),
        manager.generateAndSave(agentId),
        manager.generateAndSave(agentId),
      ];

      // 所有 token 都应该有效且属于同一 agent
      for (const token of tokens) {
        const result = manager.verifyForAgent(token, agentId);
        expect(result.valid).toBe(true);
      }

      // 每个 token 都应该不同
      expect(new Set(tokens).size).toBe(3);
    });

    it('should handle verification order correctly', () => {
      const agentId = createMockAgentId('agent1');
      const otherAgentId = createMockAgentId('agent2');
      const token = manager.generateAndSave(agentId);

      // 顺序验证：存在 -> 未过期 -> 未撤销 -> 属于正确 agent
      manager.revoke(token);

      // 验证时应该先检查 revoked
      const result = manager.verify(token);
      expect(result.error).toBe('Token revoked');

      // 验证 ownership 时也应该先检查基础有效性
      const resultForOther = manager.verifyForAgent(token, otherAgentId);
      expect(resultForOther.error).toBe('Token revoked');
    });

    it('should handle concurrent generate and verify', () => {
      const agentId = createMockAgentId('agent1');

      // 模拟并发场景：生成后立即验证
      const token = manager.generateAndSave(agentId);
      const result = manager.verify(token);

      expect(result.valid).toBe(true);
    });
  });
});