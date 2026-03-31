/**
 * Node Identity Manager
 * 
 * 管理物理节点的持久化身份。
 * 继承 IdentityManager 的功能，添加 Node 特定的功能：
 * - 存储在 ~/.f2a/node-identity.json
 * - 可选择加密存储
 * - 可为 Agent 签发身份
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { IdentityManager } from './identity-manager.js';
import { encryptIdentity, decryptIdentity } from './encrypted-key-store.js';
import { Logger } from '../../utils/logger.js';
import { success, failure, failureFromError, Result, createError } from '../../types/index.js';
import { isValidBase64 } from '../../utils/crypto-utils.js';
import type { 
  NodeIdentityOptions,
  PersistedNodeIdentity,
  ExportedNodeIdentity,
  PersistedIdentity
} from './types.js';
import { DEFAULT_DATA_DIR, NODE_IDENTITY_FILE, isEncryptedIdentity } from './types.js';
import type { EncryptedIdentity } from './types.js';

/** Node ID 格式验证正则表达式 (P1-4) */
const NODE_ID_PATTERN = /^[a-zA-Z0-9-]+$/;
const NODE_ID_MAX_LENGTH = 64;
const NODE_ID_MIN_LENGTH = 1;

/**
 * 验证 Node ID 格式 (P1-4)
 * @param nodeId 要验证的 Node ID
 * @returns 是否有效
 */
export function isValidNodeId(nodeId: string): boolean {
  if (typeof nodeId !== 'string') return false;
  if (nodeId.length < NODE_ID_MIN_LENGTH || nodeId.length > NODE_ID_MAX_LENGTH) return false;
  return NODE_ID_PATTERN.test(nodeId);
}

/**
 * Node Identity Manager
 * 
 * 继承 IdentityManager，添加 Node 特定功能：
 * - 使用单独的文件存储 (node-identity.json)
 * - 支持加密存储
 * - 提供 Node ID 和签名能力
 */
export class NodeIdentityManager extends IdentityManager {
  private nodeDataDir: string;
  private nodePassword?: string;
  private nodeId: string | null = null;
  private nodeLogger: Logger;
  private nodeLoadPromise: Promise<Result<ExportedNodeIdentity>> | null = null;

  constructor(options: NodeIdentityOptions = {}) {
    // 调用父类构造函数，但使用不同的文件路径
    super({ 
      dataDir: options.dataDir, 
      password: options.password 
    });
    this.nodeDataDir = options.dataDir || join(homedir(), DEFAULT_DATA_DIR);
    this.nodePassword = options.password;
    this.nodeLogger = new Logger({ component: 'NodeIdentity' });
  }

  /**
   * 获取 Node Identity 文件路径
   */
  private getNodeIdentityFilePath(): string {
    return join(this.nodeDataDir, NODE_IDENTITY_FILE);
  }

