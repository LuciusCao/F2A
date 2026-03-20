/**
 * Agent Identity
 * 
 * 由 Node 委派的身份，可迁移。
 * 包含：
 * - Agent ID (UUID)
 * - Agent 名称
 * - 能力标签
 * - 所属 Node ID
 * - Agent 密钥对
 * - Node 签名
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { Logger } from '../../utils/logger.js';
import { success, failure, failureFromError, Result } from '../../types/index.js';
import { secureWipe } from '../../utils/crypto-utils.js';
import type {
  AgentIdentity,
  AgentIdentityOptions,
  PersistedAgentIdentity,
  ExportedAgentIdentity,
  AgentSignaturePayload
} from './types.js';
import { DEFAULT_DATA_DIR, AGENT_IDENTITY_FILE } from './types.js';

/**
 * Agent Identity Manager
 * 
 * 管理单个 Agent 的身份信息。
 */
export class AgentIdentityManager {
  private dataDir: string;
  private agentIdentity: AgentIdentity | null = null;
  private agentPrivateKey: Uint8Array | null = null;
  private logger: Logger;
  private loadPromise: Promise<Result<ExportedAgentIdentity>> | null = null;
  
  // 静态 logger 用于静态方法
  private static staticLogger = new Logger({ component: 'AgentIdentity' });

  constructor(dataDir?: string) {
    this.dataDir = dataDir || join(homedir(), DEFAULT_DATA_DIR);
    this.logger = new Logger({ component: 'AgentIdentity' });
  }

  /**
   * 获取 Agent Identity 文件路径
   */
  private getAgentIdentityFilePath(): string {
    return join(this.dataDir, AGENT_IDENTITY_FILE);
  }

