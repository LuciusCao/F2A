/**
 * F2A OpenClaw Connector Plugin
 * 主插件类 - 直接管理 F2A 实例
 * 
 * 架构说明：
 * - Adapter 直接创建和管理 F2A 实例（不需要独立的 daemon 进程）
 * - 收到 P2P 消息时，直接调用 OpenClaw Agent API 生成回复
 * - 这种方式更简洁，避免了 HTTP + CLI 的复杂性
 */

import { join } from 'path';
import { homedir } from 'os';
import type { 
  OpenClawPlugin, 
  OpenClawPluginApi,
  Tool, 
  SessionContext, 
  ToolResult,
  F2ANodeConfig,
  F2APluginConfig,
  AgentInfo,
  AgentCapability,
  DiscoverWebhookPayload,
  DelegateWebhookPayload,
} from './types.js';
import { F2ANodeManager } from './node-manager.js';
import { F2ANetworkClient } from './network-client.js';
import { WebhookServer, WebhookHandler } from './webhook-server.js';
import { ReputationSystem, ReputationManagerAdapter } from './reputation.js';
import { INTERNAL_REPUTATION_CONFIG } from './types.js';
import { CapabilityDetector } from './capability-detector.js';
import { TaskQueue } from './task-queue.js';
import { AnnouncementQueue } from './announcement-queue.js';
import { WebhookPusher } from './webhook-pusher.js';
import { taskGuard, TaskGuardContext } from './task-guard.js';
import { ToolHandlers } from './tool-handlers.js';
import { ClaimHandlers } from './claim-handlers.js';
import { ReviewCommittee, F2A } from '@f2a/network';

/** OpenClaw API Logger 类型 */
interface ApiLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

/** 广播结果类型 */
interface BroadcastResult {
  agent: string;
  success: boolean;
  error?: string;
  latency?: number;
}

export class F2AOpenClawAdapter implements OpenClawPlugin {
  name = 'f2a-openclaw-adapter';
  version = '0.3.0';

  // 核心组件（延迟初始化）
  private _nodeManager?: F2ANodeManager;
  private _networkClient?: F2ANetworkClient;
  private _webhookServer?: WebhookServer;
  private _reputationSystem?: ReputationSystem;
  private _logger?: ApiLogger;
  private _capabilityDetector?: CapabilityDetector;
  private _taskQueue?: TaskQueue;
  private _announcementQueue?: AnnouncementQueue;
  private _webhookPusher?: WebhookPusher;
  private _reviewCommittee?: ReviewCommittee;
  
  // F2A 实例（直接管理模式）
  private _f2a?: F2A;
  
  // 处理器实例（延迟初始化）
  private _toolHandlers?: ToolHandlers;
  private _claimHandlers?: ClaimHandlers;
  
  private config!: F2APluginConfig;
  private nodeConfig!: F2ANodeConfig;
  private capabilities: AgentCapability[] = [];
  private api?: OpenClawPluginApi;
  private pollTimer?: NodeJS.Timeout;
  private _initialized = false;
  
  // ========== 懒加载 Getter ==========
  
  /**
   * 获取节点管理器（懒加载）
   */
  private get nodeManager(): F2ANodeManager {
    if (!this._nodeManager) {
      this._nodeManager = new F2ANodeManager(this.nodeConfig, this._logger);
    }
    return this._nodeManager;
  }
  
  /**
   * 获取网络客户端（懒加载）
   */
  private get networkClient(): F2ANetworkClient {
    if (!this._networkClient) {
      this._networkClient = new F2ANetworkClient(this.nodeConfig, this._logger);
    }
    return this._networkClient;
  }
  
  /**
   * 获取任务队列（懒加载）
   * 只有在真正需要处理任务时才初始化 SQLite 数据库
   */
  private get taskQueue(): TaskQueue {
    if (!this._taskQueue) {
      const dataDir = this.config.dataDir || './f2a-data';
      this._taskQueue = new TaskQueue({
        maxSize: this.config.maxQueuedTasks || 100,
        maxAgeMs: 24 * 60 * 60 * 1000, // 24小时
        persistDir: dataDir,
        persistEnabled: true,
        logger: this._logger
      });
      this._logger?.info('[F2A Adapter] TaskQueue 已初始化（懒加载）');
    }
    return this._taskQueue;
  }
  
  /**
   * 获取信誉系统（懒加载）
   */
  private get reputationSystem(): ReputationSystem {
    if (!this._reputationSystem) {
      this._reputationSystem = new ReputationSystem(
        {
          enabled: INTERNAL_REPUTATION_CONFIG.enabled,
          initialScore: INTERNAL_REPUTATION_CONFIG.initialScore,
          minScoreForService: INTERNAL_REPUTATION_CONFIG.minScoreForService,
          decayRate: INTERNAL_REPUTATION_CONFIG.decayRate,
        },
        this.config.dataDir || './f2a-data'
      );
    }
    return this._reputationSystem;
  }
  
  /**
   * 获取能力检测器（懒加载）
   */
  private get capabilityDetector(): CapabilityDetector {
    if (!this._capabilityDetector) {
      this._capabilityDetector = new CapabilityDetector();
    }
    return this._capabilityDetector;
  }
  