  /**
   * 确保 Node 数据目录存在
   * 重命名以避免与父类的 ensureDataDir 冲突
   */
  private async ensureNodeDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.nodeDataDir, { recursive: true });
      await fs.chmod(this.nodeDataDir, 0o700);
    } catch (error) {
      this.nodeLogger.error('Failed to create data directory', { error });
      throw error;
    }
  }

  /**
   * 加载或创建 Node Identity
   * 
   * 优先使用 node-identity.json，如果不存在则尝试从旧的 identity.json 迁移
   */
  async loadOrCreate(): Promise<Result<ExportedNodeIdentity>> {
    // 如果已加载，直接返回
    if (this.isLoaded() && this.nodeId) {
      return success(this.exportNodeIdentityInternal());
    }

    // 并发保护
    if (this.nodeLoadPromise) {
      return this.nodeLoadPromise;
    }

    this.nodeLoadPromise = this.performLoadOrCreate();
    
    try {
      const result = await this.nodeLoadPromise;
      return result;
    } finally {
      this.nodeLoadPromise = null;
    }
  }

  /**
   * 实际的加载或创建逻辑
   * 重命名以避免与父类的 doLoadOrCreate 冲突
   */
  private async performLoadOrCreate(): Promise<Result<ExportedNodeIdentity>> {
    try {
      await this.ensureNodeDataDir();
      
      const nodeIdentityFile = this.getNodeIdentityFilePath();
      
      try {
        // 尝试读取现有的 Node Identity
        const data = await fs.readFile(nodeIdentityFile, 'utf-8');
        
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (parseError) {
          this.nodeLogger.error('Node identity file is corrupted - invalid JSON', {
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
          return failure(createError(
            'NODE_IDENTITY_CORRUPTED',
            'Node identity file is corrupted and cannot be parsed.'
          ));
        }
        
        if (typeof parsed !== 'object' || parsed === null) {
          this.nodeLogger.error('Node identity file is corrupted - not an object');
          return failure(createError(
            'NODE_IDENTITY_CORRUPTED',
            'Node identity file is corrupted: invalid data structure.'
          ));
        }
        
        const parsedObj = parsed as Record<string, unknown>;
        const encryptedValue = parsedObj.encrypted;
        const isEncrypted = typeof encryptedValue === 'boolean' && encryptedValue === true;
        
        if (isEncrypted) {
          if (this.nodePassword === undefined || this.nodePassword === '') {
            this.nodeLogger.error('Node identity file is encrypted but no password provided');
            return failure(createError(
              'NODE_IDENTITY_PASSWORD_REQUIRED',
              'Node identity file is encrypted but no password was provided.'
            ));
          }
          
          try {
            if (!isEncryptedIdentity(parsedObj)) {
              this.nodeLogger.error('Node identity file is corrupted - invalid encrypted identity structure');
              return failure(createError(
                'NODE_IDENTITY_CORRUPTED',
                'Node identity file is corrupted: invalid encrypted identity structure.'
              ));
            }
            const persisted = decryptIdentity(parsedObj, this.nodePassword);
            await this.loadPersistedNodeIdentityFromDecrypted(persisted);
            await this.saveNodeIdentity();
            
            this.nodeLogger.info('Loaded existing encrypted node identity', {
              nodeId: this.nodeId?.slice(0, 16)
            });
            
            return success(this.exportNodeIdentityInternal());
          } catch (decryptError) {
            this.nodeLogger.error('Failed to decrypt node identity with provided password', {
              error: decryptError instanceof Error ? decryptError.message : String(decryptError)
            });
            return failure(createError(
              'NODE_IDENTITY_DECRYPT_FAILED',
              'Failed to decrypt node identity. The password may be incorrect.'
            ));
          }
        }
        
        // 明文存储
        const persisted = parsed as PersistedNodeIdentity;
        await this.loadPersistedNodeIdentity(persisted);
        await this.saveNodeIdentity();
        
        this.nodeLogger.info('Loaded existing plaintext node identity', {
          nodeId: this.nodeId?.slice(0, 16)
        });
        
        this.nodeLogger.warn('Node identity is stored in plaintext. Consider setting a password for encryption.');
        
        return success(this.exportNodeIdentityInternal());
      } catch (readError: unknown) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          // Node Identity 文件不存在，尝试迁移旧的 identity.json 或创建新的
          this.nodeLogger.info('No existing node identity found, checking for legacy identity...');
          return await this.createOrMigrateNodeIdentity();
        }
        throw readError;
      }
    } catch (error) {
      return failureFromError('NODE_IDENTITY_LOAD_FAILED', 'Failed to load or create node identity', error as Error);
    }
  }

  /**
   * 从解密后的 PersistedIdentity 数据加载 Node Identity
   * 用于处理加密文件解密后的数据
   * P1-1 修复: 移除 (this as any)，直接调用 protected 方法
   */
  private async loadPersistedNodeIdentityFromDecrypted(persisted: PersistedIdentity): Promise<void> {
    if (!isValidBase64(persisted.peerId)) {
      throw new Error('Invalid persisted identity: peerId is not valid base64');
    }
    if (!isValidBase64(persisted.e2eePrivateKey)) {
      throw new Error('Invalid persisted identity: e2eePrivateKey is not valid base64');
    }
    if (!isValidBase64(persisted.e2eePublicKey)) {
      throw new Error('Invalid persisted identity: e2eePublicKey is not valid base64');
    }
    
    // P1-1 修复: 直接调用 protected 方法
    await this.loadPersistedIdentity(persisted);
    
    // 从加载后的身份获取真正的 PeerId 字符串，然后设置 Node ID
    const peerIdString = this.getPeerIdString();
    if (peerIdString) {
      // P1-4: 验证生成的 nodeId 格式
      const generatedNodeId = peerIdString.slice(0, 16);
      if (!isValidNodeId(generatedNodeId)) {
        throw new Error(`Generated nodeId has invalid format: ${generatedNodeId}`);
      }
      this.nodeId = generatedNodeId;
    } else {
      throw new Error('Failed to get PeerId after loading identity');
    }
  }

  /**
   * 从持久化数据加载 Node Identity
   * P1-4: 添加 nodeId 格式验证
   */
  private async loadPersistedNodeIdentity(persisted: PersistedNodeIdentity): Promise<void> {
    if (!isValidBase64(persisted.peerId)) {
      throw new Error('Invalid persisted node identity: peerId is not valid base64');
    }
    if (!isValidBase64(persisted.e2eePrivateKey)) {
      throw new Error('Invalid persisted node identity: e2eePrivateKey is not valid base64');
    }
    if (!isValidBase64(persisted.e2eePublicKey)) {
      throw new Error('Invalid persisted node identity: e2eePublicKey is not valid base64');
    }
    
    // P1-4: 验证 nodeId 格式
    if (!isValidNodeId(persisted.nodeId)) {
      throw new Error(`Invalid persisted node identity: nodeId format is invalid. Must be 1-64 alphanumeric characters or hyphens.`);
    }
    
    // 设置 nodeId
    this.nodeId = persisted.nodeId;
    
    // P1-1 修复: 直接调用 protected 方法，无需 (this as any)
    await this.loadPersistedIdentity({
      peerId: persisted.peerId,
      e2eePrivateKey: persisted.e2eePrivateKey,
      e2eePublicKey: persisted.e2eePublicKey,
      createdAt: persisted.createdAt,
      lastUsedAt: persisted.lastUsedAt
    });
  }

  /**
   * 创建新的 Node Identity 或从旧的 identity.json 迁移
   */
  private async createOrMigrateNodeIdentity(): Promise<Result<ExportedNodeIdentity>> {
    try {
      // 尝试检查旧的 identity.json 是否存在
      const legacyFile = join(this.nodeDataDir, 'identity.json');
      
      try {
        await fs.access(legacyFile);
        // 旧文件存在，进行迁移
        this.nodeLogger.info('Migrating legacy identity.json to node-identity.json...');
        
        const data = await fs.readFile(legacyFile, 'utf-8');
        const parsed = JSON.parse(data);
        
        // 检查是否是加密文件
        const parsedObj = parsed as Record<string, unknown>;
        const encryptedValue = parsedObj.encrypted;
        const isEncrypted = typeof encryptedValue === 'boolean' && encryptedValue === true;
        
        if (isEncrypted) {
          if (this.nodePassword === undefined || this.nodePassword === '') {
            return failure(createError(
              'NODE_IDENTITY_PASSWORD_REQUIRED',
              'Legacy identity file is encrypted but no password was provided.'
            ));
          }
          
          if (!isEncryptedIdentity(parsedObj)) {
            return failure(createError(
              'NODE_IDENTITY_CORRUPTED',
              'Legacy identity file is corrupted: invalid encrypted identity structure.'
            ));
          }
          
          const decrypted = decryptIdentity(parsedObj, this.nodePassword);
          
          // 创建 Node Identity
          await this.loadPersistedNodeIdentityFromDecrypted(decrypted);
          await this.saveNodeIdentity();
          
          this.nodeLogger.info('Migrated encrypted legacy identity to node identity', {
            nodeId: this.nodeId?.slice(0, 16)
          });
          
          return success(this.exportNodeIdentityInternal());
        }
        
        // 明文迁移 - legacy 文件是 PersistedIdentity 格式
        const legacyPersisted = parsed as PersistedIdentity;
        
        // P1-1 修复: 直接调用 protected 方法
        await this.loadPersistedIdentity(legacyPersisted);
        
        // 构造 Node Identity - P1-4: 验证生成的 nodeId
        const generatedNodeId = legacyPersisted.peerId.slice(0, 16);
        if (!isValidNodeId(generatedNodeId)) {
          return failure(createError(
            'NODE_IDENTITY_CORRUPTED',
            `Generated nodeId has invalid format: ${generatedNodeId}`
          ));
        }
        this.nodeId = generatedNodeId;
        
        await this.saveNodeIdentity();
        
        this.nodeLogger.info('Migrated plaintext legacy identity to node identity', {
          nodeId: this.nodeId?.slice(0, 16)
        });
        
        return success(this.exportNodeIdentityInternal());
      } catch (migrationError) {
        // P3-2: 添加 DEBUG 日志，旧文件不存在时创建新身份
        this.nodeLogger.debug('Legacy identity migration skipped, creating new node identity', {
          reason: migrationError instanceof Error ? migrationError.message : String(migrationError)
        });
        // 旧文件不存在，创建新的 Node Identity
        this.nodeLogger.info('Creating new node identity...');
        return await this.createNewNodeIdentity();
      }
    } catch (error) {
      return failureFromError('NODE_IDENTITY_CREATE_FAILED', 'Failed to create node identity', error as Error);
    }
  }

  /**
   * 创建新的 Node Identity
   */
  private async createNewNodeIdentity(): Promise<Result<ExportedNodeIdentity>> {
    try {
      // 调用父类的 loadOrCreate 创建基础身份
      const parentResult = await super.loadOrCreate();
      
      if (!parentResult.success) {
        return failure(parentResult.error);
      }
      
      const identity = parentResult.data;
      
      // 设置 Node ID (使用 PeerId 的前 16 个字符)
      // P1-4: 验证生成的 nodeId 格式
      const generatedNodeId = identity.peerId.slice(0, 16);
      if (!isValidNodeId(generatedNodeId)) {
        return failure(createError(
          'NODE_IDENTITY_CREATE_FAILED',
          `Generated nodeId has invalid format: ${generatedNodeId}`
        ));
      }
      this.nodeId = generatedNodeId;
      
      // 保存 Node Identity
      await this.saveNodeIdentity();
      
      this.nodeLogger.info('Created new node identity', {
        nodeId: this.nodeId,
        peerId: identity.peerId.slice(0, 16)
      });
      
      return success(this.exportNodeIdentityInternal());
    } catch (error) {
      return failureFromError('NODE_IDENTITY_CREATE_FAILED', 'Failed to create new node identity', error as Error);
    }
  }

  /**
   * 保存 Node Identity 到文件
   */
  private async saveNodeIdentity(): Promise<void> {
    if (!this.isLoaded() || !this.nodeId) {
      throw new Error('Node identity not initialized');
    }
    
    const identity = this.exportIdentity();
    
    const persisted: PersistedNodeIdentity = {
      nodeId: this.nodeId,
      peerId: identity.privateKey,
      e2eePrivateKey: identity.e2eeKeyPair.privateKey,
      e2eePublicKey: identity.e2eeKeyPair.publicKey,
      createdAt: identity.createdAt.toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    
    const shouldEncrypt = this.nodePassword !== undefined && this.nodePassword !== '';
    
    if (!shouldEncrypt) {
      this.nodeLogger.warn('Saving node identity without encryption. Consider setting a password.');
    }
    
    const data = shouldEncrypt
      ? JSON.stringify(encryptIdentity(persisted, this.nodePassword!))
      : JSON.stringify(persisted, null, 2);
    
    const identityFile = this.getNodeIdentityFilePath();
    await fs.writeFile(identityFile, data, 'utf-8');
    await fs.chmod(identityFile, 0o600);
  }

  /**
   * 导出 Node Identity（内部版本，无频率限制）
   */
  private exportNodeIdentityInternal(): ExportedNodeIdentity {
    if (!this.isLoaded() || !this.nodeId) {
      throw new Error('Node identity not initialized');
    }
    
    const identity = this.exportIdentity();
    
    return {
      nodeId: this.nodeId,
      peerId: identity.peerId,
      privateKey: identity.privateKey,
      e2eeKeyPair: identity.e2eeKeyPair,
      createdAt: identity.createdAt
    };
  }

  /**
   * 获取 Node ID
   */
  getNodeId(): string | null {
    return this.nodeId;
  }

  /**
   * 检查 Node Identity 是否已加载
   */
  isNodeLoaded(): boolean {
    return this.isLoaded() && this.nodeId !== null;
  }

  /**
   * 删除 Node Identity
   */
  async deleteNodeIdentity(): Promise<Result<void>> {
    try {
      const identityFile = this.getNodeIdentityFilePath();
      await fs.unlink(identityFile);
      
      // 清除内存中的数据
      this.nodeId = null;
      
      // 调用父类的删除方法
      await this.deleteIdentity();
      
      this.nodeLogger.warn('Node identity deleted and memory cleared');
      return success(undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return success(undefined);
      }
      return failureFromError('NODE_IDENTITY_DELETE_FAILED', 'Failed to delete node identity', error as Error);
    }
  }
}