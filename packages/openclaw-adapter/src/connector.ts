/**
 * F2A OpenClaw Connector Plugin
 * 主插件类 - 任务队列架构
 */

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
import { ReputationSystem } from './reputation.js';
import { CapabilityDetector } from './capability-detector.js';
import { TaskQueue } from './task-queue.js';
import { AnnouncementQueue } from './announcement-queue.js';
import { WebhookPusher } from './webhook-pusher.js';
import { taskGuard, TaskGuardContext } from './task-guard.js';
import { ToolHandlers } from './tool-handlers.js';
import { ClaimHandlers } from './claim-handlers.js';
import { pluginLogger as logger } from './logger.js';

export class F2AOpenClawAdapter implements OpenClawPlugin {
  name = 'f2a-openclaw-adapter';
  version = '0.3.0';

  private nodeManager!: F2ANodeManager;
  private networkClient!: F2ANetworkClient;
  private webhookServer!: WebhookServer;
  private reputationSystem!: ReputationSystem;
  private capabilityDetector!: CapabilityDetector;
  private taskQueue!: TaskQueue;
  private announcementQueue!: AnnouncementQueue;
  private webhookPusher?: WebhookPusher;
  
  // 处理器实例（延迟初始化）
  private _toolHandlers?: ToolHandlers;
  private _claimHandlers?: ClaimHandlers;
  
  private config!: F2APluginConfig;
  private nodeConfig!: F2ANodeConfig;
  private capabilities: AgentCapability[] = [];
  private api?: OpenClawPluginApi;
  private pollTimer?: NodeJS.Timeout;
  
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
   * 初始化插件
   */
  async initialize(config: Record<string, unknown> & { _api?: OpenClawPluginApi }): Promise<void> {
    logger.info('初始化...');

    // 保存 API 引用（用于触发心跳等）
    this.api = config._api;
    
    // 合并配置
    this.config = this.mergeConfig(config);
    this.nodeConfig = {
      nodePath: this.config.f2aPath || './F2A',
      controlPort: this.config.controlPort || 9001,
      controlToken: this.config.controlToken || this.generateToken(),
      p2pPort: this.config.p2pPort || 9000,
      enableMDNS: this.config.enableMDNS ?? true,
      bootstrapPeers: this.config.bootstrapPeers || []
    };

    // 初始化任务队列（带持久化）
    const dataDir = this.config.dataDir || './f2a-data';
    this.taskQueue = new TaskQueue({
      maxSize: this.config.maxQueuedTasks || 100,
      maxAgeMs: 24 * 60 * 60 * 1000, // 24小时
      persistDir: dataDir,
      persistEnabled: true
    });

    // 初始化 Webhook 推送器
    if (this.config.webhookPush?.enabled !== false && this.config.webhookPush?.url) {
      this.webhookPusher = new WebhookPusher(this.config.webhookPush);
      logger.info('Webhook 推送已启用');
    }

    // 初始化广播队列
    this.announcementQueue = new AnnouncementQueue({
      maxSize: 50,
      maxAgeMs: 30 * 60 * 1000 // 30分钟
    });

    // 初始化组件
    this.nodeManager = new F2ANodeManager(this.nodeConfig);
    this.networkClient = new F2ANetworkClient(this.nodeConfig);
    this.reputationSystem = new ReputationSystem(
      this.config.reputation || {
        enabled: true,
        initialScore: 50,
        minScoreForService: 20,
        decayRate: 0.01
      },
      this.config.dataDir || './f2a-data'
    );
    this.capabilityDetector = new CapabilityDetector();

    // 处理器使用 getter 延迟初始化，无需在此显式创建

    // 启动 F2A Node
    if (this.config.autoStart) {
      const result = await this.nodeManager.ensureRunning();
      if (!result.success) {
        throw new Error(`F2A Node 启动失败: ${result.error}`);
      }
    }

    // 检测能力（基于配置，不依赖 OpenClaw 会话）
    this.capabilities = this.capabilityDetector.getDefaultCapabilities();
    if (this.config.capabilities?.length) {
      this.capabilities = this.capabilityDetector.mergeCustomCapabilities(
        this.capabilities,
        this.config.capabilities
      );
    }

    // 启动 Webhook 服务器
    this.webhookServer = new WebhookServer(
      this.config.webhookPort,
      this.createWebhookHandler()
    );
    await this.webhookServer.start();

    // 注册到 F2A Node
    await this.registerToNode();

    logger.info('初始化完成');
    logger.info(`Agent 名称: ${this.config.agentName}`);
    logger.info(`能力数: ${this.capabilities.length}`);
    logger.info(`Webhook: ${this.webhookServer.getUrl()}`);

    // 启动兜底轮询（降低到 60 秒）
    this.startFallbackPolling();
  }