  /**
   * 获取广播队列（懒加载）
   */
  private get announcementQueue(): AnnouncementQueue {
    if (!this._announcementQueue) {
      this._announcementQueue = new AnnouncementQueue({
        maxSize: 50,
        maxAgeMs: 30 * 60 * 1000, // 30分钟
        logger: this._logger
      });
    }
    return this._announcementQueue;
  }
  
  /**
   * 获取评审委员会（懒加载）
   */
  private get reviewCommittee(): ReviewCommittee {
    if (!this._reviewCommittee) {
      const reputationAdapter = new ReputationManagerAdapter(this.reputationSystem);
      this._reviewCommittee = new ReviewCommittee(reputationAdapter, {
        minReviewers: 1,
        maxReviewers: 5,
        minReputation: INTERNAL_REPUTATION_CONFIG.minScoreForReview,
        reviewTimeout: 5 * 60 * 1000 // 5 分钟
      });
    }
    return this._reviewCommittee;
  }
  
  /**
   * 获取工具处理器（延迟初始化，支持未初始化时调用getTools）
   */
  private get toolHandlers(): ToolHandlers {
    if (!this._toolHandlers) {
      this._toolHandlers = new ToolHandlers(this);
    }
    return this._toolHandlers;
  }
  
  /**
   * 获取认领处理器（延迟初始化）
   */
  private get claimHandlers(): ClaimHandlers {
    if (!this._claimHandlers) {
      this._claimHandlers = new ClaimHandlers(this);
    }
    return this._claimHandlers;
  }
  
  /**
   * 检查是否已初始化（用于判断是否需要启动服务）
   */
  isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * 初始化插件
   * 
   * 架构重构：延迟初始化策略
   * - 构造函数/initialize 只保存配置，不打开任何资源
   * - TaskQueue/WebhookServer 在首次访问时才初始化
   * - 这允许 `openclaw gateway status` 等 CLI 命令能正常退出
   */
  async initialize(config: Record<string, unknown> & { _api?: OpenClawPluginApi }): Promise<void> {
    // 保存 OpenClaw logger（统一日志格式）
    this._logger = config._api?.logger;
    this._logger?.info('[F2A Adapter] 初始化（延迟模式）...');

    // 保存 API 引用（用于触发心跳等）
    this.api = config._api;
    
    // 合并配置（只保存，不初始化资源）
    this.config = this.mergeConfig(config);
    this.nodeConfig = {
      nodePath: this.config.f2aPath || './F2A',
      controlPort: this.config.controlPort || 9001,
      controlToken: this.config.controlToken || this.generateToken(),
      p2pPort: this.config.p2pPort || 9000,
      enableMDNS: this.config.enableMDNS ?? true,
      bootstrapPeers: this.config.bootstrapPeers || [],
      dataDir: this.config.dataDir
    };

    // 初始化 Webhook 推送器（如果配置了）
    if (this.config.webhookPush?.enabled !== false && this.config.webhookPush?.url) {
      this._webhookPusher = new WebhookPusher(this.config.webhookPush, this._logger);
      this._logger?.info('[F2A Adapter] Webhook 推送已配置');
    }

    // 检测能力（基于配置，不依赖 OpenClaw 会话）
    // 这是轻量级操作，不需要延迟
    this.capabilities = this.capabilityDetector.getDefaultCapabilities();
    if (this.config.capabilities?.length) {
      this.capabilities = this.capabilityDetector.mergeCustomCapabilities(
        this.capabilities,
        this.config.capabilities
      );
    }

    // 注意：registerCleanupHandlers() 移到 enable() 中调用
    // 因为它注册 process.on 事件处理器，会阻止 CLI 进程退出

    this._logger?.info('[F2A Adapter] 初始化完成（延迟模式）');
    this._logger?.info(`[F2A Adapter] Agent 名称: ${this.config.agentName}`);
    this._logger?.info(`[F2A Adapter] 能力数: ${this.capabilities.length}`);
    this._logger?.info('[F2A Adapter] 资源将在首次使用时初始化（TaskQueue/WebhookServer 等）');
  }

