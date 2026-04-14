/**
 * Message Router
 * 处理 Daemon 内部 Agent 之间的消息路由
 */

import { Logger } from '../utils/logger.js';
import type { AgentRegistration } from './agent-registry.js';

/**
 * 路由消息类型
 */
export interface RoutableMessage {
  /** 消息 ID */
  messageId: string;
  /** 发送方 Agent ID */
  fromAgentId: string;
  /** 目标 Agent ID（可选，不指定则广播） */
  toAgentId?: string;
  /** 消息内容 */
  content: string;
  /** 消息元数据 */
  metadata?: Record<string, unknown>;
  /** 消息类型 */
  type: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 消息队列（每个 Agent 独立）
 */
export interface MessageQueue {
  /** Agent ID */
  agentId: string;
  /** 消息列表 */
  messages: RoutableMessage[];
  /** 最大队列大小 */
  maxSize: number;
}

/**
 * 消息路由器
 * 管理 Agent 之间的消息路由和队列
 */
export class MessageRouter {
  private queues: Map<string, MessageQueue> = new Map();
  private agentRegistry: Map<string, AgentRegistration>;
  private logger: Logger;
  private defaultMaxQueueSize: number = 100;

  constructor(agentRegistry: Map<string, AgentRegistration>, options?: {
    maxQueueSize?: number;
  }) {
    this.agentRegistry = agentRegistry;
    this.logger = new Logger({ component: 'MessageRouter' });
    this.defaultMaxQueueSize = options?.maxQueueSize || 100;
  }

