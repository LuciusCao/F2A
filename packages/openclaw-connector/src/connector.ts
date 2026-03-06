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
  DelegateOptions,
  DiscoverWebhookPayload,
  DelegateWebhookPayload,
  TaskRequest,
  TaskResponse,
  Result
} from './types.js';
import { F2ANodeManager } from './node-manager.js';
import { F2ANetworkClient } from './network-client.js';
import { WebhookServer, WebhookHandler } from './webhook-server.js';
import { ReputationSystem } from './reputation.js';
import { CapabilityDetector } from './capability-detector.js';
import { TaskQueue, QueuedTask } from './task-queue.js';
import { AnnouncementQueue } from './announcement-queue.js';

export class F2AOpenClawConnector implements OpenClawPlugin {
  name = 'f2a-openclaw-connector';
  version = '0.2.0';

  private nodeManager!: F2ANodeManager;
  private networkClient!: F2ANetworkClient;
  private webhookServer!: WebhookServer;
  private reputationSystem!: ReputationSystem;
  private capabilityDetector!: CapabilityDetector;
  private taskQueue!: TaskQueue;
  private announcementQueue!: AnnouncementQueue;
  
  private config!: F2APluginConfig;
  private nodeConfig!: F2ANodeConfig;
  private capabilities: AgentCapability[] = [];
  private api?: OpenClawPluginApi;

  /**
   * 初始化插件
   */
  async initialize(config: Record<string, unknown> & { _api?: OpenClawPluginApi }): Promise<void> {
    console.log('[F2A Plugin] 初始化...');

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

    // 初始化任务队列
    this.taskQueue = new TaskQueue({
      maxSize: this.config.maxQueuedTasks || 100,
      maxAgeMs: 24 * 60 * 60 * 1000 // 24小时
    });

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

    console.log('[F2A Plugin] 初始化完成');
    console.log(`[F2A Plugin] Agent 名称: ${this.config.agentName}`);
    console.log(`[F2A Plugin] 能力数: ${this.capabilities.length}`);
    console.log(`[F2A Plugin] Webhook: ${this.webhookServer.getUrl()}`);
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
        handler: this.handleDiscover.bind(this)
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
        handler: this.handleDelegate.bind(this)
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
        handler: this.handleBroadcast.bind(this)
      },
      {
        name: 'f2a_status',
        description: '查看 F2A 网络状态和已连接 Peers',
        parameters: {},
        handler: this.handleStatus.bind(this)
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
        handler: this.handleReputation.bind(this)
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
        handler: this.handlePollTasks.bind(this)
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
        handler: this.handleSubmitResult.bind(this)
      },
      {
        name: 'f2a_task_stats',
        description: '查看任务队列统计信息',
        parameters: {},
        handler: this.handleTaskStats.bind(this)
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
        handler: this.handleAnnounce.bind(this)
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
        handler: this.handleListAnnouncements.bind(this)
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
        handler: this.handleClaim.bind(this)
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
        handler: this.handleManageClaims.bind(this)
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
        handler: this.handleMyClaims.bind(this)
      },
      {
        name: 'f2a_announcement_stats',
        description: '查看任务广播统计',
        parameters: {},
        handler: this.handleAnnouncementStats.bind(this)
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
        if (whitelist.length > 0 && !whitelist.includes(payload.from)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Not in whitelist'
          };
        }

        if (blacklist.includes(payload.from)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'In blacklist'
          };
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
          this.taskQueue.add(payload);
          
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

  // ========== Tool Handlers ==========

  private async handleDiscover(
    params: { capability?: string; min_reputation?: number },
    context: SessionContext
  ): Promise<ToolResult> {
    const result = await this.networkClient.discoverAgents(params.capability);
    
    if (!result.success) {
      return { content: `发现失败: ${result.error}` };
    }

    let agents = result.data || [];

    // 过滤信誉
    if (params.min_reputation !== undefined) {
      agents = agents.filter(a => {
        const rep = this.reputationSystem.getReputation(a.peerId);
        return rep.score >= params.min_reputation!;
      });
    }

    if (agents.length === 0) {
      return { content: '🔍 未发现符合条件的 Agents' };
    }

    const content = `
🔍 发现 ${agents.length} 个 Agents:

${agents.map((a, i) => {
  const rep = this.reputationSystem.getReputation(a.peerId);
  return `${i + 1}. ${a.displayName} (信誉: ${rep.score})
   ID: ${a.peerId.slice(0, 20)}...
   能力: ${a.capabilities?.map(c => c.name).join(', ') || '无'}`;
}).join('\n\n')}

💡 使用方式:
   - 委托任务: 让 ${agents[0]?.displayName} 帮我写代码
   - 指定ID: 委托给 #1 分析数据
    `.trim();

    return { 
      content,
      data: { agents, count: agents.length }
    };
  }

