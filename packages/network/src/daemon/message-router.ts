/**
 * Message Router
 * 处理 Daemon 内部 Agent 之间的消息路由
 */

import { Logger } from '../utils/logger.js';
import { AgentRegistry, type AgentRegistration, type MessageSignaturePayload, type AgentWebhook } from './agent-registry.js';
import { request, RequestOptions } from 'https';
import { request as httpRequest } from 'http';

/**
 * 路由消息类型
 */
export interface RoutableMessage {
  /** 消息 ID */
  messageId: string;
  /** 发送方 Agent ID */
  fromAgentId: string;
  /** 目标 Agent ID(可选,不指定则广播) */
  toAgentId?: string;
  /** 消息内容 */
  content: string;
  /** 消息元数据 */
  metadata?: Record<string, unknown>;
  /** 消息类型 */
  type: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  /** 创建时间 */
  createdAt: Date;
  /** 消息签名(用于验证发送方身份,base64) */
  signature?: string;
  /** 签名载荷(签名覆盖的内容,用于验证) */
  signedPayload?: string;
}

/**
 * RFC 004: Webhook 推送结果
 */
export interface WebhookPushResult {
  /** 是否成功 */
  success: boolean;
  /** HTTP 状态码 */
  statusCode?: number;
  /** 错误信息 */
  error?: string;
  /** 是否降级到队列 */
  degraded?: boolean;
}

/**
 * 签名载荷序列化格式版本
 */
export const SIGNATURE_PAYLOAD_VERSION = 'v1';

/**
 * RoutableMessage 签名载荷工具类
 * 提供签名载荷的序列化和验证方法
 */
export class RoutableMessageSignature {
  /**
   * 序列化消息用于签名
   * 签名覆盖:messageId + fromAgentId + content + createdAt
   *
   * 格式:SIGNATURE_PAYLOAD_VERSION:messageId:fromAgentId:content:createdAtTimestamp
   *
   * @param msg - 消息对象
   * @returns 序列化后的字符串,用于签名
   */
  static serializeForSignature(msg: RoutableMessage): string {
    const timestamp = msg.createdAt instanceof Date
      ? msg.createdAt.getTime()
      : new Date(msg.createdAt).getTime();

    // 使用稳定的 JSON 序列化(排序键)来避免序列化不一致
    const stableContent = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);

    return `${SIGNATURE_PAYLOAD_VERSION}:${msg.messageId}:${msg.fromAgentId}:${stableContent}:${timestamp}`;
  }

  /**
   * 验证签名载荷与消息内容是否匹配
   * 防止签名与消息内容不一致的攻击
   *
   * @param msg - 消息对象
   * @param signedPayload - 签名载荷字符串
   * @returns 是否匹配
   */
  static verifyPayloadMatch(msg: RoutableMessage, signedPayload: string): boolean {
    const expectedPayload = RoutableMessageSignature.serializeForSignature(msg);
    return expectedPayload === signedPayload;
  }

  /**
   * 解析签名载荷,提取各字段
   * 用于日志记录和调试
   *
   * @param signedPayload - 签名载荷字符串
   * @returns 解析后的字段对象或 null(格式无效)
   */
  static parsePayload(signedPayload: string): {
    version: string;
    messageId: string;
    fromAgentId: string;
    content: string;
    timestamp: number;
  } | null {
    const parts = signedPayload.split(':');
    if (parts.length !== 5) {
      return null;
    }

    const [version, messageId, fromAgentId, content, timestampStr] = parts;
    const timestamp = parseInt(timestampStr, 10);

    if (version !== SIGNATURE_PAYLOAD_VERSION || isNaN(timestamp)) {
      return null;
    }

    return {
      version,
      messageId,
      fromAgentId,
      content,
      timestamp,
    };
  }

  /**
   * 计算签名载荷哈希(用于日志记录,不暴露原始内容)
   *
   * @param signedPayload - 签名载荷字符串
   * @returns SHA256 哈希(前16位)
   */
  static hashPayload(signedPayload: string): string {
    // 使用简单的哈希替代,避免引入 crypto 模块
    // 生成一个短的标识符用于日志
    let hash = 0;
    for (let i = 0; i < signedPayload.length; i++) {
      const char = signedPayload.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }
}

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
 * 消息路由器
 * 管理 Agent 之间的消息路由和队列
 */
export class MessageRouter {
  private queues: Map<string, MessageQueue> = new Map();
  private agentRegistryMap: Map<string, AgentRegistration>; // 保持向后兼容
  private agentRegistryInstance?: AgentRegistry; // AgentRegistry 实例,用于签名验证
  private logger: Logger;
  private defaultMaxQueueSize: number = 100;

