/**
 * Identity Manager
 * Manages libp2p PeerId (Ed25519) and E2EE key pair (X25519)
 * Persists identity to local filesystem
 */

import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PeerId, PrivateKey } from '@libp2p/interface';
import { x25519 } from '@noble/curves/ed25519.js';
import { Logger } from '../../utils/logger.js';
import { success, failure, failureFromError, Result, createError } from '../../types/index.js';
import { encryptIdentity, decryptIdentity } from './encrypted-key-store.js';
import type { 
  PersistedIdentity, 
  IdentityManagerOptions, 
  ExportedIdentity
} from './types.js';
import { DEFAULT_DATA_DIR, IDENTITY_FILE, isEncryptedIdentity } from './types.js';
import type { EncryptedIdentity } from './types.js';
import { isValidBase64, secureWipe } from '../../utils/crypto-utils.js';

/**
 * Identity Manager
 * 
 * Responsibilities:
 * - Manage libp2p PeerId (Ed25519 key pair)
 * - Manage E2EE key pair (X25519)
 * - Persist identity to local filesystem
 * - Support password-encrypted storage
 */
export class IdentityManager {
  private dataDir: string;
  private password?: string;
  private peerId: PeerId | null = null;
  private privateKey: PrivateKey | null = null;
  private e2eePublicKey: Uint8Array | null = null;
  private e2eePrivateKey: Uint8Array | null = null;
  private createdAt: Date | null = null;
  private logger: Logger;
  /** P0 修复：并发锁，防止 loadOrCreate 重复调用 */
  private loadPromise: Promise<Result<ExportedIdentity>> | null = null;
  /** P1-2 修复：exportIdentity 调用计数器，用于频率限制 */
  private exportCallCount: number = 0;
  /** P2 修复：滑动窗口 - 记录所有导出调用的时间戳 */
  private exportTimestamps: number[] = [];
  /** P2 修复：滑动窗口大小（毫秒）- 1分钟窗口 */
  private static readonly EXPORT_WINDOW_MS = 60000;
  /** P2 修复：窗口内最大调用次数 */
  private static readonly EXPORT_MAX_IN_WINDOW = 5;
  /** P1-2 修复：exportIdentity 最大调用次数警告阈值 */
  private static readonly EXPORT_MAX_CALLS_WARN = 10;

  constructor(options: IdentityManagerOptions = {}) {
    // 先初始化 logger
    this.logger = new Logger({ component: 'Identity' });
    
    // P1 修复：路径遍历保护 - 验证和清理路径
    let dataDir = options.dataDir || join(homedir(), DEFAULT_DATA_DIR);
    
    // 解析为绝对路径，防止相对路径遍历
    dataDir = resolve(dataDir);
    
    // 允许的路径前缀
    const systemTmpDir = resolve(tmpdir());
    const homeDir = homedir();
    
    // 检查路径是否包含可疑的遍历模式或不在允许的目录下
    if (dataDir.includes('..')) {
      this.logger.warn('Suspicious path traversal detected', { path: dataDir });
      dataDir = join(homedir(), DEFAULT_DATA_DIR);
    } else if (!dataDir.startsWith(homeDir) && !dataDir.startsWith(systemTmpDir)) {
      // 允许 home 目录和系统临时目录
      this.logger.warn('dataDir is outside home and system temp directory', { 
        path: dataDir,
        hint: 'Path should be under home directory or system temp'
      });
      // 不强制重定向，只记录警告
    }
    
    this.dataDir = dataDir;
    this.password = options.password;
  }

  /**
   * Get identity data file path
   */
  private getIdentityFilePath(): string {
    return join(this.dataDir, IDENTITY_FILE);
  }

