/**
 * F2A Webhook 管理器
 * 
 * 负责管理 Webhook 处理器的创建和配置。
 * 从 connector.ts 拆分（Issue #106），遵循单一职责原则。
 * 
 * @module F2AWebhookManager
 */

import type {
  DiscoverWebhookPayload,
  DelegateWebhookPayload,
  AgentCapability,
  ApiLogger,
  F2APluginConfig,
} from './types.js';
import type { WebhookHandler } from './webhook-server.js';
import type { TaskQueue } from './task-queue.js';
import type { WebhookPusher } from './webhook-pusher.js';
import type { ReputationSystem } from './reputation.js';
import type { OpenClawPluginApi } from './types.js';
import { taskGuard, TaskGuardContext } from './task-guard.js';
import {
  isValidPeerId,
  extractErrorMessage,
  MAX_MESSAGE_LENGTH,
} from './connector-helpers.js';

/**
 * Webhook 管理器依赖
 */
export interface WebhookManagerDeps {
  /** 插件配置 */
  config: F2APluginConfig;
  /** 能力列表 */
  capabilities: AgentCapability[];
  /** Logger */
  logger?: ApiLogger;
  /** 信誉系统 */
  reputationSystem: ReputationSystem;
  /** 任务队列 */
  taskQueue: TaskQueue;
  /** Webhook 推送器（可选） */
  webhookPusher?: WebhookPusher;
  /** OpenClaw API */
  api?: OpenClawPluginApi;
  /** 消息处理函数 */
  invokeOpenClawAgent: (from: string, message: string) => Promise<string | undefined>;
}

/**
 * F2A Webhook 管理器
 * 
 * 功能：
 * 1. 创建和配置 Webhook 处理器
 * 2. 处理 discover、delegate、message、status 等 webhook 事件
 */
export class F2AWebhookManager {
  private deps: WebhookManagerDeps;

  constructor(deps: WebhookManagerDeps) {
    this.deps = deps;
  }

