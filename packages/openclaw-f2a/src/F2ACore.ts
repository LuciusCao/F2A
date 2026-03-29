/**
 * F2A 核心生命周期管理
 * 
 * 负责 F2A 插件的初始化、启用和关闭。
 * 从 connector.ts 拆分（Issue #106），遵循单一职责原则。
 * 
 * @module F2ACore
 */

import { join } from 'path';
import { homedir } from 'os';
import type {
  ApiLogger,
  F2APluginConfig,
  F2ANodeConfig,
  OpenClawPluginApi,
  OpenClawConfig,
  AgentCapability,
} from './types.js';
import { CapabilityDetector } from './capability-detector.js';
import { WebhookServer } from './webhook-server.js';
import { WebhookPusher } from './webhook-pusher.js';
import { ReviewCommittee, F2A } from '@f2a/network';
import {
  mergeConfig,
  generateToken,
  readAgentNameFromIdentity,
  extractErrorMessage,
} from './connector-helpers.js';
import type { F2AComponentRegistry } from './F2AComponentRegistry.js';
import type { WebhookHandler } from './webhook-server.js';

/**
 * 核心生命周期配置
 */
export interface CoreLifecycleConfig {
  /** 插件配置 */
  pluginConfig: F2APluginConfig;
  /** 节点配置 */
  nodeConfig: F2ANodeConfig;
  /** OpenClaw API */
  api?: OpenClawPluginApi;
  /** Logger */
  logger?: ApiLogger;
}

/**
 * 核心生命周期状态
 */
export interface CoreLifecycleState {
  /** 是否已初始化 */
  initialized: boolean;
  /** F2A 实例 */
  f2a?: F2A;
  /** F2A 启动时间 */
  f2aStartTime?: number;
  /** Webhook 服务器 */
  webhookServer?: WebhookServer;
  /** Webhook 推送器 */
  webhookPusher?: WebhookPusher;
  /** 轮询定时器 */
  pollTimer?: NodeJS.Timeout;
  /** 能力列表 */
  capabilities: AgentCapability[];
}

/**
 * 消息回调（用于处理 P2P 消息）
 */
export interface MessageCallback {
  (msg: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }): Promise<void>;
}

/**
 * F2A 核心生命周期管理器
 * 
 * 功能：
 * 1. 初始化配置和基本组件
 * 2. 启动 F2A 实例和 Webhook 服务器
 * 3. 处理清理和关闭
 */
export class F2ACore {
  // ========== 配置 ==========

  private config: F2APluginConfig;
  private nodeConfig: F2ANodeConfig;
  private api?: OpenClawPluginApi;
  private logger?: ApiLogger;

  // ========== 状态 ==========

  private state: CoreLifecycleState = {
    initialized: false,
    capabilities: [],
  };

  // ========== 消息回调 ==========

  private onMessageCallback?: MessageCallback;

  // ========== 组件注册器引用 ==========

  private componentRegistry?: F2AComponentRegistry;

  constructor(config: CoreLifecycleConfig) {
    this.config = config.pluginConfig;
    this.nodeConfig = config.nodeConfig;
    this.api = config.api;
    this.logger = config.logger;
  }

  // ========== 配置访问 ==========

  /**
   * 获取插件配置
   */
  getConfig(): F2APluginConfig {
    return this.config;
  }

  /**
   * 获取节点配置
   */
  getNodeConfig(): F2ANodeConfig {
    return this.nodeConfig;
  }

  /**
   * 获取 OpenClaw API
   */
  getApi(): OpenClawPluginApi | undefined {
    return this.api;
  }

  /**
   * 获取 Logger
   */
  getLogger(): ApiLogger | undefined {
    return this.logger;
  }

  /**
   * 更新 Logger
   */
  updateLogger(logger: ApiLogger | undefined): void {
    this.logger = logger;
  }

  /**
   * 设置组件注册器引用
   */
  setComponentRegistry(registry: F2AComponentRegistry): void {
    this.componentRegistry = registry;
  }

