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
 * 
 * 🔒 加密保护（v2）:
 * - 每个 Agent 有独立的存储目录
 * - Token 文件用 AES-256-GCM 加密
 * - 只有拥有加密密钥的 Agent 才能解密
 * - 按 agentId 分组的内存 Map（隔离性）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Logger } from '@f2a/network';
import { TokenEncryption, EncryptedData } from './token-encryption.js';

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
  /** 是否使用加密（默认 true，向后兼容设为 false 可禁用） */
  useEncryption?: boolean;
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
 * 
 * 🔒 v2: 每个 Agent 有独立的存储目录 + 加密保护
 */
export class AgentTokenManager {
  private agentsDir: string;
  private agentId: string;
  private tokensDir: string;
  private tokens: Map<string, AgentTokenData> = new Map();
  /** 按 agentId 分组的内存 Map（v2 新增） */
  private tokensByAgent: Map<string, Map<string, AgentTokenData>> = new Map();
  private logger: Logger;
  private expireAfterMs: number;
  private encryption: TokenEncryption | null = null;
  private useEncryption: boolean;

  constructor(dataDir: string, agentId: string, options?: AgentTokenManagerOptions) {
    // v2: 每个 Agent 有独立目录
    this.agentsDir = join(dataDir, 'agents');
    this.agentId = agentId;
    this.tokensDir = join(this.agentsDir, agentId, 'tokens');
    
    this.logger = new Logger({ component: 'AgentTokenManager' });
    this.expireAfterMs = options?.expireAfterMs ?? DEFAULT_EXPIRE_AFTER_MS;
    this.useEncryption = options?.useEncryption ?? true;
    
    // 初始化加密（v2 新增）
    if (this.useEncryption) {
      this.encryption = new TokenEncryption(dataDir, agentId);
      this.encryption.initialize();
      this.logger.info('Token encryption initialized', {
        agentIdPrefix: agentId.slice(0, 16),
        keyFilePath: this.encryption.getKeyFilePath()
      });
    }
    
    // 初始化内存分组
    this.tokensByAgent.set(agentId, this.tokens);
  }

  /**
   * 初始化：确保目录存在并加载当前 agent 的 token
   * v2: loadAll → loadForAgent（只加载当前 agent）
   */
  loadForAgent(): void {
    this.ensureDir();
    
    const files = readdirSync(this.tokensDir)
      .filter(f => f.endsWith('.json') && f.startsWith(TOKEN_PREFIX));
    
    this.tokens.clear();
    
    for (const file of files) {
      try {
        const filePath = join(this.tokensDir, file);
        const content = readFileSync(filePath, 'utf-8');
        
        let tokenData: AgentTokenData;
        
        // v2: 加密模式下需要解密
        if (this.useEncryption && this.encryption) {
          try {
            const encrypted = JSON.parse(content) as EncryptedData;
            const decrypted = this.encryption.decrypt(encrypted);
            tokenData = JSON.parse(decrypted, (key, value) => {
              // 安全 JSON.parse：过滤危险 key
              if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                return undefined;
              }
              return value;
            }) as AgentTokenData;
          } catch (decryptErr) {
            const msg = decryptErr instanceof Error ? decryptErr.message : String(decryptErr);
            this.logger.error('Failed to decrypt token file, skipping', { 
              file, 
              error: msg,
              hint: 'Key may be missing or data corrupted'
            });
            continue;
          }
        } else {
          // 非加密模式（向后兼容）
          tokenData = JSON.parse(content, (key, value) => {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              return undefined;
            }
            return value;
          }) as AgentTokenData;
        }
        
        // 验证基本结构
        if (!this.validateTokenStructure(tokenData)) {
          this.logger.warn('Agent token invalid structure, skipping', { file });
          continue;
        }
        
        this.tokens.set(tokenData.token, tokenData);
        this.logger.debug('Agent token loaded', { 
          tokenPrefix: tokenData.token.slice(0, 8), 
          agentIdPrefix: tokenData.agentId.slice(0, 16),
          encrypted: this.useEncryption
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('Failed to load agent token', { file, error: msg });
      }
    }
    
    this.logger.info('Agent tokens loaded', { 
      count: this.tokens.size,
      agentIdPrefix: this.agentId.slice(0, 16),
      encrypted: this.useEncryption
    });
  }

  /**
   * 向后兼容：loadAll 别名
   * @deprecated 使用 loadForAgent() 替代
   */
  loadAll(): void {
    this.loadForAgent();
  }