  constructor(agentRegistry: Map<string, AgentRegistration>, options?: {
    maxQueueSize?: number;
  }) {
    this.agentRegistryMap = agentRegistry;
    this.logger = new Logger({ component: 'MessageRouter' });
    this.defaultMaxQueueSize = options?.maxQueueSize || 100;
  }

  /**
   * 设置 AgentRegistry 实例(用于签名验证)
   */
  setAgentRegistry(instance: AgentRegistry): void {
    this.agentRegistryInstance = instance;
    this.logger.info('AgentRegistry instance set for signature verification');
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
   * P0 Bug1 修复: 使用真正的 Ed25519 签名验证
   */
  async route(message: RoutableMessage): Promise<boolean> {
    const { toAgentId, fromAgentId, signature, signedPayload } = message;

    // 1. 验证发送方签名(如果有 AgentRegistry 实例)
    if (this.agentRegistryInstance && signature) {
      // 构造消息签名载荷
      const messagePayload: MessageSignaturePayload = {
        messageId: message.messageId,
        fromAgentId: fromAgentId,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt.toISOString()
      };

      // P0 Bug2 修复: 验证 signedPayload 与消息内容匹配
      // 如果消息携带了 signedPayload,必须验证它是否与消息实际内容一致
      // 防止签名载荷与消息内容不一致的攻击
      if (signedPayload) {
        const expectedPayload = AgentRegistry.serializeMessagePayloadForSignature(messagePayload);
        if (expectedPayload !== signedPayload) {
          this.logger.warn('SignedPayload mismatch with message content', {
            fromAgentId,
            messageId: message.messageId,
            reason: 'signedPayload does not match actual message fields',
          });
          return false;
        }
        this.logger.debug('SignedPayload verified', {
          fromAgentId,
          messageId: message.messageId,
        });
      }

      // P0 Bug1 修复: 使用真实的 Ed25519 签名验证
      const isValidSignature = await this.agentRegistryInstance.verifyMessageSignature(
        fromAgentId,
        messagePayload,
        signature
      );

      if (!isValidSignature) {
        this.logger.warn('Invalid signature, message rejected', {
          fromAgentId,
          messageId: message.messageId,
          reason: 'Ed25519 signature verification failed - signature does not match message content',
        });
        return false;
      }

      this.logger.debug('Message signature verified via Ed25519', {
        fromAgentId,
        messageId: message.messageId,
      });
    } else if (this.agentRegistryInstance) {
      // 有 AgentRegistry 实例但没有签名
      this.logger.warn('Message missing signature, rejected', {
        fromAgentId,
        messageId: message.messageId,
        reason: 'signature required for Ed25519 verification',
      });
      return false;
    } else {
      // 没有 AgentRegistry 实例时,记录警告但继续处理(向后兼容)
      this.logger.debug('Signature verification skipped (no AgentRegistry instance)', {
        fromAgentId,
        messageId: message.messageId,
      });
    }

    // 2. 验证发送方已注册
    if (!this.agentRegistryMap.has(fromAgentId)) {
      this.logger.warn('Sender agent not registered', { fromAgentId });
      return false;
    }

    // 3. 如果指定了目标 Agent,路由到该 Agent
    if (toAgentId) {
      const queue = this.queues.get(toAgentId);
      if (!queue) {
        this.logger.warn('Target agent queue not found', { toAgentId });
        return false;
      }

      // 检查队列大小,防止溢出
      if (queue.messages.length >= queue.maxSize) {
        // 移除最旧的消息
        queue.messages.shift();
        this.logger.warn('Queue overflow, removed oldest message', { toAgentId });
      }

      queue.messages.push(message);
      this.logger.debug('Message routed to agent', {
        messageId: message.messageId,
        toAgentId,
        fromAgentId,
      });
      return true;
    }

    // 4. 如果未指定目标 Agent,广播给所有 Agent(除了发送方)
    return this.broadcast(message);
  }

  /**
   * 异步路由消息(Webhook 优先级)
   * RFC 004: Agent 级 Webhook 支持
   *
   * 路由逻辑:
   * 1. 如果目标 Agent 配置了 webhook,优先尝试 forwardToAgentWebhook
   * 2. Webhook 失败时,降级到队列
   * 3. 未指定目标时,广播给所有 Agent
   *
   * @param message - 要路由的消息
   * @returns Promise<boolean> 路由是否成功
   */
  async routeAsync(message: RoutableMessage): Promise<boolean> {
    const { toAgentId, fromAgentId } = message;

    // 1. 验证发送方已注册
    if (!this.agentRegistryMap.has(fromAgentId)) {
      this.logger.warn('Sender agent not registered', { fromAgentId });
      return false;
    }

    // 2. 如果指定了目标 Agent
    if (toAgentId) {
      const targetAgent = this.agentRegistryInstance?.get(toAgentId);

      // 检查目标 Agent 是否有 webhook 配置
      if (targetAgent?.webhook) {
        // 优先尝试 webhook 推送
        const webhookResult = await this.forwardToAgentWebhook(toAgentId, message, targetAgent.webhook);

        if (webhookResult.success) {
          this.logger.info('Message delivered via webhook', {
            messageId: message.messageId,
            toAgentId,
            fromAgentId,
          });
          return true;
        }

        // Webhook 失败,降级到队列
        this.logger.warn('Webhook delivery failed, falling back to queue', {
          messageId: message.messageId,
          toAgentId,
          error: webhookResult.error,
        });
      }

      // 降级到队列路由
      const queue = this.queues.get(toAgentId);
      if (!queue) {
        this.logger.warn('Target agent queue not found', { toAgentId });
        return false;
      }

      // 检查队列大小,防止溢出
      if (queue.messages.length >= queue.maxSize) {
        queue.messages.shift();
        this.logger.warn('Queue overflow, removed oldest message', { toAgentId });
      }

      queue.messages.push(message);
      this.logger.debug('Message routed to queue (fallback)', {
        messageId: message.messageId,
        toAgentId,
        fromAgentId,
      });
      return true;
    }

    // 3. 如果未指定目标 Agent,广播给所有 Agent(除了发送方)
    return this.broadcast(message);
  }

  /** 
   * 延迟函数 
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms)); 
  }

  /**
   * 广播消息给所有 Agent
   */
  broadcast(message: RoutableMessage): boolean {
    const { fromAgentId } = message;
    let delivered = 0;

    for (const [agentId, queue] of this.queues.entries()) {
      // 不发送给自己
      if (agentId === fromAgentId) {
        continue;
      }

      // 检查队列大小
      if (queue.messages.length >= queue.maxSize) {
        queue.messages.shift();
        this.logger.warn('Queue overflow during broadcast', { agentId });
      }

      queue.messages.push({
        ...message,
        toAgentId: agentId, // 设置目标
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
   * 清除 Agent 的消息(确认已处理)
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
   * 清理过期的消息(超过指定时间)
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
   * 更新 Agent 注册表 Map(向后兼容)
   * 公开方法,允许外部更新注册表引用
   */
  updateRegistry(registry: Map<string, AgentRegistration>): void {
    this.agentRegistryMap = registry;
    this.logger.info('Agent registry updated', { count: registry.size });
  }

  /**
   * RFC 004: 推送消息到 Agent 的 Webhook URL
   * 如果推送失败,降级到消息队列
   *
   * @param agentId - 目标 Agent ID
   * @param message - 要推送的消息
   * @param webhook - Agent 的 webhook 配置
   * @returns 推送结果
   */
  async forwardToAgentWebhook(
    agentId: string,
    message: RoutableMessage,
    webhook: AgentWebhook
  ): Promise<WebhookPushResult> {
    // 1. 检查 webhook URL 是否有效
    if (!webhook.url || webhook.url.trim() === '') {
      this.logger.warn('Webhook URL is empty, degrading to queue', { agentId, messageId: message.messageId });
      return this.degradeToQueue(agentId, message, 'Webhook URL is empty');
    }

    // 2. 构造推送载荷
    const payload = JSON.stringify({
      messageId: message.messageId,
      fromAgentId: message.fromAgentId,
      toAgentId: agentId,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt.toISOString(),
      metadata: message.metadata || {}
    });

    // 3. 尝试推送
    const timeout = webhook.timeout || 5000;
    const retries = webhook.retries || 3;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this.sendWebhookRequest(webhook.url, payload, webhook.token, timeout);
        if (result.success) {
          this.logger.info('Webhook push successful', { agentId, messageId: message.messageId, attempt });
          return { success: true, statusCode: result.statusCode };
        }
        this.logger.warn('Webhook push failed', { agentId, messageId: message.messageId, attempt, statusCode: result.statusCode, error: result.error });
        if (attempt < retries) {
          await this.delay(1000); // 重试间隔
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error('Webhook push error', { agentId, messageId: message.messageId, attempt, error: errorMessage });
        if (attempt < retries) {
          await this.delay(1000);
        }
      }
    }

    // 4. 推送失败,降级到队列
    return this.degradeToQueue(agentId, message, `Webhook push failed after ${retries} retries`);
  }

  /**
   * 发送 HTTP webhook 请求
   */
  private async sendWebhookRequest(
    url: string,
    payload: string,
    token?: string,
    timeout?: number
  ): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    return new Promise((resolve) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? request : httpRequest;

      const options: RequestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        timeout: timeout || 5000
      };

      const req = client(url, options, (res) => {
        if (res.statusCode === 200 || res.statusCode === 202) {
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          resolve({ success: false, statusCode: res.statusCode, error: `HTTP ${res.statusCode}` });
        }
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Timeout' });
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * RFC 004: 降级到消息队列
   * 当 webhook 推送失败时,将消息放入队列
   *
   * @param agentId - 目标 Agent ID
   * @param message - 要入队的消息
   * @param reason - 降级原因
   * @returns 降级结果
   */
  private degradeToQueue(agentId: string, message: RoutableMessage, reason: string): WebhookPushResult {
    const queue = this.queues.get(agentId);

    if (!queue) {
      // 队列不存在,创建一个临时队列
      this.logger.warn('Queue not found, creating temporary queue', { agentId });
      this.createQueue(agentId);
    }

    const targetQueue = this.queues.get(agentId);
    if (!targetQueue) {
      this.logger.error('Failed to create queue', { agentId });
      return { success: false, error: reason, degraded: false };
    }

    // 检查队列容量
    if (targetQueue.messages.length >= targetQueue.maxSize) {
      // 队列已满,移除最旧的消息
      targetQueue.messages.shift();
      this.logger.warn('Queue overflow during degradation', { agentId, maxSize: targetQueue.maxSize });
    }

    // 入队消息
    targetQueue.messages.push({ ...message, toAgentId: agentId });
    this.logger.info('Message degraded to queue', { agentId, messageId: message.messageId, reason, queueSize: targetQueue.messages.length });

    return { success: false, error: reason, degraded: true };
  }

  /**
   * RFC 004: 路由消息到 Agent(优先使用 Webhook)
   * 如果 Agent 配置了 webhook,先尝试推送;失败则降级到队列
   *
   * @param agentId - 目标 Agent ID
   * @param message - 要路由的消息
   * @returns 路由结果
   */
  async routeToAgent(agentId: string, message: RoutableMessage): Promise<WebhookPushResult> {
    // 1. 获取 Agent 信息
    const agent = this.agentRegistryMap.get(agentId);
    if (!agent) {
      this.logger.warn('Agent not found', { agentId });
      return { success: false, error: 'Agent not registered' };
    }

    // 2. 如果 Agent 配置了 webhook,尝试推送
    if (agent.webhook && agent.webhook.url) {
      return this.forwardToAgentWebhook(agentId, message, agent.webhook);
    }

    // 3. 没有 webhook,直接入队
    const queue = this.queues.get(agentId);
    if (!queue) {
      this.logger.warn('Queue not found', { agentId });
      return { success: false, error: 'Queue not found' };
    }

    // 检查队列容量
    if (queue.messages.length >= queue.maxSize) {
      queue.messages.shift();
      this.logger.warn('Queue overflow', { agentId });
    }

    queue.messages.push({ ...message, toAgentId: agentId });
    this.logger.debug('Message routed to queue', { agentId, messageId: message.messageId });

    return { success: true, degraded: false };
  }

  /**
   * RFC 004: 检查 Agent webhook 是否可用
   * 用于降级恢复机制
   *
   * @param agentId - Agent ID
   * @returns webhook 是否可用
   */
  isWebhookAvailable(agentId: string): boolean {
    const agent = this.agentRegistryMap.get(agentId);
    if (!agent || !agent.webhook || !agent.webhook.url) {
      return false;
    }
    return true;
  }

  /**
   * RFC 004: 尝试恢复 webhook 推送
   * 从队列中取出消息,尝试通过 webhook 推送
   *
   * @param agentId - Agent ID
   * @returns 恢复结果
   */
  async recoverFromQueue(agentId: string): Promise<{ recovered: number; failed: number }> {
    const agent = this.agentRegistryMap.get(agentId);
    if (!agent || !agent.webhook || !agent.webhook.url) {
      return { recovered: 0, failed: 0 };
    }

    const queue = this.queues.get(agentId);
    if (!queue || queue.messages.length === 0) {
      return { recovered: 0, failed: 0 };
    }

    let recovered = 0;
    let failed = 0;

    // 尝试推送队列中的消息(最多 10 条)
    const messagesToRecover = queue.messages.slice(0, 10);
    for (const message of messagesToRecover) {
      const result = await this.forwardToAgentWebhook(agentId, message, agent.webhook);
      if (result.success) {
        // 成功,从队列移除
        queue.messages = queue.messages.filter(m => m.messageId !== message.messageId);
        recovered++;
      } else {
        failed++;
      }
    }

    this.logger.info('Recovery attempt completed', { agentId, recovered, failed, remaining: queue.messages.length });
    return { recovered, failed };
  }

} 