  /**
   * 确保数据目录存在
   */
  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.chmod(this.dataDir, 0o700);
    } catch (error) {
      this.logger.error('Failed to create data directory', { error });
      throw error;
    }
  }

  /**
   * 创建签名载荷
   */
  static createSignaturePayload(
    id: string,
    name: string,
    capabilities: string[],
    nodeId: string,
    publicKey: string,
    createdAt: string,
    expiresAt?: string
  ): AgentSignaturePayload {
    return {
      id,
      name,
      capabilities,
      nodeId,
      publicKey,
      createdAt,
      expiresAt
    };
  }

  /**
   * 序列化签名载荷用于签名
   * 
   * P3-4: 添加文档说明格式稳定性
   * 
   * **格式稳定性保证**:
   * - 签名载荷按固定顺序序列化，确保签名一致性
   * - 字段顺序: id, name, capabilities(排序后), nodeId, publicKey, createdAt, expiresAt(可选)
   * - capabilities 数组按字母顺序排序，确保不同顺序的输入产生相同的签名
   * - 字段之间使用冒号 ':' 分隔
   * - 此格式在 v1.x 版本中保持稳定，未来变更将使用版本号区分
   * 
   * @param payload 签名载荷
   * @returns 序列化后的字符串
   */
  static serializePayloadForSignature(payload: AgentSignaturePayload): string {
    // 按固定顺序序列化，确保签名一致性
    const parts = [
      payload.id,
      payload.name,
      payload.capabilities.sort().join(','),
      payload.nodeId,
      payload.publicKey,
      payload.createdAt
    ];
    
    if (payload.expiresAt) {
      parts.push(payload.expiresAt);
    }
    
    return parts.join(':');
  }

  /**
   * 从 Node Identity 创建 Agent Identity
   * 
   * @param nodeId Node ID
   * @param signWithNodeKey 使用 Node 私钥签名的函数
   * @param options Agent 配置选项
   */
  async createAgentIdentity(
    nodeId: string,
    signWithNodeKey: (data: Uint8Array) => Promise<Uint8Array>,
    options: AgentIdentityOptions
  ): Promise<Result<ExportedAgentIdentity>> {
    try {
      // P2-5: 输入验证
      if (!options.name || options.name.length === 0) {
        return failure({
          code: 'AGENT_IDENTITY_INVALID_NAME',
          message: 'Agent name is required.'
        });
      }
      if (options.name.length > 64) {
        return failure({
          code: 'AGENT_IDENTITY_INVALID_NAME',
          message: 'Agent name must be 1-64 characters.'
        });
      }
      // SEC-3: Agent 名称字符白名单验证
      if (!/^[a-zA-Z0-9_\-:]+$/.test(options.name)) {
        return failure({
          code: 'AGENT_IDENTITY_INVALID_NAME',
          message: 'Agent name contains invalid characters. Only alphanumeric, underscore, hyphen, and colon are allowed.'
        });
      }
      
      // P2-5: 验证 capabilities 格式
      if (options.capabilities) {
        for (const cap of options.capabilities) {
          if (typeof cap !== 'string' || cap.length === 0 || cap.length > 64) {
            return failure({
              code: 'AGENT_IDENTITY_INVALID_CAPABILITY',
              message: 'Each capability must be a non-empty string with 1-64 characters.'
            });
          }
          // 允许字母、数字、连字符、下划线、冒号
          if (!/^[a-zA-Z0-9_\-:]+$/.test(cap)) {
            return failure({
              code: 'AGENT_IDENTITY_INVALID_CAPABILITY',
              message: 'Invalid capability format. Only alphanumeric, underscore, hyphen, and colon are allowed.'
            });
          }
        }
      }
      
      await this.ensureDataDir();

      // 生成 Agent 密钥对 (Ed25519)
      const agentPrivateKey = await generateKeyPair('Ed25519');
      // 使用 marshal() 获取原始公钥字节（32 字节），而不是 .bytes（protobuf 编码）
      const agentPublicKeyBytes = agentPrivateKey.public.marshal();
      const agentPrivateKeyBytes = agentPrivateKey.bytes;

      // 生成 Agent ID
      const agentId = options.id || randomUUID();
      const now = new Date();
      const createdAt = now.toISOString();
      const expiresAt = options.expiresAt?.toISOString();

      // 创建签名载荷
      const payload = AgentIdentityManager.createSignaturePayload(
        agentId,
        options.name,
        options.capabilities || [],
        nodeId,
        Buffer.from(agentPublicKeyBytes).toString('base64'),
        createdAt,
        expiresAt
      );

      // 序列化并签名
      const payloadBytes = Buffer.from(
        AgentIdentityManager.serializePayloadForSignature(payload),
        'utf-8'
      );
      const signature = await signWithNodeKey(payloadBytes);

      // 创建 Agent Identity
      this.agentIdentity = {
        id: agentId,
        name: options.name,
        capabilities: options.capabilities || [],
        nodeId,
        publicKey: Buffer.from(agentPublicKeyBytes).toString('base64'),
        signature: Buffer.from(signature).toString('base64'),
        createdAt,
        expiresAt
      };

      // 存储私钥
      this.agentPrivateKey = new Uint8Array(agentPrivateKeyBytes);

      // 保存到文件
      await this.saveAgentIdentity();

      this.logger.info('Created new agent identity', {
        agentId: this.agentIdentity.id,
        name: this.agentIdentity.name,
        nodeId: this.agentIdentity.nodeId
      });

      return success({
        ...this.agentIdentity,
        privateKey: Buffer.from(this.agentPrivateKey).toString('base64')
      });
    } catch (error) {
      return failureFromError('AGENT_IDENTITY_CREATE_FAILED', 'Failed to create agent identity', error as Error);
    }
  }

  /**
   * 加载 Agent Identity
   */
  async loadAgentIdentity(): Promise<Result<ExportedAgentIdentity>> {
    // 如果已加载，直接返回
    if (this.agentIdentity && this.agentPrivateKey) {
      return success({
        ...this.agentIdentity,
        privateKey: Buffer.from(this.agentPrivateKey).toString('base64')
      });
    }

    // 并发保护
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.doLoadAgentIdentity();
    
    try {
      const result = await this.loadPromise;
      return result;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * 实际的加载逻辑
   */
  private async doLoadAgentIdentity(): Promise<Result<ExportedAgentIdentity>> {
    try {
      await this.ensureDataDir();
      
      const agentFile = this.getAgentIdentityFilePath();
      
      try {
        const data = await fs.readFile(agentFile, 'utf-8');
        const persisted: PersistedAgentIdentity = JSON.parse(data);
        
        // 验证必要字段
        if (!persisted.id || !persisted.name || !persisted.nodeId || 
            !persisted.publicKey || !persisted.signature || !persisted.privateKey) {
          return failure({
            code: 'AGENT_IDENTITY_CORRUPTED',
            message: 'Agent identity file is corrupted: missing required fields.'
          });
        }
        
        this.agentIdentity = {
          id: persisted.id,
          name: persisted.name,
          capabilities: persisted.capabilities,
          nodeId: persisted.nodeId,
          publicKey: persisted.publicKey,
          signature: persisted.signature,
          createdAt: persisted.createdAt,
          expiresAt: persisted.expiresAt
        };
        
        this.agentPrivateKey = Buffer.from(persisted.privateKey, 'base64');
        
        // P2-6: 检查 Agent 身份是否已过期
        if (this.isExpired()) {
          this.logger.warn('Loaded agent identity is expired', {
            agentId: this.agentIdentity.id,
            expiresAt: this.agentIdentity.expiresAt
          });
        }
        
        this.logger.info('Loaded existing agent identity', {
          agentId: this.agentIdentity.id,
          name: this.agentIdentity.name
        });
        
        return success({
          ...this.agentIdentity,
          privateKey: persisted.privateKey
        });
      } catch (readError: unknown) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          return failure({
            code: 'AGENT_IDENTITY_NOT_FOUND',
            message: 'No agent identity found. Please create one first.'
          });
        }
        throw readError;
      }
    } catch (error) {
      return failureFromError('AGENT_IDENTITY_LOAD_FAILED', 'Failed to load agent identity', error as Error);
    }
  }

  /**
   * 保存 Agent Identity 到文件
   */
  private async saveAgentIdentity(): Promise<void> {
    if (!this.agentIdentity || !this.agentPrivateKey) {
      throw new Error('Agent identity not initialized');
    }
    
    const persisted: PersistedAgentIdentity = {
      ...this.agentIdentity,
      privateKey: Buffer.from(this.agentPrivateKey).toString('base64')
    };
    
    const agentFile = this.getAgentIdentityFilePath();
    await fs.writeFile(agentFile, JSON.stringify(persisted, null, 2), 'utf-8');
    await fs.chmod(agentFile, 0o600);
  }

  /**
   * 验证 Agent Identity 签名
   * 
   * @param agentIdentity 要验证的 Agent Identity
   * @param verifyWithNodeKey 使用 Node 公钥验证签名的函数
   */
  static async verifySignature(
    agentIdentity: AgentIdentity,
    verifyWithNodeKey: (data: Uint8Array, signature: Uint8Array, nodeId: string) => Promise<boolean>
  ): Promise<boolean> {
    try {
      // 检查是否过期
      if (agentIdentity.expiresAt) {
        const expiresAt = new Date(agentIdentity.expiresAt);
        if (expiresAt < new Date()) {
          return false;
        }
      }
      
      // 重建签名载荷
      const payload = AgentIdentityManager.createSignaturePayload(
        agentIdentity.id,
        agentIdentity.name,
        agentIdentity.capabilities,
        agentIdentity.nodeId,
        agentIdentity.publicKey,
        agentIdentity.createdAt,
        agentIdentity.expiresAt
      );
      
      const payloadBytes = Buffer.from(
        AgentIdentityManager.serializePayloadForSignature(payload),
        'utf-8'
      );
      
      const signatureBytes = Buffer.from(agentIdentity.signature, 'base64');
      
      return await verifyWithNodeKey(payloadBytes, signatureBytes, agentIdentity.nodeId);
    } catch (error) {
      // P3-2: 添加 DEBUG 日志，便于问题排查
      // 注意：静态方法使用静态 logger
      AgentIdentityManager.staticLogger.debug('Signature verification failed', {
        agentId: agentIdentity.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 获取 Agent Identity（不含私钥）
   */
  getAgentIdentity(): AgentIdentity | null {
    if (!this.agentIdentity) {
      return null;
    }
    return { ...this.agentIdentity };
  }

  /**
   * 获取 Agent ID
   */
  getAgentId(): string | null {
    return this.agentIdentity?.id || null;
  }

  /**
   * 获取 Agent 名称
   */
  getAgentName(): string | null {
    return this.agentIdentity?.name || null;
  }

  /**
   * 获取 Agent 能力列表
   */
  getCapabilities(): string[] {
    return this.agentIdentity?.capabilities || [];
  }

  /**
   * 获取 Agent 所属 Node ID
   */
  getNodeId(): string | null {
    return this.agentIdentity?.nodeId || null;
  }

  /**
   * 获取 Agent 公钥 (base64)
   */
  getAgentPublicKey(): string | null {
    return this.agentIdentity?.publicKey || null;
  }

  /**
   * 检查 Agent 是否已加载
   */
  isLoaded(): boolean {
    return this.agentIdentity !== null && this.agentPrivateKey !== null;
  }

  /**
   * 检查 Agent 身份是否过期
   */
  isExpired(): boolean {
    if (!this.agentIdentity?.expiresAt) {
      return false;
    }
    return new Date(this.agentIdentity.expiresAt) < new Date();
  }

  /**
   * 更新 Agent 签名（用于迁移）
   * 
   * @param newSignature 新的签名
   * @param newNodeId 新的 Node ID（可选）
   */
  async updateSignature(newSignature: string, newNodeId?: string): Promise<void> {
    if (!this.agentIdentity) {
      throw new Error('Agent identity not initialized');
    }
    
    this.agentIdentity.signature = newSignature;
    if (newNodeId) {
      this.agentIdentity.nodeId = newNodeId;
    }
    
    await this.saveAgentIdentity();
    
    this.logger.info('Updated agent signature', {
      agentId: this.agentIdentity.id,
      newNodeId: newNodeId || this.agentIdentity.nodeId
    });
  }

  /**
   * 删除 Agent Identity
   */
  async deleteAgentIdentity(): Promise<Result<void>> {
    try {
      const agentFile = this.getAgentIdentityFilePath();
      await fs.unlink(agentFile);
      
      // 安全清零私钥
      if (this.agentPrivateKey) {
        secureWipe(this.agentPrivateKey);
      }
      
      this.agentIdentity = null;
      this.agentPrivateKey = null;
      
      this.logger.warn('Agent identity deleted and memory cleared');
      return success(undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return success(undefined);
      }
      return failureFromError('AGENT_IDENTITY_DELETE_FAILED', 'Failed to delete agent identity', error as Error);
    }
  }

  /**
   * 导出 Agent Identity（包含私钥，敏感操作）
   * 
   * WARNING: 返回敏感的私钥材料。
   */
  exportAgentIdentity(): ExportedAgentIdentity | null {
    if (!this.agentIdentity || !this.agentPrivateKey) {
      return null;
    }
    
    return {
      ...this.agentIdentity,
      privateKey: Buffer.from(this.agentPrivateKey).toString('base64')
    };
  }
}