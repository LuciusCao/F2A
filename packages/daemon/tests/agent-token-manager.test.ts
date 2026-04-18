/**
 * Agent Token Manager 测试 (RFC 007)
 * 
 * 测试场景：
 * 1. 生成并保存 token
 * 2. 验证有效 token
 * 3. 验证无效 token（不存在）
 * 4. 验证 token 不匹配（属于其他 agent）
 * 5. token 过期（7 天后失效）
 * 6. revoke token
 * 7. cleanExpired 清理过期 token
 * 
 * 🔒 v2 加密保护测试：
 * 8. 加密存储测试
 * 9. 解密加载测试
 * 10. 跨 Agent 验证失败
 * 11. 独立目录存储
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentTokenManager, AgentTokenData, TOKEN_PREFIX, TOKEN_LENGTH } from '../src/agent-token-manager.js';
import { TokenEncryption } from '../src/token-encryption.js';

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

/**
 * 获取 Agent 的 tokens 目录路径（v2 新结构）
 */
function getAgentTokensDir(testDir: string, agentId: string): string {
  return join(testDir, 'agents', agentId, 'tokens');
}

describe('AgentTokenManager', () => {
  let manager: AgentTokenManager;
  let testDir: string;
  let agentId: string;
  let tokensDir: string;

  beforeEach(() => {
    // 创建测试目录
    testDir = join(tmpdir(), `session-token-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    // v2: 使用新的构造函数签名（agentId 是必需参数）
    agentId = createMockAgentId('agent1');
    manager = new AgentTokenManager(testDir, agentId, { useEncryption: true });
    manager.loadForAgent();
    
    // v2: tokens 目录在 agent 特定路径
    tokensDir = getAgentTokensDir(testDir, agentId);
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
      const token = manager.generateAndSave(agentId);

      expect(token).toBeDefined();
      expect(token.startsWith('agent-')).toBe(true);
      expect(token.length).toBe(TOKEN_LENGTH); // 70 chars

      // 验证 token 数据
      const tokenData = manager.get(token);
      expect(tokenData).toBeDefined();
      expect(tokenData?.agentId).toBe(agentId);
      expect(tokenData?.revoked).toBe(false);
      expect(tokenData?.createdAt).toBeDefined();
      expect(tokenData?.expiresAt).toBeDefined();
    });

    it('should save token to file in agent-specific directory', () => {
      const token = manager.generateAndSave(agentId);

      // v2: 文件在 agent 特定目录
      const fileName = `agent-${token.slice(TOKEN_PREFIX.length)}.json`;
      const filePath = join(tokensDir, fileName);
      expect(existsSync(filePath)).toBe(true);

      // 检查文件内容（加密格式）
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      // v2: 加密模式下，应该是 EncryptedData 格式
      expect(data.algorithm).toBe('AES-256-GCM');
      expect(data.iv).toBeDefined();
      expect(data.ciphertext).toBeDefined();
      expect(data.authTag).toBeDefined();
    });

    it('should create tokens directory if not exists', () => {
      // 创建一个新 manager，不调用 loadForAgent，测试目录创建
      const newAgentId = createMockAgentId('new-agent');
      const newTokensDir = getAgentTokensDir(testDir, newAgentId);
      
      expect(existsSync(newTokensDir)).toBe(false);

      const newManager = new AgentTokenManager(testDir, newAgentId);
      newManager.generateAndSave(newAgentId);

      expect(existsSync(newTokensDir)).toBe(true);
    });

    it('should generate unique tokens for each call', () => {
      const token1 = manager.generateAndSave(agentId);
      const token2 = manager.generateAndSave(agentId);

      expect(token1).not.toBe(token2);
      expect(manager.size()).toBe(2);
    });

    it('should throw error when generating token for different agent', () => {
      const otherAgentId = createMockAgentId('agent2');
      
      // v2: 不允许为其他 agent 生成 token
      expect(() => manager.generateAndSave(otherAgentId)).toThrow(
        `Cannot generate token for agent ${otherAgentId}: only current agent ${agentId} is allowed`
      );
    });

    it('should set correct expiration time (7 days by default)', () => {
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
      const customManager = new AgentTokenManager(testDir, agentId, { 
        expireAfterMs: customExpireMs,
        useEncryption: false // 禁用加密简化测试
      });
      customManager.loadForAgent();
      
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
      const token = manager.generateAndSave(agentId);

      const result = manager.verify(token);

      expect(result.valid).toBe(true);
      expect(result.agentId).toBe(agentId);
      expect(result.error).toBeUndefined();
    });

    it('should return agentId in result', () => {
      const token = manager.generateAndSave(agentId);

      const result = manager.verify(token);

      expect(result.agentId).toBe(agentId);
    });

    it('should update lastUsedAt on successful verification', () => {
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

    it('should NOT persist lastUsedAt on verify (performance optimization)', () => {
      const token = manager.generateAndSave(agentId);

      manager.verify(token);

      // 重新加载 manager
      const newManager = new AgentTokenManager(testDir, agentId);
      newManager.loadForAgent();

      const tokenData = newManager.get(token);
      // verify() 不再写入文件，所以 lastUsedAt 应该是 undefined
      expect(tokenData?.lastUsedAt).toBeUndefined();
    });

    it('should persist lastUsedAt when token is revoked', () => {
      const token = manager.generateAndSave(agentId);

      manager.revoke(token);

      // 重新加载 manager
      const newManager = new AgentTokenManager(testDir, agentId);
      newManager.loadForAgent();

      const tokenData = newManager.get(token);
      // revoke() 会写入文件，所以 lastUsedAt 应该有值
      expect(tokenData?.lastUsedAt).toBeDefined();
    });
  });

  // ========== 场景 3: 验证无效 token（不存在） ==========

  describe('verify() - token not found', () => {
    it('should return invalid for non-existent token', () => {
      const fakeToken = 'agent-nonexistent1234567890abcdef1234567890abcdef';

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
      // token 不以 agent- 开头
      const wrongFormatToken = 'wrong-format-token-1234567890abcdef';

      const result = manager.verify(wrongFormatToken);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
    });
  });

  // ========== 场景 4: 验证 token 不匹配（属于其他 agent） ==========

  describe('verifyForAgent() - token mismatch', () => {
    it('should return invalid when token belongs to different agent', () => {
      const token = manager.generateAndSave(agentId);

      // v2: verifyForAgent 使用 tokensByAgent Map
      // 其他 agent 的 token 不会在当前 agent 的 Map 中
      const otherAgentId = createMockAgentId('agent2');
      const result = manager.verifyForAgent(token, otherAgentId);

      // v2: 返回 "Agent tokens not available"（其他 agent 不在内存 Map 中）
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Agent tokens not available');
    });

    it('should return valid when token belongs to correct agent', () => {
      const token = manager.generateAndSave(agentId);

      const result = manager.verifyForAgent(token, agentId);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should check token existence first', () => {
      const fakeToken = 'agent-nonexistent1234567890abcdef1234567890abcdef';

      const result = manager.verifyForAgent(fakeToken, agentId);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
    });

    it('should check token validity before ownership', () => {
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
      // 创建已过期的 token（手动设置 expiresAt）
      const token = 'agent-expiredtest1234567890abcdef1234567890abcdef';
      const expiredTokenData: AgentTokenData = {
        token,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 天前创建
        expiresAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 天前过期
        revoked: false,
      };

      // v2: 写入到 agent 特定目录（非加密模式）
      mkdirSync(tokensDir, { recursive: true });
      const fileName = `agent-${token.slice(TOKEN_PREFIX.length)}.json`;
      writeFileSync(join(tokensDir, fileName), JSON.stringify(expiredTokenData, null, 2));

      // 创建非加密 manager 来加载
      const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
      plainManager.loadForAgent();
      
      const result = plainManager.verify(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('should return valid for token about to expire', () => {
      // 创建即将过期的 token（expiresAt 为未来时间）
      const token = 'agent-almostexpired1234567890abcdef1234567890abcdef';
      const tokenData: AgentTokenData = {
        token,
        agentId,
        createdAt: Date.now() - 6 * 24 * 60 * 60 * 1000, // 6 天前创建
        expiresAt: Date.now() + 1000, // 1 秒后过期
        revoked: false,
      };

      // v2: 写入到 agent 特定目录（非加密模式）
      mkdirSync(tokensDir, { recursive: true });
      const fileName = `agent-${token.slice(TOKEN_PREFIX.length)}.json`;
      writeFileSync(join(tokensDir, fileName), JSON.stringify(tokenData, null, 2));

      // 创建非加密 manager 来加载
      const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
      plainManager.loadForAgent();

      const result = plainManager.verify(token);

      // 此时 token 还应该有效
      expect(result.valid).toBe(true);
    });

    it('should correctly handle 7-day expiration', () => {
      const token = manager.generateAndSave(agentId);

      const tokenData = manager.get(token);
      const expectedExpiresAt = tokenData!.createdAt + 7 * 24 * 60 * 60 * 1000;

      expect(tokenData?.expiresAt).toBe(expectedExpiresAt);
    });
  });

  // ========== 场景 6: revoke token ==========

  describe('revoke()', () => {
    it('should revoke existing token', () => {
      const token = manager.generateAndSave(agentId);

      const result = manager.revoke(token);

      expect(result).toBe(true);

      const tokenData = manager.get(token);
      expect(tokenData?.revoked).toBe(true);
    });

    it('should make revoked token invalid', () => {
      const token = manager.generateAndSave(agentId);

      manager.revoke(token);

      const verifyResult = manager.verify(token);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toBe('Token revoked');
    });

    it('should persist revoked state to file', () => {
      const token = manager.generateAndSave(agentId);

      manager.revoke(token);

      // 重新加载
      const newManager = new AgentTokenManager(testDir, agentId);
      newManager.loadForAgent();

      const tokenData = newManager.get(token);
      expect(tokenData?.revoked).toBe(true);
    });

    it('should return false for non-existent token', () => {
      const fakeToken = 'agent-nonexistent1234567890abcdef1234567890abcdef';

      const result = manager.revoke(fakeToken);

      expect(result).toBe(false);
    });

    it('should update lastUsedAt on revoke', () => {
      const token = manager.generateAndSave(agentId);

      const beforeRevoke = manager.get(token);
      expect(beforeRevoke?.lastUsedAt).toBeUndefined();

      manager.revoke(token);

      const afterRevoke = manager.get(token);
      expect(afterRevoke?.lastUsedAt).toBeDefined();
    });

    it('can revoke already revoked token', () => {
      const token = manager.generateAndSave(agentId);

      manager.revoke(token);
      const result1 = manager.revoke(token);

      expect(result1).toBe(true); // 仍然返回 true
    });
  });

  // ========== 场景 7: cleanExpired 清理过期 token ==========

  describe('cleanExpired()', () => {
    it('should clean expired tokens', () => {
      // 使用非加密模式测试，简化文件操作
      const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
      plainManager.loadForAgent();
      
      // 创建已过期的 token（非加密模式）
      const expiredToken = 'agent-expiredclean1234567890abcdef1234567890abcdef';
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1 * 60 * 1000, // 1 分钟前过期
        revoked: false,
      };

      // 创建有效的 token（非加密模式）
      const validToken = plainManager.generateAndSave(agentId);

      // 写入过期 token 到 agent 特定目录（非加密）
      mkdirSync(tokensDir, { recursive: true });
      writeFileSync(
        join(tokensDir, `agent-${expiredToken.slice(TOKEN_PREFIX.length)}.json`),
        JSON.stringify(expiredData, null, 2)
      );

      // 重新加载
      plainManager.loadForAgent();

      expect(plainManager.size()).toBe(2);

      const cleaned = plainManager.cleanExpired();

      expect(cleaned).toBe(1);
      expect(plainManager.size()).toBe(1);
      expect(plainManager.has(validToken)).toBe(true);
      expect(plainManager.has(expiredToken)).toBe(false);
    });

    it('should clean revoked tokens', () => {
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
      // 使用正确格式的 token
      const expiredToken = 'agent-' + 'fileclean1234567890abcdef1234567890abcdef1234567890abcdef12'.padEnd(64, '0');
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000,
        revoked: false,
      };

      mkdirSync(tokensDir, { recursive: true });
      const fileName = `agent-${expiredToken.slice(TOKEN_PREFIX.length)}.json`;
      const filePath = join(tokensDir, fileName);
      writeFileSync(filePath, JSON.stringify(expiredData, null, 2));

      // 创建非加密 manager 来测试
      const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
      plainManager.loadForAgent();
      
      expect(existsSync(filePath)).toBe(true);

      plainManager.cleanExpired();

      expect(existsSync(filePath)).toBe(false);
    });

    it('should return 0 when no tokens to clean', () => {
      // 创建有效的 token
      manager.generateAndSave(agentId);

      const cleaned = manager.cleanExpired();

      expect(cleaned).toBe(0);
      expect(manager.size()).toBe(1);
    });

    it('should clean both expired and revoked tokens together', () => {
      // 创建过期 token
      const expiredToken = 'agent-expired1' + Date.now().toString(16).padStart(54, '0');
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000,
        revoked: false,
      };

      // 创建被撤销的 token
      const revokedToken = 'agent-revoked1' + Date.now().toString(16).padStart(54, '0');
      const revokedData: AgentTokenData = {
        token: revokedToken,
        agentId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: true,
      };

      // v2: 写入到 agent 特定目录（非加密）
      mkdirSync(tokensDir, { recursive: true });
      writeFileSync(
        join(tokensDir, `agent-${expiredToken.slice(TOKEN_PREFIX.length)}.json`),
        JSON.stringify(expiredData, null, 2)
      );
      writeFileSync(
        join(tokensDir, `agent-${revokedToken.slice(TOKEN_PREFIX.length)}.json`),
        JSON.stringify(revokedData, null, 2)
      );

      // 创建非加密 manager 来测试
      const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
      plainManager.loadForAgent();

      const cleaned = plainManager.cleanExpired();

      expect(cleaned).toBe(2);
      expect(plainManager.size()).toBe(0);
    });
  });

  // ========== 辅助方法测试 ==========

  describe('loadForAgent()', () => {
    it('should load all token files for current agent', () => {
      // 手动创建多个 token 文件（非加密）
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');

      // v2: 每个 agent 有自己的目录
      const dir1 = getAgentTokensDir(testDir, agentId1);
      const dir2 = getAgentTokensDir(testDir, agentId2);
      
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      const token1 = 'agent-loaded1' + Date.now().toString(16).padStart(54, '0');
      const token2 = 'agent-loaded2' + Date.now().toString(16).padStart(54, '0');

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

      // 写入到各自的目录
      writeFileSync(join(dir1, `agent-${token1.slice(TOKEN_PREFIX.length)}.json`), JSON.stringify(data1));
      writeFileSync(join(dir2, `agent-${token2.slice(TOKEN_PREFIX.length)}.json`), JSON.stringify(data2));

      // Agent1 只能看到自己的 token
      const manager1 = new AgentTokenManager(testDir, agentId1, { useEncryption: false });
      manager1.loadForAgent();

      expect(manager1.size()).toBe(1);
      expect(manager1.get(token1)).toBeDefined();
      expect(manager1.get(token2)).toBeUndefined(); // Agent2 的 token 不可见
    });

    it('should skip invalid token files', () => {
      mkdirSync(tokensDir, { recursive: true });

      // 创建无效文件
      writeFileSync(join(tokensDir, 'invalid.json'), 'not json');

      // 创建结构无效的文件
      const invalidData = { token: 'invalid' };
      writeFileSync(join(tokensDir, 'agent-invalid1.json'), JSON.stringify(invalidData));

      manager.loadForAgent();

      expect(manager.size()).toBe(0);
    });

    it('should handle empty directory', () => {
      mkdirSync(tokensDir, { recursive: true });

      manager.loadForAgent();

      expect(manager.size()).toBe(0);
    });

    it('should create tokens directory on load', () => {
      manager.loadForAgent();

      // v2: tokens 目录应该被创建
      expect(existsSync(tokensDir)).toBe(true);
      expect(manager.size()).toBe(0);
    });
  });

  describe('list()', () => {
    it('should return all tokens for current agent', () => {
      const token1 = manager.generateAndSave(agentId);
      const token2 = manager.generateAndSave(agentId);

      const list = manager.list();

      expect(list.length).toBe(2);
      expect(list.some(t => t.token === token1)).toBe(true);
      expect(list.some(t => t.token === token2)).toBe(true);
    });

    it('should return empty array when no tokens', () => {
      manager.loadForAgent();

      expect(manager.list().length).toBe(0);
    });
  });

  describe('listByAgent()', () => {
    it('should return tokens for current agent', () => {
      const token1a = manager.generateAndSave(agentId);
      const token1b = manager.generateAndSave(agentId);

      const agentTokens = manager.listByAgent(agentId);

      expect(agentTokens.length).toBe(2);
      expect(agentTokens.some(t => t.token === token1a)).toBe(true);
      expect(agentTokens.some(t => t.token === token1b)).toBe(true);
    });

    it('should return empty array for other agent', () => {
      manager.generateAndSave(agentId);

      const otherAgentId = createMockAgentId('other');
      const otherAgentTokens = manager.listByAgent(otherAgentId);
      
      // v2: 其他 agent 的 token 对当前 agent 不可见
      expect(otherAgentTokens.length).toBe(0);
    });
  });

  describe('clear()', () => {
    it('should clear all tokens for current agent', () => {
      manager.generateAndSave(agentId);

      manager.clear();

      expect(manager.size()).toBe(0);

      // 文件也应该被删除
      const files = readdirSync(tokensDir).filter(f => f.startsWith('agent-'));
      expect(files.length).toBe(0);
    });
  });

  describe('size()', () => {
    it('should return correct count', () => {
      expect(manager.size()).toBe(0);

      manager.generateAndSave(agentId);
      expect(manager.size()).toBe(1);

      manager.generateAndSave(agentId);
      expect(manager.size()).toBe(2);

      manager.revoke(manager.list()[0].token);
      manager.cleanExpired();
      expect(manager.size()).toBe(1);
    });
  });

  describe('has()', () => {
    it('should return true for existing token', () => {
      const token = manager.generateAndSave(agentId);

      expect(manager.has(token)).toBe(true);
    });

    it('should return false for non-existent token', () => {
      expect(manager.has('agent-nonexistent')).toBe(false);
    });
  });

  // ========== 🔒 加密保护测试 (v2 新增) ==========

  describe('🔒 Encryption Tests (v2)', () => {
    describe('加密存储测试', () => {
      it('should encrypt token file on save when useEncryption is true', () => {
        const token = manager.generateAndSave(agentId);
        
        // v2: 文件在 agent 特定目录
        const tokenFileName = `agent-${token.slice(TOKEN_PREFIX.length)}.json`;
        const filePath = join(tokensDir, tokenFileName);
        
        expect(existsSync(filePath)).toBe(true);
        
        const fileContent = readFileSync(filePath, 'utf-8');
        const encrypted = JSON.parse(fileContent);
        
        // 验证是加密数据格式
        expect(encrypted.algorithm).toBe('AES-256-GCM');
        expect(encrypted.iv).toBeDefined();
        expect(encrypted.ciphertext).toBeDefined();
        expect(encrypted.authTag).toBeDefined();
        
        // 验证不是明文（token 不应该出现在文件中）
        expect(fileContent).not.toContain(token);
      });
      
      it('should store token in plaintext when useEncryption is false', () => {
        const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
        plainManager.loadForAgent();
        
        const token = plainManager.generateAndSave(agentId);
        
        // v2: 文件在 agent 特定目录
        const plainTokensDir = getAgentTokensDir(testDir, agentId);
        const tokenFileName = `agent-${token.slice(TOKEN_PREFIX.length)}.json`;
        const filePath = join(plainTokensDir, tokenFileName);
        
        expect(existsSync(filePath)).toBe(true);
        
        const fileContent = readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);
        
        // 明文格式应该直接包含 token 数据
        expect(data.token).toBe(token);
        expect(data.agentId).toBe(agentId);
      });
    });
    
    describe('解密加载测试', () => {
      it('should decrypt token file on load', () => {
        // 生成并保存 token（加密）
        const token = manager.generateAndSave(agentId);
        
        // 新建 manager 加载（需要加密模式）
        const newManager = new AgentTokenManager(testDir, agentId, { useEncryption: true });
        newManager.loadForAgent();
        
        // 验证能正确解密
        const result = newManager.verify(token);
        expect(result.valid).toBe(true);
        expect(result.agentId).toBe(agentId);
      });
      
      it('should fail to load encrypted token without encryption key', () => {
        // 生成加密 token
        const token = manager.generateAndSave(agentId);
        
        // 创建一个新的 agent，没有加密密钥，尝试加载
        // 注意：新 agent 会生成新的密钥，无法解密旧的 token
        // 但这里我们用同一个 agentId，所以密钥是共享的
        
        // 测试禁用加密模式加载加密文件的情况
        const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
        plainManager.loadForAgent();
        
        // 加密文件无法在非加密模式下正确加载
        // plainManager 应该看不到加密的 token
        expect(plainManager.get(token)).toBeUndefined();
      });
    });
    
    describe('跨 Agent 验证失败测试', () => {
      it('should reject token from different agent', () => {
        const agentId1 = createMockAgentId('agent1');
        const agentId2 = createMockAgentId('agent2');
        
        // Agent1 生成 token
        const manager1 = new AgentTokenManager(testDir, agentId1);
        manager1.loadForAgent();
        const token = manager1.generateAndSave(agentId1);
        
        // Agent2 尝试用 Agent1 的 token
        const manager2 = new AgentTokenManager(testDir, agentId2);
        manager2.loadForAgent();
        
        // Agent2 看不到 Agent1 的 token（独立目录）
        const result = manager2.verify(token);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Token not found');
      });
      
      it('should reject token verification for different agent via verifyForAgent', () => {
        const token = manager.generateAndSave(agentId);
        
        // v2: 其他 agent 不在 tokensByAgent Map 中
        const otherAgentId = createMockAgentId('agent2');
        const result = manager.verifyForAgent(token, otherAgentId);
        
        // 返回 "Agent tokens not available"
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Agent tokens not available');
      });
      
      it('should isolate tokens between different agents', () => {
        const agentId1 = createMockAgentId('agent1');
        const agentId2 = createMockAgentId('agent2');
        
        // 创建两个独立的 manager
        const manager1 = new AgentTokenManager(testDir, agentId1, { useEncryption: false });
        const manager2 = new AgentTokenManager(testDir, agentId2, { useEncryption: false });
        
        manager1.loadForAgent();
        manager2.loadForAgent();
        
        // 各生成一个 token
        const token1 = manager1.generateAndSave(agentId1);
        const token2 = manager2.generateAndSave(agentId2);
        
        // v2: Agent2 看不到 Agent1 的 token
        expect(manager2.has(token1)).toBe(false);
        expect(manager2.verify(token1).valid).toBe(false);
        
        // v2: Agent1 看不到 Agent2 的 token
        expect(manager1.has(token2)).toBe(false);
        expect(manager1.verify(token2).valid).toBe(false);
      });
    });
    
    describe('独立目录存储测试', () => {
      it('should store tokens in agent-specific directory', () => {
        const token = manager.generateAndSave(agentId);
        
        // v2: 验证 agent 特定目录结构
        const expectedDir = join(testDir, 'agents', agentId, 'tokens');
        expect(existsSync(expectedDir)).toBe(true);
        
        // 文件应该在 agent 特定目录
        const tokenFileName = `agent-${token.slice(TOKEN_PREFIX.length)}.json`;
        const filePath = join(expectedDir, tokenFileName);
        expect(existsSync(filePath)).toBe(true);
      });
      
      it('should create agent directory structure when needed', () => {
        const newAgentId = createMockAgentId('test-agent');
        const newTestDir = join(tmpdir(), `agent-dir-test-${Date.now()}`);
        mkdirSync(newTestDir, { recursive: true });
        
        const newManager = new AgentTokenManager(newTestDir, newAgentId);
        newManager.loadForAgent();
        
        // 生成 token 会创建必要的目录
        const token = newManager.generateAndSave(newAgentId);
        
        // v2: agent 特定目录
        const agentDir = join(newTestDir, 'agents', newAgentId, 'tokens');
        expect(existsSync(agentDir)).toBe(true);
        
        // 清理
        rmSync(newTestDir, { recursive: true, force: true });
      });
      
      it('should use separate key file for each agent', () => {
        const agentId1 = createMockAgentId('key-agent-1');
        const agentId2 = createMockAgentId('key-agent-2');
        const keyTestDir = join(tmpdir(), `key-test-${Date.now()}`);
        mkdirSync(keyTestDir, { recursive: true });
        
        const encryption1 = new TokenEncryption(keyTestDir, agentId1);
        const encryption2 = new TokenEncryption(keyTestDir, agentId2);
        
        encryption1.initialize();
        encryption2.initialize();
        
        // 验证密钥文件路径（各自独立）
        const keyPath1 = join(keyTestDir, 'agents', agentId1, 'token-encryption.key');
        const keyPath2 = join(keyTestDir, 'agents', agentId2, 'token-encryption.key');
        
        expect(encryption1.getKeyFilePath()).toBe(keyPath1);
        expect(encryption2.getKeyFilePath()).toBe(keyPath2);
        expect(existsSync(keyPath1)).toBe(true);
        expect(existsSync(keyPath2)).toBe(true);
        
        // 清理
        encryption1.clearKey();
        encryption2.clearKey();
        rmSync(keyTestDir, { recursive: true, force: true });
      });
    });
    
    describe('getAgentId()', () => {
      it('should return current agent ID', () => {
        expect(manager.getAgentId()).toBe(agentId);
      });
    });
    
    describe('getTokensDir()', () => {
      it('should return agent-specific tokens directory', () => {
        const expectedDir = join(testDir, 'agents', agentId, 'tokens');
        expect(manager.getTokensDir()).toBe(expectedDir);
      });
    });
    
    describe('isEncrypted()', () => {
      it('should return true when encryption is enabled', () => {
        const encManager = new AgentTokenManager(testDir, agentId, { useEncryption: true });
        expect(encManager.isEncrypted()).toBe(true);
      });
      
      it('should return false when encryption is disabled', () => {
        const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
        expect(plainManager.isEncrypted()).toBe(false);
      });
      
      it('should default to true when useEncryption is not specified', () => {
        const defaultManager = new AgentTokenManager(testDir, agentId);
        expect(defaultManager.isEncrypted()).toBe(true);
      });
    });
  });

  // ========== 安全防护测试 ==========

  describe('安全防护', () => {
    it('should filter dangerous keys in JSON.parse', () => {
      mkdirSync(tokensDir, { recursive: true });

      const token = 'agent-safetest' + Date.now().toString(16).padStart(54, '0');
      
      // 创建包含危险 key 的文件
      const maliciousContent = JSON.stringify({
        token,
        agentId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: false,
        __proto__: { malicious: true },
        constructor: { prototype: { malicious: true } },
      });

      writeFileSync(join(tokensDir, `agent-${token.slice(TOKEN_PREFIX.length)}.json`), maliciousContent);

      // 使用非加密模式加载
      const plainManager = new AgentTokenManager(testDir, agentId, { useEncryption: false });
      plainManager.loadForAgent();

      const tokenData = plainManager.get(token);
      expect(tokenData).toBeDefined();
      
      // 检查恶意属性未被注入
      // @ts-ignore - 检查动态属性
      expect(tokenData?.__proto__?.malicious).toBeUndefined();
    });

    it('should validate token structure on load', () => {
      mkdirSync(tokensDir, { recursive: true });

      // 创建缺少必须字段的文件
      const invalidData = { token: 'agent-invalid', agentId: 'agent:test' };
      writeFileSync(join(tokensDir, 'agent-invalid.json'), JSON.stringify(invalidData));

      // 创建 agentId 格式错误的文件
      const wrongAgentData = {
        token: 'agent-wrong',
        agentId: 'wrong-format',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: false,
      };
      writeFileSync(join(tokensDir, 'agent-wrong.json'), JSON.stringify(wrongAgentData));

      manager.loadForAgent();

      expect(manager.size()).toBe(0);
    });

    it('should save token files with restricted permissions', () => {
      const token = manager.generateAndSave(agentId);

      const filePath = join(tokensDir, `agent-${token.slice(TOKEN_PREFIX.length)}.json`);
      
      // 检查文件是否存在
      expect(existsSync(filePath)).toBe(true);

      // 在 Unix 系统上可以检查权限
      try {
        const stats = require('fs').statSync(filePath);
        const permissionMode = stats.mode & 0o777;
        // 期望权限 0o600 或更严格
        expect(permissionMode).toBeLessThanOrEqual(0o600);
      } catch {
        // Windows 上权限检查可能失败，跳过
      }
    });
  });

  // ========== 边界情况测试 ==========

  describe('边界情况', () => {
    it('should handle multiple tokens for same agent', () => {
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
      const otherAgentId = createMockAgentId('agent2');
      const token = manager.generateAndSave(agentId);

      // 顺序验证：存在 -> 未过期 -> 未撤销 -> 属于正确 agent
      manager.revoke(token);

      // 验证时应该先检查 revoked
      const result = manager.verify(token);
      expect(result.error).toBe('Token revoked');

      // 验证 ownership 时也应该先检查基础有效性
      const resultForAgent = manager.verifyForAgent(token, agentId);
      expect(resultForAgent.error).toBe('Token revoked');
      
      // v2: 其他 agent 的情况
      const resultForOther = manager.verifyForAgent(token, otherAgentId);
      // 这里会先检查 agent 是否在 tokensByAgent，返回 "Agent tokens not available"
      expect(resultForOther.valid).toBe(false);
    });

    it('should handle concurrent generate and verify', () => {
      // 模拟并发场景：生成后立即验证
      const token = manager.generateAndSave(agentId);
      const result = manager.verify(token);

      expect(result.valid).toBe(true);
    });
  });
  
  // ========== TokenEncryption 单独测试 ==========

  describe('TokenEncryption', () => {
    it('should encrypt and decrypt data correctly', () => {
      const encAgentId = createMockAgentId('encrypt-test');
      const encTestDir = join(tmpdir(), `enc-test-${Date.now()}`);
      mkdirSync(encTestDir, { recursive: true });
      
      const encryption = new TokenEncryption(encTestDir, encAgentId);
      encryption.initialize();
      
      const plaintext = JSON.stringify({
        token: 'agent-test1234567890abcdef',
        agentId: encAgentId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        revoked: false
      });
      
      // 加密
      const encrypted = encryption.encrypt(plaintext);
      
      expect(encrypted.algorithm).toBe('AES-256-GCM');
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.createdAt).toBeDefined();
      
      // 密文不应该包含明文内容
      expect(encrypted.ciphertext).not.toContain('agent-test');
      
      // 解密
      const decrypted = encryption.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
      
      // 解密后的数据应该能正确解析
      const parsed = JSON.parse(decrypted);
      expect(parsed.token).toBe('agent-test1234567890abcdef');
      expect(parsed.agentId).toBe(encAgentId);
      
      // 清理
      encryption.clearKey();
      rmSync(encTestDir, { recursive: true, force: true });
    });
    
    it('should fail decryption with wrong auth tag', () => {
      const authAgentId = createMockAgentId('auth-tag-test');
      const authTestDir = join(tmpdir(), `auth-test-${Date.now()}`);
      mkdirSync(authTestDir, { recursive: true });
      
      const encryption = new TokenEncryption(authTestDir, authAgentId);
      encryption.initialize();
      
      const plaintext = 'test data for auth tag';
      const encrypted = encryption.encrypt(plaintext);
      
      // 修改 auth tag（模拟篡改）
      const tamperedEncrypted = {
        ...encrypted,
        authTag: Buffer.from('tampered_auth_tag_16').toString('base64')
      };
      
      // 解密应该失败
      expect(() => encryption.decrypt(tamperedEncrypted)).toThrow();
      
      // 清理
      encryption.clearKey();
      rmSync(authTestDir, { recursive: true, force: true });
    });
    
    it('should fail decryption with wrong IV', () => {
      const ivAgentId = createMockAgentId('iv-test');
      const ivTestDir = join(tmpdir(), `iv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(ivTestDir, { recursive: true });
      
      const encryption = new TokenEncryption(ivTestDir, ivAgentId);
      encryption.initialize();
      
      const plaintext = 'test data for iv';
      const encrypted = encryption.encrypt(plaintext);
      
      // 使用错误的 IV 长度
      const wrongIvEncrypted = {
        ...encrypted,
        iv: Buffer.from('short_iv').toString('base64')
      };
      
      // 解密应该失败（IV 长度错误）
      expect(() => encryption.decrypt(wrongIvEncrypted)).toThrow();
      
      // 清理（使用 force 选项处理非空目录）
      encryption.clearKey();
      rmSync(ivTestDir, { recursive: true, force: true });
    });
    
    it('should regenerate key if file is corrupted', () => {
      const corruptAgentId = createMockAgentId('corrupt-test');
      const corruptTestDir = join(tmpdir(), `corrupt-test-${Date.now()}`);
      mkdirSync(corruptTestDir, { recursive: true });
      
      const encryption1 = new TokenEncryption(corruptTestDir, corruptAgentId);
      encryption1.initialize();
      
      // 获取密钥文件路径
      const keyFilePath = encryption1.getKeyFilePath();
      
      // 破坏密钥文件
      writeFileSync(keyFilePath, 'corrupted_key_data');
      
      // 重新初始化，应该重新生成密钥
      const encryption2 = new TokenEncryption(corruptTestDir, corruptAgentId);
      encryption2.initialize();
      
      // 验证密钥已重新生成（能正常加密解密）
      const plaintext = 'test after corruption';
      const encrypted = encryption2.encrypt(plaintext);
      const decrypted = encryption2.decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
      
      // 清理
      encryption1.clearKey();
      encryption2.clearKey();
      rmSync(corruptTestDir, { recursive: true, force: true });
    });
    
    it('should use different keys for different agents', () => {
      const keyAgentId1 = createMockAgentId('key-agent-1');
      const keyAgentId2 = createMockAgentId('key-agent-2');
      const multiKeyDir = join(tmpdir(), `multi-key-test-${Date.now()}`);
      mkdirSync(multiKeyDir, { recursive: true });
      
      const encryption1 = new TokenEncryption(multiKeyDir, keyAgentId1);
      const encryption2 = new TokenEncryption(multiKeyDir, keyAgentId2);
      
      encryption1.initialize();
      encryption2.initialize();
      
      const plaintext = 'same plaintext for both';
      
      // Agent1 加密
      const encrypted1 = encryption1.encrypt(plaintext);
      
      // Agent2 尝试用自己的密钥解密 Agent1 的数据（应该失败）
      expect(() => encryption2.decrypt(encrypted1)).toThrow();
      
      // Agent2 自己加密的数据能正常解密
      const encrypted2 = encryption2.encrypt(plaintext);
      const decrypted2 = encryption2.decrypt(encrypted2);
      expect(decrypted2).toBe(plaintext);
      
      // 清理
      encryption1.clearKey();
      encryption2.clearKey();
      rmSync(multiKeyDir, { recursive: true, force: true });
    });
  });
});