/**
 * Agent Registry
 * 管理注册到 Daemon 的 Agent 实例
 */

import { Logger } from '../utils/logger.js';
import type { AgentCapability } from '../types/index.js';
import type { AgentIdentity } from '../core/identity/types.js';
import { AgentIdentityManager } from '../core/identity/agent-identity.js';

/**
 * Agent 注册信息
 */
export interface AgentRegistration {
  /** Agent 唯一标识符 */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 注册时间 */
  registeredAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** Webhook URL（用于推送消息给 Agent） */
  webhookUrl?: string;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
  /** Agent 身份签名（Node 对 Agent 的签名，base64） */
  signature?: string;
  /** 所属 Node ID */
  nodeId?: string;
  /** Agent 公钥（base64） */
  publicKey?: string;
  /** Agent 创建时间（ISO string） */
  createdAt?: string;
}

/**
 * Agent 注册表
 * 管理注册到 Daemon 的所有 Agent
 */
export class AgentRegistry {
  private agents: Map<string, AgentRegistration> = new Map();
  private logger: Logger;
  /** Node 公钥验证函数（用于验证 Agent 签名） */
  private verifyWithNodeKey?: (data: Uint8Array, signature: Uint8Array, nodeId: string) => Promise<boolean>;

  constructor(options?: {
    /** 提供 Node 公钥验证函数 */
    verifyWithNodeKey?: (data: Uint8Array, signature: Uint8Array, nodeId: string) => Promise<boolean>;
  }) {
    this.logger = new Logger({ component: 'AgentRegistry' });
    this.verifyWithNodeKey = options?.verifyWithNodeKey;
  }

  /**
   * 设置 Node 公钥验证函数
   */
  setVerifyFunction(verifyFn: (data: Uint8Array, signature: Uint8Array, nodeId: string) => Promise<boolean>): void {
    this.verifyWithNodeKey = verifyFn;
  }

