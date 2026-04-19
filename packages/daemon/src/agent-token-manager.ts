/**
 * Agent Token Manager (In-Memory Version)
 * 管理 Agent 的 Token（RFC 007）
 * 
 * 功能：
 * - 生成并保存 agent token（绑定 agentId）
 * - 验证 agent token（检查有效性和所有权）
 * - Token 过期（7 天后失效）
 * - Revoke token（撤销）
 * - cleanExpired 清理过期 token
 * 
 * 🔒 纯内存存储（v3）:
 * - Token 只存在 daemon 内存中
 * - 重启后 token 丢失，agent 需重新注册获取新 token
 * - 全局单例管理器，支持多 agent
 */

import { randomBytes } from 'crypto';
import { Logger } from '@f2a/network';

/**
 * Agent Token 数据结构
 */
export interface AgentTokenData {
  /** Agent Token（唯一标识） */
  token: string;
  /** 所属 Agent ID */
  agentId: string;
  /** 创建时间（毫秒时间戳） */
  createdAt: number;
  /** 过期时间（毫秒时间戳，默认 7 天） */
  expiresAt: number;
  /** 最后使用时间（毫秒时间戳） */
  lastUsedAt?: number;
  /** 是否已被撤销 */
  revoked: boolean;
}

/**
 * Agent Token 配置选项
 */
export interface AgentTokenManagerOptions {
  /** Token 过期时间（毫秒），默认 7 天 */
  expireAfterMs?: number;
}

/** 默认过期时间：7 天 */
const DEFAULT_EXPIRE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Token 前缀 */
export const TOKEN_PREFIX = 'agent-';

/** Token 中十六进制部分的长度（32 bytes = 64 hex chars） */
export const TOKEN_HEX_LENGTH = 64;

/** Token 总长度：前缀 + 十六进制部分 */
export const TOKEN_LENGTH = TOKEN_PREFIX.length + TOKEN_HEX_LENGTH; // 70 chars

/**
 * Agent Token 管理器（纯内存版本）
 * 负责 Agent Token 的生成、验证和管理
 * 
 * 全局单例，支持多 agent
 */
export class AgentTokenManager {
  /** token → data 映射 */
  private tokens: Map<string, AgentTokenData> = new Map();
  /** agentId → tokens 映射 */
  private agentTokens: Map<string, Set<string>> = new Map();
  /** 过期时间（毫秒） */
  private expireAfterMs: number;
  /** 日志器 */
  private logger: Logger;

  constructor(options?: AgentTokenManagerOptions) {
    this.expireAfterMs = options?.expireAfterMs ?? DEFAULT_EXPIRE_AFTER_MS;
    this.logger = new Logger({ component: 'AgentTokenManager' });
  }

  /**
   * 生成 agent token
   * @param agentId Agent ID
   * @returns 生成的 agent token
   */
  generate(agentId: string): string {
    const token = TOKEN_PREFIX + randomBytes(32).toString('hex');
    const now = Date.now();
    const tokenData: AgentTokenData = {
      token,
      agentId,
      createdAt: now,
      expiresAt: now + this.expireAfterMs,
      revoked: false,
    };

    // 存储到 token → data 映射
    this.tokens.set(token, tokenData);

    // 存储到 agentId → tokens 映射
    if (!this.agentTokens.has(agentId)) {
      this.agentTokens.set(agentId, new Set());
    }
    this.agentTokens.get(agentId)!.add(token);

    this.logger.info('Agent token generated', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: agentId.slice(0, 16),
      expiresAt: new Date(tokenData.expiresAt).toISOString(),
    });

