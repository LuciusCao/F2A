/**
 * F2A 核心生命周期管理
 *
 * 负责 F2A 插件的初始化、启用和关闭。
 * 从 connector.ts 拆分(Issue #106),遵循单一职责原则。
 *
 * Phase 3 扩展:支持 Daemon 模式
 * - embedded: 直接创建 F2A 实例(默认)
 * - daemon: 通过 F2AClient 连接到独立 Daemon
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
import { F2AClient, F2AClientConfig } from './f2a-client.js';
import {
  mergeConfig,
  generateToken,
  readAgentNameFromIdentity,
  extractErrorMessage,
} from './connector-helpers.js';
import type { F2AComponentRegistry } from './F2AComponentRegistry.js';
import type { WebhookHandler } from './webhook-server.js';

/**
 * 运行模式
 */
export type F2ARunMode = 'embedded' | 'daemon';

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
  /** F2A 实例 (embedded 模式) */
  f2a?: F2A;
  /** F2A 客户端 (daemon 模式) */
  f2aClient?: F2AClient;
  /** ControlServer (embedded 模式) */
  controlServer?: any;
  /** 运行模式 */
  runMode: F2ARunMode;
  /** F2A 启动时间 */
  f2aStartTime?: number;
  /** 复用的 peerId (热重启场景) */
  peerId?: string;
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
 * 消息回调(用于处理 P2P 消息)
 */
export interface MessageCallback {
  (msg: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }): Promise<void>;
}

