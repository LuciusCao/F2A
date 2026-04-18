/**
 * Agent Token Manager
 * 管理 Agent 的 Token（RFC 007）
 * 
 * 功能：
 * - 生成并保存 agent token（绑定 agentId）
 * - 验证 agent token（检查有效性和所有权）
 * - Token 过期（7 天后失效）
 * - Revoke token（撤销）
 * - cleanExpired 清理过期 token
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
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
  /** 是否自动清理过期 token */
  autoCleanExpired?: boolean;
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
 * Agent Token 管理器
 * 负责 Agent Token 的生成、验证和管理
 */
export class AgentTokenManager {
  private tokensDir: string;
  private tokens: Map<string, AgentTokenData> = new Map();
  private logger: Logger;
  private expireAfterMs: number;

  constructor(dataDir: string, options?: AgentTokenManagerOptions) {
    this.tokensDir = join(dataDir, 'agent-tokens');
    this.logger = new Logger({ component: 'AgentTokenManager' });
    this.expireAfterMs = options?.expireAfterMs ?? DEFAULT_EXPIRE_AFTER_MS;
  }

  /**
   * 初始化：确保目录存在并加载所有 token
   */
  loadAll(): void {
    this.ensureDir();
    
    const files = readdirSync(this.tokensDir)
      .filter(f => f.endsWith('.json') && f.startsWith(TOKEN_PREFIX));
    
    this.tokens.clear();
    
    for (const file of files) {
      try {
        const filePath = join(this.tokensDir, file);
        const content = readFileSync(filePath, 'utf-8');
        
        // 安全 JSON.parse：过滤危险 key
        const tokenData = JSON.parse(content, (key, value) => {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
          }
          return value;
        }) as AgentTokenData;
        
        // 验证基本结构
        if (!this.validateTokenStructure(tokenData)) {
          this.logger.warn('Agent token invalid structure, skipping', { file });
          continue;
        }
        
        this.tokens.set(tokenData.token, tokenData);
        this.logger.debug('Agent token loaded', { 
          tokenPrefix: tokenData.token.slice(0, 8), 
          agentIdPrefix: tokenData.agentId.slice(0, 16) 
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('Failed to load agent token', { file, error: msg });
      }
    }
    
    this.logger.info('Agent tokens loaded', { count: this.tokens.size });
  }

  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    if (!existsSync(this.tokensDir)) {
      mkdirSync(this.tokensDir, { recursive: true });
      this.logger.info('Created agent tokens directory', { path: this.tokensDir });
    }
  }

  /**
   * 验证 Token 数据结构完整性
   */
  private validateTokenStructure(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    
    const obj = data as Record<string, unknown>;
    
    // 必须字段
    const requiredFields = ['token', 'agentId', 'createdAt', 'expiresAt', 'revoked'];
    for (const field of requiredFields) {
      if (obj[field] === undefined || obj[field] === null) return false;
    }
    
    // token 格式验证
    if (typeof obj.token !== 'string' || !obj.token.startsWith(TOKEN_PREFIX)) {
      return false;
    }
    
    // agentId 格式验证
    if (typeof obj.agentId !== 'string' || !obj.agentId.startsWith('agent:')) {
      return false;
    }
    
    return true;
  }

  /**
   * 生成并保存 agent token
   * @param agentId Agent ID
   * @returns 生成的 agent token
   */
  generateAndSave(agentId: string): string {
    this.ensureDir();
    
    // 生成随机 token
    const token = this.generateToken();
    
    const now = Date.now();
    const tokenData: AgentTokenData = {
      token,
      agentId,
      createdAt: now,
      expiresAt: now + this.expireAfterMs,
      revoked: false,
    };
    
    // 保存到内存
    this.tokens.set(token, tokenData);
    
    // 保存到文件
    this.saveToFile(tokenData);
    
    this.logger.info('Agent token generated', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: agentId.slice(0, 16),
      expiresAt: new Date(tokenData.expiresAt).toISOString(),
    });
    
    return token;
  }

  /**
   * 生成随机 agent token
   * @returns 64 位十六进制字符串（agent- + 64 hex chars）
   */
  private generateToken(): string {
    return TOKEN_PREFIX + randomBytes(32).toString('hex');
  }

  /**
   * 保存 token 到文件
   */
  private saveToFile(tokenData: AgentTokenData): void {
    const hexPart = tokenData.token.slice(TOKEN_PREFIX.length);
    const filePath = join(this.tokensDir, TOKEN_PREFIX + hexPart + '.json');
    writeFileSync(filePath, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
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
        tokenPrefix: token?.slice(0, 8),
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
    
    // 更新最后使用时间（仅在内存中，避免频繁磁盘 IO）
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
    const result = this.verify(token);
    
    if (!result.valid) {
      return result;
    }
    
    // 检查 token 是否属于该 agent
    if (result.agentId !== agentId) {
      this.logger.warn('Token verification failed: token belongs to different agent', {
        tokenPrefix: token?.slice(0, 8),
        expectedAgentIdPrefix: agentId.slice(0, 16),
        actualAgentIdPrefix: result.agentId?.slice(0, 16),
      });
      return { valid: false, error: 'Token does not belong to this agent' };
    }
    
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
    
    // 更新文件
    this.saveToFile(tokenData);
    
    this.logger.info('Agent token revoked', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: tokenData.agentId.slice(0, 16),
    });
    
    return true;
  }

  /**
   * 清理所有过期的 token
   * @returns 清理的 token 数量
   */
  cleanExpired(): number {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [token, tokenData] of this.tokens.entries()) {
      // 清理过期的或已撤销的 token
      if (tokenData.expiresAt < now || tokenData.revoked) {
        this.tokens.delete(token);
        
        // 删除文件
        const hexPart = token.slice(TOKEN_PREFIX.length);
        const filePath = join(this.tokensDir, TOKEN_PREFIX + hexPart + '.json');
        if (existsSync(filePath)) {
          rmSync(filePath);
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
    return this.list().filter(t => t.agentId === agentId);
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
    
    if (existsSync(this.tokensDir)) {
      const files = readdirSync(this.tokensDir)
        .filter(f => f.endsWith('.json') && f.startsWith(TOKEN_PREFIX));
      for (const file of files) {
        rmSync(join(this.tokensDir, file));
      }
    }
  }
}
