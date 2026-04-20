/**
 * Agent Registry
 * 管理注册到 Daemon 的 Agent 实例
 * 
 * RFC 003: AgentId 由节点签发，不能由用户自定义
 * RFC 008: AgentId = 公钥指纹，Agent 自有密钥
 * 
 * Phase 3: 添加 publicKey 字段，支持 RFC008 新格式
 * 同时保持对 RFC003 旧格式的兼容
 */

import { Logger } from '../utils/logger.js';
import type { AgentCapability } from '../types/index.js';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import {
  generateAgentId,
  parseAgentId,
  isNewFormat,
  isOldFormat,
  isValidAgentIdFormat,
  validateAgentId,
  computeFingerprint
} from './identity/agent-id.js';

/** Agent Registry 持久化文件名 */
export const AGENT_REGISTRY_FILE = 'agent-registry.json';

/** 默认数据目录 */
export const DEFAULT_DATA_DIR = '.f2a';

/**
 * 本地消息回调类型
 * 用于直接推送消息给本地 Agent
 */
export type MessageCallback = (message: {
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  type: string;
  createdAt: Date;
}) => void;

/**
 * Webhook 配置（RFC 004: Agent 级 Webhook）
 */
export interface AgentWebhook {
  /** Webhook URL */
  url: string;
  /** 认证 Token（可选） */
  token?: string;
}

/**
 * Agent 注册信息
 * 
 * RFC 003 (旧格式): AgentId 由节点签发，signature 为节点签名
 * RFC 008 (新格式): AgentId = 公钥指纹，publicKey 为 Agent 自有公钥
 */