  /**
   * 为 Agent 创建消息队列
   */
  createQueue(agentId: string, maxSize?: number): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, {
        agentId,
        messages: [],
        maxSize: maxSize || this.defaultMaxQueueSize,
      });
      this.logger.info('Message queue created', { agentId });
    }
  }

  /**
   * 删除 Agent 的消息队列
   */
  deleteQueue(agentId: string): void {
    if (this.queues.has(agentId)) {
      this.queues.delete(agentId);
      this.logger.info('Message queue deleted', { agentId });
    }
  }

  /**
   * 获取 Agent 的消息队列
   */
  getQueue(agentId: string): MessageQueue | undefined {
    return this.queues.get(agentId);
  }

  /**
   * 路由消息到特定 Agent
   * 
   * 如果目标 Agent 有本地回调（onMessage），直接调用回调
   * 否则放入消息队列（等待 HTTP 轮询）
   */
  route(message: RoutableMessage): boolean {
    const { toAgentId, fromAgentId } = message;

    // 验证发送方存在
    if (!this.agentRegistry.has(fromAgentId)) {
      this.logger.warn('Sender agent not registered', { fromAgentId });
      return false;
    }

    // 如果指定了目标 Agent，路由到该 Agent
    if (toAgentId) {
      const targetAgent = this.agentRegistry.get(toAgentId);
      if (!targetAgent) {
        this.logger.warn('Target agent not registered', { toAgentId });
        return false;
      }

      // 如果目标 Agent 有本地回调，直接调用（无需队列）
      if (targetAgent.onMessage) {
        try {
          targetAgent.onMessage({
            messageId: message.messageId,
            fromAgentId: message.fromAgentId,
            toAgentId: message.toAgentId || '',
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
          });
          this.logger.debug('Message delivered via local callback', {
            messageId: message.messageId,
            toAgentId,
            fromAgentId,
          });
          return true;
        } catch (err) {
          this.logger.error('Local callback error', {
            toAgentId,
            error: err instanceof Error ? err.message : String(err),
          });
          // 回调失败，降级到队列
        }
      }

      // 无回调或回调失败，放入队列
      const queue = this.queues.get(toAgentId);
      if (!queue) {
        this.logger.warn('Target agent queue not found', { toAgentId });
        return false;
      }

      // 检查队列大小，防止溢出
      if (queue.messages.length >= queue.maxSize) {
        queue.messages.shift();
        this.logger.warn('Queue overflow, removed oldest message', { toAgentId });
      }

      queue.messages.push(message);
      this.logger.debug('Message routed to queue', {
        messageId: message.messageId,
        toAgentId,
        fromAgentId,
      });
      return true;
    }

    // 如果未指定目标 Agent，广播给所有 Agent（除了发送方）
    return this.broadcast(message);
  }

  /**
   * 广播消息给所有 Agent
   * 
   * 本地 Agent（有 onMessage 回调）直接调用回调
   * 远程 Agent 放入队列
   */
  broadcast(message: RoutableMessage): boolean {
    const { fromAgentId } = message;
    let delivered = 0;

    for (const [agentId, agent] of this.agentRegistry.entries()) {
      // 不发送给自己
      if (agentId === fromAgentId) {
        continue;
      }

      // 如果目标 Agent 有本地回调，直接调用
      if (agent.onMessage) {
        try {
          agent.onMessage({
            messageId: message.messageId,
            fromAgentId: message.fromAgentId,
            toAgentId: agentId,
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
          });
          delivered++;
        } catch (err) {
          this.logger.error('Broadcast callback error', {
            agentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        // 无回调，放入队列
        const queue = this.queues.get(agentId);
        if (!queue) {
          continue;
        }

        if (queue.messages.length >= queue.maxSize) {
          queue.messages.shift();
          this.logger.warn('Queue overflow during broadcast', { agentId });
        }

        queue.messages.push({
          ...message,
          toAgentId: agentId,
        });
        delivered++;
      }
    }

    this.logger.debug('Message broadcasted', {
      messageId: message.messageId,
      fromAgentId,
      deliveredCount: delivered,
    });

    return delivered > 0;
  }

  /**
   * 获取 Agent 的待处理消息
   */
  getMessages(agentId: string, limit?: number): RoutableMessage[] {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return [];
    }

    const messages = queue.messages.slice(0, limit || queue.messages.length);
    return messages;
  }

  /**
   * 清除 Agent 的消息（确认已处理）
   */
  clearMessages(agentId: string, messageIds?: string[]): number {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return 0;
    }

    if (!messageIds) {
      // 清除所有消息
      const count = queue.messages.length;
      queue.messages = [];
      return count;
    }

    // 清除指定的消息
    const originalCount = queue.messages.length;
    queue.messages = queue.messages.filter(
      msg => !messageIds.includes(msg.messageId)
    );
    return originalCount - queue.messages.length;
  }

  /**
   * 获取路由统计信息
   */
  getStats(): {
    queues: number;
    totalMessages: number;
    queueStats: Record<string, { size: number; maxSize: number }>;
  } {
    const queueStats: Record<string, { size: number; maxSize: number }> = {};
    let totalMessages = 0;

    for (const [agentId, queue] of this.queues.entries()) {
      queueStats[agentId] = {
        size: queue.messages.length,
        maxSize: queue.maxSize,
      };
      totalMessages += queue.messages.length;
    }

    return {
      queues: this.queues.size,
      totalMessages,
      queueStats,
    };
  }

  /**
   * 清理过期的消息（超过指定时间）
   */
  cleanupExpired(maxAgeMs: number): number {
    const now = Date.now();
    let cleaned = 0;

    for (const queue of this.queues.values()) {
      const originalCount = queue.messages.length;
      queue.messages = queue.messages.filter(msg => {
        const age = now - msg.createdAt.getTime();
        return age <= maxAgeMs;
      });
      cleaned += originalCount - queue.messages.length;
    }

    if (cleaned > 0) {
      this.logger.info('Expired messages cleaned', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * 更新 Agent 注册表
   * 公开方法，允许外部更新注册表引用
   */
  updateRegistry(registry: Map<string, AgentRegistration>): void {
    this.agentRegistry = registry;
    this.logger.info('Agent registry updated', { count: registry.size });
  }
}