  /**
   * Ensure data directory exists with secure permissions
   */
  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      // Set directory permissions to 700 (owner only)
      await fs.chmod(this.dataDir, 0o700);
    } catch (error) {
      this.logger.error('Failed to create data directory', { error });
      throw error;
    }
  }

  /**
   * Load or create identity
   * 
   * - If identity file exists, load it
   * - If not, create new identity
   * - P0 修复：添加并发保护，防止重复调用
   * - P1 修复：已加载时直接返回现有身份
   */
  async loadOrCreate(): Promise<Result<ExportedIdentity>> {
    // P1 修复：如果已加载，直接返回现有身份
    if (this.isLoaded()) {
      return success(this.exportIdentityInternal());
    }

    // P0 修复：并发保护 - 如果正在加载，等待现有操作完成
    if (this.loadPromise) {
      return this.loadPromise;
    }

    // 创建新的加载操作
    this.loadPromise = this.doLoadOrCreate();
    
    try {
      const result = await this.loadPromise;
      return result;
    } finally {
      // 清除锁，允许后续调用
      this.loadPromise = null;
    }
  }

  /**
   * 实际的加载或创建逻辑（内部方法）
   */
  private async doLoadOrCreate(): Promise<Result<ExportedIdentity>> {
    try {
      await this.ensureDataDir();
      
      const identityFile = this.getIdentityFilePath();
      
      try {
        // Try to read existing identity
        const data = await fs.readFile(identityFile, 'utf-8');
        
        // P1 修复：安全解析 JSON，处理文件损坏
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (parseError) {
          this.logger.error('Identity file is corrupted - invalid JSON', {
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
          return failure(createError(
            'IDENTITY_CORRUPTED',
            'Identity file is corrupted and cannot be parsed. The file may need to be deleted and a new identity created.'
          ));
        }
        
        // P1 修复：类型安全检查 - 验证解析结果是否为有效对象
        if (typeof parsed !== 'object' || parsed === null) {
          this.logger.error('Identity file is corrupted - not an object');
          return failure(createError(
            'IDENTITY_CORRUPTED',
            'Identity file is corrupted: invalid data structure.'
          ));
        }
        
        // Check if file is encrypted
        const parsedObj = parsed as Record<string, unknown>;
        // P2 修复：类型守卫验证 - 检查 encrypted 字段是否为布尔值
        const encryptedValue = parsedObj.encrypted;
        const isEncrypted = typeof encryptedValue === 'boolean' && encryptedValue === true;
        
        if (isEncrypted) {
          // File is encrypted, password is required
          if (this.password === undefined || this.password === '') {
            this.logger.error('Identity file is encrypted but no password provided');
            return failure(createError(
              'IDENTITY_PASSWORD_REQUIRED',
              'Identity file is encrypted but no password was provided. Please provide a password to decrypt.'
            ));
          }
          
          // Attempt decryption
          try {
            // P2 修复：使用类型守卫验证 EncryptedIdentity 结构
            if (!isEncryptedIdentity(parsedObj)) {
              this.logger.error('Identity file is corrupted - invalid encrypted identity structure');
              return failure(createError(
                'IDENTITY_CORRUPTED',
                'Identity file is corrupted: invalid encrypted identity structure.'
              ));
            }
            const persisted = decryptIdentity(parsedObj, this.password);
            await this.loadPersistedIdentity(persisted);
            
            // Update last used time
            await this.saveIdentity();
            
            this.logger.info('Loaded existing encrypted identity', {
              peerId: this.peerId?.toString().slice(0, 16),
              createdAt: this.createdAt?.toISOString()
            });
            
            return success(this.exportIdentityInternal());
          } catch (decryptError) {
            this.logger.error('Failed to decrypt identity with provided password', {
              error: decryptError instanceof Error ? decryptError.message : String(decryptError)
            });
            return failure(createError(
              'IDENTITY_DECRYPT_FAILED',
              'Failed to decrypt identity. The password may be incorrect.'
            ));
          }
        }
        
        // Plaintext identity data (backward compatible)
        const persisted = parsed as PersistedIdentity;
        await this.loadPersistedIdentity(persisted);
        
        // Update last used time
        await this.saveIdentity();
        
        this.logger.info('Loaded existing plaintext identity', {
          peerId: this.peerId?.toString().slice(0, 16),
          createdAt: this.createdAt?.toISOString()
        });
        
        // Warn about plaintext storage
        this.logger.warn('Identity is stored in plaintext. Consider setting a password for encryption.');
        
        return success(this.exportIdentityInternal());
      } catch (readError: unknown) {
        // File doesn't exist or parse failed, create new identity
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          this.logger.info('No existing identity found, creating new one');
          return await this.createNewIdentity();
        }
        throw readError;
      }
    } catch (error) {
      return failureFromError('IDENTITY_LOAD_FAILED', 'Failed to load or create identity', error as Error);
    }
  }

  /**
   * Load identity from persisted data
   * 
   * P1-1 修复: 从 private 改为 protected，允许子类访问
   */
  protected async loadPersistedIdentity(persisted: PersistedIdentity): Promise<void> {
    // P4 修复：验证字段是否为有效的 base64
    if (!isValidBase64(persisted.peerId)) {
      throw new Error('Invalid persisted identity: peerId is not valid base64');
    }
    if (!isValidBase64(persisted.e2eePrivateKey)) {
      throw new Error('Invalid persisted identity: e2eePrivateKey is not valid base64');
    }
    if (!isValidBase64(persisted.e2eePublicKey)) {
      throw new Error('Invalid persisted identity: e2eePublicKey is not valid base64');
    }
    
    // Restore private key and PeerId
    const privateKeyBytes = Buffer.from(persisted.peerId, 'base64');
    this.privateKey = await privateKeyFromProtobuf(privateKeyBytes);
    this.peerId = peerIdFromPrivateKey(this.privateKey);

    // Securely wipe temporary private key bytes after use
    secureWipe(privateKeyBytes);

    // Restore E2EE key pair
    this.e2eePrivateKey = Buffer.from(persisted.e2eePrivateKey, 'base64');
    this.e2eePublicKey = Buffer.from(persisted.e2eePublicKey, 'base64');
    
    // P1-1 修复：验证 createdAt 日期格式有效性
    const parsedDate = new Date(persisted.createdAt);
    if (isNaN(parsedDate.getTime())) {
      throw new Error('Invalid persisted identity: createdAt is not a valid date format');
    }
    this.createdAt = parsedDate;
  }

  /**
   * Create new identity
   */
  private async createNewIdentity(): Promise<Result<ExportedIdentity>> {
    try {
      // Generate Ed25519 key pair for libp2p PeerId
      this.privateKey = await generateKeyPair('Ed25519');
      this.peerId = peerIdFromPrivateKey(this.privateKey);
      
      // Generate X25519 key pair for E2EE
      this.e2eePrivateKey = x25519.utils.randomSecretKey();
      this.e2eePublicKey = x25519.getPublicKey(this.e2eePrivateKey);
      
      this.createdAt = new Date();
      
      // Save identity
      await this.saveIdentity();
      
      this.logger.info('Created new identity', {
        peerId: this.peerId.toString().slice(0, 16),
        createdAt: this.createdAt.toISOString()
      });
      
      return success(this.exportIdentityInternal());
    } catch (error) {
      return failureFromError('IDENTITY_CREATE_FAILED', 'Failed to create new identity', error as Error);
    }
  }

  /**
   * Save identity to file
   */
  private async saveIdentity(): Promise<void> {
    if (!this.privateKey || !this.peerId || !this.e2eePrivateKey || !this.e2eePublicKey || !this.createdAt) {
      throw new Error('Identity not initialized');
    }
    
    const persisted: PersistedIdentity = {
      peerId: Buffer.from(privateKeyToProtobuf(this.privateKey)).toString('base64'),
      e2eePrivateKey: Buffer.from(this.e2eePrivateKey).toString('base64'),
      e2eePublicKey: Buffer.from(this.e2eePublicKey).toString('base64'),
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    
    // Medium 修复：提取公共文件写入逻辑，避免重复代码
    const shouldEncrypt = this.password !== undefined && this.password !== '';
    
    if (!shouldEncrypt) {
      // Warn about plaintext storage
      this.logger.warn('Saving identity without encryption. Consider setting a password for better security.');
    }
    
    const data = shouldEncrypt
      ? JSON.stringify(encryptIdentity(persisted, this.password!))
      : JSON.stringify(persisted, null, 2);
    
    await this.writeIdentityFile(data);
  }

  /**
   * 写入身份文件（内部方法）
   * @param data 要写入的数据
   */
  private async writeIdentityFile(data: string): Promise<void> {
    const identityFile = this.getIdentityFilePath();
    await fs.writeFile(identityFile, data, 'utf-8');
    // Set file permissions to 600 (owner only)
    await fs.chmod(identityFile, 0o600);
  }

  /**
   * Export identity information (internal version, no rate limiting)
   * 
   * 用于内部调用，不触发频率限制。
   * 
   * 安全考虑：
   * - 此方法是私有的，不会被外部直接调用
   * - 仅在 loadOrCreate 返回结果时使用，确保调用者获得完整的身份信息
   * - 结果不会被记录或存储，直接返回给调用者
   * - 如果需要追踪，可以在此处添加 DEBUG 级别日志（不含私钥内容）
   */
  private exportIdentityInternal(): ExportedIdentity {
    if (!this.peerId || !this.privateKey || !this.e2eePublicKey || !this.e2eePrivateKey || !this.createdAt) {
      throw new Error('Identity not initialized');
    }
    
    // P2 修复：添加 DEBUG 级别审计日志（不含敏感数据）
    this.logger.debug('exportIdentityInternal called (internal use)', {
      peerId: this.peerId.toString().slice(0, 16)
    });
    
    return {
      peerId: this.peerId.toString(),
      privateKey: Buffer.from(privateKeyToProtobuf(this.privateKey)).toString('base64'),
      e2eeKeyPair: {
        publicKey: Buffer.from(this.e2eePublicKey).toString('base64'),
        privateKey: Buffer.from(this.e2eePrivateKey).toString('base64')
      },
      createdAt: this.createdAt
    };
  }

  /**
   * Export identity information
   * 
   * WARNING: This returns sensitive private key material in plaintext.
   * - Do not log or expose the returned data
   * - Clear from memory when no longer needed
   * - Only call when absolutely necessary
   * 
   * P1-2 修复：添加调用频率限制和审计日志
   * P2 修复：实现滑动窗口限制，防止频率限制绕过
   */
  exportIdentity(): ExportedIdentity {
    if (!this.peerId || !this.privateKey || !this.e2eePublicKey || !this.e2eePrivateKey || !this.createdAt) {
      throw new Error('Identity not initialized');
    }
    
    // P2 修复：滑动窗口频率限制
    const now = Date.now();
    
    // 1. 清理过期的时间戳（超过60秒窗口的）
    this.exportTimestamps = this.exportTimestamps.filter(
      timestamp => now - timestamp < IdentityManager.EXPORT_WINDOW_MS
    );
    
    // 2. 检查当前窗口内的调用次数
    if (this.exportTimestamps.length >= IdentityManager.EXPORT_MAX_IN_WINDOW) {
      const oldestInWindow = this.exportTimestamps[0];
      const retryAfterMs = IdentityManager.EXPORT_WINDOW_MS - (now - oldestInWindow);
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      
      this.logger.warn('SECURITY: exportIdentity rate limit exceeded', {
        callCountInWindow: this.exportTimestamps.length,
        maxAllowed: IdentityManager.EXPORT_MAX_IN_WINDOW,
        retryAfterSeconds: retryAfterSec
      });
      
      throw new Error(
        `exportIdentity rate limit exceeded. Maximum ${IdentityManager.EXPORT_MAX_IN_WINDOW} calls per minute. ` +
        `Please try again in ${retryAfterSec} seconds.`
      );
    }
    
    // 3. 记录本次调用时间戳
    this.exportTimestamps.push(now);
    
    // P1-2 修复：审计日志 - 记录敏感操作
    this.exportCallCount++;
    this.logger.warn('SECURITY: exportIdentity called - private key material exported', {
      peerId: this.peerId.toString().slice(0, 16),
      callCount: this.exportCallCount,
      callsInWindow: this.exportTimestamps.length,
      timestamp: new Date().toISOString()
    });
    
    // P1-2 修复：调用次数警告
    if (this.exportCallCount >= IdentityManager.EXPORT_MAX_CALLS_WARN) {
      this.logger.warn('SECURITY: exportIdentity has been called many times', {
        callCount: this.exportCallCount,
        warning: 'Frequent exports of private key material may indicate a security issue'
      });
    }
    
    return {
      peerId: this.peerId.toString(),
      privateKey: Buffer.from(privateKeyToProtobuf(this.privateKey)).toString('base64'),
      e2eeKeyPair: {
        publicKey: Buffer.from(this.e2eePublicKey).toString('base64'),
        privateKey: Buffer.from(this.e2eePrivateKey).toString('base64')
      },
      createdAt: this.createdAt
    };
  }

  /**
   * Get PeerId
   */
  getPeerId(): PeerId | null {
    return this.peerId;
  }

  /**
   * Get PeerId string
   */
  getPeerIdString(): string | null {
    return this.peerId?.toString() || null;
  }

  /**
   * Get libp2p private key
   */
  getPrivateKey(): PrivateKey | null {
    return this.privateKey;
  }

  /**
   * Get E2EE key pair
   *
   * @敏感 此方法返回敏感的私钥材料
   * - 不要记录或暴露返回的数据
   * - 使用完毕后从内存中清除
   * - 仅在必要时调用
   */
  getE2EEKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } | null {
    if (!this.e2eePublicKey || !this.e2eePrivateKey) return null;
    
    // P2 修复：添加审计日志
    this.logger.warn('SECURITY: getE2EEKeyPair called - private key material accessed', {
      peerId: this.peerId?.toString().slice(0, 16),
      timestamp: new Date().toISOString()
    });
    
    return {
      publicKey: this.e2eePublicKey,
      privateKey: this.e2eePrivateKey
    };
  }

  /**
   * Get E2EE public key (base64)
   */
  getE2EEPublicKeyBase64(): string | null {
    return this.e2eePublicKey ? Buffer.from(this.e2eePublicKey).toString('base64') : null;
  }

  /**
   * Check if identity is fully loaded
   */
  isLoaded(): boolean {
    return (
      this.peerId !== null &&
      this.privateKey !== null &&
      this.e2eePublicKey !== null &&
      this.e2eePrivateKey !== null &&
      this.createdAt !== null
    );
  }

  /**
   * Delete identity file and securely wipe memory (dangerous operation)
   */
  async deleteIdentity(): Promise<Result<void>> {
    try {
      const identityFile = this.getIdentityFilePath();
      await fs.unlink(identityFile);
      
      // Securely wipe private key data from memory
      if (this.e2eePrivateKey) {
        secureWipe(this.e2eePrivateKey);
      }
      
      // Securely wipe libp2p Ed25519 private key bytes
      if (this.privateKey) {
        // Access the raw bytes of the Ed25519 private key and wipe them
        const privateKeyBytes = this.privateKey.raw;
        if (privateKeyBytes) {
          secureWipe(privateKeyBytes);
        }
      }
      
      // Clear all identity data from memory
      this.peerId = null;
      this.privateKey = null;
      this.e2eePublicKey = null;
      this.e2eePrivateKey = null;
      this.createdAt = null;
      
      // P2 修复：清除频率限制状态
      this.exportCallCount = 0;
      this.exportTimestamps = [];
      
      this.logger.warn('Identity deleted and memory cleared');
      return success(undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return success(undefined);
      }
      return failureFromError('IDENTITY_DELETE_FAILED', 'Failed to delete identity', error as Error);
    }
  }
}