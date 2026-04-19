/**
 * Agent Token Manager 测试 (RFC 007) - 纯内存版本
 * 
 * 测试场景：
 * 1. generate → verify → revoke 流程
 * 2. verifyForAgent 跨 agent 验证
 * 3. revokeAllForAgent(agentId) 测试
 * 4. cleanExpired 清理过期 token
 * 5. clear() 测试
 * 6. 多 agent 支持
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentTokenManager, AgentTokenData, TOKEN_PREFIX, TOKEN_LENGTH } from '../src/agent-token-manager.js';

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

describe('AgentTokenManager (In-Memory)', () => {
  let manager: AgentTokenManager;

  beforeEach(() => {
    // v3: 纯内存版本，构造函数不接受 dataDir 和 agentId
    manager = new AgentTokenManager();
  });

  afterEach(() => {
    // 清理所有 token
    manager.clear();
  });

  // ========== 场景 1: generate → verify → revoke 流程 ==========

  describe('generate()', () => {
    it('should generate valid agent token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      expect(token).toBeDefined();
      expect(token.startsWith('agent-')).toBe(true);
      expect(token.length).toBe(TOKEN_LENGTH);

      // 验证 token 数据
      const tokenData = manager.get(token);
      expect(tokenData).toBeDefined();
      expect(tokenData?.agentId).toBe(agentId);
      expect(tokenData?.revoked).toBe(false);
      expect(tokenData?.createdAt).toBeDefined();
      expect(tokenData?.expiresAt).toBeDefined();
    });

    it('should generate unique tokens for each call', () => {
      const agentId = createMockAgentId('agent1');
      const token1 = manager.generate(agentId);
      const token2 = manager.generate(agentId);

      expect(token1).not.toBe(token2);
      expect(manager.size()).toBe(2);
    });

    it('should set correct expiration time (7 days by default)', () => {
      const agentId = createMockAgentId('agent1');
      const before = Date.now();
      
      const token = manager.generate(agentId);
      const after = Date.now();
      
      const tokenData = manager.get(token);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      
      // 过期时间应该在创建时间 + 7 天范围内
      expect(tokenData?.expiresAt).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(tokenData?.expiresAt).toBeLessThanOrEqual(after + sevenDaysMs);
    });

    it('should support custom expiration time', () => {
      const customExpireMs = 1 * 60 * 60 * 1000; // 1 hour
      const customManager = new AgentTokenManager({ expireAfterMs: customExpireMs });
      
      const agentId = createMockAgentId('agent1');
      const before = Date.now();
      
      const token = customManager.generate(agentId);
      const after = Date.now();
      
      const tokenData = customManager.get(token);
      
      expect(tokenData?.expiresAt).toBeGreaterThanOrEqual(before + customExpireMs);
      expect(tokenData?.expiresAt).toBeLessThanOrEqual(after + customExpireMs);
      
      customManager.clear();
    });

    it('should support multiple agents', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');
      
      const token1 = manager.generate(agentId1);
      const token2 = manager.generate(agentId2);
      
      expect(manager.size()).toBe(2);
      
      // 各 token 属于对应的 agent
      expect(manager.get(token1)?.agentId).toBe(agentId1);
      expect(manager.get(token2)?.agentId).toBe(agentId2);
    });
  });

  // ========== 场景 2: verify() 有效 token ==========

  describe('verify() - valid token', () => {
    it('should return valid for existing token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      const result = manager.verify(token);

      expect(result.valid).toBe(true);
      expect(result.agentId).toBe(agentId);
      expect(result.error).toBeUndefined();
    });

    it('should return agentId in result', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      const result = manager.verify(token);

      expect(result.agentId).toBe(agentId);
    });

    it('should update lastUsedAt on successful verification', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

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
  });

  // ========== 场景 3: verify() 无效 token ==========

  describe('verify() - invalid token', () => {
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

  // ========== 场景 4: verify() 过期 token ==========

  describe('verify() - expired token', () => {
    it('should return invalid for expired token', () => {
      // 创建已过期的 token（手动设置 expiresAt）
      const agentId = createMockAgentId('agent1');
      const token = 'agent-expiredtest1234567890abcdef1234567890abcdef';
      const expiredTokenData: AgentTokenData = {
        token,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 天前创建
        expiresAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 天前过期
        revoked: false,
      };

      // 手动添加过期 token 到内存
      (manager as any).tokens.set(token, expiredTokenData);
      
      const result = manager.verify(token);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('should return valid for token about to expire', () => {
      const agentId = createMockAgentId('agent1');
      const token = 'agent-almostexpired1234567890abcdef1234567890abcdef';
      const tokenData: AgentTokenData = {
        token,
        agentId,
        createdAt: Date.now() - 6 * 24 * 60 * 60 * 1000, // 6 天前创建
        expiresAt: Date.now() + 1000, // 1 秒后过期
        revoked: false,
      };

      // 手动添加即将过期 token 到内存
      (manager as any).tokens.set(token, tokenData);
      
      const result = manager.verify(token);

      // 此时 token 还应该有效
      expect(result.valid).toBe(true);
    });
  });

  // ========== 场景 5: verify() 撤销 token ==========

  describe('verify() - revoked token', () => {
    it('should return invalid for revoked token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      manager.revoke(token);

      const result = manager.verify(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token revoked');
    });
  });

  // ========== 场景 6: revoke() ==========

  describe('revoke()', () => {
    it('should revoke existing token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      const result = manager.revoke(token);

      expect(result).toBe(true);

      const tokenData = manager.get(token);
      expect(tokenData?.revoked).toBe(true);
    });

    it('should make revoked token invalid', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      manager.revoke(token);

      const verifyResult = manager.verify(token);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.error).toBe('Token revoked');
    });

    it('should return false for non-existent token', () => {
      const fakeToken = 'agent-nonexistent1234567890abcdef1234567890abcdef';

      const result = manager.revoke(fakeToken);

      expect(result).toBe(false);
    });

    it('should update lastUsedAt on revoke', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      const beforeRevoke = manager.get(token);
      expect(beforeRevoke?.lastUsedAt).toBeUndefined();

      manager.revoke(token);

      const afterRevoke = manager.get(token);
      expect(afterRevoke?.lastUsedAt).toBeDefined();
    });

    it('can revoke already revoked token', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      manager.revoke(token);
      const result1 = manager.revoke(token);

      expect(result1).toBe(true); // 仍然返回 true
    });
  });

  // ========== 场景 7: revokeAllForAgent() ==========

  describe('revokeAllForAgent()', () => {
    it('should revoke all tokens for specific agent', () => {
      const agentId = createMockAgentId('agent1');
      const token1 = manager.generate(agentId);
      const token2 = manager.generate(agentId);
      const token3 = manager.generate(agentId);

      const result = manager.revokeAllForAgent(agentId);

      expect(result).toBe(3);
      
      // 所有 token 都应该被撤销
      expect(manager.get(token1)?.revoked).toBe(true);
      expect(manager.get(token2)?.revoked).toBe(true);
      expect(manager.get(token3)?.revoked).toBe(true);
    });

    it('should not revoke tokens for other agents', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');
      
      const token1 = manager.generate(agentId1);
      const token2 = manager.generate(agentId2);

      const result = manager.revokeAllForAgent(agentId1);

      expect(result).toBe(1);
      
      // Agent1 的 token 被撤销
      expect(manager.get(token1)?.revoked).toBe(true);
      
      // Agent2 的 token 未被撤销
      expect(manager.get(token2)?.revoked).toBe(false);
    });

    it('should return 0 for agent with no tokens', () => {
      const agentId = createMockAgentId('agent-no-tokens');

      const result = manager.revokeAllForAgent(agentId);

      expect(result).toBe(0);
    });

    it('should only count unrevoked tokens', () => {
      const agentId = createMockAgentId('agent1');
      const token1 = manager.generate(agentId);
      const token2 = manager.generate(agentId);
      
      // 先撤销一个
      manager.revoke(token1);

      const result = manager.revokeAllForAgent(agentId);

      // 只撤销了第二个
      expect(result).toBe(1);
    });
  });

  // ========== 场景 8: verifyForAgent() - 跨 agent 验证 ==========

  describe('verifyForAgent()', () => {
    it('should return valid when token belongs to correct agent', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      const result = manager.verifyForAgent(token, agentId);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid when token belongs to different agent', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');
      
      const token = manager.generate(agentId1);

      // Agent A 的 token 不能 verifyForAgent Agent B
      // Agent B 在 agentTokens map 中没有记录，所以返回 "Agent has no tokens"
      const result = manager.verifyForAgent(token, agentId2);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Agent has no tokens');
    });

    it('should return invalid for agent with no tokens', () => {
      const agentId = createMockAgentId('agent-no-tokens');
      const fakeToken = 'agent-sometoken1234567890abcdef1234567890abcdef';

      const result = manager.verifyForAgent(fakeToken, agentId);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Agent has no tokens');
    });

    it('should check token validity before ownership', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      // 撤销 token
      manager.revoke(token);

      // 用正确的 agentId 验证已撤销的 token
      const result = manager.verifyForAgent(token, agentId);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token revoked'); // 应该先报告 revoked
    });

    it('should return invalid for empty token', () => {
      const agentId = createMockAgentId('agent1');
      manager.generate(agentId);

      const result = manager.verifyForAgent('', agentId);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token is empty');
    });
  });

  // ========== 场景 9: cleanExpired() ==========

  describe('cleanExpired()', () => {
    it('should clean expired tokens', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建已过期的 token
      const expiredToken = 'agent-expired1234567890abcdef1234567890abcdef';
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1 * 60 * 1000, // 1 分钟前过期
        revoked: false,
      };
      (manager as any).tokens.set(expiredToken, expiredData);

      // 创建有效的 token
      const validToken = manager.generate(agentId);

      expect(manager.size()).toBe(2);

      const cleaned = manager.cleanExpired();

      expect(cleaned).toBe(1);
      expect(manager.size()).toBe(1);
      expect(manager.has(validToken)).toBe(true);
      expect(manager.has(expiredToken)).toBe(false);
    });

    it('should clean revoked tokens', () => {
      const agentId = createMockAgentId('agent1');
      const validToken = manager.generate(agentId);
      const revokedToken = manager.generate(agentId);
      manager.revoke(revokedToken);

      expect(manager.size()).toBe(2);

      const cleaned = manager.cleanExpired();

      // revoked token 也应该被清理
      expect(cleaned).toBe(1);
      expect(manager.has(validToken)).toBe(true);
      expect(manager.has(revokedToken)).toBe(false);
    });

    it('should return 0 when no tokens to clean', () => {
      const agentId = createMockAgentId('agent1');
      // 创建有效的 token
      manager.generate(agentId);

      const cleaned = manager.cleanExpired();

      expect(cleaned).toBe(0);
      expect(manager.size()).toBe(1);
    });

    it('should clean both expired and revoked tokens together', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建过期 token
      const expiredToken = 'agent-expired1234567890abcdef1234567890abcdef';
      const expiredData: AgentTokenData = {
        token: expiredToken,
        agentId,
        createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 1000,
        revoked: false,
      };
      (manager as any).tokens.set(expiredToken, expiredData);

      // 创建被撤销的 token
      const revokedToken = manager.generate(agentId);
      manager.revoke(revokedToken);

      // 创建有效 token
      const validToken = manager.generate(agentId);

      expect(manager.size()).toBe(3);

      const cleaned = manager.cleanExpired();

      expect(cleaned).toBe(2);
      expect(manager.size()).toBe(1);
      expect(manager.has(validToken)).toBe(true);
    });

    it('should clean from agentTokens map as well', () => {
      const agentId = createMockAgentId('agent1');
      
      // 创建并撤销 token
      const token = manager.generate(agentId);
      manager.revoke(token);

      // 验证 agentTokens map 中有记录
      expect((manager as any).agentTokens.has(agentId)).toBe(true);
      expect((manager as any).agentTokens.get(agentId)!.size).toBe(1);

      manager.cleanExpired();

      // agentTokens map 应该被清理
      expect((manager as any).agentTokens.has(agentId)).toBe(false);
    });
  });

  // ========== 场景 10: clear() ==========

  describe('clear()', () => {
    it('should clear all tokens', () => {
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');
      
      manager.generate(agentId1);
      manager.generate(agentId1);
      manager.generate(agentId2);

      expect(manager.size()).toBe(3);

      manager.clear();

      expect(manager.size()).toBe(0);
    });

    it('should clear agentTokens map as well', () => {
      const agentId = createMockAgentId('agent1');
      manager.generate(agentId);

      expect((manager as any).agentTokens.has(agentId)).toBe(true);

      manager.clear();

      expect((manager as any).agentTokens.size).toBe(0);
    });

    it('should work on empty manager', () => {
      manager.clear();

      expect(manager.size()).toBe(0);
    });
  });

  // ========== 辅助方法测试 ==========

  describe('辅助方法', () => {
    describe('list()', () => {
      it('should return all tokens', () => {
        const agentId = createMockAgentId('agent1');
        const token1 = manager.generate(agentId);
        const token2 = manager.generate(agentId);

        const list = manager.list();

        expect(list.length).toBe(2);
        expect(list.some(t => t.token === token1)).toBe(true);
        expect(list.some(t => t.token === token2)).toBe(true);
      });

      it('should return empty array when no tokens', () => {
        expect(manager.list().length).toBe(0);
      });
    });

    describe('listByAgent()', () => {
      it('should return tokens for specific agent', () => {
        const agentId1 = createMockAgentId('agent1');
        const agentId2 = createMockAgentId('agent2');
        
        const token1a = manager.generate(agentId1);
        const token1b = manager.generate(agentId1);
        const token2 = manager.generate(agentId2);

        const agentTokens = manager.listByAgent(agentId1);

        expect(agentTokens.length).toBe(2);
        expect(agentTokens.some(t => t.token === token1a)).toBe(true);
        expect(agentTokens.some(t => t.token === token1b)).toBe(true);
        expect(agentTokens.some(t => t.token === token2)).toBe(false);
      });

      it('should return empty array for agent with no tokens', () => {
        const agentId = createMockAgentId('agent-no-tokens');
        const otherAgentId = createMockAgentId('other');
        manager.generate(otherAgentId);

        const otherAgentTokens = manager.listByAgent(agentId);
        expect(otherAgentTokens.length).toBe(0);
      });
    });

    describe('size()', () => {
      it('should return correct count', () => {
        const agentId = createMockAgentId('agent1');
        expect(manager.size()).toBe(0);

        manager.generate(agentId);
        expect(manager.size()).toBe(1);

        manager.generate(agentId);
        expect(manager.size()).toBe(2);

        manager.revoke(manager.list()[0].token);
        manager.cleanExpired();
        expect(manager.size()).toBe(1);
      });
    });

    describe('has()', () => {
      it('should return true for existing token', () => {
        const agentId = createMockAgentId('agent1');
        const token = manager.generate(agentId);

        expect(manager.has(token)).toBe(true);
      });

      it('should return false for non-existent token', () => {
        expect(manager.has('agent-nonexistent')).toBe(false);
      });
    });

    describe('get()', () => {
      it('should return token data for existing token', () => {
        const agentId = createMockAgentId('agent1');
        const token = manager.generate(agentId);

        const data = manager.get(token);

        expect(data).toBeDefined();
        expect(data?.agentId).toBe(agentId);
      });

      it('should return undefined for non-existent token', () => {
        const data = manager.get('agent-nonexistent');

        expect(data).toBeUndefined();
      });
    });
  });

  // ========== 边界情况测试 ==========

  describe('边界情况', () => {
    it('should handle multiple tokens for same agent', () => {
      const agentId = createMockAgentId('agent1');
      const tokens = [
        manager.generate(agentId),
        manager.generate(agentId),
        manager.generate(agentId),
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
      const agentId1 = createMockAgentId('agent1');
      const agentId2 = createMockAgentId('agent2');
      const token = manager.generate(agentId1);

      // 撤销 token
      manager.revoke(token);

      // 验证时应该先检查 revoked
      const result = manager.verify(token);
      expect(result.error).toBe('Token revoked');

      // 验证 ownership 时也应该先检查基础有效性
      const resultForAgent = manager.verifyForAgent(token, agentId1);
      expect(resultForAgent.error).toBe('Token revoked');
      
      // 其他 agent 的情况
      const resultForOther = manager.verifyForAgent(token, agentId2);
      expect(resultForOther.valid).toBe(false);
    });

    it('should handle concurrent generate and verify', () => {
      const agentId = createMockAgentId('agent1');
      // 模拟并发场景：生成后立即验证
      const token = manager.generate(agentId);
      const result = manager.verify(token);

      expect(result.valid).toBe(true);
    });

    it('should handle same token being revoked multiple times', () => {
      const agentId = createMockAgentId('agent1');
      const token = manager.generate(agentId);

      manager.revoke(token);
      manager.revoke(token);
      manager.revoke(token);

      const data = manager.get(token);
      expect(data?.revoked).toBe(true);
    });

    it('should handle generate after clear', () => {
      const agentId = createMockAgentId('agent1');
      manager.generate(agentId);
      manager.clear();

      const token = manager.generate(agentId);
      expect(manager.has(token)).toBe(true);
      expect(manager.verify(token).valid).toBe(true);
    });
  });
});