export interface AgentRegistration {
  /** Agent 唯一标识符
   *  旧格式 (RFC003): agent:<PeerId前16位>:<随机8位>
   *  新格式 (RFC008): agent:<公钥指纹16位>
   */
  agentId: string;
  /** Agent 显示名称（用户定义，可修改） */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 签发节点的 PeerId（旧格式必需） */
  peerId?: string;
  /** AgentId 签名（Base64）
   *  旧格式: Node 签名
   *  新格式: 可选，Node 签发的归属证明
   */
  signature?: string;
  /** RFC 008: Agent 的 Ed25519 公钥 (Base64)
   *  新格式必需，用于 Challenge-Response 验证
   */
  publicKey?: string;
  /** RFC 008: Node 签发的归属证明 (Base64)
   *  可选，用于跨节点验证 Agent 归属
   */
  nodeSignature?: string;
  /** RFC 008: Node 的 PeerId（签发归属证明的节点） */
  nodePeerId?: string;
  /** AgentId 格式版本: 'old' (RFC003) 或 'new' (RFC008) */
  idFormat?: 'old' | 'new';
  /** 注册时间 */
  registeredAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** Webhook 配置（RFC 004: Agent 级 Webhook，用于推送消息给远程 Agent） */
  webhook?: AgentWebhook;
  /** 本地消息回调（用于直接推送消息给本地 Agent，无需轮询） */
  onMessage?: MessageCallback;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Agent 注册请求（用户提供）
 * 
 * RFC 003 (旧格式): 用户提供 name + capabilities，节点签发 AgentId
 * RFC 008 (新格式): 用户提供 publicKey，AgentId 由公钥指纹派生
 */
export interface AgentRegistrationRequest {
  /** Agent 显示名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** Webhook 配置（RFC 004: Agent 级 Webhook，可选，用于远程 Agent） */
  webhook?: AgentWebhook;
  /** 本地消息回调（可选，用于本地 Agent 直接接收消息） */
  onMessage?: MessageCallback;
  /** Agent 元数据（可选） */
  metadata?: Record<string, unknown>;
}

/**
 * RFC 008 Agent 注册请求（新格式）
 * AgentId 由公钥指纹派生，需要提供 publicKey
 */
export interface RFC008AgentRegistrationRequest {
  /** Agent 的 Ed25519 公钥 (Base64) */
  publicKey: string;
  /** Agent 显示名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** Webhook 配置 */
  webhook?: AgentWebhook;
  /** 本地消息回调（可选） */
  onMessage?: MessageCallback;
  /** Agent 元数据（可选） */
  metadata?: Record<string, unknown>;
  /** Node 签发的归属证明（可选，注册后由 Daemon 签发） */
  nodeSignature?: string;
  /** Node 的 PeerId（可选） */
  nodePeerId?: string;
}

/**
 * 持久化的 Agent 注册信息
 * 用于 JSON 序列化，Date 对象转换为 ISO 字符串
 * 注意：不包含 onMessage 回调（无法序列化）
 */
export interface PersistedAgentRegistration {
  /** Agent 唯一标识符 */
  agentId: string;
  /** Agent 显示名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 签发节点的 PeerId（旧格式） */
  peerId?: string;
  /** AgentId 签名（Base64） */
  signature?: string;
  /** RFC 008: Agent 的 Ed25519 公钥 (Base64) */
  publicKey?: string;
  /** RFC 008: Node 签发的归属证明 (Base64) */
  nodeSignature?: string;
  /** RFC 008: Node 的 PeerId */
  nodePeerId?: string;
  /** AgentId 格式版本 */
  idFormat?: 'old' | 'new';
  /** 注册时间（ISO 字符串） */
  registeredAt: string;
  /** 最后活跃时间（ISO 字符串） */
  lastActiveAt: string;
  /** Webhook 配置（RFC 004: Agent 级 Webhook） */
  webhook?: AgentWebhook;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 久化的 Agent Registry 数据结构
 */
export interface PersistedAgentRegistry {
  /** 版本号，用于未来格式升级 */
  version: number;
  /** 所有注册的 Agent */
  agents: PersistedAgentRegistration[];
  /** 保存时间（ISO 字符串） */
  savedAt: string;
}

/**
 * AgentRegistry 配置选项
 */
export interface AgentRegistryOptions {
  /** 数据目录路径 */
  dataDir?: string;
  /** 是否启用持久化 */
  enablePersistence?: boolean;
  /** 日志级别 */
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

/**
 * Agent 注册表
 * 管理注册到 Daemon 的所有 Agent
 */
export class AgentRegistry {
  private agents: Map<string, AgentRegistration> = new Map();
  private logger: Logger;
  private peerId: string;
  private signFunction: (data: string) => string;
  private dataDir: string;
  private enablePersistence: boolean;

  constructor(
    peerId: string,
    signFunction: (data: string) => string,
    options: AgentRegistryOptions = {}
  ) {
    this.logger = new Logger({
      component: 'AgentRegistry',
      level: options.logLevel || 'INFO'
    });
    this.peerId = peerId;
    this.signFunction = signFunction;
    this.dataDir = options.dataDir || join(homedir(), DEFAULT_DATA_DIR);
    this.enablePersistence = options.enablePersistence ?? true;

    // P0 修复说明：
    // - 构造函数仍支持同步加载（向后兼容）
    // - 推荐使用静态工厂方法 AgentRegistry.create() 进行异步初始化
    // - 生产代码（如 F2A.create）应使用工厂方法避免阻塞
    if (this.enablePersistence) {
      this.load();
    }
  }

  /**
   * 静态工厂方法：异步创建 AgentRegistry
   * 
   * P0 修复：避免构造函数中的同步 I/O 阻塞
   * - 先创建实例（禁用持久化）
   * - 然后异步加载持久化数据
   * 
   * @param peerId 节点 PeerId
   * @param signFunction 签名函数
   * @param options 配置选项
   * @returns Promise<AgentRegistry>
   */
  static async create(
    peerId: string,
    signFunction: (data: string) => string,
    options: AgentRegistryOptions = {}
  ): Promise<AgentRegistry> {
    // 创建实例时禁用持久化，避免构造函数中同步加载
    const registry = new AgentRegistry(peerId, signFunction, {
      ...options,
      enablePersistence: false,
    });

    // 如果原本需要持久化，异步加载
    if (options.enablePersistence !== false) {
      registry.enablePersistence = true;
      await registry.loadAsync();
    }

    return registry;
  }

