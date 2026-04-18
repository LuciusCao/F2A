/**
 * Token Encryption
 * 使用 AES-256-GCM 加密 Agent Token
 * 
 * 安全特性：
 * - 每个 Agent 有独立的加密密钥
 * - 密钥文件权限 0o600
 * - AES-256-GCM 提供加密 + 认证
 * - 随机 IV 防止密文分析
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { Logger } from '@f2a/network';

/** AES-256-GCM 参数 */
const AES_KEY_SIZE = 32; // 256 bits
const AES_IV_SIZE = 16;  // 128 bits
const AES_TAG_SIZE = 16; // 128 bits

/** 加密后的数据结构 */
export interface EncryptedData {
  /** 加密算法 */
  algorithm: 'AES-256-GCM';
  /** IV (base64) */
  iv: string;
  /** 认证标签 (base64) */
  authTag: string;
  /** 密文 (base64) */
  ciphertext: string;
  /** 创建时间 */
  createdAt: number;
}

/**
 * Token 加密器
 * 使用对称加密（AES-256-GCM）保护 Agent Token
 */
export class TokenEncryption {
  private logger: Logger;
  private encryptionKey: Buffer | null = null;
  private keyFilePath: string;
  private agentId: string;

  constructor(dataDir: string, agentId: string) {
    this.logger = new Logger({ component: 'TokenEncryption' });
    this.agentId = agentId;
    this.keyFilePath = join(dataDir, 'agents', agentId, 'token-encryption.key');
  }

  /**
   * 初始化：加载或创建加密密钥
   */
  initialize(): void {
    this.loadOrCreateKey();
  }

  /**
   * 加载现有密钥或创建新密钥
   */
  private loadOrCreateKey(): void {
    const agentDir = join(this.keyFilePath, '..');
    
    // 确保 agent 目录存在
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true, mode: 0o700 });
      this.logger.info('Created agent directory', { 
        agentId: this.agentId.slice(0, 16),
        path: agentDir 
      });
    }

    if (existsSync(this.keyFilePath)) {
      // 加载现有密钥
      try {
        const keyData = readFileSync(this.keyFilePath, 'utf-8');
        this.encryptionKey = Buffer.from(keyData, 'base64');
        
        // 验证密钥长度
        if (this.encryptionKey.length !== AES_KEY_SIZE) {
          this.logger.warn('Invalid key size, regenerating', {
            expected: AES_KEY_SIZE,
            actual: this.encryptionKey.length
          });
          this.generateNewKey();
        } else {
          this.logger.info('Encryption key loaded', {
            agentId: this.agentId.slice(0, 16)
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('Failed to load encryption key, regenerating', {
          error: msg
        });
        this.generateNewKey();
      }
    } else {
      // 创建新密钥
      this.generateNewKey();
    }
  }

  /**
   * 生成新的加密密钥
   */
  private generateNewKey(): void {
    this.encryptionKey = randomBytes(AES_KEY_SIZE);
    
    // 保存密钥文件（权限 0o600）
    writeFileSync(
      this.keyFilePath,
      this.encryptionKey.toString('base64'),
      { mode: 0o600 }
    );
    
    this.logger.info('New encryption key generated', {
      agentId: this.agentId.slice(0, 16),
      path: this.keyFilePath
    });
  }

  /**
   * 加密数据
   * @param plaintext 明文
   * @returns 加密后的数据结构
   */
  encrypt(plaintext: string): EncryptedData {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    // 生成随机 IV
    const iv = randomBytes(AES_IV_SIZE);
    
    // 创建加密器（AES-256-GCM）
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    // 加密
    const ciphertext = cipher.update(plaintext, 'utf-8', 'base64') + 
                       cipher.final('base64');
    
    // 获取认证标签
    const authTag = cipher.getAuthTag();
    
    this.logger.debug('Data encrypted', {
      ivLength: iv.length,
      ciphertextLength: ciphertext.length
    });
    
    return {
      algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext,
      createdAt: Date.now()
    };
  }

  /**
   * 解密数据
   * @param encrypted 加密后的数据
   * @returns 明文
   */
  decrypt(encrypted: EncryptedData): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    // 验证算法
    if (encrypted.algorithm !== 'AES-256-GCM') {
      throw new Error(`Unsupported algorithm: ${encrypted.algorithm}`);
    }

    // 解析 IV 和 authTag
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    
    // 验证长度
    if (iv.length !== AES_IV_SIZE) {
      throw new Error(`Invalid IV length: ${iv.length}, expected ${AES_IV_SIZE}`);
    }
    if (authTag.length !== AES_TAG_SIZE) {
      throw new Error(`Invalid authTag length: ${authTag.length}, expected ${AES_TAG_SIZE}`);
    }

    // 创建解密器
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    // 设置认证标签
    decipher.setAuthTag(authTag);
    
    // 解密
    try {
      const plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf-8') +
                        decipher.final('utf-8');
      
      this.logger.debug('Data decrypted successfully');
      return plaintext;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Decryption failed - data may be corrupted or tampered', {
        error: msg
      });
      throw new Error('Decryption failed - authentication tag mismatch');
    }
  }

  /**
   * 检查密钥是否存在
   */
  hasKey(): boolean {
    return this.encryptionKey !== null;
  }

  /**
   * 清理密钥（用于测试）
   */
  clearKey(): void {
    if (this.encryptionKey) {
      this.encryptionKey.fill(0);
      this.encryptionKey = null;
    }
    
    if (existsSync(this.keyFilePath)) {
      rmSync(this.keyFilePath);
    }
  }

  /**
   * 获取密钥文件路径
   */
  getKeyFilePath(): string {
    return this.keyFilePath;
  }
}