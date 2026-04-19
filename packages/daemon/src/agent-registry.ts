/**
 * Agent Registry
 * 管理注册到 Daemon 的 Agent 实例
 * 
 * RFC 003: AgentId 由节点签发，不能由用户自定义
 */

import { Logger } from '@f2a/network';
import type { AgentCapability } from '@f2a/network';
import { randomBytes } from 'crypto';

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
  /** Webhook 配置（RFC 004: Agent 级 Webhook，用于推送消息给远程 Agent） */
  webhook?: AgentWebhook;
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
  /** Webhook 配置（RFC 004: Agent 级 Webhook，可选，用于远程 Agent） */
  webhook?: AgentWebhook;
  /** 本地消息回调（可选，用于本地 Agent 直接接收消息） */
  onMessage?: MessageCallback;
  /** Agent 元数据（可选） */
  metadata?: Record<string, unknown>;
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

  constructor(peerId: string, signFunction: (data: string) => string) {
    this.logger = new Logger({ component: 'AgentRegistry' });
    this.peerId = peerId;
    this.signFunction = signFunction;
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
      webhook: request.webhook,
      onMessage: request.onMessage,
      metadata: request.metadata,
    };

    this.agents.set(agentId, registration);
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

    this.agents.delete(agentId);
    this.logger.info('Agent unregistered', { agentId, name: agent.name });
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

    agent.name = newName;
    agent.lastActiveAt = new Date();
    this.logger.info('Agent name updated', { agentId, oldName: agent.name, newName });
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
    this.logger.info('Agent webhook updated', { 
      agentId, 
      webhookUrl: webhook?.url || 'removed',
      hasToken: !!webhook?.token
    });
    return true;
  }

  /**
   * 检查 Agent 是否存在
   */
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * 获取 Agent 信息
   */
  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 获取所有 Agent 的 entries
   */
  entries(): IterableIterator<[string, AgentRegistration]> {
    return this.agents.entries();
  }

  /**
   * 获取所有 Agent
   */
  getAll(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取 Agent 数量
   */
  size(): number {
    return this.agents.size;
  }

  /**
   * 验证 AgentId 签名
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

    // TODO: 实际验证签名（需要其他节点的公钥）
    // 目前只检查格式，后续需要实现完整的签名验证
    this.logger.debug('AgentId signature verified (format check)', { agentId });
    return true;
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

    return cleaned;
  }

  /**
   * Phase 6: 从 AgentIdentity 恢复 Agent
   * 用于重启后恢复持久化的 Agent 身份
   */
  restore(identity: {
    agentId: string;
    name: string;
    peerId: string;
    signature: string;
    webhook?: AgentWebhook;
    capabilities: AgentCapability[];
    metadata?: Record<string, unknown>;
    createdAt: string;
    lastActiveAt: string;
  }): AgentRegistration {
    // 检查 identity 是否属于当前节点
    const identityPeerIdPrefix = identity.agentId.split(':')[1];
    const currentPeerIdPrefix = this.peerId.slice(0, 16);
    
    if (identityPeerIdPrefix !== currentPeerIdPrefix) {
      this.logger.warn('Cannot restore agent from different node', {
        agentId: identity.agentId,
        identityPeerIdPrefix,
        currentPeerIdPrefix,
      });
      throw new Error('Cannot restore agent from different node');
    }

    // 构造 AgentRegistration
    const registration: AgentRegistration = {
      agentId: identity.agentId,
      name: identity.name,
      capabilities: identity.capabilities,
      peerId: identity.peerId,
      signature: identity.signature,
      registeredAt: new Date(identity.createdAt),
      lastActiveAt: new Date(identity.lastActiveAt),
      webhook: identity.webhook,
      metadata: identity.metadata,
    };

    // 添加到注册表
    this.agents.set(identity.agentId, registration);

    this.logger.info('Agent restored from identity', {
      agentId: identity.agentId,
      name: identity.name,
      peerId: identity.peerId,
      capabilities: identity.capabilities.map(c => c.name),
    });

    return registration;
  }
}