  // ========== 状态访问 ==========

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.state.initialized;
  }

  /**
   * 获取 F2A 实例
   */
  getF2A(): F2A | undefined {
    return this.state.f2a;
  }

  /**
   * 获取 F2A 状态
   */
  getF2AStatus(): { running: boolean; peerId?: string; uptime?: number } {
    if (!this.state.f2a) {
      return { running: false };
    }
    return {
      running: true,
      peerId: this.state.f2a.peerId,
      uptime: this.state.f2aStartTime ? Date.now() - this.state.f2aStartTime : undefined,
    };
  }

  /**
   * 获取能力列表
   */
  getCapabilities(): AgentCapability[] {
    return this.state.capabilities;
  }

  /**
   * 获取 Webhook 服务器 URL
   */
  getWebhookUrl(): string | undefined {
    return this.state.webhookServer?.getUrl();
  }

  // ========== 初始化 ==========

  /**
   * 初始化插件（延迟模式）
   * 
   * 只保存配置，不打开任何资源。
   * TaskQueue/WebhookServer 在首次访问时才初始化。
   */
  async initialize(
    rawConfig: Record<string, unknown> & { _api?: OpenClawPluginApi }
  ): Promise<void> {
    // 保存 OpenClaw logger
    this.logger = rawConfig._api?.logger;
    this.logger?.info('[F2A] 初始化（延迟模式）...');

    // 保存 API 引用
    this.api = rawConfig._api;

    // 合并配置
    this.config = mergeConfig(rawConfig);
    this.nodeConfig = {
      nodePath: this.config.f2aPath || './F2A',
      controlPort: this.config.controlPort || 9001,
      controlToken: this.config.controlToken || generateToken(),
      p2pPort: this.config.p2pPort || 9000,
      enableMDNS: this.config.enableMDNS ?? true,
      bootstrapPeers: this.config.bootstrapPeers || [],
      dataDir: this.config.dataDir,
    };

    // 初始化 Webhook 推送器（如果配置了）
    if (this.config.webhookPush?.enabled !== false && this.config.webhookPush?.url) {
      this.state.webhookPusher = new WebhookPusher(this.config.webhookPush, this.logger);
      this.logger?.info('[F2A] Webhook 推送已配置');
    }

    // 检测能力
    const capabilityDetector = new CapabilityDetector();
    this.state.capabilities = capabilityDetector.getDefaultCapabilities();
    if (this.config.capabilities?.length) {
      this.state.capabilities = capabilityDetector.mergeCustomCapabilities(
        this.state.capabilities,
        this.config.capabilities
      );
    }

    this.logger?.info('[F2A] 初始化完成（延迟模式）');
    this.logger?.info(`[F2A] Agent 名称: ${this.config.agentName}`);
    this.logger?.info(`[F2A] 能力数: ${this.state.capabilities.length}`);
    this.logger?.info('[F2A] 资源将在首次使用时初始化');
  }

  // ========== 启用 ==========

  /**
   * 启用适配器（直接创建 F2A 实例）
   * 
   * @param webhookHandler - Webhook 处理器
   * @param onMessage - P2P 消息回调
   */
  async enable(
    webhookHandler: WebhookHandler,
    onMessage: MessageCallback
  ): Promise<void> {
    if (this.state.initialized) {
      this.logger?.info('[F2A] 适配器已启用，跳过');
      return;
    }

    this.logger?.info('[F2A] 启用适配器（直接管理模式）...');
    this.state.initialized = true;
    this.onMessageCallback = onMessage;

    // 注册清理处理器
    this.registerCleanupHandlers();

    // 创建 F2A 实例
    await this.startF2AInstance();

    // 启动 Webhook 服务器
    await this.startWebhookServer(webhookHandler);

    // 启动兜底轮询
    this.startFallbackPolling();

    if (this.state.f2a) {
      this.logger?.info(`[F2A] P2P 已就绪，Peer ID: ${this.state.f2a.peerId?.slice(0, 20)}...`);
    }
  }

  /**
   * 创建并启动 F2A 实例
   */
  private async startF2AInstance(): Promise<void> {
    try {
      const dataDir = this.getDataDir();

      // 调试日志
      const debugLog = (msg: string) => {
        try {
          const fs = require('fs');
          const logPath = join(homedir(), '.openclaw/logs/f2a-debug.log');
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
        } catch {
          // 静默忽略
        }
        this.logger?.info(msg);
      };

      debugLog(`[F2A] 使用数据目录: ${dataDir}`);

      // 从 IDENTITY.md 读取 agent 名字
      const workspace = (this.api?.config as OpenClawConfig)?.agents?.defaults?.workspace;
      const identityName = readAgentNameFromIdentity(workspace);
      const displayName = identityName || this.config.agentName || 'OpenClaw Agent';

      if (identityName) {
        debugLog(`[F2A] 从 IDENTITY.md 读取 agent 名字: ${identityName}`);
      }

      this.state.f2a = await F2A.create({
        displayName,
        dataDir,
        network: {
          listenPort: this.config.p2pPort || 0,
          bootstrapPeers: this.config.bootstrapPeers || [],
          enableMDNS: this.config.enableMDNS ?? true,
          enableDHT: false,
        },
      });

      // 监听 P2P 消息
      (this.state.f2a as any).on('message', this.onMessageCallback!);

      // 监听其他事件
      this.state.f2a.on('peer:connected', (event: { peerId: string }) => {
        this.logger?.info('[F2A] Peer 连接', { peerId: event.peerId.slice(0, 16) });
      });

      this.state.f2a.on('peer:disconnected', (event: { peerId: string }) => {
        this.logger?.info('[F2A] Peer 断开', { peerId: event.peerId.slice(0, 16) });
      });

      // 启动 F2A（带超时保护）
      const START_TIMEOUT_MS = 10000;
      const startPromise = this.state.f2a.start();
      const timeoutPromise = new Promise<typeof startPromise>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('F2A 启动超时')), START_TIMEOUT_MS);
        timer.unref();
      });

      const result = await Promise.race([startPromise, timeoutPromise]);
      if (!result.success) {
        throw new Error(`F2A 启动失败: ${result.error}`);
      }

      this.logger?.info('[F2A] F2A 实例已启动', {
        peerId: this.state.f2a.peerId?.slice(0, 16),
        multiaddrs: this.state.f2a.agentInfo?.multiaddrs?.length || 0,
      });

      this.state.f2aStartTime = Date.now();

      // 设置组件注册器的 F2A 实例
      if (this.componentRegistry) {
        this.componentRegistry.setF2A(this.state.f2a);
      }
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this.logger?.error(`[F2A] 创建 F2A 实例失败: ${errorMsg}`);
      this.logger?.warn('[F2A] F2A Adapter 将以降级模式运行，P2P 功能不可用');

      // 清理失败的实例
      if (this.state.f2a) {
        try {
          await this.state.f2a.stop();
        } catch {
          this.logger?.debug?.('[F2A] F2A 实例停止失败（清理阶段）');
        }
        this.state.f2a = undefined;
        this.state.f2aStartTime = undefined;
      }
    }
  }

  /**
   * 启动 Webhook 服务器
   */
  private async startWebhookServer(handler: WebhookHandler): Promise<void> {
    try {
      this.state.webhookServer = new WebhookServer(
        this.config.webhookPort || 0,
        handler,
        { logger: this.logger }
      );
      await this.state.webhookServer.start();
      this.logger?.info(`[F2A] Webhook 服务器已启动: ${this.state.webhookServer.getUrl()}`);
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this.logger?.warn(`[F2A] Webhook 服务器启动失败: ${errorMsg}`);
    }
  }

  /**
   * 启动兜底轮询
   */
  private startFallbackPolling(): void {
    const interval = this.config.pollInterval || 60000;

    this.state.pollTimer = setInterval(async () => {
      // 重置超时的 processing 任务
      if (this.componentRegistry) {
        this.resetTimedOutProcessingTasks();
      }

      if (!this.state.webhookPusher || !this.componentRegistry) {
        return;
      }

      try {
        const taskQueue = this.componentRegistry.getTaskQueue();
        const pending = taskQueue.getWebhookPending();

        if (pending.length > 0) {
          this.logger?.info(`[F2A] 兜底轮询: ${pending.length} 个待推送任务`);

          for (const task of pending) {
            const result = await this.state.webhookPusher!.pushTask(task);
            if (result.success) {
              taskQueue.markWebhookPushed(task.taskId);
            }
          }
        }
      } catch (error) {
        this.logger?.error('[F2A] 兜底轮询失败:', error);
      }
    }, interval);

    if (this.state.pollTimer.unref) {
      this.state.pollTimer.unref();
    }
  }

  /**
   * 重置超时的 processing 任务
   */
  private resetTimedOutProcessingTasks(): void {
    if (!this.componentRegistry) return;

    try {
      const taskQueue = this.componentRegistry.getTaskQueue();
      const stats = taskQueue.getStats();
      if (stats.processing === 0) return;

      const allTasks = taskQueue.getAll();
      const now = Date.now();
      const processingTimeout = this.config.processingTimeoutMs || 5 * 60 * 1000;

      for (const task of allTasks) {
        if (task.status === 'processing') {
          const taskTimeout = task.timeout || 30000;
          const maxAllowedTime = Math.max(taskTimeout * 2, processingTimeout);
          const processingTime = now - (task.updatedAt || task.createdAt);

          if (processingTime > maxAllowedTime) {
            this.logger?.warn(
              `[F2A] 检测到僵尸任务 ${task.taskId.slice(0, 8)}... (processing ${Math.round(processingTime / 1000)}s)，重置为 pending`
            );
            taskQueue.resetProcessingTask(task.taskId);
          }
        }
      }
    } catch {
      // 静默忽略
    }
  }

  // ========== 清理和关闭 ==========

  /**
   * 注册清理处理器
   */
  private registerCleanupHandlers(): void {
    const autoCleanup = async () => {
      await this.shutdown();
    };

    process.once('beforeExit', autoCleanup);
    process.once('SIGINT', autoCleanup);
    process.once('SIGTERM', autoCleanup);
  }

  /**
   * 关闭所有资源
   */
  async shutdown(): Promise<void> {
    this.logger?.info('[F2A] 正在关闭...');

    // 停止轮询定时器
    if (this.state.pollTimer) {
      clearInterval(this.state.pollTimer);
      this.state.pollTimer = undefined;
    }

    // 关闭组件注册器
    if (this.componentRegistry) {
      await this.componentRegistry.cleanup();
    }

    // 停止 F2A 实例
    if (this.state.f2a) {
      try {
        await this.state.f2a.stop();
        this.logger?.info('[F2A] F2A 实例已停止');
      } catch (err) {
        this.logger?.warn('[F2A] F2A 实例停止失败', { error: extractErrorMessage(err) });
      }
      this.state.f2a = undefined;
      this.state.f2aStartTime = undefined;
    }

    // 停止 Webhook 服务器
    if (this.state.webhookServer) {
      await this.state.webhookServer.stop?.();
      this.logger?.info('[F2A] Webhook 服务器已停止');
    }

    this.state.initialized = false;
    this.logger?.info('[F2A] 已关闭');
  }

  // ========== 辅助方法 ==========

  /**
   * 获取数据目录
   */
  private getDataDir(): string {
    if (this.config.dataDir) {
      return this.config.dataDir;
    }

    const workspace = (this.api?.config as OpenClawConfig)?.agents?.defaults?.workspace;
    if (workspace) {
      return join(workspace, '.f2a');
    }

    return join(homedir(), '.f2a');
  }

  /**
   * 获取 Webhook 推送器
   */
  getWebhookPusher(): WebhookPusher | undefined {
    return this.state.webhookPusher;
  }

  /**
   * 触发心跳（用于通知 OpenClaw 有新任务）
   */
  requestHeartbeat(): void {
    this.api?.runtime?.system?.requestHeartbeatNow?.();
  }
}

export default F2ACore;