  /**
   * 生成签发的 AgentId
   * 格式: agent:<PeerId前16位>:<随机8位>
   */
  private generateAgentId(): string {
    const peerIdPrefix = this.peerId.slice(0, 16);
    const randomSuffix = randomBytes(4).toString('hex'); // 8位十六进制
    return `agent:${peerIdPrefix}:${randomSuffix}`;
  }

  /**
   * 签名 AgentId
   */
  private signAgentId(agentId: string): string {
    const signature = this.signFunction(agentId);
    this.logger.debug('AgentId signed', { agentId, signaturePrefix: signature.slice(0, 16) });
    return signature;
  }

  /**
   * 注册 Agent（节点签发 AgentId）- RFC003 旧格式
   * 
   * 用户只提供 name 和 capabilities
   * 节点生成并签名 AgentId
   * 
   * @deprecated 建议使用 registerRFC008 代替
   */
  register(request: AgentRegistrationRequest): AgentRegistration {
    // 生成 AgentId (旧格式)
    const agentId = this.generateAgentId();
    
    // 签名 AgentId
    const signature = this.signAgentId(agentId);

    const registration: AgentRegistration = {
      agentId,
      name: request.name,
      capabilities: request.capabilities,
      peerId: this.peerId,
      signature,
      idFormat: 'old',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      webhook: request.webhook,
      onMessage: request.onMessage,
      metadata: request.metadata,
    };

    this.agents.set(agentId, registration);
    
    // 自动保存（同步，立即完成）
    this.save();
    
    this.logger.info('Agent registered (RFC003 node-issued)', {
      agentId,
      name: request.name,
      peerId: this.peerId,
      capabilities: request.capabilities.map(c => c.name),
      isLocal: !!request.onMessage,
      idFormat: 'old',
    });

    return registration;
  }

  /**
   * 注册 Agent（RFC008 新格式）
   * 
   * AgentId 由公钥指纹派生
   * Agent 拥有自己的 Ed25519 密钥对，用于 Challenge-Response 验证
   * 
   * @param request RFC008 注册请求，包含 publicKey
   * @returns AgentRegistration
   */
  registerRFC008(request: RFC008AgentRegistrationRequest): AgentRegistration {
    // 从公钥计算 AgentId
    const agentId = generateAgentId(request.publicKey);
    
    // 验证 AgentId 格式
    const parsed = parseAgentId(agentId);
    if (!parsed.valid || parsed.format !== 'new') {
      throw new Error(`Invalid AgentId format from publicKey: ${agentId}`);
    }

    // Node 签发归属证明（可选）
    const nodeSignature = request.nodeSignature || this.signAgentId(agentId);
    const nodePeerId = request.nodePeerId || this.peerId;

    const registration: AgentRegistration = {
      agentId,
      name: request.name,
      capabilities: request.capabilities,
      publicKey: request.publicKey,
      nodeSignature,
      nodePeerId,
      idFormat: 'new',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      webhook: request.webhook,
      onMessage: request.onMessage,
      metadata: request.metadata,
    };

    this.agents.set(agentId, registration);
    
    // 自动保存
    this.save();
    
    this.logger.info('Agent registered (RFC008 self-identity)', {
      agentId,
      name: request.name,
      publicKeyPreview: request.publicKey.slice(0, 16) + '...',
      capabilities: request.capabilities.map(c => c.name),
      isLocal: !!request.onMessage,
      idFormat: 'new',
    });

    return registration;
  }

  /**
   * 根据 AgentId 格式自动选择注册方法
   * 
   * 如果 publicKey 存在，使用 RFC008 格式
   * 否则使用 RFC003 格式
   */
  registerAuto(request: AgentRegistrationRequest & { publicKey?: string }): AgentRegistration {
    if (request.publicKey) {
      return this.registerRFC008({
        publicKey: request.publicKey,
        name: request.name,
        capabilities: request.capabilities,
        webhook: request.webhook,
        onMessage: request.onMessage,
        metadata: request.metadata,
      });
    }
    return this.register(request);
  }

