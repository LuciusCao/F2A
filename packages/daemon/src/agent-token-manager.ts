/**
 * Session Token Manager
 * 管理 Agent 的 Session Token（RFC 007）
 * 
 * 功能：
 * - 生成并保存 session token（绑定 agentId）
 * - 验证 session token（检查有效性和所有权）
 * - Token 过期（7 天后失效）
 * - Revoke token（撤销）
 * - cleanExpired 清理过期 token
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Logger } from '@f2a/network';

/**
 * Session Token 数据结构
 */
export interface AgentTokenData {
  /** Session Token（唯一标识） */
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
 * Session Token 配置选项
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
export const TOKEN_PREFIX = 'sess-';

/** Token 中十六进制部分的长度（32 bytes = 64 hex chars） */
export const TOKEN_HEX_LENGTH = 64;

/** Token 总长度：前缀 + 十六进制部分 */
export const TOKEN_LENGTH = TOKEN_PREFIX.length + TOKEN_HEX_LENGTH; // 69 chars

/**
 * 生成测试用的 Session Token（用于测试）
 * @param suffix 可选后缀，用于区分不同测试场景
 * @returns 格式正确的测试 token（sess- + 64 hex chars）
 */
export function generateTestToken(suffix?: string): string {
  // 使用时间戳的十六进制形式 + 填充来生成固定长度的 token
  const base = (suffix || Date.now().toString(16)).padStart(TOKEN_HEX_LENGTH, '0');
  // 截取或填充到正确的长度
  const hexPart = base.length > TOKEN_HEX_LENGTH 
    ? base.slice(0, TOKEN_HEX_LENGTH) 
    : base.padEnd(TOKEN_HEX_LENGTH, '0');
  return TOKEN_PREFIX + hexPart;
}

/**
 * 获取 token 对应的文件名
 * @param token Session token
 * @returns 文件名（如: sess-abc123...def.json）
 */
export function getTokenFileName(token: string): string {
  // 去掉前缀，保留十六进制部分作为文件名
  const hexPart = token.startsWith(TOKEN_PREFIX) 
    ? token.slice(TOKEN_PREFIX.length) 
    : token;
  return `${TOKEN_PREFIX}${hexPart}.json`;
}

/**
 * Session Token 管理器
 * 负责 Agent Session Token 的生成、验证和管理
 */
export class AgentTokenManager {
  private tokensDir: string;
  private tokens: Map<string, AgentTokenData> = new Map();
  private logger: Logger;
  private expireAfterMs: number;

  constructor(dataDir: string, options?: AgentTokenManagerOptions) {
    this.tokensDir = join(dataDir, 'session-tokens');
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
          this.logger.warn('Session token invalid structure, skipping', { file });
          continue;
        }
        
        this.tokens.set(tokenData.token, tokenData);
        this.logger.debug('Session token loaded', { 
          tokenPrefix: tokenData.token.slice(0, 8), 
          agentIdPrefix: tokenData.agentId.slice(0, 16) 
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('Failed to load session token', { file, error: msg });
      }
    }
    
    this.logger.info('Session tokens loaded', { count: this.tokens.size });
  }

  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    if (!existsSync(this.tokensDir)) {
      mkdirSync(this.tokensDir, { recursive: true });
      this.logger.info('Created session tokens directory', { path: this.tokensDir });
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
   * 生成并保存 session token
   * @param agentId Agent ID
   * @returns 生成的 session token
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
    
    this.logger.info('Session token generated', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: agentId.slice(0, 16),
      expiresAt: new Date(tokenData.expiresAt).toISOString(),
    });
    
    return token;
  }

  /**
   * 生成随机 session token
   * @returns 格式正确的 token（sess- + 64 hex chars）
   */
  private generateToken(): string {
    return TOKEN_PREFIX + randomBytes(32).toString('hex');
  }

  /**
   * 保存 token 到文件
   */
  private saveToFile(tokenData: AgentTokenData): void {
    const fileName = getTokenFileName(tokenData.token);
    const filePath = join(this.tokensDir, fileName);
    writeFileSync(filePath, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
  }

  /**
   * 验证 token 是否有效
   * @param token Session token
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
    
    // 更新最后使用时间（仅在内存中更新，避免频繁磁盘 IO）
    tokenData.lastUsedAt = Date.now();
    // 不在 verify() 中写入文件，lastUsedAt 仅用于内存追踪
    // 关键操作（revoke、cleanExpired）会在需要时持久化
    
    this.logger.debug('Token verified successfully', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: tokenData.agentId.slice(0, 16),
    });
    
    return { valid: true, agentId: tokenData.agentId };
  }

  /**
   * 验证 token 是否属于指定 agent
   * @param token Session token
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
   * @param token Session token
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
    
    this.logger.info('Session token revoked', {
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
        const fileName = getTokenFileName(token);
        const filePath = join(this.tokensDir, fileName);
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
   * @param token Session token
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
   * @param token Session token
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

  /**
   * 使用 timingSafeEqual 比较两个 token
   * 防止时序攻击
   */
  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    
    try {
      return timingSafeEqual(
        Buffer.from(a, 'utf-8'),
        Buffer.from(b, 'utf-8')
      );
    } catch {
      return false;
    }
  }
}