  private async handleDelegate(
    params: { agent: string; task: string; context?: string; timeout?: number },
    context: SessionContext
  ): Promise<ToolResult> {
    // 解析 Agent 引用
    const targetAgent = await this.resolveAgent(params.agent);
    
    if (!targetAgent) {
      return { content: `❌ 找不到 Agent: ${params.agent}` };
    }

    // 检查信誉
    if (!this.reputationSystem.isAllowed(targetAgent.peerId)) {
      return { 
        content: `⚠️ ${targetAgent.displayName} 信誉过低 (${this.reputationSystem.getReputation(targetAgent.peerId).score})，建议谨慎委托`
      };
    }

    console.log(`[F2A Plugin] 委托任务给 ${targetAgent.displayName}...`);

    const result = await this.networkClient.delegateTask({
      peerId: targetAgent.peerId,
      taskType: 'openclaw-task',
      description: params.task,
      parameters: {
        context: params.context,
        sessionContext: context.toJSON()
      },
      timeout: params.timeout || 60000
    });

    if (!result.success) {
      // 记录失败
      this.reputationSystem.recordFailure(targetAgent.peerId, 'unknown', result.error);
      return { content: `❌ 委托失败: ${result.error}` };
    }

    return {
      content: `✅ ${targetAgent.displayName} 已完成任务:\n\n${JSON.stringify(result.data, null, 2)}`,
      data: result.data
    };
  }

  private async handleBroadcast(
    params: { capability: string; task: string; min_responses?: number },
    context: SessionContext
  ): Promise<ToolResult> {
    const discoverResult = await this.networkClient.discoverAgents(params.capability);
    
    if (!discoverResult.success || !discoverResult.data?.length) {
      return { content: `❌ 未发现具备 "${params.capability}" 能力的 Agents` };
    }

    const agents = discoverResult.data;
    console.log(`[F2A Plugin] 广播任务给 ${agents.length} 个 Agents...`);

    // 并行委托
    const promises = agents.map(async (agent) => {
      const start = Date.now();
      const result = await this.networkClient.delegateTask({
        peerId: agent.peerId,
        taskType: 'openclaw-task',
        description: params.task,
        parameters: { sessionContext: context.toJSON() },
        timeout: 60000
      });
      const latency = Date.now() - start;

      return {
        agent: agent.displayName,
        peerId: agent.peerId,
        success: result.success,
        result: result.data,
        error: result.error,
        latency
      };
    });

    const results = await Promise.allSettled(promises);
    const settled = results.map((r, i) => 
      r.status === 'fulfilled' ? r.value : { 
        agent: agents[i].displayName, 
        success: false, 
        error: String(r.reason) 
      }
    );

    const successful = settled.filter(r => r.success);
    const minResponses = params.min_responses || 1;

    if (successful.length < minResponses) {
      return {
        content: `⚠️ 仅 ${successful.length} 个成功响应（需要 ${minResponses}）\n\n${this.formatBroadcastResults(settled)}`
      };
    }

    return {
      content: `✅ 收到 ${successful.length}/${settled.length} 个成功响应:\n\n${this.formatBroadcastResults(settled)}`,
      data: { results: settled }
    };
  }

  private async handleStatus(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const [nodeStatus, peersResult] = await Promise.all([
      this.nodeManager.getStatus(),
      this.networkClient.getConnectedPeers()
    ]);

    if (!nodeStatus.success) {
      return { content: `❌ 获取状态失败: ${nodeStatus.error}` };
    }

    const peers = peersResult.success ? (peersResult.data || []) : [];
    const taskStats = this.taskQueue.getStats();

    const content = `
🟢 F2A 状态: ${nodeStatus.data?.running ? '运行中' : '已停止'}
📡 本机 PeerID: ${nodeStatus.data?.peerId || 'N/A'}
⏱️ 运行时间: ${nodeStatus.data?.uptime ? Math.floor(nodeStatus.data.uptime / 60) + ' 分钟' : 'N/A'}
🔗 已连接 Peers: ${peers.length}
📋 任务队列: ${taskStats.pending} 待处理, ${taskStats.processing} 处理中, ${taskStats.completed} 已完成

${peers.map(p => {
  const rep = this.reputationSystem.getReputation(p.peerId);
  return `  • ${p.agentInfo?.displayName || 'Unknown'} (信誉: ${rep.score})\n    ID: ${p.peerId.slice(0, 20)}...`;
}).join('\n')}
    `.trim();

    return { content, data: { status: nodeStatus.data, peers, taskStats } };
  }