  /**
   * 启用适配器（直接创建 F2A 实例）
   * 
   * 新架构：Adapter 直接管理 F2A 实例，不需要独立的 daemon 进程。
   * 这样消息处理可以直接调用 OpenClaw API，避免 HTTP + CLI 的复杂性。
   */
  async enable(): Promise<void> {
    if (this._initialized) {
      this._logger?.info('[F2A Adapter] 适配器已启用，跳过');
      return;
    }
    
    this._logger?.info('[F2A Adapter] 启用适配器（直接管理模式）...');
    this._initialized = true;
    
    // 注册清理处理器
    this.registerCleanupHandlers();

    // 直接创建 F2A 实例（新架构）
    try {
      // 使用绝对路径，避免相对路径问题
      // 默认使用 ~/.f2a 以复用已有的 identity
      const dataDir = this.nodeConfig.dataDir 
        ? (this.nodeConfig.dataDir.startsWith('/') || this.nodeConfig.dataDir.startsWith('~')
            ? this.nodeConfig.dataDir 
            : join(homedir(), this.nodeConfig.dataDir.replace(/^\.\/?/, '')))
        : join(homedir(), '.f2a');
      
      // 文件日志确保不被丢失
      const debugLog = (msg: string) => {
        const fs = require('fs');
        const logPath = join(homedir(), '.openclaw/logs/adapter-debug.log');
        try {
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
        } catch {}
        console.log(msg);
        this._logger?.info(msg);
      };
      
      debugLog(`[F2A Adapter] 使用数据目录: ${dataDir}`);
      debugLog(`[F2A Adapter] nodeConfig.dataDir: ${this.nodeConfig.dataDir}`);
      debugLog(`[F2A Adapter] config.dataDir: ${this.config.dataDir}`);
      
      this._f2a = await F2A.create({
        displayName: this.config.agentName || 'OpenClaw Agent',
        dataDir,
        network: {
          listenPort: this.config.p2pPort || 0,
          bootstrapPeers: this.config.bootstrapPeers || [],
          enableMDNS: this.config.enableMDNS ?? true,
          enableDHT: false,
        }
      });
      
      // 监听 P2P 消息，调用 OpenClaw Agent 生成回复
      (this._f2a as any).on('message', async (msg: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }) => {
        this._logger?.info('[F2A Adapter] 收到 P2P 消息', { from: msg.from.slice(0, 16), content: msg.content.slice(0, 50) });
        
        try {
          // 调用 OpenClaw Agent 生成回复
          const reply = await this.invokeOpenClawAgent(msg.from, msg.content);
          
          // 发送回复
          if (reply && this._f2a) {
            await (this._f2a as any).sendMessage(msg.from, reply, { type: 'reply', replyTo: msg.messageId });
            this._logger?.info('[F2A Adapter] 回复已发送', { to: msg.from.slice(0, 16) });
          }
        } catch (err) {
          this._logger?.error('[F2A Adapter] 处理消息失败', { error: err instanceof Error ? err.message : String(err) });
        }
      });
      
      // 监听其他事件
      this._f2a.on('peer:connected', (event: { peerId: string }) => {
        this._logger?.info('[F2A Adapter] Peer 连接', { peerId: event.peerId.slice(0, 16) });
      });
      
      this._f2a.on('peer:disconnected', (event: { peerId: string }) => {
        this._logger?.info('[F2A Adapter] Peer 断开', { peerId: event.peerId.slice(0, 16) });
      });
      
      // 启动 F2A（带超时保护，避免阻塞 Gateway）
      const START_TIMEOUT_MS = 10000; // 10 秒超时
      
      const startPromise = this._f2a.start();
      const timeoutPromise = new Promise<typeof startPromise>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('F2A 启动超时'));
        }, START_TIMEOUT_MS);
        timer.unref(); // 确保 Gateway 可以退出
      });
      
      const result = await Promise.race([startPromise, timeoutPromise]);
      if (!result.success) {
        throw new Error(`F2A 启动失败: ${result.error}`);
      }
      
      this._logger?.info('[F2A Adapter] F2A 实例已启动', { 
        peerId: this._f2a.peerId?.slice(0, 16),
        multiaddrs: this._f2a.agentInfo?.multiaddrs?.length || 0
      });
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this._logger?.error(`[F2A Adapter] 创建 F2A 实例失败: ${errorMsg}`);
      this._logger?.warn('[F2A Adapter] F2A Adapter 将以降级模式运行，P2P 功能不可用');
      
      // 清理失败的实例
      if (this._f2a) {
        try {
          await this._f2a.stop();
        } catch {}
        this._f2a = undefined;
      }
    }

    // 仍然启动 Webhook 服务器（用于任务委托等场景）
    try {
      this._webhookServer = new WebhookServer(
        this.config.webhookPort || 0,
        this.createWebhookHandler(),
        { logger: this._logger }
      );
      await this._webhookServer.start();
      this._logger?.info(`[F2A Adapter] Webhook 服务器已启动: ${this._webhookServer.getUrl()}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this._logger?.warn(`[F2A Adapter] Webhook 服务器启动失败: ${errorMsg}`);
    }

    // 启动兜底轮询
    this.startFallbackPolling();
    
    if (this._f2a) {
      this._logger?.info(`[F2A Adapter] P2P 已就绪，Peer ID: ${this._f2a.peerId?.slice(0, 20)}...`);
    }
  }

  /**
   * 调用 OpenClaw Agent 生成回复
   * 使用 OpenClaw Plugin API 而不是 CLI
   */
  private async invokeOpenClawAgent(fromPeerId: string, message: string): Promise<string | undefined> {
    // 使用 peerId 作为 session id，保持对话上下文
    const sessionId = `f2a-${fromPeerId.slice(0, 16)}`;
    
    this._logger?.info('[F2A Adapter] 调用 OpenClaw Agent', { 
      sessionId, 
      messageLength: message.length,
      hasApi: !!this.api,
      hasRuntime: !!this.api?.runtime,
      hasSystem: !!this.api?.runtime?.system,
      hasRunCommand: !!this.api?.runtime?.system?.runCommandWithTimeout
    });
    
    // 如果有 OpenClaw API，直接调用
    if (this.api?.runtime?.system?.runCommandWithTimeout) {
      try {
        const command = `openclaw agent --session-id ${sessionId} --message "${message.replace(/"/g, '\\"')}" --json`;
        this._logger?.info('[F2A Adapter] 执行命令', { command: command.slice(0, 100) });
        
        const result = await this.api!.runtime!.system!.runCommandWithTimeout!(command, 60000);
        
        this._logger?.info('[F2A Adapter] 命令执行完成', { 
          stdoutLength: result.stdout?.length || 0,
          stderrLength: result.stderr?.length || 0
        });
        
        if (result.stdout) {
          try {
            const parsed = JSON.parse(result.stdout);
            return parsed.content?.[0]?.text || parsed.reply || parsed.message;
          } catch {
            return result.stdout.trim() || undefined;
          }
        }
      } catch (err) {
        this._logger?.error('[F2A Adapter] 调用 OpenClaw Agent 失败', { error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      this._logger?.warn('[F2A Adapter] OpenClaw API 不可用，使用降级回复');
    }
    
    // 降级：返回简单回复
    return `收到你的消息："${message.slice(0, 30)}"。我是 ${this.config.agentName || 'OpenClaw Agent'}，很高兴与你交流！`;
  }

  /**
   * 注册清理处理器
   */
  private registerCleanupHandlers(): void {
    const autoCleanup = async () => {
      // 关闭 F2A 实例
      if (this._f2a) {
        try {
          await this._f2a.stop();
          this._logger?.info('[F2A Adapter] F2A 实例已停止');
        } catch {}
      }
      
      // 同步关闭其他资源
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      if (this._webhookServer) {
        try {
          (this._webhookServer as any).server?.close();
        } catch {}
      }
      if (this._taskQueue) {
        try {
          this._taskQueue.close();
        } catch {}
      }
    };
    
    process.once('beforeExit', autoCleanup);
    process.once('SIGINT', autoCleanup);
    process.once('SIGTERM', autoCleanup);
  }

  /**
   * 兜底轮询
   * 当 webhook 推送失败时，轮询确保任务不会丢失
   */
  private startFallbackPolling(): void {
    const interval = this.config.pollInterval || 60000; // 默认 60 秒
    
    this.pollTimer = setInterval(async () => {
      // P1 修复：定期检查并重置超时的 processing 任务，防止僵尸任务
      // 只有在 TaskQueue 已初始化时才检查
      if (this._taskQueue) {
        this.resetTimedOutProcessingTasks();
      }
      
      if (!this._webhookPusher) {
        // 没有配置 webhook，不轮询（保持原有轮询模式）
        return;
      }

      // 只有在 TaskQueue 已初始化时才处理
      if (!this._taskQueue) {
        return;
      }

      try {
        // 获取未推送的任务
        const pending = this._taskQueue.getWebhookPending();
        
        if (pending.length > 0) {
          this._logger?.info(`[F2A Adapter] 兜底轮询: ${pending.length} 个待推送任务`);
          
          for (const task of pending) {
            const result = await this._webhookPusher.pushTask(task);
            if (result.success) {
              this._taskQueue.markWebhookPushed(task.taskId);
            }
          }
        }
      } catch (error) {
        this._logger?.error('[F2A Adapter] 兜底轮询失败:', error);
      }
    }, interval);
    
    // 防止定时器阻止进程退出
    if (this.pollTimer.unref) {
      this.pollTimer.unref();
    }
  }
  
  /**
   * P1 修复：重置超时的 processing 任务
   * 如果任务在 processing 状态停留超过超时时间，将其重置为 pending
   * 防止因处理失败导致的僵尸任务
   */
  private resetTimedOutProcessingTasks(): void {
    if (!this._taskQueue) return;
    
    const stats = this._taskQueue.getStats();
    if (stats.processing === 0) {
      return; // 没有处理中的任务，无需检查
    }
    
    const allTasks = this._taskQueue.getAll();
    const now = Date.now();
    const processingTimeout = this.config.processingTimeoutMs || 5 * 60 * 1000; // 默认 5 分钟
    
    for (const task of allTasks) {
      if (task.status === 'processing') {
        const taskTimeout = task.timeout || 30000; // 使用任务自身的超时或默认 30 秒
        const maxAllowedTime = Math.max(taskTimeout * 2, processingTimeout); // 至少 2 倍任务超时或 processingTimeout
        const processingTime = now - (task.updatedAt || task.createdAt);
        
        if (processingTime > maxAllowedTime) {
          this._logger?.warn(`[F2A Adapter] 检测到僵尸任务 ${task.taskId.slice(0, 8)}... (processing ${Math.round(processingTime / 1000)}s)，重置为 pending`);
          // 将任务重置为 pending 状态
          this._taskQueue.resetProcessingTask(task.taskId);
        }
      }
    }
  }

  /**
   * 获取插件提供的 Tools
   */
  getTools(): Tool[] {
    return [
      {
        name: 'f2a_discover',
        description: '发现 F2A 网络中的 Agents，可以按能力过滤',
        parameters: {
          capability: {
            type: 'string',
            description: '按能力过滤，如 code-generation, file-operation',
            required: false
          },
          min_reputation: {
            type: 'number',
            description: '最低信誉分数 (0-100)',
            required: false
          }
        },
        handler: this.toolHandlers.handleDiscover.bind(this.toolHandlers)
      },
      {
        name: 'f2a_delegate',
        description: '委托任务给网络中的特定 Agent',
        parameters: {
          agent: {
            type: 'string',
            description: '目标 Agent ID、名称或 #索引 (如 #1)',
            required: true
          },
          task: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          context: {
            type: 'string',
            description: '任务上下文或附件',
            required: false
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒）',
            required: false
          }
        },
        handler: this.toolHandlers.handleDelegate.bind(this.toolHandlers)
      },
      {
        name: 'f2a_broadcast',
        description: '广播任务给所有具备某能力的 Agents（并行执行）',
        parameters: {
          capability: {
            type: 'string',
            description: '所需能力',
            required: true
          },
          task: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          min_responses: {
            type: 'number',
            description: '最少响应数',
            required: false
          }
        },
        handler: this.toolHandlers.handleBroadcast.bind(this.toolHandlers)
      },
      {
        name: 'f2a_status',
        description: '查看 F2A 网络状态和已连接 Peers',
        parameters: {},
        handler: this.toolHandlers.handleStatus.bind(this.toolHandlers)
      },
      {
        name: 'f2a_reputation',
        description: '查看或管理 Peer 信誉',
        parameters: {
          action: {
            type: 'string',
            description: '操作: list, view, block, unblock',
            required: true,
            enum: ['list', 'view', 'block', 'unblock']
          },
          peer_id: {
            type: 'string',
            description: 'Peer ID',
            required: false
          }
        },
        handler: this.toolHandlers.handleReputation.bind(this.toolHandlers)
      },
      // 新增：任务队列相关工具
      {
        name: 'f2a_poll_tasks',
        description: '查询本节点收到的远程任务队列（待 OpenClaw 执行）',
        parameters: {
          limit: {
            type: 'number',
            description: '最大返回任务数',
            required: false
          },
          status: {
            type: 'string',
            description: '任务状态过滤: pending, processing, completed, failed',
            required: false,
            enum: ['pending', 'processing', 'completed', 'failed']
          }
        },
        handler: this.toolHandlers.handlePollTasks.bind(this.toolHandlers)
      },
      {
        name: 'f2a_submit_result',
        description: '提交远程任务的执行结果，发送给原节点',
        parameters: {
          task_id: {
            type: 'string',
            description: '任务ID',
            required: true
          },
          result: {
            type: 'string',
            description: '任务执行结果',
            required: true
          },
          status: {
            type: 'string',
            description: '执行状态: success 或 error',
            required: true,
            enum: ['success', 'error']
          }
        },
        handler: this.toolHandlers.handleSubmitResult.bind(this.toolHandlers)
      },
      {
        name: 'f2a_task_stats',
        description: '查看任务队列统计信息',
        parameters: {},
        handler: this.toolHandlers.handleTaskStats.bind(this.toolHandlers)
      },
      // 认领模式工具
      {
        name: 'f2a_announce',
        description: '广播任务到 F2A 网络，等待其他 Agent 认领（认领模式）',
        parameters: {
          task_type: {
            type: 'string',
            description: '任务类型',
            required: true
          },
          description: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          required_capabilities: {
            type: 'array',
            description: '所需能力列表',
            required: false
          },
          estimated_complexity: {
            type: 'number',
            description: '预估复杂度 (1-10)',
            required: false
          },
          reward: {
            type: 'number',
            description: '任务奖励',
            required: false
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒）',
            required: false
          }
        },
        handler: this.claimHandlers.handleAnnounce.bind(this.claimHandlers)
      },
      {
        name: 'f2a_list_announcements',
        description: '查看当前开放的任务广播（可认领）',
        parameters: {
          capability: {
            type: 'string',
            description: '按能力过滤',
            required: false
          },
          limit: {
            type: 'number',
            description: '最大返回数量',
            required: false
          }
        },
        handler: this.claimHandlers.handleListAnnouncements.bind(this.claimHandlers)
      },
      {
        name: 'f2a_claim',
        description: '认领一个开放的任务广播',
        parameters: {
          announcement_id: {
            type: 'string',
            description: '广播ID',
            required: true
          },
          estimated_time: {
            type: 'number',
            description: '预计完成时间（毫秒）',
            required: false
          },
          confidence: {
            type: 'number',
            description: '信心指数 (0-1)',
            required: false
          }
        },
        handler: this.claimHandlers.handleClaim.bind(this.claimHandlers)
      },
      {
        name: 'f2a_manage_claims',
        description: '管理我的任务广播的认领（接受/拒绝）',
        parameters: {
          announcement_id: {
            type: 'string',
            description: '广播ID',
            required: true
          },
          action: {
            type: 'string',
            description: '操作: list, accept, reject',
            required: true,
            enum: ['list', 'accept', 'reject']
          },
          claim_id: {
            type: 'string',
            description: '认领ID（accept/reject 时需要）',
            required: false
          }
        },
        handler: this.claimHandlers.handleManageClaims.bind(this.claimHandlers)
      },
      {
        name: 'f2a_my_claims',
        description: '查看我提交的任务认领状态',
        parameters: {
          status: {
            type: 'string',
            description: '状态过滤: pending, accepted, rejected, all',
            required: false,
            enum: ['pending', 'accepted', 'rejected', 'all']
          }
        },
        handler: this.claimHandlers.handleMyClaims.bind(this.claimHandlers)
      },
      {
        name: 'f2a_announcement_stats',
        description: '查看任务广播统计',
        parameters: {},
        handler: this.claimHandlers.handleAnnouncementStats.bind(this.claimHandlers)
      },
      // 任务评估相关工具
      {
        name: 'f2a_estimate_task',
        description: '评估任务成本（工作量、复杂度、预估时间）',
        parameters: {
          task_type: {
            type: 'string',
            description: '任务类型',
            required: true
          },
          description: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          required_capabilities: {
            type: 'array',
            description: '所需能力列表',
            required: false
          }
        },
        handler: this.toolHandlers.handleEstimateTask.bind(this.toolHandlers)
      },
      {
        name: 'f2a_review_task',
        description: '作为评审者评审任务的工作量和价值',
        parameters: {
          task_id: {
            type: 'string',
            description: '任务ID',
            required: true
          },
          workload: {
            type: 'number',
            description: '工作量评估 (0-100)',
            required: true
          },
          value: {
            type: 'number',
            description: '价值评估 (-100 ~ 100)',
            required: true
          },
          risk_flags: {
            type: 'array',
            description: '风险标记: dangerous, malicious, spam, invalid',
            required: false
          },
          comment: {
            type: 'string',
            description: '评审意见',
            required: false
          }
        },
        handler: this.toolHandlers.handleReviewTask.bind(this.toolHandlers)
      },
      {
        name: 'f2a_get_reviews',
        description: '获取任务的评审汇总结果',
        parameters: {
          task_id: {
            type: 'string',
            description: '任务ID',
            required: true
          }
        },
        handler: this.toolHandlers.handleGetReviews.bind(this.toolHandlers)
      },
      {
        name: 'f2a_get_capabilities',
        description: '获取指定 Agent 的能力列表',
        parameters: {
          peer_id: {
            type: 'string',
            description: 'Agent 的 Peer ID 或名称',
            required: false
          }
        },
        handler: this.toolHandlers.handleGetCapabilities.bind(this.toolHandlers)
      }
    ];
  }

  /**
   * 创建 Webhook 处理器
   */
  private createWebhookHandler(): WebhookHandler {
    return {
      onDiscover: async (payload: DiscoverWebhookPayload) => {
        // 检查请求者信誉（懒加载触发）
        if (!this.reputationSystem.isAllowed(payload.requester)) {
          return {
            capabilities: [],
            reputation: this.reputationSystem.getReputation(payload.requester).score
          };
        }

        // 过滤能力
        let caps = this.capabilities;
        if (payload.query.capability) {
          caps = caps.filter(c => 
            c.name === payload.query.capability ||
            c.tools?.includes(payload.query.capability!)
          );
        }

        return {
          capabilities: caps,
          reputation: this.reputationSystem.getReputation(payload.requester).score
        };
      },

      onDelegate: async (payload: DelegateWebhookPayload) => {
        // 安全检查（懒加载触发 reputationSystem）
        if (!this.reputationSystem.isAllowed(payload.from)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Reputation too low'
          };
        }

        // 检查白名单/黑名单
        const whitelist = this.config.security?.whitelist || [];
        const blacklist = this.config.security?.blacklist || [];
        const isWhitelisted = whitelist.length > 0 && whitelist.includes(payload.from);
        const isBlacklisted = blacklist.includes(payload.from);

        if (whitelist.length > 0 && !isWhitelisted) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Not in whitelist'
          };
        }

        if (isBlacklisted) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'In blacklist'
          };
        }

        // TaskGuard 安全检查
        const requesterReputation = this.reputationSystem.getReputation(payload.from);
        const taskGuardContext: Partial<TaskGuardContext> = {
          requesterReputation,
          isWhitelisted,
          isBlacklisted,
          recentTaskCount: 0 // Will be tracked internally by TaskGuard
        };

        const taskGuardReport = taskGuard.check(payload, taskGuardContext);

        if (!taskGuardReport.passed) {
          // 任务被阻止
          const blockReasons = taskGuardReport.blocks.map(b => b.message).join('; ');
          this._logger?.warn(`[F2A Adapter] TaskGuard 阻止任务 ${payload.taskId}: ${blockReasons}`);
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: `TaskGuard blocked: ${blockReasons}`
          };
        }

        if (taskGuardReport.requiresConfirmation) {
          // 任务需要确认（警告但不阻止）
          const warnReasons = taskGuardReport.warnings.map(w => w.message).join('; ');
          this._logger?.warn(`[F2A Adapter] TaskGuard 警告 ${payload.taskId}: ${warnReasons}`);
          // 未来可以扩展为请求用户确认
          // 目前记录警告但继续处理任务
        }

        // 检查队列是否已满（懒加载触发 taskQueue）
        const stats = this.taskQueue.getStats();
        if (stats.pending >= (this.config.maxQueuedTasks || 100)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Task queue is full'
          };
        }

        // 添加任务到队列
        try {
          const task = this.taskQueue.add(payload);
          
          // 优先使用 webhook 推送
          if (this._webhookPusher) {
            const result = await this._webhookPusher.pushTask(task);
            if (result.success) {
              this.taskQueue.markWebhookPushed(task.taskId);
              this._logger?.info(`[F2A Adapter] 任务 ${task.taskId} 已通过 webhook 推送 (${result.latency}ms)`);
            } else {
              this._logger?.info(`[F2A Adapter] Webhook 推送失败: ${result.error}，任务将在轮询时处理`);
            }
          }
          
          // 触发 OpenClaw 心跳，让它知道有新任务
          this.api?.runtime?.system?.requestHeartbeatNow?.();
          
          return {
            accepted: true,
            taskId: payload.taskId
          };
        } catch (error) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: error instanceof Error ? error.message : 'Failed to queue task'
          };
        }
      },

      onMessage: async (payload: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }) => {
        this._logger?.info('[F2A Adapter] 收到 P2P 消息', { 
          from: payload.from.slice(0, 16), 
          content: payload.content.slice(0, 50) 
        });

        try {
          // 调用 OpenClaw Agent 处理消息
          // 使用 peerId 作为 session id，确保同一个对话者使用同一个 session
          const sessionId = `f2a-${payload.from.slice(0, 16)}`;
          
          // 构造消息，包含发送者信息
          const message = `[来自 ${payload.metadata?.from || payload.from.slice(0, 16)}] ${payload.content}`;
          
          // 调用 openclaw agent 命令
          const result = await this.invokeOpenClawAgent(payload.from, message);
          
          return { response: result || '收到消息，但我暂时无法生成回复。' };
        } catch (error) {
          this._logger?.error('[F2A Adapter] 处理消息失败', { error: error instanceof Error ? error.message : String(error) });
          return { response: '抱歉，我遇到了一些问题，无法处理你的消息。' };
        }
      },

      onStatus: async () => {
        // 如果 TaskQueue 未初始化，返回空闲状态
        if (!this._taskQueue) {
          return {
            status: 'available',
            load: 0,
            queued: 0,
            processing: 0
          };
        }
        
        const stats = this._taskQueue.getStats();
        return {
          status: 'available',
          load: stats.pending + stats.processing,
          queued: stats.pending,
          processing: stats.processing
        };
      }
    };
  }

  /**
   * 注册到 F2A Node
   */
  private async registerToNode(): Promise<void> {
    if (!this._webhookServer) return;
    
    await this.networkClient.registerWebhook(this._webhookServer.getUrl());
    
    await this.networkClient.updateAgentInfo({
      displayName: this.config.agentName,
      capabilities: this.capabilities
    });
  }

  // ========== Helpers ==========

  /**
   * 合并配置（公开方法供处理器使用）
   */
  mergeConfig(config: Record<string, unknown> & { _api?: unknown }): F2APluginConfig {
    return {
      autoStart: (config.autoStart as boolean) ?? true,
      webhookPort: (config.webhookPort as number) || 9002,
      agentName: (config.agentName as string) || 'OpenClaw Agent',
      capabilities: (config.capabilities as string[]) || [],
      f2aPath: config.f2aPath as string | undefined,
      controlPort: config.controlPort as number | undefined,
      controlToken: config.controlToken as string | undefined,
      p2pPort: config.p2pPort as number | undefined,
      enableMDNS: config.enableMDNS as boolean | undefined,
      bootstrapPeers: config.bootstrapPeers as string[] | undefined,
      dataDir: (config.dataDir as string) || './f2a-data',
      maxQueuedTasks: (config.maxQueuedTasks as number) || 100,
      pollInterval: config.pollInterval as number | undefined,
      // 保留 webhookPush 配置（修复：之前丢失导致 webhook 推送被禁用）
      webhookPush: config.webhookPush as { enabled?: boolean; url: string; token: string; timeout?: number } | undefined,
      reputation: {
        enabled: ((config.reputation as Record<string, unknown>)?.enabled as boolean) ?? INTERNAL_REPUTATION_CONFIG.enabled,
        initialScore: ((config.reputation as Record<string, unknown>)?.initialScore as number) || INTERNAL_REPUTATION_CONFIG.initialScore,
        minScoreForService: ((config.reputation as Record<string, unknown>)?.minScoreForService as number) || INTERNAL_REPUTATION_CONFIG.minScoreForService,
        decayRate: ((config.reputation as Record<string, unknown>)?.decayRate as number) || INTERNAL_REPUTATION_CONFIG.decayRate
      },
      security: {
        requireConfirmation: ((config.security as Record<string, unknown>)?.requireConfirmation as boolean) ?? false,
        whitelist: ((config.security as Record<string, unknown>)?.whitelist as string[]) || [],
        blacklist: ((config.security as Record<string, unknown>)?.blacklist as string[]) || [],
        maxTasksPerMinute: ((config.security as Record<string, unknown>)?.maxTasksPerMinute as number) || 10
      }
    };
  }

  private generateToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = 'f2a-';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  /**
   * 检查 F2A CLI 是否已安装
   * 通过执行 `f2a version` 命令来检测
   */
  private async checkF2AInstalled(): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync('f2a version', { timeout: 5000 });
      this._logger?.info(`[F2A Adapter] F2A CLI 已安装: ${stdout.trim()}`);
      return true;
    } catch (error) {
      // 如果是命令不存在，说明 CLI 未安装
      if (error instanceof Error && (error.message.includes('ENOENT') || error.message.includes('not found'))) {
        this._logger?.debug?.('[F2A Adapter] F2A CLI 未安装');
        return false;
      }
      // P2-3 修复：timeout 也视为 CLI 未安装（CLI 可能存在但响应慢）
      if (error instanceof Error && error.message.includes('ETIMEDOUT')) {
        this._logger?.debug?.('[F2A Adapter] F2A CLI 响应超时，视为未安装');
        return false;
      }
      // 其他错误，可能是 CLI 已安装但有问题
      this._logger?.debug?.(`[F2A Adapter] F2A CLI 检测异常: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 通过 CLI 启动 F2A daemon
   * 执行 `f2a daemon -d` 命令（后台模式）
   */
  private async startDaemonViaCLI(): Promise<boolean> {
    try {
      const { spawn } = await import('child_process');
      
      return new Promise((resolve) => {
        this._logger?.info('[F2A Adapter] 执行: f2a daemon -d');
        
        // 设置 messageHandlerUrl 环境变量，让 daemon 将消息推送到 adapter 的 webhook
        const env = { ...process.env };
        if (this._webhookServer) {
          const webhookUrl = `${this._webhookServer.getUrl()}/message`;
          env.F2A_MESSAGE_HANDLER_URL = webhookUrl;
          this._logger?.info(`[F2A Adapter] 配置消息处理 URL: ${webhookUrl}`);
        }
        
        const proc = spawn('f2a', ['daemon', '-d'], {
          detached: true,  // P1-1 修复：让 daemon 独立运行，不随父进程退出
          stdio: 'ignore',  // P1-2 修复：ignore stdio 配合 detached 使用
          env  // 传递环境变量
        });
        
        // P1-2 修复：detached + ignore stdio 后，需要 unref 让父进程可以独立退出
        proc.unref();
        
        proc.on('error', (err) => {
          this._logger?.error(`[F2A Adapter] 启动 daemon 失败: ${err.message}`);
          resolve(false);
        });
        
        // P2-1 修复：daemon 启动后 CLI 会自动等待服务就绪后退出
        // 我们只需要等待一段时间后检查 daemon 是否真的在运行
        setTimeout(async () => {
          const running = await this._nodeManager?.isRunning();
          if (running) {
            this._logger?.info('[F2A Adapter] F2A daemon 服务已就绪');
            resolve(true);
          } else {
            this._logger?.warn('[F2A Adapter] F2A daemon 启动超时，请检查日志: ~/.f2a/daemon.log');
            resolve(false);
          }
        }, 5000);
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this._logger?.error(`[F2A Adapter] 启动 daemon 失败: ${errMsg}`);
      return false;
    }
  }

  /**
   * 格式化广播结果（公共方法，供测试和外部调用）
   */
  formatBroadcastResults(results: BroadcastResult[]): string {
    return results.map(r => {
      const icon = r.success ? '✅' : '❌';
      const latency = r.latency ? ` (${r.latency}ms)` : '';
      return `${icon} ${r.agent}${latency}\n   ${r.success ? '完成' : `失败: ${r.error}`}`;
    }).join('\n\n');
  }

  /**
   * 解析 Agent 引用（公共方法，供测试和外部调用）
   */
  async resolveAgent(agentRef: string): Promise<AgentInfo | null> {
    const result = await this.networkClient?.discoverAgents();
    if (!result?.success) return null;

    const agents = result.data || [];

    // #索引格式
    if (agentRef.startsWith('#')) {
      const index = parseInt(agentRef.slice(1)) - 1;
      return agents[index] || null;
    }

    // 精确匹配
    const exact = agents.find((a: AgentInfo) => 
      a.peerId === agentRef || 
      a.displayName === agentRef
    );
    if (exact) return exact;

    // 模糊匹配
    const fuzzy = agents.find((a: AgentInfo) => 
      a.peerId.startsWith(agentRef) ||
      (a.displayName?.toLowerCase().includes(agentRef.toLowerCase()) ?? false)
    );

    return fuzzy || null;
  }

  /**
   * 关闭插件，清理资源
   * 只清理已初始化的资源
   */
  async shutdown(): Promise<void> {
    this._logger?.info('[F2A Adapter] 正在关闭...');
    
    // 停止轮询定时器
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    
    // 停止 F2A 实例（新架构直接管理）
    if (this._f2a) {
      try {
        await this._f2a.stop();
        this._logger?.info('[F2A Adapter] F2A 实例已停止');
      } catch (err) {
        this._logger?.warn('[F2A Adapter] F2A 实例停止失败', { error: err instanceof Error ? err.message : String(err) });
      }
      this._f2a = undefined;
    }
    
    // 停止 Webhook 服务器（只有已启动时才关闭）
    if (this._webhookServer) {
      await this._webhookServer.stop?.();
      this._logger?.info('[F2A Adapter] Webhook 服务器已停止');
    }
    
    // P1 修复：关闭前刷新信誉系统数据，确保持久化
    if (this._reputationSystem) {
      this._reputationSystem.flush();
      this._logger?.info('[F2A Adapter] 信誉系统数据已保存');
    }
    
    // P1 修复：关闭 TaskGuard，停止持久化定时器并保存最终状态
    taskGuard.shutdown();
    this._logger?.info('[F2A Adapter] TaskGuard 已关闭');
    
    // 停止 F2A Node（只有已启动时才关闭）
    if (this._nodeManager) {
      await this._nodeManager.stop();
      this._logger?.info('[F2A Adapter] F2A Node 管理器已停止');
    }
    
    // 关闭任务队列连接（只有已初始化时才关闭）
    // 保留持久化数据，不删除任务，这样重启后可以恢复未完成的任务
    if (this._taskQueue) {
      this._taskQueue.close();
      this._logger?.info('[F2A Adapter] 任务队列已关闭，持久化数据已保留');
    }
    
    this._initialized = false;
    this._logger?.info('[F2A Adapter] 已关闭');
  }
}

// 默认导出
export default F2AOpenClawAdapter;