  /**
   * 注销 Agent
   */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not found for unregister', { agentId });
      return false;
    }

    const oldName = agent.name;
    this.agents.delete(agentId);
    
    // 自动保存（同步）
    this.save();
    
    this.logger.info('Agent unregistered', { agentId, name: oldName });
    return true;
  }

  /**
   * 恢复已有 Agent（从 identity 文件）
   * 
   * Phase 6: 支持身份恢复
   * RFC008: 支持新格式 identity（包含 publicKey）
   */
  restore(identity: {
    agentId: string;
    name: string;
    peerId?: string;  // 旧格式必需，新格式可选
    signature?: string;  // 旧格式必需，新格式可选
    publicKey?: string;  // RFC008 新格式必需
    nodeSignature?: string;  // RFC008 Node 归属证明
    nodePeerId?: string;  // RFC008 Node PeerId
    capabilities: AgentCapability[];
    webhook?: AgentWebhook;
    metadata?: Record<string, unknown>;
    createdAt: string;
    lastActiveAt: string;
    e2eePublicKey?: string;  // 兼容旧 identity 文件
  }): AgentRegistration {
    // 自动检测 AgentId 格式
    const parsed = parseAgentId(identity.agentId);
    const idFormat = parsed.valid ? parsed.format : 'old';
    
    const registration: AgentRegistration = {
      agentId: identity.agentId,
      name: identity.name,
      capabilities: identity.capabilities,
      peerId: identity.peerId,
      signature: identity.signature,
      publicKey: identity.publicKey,
      nodeSignature: identity.nodeSignature,
      nodePeerId: identity.nodePeerId,
      idFormat,
      registeredAt: new Date(identity.createdAt),
      lastActiveAt: new Date(identity.lastActiveAt),
      webhook: identity.webhook,
      metadata: identity.metadata,
    };
    
    this.agents.set(identity.agentId, registration);
    this.save();  // 同步保存
    
    this.logger.info('Agent restored from identity', {
      agentId: identity.agentId,
      name: identity.name,
      peerId: identity.peerId,
      idFormat,
      hasPublicKey: !!identity.publicKey,
    });
    
    return registration;
  }

  /**
   * 更新 Agent 名称（AgentId 不可改）
   */
  updateName(agentId: string, newName: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not found for name update', { agentId });
      return false;
    }

    const oldName = agent.name;
    agent.name = newName;
    agent.lastActiveAt = new Date();
    
    // 自动保存（同步）
    this.save();
    
    this.logger.info('Agent name updated', { agentId, oldName, newName });
    return true;
  }