  private async handleReputation(
    params: { action: string; peer_id?: string },
    context: SessionContext
  ): Promise<ToolResult> {
    switch (params.action) {
      case 'list': {
        const reps = this.reputationSystem.getAllReputations();
        return {
          content: `📊 信誉记录 (${reps.length} 条):\n\n${reps.map(r => 
          `  ${r.peerId.slice(0, 20)}...: ${r.score} (成功: ${r.successfulTasks}, 失败: ${r.failedTasks})`
        ).join('\n')}`
        };
      }

      case 'view': {
        if (!params.peer_id) {
          return { content: '❌ 请提供 peer_id' };
        }
        const rep = this.reputationSystem.getReputation(params.peer_id);
        return {
          content: `📊 Peer ${params.peer_id.slice(0, 20)}...:\n` +
            `  信誉分: ${rep.score}\n` +
            `  成功任务: ${rep.successfulTasks}\n` +
            `  失败任务: ${rep.failedTasks}\n` +
            `  平均响应: ${rep.avgResponseTime.toFixed(0)}ms\n` +
            `  最后交互: ${new Date(rep.lastInteraction).toLocaleString()}`
        };
      }

      case 'block': {
        if (!params.peer_id) {
          return { content: '❌ 请提供 peer_id' };
        }
        if (!this.config.security) {
          this.config.security = { requireConfirmation: false, whitelist: [], blacklist: [], maxTasksPerMinute: 10 };
        }
        this.config.security.blacklist.push(params.peer_id);
        return { content: `🚫 已屏蔽 ${params.peer_id.slice(0, 20)}...` };
      }

      case 'unblock': {
        if (!params.peer_id) {
          return { content: '❌ 请提供 peer_id' };
        }
        if (!this.config.security) {
          this.config.security = { requireConfirmation: false, whitelist: [], blacklist: [], maxTasksPerMinute: 10 };
        }
        this.config.security.blacklist = this.config.security.blacklist.filter(
          id => id !== params.peer_id
        );
        return { content: `✅ 已解除屏蔽 ${params.peer_id.slice(0, 20)}...` };
      }

      default:
        return { content: `❌ 未知操作: ${params.action}` };
    }
  }

  // ========== 新增：任务队列相关 Handlers ==========

  private async handlePollTasks(
    params: { limit?: number; status?: 'pending' | 'processing' | 'completed' | 'failed' },
    context: SessionContext
  ): Promise<ToolResult> {
    let tasks: QueuedTask[];
    
    if (params.status) {
      tasks = this.taskQueue.getAll().filter(t => t.status === params.status);
    } else {
      // 默认返回待处理任务
      tasks = this.taskQueue.getPending(params.limit || 10);
    }

    if (tasks.length === 0) {
      return { content: '📭 没有符合条件的任务' };
    }

    const content = `
📋 任务列表 (${tasks.length} 个):

${tasks.map(t => {
  const statusIcon = {
    pending: '⏳',
    processing: '🔄',
    completed: '✅',
    failed: '❌'
  }[t.status];
  
  return `${statusIcon} [${t.taskId.slice(0, 8)}...] ${t.description.slice(0, 50)}${t.description.length > 50 ? '...' : ''}
   来自: ${t.from.slice(0, 16)}...
   类型: ${t.taskType} | 状态: ${t.status} | 创建: ${new Date(t.createdAt).toLocaleTimeString()}`;
}).join('\n\n')}

💡 使用方式:
   - 查看详情: 使用 task_id 查询
   - 提交结果: f2a_submit_result 工具
    `.trim();

    return {
      content,
      data: { 
        count: tasks.length,
        tasks: tasks.map(t => ({
          taskId: t.taskId,
          from: t.from,
          description: t.description,
          taskType: t.taskType,
          parameters: t.parameters,
          status: t.status,
          createdAt: t.createdAt,
          timeout: t.timeout
        }))
      }
    };
  }