  /**
   * 创建 Webhook 处理器
   */
  createHandler(): WebhookHandler {
    return {
      onDiscover: async (payload: DiscoverWebhookPayload) => {
        return this.handleDiscover(payload);
      },

      onDelegate: async (payload: DelegateWebhookPayload) => {
        return this.handleDelegate(payload);
      },

      onMessage: async (payload: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }) => {
        return this.handleMessage(payload);
      },

      onStatus: async () => {
        return this.handleStatus();
      },
    };
  }

  /**
   * 处理 discover webhook
   */
  private async handleDiscover(payload: DiscoverWebhookPayload) {
    // 检查请求者信誉
    if (!this.deps.reputationSystem.isAllowed(payload.requester)) {
      return {
        capabilities: [],
        reputation: this.deps.reputationSystem.getReputation(payload.requester).score,
      };
    }

    // 过滤能力
    let caps = this.deps.capabilities;
    if (payload.query.capability) {
      caps = caps.filter(
        c => c.name === payload.query.capability || c.tools?.includes(payload.query.capability!)
      );
    }

    return {
      capabilities: caps,
      reputation: this.deps.reputationSystem.getReputation(payload.requester).score,
    };
  }

  /**
   * 处理 delegate webhook
   */
  private async handleDelegate(payload: DelegateWebhookPayload) {
    const { config, logger, reputationSystem, taskQueue, webhookPusher, api } = this.deps;

    // 安全检查
    if (!reputationSystem.isAllowed(payload.from)) {
      return {
        accepted: false,
        taskId: payload.taskId,
        reason: 'Reputation too low',
      };
    }

    // 检查白名单/黑名单
    const whitelist = config.security?.whitelist || [];
    const blacklist = config.security?.blacklist || [];
    const isWhitelisted = whitelist.length > 0 && whitelist.includes(payload.from);
    const isBlacklisted = blacklist.includes(payload.from);

    if (whitelist.length > 0 && !isWhitelisted) {
      return {
        accepted: false,
        taskId: payload.taskId,
        reason: 'Not in whitelist',
      };
    }

    if (isBlacklisted) {
      return {
        accepted: false,
        taskId: payload.taskId,
        reason: 'In blacklist',
      };
    }

    // TaskGuard 安全检查
    const requesterReputation = reputationSystem.getReputation(payload.from);
    const taskGuardContext: Partial<TaskGuardContext> = {
      requesterReputation,
      isWhitelisted,
      isBlacklisted,
      recentTaskCount: 0,
    };

    const taskGuardReport = taskGuard.check(payload, taskGuardContext);

    if (!taskGuardReport.passed) {
      const blockReasons = taskGuardReport.blocks.map(b => b.message).join('; ');
      logger?.warn(`[F2A] TaskGuard 阻止任务 ${payload.taskId}: ${blockReasons}`);
      return {
        accepted: false,
        taskId: payload.taskId,
        reason: `TaskGuard blocked: ${blockReasons}`,
      };
    }

    if (taskGuardReport.requiresConfirmation) {
      const warnReasons = taskGuardReport.warnings.map(w => w.message).join('; ');
      logger?.warn(`[F2A] TaskGuard 警告 ${payload.taskId}: ${warnReasons}`);
    }

    // 检查队列是否已满
    const stats = taskQueue.getStats();
    if (stats.pending >= (config.maxQueuedTasks || 100)) {
      return {
        accepted: false,
        taskId: payload.taskId,
        reason: 'Task queue is full',
      };
    }

    // 添加任务到队列
    try {
      const task = taskQueue.add(payload);

      // 优先使用 webhook 推送
      if (webhookPusher) {
        const result = await webhookPusher.pushTask(task);
        if (result.success) {
          taskQueue.markWebhookPushed(task.taskId);
          logger?.info(`[F2A] 任务 ${task.taskId} 已通过 webhook 推送 (${result.latency}ms)`);
        } else {
          logger?.info(`[F2A] Webhook 推送失败: ${result.error}，任务将在轮询时处理`);
        }
      }

      // 触发 OpenClaw 心跳
      api?.runtime?.system?.requestHeartbeatNow?.();

      return {
        accepted: true,
        taskId: payload.taskId,
      };
    } catch (error) {
      return {
        accepted: false,
        taskId: payload.taskId,
        reason: error instanceof Error ? error.message : 'Failed to queue task',
      };
    }
  }

  /**
   * 处理 message webhook
   */
  private async handleMessage(payload: {
    from: string;
    content: string;
    metadata?: Record<string, unknown>;
    messageId: string;
  }) {
    const { logger, invokeOpenClawAgent } = this.deps;

    // 验证 PeerID 格式
    if (!isValidPeerId(payload.from)) {
      logger?.warn(`[F2A] onMessage: 拒绝来自无效 PeerID 的消息: ${String(payload.from).slice(0, 20)}`);
      return { response: 'Invalid sender' };
    }

    // 检查消息长度限制
    if (payload.content && payload.content.length > MAX_MESSAGE_LENGTH) {
      logger?.warn(`[F2A] onMessage: 消息过长 (${payload.content.length} bytes)，拒绝处理`);
      return { response: 'Message too long' };
    }

    logger?.info('[F2A] 收到 P2P 消息', {
      from: payload.from.slice(0, 16),
      content: payload.content.slice(0, 50),
    });

    try {
      // 构造消息
      const message = `[来自 ${payload.metadata?.from || payload.from.slice(0, 16)}] ${payload.content}`;

      // 调用消息处理函数
      const result = await invokeOpenClawAgent(payload.from, message);

      return { response: result || '收到消息，但我暂时无法生成回复。' };
    } catch (error) {
      logger?.error('[F2A] 处理消息失败', { error: extractErrorMessage(error) });
      return { response: '抱歉，我遇到了一些问题，无法处理你的消息。' };
    }
  }

  /**
   * 处理 status webhook
   */
  private async handleStatus() {
    const stats = this.deps.taskQueue.getStats();
    return {
      status: 'available',
      load: stats.pending + stats.processing,
      queued: stats.pending,
      processing: stats.processing,
    };
  }

  /**
   * 更新依赖（用于运行时更新）
   */
  updateDeps(deps: Partial<WebhookManagerDeps>): void {
    if (deps.config) this.deps.config = deps.config;
    if (deps.capabilities) this.deps.capabilities = deps.capabilities;
    if (deps.logger) this.deps.logger = deps.logger;
    if (deps.reputationSystem) this.deps.reputationSystem = deps.reputationSystem;
    if (deps.taskQueue) this.deps.taskQueue = deps.taskQueue;
    if (deps.webhookPusher) this.deps.webhookPusher = deps.webhookPusher;
    if (deps.api) this.deps.api = deps.api;
    if (deps.invokeOpenClawAgent) this.deps.invokeOpenClawAgent = deps.invokeOpenClawAgent;
  }

  /**
   * 更新能力列表
   */
  updateCapabilities(capabilities: AgentCapability[]): void {
    this.deps.capabilities = capabilities;
  }

  /**
   * 更新配置
   */
  updateConfig(config: F2APluginConfig): void {
    this.deps.config = config;
  }
}

export default F2AWebhookManager;