/**
 * 身份管理器
 * 管理 libp2p PeerId (Ed25519) 和 E2EE 密钥对 (X25519)
 * 持久化身份到本地文件系统
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { generateKeyPair, unmarshalPrivateKey, marshalPrivateKey } from '@libp2p/crypto/keys';
import { createFromPrivKey } from '@libp2p/peer-id-factory';
import type { PeerId } from '@libp2p/interface';
import type { PrivateKey } from '@libp2p/interface';
import { x25519 } from '@noble/curves/ed25519.js';
import { Logger } from '../../utils/logger.js';
import { success, failureFromError, Result } from '../../types/index.js';
import { encryptIdentity, decryptIdentity } from './encrypted-key-store.js';
import type { 
  PersistedIdentity, 
  IdentityManagerOptions, 
  ExportedIdentity,
  EncryptedIdentity 
} from './types.js';
import { DEFAULT_DATA_DIR, IDENTITY_FILE } from './types.js';

/**
 * 身份管理器
 * 
 * 负责：
 * - 管理 libp2p PeerId (Ed25519 密钥对)
 * - 管理 E2EE 密钥对 (X25519)
 * - 持久化身份到本地文件系统
 * - 支持密码加密存储
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

  constructor(options: IdentityManagerOptions = {}) {
    this.dataDir = options.dataDir || join(homedir(), DEFAULT_DATA_DIR);
    this.password = options.password;
    this.logger = new Logger({ component: 'Identity' });
  }

  /**
   * 获取身份数据文件路径
   */
  private getIdentityFilePath(): string {
    return join(this.dataDir, IDENTITY_FILE);
  }

  /**
   * 确保数据目录存在
   */
  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      // 设置目录权限为 700 (仅所有者可读写执行)
      await fs.chmod(this.dataDir, 0o700);
    } catch (error) {
      this.logger.error('Failed to create data directory', { error });
      throw error;
    }
  }

  /**
   * 加载或创建身份
   * 
   * - 如果存在身份文件，则加载
   * - 如果不存在，则创建新身份
   */
  async loadOrCreate(): Promise<Result<ExportedIdentity>> {
    try {
      await this.ensureDataDir();
      
      const identityFile = this.getIdentityFilePath();
      
      try {
        // 尝试读取现有身份
        const data = await fs.readFile(identityFile, 'utf-8');
        const encrypted = JSON.parse(data);
        
        // 解密或直接加载
        let persisted: PersistedIdentity;
        try {
          persisted = this.password 
            ? await decryptIdentity(encrypted, this.password)
            : encrypted as PersistedIdentity;
        } catch (decryptError) {
          // 解密失败（可能是密码错误），创建新身份
          this.logger.warn('Failed to decrypt identity, creating new one', {
            error: decryptError instanceof Error ? decryptError.message : String(decryptError)
          });
          return await this.createNewIdentity();
        }
        
        // 恢复私钥和 PeerId
        const privateKeyBytes = Buffer.from(persisted.peerId, 'base64');
        this.privateKey = await unmarshalPrivateKey(privateKeyBytes);
        this.peerId = await createFromPrivKey(this.privateKey);
        
        // 恢复 E2EE 密钥对
        this.e2eePrivateKey = Buffer.from(persisted.e2eePrivateKey, 'base64');
        this.e2eePublicKey = Buffer.from(persisted.e2eePublicKey, 'base64');
        this.createdAt = new Date(persisted.createdAt);
        
        // 更新最后使用时间
        await this.saveIdentity();
        
        this.logger.info('Loaded existing identity', {
          peerId: this.peerId.toString().slice(0, 16),
          createdAt: this.createdAt.toISOString()
        });
        
        return success(this.exportIdentity());
      } catch (readError: unknown) {
        // 文件不存在或解析失败，创建新身份
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
   * 创建新身份
   */
  private async createNewIdentity(): Promise<Result<ExportedIdentity>> {
    try {
      // 生成 Ed25519 密钥对用于 libp2p PeerId
      this.privateKey = await generateKeyPair('Ed25519');
      this.peerId = await createFromPrivKey(this.privateKey);
      
      // 生成 X25519 密钥对用于 E2EE
      this.e2eePrivateKey = x25519.utils.randomSecretKey();
      this.e2eePublicKey = x25519.getPublicKey(this.e2eePrivateKey);
      
      this.createdAt = new Date();
      
      // 保存身份
      await this.saveIdentity();
      
      this.logger.info('Created new identity', {
        peerId: this.peerId.toString().slice(0, 16),
        createdAt: this.createdAt.toISOString()
      });
      
      return success(this.exportIdentity());
    } catch (error) {
      return failureFromError('IDENTITY_CREATE_FAILED', 'Failed to create new identity', error as Error);
    }
  }

  /**
   * 保存身份到文件
   */
  private async saveIdentity(): Promise<void> {
    if (!this.privateKey || !this.peerId || !this.e2eePrivateKey || !this.e2eePublicKey || !this.createdAt) {
      throw new Error('Identity not initialized');
    }
    
    const persisted: PersistedIdentity = {
      peerId: Buffer.from(marshalPrivateKey(this.privateKey)).toString('base64'),
      e2eePrivateKey: Buffer.from(this.e2eePrivateKey).toString('base64'),
      e2eePublicKey: Buffer.from(this.e2eePublicKey).toString('base64'),
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    
    // 加密或直接保存
    const data = this.password 
      ? JSON.stringify(await encryptIdentity(persisted, this.password))
      : JSON.stringify(persisted, null, 2);
    
    const identityFile = this.getIdentityFilePath();
    await fs.writeFile(identityFile, data, 'utf-8');
    // 设置文件权限为 600 (仅所有者可读写)
    await fs.chmod(identityFile, 0o600);
  }

  /**
   * 导出身份信息
   */
  exportIdentity(): ExportedIdentity {
    if (!this.peerId || !this.privateKey || !this.e2eePublicKey || !this.e2eePrivateKey || !this.createdAt) {
      throw new Error('Identity not initialized');
    }
    
    return {
      peerId: this.peerId.toString(),
      privateKey: Buffer.from(marshalPrivateKey(this.privateKey)).toString('base64'),
      e2eeKeyPair: {
        publicKey: Buffer.from(this.e2eePublicKey).toString('base64'),
        privateKey: Buffer.from(this.e2eePrivateKey).toString('base64')
      },
      createdAt: this.createdAt
    };
  }

  /**
   * 获取 PeerId
   */
  getPeerId(): PeerId | null {
    return this.peerId;
  }

  /**
   * 获取 PeerId 字符串
   */
  getPeerIdString(): string | null {
    return this.peerId?.toString() || null;
  }

  /**
   * 获取 libp2p 私钥
   */
  getPrivateKey(): PrivateKey | null {
    return this.privateKey;
  }

  /**
   * 获取 E2EE 密钥对
   */
  getE2EEKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } | null {
    if (!this.e2eePublicKey || !this.e2eePrivateKey) return null;
    return {
      publicKey: this.e2eePublicKey,
      privateKey: this.e2eePrivateKey
    };
  }

  /**
   * 获取 E2EE 公钥 (base64)
   */
  getE2EEPublicKeyBase64(): string | null {
    return this.e2eePublicKey ? Buffer.from(this.e2eePublicKey).toString('base64') : null;
  }

  /**
   * 检查身份是否已加载
   */
  isLoaded(): boolean {
    return this.peerId !== null && this.privateKey !== null;
  }

  /**
   * 删除身份文件（危险操作）
   */
  async deleteIdentity(): Promise<Result<void>> {
    try {
      const identityFile = this.getIdentityFilePath();
      await fs.unlink(identityFile);
      
      // 清除内存中的数据
      this.peerId = null;
      this.privateKey = null;
      this.e2eePublicKey = null;
      this.e2eePrivateKey = null;
      this.createdAt = null;
      
      this.logger.warn('Identity deleted');
      return success(undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return success(undefined);
      }
      return failureFromError('IDENTITY_DELETE_FAILED', 'Failed to delete identity', error as Error);
    }
  }
}