  private async handleSubmitResult(
    params: { task_id: string; result: string; status: 'success' | 'error' },
    context: SessionContext
  ): Promise<ToolResult> {
    // 查找任务
    const task = this.taskQueue.get(params.task_id);
    if (!task) {
      return { content: `❌ 找不到任务: ${params.task_id}` };
    }

    // 更新任务状态
    const response: TaskResponse = {
      taskId: params.task_id,
      status: params.status,
      result: params.status === 'success' ? params.result : undefined,
      error: params.status === 'error' ? params.result : undefined,
      latency: Date.now() - task.createdAt
    };

    this.taskQueue.complete(params.task_id, response);

    // 发送响应给原节点
    const sendResult = await this.networkClient.sendTaskResponse(task.from, response);

    if (!sendResult.success) {
      return { 
        content: `⚠️ 结果已记录，但发送给原节点失败: ${sendResult.error}`,
        data: { taskId: params.task_id, sent: false }
      };
    }

    // 更新信誉
    if (params.status === 'success') {
      this.reputationSystem.recordSuccess(task.from, params.task_id, response.latency!);
    } else {
      this.reputationSystem.recordFailure(task.from, params.task_id, params.result);
    }

    return {
      content: `✅ 任务结果已提交并发送给原节点\n   任务ID: ${params.task_id.slice(0, 16)}...\n   状态: ${params.status}\n   响应时间: ${response.latency}ms`,
      data: { taskId: params.task_id, sent: true, latency: response.latency }
    };
  }

  private async handleTaskStats(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const stats = this.taskQueue.getStats();
    
    const content = `
📊 任务队列统计:

⏳ 待处理: ${stats.pending}
🔄 处理中: ${stats.processing}
✅ 已完成: ${stats.completed}
❌ 失败: ${stats.failed}
📦 总计: ${stats.total}

💡 使用 f2a_poll_tasks 查看详细任务列表
    `.trim();

    return { content, data: stats };
  }

  // ========== 认领模式 Handlers ==========

  private async handleAnnounce(
    params: {
      task_type: string;
      description: string;
      required_capabilities?: string[];
      estimated_complexity?: number;
      reward?: number;
      timeout?: number;
    },
    context: SessionContext
  ): Promise<ToolResult> {
    try {
      const announcement = this.announcementQueue.create({
        taskType: params.task_type,
        description: params.description,
        requiredCapabilities: params.required_capabilities,
        estimatedComplexity: params.estimated_complexity,
        reward: params.reward,
        timeout: params.timeout || 300000,
        from: 'local', // 实际应该从网络获取本机ID
      });

      // 触发心跳让其他Agent知道有新广播
      this.api?.runtime?.system?.requestHeartbeatNow?.();

      const content = `
📢 任务广播已创建

ID: ${announcement.announcementId}
类型: ${announcement.taskType}
描述: ${announcement.description.slice(0, 100)}${announcement.description.length > 100 ? '...' : ''}
${announcement.requiredCapabilities ? `所需能力: ${announcement.requiredCapabilities.join(', ')}` : ''}
${announcement.estimatedComplexity ? `复杂度: ${announcement.estimatedComplexity}/10` : ''}
${announcement.reward ? `奖励: ${announcement.reward}` : ''}
超时: ${Math.round(announcement.timeout / 1000)}秒

💡 使用 f2a_manage_claims 查看认领情况
      `.trim();

      return {
        content,
        data: {
          announcementId: announcement.announcementId,
          status: announcement.status
        }
      };
    } catch (error: any) {
      return {
        content: `❌ 创建广播失败: ${error.message}`,
        data: { error: error.message }
      };
    }
  }

