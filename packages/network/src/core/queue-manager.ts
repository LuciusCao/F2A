/**
 * Queue Manager
 * 管理 Agent 消息队列
 *
 * 从 message-router.ts 提取的队列管理功能
 */

import { Logger } from '../utils/logger.js';
import type { RoutableMessage } from './message-router.js';

/**
 * 消息队列(每个 Agent 独立)
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
 * QueueManager 依赖注入接口
 */
export interface QueueManagerDeps {
  logger: Logger;
  defaultMaxQueueSize: number;
}

/**
 * 队列管理器
 * 管理 Agent 消息队列的创建、删除、获取和操作
 */
export class QueueManager {
  private queues: Map<string, MessageQueue> = new Map();
  private logger: Logger;
  private defaultMaxQueueSize: number;

  constructor(deps: QueueManagerDeps) {
    this.logger = deps.logger;
    this.defaultMaxQueueSize = deps.defaultMaxQueueSize;
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
   * 从队列中轮询消息
   * @param agentId Agent ID
   * @param limit 最大获取数量
   * @returns 消息列表（不移除）
   */
  pollQueue(agentId: string, limit?: number): RoutableMessage[] {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return [];
    }
    return queue.messages.slice(0, limit || queue.messages.length);
  }

  /**
   * 从队列中弹出一条消息
   * @param agentId Agent ID
   * @returns 弹出的消息，或 undefined
   */
  popMessage(agentId: string): RoutableMessage | undefined {
    const queue = this.queues.get(agentId);
    if (!queue || queue.messages.length === 0) {
      return undefined;
    }
    return queue.messages.shift();
  }

  /**
   * 将消息放入队列
   * 私有方法，供 MessageRouter 使用
   * 
   * @param queue 目标队列
   * @param message 要放入的消息
   * @returns 是否成功放入
   */
  enqueue(queue: MessageQueue, message: RoutableMessage): boolean {
    // 检查队列大小,防止溢出
    if (queue.messages.length >= queue.maxSize) {
      queue.messages.shift();
      this.logger.warn('Queue overflow, removed oldest message', { 
        agentId: queue.agentId 
      });
    }

    queue.messages.push(message);
    this.logger.debug('Message enqueued', {
      messageId: message.messageId,
      agentId: queue.agentId,
    });
    return true;
  }

  /**
   * 清除 Agent 的消息(确认已处理)
   * @param agentId Agent ID
   * @param messageIds 要清除的消息ID列表（可选，不指定则清除全部）
   * @returns 清除的消息数量
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
   * 清理过期的消息(超过指定时间)
   * @param maxAgeMs 最大存活时间（毫秒）
   * @returns 清理的消息数量
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
   * 获取队列统计信息
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
}