  /**
   * 更新 Agent Webhook 配置（RFC 004: Agent 级 Webhook）
   */
  updateWebhook(agentId: string, webhook: AgentWebhook | undefined): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not found for webhook update', { agentId });
      return false;
    }

    agent.webhook = webhook;
    agent.lastActiveAt = new Date();
    
    // 自动保存（同步）
    this.save();
    
    this.logger.info('Agent webhook updated', { 
      agentId, 
      webhookUrl: webhook?.url || 'removed',
      hasToken: !!webhook?.token
    });
    return true;
  }

  /**
   * 获取 Agent 信息
   */
  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 验证 AgentId 签名
   * 
   * RFC003 (旧格式): 检查格式和 PeerId 前缀匹配
   * RFC008 (新格式): 验证公钥指纹匹配
   * 
   * @param agentId Agent ID
   * @param signature Node 签名（旧格式）
   * @param peerId Node PeerId（旧格式）
   * @param publicKey Agent 公钥（新格式）
   */
  verifySignature(
    agentId: string,
    signature?: string,
    peerId?: string,
    publicKey?: string
  ): boolean {
    // 检查 AgentId 格式
    const parsed = parseAgentId(agentId);
    
    if (!parsed.valid) {
      this.logger.warn('Invalid AgentId format', { agentId, error: parsed.error });
      return false;
    }

    // RFC008 新格式: 验证公钥指纹匹配
    if (parsed.format === 'new' && publicKey) {
      const validation = validateAgentId(agentId, publicKey);
      if (validation.valid) {
        this.logger.debug('RFC008 AgentId verified', { agentId, fingerprint: parsed.fingerprint });
        return true;
      }
      this.logger.warn('RFC008 AgentId fingerprint mismatch', {
        agentId,
        error: validation.error,
        fingerprint: parsed.fingerprint,
      });
      return false;
    }

    // RFC003 旧格式: 检查 PeerId 前缀匹配
    if (parsed.format === 'old') {
      if (!parsed.peerIdPrefix) {
        this.logger.warn('Old format AgentId missing peerIdPrefix', { agentId });
        return false;
      }
      
      if (peerId && !peerId.startsWith(parsed.peerIdPrefix)) {
        this.logger.warn('RFC003 AgentId PeerId prefix mismatch', {
          agentId,
          expectedPrefix: peerId.slice(0, 16),
          actualPrefix: parsed.peerIdPrefix,
        });
        return false;
      }

      // 旧格式签名验证未完全实现，只检查格式
      this.logger.warn('RFC003 signature verification incomplete, format check passed', {
        agentId,
        peerId,
      });
      return true;
    }

    this.logger.warn('Signature verification failed: missing required parameters', {
      agentId,
      format: parsed.format,
      hasSignature: !!signature,
      hasPeerId: !!peerId,
      hasPublicKey: !!publicKey,
    });
    return false;
  }

  /**
   * 判断 Agent 是否为 RFC008 新格式
   */
  isNewFormatAgent(agentId: string): boolean {
    return isNewFormat(agentId);
  }

  /**
   * 判断 Agent 是否为 RFC003 旧格式
   */
  isOldFormatAgent(agentId: string): boolean {
    return isOldFormat(agentId);
  }

  /**
   * 获取 Agent 的格式类型
   */
  getAgentFormat(agentId: string): 'old' | 'new' | 'invalid' {
    const parsed = parseAgentId(agentId);
    if (!parsed.valid) return 'invalid';
    return parsed.format;
  }

  /**
   * 获取 Agent 的公钥（仅新格式）
   */
  getPublicKey(agentId: string): string | undefined {
    const agent = this.agents.get(agentId);
    return agent?.publicKey;
  }

  /**
   * 验证 AgentId 与公钥指纹是否匹配（RFC008）
   */
  validatePublicKeyFingerprint(agentId: string, publicKey: string): boolean {
    const validation = validateAgentId(agentId, publicKey);
    return validation.valid;
  }

  /**
   * 列出所有注册的 Agent
   */
  list(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  /**
   * 查找具备特定能力的 Agent
   */
  findByCapability(capabilityName: string): AgentRegistration[] {
    return this.list().filter(agent =>
      agent.capabilities.some(cap => cap.name === capabilityName)
    );
  }

  /**
   * 更新 Agent 最后活跃时间
   */
  updateLastActive(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastActiveAt = new Date();
    }
  }

  /**
   * RFC 005: 获取内部 Agents Map
   * 用于 MessageRouter 访问注册表
   */
  getAgentsMap(): Map<string, AgentRegistration> {
    return this.agents;
  }

  /**
   * 获取注册表统计信息
   */
  getStats(): {
    total: number;
    capabilities: Record<string, number>;
  } {
    const agents = this.list();
    const capabilities: Record<string, number> = {};

    for (const agent of agents) {
      for (const cap of agent.capabilities) {
        capabilities[cap.name] = (capabilities[cap.name] || 0) + 1;
      }
    }

    return {
      total: agents.length,
      capabilities,
    };
  }

  /**
   * 清理过期的 Agent（超过指定时间未活跃）
   */
  cleanupInactive(maxInactiveMs: number): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [agentId, agent] of this.agents.entries()) {
      const inactiveTime = now - agent.lastActiveAt.getTime();
      if (inactiveTime > maxInactiveMs) {
        this.agents.delete(agentId);
        this.logger.info('Agent cleaned up due to inactivity', {
          agentId,
          name: agent.name,
          inactiveTimeMs: inactiveTime,
        });
        cleaned++;
      }
    }

    // 如果有清理，保存更新后的数据
    if (cleaned > 0 && this.enablePersistence) {
      this.save();
    }

    return cleaned;
  }

  // ============================================================================
  // 持久化方法
  // ============================================================================

  /**
   * 将内存中的 Agent 数据保存到文件
   * 
   * 使用 JSON 格式，便于调试和查看
   * 自动排除 onMessage 回调（无法序列化）
   * 
   * 同步版本（立即完成，适合 constructor 和关键操作后）
   */
  save(): void {
    if (!this.enablePersistence) return;

    const filePath = join(this.dataDir, AGENT_REGISTRY_FILE);
    
    // 转换为持久化格式
    const persistedAgents: PersistedAgentRegistration[] = [];
    for (const agent of this.agents.values()) {
      persistedAgents.push(this.toPersistedFormat(agent));
    }

    const data: PersistedAgentRegistry = {
      version: 1,
      agents: persistedAgents,
      savedAt: new Date().toISOString(),
    };

    // 确保目录存在
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    
    // 原子写入：先写临时文件，再 rename
    // 防止进程崩溃时文件损坏
    const tempPath = filePath + '.tmp';
    try {
      writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      renameSync(tempPath, filePath); // POSIX atomic rename
      
      this.logger.debug('Agents saved', {
        path: filePath,
        count: persistedAgents.length,
      });
    } catch (err: unknown) {
      this.logger.error('Failed to save agents', { error: err instanceof Error ? err.message : String(err), path: filePath });
      // 尝试清理临时文件
      try {
        if (existsSync(tempPath)) {
          writeFileSync(tempPath, '', 'utf-8'); // 清空临时文件
        }
      } catch {
        // 忽略清理失败
      }
    }
  }

  /**
   * 将内存中的 Agent 数据保存到文件（异步版本）
   * 
   * P0 修复：避免阻塞主线程
   * 使用 JSON 格式，便于调试和查看
   * 自动排除 onMessage 回调（无法序列化）
   */
  async saveAsync(): Promise<void> {
    if (!this.enablePersistence) return;

    const filePath = join(this.dataDir, AGENT_REGISTRY_FILE);

    // 转换为持久化格式
    const persistedAgents: PersistedAgentRegistration[] = [];for (const agent of this.agents.values()) {      persistedAgents.push(this.toPersistedFormat(agent));
    }

    const data: PersistedAgentRegistry = {
      version: 1,
      agents: persistedAgents,
      savedAt: new Date().toISOString(),
    };

    // 异步确保目录存在
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }

    // 异步写入文件（简化版本，不使用原子写入）
    // TODO: 实现异步原子写入（需要 fs.promises.rename）
    try {
      await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.logger.debug('Agents saved (async)', {
        path: filePath,
        count: persistedAgents.length,
      });
    } catch (err: unknown) {
      this.logger.error('Failed to save agents (async)', { error: err instanceof Error ? err.message : String(err), path: filePath });
    }
  }

  /**
   * 从文件加载 Agent 数据到内存
   * 
   * 注意：加载的 Agent 没有 onMessage 回调
   * 同步版本（constructor 中使用）
   */
  load(): void {
    if (!this.enablePersistence) return;

    const filePath = join(this.dataDir, AGENT_REGISTRY_FILE);
    
    try {
      if (!existsSync(filePath)) {
        this.logger.debug('No persisted agents file found, starting fresh');
        return;
      }
      
      const content = readFileSync(filePath, 'utf-8');
      // 安全 JSON.parse：过滤危险 key，防止 prototype pollution
      const data: PersistedAgentRegistry = JSON.parse(content, (key, value) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          this.logger.warn('Blocked dangerous key in JSON parse', { key });
          return undefined; // Block dangerous keys
        }
        return value;
      });
      
      // 版本检查
      if (data.version !== 1) {
        this.logger.warn('Unsupported persistence version', { version: data.version });
        return;
      }
      
      // 加载到内存
      for (const persisted of data.agents) {
        const agent = this.fromPersistedFormat(persisted);
        this.agents.set(agent.agentId, agent);
      }
      
      this.logger.info('Agents loaded', {
        path: filePath,
        count: data.agents.length,
        savedAt: data.savedAt,
      });
    } catch (err: unknown) {
      this.logger.warn('Failed to load persisted agents', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * 从文件加载 Agent 数据到内存（异步版本）
   * 
   * P0 修复：避免阻塞主线程
   * 注意：加载的 Agent 没有 onMessage 回调
   */
  async loadAsync(): Promise<void> {
    if (!this.enablePersistence) return;

    const filePath = join(this.dataDir, AGENT_REGISTRY_FILE);

    try {
      // 异步检查文件存在
      if (!existsSync(filePath)) {
        this.logger.debug('No persisted agents file found, starting fresh');
        return;
      }

      // 异步读取文件
      const content = await readFile(filePath, 'utf-8');
      
      // 安全 JSON.parse：过滤危险 key，防止 prototype pollution
      const data: PersistedAgentRegistry = JSON.parse(content, (key, value) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          this.logger.warn('Blocked dangerous key in JSON parse', { key });
          return undefined;
        }
        return value;
      });

      // 版本检查
      if (data.version !== 1) {
        this.logger.warn('Unsupported persistence version', { version: data.version });
        return;
      }

      // 加载到内存
      for (const persisted of data.agents) {
        const agent = this.fromPersistedFormat(persisted);
        this.agents.set(agent.agentId, agent);
      }

      this.logger.info('Agents loaded (async)', {
        path: filePath,
        count: data.agents.length,
        savedAt: data.savedAt,
      });
    } catch (err: unknown) {
      this.logger.warn('Failed to load persisted agents (async)', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * 转换为持久化格式（Date → ISO string）
   * RFC008: 包含 publicKey、nodeSignature、nodePeerId、idFormat
   */
  private toPersistedFormat(agent: AgentRegistration): PersistedAgentRegistration {
    // 自动检测 idFormat
    const parsed = parseAgentId(agent.agentId);
    const idFormat = agent.idFormat || (parsed.valid ? parsed.format : 'old');
    
    return {
      agentId: agent.agentId,
      name: agent.name,
      capabilities: agent.capabilities,
      peerId: agent.peerId,
      signature: agent.signature,
      publicKey: agent.publicKey,
      nodeSignature: agent.nodeSignature,
      nodePeerId: agent.nodePeerId,
      idFormat,
      registeredAt: agent.registeredAt.toISOString(),
      lastActiveAt: agent.lastActiveAt.toISOString(),
      webhook: agent.webhook,
      metadata: agent.metadata,
    };
  }

  /**
   * 从持久化格式转换（ISO string → Date）
   * RFC008: 包含 publicKey、nodeSignature、nodePeerId、idFormat
   */
  private fromPersistedFormat(persisted: PersistedAgentRegistration): AgentRegistration {
    // 自动检测 idFormat
    const parsed = parseAgentId(persisted.agentId);
    const idFormat = persisted.idFormat || (parsed.valid ? parsed.format : 'old');
    
    return {
      agentId: persisted.agentId,
      name: persisted.name,
      capabilities: persisted.capabilities,
      peerId: persisted.peerId,
      signature: persisted.signature,
      publicKey: persisted.publicKey,
      nodeSignature: persisted.nodeSignature,
      nodePeerId: persisted.nodePeerId,
      idFormat,
      registeredAt: new Date(persisted.registeredAt),
      lastActiveAt: new Date(persisted.lastActiveAt),
      webhook: persisted.webhook,
      metadata: persisted.metadata,
      // 注意：onMessage 无法恢复
    };
  }
}