/**
 * F2A 核心生命周期管理器
 *
 * 功能:
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
    runMode: 'embedded',
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
   * 获取 F2A 客户端(daemon 模式)
   */
  getF2AClient(): F2AClient | undefined {
    return this.state.f2aClient;
  }

  /**
   * 获取运行模式
   */
  getRunMode(): F2ARunMode {
    return this.state.runMode;
  }

  /**
   * 是否为 Daemon 模式
   */
  isDaemonMode(): boolean {
    return this.state.runMode === 'daemon';
  }

  /**
   * 获取 F2A 状态
   */
  getF2AStatus(): { running: boolean; peerId?: string; uptime?: number; mode: F2ARunMode } {
    // Daemon 模式
    if (this.state.f2aClient) {
      return {
        running: this.state.f2aClient.isRegistered(),
        mode: 'daemon',
        uptime: this.state.f2aStartTime ? Date.now() - this.state.f2aStartTime : undefined,
      };
    }

    // Embedded 模式 - 检查内存中的实例
    if (this.state.f2a) {
      return {
        running: true,
        peerId: this.state.f2a.peerId,
        uptime: this.state.f2aStartTime ? Date.now() - this.state.f2aStartTime : undefined,
        mode: 'embedded',
      };
    }

    // 热重启复用场景:state.peerId 已设置但 state.f2a 为空
    if (this.state.peerId) {
      return {
        running: true,
        peerId: this.state.peerId,
        uptime: this.state.f2aStartTime ? Date.now() - this.state.f2aStartTime : undefined,
        mode: 'embedded',
      };
    }

    return { running: false, mode: 'embedded' };
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
   * 初始化插件(延迟模式)
   *
   * 只保存配置,不打开任何资源。
   * TaskQueue/WebhookServer 在首次访问时才初始化。
   */
  async initialize(
    rawConfig: Record<string, unknown> & { _api?: OpenClawPluginApi }
  ): Promise<void> {
    // 保存 OpenClaw logger
    this.logger = rawConfig._api?.logger;
    this.logger?.info('[F2A] 初始化(延迟模式)...');

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

    // 初始化 Webhook 推送器(如果配置了)
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

    this.logger?.info('[F2A] 初始化完成(延迟模式)');
    this.logger?.info('[F2A] Agent 名称', { agentName: this.config.agentName });
    this.logger?.info('[F2A] 能力数', { count: this.state.capabilities.length });
    this.logger?.info('[F2A] 资源将在首次使用时初始化');
  }

  // ========== 启用 ==========

  /**
   * 启用适配器
   *
   * 根据配置选择运行模式:
   * - embedded: 直接创建 F2A 实例(默认)
   * - daemon: 通过 F2AClient 连接到独立 Daemon
   *
   * @param webhookHandler - Webhook 处理器
   * @param onMessage - P2P 消息回调
   */
  async enable(
    webhookHandler: WebhookHandler,
    onMessage: MessageCallback
  ): Promise<void> {
    if (this.state.initialized) {
      this.logger?.info('[F2A] 适配器已启用,跳过');
      return;
    }

    // 检测端口是否已被占用(热重启后旧实例残留或后台服务已启动)
    const webhookPort = this.config.webhookPort || 9002;
    const p2pPort = this.config.p2pPort || 9000;
    const portsInUse = await this.checkPortsInUse(webhookPort, p2pPort);

    if (portsInUse.length > 0) {
      // 端口被占用,可能是:
      // 1. 后台服务已启动 F2A(Daemon 模式)
      // 2. 热重启后旧实例残留(同一个 Gateway 进程)
      this.logger?.info('[F2A] 检测到端口已被占用,尝试获取实际 peerId', {
        ports: portsInUse
      });

      // 尝试从 control server 获取实际 peerId
      const actualPeerId = await this.tryGetActualPeerId(p2pPort);

      if (actualPeerId) {
        // 成功获取实际 peerId,说明 F2A 完整运行中,直接复用
        this.state.initialized = true;
        this.state.runMode = 'embedded';
        this.state.peerId = actualPeerId;
        this.state.f2aStartTime = Date.now();
        this.logger?.info('[F2A] 成功获取实际 peerId,复用现有实例', { peerId: actualPeerId.slice(0, 20) });
        return;
      }

      // 无法获取实际 peerId,说明旧实例不完整,需要杀掉并重新启动
      this.logger?.warn('[F2A] 无法获取实际 peerId,旧实例不完整,强制杀掉');

      // 强制杀掉占用端口的进程
      await this.killProcessOnPort(p2pPort);

      // 等待端口释放
      await this.waitForPortRelease(p2pPort, 5000);

      this.logger?.info('[F2A] 旧实例已清理,将继续正常启动流程');
      // 继续执行下面的正常启动流程
    }

    this.onMessageCallback = onMessage;

    // 确定运行模式
    const runMode = this.determineRunMode();
    this.state.runMode = runMode;

    this.logger?.info('[F2A] 启用适配器', { mode: runMode });
    this.state.initialized = true;

    // 注册清理处理器
    this.registerCleanupHandlers();

    if (runMode === 'daemon') {
      // Daemon 模式:使用 F2AClient
      await this.startDaemonMode(webhookHandler);
    } else {
      // Embedded 模式:直接创建 F2A 实例
      await this.startEmbeddedMode(webhookHandler);
    }

    // 启动兜底轮询
    this.startFallbackPolling();

    if (this.state.f2a || this.state.f2aClient) {
      const peerId = this.state.f2a?.peerId || 'daemon-client';
      this.logger?.info('[F2A] P2P 已就绪', { peerId: peerId?.slice(0, 20) + '...' });
    }
  }

  /**
   * 确定运行模式
   */
  private determineRunMode(): F2ARunMode {
    // 检查配置中的 mode 字段
    const mode = (this.config as any).mode;
    if (mode === 'daemon') {
      return 'daemon';
    }

    // 检查是否配置了 daemonUrl
    if ((this.config as any).daemonUrl) {
      return 'daemon';
    }

    // 默认使用 embedded 模式
    return 'embedded';
  }

  /**
   * 启动 Daemon 模式
   */
  private async startDaemonMode(webhookHandler: WebhookHandler): Promise<void> {
    try {
      const daemonUrl = (this.config as any).daemonUrl || 'http://localhost:7788';
      const agentId = (this.config as any).agentId || 'main';

      // 从 IDENTITY.md 读取 agent 名字
      const workspace = (this.api?.config as OpenClawConfig)?.agents?.defaults?.workspace;
      const identityName = readAgentNameFromIdentity(workspace);
      const agentName = identityName || this.config.agentName || 'OpenClaw Agent';

      const clientConfig: F2AClientConfig = {
        daemonUrl,
        agentId,
        agentName,
        capabilities: this.state.capabilities,
        webhookUrl: this.state.webhookServer?.getUrl(),
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
      };

      this.state.f2aClient = new F2AClient(clientConfig);

      // 检查 Daemon 是否可用
      const healthOk = await this.state.f2aClient.checkHealth();
      if (!healthOk) {
        this.logger?.warn('[F2A] Daemon 不可用,尝试启动本地 Daemon...');

        // 尝试启动本地 Daemon
        const started = await this.tryStartLocalDaemon();
        if (!started) {
          throw new Error('Daemon 不可用且无法启动');
        }

        // 再次检查健康状态
        const retryOk = await this.state.f2aClient.checkHealth();
        if (!retryOk) {
          throw new Error('Daemon 启动后仍不可用');
        }
      }

      // 注册 Agent 到 Daemon
      const registerResult = await this.state.f2aClient.registerAgent();
      if (!registerResult.success) {
        throw new Error(`Agent 注册失败: ${registerResult.error}`);
      }

      // 启动消息轮询(从 Daemon 获取消息)
      this.startDaemonMessagePolling();

      // 启动 Webhook 服务器
      await this.startWebhookServer(webhookHandler);

      this.state.f2aStartTime = Date.now();

      this.logger?.info('[F2A] Daemon 模式已启用', {
        daemonUrl,
        agentId,
        agentName,
      });
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this.logger?.error('[F2A] Daemon 模式启动失败', { error: errorMsg });
      this.logger?.warn('[F2A] F2A Plugin 将以降级模式运行,P2P 功能不可用');

      // 清理失败的客户端
      if (this.state.f2aClient) {
        await this.state.f2aClient.close();
        this.state.f2aClient = undefined;
      }
    }
  }

  /**
   * 尝试启动本地 Daemon
   */
  private async tryStartLocalDaemon(): Promise<boolean> {
    try {
      const { spawn } = await import('child_process');

      return new Promise((resolve) => {
        this.logger?.info('[F2A] 尝试启动本地 F2A Daemon...');

        const child = spawn('f2a', ['daemon', 'start'], {
          detached: true,
          stdio: 'ignore',
        });

        child.on('error', (err) => {
          this.logger?.warn('[F2A] 启动 Daemon 失败', { error: err.message });
          resolve(false);
        });

        child.on('spawn', () => {
          this.logger?.info('[F2A] Daemon 启动命令已发送');
          child.unref();

          // 等待 Daemon 就绪
          setTimeout(async () => {
            if (this.state.f2aClient) {
              const ok = await this.state.f2aClient.checkHealth();
              resolve(ok);
            } else {
              resolve(false);
            }
          }, 3000);
        });
      });
    } catch (err) {
      this.logger?.warn('[F2A] 无法启动 Daemon', { error: extractErrorMessage(err) });
      return false;
    }
  }

  /**
   * 启动 Daemon 消息轮询
   */
  private startDaemonMessagePolling(): void {
    const pollInterval = 1000; // 1 秒轮询一次

    const pollTimer = setInterval(async () => {
      if (!this.state.f2aClient || !this.onMessageCallback) {
        return;
      }

      try {
        const result = await this.state.f2aClient.getMessages(10);

        if (result.success && result.data?.messages && result.data.messages.length > 0) {
          for (const msg of result.data.messages) {
            // 调用消息回调
            await this.onMessageCallback({
              from: msg.fromAgentId,
              content: msg.content,
              metadata: msg.metadata,
              messageId: msg.messageId,
            });
          }

          // 清除已处理的消息
          const messageIds = result.data.messages.map(m => m.messageId);
          await this.state.f2aClient.clearMessages(messageIds);
        }
      } catch (err) {
        this.logger?.debug?.('[F2A] 消息轮询错误', { error: extractErrorMessage(err) });
      }
    }, pollInterval);

    if (pollTimer.unref) {
      pollTimer.unref();
    }

    // 保存定时器引用以便清理
    (this.state as any).daemonPollTimer = pollTimer;
  }

  /**
   * 启动 Embedded 模式
   */
  private async startEmbeddedMode(webhookHandler: WebhookHandler): Promise<void> {
    this.logger?.info('[F2A] 启用适配器(直接管理模式)...');

    // 创建 F2A 实例
    await this.startF2AInstance();

    // 启动 Webhook 服务器
    await this.startWebhookServer(webhookHandler);
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

      // 启动 ControlServer（用于热重启时获取实际 peerId）
      try {
        const { ControlServer } = await import('@f2a/network');
        const controlPort = this.config.controlPort || 9001;
        const controlServer = new ControlServer(this.state.f2a!, controlPort, undefined, { dataDir: this.getDataDir() });
        await controlServer.start();
        this.state.controlServer = controlServer as any;
        this.logger?.info('[F2A] ControlServer 已启动', { controlPort });
      } catch (err) {
        this.logger?.warn('[F2A] ControlServer 启动失败', { error: extractErrorMessage(err) });
      }

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
      this.logger?.error('[F2A] 创建 F2A 实例失败', { error: errorMsg });
      this.logger?.warn('[F2A] F2A Plugin 将以降级模式运行,P2P 功能不可用');

      // 清理失败的实例
      if (this.state.f2a) {
        try {
          await this.state.f2a.stop();
        } catch {
          this.logger?.debug?.('[F2A] F2A 实例停止失败(清理阶段)');
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
      this.logger?.info('[F2A] Webhook 服务器已启动', { url: this.state.webhookServer.getUrl() });
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this.logger?.warn('[F2A] Webhook 服务器启动失败', { error: errorMsg });
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
          this.logger?.info('[F2A] 兜底轮询: 待推送任务', { count: pending.length });

          for (const task of pending) {
            const queuedTask = task as any;
            const result = await this.state.webhookPusher!.pushTask(queuedTask);
            if (result.success) {
              taskQueue.markWebhookPushed(queuedTask.taskId);
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
      const stats = taskQueue.getStats() as { processing: number };
      if (stats.processing === 0) return;

      const allTasks = taskQueue.getAll();
      const now = Date.now();
      const processingTimeout = this.config.processingTimeoutMs || 5 * 60 * 1000;

      for (const task of allTasks) {
        const queuedTask = task as any;
        if (queuedTask.status === 'processing') {
          const taskTimeout = queuedTask.timeout || 30000;
          const maxAllowedTime = Math.max(taskTimeout * 2, processingTimeout);
          const processingTime = now - (queuedTask.updatedAt || queuedTask.createdAt);

          if (processingTime > maxAllowedTime) {
            this.logger?.warn?.(
              `[F2A] 检测到僵尸任务 ${queuedTask.taskId.slice(0, 8)}... (processing ${Math.round(processingTime / 1000)}s),重置为 pending`
            );
            taskQueue.resetProcessingTask(queuedTask.taskId);
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

    // 停止 Daemon 消息轮询
    if ((this.state as any).daemonPollTimer) {
      clearInterval((this.state as any).daemonPollTimer);
      (this.state as any).daemonPollTimer = undefined;
    }

    // 关闭组件注册器
    if (this.componentRegistry) {
      await this.componentRegistry.cleanup();
    }

    // 停止 F2A 客户端(daemon 模式)
    if (this.state.f2aClient) {
      await this.state.f2aClient.close();
      this.logger?.info('[F2A] F2A 客户端已关闭');
      this.state.f2aClient = undefined;
    }

    // 停止 F2A 实例(embedded 模式)
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
   * 检测端口是否被占用
   * @returns 被占用的端口号列表
   */
  private async checkPortsInUse(...ports: number[]): Promise<number[]> {
    const inUse: number[] = [];

    for (const port of ports) {
      try {
        const net = require('net');
        await new Promise<void>((resolve, reject) => {
          const server = net.createServer();
          server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
              inUse.push(port);
            }
            resolve();
          });
          server.once('listening', () => {
            server.close();
            resolve();
          });
          server.listen(port);
        });
      } catch {
        // 如果检测失败,假设端口可用
      }
    }

    return inUse;
  }

  /**
   * 尝试从 control server 获取实际 peerId
   * 用于热重启后复用现有实例
   */
  private async tryGetActualPeerId(p2pPort: number): Promise<string | null> {
    const dataDir = this.getDataDir();
    const tokenPath = join(dataDir, 'control-token');

    // 读取 token
    let token: string | undefined;
    try {
      const fs = require('fs');
      if (fs.existsSync(tokenPath)) {
        token = fs.readFileSync(tokenPath, 'utf-8').trim();
      }
    } catch (err) {
      this.logger?.debug?.('[F2A] 无法读取 token', { error: extractErrorMessage(err) });
    }

    if (!token) {
      this.logger?.debug?.('[F2A] token 文件不存在,无法获取实际 peerId');
      return null;
    }

    // 调用 control server /status API(使用 controlPort 而非 p2pPort)
    const controlPort = this.config.controlPort || 9001;
    try {
      const http = require('http');
      const url = `http://localhost:${controlPort}/status`;

      const response = await new Promise<{ success: boolean; peerId?: string; error?: string }>((resolve, reject) => {
        const req = http.request(url, {
          method: 'GET',
          headers: { 'X-F2A-Token': token },
          timeout: 3000,
        }, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('Invalid JSON response'));
            }
          });
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        req.end();
      });

      if (response.success && response.peerId) {
        return response.peerId;
      }

      this.logger?.debug?.('[F2A] /status 返回失败', { error: response.error });
      return null;
    } catch (err) {
      this.logger?.debug?.('[F2A] 无法连接 control server', { error: extractErrorMessage(err) });
      return null;
    }
  }

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
   * 杀掉占用端口的进程
   */
  private async killProcessOnPort(port: number): Promise<void> {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`lsof -t -i :${port}`, { encoding: 'utf-8' }).trim();

      if (output) {
        const pids = output.split('\n');
        this.logger?.info('[F2A] 杀掉占用端口的进程', { port, pids });

        for (const pid of pids) {
          try {
            process.kill(parseInt(pid), 'SIGTERM');
          } catch {
            // 进程可能已经不存在
          }
        }
      }
    } catch (err) {
      this.logger?.debug?.('[F2A] killProcessOnPort 异常', { error: String(err) });
    }
  }

  /**
   * 等待端口释放
   */
  private async waitForPortRelease(port: number, timeout: number): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const inUse = await this.checkPortsInUse(port, port);
      if (inUse.length === 0) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.logger?.warn('[F2A] 等待端口释放超时', { port, timeout });
  }

  /**
   * 获取 Webhook 推送器
   */
  getWebhookPusher(): WebhookPusher | undefined {
    return this.state.webhookPusher;
  }

  /**
   * 触发心跳(用于通知 OpenClaw 有新任务)
   */
  requestHeartbeat(): void {
    this.api?.runtime?.system?.requestHeartbeatNow?.();
  }
}

export default F2ACore;