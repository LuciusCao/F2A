/**
 * Agent Registry
 * 管理注册到 Daemon 的 Agent 实例
 */

import { Logger } from '@f2a/network';
import type { AgentCapability } from '@f2a/network';

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
}

/**
 * Agent 注册表
 * 管理注册到 Daemon 的所有 Agent
 */
export class AgentRegistry {
  private agents: Map<string, AgentRegistration> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ component: 'AgentRegistry' });
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