  /**
   * 确保目录存在
   */
  private ensureDir(): void {
    if (!existsSync(this.tokensDir)) {
      mkdirSync(this.tokensDir, { recursive: true, mode: 0o700 });
      this.logger.info('Created agent tokens directory', { 
        path: this.tokensDir,
        agentIdPrefix: this.agentId.slice(0, 16)
      });
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
   * @param agentId Agent ID（必须与当前 agentId 一致）
   * @returns 生成的 agent token
   */
  generateAndSave(agentId: string): string {
    // v2: 验证 agentId 必须与当前 agent 一致
    if (agentId !== this.agentId) {
      this.logger.error('Cannot generate token for different agent', {
        currentAgentIdPrefix: this.agentId.slice(0, 16),
        requestedAgentIdPrefix: agentId.slice(0, 16)
      });
      throw new Error(`Cannot generate token for agent ${agentId}: only current agent ${this.agentId} is allowed`);
    }
    
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
    
    // 保存到文件（v2: 加密保存）
    this.saveToFile(tokenData);
    
    this.logger.info('Agent token generated', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: agentId.slice(0, 16),
      expiresAt: new Date(tokenData.expiresAt).toISOString(),
      encrypted: this.useEncryption
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
   * v2: 加密保存
   */
  private saveToFile(tokenData: AgentTokenData): void {
    const hexPart = tokenData.token.slice(TOKEN_PREFIX.length);
    const filePath = join(this.tokensDir, TOKEN_PREFIX + hexPart + '.json');
    
    let content: string;
    
    if (this.useEncryption && this.encryption) {
      // v2: 加密保存
      const plaintext = JSON.stringify(tokenData);
      const encrypted = this.encryption.encrypt(plaintext);
      content = JSON.stringify(encrypted);
      
      this.logger.debug('Token encrypted before save', {
        tokenPrefix: tokenData.token.slice(0, 8),
        algorithm: encrypted.algorithm
      });
    } else {
      // 非加密模式（向后兼容）
      content = JSON.stringify(tokenData, null, 2);
    }
    
    // 文件权限保持 0o600
    writeFileSync(filePath, content, { mode: 0o600 });
    
    this.logger.debug('Token saved to file', {
      tokenPrefix: tokenData.token.slice(0, 8),
      path: filePath,
      encrypted: this.useEncryption
    });
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
        agentIdPrefix: this.agentId.slice(0, 16)
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
   * v2: 使用 tokensByAgent Map 查找（其他 agent 的 token 不可见）
   * @param token Agent token
   * @param agentId Agent ID
   * @returns 验证结果
   */
  verifyForAgent(token: string | undefined, agentId: string): { valid: boolean; error?: string } {
    // v2: 使用 tokensByAgent 查找，确保隔离性
    const agentTokens = this.tokensByAgent.get(agentId);
    
    if (!agentTokens) {
      this.logger.warn('Token verification failed: agent not in memory map', {
        tokenPrefix: token?.slice(0, 8),
        agentIdPrefix: agentId.slice(0, 16)
      });
      return { valid: false, error: 'Agent tokens not available' };
    }
    
    if (!token) {
      return { valid: false, error: 'Token is empty' };
    }
    
    const tokenData = agentTokens.get(token);
    
    // 检查 token 是否存在于该 agent 的 tokens 中
    if (!tokenData) {
      this.logger.warn('Token verification failed: token not found for this agent', {
        tokenPrefix: token.slice(0, 8),
        agentIdPrefix: agentId.slice(0, 16)
      });
      // ← 其他 agent 的 token 不会出现在这里
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
        agentIdPrefix: this.agentId.slice(0, 16)
      });
      return false;
    }
    
    tokenData.revoked = true;
    tokenData.lastUsedAt = Date.now();
    
    // 更新文件（v2: 加密保存）
    this.saveToFile(tokenData);
    
    this.logger.info('Agent token revoked', {
      tokenPrefix: token.slice(0, 8),
      agentIdPrefix: tokenData.agentId.slice(0, 16),
      encrypted: this.useEncryption
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
        
        // 从 tokensByAgent 中同步删除
        const agentTokens = this.tokensByAgent.get(this.agentId);
        if (agentTokens) {
          agentTokens.delete(token);
        }
        
        // 删除文件
        const hexPart = token.slice(TOKEN_PREFIX.length);
        const filePath = join(this.tokensDir, TOKEN_PREFIX + hexPart + '.json');
        if (existsSync(filePath)) {
          rmSync(filePath);
          this.logger.debug('Token file deleted', { path: filePath });
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
      this.logger.info('Expired tokens cleaned', { 
        count: cleanedCount,
        agentIdPrefix: this.agentId.slice(0, 16)
      });
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
   * 列出所有 token（当前 agent）
   * @returns Token 数据列表
   */
  list(): AgentTokenData[] {
    return Array.from(this.tokens.values());
  }

  /**
   * 获取指定 agent 的所有 token
   * v2: 使用 tokensByAgent 查找
   * @param agentId Agent ID
   * @returns Token 数据列表
   */
  listByAgent(agentId: string): AgentTokenData[] {
    const agentTokens = this.tokensByAgent.get(agentId);
    if (!agentTokens) {
      // 其他 agent 的 token 对当前 agent 不可见
      this.logger.warn('Agent tokens not available', {
        agentIdPrefix: agentId.slice(0, 16)
      });
      return [];
    }
    return Array.from(agentTokens.values());
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
    
    // 清理 tokensByAgent
    this.tokensByAgent.delete(this.agentId);
    
    if (existsSync(this.tokensDir)) {
      const files = readdirSync(this.tokensDir)
        .filter(f => f.endsWith('.json') && f.startsWith(TOKEN_PREFIX));
      for (const file of files) {
        rmSync(join(this.tokensDir, file));
      }
    }
    
    this.logger.debug('All tokens cleared', {
      agentIdPrefix: this.agentId.slice(0, 16)
    });
  }

  /**
   * 获取当前 Agent ID
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * 获取 tokens 目录
   */
  getTokensDir(): string {
    return this.tokensDir;
  }

  /**
   * 检查是否使用加密
   */
  isEncrypted(): boolean {
    return this.useEncryption;
  }
}