  /**
   * 兜底轮询
   * 当 webhook 推送失败时，轮询确保任务不会丢失
   */
  private startFallbackPolling(): void {
    const interval = this.config.pollInterval || 60000; // 默认 60 秒
    
    this.pollTimer = setInterval(async () => {
      // P1 修复：定期检查并重置超时的 processing 任务，防止僵尸任务
      this.resetTimedOutProcessingTasks();
      
      if (!this.webhookPusher) {
        // 没有配置 webhook，不轮询（保持原有轮询模式）
        return;
      }

      try {
        // 获取未推送的任务
        const pending = this.taskQueue.getWebhookPending();
        
        if (pending.length > 0) {
          logger.info(`兜底轮询: ${pending.length} 个待推送任务`);
          
          for (const task of pending) {
            const result = await this.webhookPusher.pushTask(task);
            if (result.success) {
              this.taskQueue.markWebhookPushed(task.taskId);
            }
          }
        }
      } catch (error) {
        logger.error('兜底轮询失败:', error);
      }
    }, interval);
  }
  
  /**
   * P1 修复：重置超时的 processing 任务
   * 如果任务在 processing 状态停留超过超时时间，将其重置为 pending
   * 防止因处理失败导致的僵尸任务
   */
  private resetTimedOutProcessingTasks(): void {
    const stats = this.taskQueue.getStats();
    if (stats.processing === 0) {
      return; // 没有处理中的任务，无需检查
    }
    
    const allTasks = this.taskQueue.getAll();
    const now = Date.now();
    const processingTimeout = this.config.processingTimeoutMs || 5 * 60 * 1000; // 默认 5 分钟
    
    for (const task of allTasks) {
      if (task.status === 'processing') {
        const taskTimeout = task.timeout || 30000; // 使用任务自身的超时或默认 30 秒
        const maxAllowedTime = Math.max(taskTimeout * 2, processingTimeout); // 至少 2 倍任务超时或 processingTimeout
        const processingTime = now - (task.updatedAt || task.createdAt);
        
        if (processingTime > maxAllowedTime) {
          logger.warn(`检测到僵尸任务 ${task.taskId.slice(0, 8)}... (processing ${Math.round(processingTime / 1000)}s)，重置为 pending`);
          // 将任务重置为 pending 状态
          this.taskQueue.resetProcessingTask(task.taskId);
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
      }
    ];
  }

  /**
   * 创建 Webhook 处理器
   */
  private createWebhookHandler(): WebhookHandler {
    return {
      onDiscover: async (payload: DiscoverWebhookPayload) => {
        // 检查请求者信誉
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
        // 安全检查
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
          logger.warn(`TaskGuard 阻止任务 ${payload.taskId}: ${blockReasons}`);
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: `TaskGuard blocked: ${blockReasons}`
          };
        }

        if (taskGuardReport.requiresConfirmation) {
          // 任务需要确认（警告但不阻止）
          const warnReasons = taskGuardReport.warnings.map(w => w.message).join('; ');
          logger.warn(`TaskGuard 警告 ${payload.taskId}: ${warnReasons}`);
          // 未来可以扩展为请求用户确认
          // 目前记录警告但继续处理任务
        }

        // 检查队列是否已满
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
          if (this.webhookPusher) {
            const result = await this.webhookPusher.pushTask(task);
            if (result.success) {
              this.taskQueue.markWebhookPushed(task.taskId);
              logger.info(`任务 ${task.taskId} 已通过 webhook 推送 (${result.latency}ms)`);
            } else {
              logger.info(`Webhook 推送失败: ${result.error}，任务将在轮询时处理`);
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

      onStatus: async () => {
        const stats = this.taskQueue.getStats();
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
    await this.networkClient.registerWebhook(this.webhookServer.getUrl());
    
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
        enabled: ((config.reputation as Record<string, unknown>)?.enabled as boolean) ?? true,
        initialScore: ((config.reputation as Record<string, unknown>)?.initialScore as number) || 50,
        minScoreForService: ((config.reputation as Record<string, unknown>)?.minScoreForService as number) || 20,
        decayRate: ((config.reputation as Record<string, unknown>)?.decayRate as number) || 0.01
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
   * 格式化广播结果（公共方法，供测试和外部调用）
   */
  formatBroadcastResults(results: any[]): string {
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
      a.displayName.toLowerCase().includes(agentRef.toLowerCase())
    );

    return fuzzy || null;
  }

  /**
   * 关闭插件，清理资源
   */
  async shutdown(): Promise<void> {
    logger.info('正在关闭...');
    
    // 停止轮询定时器
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    
    // 停止 Webhook 服务器
    if (this.webhookServer) {
      await this.webhookServer.stop?.();
    }
    
    // P1 修复：关闭前刷新信誉系统数据，确保持久化
    if (this.reputationSystem) {
      this.reputationSystem.flush();
      logger.info('信誉系统数据已保存');
    }
    
    // P1 修复：关闭 TaskGuard，停止持久化定时器并保存最终状态
    taskGuard.shutdown();
    logger.info('TaskGuard 已关闭');
    
    // 停止 F2A Node
    if (this.nodeManager) {
      await this.nodeManager.stop();
    }
    
    // 关闭任务队列连接（保留持久化数据，不删除任务）
    // 这样重启后可以恢复未完成的任务
    if (this.taskQueue) {
      this.taskQueue.close();
      logger.info('任务队列已关闭，持久化数据已保留');
    }
    
    logger.info('已关闭');
  }
}

// 默认导出
export default F2AOpenClawAdapter;