  private async handleListAnnouncements(
    params: {
      capability?: string;
      limit?: number;
    },
    context: SessionContext
  ): Promise<ToolResult> {
    let announcements = this.announcementQueue.getOpen();

    // 按能力过滤
    if (params.capability) {
      announcements = announcements.filter(a =>
        a.requiredCapabilities?.includes(params.capability!)
      );
    }

    // 限制数量
    const limit = params.limit || 10;
    announcements = announcements.slice(0, limit);

    if (announcements.length === 0) {
      return { content: '📭 当前没有开放的任务广播' };
    }

    const content = `
📢 开放的任务广播 (${announcements.length} 个):

${announcements.map((a, i) => {
  const claimCount = a.claims?.length || 0;
  return `${i + 1}. [${a.announcementId.slice(0, 8)}...] ${a.description.slice(0, 50)}${a.description.length > 50 ? '...' : ''}
   类型: ${a.taskType} | 认领: ${claimCount} | 复杂度: ${a.estimatedComplexity || '?'}/10
   ${a.reward ? `奖励: ${a.reward} | ` : ''}超时: ${Math.round(a.timeout / 1000)}s`;
}).join('\n\n')}

💡 使用 f2a_claim 认领任务
    `.trim();

    return {
      content,
      data: {
        count: announcements.length,
        announcements: announcements.map(a => ({
          announcementId: a.announcementId,
          taskType: a.taskType,
          description: a.description.slice(0, 100),
          requiredCapabilities: a.requiredCapabilities,
          estimatedComplexity: a.estimatedComplexity,
          reward: a.reward,
          claimCount: a.claims?.length || 0
        }))
      }
    };
  }

  private async handleClaim(
    params: {
      announcement_id: string;
      estimated_time?: number;
      confidence?: number;
    },
    context: SessionContext
  ): Promise<ToolResult> {
    const announcement = this.announcementQueue.get(params.announcement_id);
    
    if (!announcement) {
      return { content: `❌ 找不到广播: ${params.announcement_id}` };
    }

    if (announcement.status !== 'open') {
      return { content: `❌ 该广播已${announcement.status === 'claimed' ? '被认领' : '过期'}` };
    }

    // 检查是否已有认领
    const existingClaim = announcement.claims?.find(c => c.claimant === 'local');
    if (existingClaim) {
      return { content: `⚠️ 你已经认领过这个广播了 (认领ID: ${existingClaim.claimId.slice(0, 8)}...)` };
    }

    const claim = this.announcementQueue.submitClaim(params.announcement_id, {
      claimant: 'local', // 实际应该从网络获取本机ID
      claimantName: this.config.agentName,
      estimatedTime: params.estimated_time,
      confidence: params.confidence
    });

    if (!claim) {
      return { content: '❌ 认领失败' };
    }

    // 触发心跳
    this.api?.runtime?.system?.requestHeartbeatNow?.();

    return {
      content: `
✅ 认领已提交

广播ID: ${params.announcement_id.slice(0, 16)}...
认领ID: ${claim.claimId.slice(0, 16)}...
${params.estimated_time ? `预计时间: ${Math.round(params.estimated_time / 1000)}秒` : ''}
${params.confidence ? `信心指数: ${Math.round(params.confidence * 100)}%` : ''}

⏳ 等待广播发布者接受...
💡 使用 f2a_my_claims 查看认领状态
      `.trim(),
      data: {
        claimId: claim.claimId,
        status: claim.status
      }
    };
  }

  private async handleManageClaims(
    params: {
      announcement_id: string;
      action: 'list' | 'accept' | 'reject';
      claim_id?: string;
    },
    context: SessionContext
  ): Promise<ToolResult> {
    const announcement = this.announcementQueue.get(params.announcement_id);
    
    if (!announcement) {
      return { content: `❌ 找不到广播: ${params.announcement_id}` };
    }

    // 检查是否是本机的广播
    if (announcement.from !== 'local') {
      return { content: '❌ 只能管理自己发布的广播' };
    }

    switch (params.action) {
      case 'list': {
        const claims = announcement.claims || [];
        if (claims.length === 0) {
          return { content: '📭 暂无认领' };
        }

        const content = `
📋 认领列表 (${claims.length} 个):

${claims.map((c, i) => {
  const statusIcon = { pending: '⏳', accepted: '✅', rejected: '❌' }[c.status];
  return `${i + 1}. ${statusIcon} [${c.claimId.slice(0, 8)}...] ${c.claimantName || c.claimant.slice(0, 16)}...
   ${c.estimatedTime ? `预计: ${Math.round(c.estimatedTime / 1000)}s | ` : ''}${c.confidence ? `信心: ${Math.round(c.confidence * 100)}%` : ''}`;
}).join('\n\n')}

💡 使用 accept/reject 操作认领
        `.trim();

        return { content, data: { claims } };
      }

      case 'accept': {
        if (!params.claim_id) {
          return { content: '❌ 请提供 claim_id' };
        }

        const claim = this.announcementQueue.acceptClaim(params.announcement_id, params.claim_id);
        if (!claim) {
          return { content: '❌ 接受认领失败' };
        }

        return {
          content: `
✅ 已接受认领

认领ID: ${params.claim_id.slice(0, 16)}...
认领者: ${claim.claimantName || claim.claimant.slice(0, 16)}...

现在可以正式委托任务给对方了。
          `.trim(),
          data: { claim }
        };
      }

      case 'reject': {
        if (!params.claim_id) {
          return { content: '❌ 请提供 claim_id' };
        }

        const claim = this.announcementQueue.rejectClaim(params.announcement_id, params.claim_id);
        if (!claim) {
          return { content: '❌ 拒绝认领失败' };
        }

        return {
          content: `
🚫 已拒绝认领

认领ID: ${params.claim_id.slice(0, 16)}...
认领者: ${claim.claimantName || claim.claimant.slice(0, 16)}...
          `.trim()
        };
      }

      default:
        return { content: `❌ 未知操作: ${params.action}` };
    }
  }