    return token;
  }

  /**
   * 验证 token 是否有效
   * @param token Agent token
   * @returns 验证结果
   */
  verify(token: string | undefined): { valid: boolean; agentId?: string; error?: string } {
    if (!token) {
      return { valid: false, error: 'Token is empty' };
    }

    const tokenData = this.tokens.get(token);

    // 检查 token 是否存在
    if (!tokenData) {
      this.logger.warn('Token verification failed: token not found', {
        tokenPrefix: token.slice(0, 8),
      });
      return { valid: false, error: 'Token not found' };
    }

    // 检查 token 是否已被撤销
    if (tokenData.revoked) {
      this.logger.warn('Token verification failed: token revoked', {
        tokenPrefix: token.slice(0, 8),
        agentIdPrefix: tokenData.agentId.slice(0, 16),
      });
      return { valid: false, error: 'Token revoked' };
    }

    // 检查 token 是否过期
    if (Date.now() > tokenData.expiresAt) {
      this.logger.warn('Token verification failed: token expired', {
        tokenPrefix: token.slice(0, 8),
        agentIdPrefix: tokenData.agentId.slice(0, 16),
        expiredAt: new Date(tokenData.expiresAt).toISOString(),
      });
      return { valid: false, error: 'Token expired' };
    }

    // 更新最后使用时间
    tokenData.lastUsedAt = Date.now();

    this.logger.debug('Token verified successfully', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: tokenData.agentId.slice(0, 16),
    });

    return { valid: true, agentId: tokenData.agentId };
  }

  /**
   * 验证 token 是否属于指定 agent
   * @param token Agent token
   * @param agentId Agent ID
   * @returns 验证结果
   */
  verifyForAgent(token: string | undefined, agentId: string): { valid: boolean; error?: string } {
    const agentTokenSet = this.agentTokens.get(agentId);

    if (!agentTokenSet) {
      this.logger.warn('Token verification failed: agent has no tokens', {
        tokenPrefix: token?.slice(0, 8),
        agentIdPrefix: agentId.slice(0, 16),
      });
      return { valid: false, error: 'Agent has no tokens' };
    }

    if (!token) {
      return { valid: false, error: 'Token is empty' };
    }

    const tokenData = this.tokens.get(token);

    // 检查 token 是否存在于该 agent 的 tokens 中
    if (!tokenData || !agentTokenSet.has(token)) {
      this.logger.warn('Token verification failed: token not found for this agent', {
        tokenPrefix: token.slice(0, 8),
        agentIdPrefix: agentId.slice(0, 16),
      });
      return { valid: false, error: 'Token not found' };
    }

    // 检查 token 是否已被撤销
    if (tokenData.revoked) {
      this.logger.warn('Token verification failed: token revoked', {
        tokenPrefix: token.slice(0, 8),
        agentIdPrefix: tokenData.agentId.slice(0, 16),
      });
      return { valid: false, error: 'Token revoked' };
    }

    // 检查 token 是否过期
    if (Date.now() > tokenData.expiresAt) {
      this.logger.warn('Token verification failed: token expired', {
        tokenPrefix: token.slice(0, 8),
        agentIdPrefix: tokenData.agentId.slice(0, 16),
        expiredAt: new Date(tokenData.expiresAt).toISOString(),
      });
      return { valid: false, error: 'Token expired' };
    }

    // 更新最后使用时间
    tokenData.lastUsedAt = Date.now();

    this.logger.debug('Token verified for agent successfully', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: agentId.slice(0, 16),
    });

    return { valid: true };
  }

  /**
   * 撤销 token
   * @param token Agent token
   * @returns 是否成功撤销
   */
  revoke(token: string): boolean {
    const tokenData = this.tokens.get(token);

    if (!tokenData) {
      this.logger.warn('Cannot revoke token: token not found', {
        tokenPrefix: token.slice(0, 8),
      });
      return false;
    }

    tokenData.revoked = true;
    tokenData.lastUsedAt = Date.now();

    this.logger.info('Agent token revoked', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: tokenData.agentId.slice(0, 16),
    });

    return true;
  }

  /**
   * 撤销指定 agent 的所有 token
   * @param agentId Agent ID
   * @returns 撤销的 token 数量
   */
  revokeAllForAgent(agentId: string): number {
    const agentTokenSet = this.agentTokens.get(agentId);

    if (!agentTokenSet || agentTokenSet.size === 0) {
      this.logger.debug('No tokens to revoke for agent', {
        agentIdPrefix: agentId.slice(0, 16),
      });
      return 0;
    }

    let revokedCount = 0;
    const now = Date.now();

    for (const token of Array.from(agentTokenSet)) {
      const tokenData = this.tokens.get(token);
      if (tokenData && !tokenData.revoked) {
        tokenData.revoked = true;
        tokenData.lastUsedAt = now;
        revokedCount++;
      }
    }

    this.logger.info('All agent tokens revoked', {
      agentIdPrefix: agentId.slice(0, 16),
      count: revokedCount,
    });

    return revokedCount;
  }

  /**
   * 清理所有过期的 token
   * @returns 清理的 token 数量
   */
  cleanExpired(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [token, tokenData] of Array.from(this.tokens.entries())) {
      // 清理过期的或已撤销的 token
      if (tokenData.expiresAt < now || tokenData.revoked) {
        // 从 tokens map 中删除
        this.tokens.delete(token);

        // 从 agentTokens map 中删除
        const agentTokenSet = this.agentTokens.get(tokenData.agentId);
        if (agentTokenSet) {
          agentTokenSet.delete(token);
          // 如果 agent 没有任何 token 了，清理 agentId 入口
          if (agentTokenSet.size === 0) {
            this.agentTokens.delete(tokenData.agentId);
          }
        }

        cleanedCount++;
        this.logger.debug('Expired token cleaned', {
          tokenPrefix: token.slice(0, 8),
          agentIdPrefix: tokenData.agentId.slice(0, 16),
          reason: tokenData.revoked ? 'revoked' : 'expired',
        });
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('Expired tokens cleaned', { count: cleanedCount });
    }

    return cleanedCount;
  }

  /**
   * 获取 token 数据
   * @param token Agent token
   * @returns Token 数据或 undefined
   */
  get(token: string): AgentTokenData | undefined {
    return this.tokens.get(token);
  }

  /**
   * 列出所有 token
   * @returns Token 数据列表
   */
  list(): AgentTokenData[] {
    return Array.from(this.tokens.values());
  }

  /**
   * 获取指定 agent 的所有 token
   * @param agentId Agent ID
   * @returns Token 数据列表
   */
  listByAgent(agentId: string): AgentTokenData[] {
    const agentTokenSet = this.agentTokens.get(agentId);
    if (!agentTokenSet) {
      return [];
    }

    const result: AgentTokenData[] = [];
    for (const token of Array.from(agentTokenSet)) {
      const tokenData = this.tokens.get(token);
      if (tokenData) {
        result.push(tokenData);
      }
    }
    return result;
  }

  /**
   * 检查 token 是否存在
   * @param token Agent token
   * @returns 是否存在
   */
  has(token: string): boolean {
    return this.tokens.has(token);
  }

  /**
   * 获取 token 数量
   * @returns Token 数量
   */
  size(): number {
    return this.tokens.size;
  }

  /**
   * 清理所有 token（用于测试）
   */
  clear(): void {
    this.tokens.clear();
    this.agentTokens.clear();

    this.logger.debug('All tokens cleared');
  }
}