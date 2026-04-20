/**
 * Webhook Pusher
 * Agent 级 Webhook 转发服务
 *
 * RFC 004: Agent 级 Webhook 支持
 * 从 message-router.ts 提取的 webhook 转发功能
 */

import { Logger } from '../utils/logger.js';
import { WebhookService } from './webhook.js';
import type { WebhookConfig } from '../types/index.js';
import type { AgentRegistration } from './agent-registry.js';
import type { RoutableMessage } from './message-router.js';

/**
 * Agent Webhook 通知载荷
 * RFC 004: 用于 Agent 级 webhook 推送
 */
export interface AgentWebhookPayload {
  /** 消息 ID */
  messageId: string;
  /** 发送方 Agent ID */
  fromAgentId: string;
  /** 目标 Agent ID */
  toAgentId: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  type: string;
  /** 创建时间 */
  createdAt: string;
  /** 元数据(可选) */
  metadata?: Record<string, unknown>;
}

/**
 * WebhookPusher 依赖注入接口
 */
export interface WebhookPusherDeps {
  logger: Logger;
}

/**
 * Webhook 转发器
 * 管理 Agent 级 webhook 服务实例缓存和消息转发
 */
export class WebhookPusher {
  private webhookServices: Map<string, WebhookService> = new Map();
  private logger: Logger;

  constructor(deps: WebhookPusherDeps) {
    this.logger = deps.logger;
  }

  /**
   * RFC 004: Agent 级 Webhook 转发
   * 根据 message.toAgentId 查找 Agent 的 webhook URL,转发消息
   *
   * @param message 要转发的消息
   * @param targetAgent 目标 Agent 注册信息
   * @returns 发送结果
   */
  async forwardToAgentWebhook(
    message: RoutableMessage,
    targetAgent: AgentRegistration
  ): Promise<{ success: boolean; error?: string }> {
    if (!targetAgent.webhook?.url) {
      return { success: false, error: 'Agent has no webhook URL configured' };
    }

    // 构造 webhook 载荷
    const payload: AgentWebhookPayload = {
      messageId: message.messageId,
      fromAgentId: message.fromAgentId,
      toAgentId: message.toAgentId || '',
      content: message.content,
      type: message.type,
      createdAt: message.createdAt.toISOString(),
      metadata: message.metadata,
    };

    // 使用缓存或创建 WebhookService 实例
    const webhookService = this.getOrCreateWebhookService(
      targetAgent.agentId,
      {
        url: targetAgent.webhook.url,
        token: targetAgent.webhook.token || targetAgent.agentId,
        timeout: 5000,
        retries: 2,
        retryDelay: 500,
      }
    );

    // 发送消息到 webhook
    try {
      const result = await webhookService.send({
        message: JSON.stringify(payload),
        name: `Agent ${targetAgent.name}`,
        wakeMode: 'now',
        deliver: true,
      });

      if (!result.success) {
        this.logger.warn('Webhook send failed', {
          agentId: targetAgent.agentId,
          error: result.error,
        });
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error('Webhook send exception', {
        agentId: targetAgent.agentId,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 获取或创建 WebhookService 实例
   * 私有方法，管理 webhook 服务缓存
   *
   * @param agentId Agent ID
   * @param config Webhook 配置
   * @returns WebhookService 实例
   */
  private getOrCreateWebhookService(
    agentId: string,
    config: WebhookConfig
  ): WebhookService {
    let webhookService = this.webhookServices.get(agentId);
    if (!webhookService) {
      webhookService = new WebhookService(config);
      this.webhookServices.set(agentId, webhookService);
      this.logger.debug('Webhook service created for Agent', {
        agentId,
        webhookUrl: config.url,
      });
    }
    return webhookService;
  }

  /**
   * RFC 004: 清理 Agent webhook 服务缓存
   * 当 Agent 注销或 webhook 配置变更时调用
   *
   * @param agentId Agent ID
   */
  clearWebhookCache(agentId: string): void {
    if (this.webhookServices.has(agentId)) {
      this.webhookServices.delete(agentId);
      this.logger.debug('Webhook service cache cleared', { agentId });
    }
  }

  /**
   * 清理所有 webhook 服务缓存
   */
  clearAllWebhookCache(): void {
    const count = this.webhookServices.size;
    this.webhookServices.clear();
    if (count > 0) {
      this.logger.debug('All webhook service caches cleared', { count });
    }
  }
}