  private async handleMyClaims(
    params: {
      status?: 'pending' | 'accepted' | 'rejected' | 'all';
    },
    context: SessionContext
  ): Promise<ToolResult> {
    const status = params.status || 'all';
    let claims = this.announcementQueue.getMyClaims('local');

    // 状态过滤
    if (status !== 'all') {
      claims = claims.filter(c => c.status === status);
    }

    if (claims.length === 0) {
      return { content: `📭 没有${status === 'all' ? '' : status}的认领` };
    }

    const content = `
📋 我的认领 (${claims.length} 个):

${claims.map((c, i) => {
  const announcement = this.announcementQueue.get(c.announcementId);
  const statusIcon = { pending: '⏳', accepted: '✅', rejected: '❌' }[c.status];
  return `${i + 1}. ${statusIcon} [${c.claimId.slice(0, 8)}...]
   广播: ${announcement?.description.slice(0, 40)}...
   状态: ${c.status}${c.status === 'accepted' ? ' (可以开始执行)' : ''}`;
}).join('\n\n')}
    `.trim();

    return {
      content,
      data: {
        count: claims.length,
        claims: claims.map(c => ({
          claimId: c.claimId,
          announcementId: c.announcementId,
          status: c.status,
          estimatedTime: c.estimatedTime,
          confidence: c.confidence
        }))
      }
    };
  }

  private async handleAnnouncementStats(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const stats = this.announcementQueue.getStats();
    
    const content = `
📊 任务广播统计:

📢 开放中: ${stats.open}
✅ 已认领: ${stats.claimed}
📋 已委托: ${stats.delegated}
⏰ 已过期: ${stats.expired}
📦 总计: ${stats.total}

💡 使用 f2a_list_announcements 查看开放广播
    `.trim();

    return { content, data: stats };
  }

  // ========== Helpers ==========

  private async resolveAgent(agentRef: string): Promise<AgentInfo | null> {
    const result = await this.networkClient.discoverAgents();
    if (!result.success) return null;

    const agents = result.data || [];

    // #索引格式
    if (agentRef.startsWith('#')) {
      const index = parseInt(agentRef.slice(1)) - 1;
      return agents[index] || null;
    }

    // 精确匹配
    const exact = agents.find(a => 
      a.peerId === agentRef || 
      a.displayName === agentRef
    );
    if (exact) return exact;

    // 模糊匹配
    const fuzzy = agents.find(a => 
      a.peerId.startsWith(agentRef) ||
      a.displayName.toLowerCase().includes(agentRef.toLowerCase())
    );

    return fuzzy || null;
  }

  private formatBroadcastResults(results: any[]): string {
    return results.map(r => {
      const icon = r.success ? '✅' : '❌';
      const latency = r.latency ? ` (${r.latency}ms)` : '';
      return `${icon} ${r.agent}${latency}\n   ${r.success ? '完成' : `失败: ${r.error}`}`;
    }).join('\n\n');
  }

  private mergeConfig(config: Record<string, unknown> & { _api?: unknown }): F2APluginConfig {
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
   * 关闭插件，清理资源
   */
  async shutdown(): Promise<void> {
    console.log('[F2A Plugin] 正在关闭...');
    
    // 停止 Webhook 服务器
    if (this.webhookServer) {
      await this.webhookServer.stop?.();
    }
    
    // 停止 F2A Node
    if (this.nodeManager) {
      await this.nodeManager.stop();
    }
    
    // 清理任务队列
    if (this.taskQueue) {
      this.taskQueue.clear();
    }
    
    console.log('[F2A Plugin] 已关闭');
  }
}

// 默认导出
export default F2AOpenClawConnector;