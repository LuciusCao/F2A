/**
 * Message Router
 * 处理 Daemon 内部 Agent 之间的消息路由
 * 
 * 消息投递优先级：
 * 1. onMessage 本地回调（同进程 Agent）
 * 2. webhookUrl 推送（远程 Agent）
 * 3. 消息队列（HTTP 轮询）
 */

import { Logger } from '@f2a/network';
import { AgentRegistry } from './agent-registry.js';
import type { AgentRegistration } from './agent-registry.js';

/**
 * Registry 接口类型
 * 支持 AgentRegistry 或 Map<string, AgentRegistration>
 */
type RegistryLike = AgentRegistry | Map<string, AgentRegistration>;

/**
 * Webhook 推送结果
 */
export interface WebhookPushResult {
  success: boolean;
  error?: string;
  latency?: number;
}

/**
 * Webhook 推送 payload 格式
 * 兼容 OpenClaw /hooks/agent 和 Hermes webhook 路由
 */
export interface F2AMessagePayload {
  /** 消息内容 */
  message: string;
  /** 发送方信息 */
  from: {
    agentId: string;
    name: string;
  };
  /** 接收方信息 */
  to: {
    agentId: string;
    name: string;
  };
  /** 会话 key（用于保持对话上下文） */
  sessionKey: string;
  /** 消息类型 */
  type: string;
  /** 时间戳 */
  timestamp: number;
  /** 消息 ID */
  messageId: string;
}

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
  private agentRegistry: RegistryLike;
  private logger: Logger;
  private defaultMaxQueueSize: number = 100;
  private webhookTimeout: number = 5000;
  private webhookFailures: Map<string, number> = new Map();
  private readonly WEBHOOK_FAILURE_THRESHOLD = 3;

  constructor(agentRegistry: RegistryLike, options?: {
    maxQueueSize?: number;
    webhookTimeout?: number;
  }) {
    this.agentRegistry = agentRegistry;
    this.logger = new Logger({ component: 'MessageRouter' });
    this.defaultMaxQueueSize = options?.maxQueueSize || 100;
    this.webhookTimeout = options?.webhookTimeout || 5000;
  }

  /**
   * 构建 webhook payload
   */
  private buildPayload(message: RoutableMessage, targetAgent: AgentRegistration): F2AMessagePayload {
    const fromAgent = this.agentRegistry.get(message.fromAgentId);
    return {
      message: message.content,
      from: {
        agentId: message.fromAgentId,
        name: fromAgent?.name || 'unknown',
      },
      to: {
        agentId: targetAgent.agentId,
        name: targetAgent.name,
      },
      sessionKey: `f2a:${message.fromAgentId}:${targetAgent.agentId}`,
      type: message.type,
      timestamp: message.createdAt.getTime(),
      messageId: message.messageId,
    };
  }

  /**
   * 推送消息到 webhook URL
   * RFC 004: 支持可选的认证 token
   */
  private async pushToWebhook(webhookUrl: string, payload: F2AMessagePayload, token?: string): Promise<WebhookPushResult> {
    const start = Date.now();
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // RFC 004: 如果有 token，添加认证头
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        // 或使用 X-F2A-Token 格式
        headers['X-F2A-Token'] = token;
      }
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.webhookTimeout),
      });

      const latency = Date.now() - start;

      if (response.ok || response.status === 202) {
        return { success: true, latency };
      }

      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        latency,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latency: Date.now() - start,
      };
    }
  }

  /**
   * 检查 webhook 是否可用（未超过失败阈值）
   */
  private isWebhookAvailable(agentId: string): boolean {
    const failures = this.webhookFailures.get(agentId) || 0;
    return failures < this.WEBHOOK_FAILURE_THRESHOLD;
  }

  /**
   * 记录 webhook 失败
   */
  private recordWebhookFailure(agentId: string): void {
    const failures = (this.webhookFailures.get(agentId) || 0) + 1;
    this.webhookFailures.set(agentId, failures);
    
    if (failures >= this.WEBHOOK_FAILURE_THRESHOLD) {
      this.logger.warn('Webhook disabled due to consecutive failures', {
        agentId,
        failures,
        threshold: this.WEBHOOK_FAILURE_THRESHOLD,
      });
    }
  }

  /**
   * 重置 webhook 失败计数（成功后调用）
   */
  private resetWebhookFailures(agentId: string): void {
    this.webhookFailures.delete(agentId);
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
   * 投递优先级：
   * 1. onMessage 本地回调（同进程 Agent，同步调用）
   * 2. webhookUrl 推送（远程 Agent，异步执行，不阻塞）
   * 3. 消息队列（HTTP 轮询，作为 fallback）
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

      // 优先级 1: 如果目标 Agent 有本地回调，直接调用（无需队列）
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
          // 回调失败，降级到 webhook 或队列
        }
      }

      // 优先级 2: 如果有 webhook 且可用，异步推送（不阻塞）
      if (targetAgent.webhook?.url && this.isWebhookAvailable(toAgentId)) {
        const payload = this.buildPayload(message, targetAgent);
        
        // 异步推送，不阻塞消息投递
        this.pushToWebhook(targetAgent.webhook.url, payload, targetAgent.webhook.token)
          .then(result => {
            if (result.success) {
              this.resetWebhookFailures(toAgentId);
              this.logger.debug('Message pushed via webhook', {
                messageId: message.messageId,
                toAgentId,
                webhookUrl: targetAgent.webhook?.url,
                latency: result.latency,
              });
            } else {
              this.recordWebhookFailure(toAgentId);
              this.logger.warn('Webhook push failed, fallback to queue', {
                messageId: message.messageId,
                toAgentId,
                error: result.error,
              });
              // Webhook 失败，放入队列作为 fallback
              this.addToQueue(toAgentId, message);
            }
          })
          .catch(err => {
            this.logger.error('Webhook push error', {
              toAgentId,
              error: err instanceof Error ? err.message : String(err),
            });
            this.addToQueue(toAgentId, message);
          });
        
        // 返回 true 表示消息已投递（异步处理中）
        return true;
      }

      // 优先级 3: 无回调且无可用 webhook，放入队列
      return this.addToQueue(toAgentId, message);
    }

    // 如果未指定目标 Agent，广播给所有 Agent（除了发送方）
    return this.broadcast(message);
  }

  /**
   * 添加消息到队列
   */
  private addToQueue(agentId: string, message: RoutableMessage): boolean {
    const queue = this.queues.get(agentId);
    if (!queue) {
      this.logger.warn('Target agent queue not found', { agentId });
      return false;
    }

    // 检查队列大小，防止溢出
    if (queue.messages.length >= queue.maxSize) {
      queue.messages.shift();
      this.logger.warn('Queue overflow, removed oldest message', { agentId });
    }

    queue.messages.push(message);
    this.logger.debug('Message routed to queue', {
      messageId: message.messageId,
      toAgentId: agentId,
      fromAgentId: message.fromAgentId,
    });
    return true;
  }

  /**
   * 广播消息给所有 Agent
   * 
   * 投递优先级：
   * 1. onMessage 本地回调（同进程 Agent）
   * 2. webhookUrl 推送（远程 Agent）
   * 3. 消息队列（HTTP 轮询）
   */
  broadcast(message: RoutableMessage): boolean {
    const { fromAgentId } = message;
    let delivered = 0;

    for (const [agentId, agent] of this.agentRegistry.entries()) {
      // 不发送给自己
      if (agentId === fromAgentId) {
        continue;
      }

      // 优先级 1: 如果目标 Agent 有本地回调，直接调用
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
        continue;
      }

      // 优先级 2: 如果有 webhook 且可用，异步推送
      if (agent.webhook?.url && this.isWebhookAvailable(agentId)) {
        const broadcastMessage = { ...message, toAgentId: agentId };
        const payload = this.buildPayload(broadcastMessage, agent);
        
        // 异步推送，不阻塞广播
        this.pushToWebhook(agent.webhook.url, payload, agent.webhook.token)
          .then(result => {
            if (result.success) {
              this.resetWebhookFailures(agentId);
              this.logger.debug('Broadcast pushed via webhook', {
                messageId: message.messageId,
                agentId,
                latency: result.latency,
              });
            } else {
              this.recordWebhookFailure(agentId);
              this.logger.warn('Broadcast webhook failed, fallback to queue', {
                agentId,
                error: result.error,
              });
              this.addToQueue(agentId, broadcastMessage);
            }
          })
          .catch(err => {
            this.logger.error('Broadcast webhook error', {
              agentId,
              error: err instanceof Error ? err.message : String(err),
            });
            this.addToQueue(agentId, broadcastMessage);
          });
        
        delivered++;
        continue;
      }

      // 优先级 3: 无回调且无可用 webhook，放入队列
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
  updateRegistry(registry: RegistryLike): void {
    this.agentRegistry = registry;
    // 支持 Map 和 AgentRegistry 两种类型的 size 获取
    const count = registry instanceof Map ? registry.size : registry.size();
    this.logger.info('Agent registry updated', { count });
  }
}