  /**
   * 注册 Agent
   */
  register(agent: Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'>): AgentRegistration {
    const registration: AgentRegistration = {
      ...agent,
      registeredAt: new Date(),
      lastActiveAt: new Date(),
    };

    this.agents.set(agent.agentId, registration);
    this.logger.info('Agent registered', {
      agentId: agent.agentId,
      name: agent.name,
      capabilities: agent.capabilities.map(c => c.name),
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
   * 获取 Agent 信息
   */
  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
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
   * 验证 Agent 签名
   * 检查消息签名是否来自已注册的 Agent
   * 
   * @param agentId - Agent ID
   * @param signature - 消息签名（可选，如未提供则使用注册时的签名）
   * @returns 签名是否有效
   */
  verifySignature(agentId: string, signature?: string): boolean {
    // 1. 检查 Agent 是否已注册
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not registered for signature verification', { agentId });
      return false;
    }

    // 2. 获取签名
    const sigToVerify = signature || agent.signature;
    if (!sigToVerify) {
      this.logger.warn('Missing signature', { agentId });
      return false;
    }

    // 3. 验证签名格式（必须是有效的 base64 字符串，长度为 64 字节的 Ed25519 签名）
    // 64 字节的签名编码为 base64 后大约是 88 字符
    try {
      const sigBytes = Buffer.from(sigToVerify, 'base64');
      // Ed25519 签名长度应该是 64 字节
      if (sigBytes.length !== 64) {
        this.logger.warn('Invalid signature length', { agentId, expectedLength: 64, actualLength: sigBytes.length });
        return false;
      }
      // 验证 base64 字符串格式（不应包含非法字符）
      const validBase64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
      if (!validBase64Pattern.test(sigToVerify.replace(/\s/g, ''))) {
        this.logger.warn('Invalid base64 format', { agentId });
        return false;
      }
    } catch (error) {
      this.logger.warn('Invalid signature format (not base64)', { agentId });
      return false;
    }

    // 4. 验证 AgentId 格式（RFC 003: agent:<PeerId前16位>:<随机8位>）
    const agentIdPattern = /^agent:[a-zA-Z0-9]{16}:[a-zA-Z0-9]{8}$/;
    if (!agentIdPattern.test(agentId)) {
      this.logger.warn('Invalid AgentId format', { agentId, pattern: 'agent:<PeerId16>:<Random8>' });
      return false;
    }

    // 5. 验证签名与 AgentId 匹配（AgentId 必须来自所属 NodeId）
    // AgentId 格式: agent:<PeerId前16位>:<随机8位>
    // NodeId 必须与 AgentId 中的 PeerId 前缀匹配
    if (agent.nodeId) {
      const peerIdPrefix = agentId.split(':')[1]; // 取 PeerId 前16位
      const expectedPrefix = agent.nodeId.substring(0, 16);
      if (peerIdPrefix !== expectedPrefix) {
        this.logger.warn('AgentId does not match NodeId', {
          agentId,
          nodeId: agent.nodeId,
          peerIdPrefix,
          expectedPrefix
        });
        return false;
      }
    }

    // 6. TODO: 使用 Node 公钥进行真实签名验证
    // 当前仅做格式验证，Phase 3 将集成 IdentityDelegator.verifyAgent()
    // 真实验证需要调用 AgentIdentityManager.verifySignature()
    if (this.verifyWithNodeKey && agent.nodeId && agent.publicKey && agent.createdAt) {
      // 如果提供了验证函数，可以进行完整验证
      // 但这里简化处理，标记为需要后续集成
      this.logger.debug('Signature format validated, full verification pending', { agentId });
    }

    this.logger.debug('Signature format validated', { agentId });
    return true;
  }

  /**
   * 验证 Agent 身份完整性
   * 使用 AgentIdentityManager 的验证方法
   * 
   * @param agentIdentity - Agent 身份信息
   * @returns Promise<boolean> 签名是否有效
   */
  async verifyAgentIdentity(agentIdentity: AgentIdentity): Promise<boolean> {
    if (!this.verifyWithNodeKey) {
      this.logger.warn('No verification function configured');
      return false;
    }

    try {
      return await AgentIdentityManager.verifySignature(agentIdentity, this.verifyWithNodeKey);
    } catch (error) {
      this.logger.error('Failed to verify agent identity', {
        agentId: agentIdentity.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 注册 Agent 并验证签名
   * 如果签名验证失败，拒绝注册
   * 
   * @param agent - Agent 注册信息（包含签名）
   * @param verifySignature - 是否验证签名（默认 false，Phase 3 后默认 true）
   * @returns 注册结果或验证失败原因
   */
  registerWithVerification(
    agent: Omit<AgentRegistration, 'registeredAt' | 'lastActiveAt'>,
    verifySignature: boolean = false
  ): { success: boolean; registration?: AgentRegistration; error?: string } {
    // 如果需要验证签名
    if (verifySignature) {
      // 直接验证签名格式（不依赖 registry）
      const isValid = this.validateSignatureFormat(agent.agentId, agent.signature, agent.nodeId);
      if (!isValid) {
        this.logger.warn('Agent registration rejected: signature verification failed', {
          agentId: agent.agentId
        });
        return {
          success: false,
          error: 'Signature verification failed'
        };
      }
    }

    // 注册 Agent
    const registration = this.register(agent);
    return {
      success: true,
      registration
    };
  }

  /**
   * 验证签名格式（用于注册前验证）
   * 不依赖 registry 中已存在的记录
   */
  private validateSignatureFormat(
    agentId: string,
    signature: string | undefined,
    nodeId: string | undefined
  ): boolean {
    // 1. 检查签名是否存在
    if (!signature) {
      this.logger.warn('Missing signature', { agentId });
      return false;
    }

    // 2. 验证签名格式（必须是有效的 base64 字符串，长度为 64 字节的 Ed25519 签名）
    try {
      const sigBytes = Buffer.from(signature, 'base64');
      if (sigBytes.length !== 64) {
        this.logger.warn('Invalid signature length', { agentId, expectedLength: 64, actualLength: sigBytes.length });
        return false;
      }
      const validBase64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
      if (!validBase64Pattern.test(signature.replace(/\s/g, ''))) {
        this.logger.warn('Invalid base64 format', { agentId });
        return false;
      }
    } catch (error) {
      this.logger.warn('Invalid signature format (not base64)', { agentId });
      return false;
    }

    // 3. 验证 AgentId 格式（RFC 003: agent:<PeerId前16位>:<随机8位>）
    const agentIdPattern = /^agent:[a-zA-Z0-9]{16}:[a-zA-Z0-9]{8}$/;
    if (!agentIdPattern.test(agentId)) {
      this.logger.warn('Invalid AgentId format', { agentId, pattern: 'agent:<PeerId16>:<Random8>' });
      return false;
    }

    // 4. 验证签名与 AgentId 匹配（AgentId 必须来自所属 NodeId）
    if (nodeId) {
      const peerIdPrefix = agentId.split(':')[1];
      const expectedPrefix = nodeId.substring(0, 16);
      if (peerIdPrefix !== expectedPrefix) {
        this.logger.warn('AgentId does not match NodeId', {
          agentId,
          nodeId,
          peerIdPrefix,
          expectedPrefix
        });
        return false;
      }
    }

    this.logger.debug('Signature format validated', { agentId });
    return true;
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
}