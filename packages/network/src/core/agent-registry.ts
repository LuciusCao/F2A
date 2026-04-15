/**
 * Agent Registry
 * 管理注册到 Daemon 的 Agent 实例
 * 
 * RFC 003: AgentId 由节点签发，不能由用户自定义
 * 
 * Phase 3: 添加持久化支持（save/load）
 */

import { Logger } from '../utils/logger.js';
import type { AgentCapability } from '../types/index.js';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

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
 * Agent 注册信息
 */
export interface AgentRegistration {
  /** Agent 唯一标识符（节点签发）格式: agent:<PeerId前16位>:<随机8位> */
  agentId: string;
  /** Agent 显示名称（用户定义，可修改） */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 签发节点的 PeerId */
  peerId: string;
  /** AgentId 签名（Base64） */
  signature: string;
  /** 注册时间 */
  registeredAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** Webhook URL（用于推送消息给远程 Agent） */
  webhookUrl?: string;
  /** 本地消息回调（用于直接推送消息给本地 Agent，无需轮询） */
  onMessage?: MessageCallback;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Agent 注册请求（用户提供）
 */
export interface AgentRegistrationRequest {
  /** Agent 显示名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** Webhook URL（可选，用于远程 Agent） */
  webhookUrl?: string;
  /** 本地消息回调（可选，用于本地 Agent 直接接收消息） */
  onMessage?: MessageCallback;
  /** Agent 元数据（可选） */
  metadata?: Record<string, unknown>;
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
  /** 签发节点的 PeerId */
  peerId: string;
  /** AgentId 签名（Base64） */
  signature: string;
  /** 注册时间（ISO 字符串） */
  registeredAt: string;
  /** 最后活跃时间（ISO 字符串） */
  lastActiveAt: string;
  /** Webhook URL */
  webhookUrl?: string;
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
   * 注册 Agent（节点签发 AgentId）
   * 
   * 用户只提供 name 和 capabilities
   * 节点生成并签名 AgentId
   */
  register(request: AgentRegistrationRequest): AgentRegistration {
    // 生成 AgentId
    const agentId = this.generateAgentId();
    
    // 签名 AgentId
    const signature = this.signAgentId(agentId);

    const registration: AgentRegistration = {
      agentId,
      name: request.name,
      capabilities: request.capabilities,
      peerId: this.peerId,
      signature,
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      webhookUrl: request.webhookUrl,
      onMessage: request.onMessage,
      metadata: request.metadata,
    };

    this.agents.set(agentId, registration);
    
    // 自动保存（同步，立即完成）
    this.save();
    
    this.logger.info('Agent registered (node-issued)', {
      agentId,
      name: request.name,
      peerId: this.peerId,
      capabilities: request.capabilities.map(c => c.name),
      isLocal: !!request.onMessage,
    });

    return registration;
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
   * 获取 Agent 信息
   */
  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 验证 AgentId 签名
   * 
   * 安全限制（当前实现）:
   * - 仅检查格式和 PeerId 前缀匹配
   * - 完整签名验证未实现（需要其他节点的公钥）
   * - 采用 fail-safe 策略：验证失败时拒绝，而非放行
   * 
   * TODO: 实现完整签名验证流程
   * - 存储其他节点的公钥
   * - 使用 crypto 验证 Ed25519 签名
   */
  verifySignature(agentId: string, signature: string, peerId: string): boolean {
    // 检查 AgentId 格式
    if (!agentId.startsWith('agent:')) {
      this.logger.warn('Invalid AgentId format', { agentId });
      return false;
    }

    // 检查 PeerId 前缀匹配
    const peerIdPrefix = agentId.split(':')[1];
    if (peerId && !peerId.startsWith(peerIdPrefix)) {
      this.logger.warn('AgentId PeerId prefix mismatch', { agentId, expectedPrefix: peerId.slice(0, 16) });
      return false;
    }

    // Fail-safe: 签名验证未完全实现，拒绝不可信的 AgentId
    // 完整签名验证需要其他节点的公钥，目前尚未实现
    // 安全原则：fail safe, not fail open!
    this.logger.warn('Signature verification not fully implemented, rejecting untrusted AgentId', {
      agentId,
      peerId,
      reason: '完整的签名验证需要其他节点的公钥，当前仅支持格式检查'
    });
    return false;
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
    } catch (err: any) {
      this.logger.error('Failed to save agents', { error: err.message, path: filePath });
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
    } catch (err: any) {
      this.logger.error('Failed to save agents (async)', { error: err.message, path: filePath });
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
    } catch (err: any) {
      this.logger.warn('Failed to load persisted agents', { error: err.message });
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
    } catch (err: any) {
      this.logger.warn('Failed to load persisted agents (async)', { error: err.message });
    }
  }

  /**
   * 转换为持久化格式（Date → ISO string）
   */
  private toPersistedFormat(agent: AgentRegistration): PersistedAgentRegistration {
    return {
      agentId: agent.agentId,
      name: agent.name,
      capabilities: agent.capabilities,
      peerId: agent.peerId,
      signature: agent.signature,
      registeredAt: agent.registeredAt.toISOString(),
      lastActiveAt: agent.lastActiveAt.toISOString(),
      webhookUrl: agent.webhookUrl,
      metadata: agent.metadata,
    };
  }

  /**
   * 从持久化格式转换（ISO string → Date）
   */
  private fromPersistedFormat(persisted: PersistedAgentRegistration): AgentRegistration {
    return {
      agentId: persisted.agentId,
      name: persisted.name,
      capabilities: persisted.capabilities,
      peerId: persisted.peerId,
      signature: persisted.signature,
      registeredAt: new Date(persisted.registeredAt),
      lastActiveAt: new Date(persisted.lastActiveAt),
      webhookUrl: persisted.webhookUrl,
      metadata: persisted.metadata,
      // 注意：onMessage 无法恢复
    };
  }
}