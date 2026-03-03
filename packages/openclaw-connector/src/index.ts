/**
 * F2A OpenClaw Connector Plugin
 * 主插件类
 */

import type { 
  OpenClawPlugin, 
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

export interface OpenClawSession {
  execute: (task: string, options?: Record<string, unknown>) => Promise<unknown>;
  listTools?: () => Promise<string[]>;
  listSkills?: () => Promise<string[]>;
}

export class F2AOpenClawConnector implements OpenClawPlugin {
  name = '@f2a/openclaw-connector';
  version = '0.1.0';

  private nodeManager!: F2ANodeManager;
  private networkClient!: F2ANetworkClient;
  private webhookServer!: WebhookServer;
  private reputationSystem!: ReputationSystem;
  private capabilityDetector!: CapabilityDetector;
  
  private openclaw!: OpenClawSession;
  private config!: F2APluginConfig;
  private nodeConfig!: F2ANodeConfig;
  private capabilities: AgentCapability[] = [];
  private pendingTasks: Map<string, TaskRequest> = new Map();

  /**
   * 初始化插件
   */
  async initialize(config: Record<string, unknown> & { openclaw: OpenClawSession }): Promise<void> {
    console.log('[F2A Plugin] 初始化...');

    this.openclaw = config.openclaw;
    
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

    // 初始化组件
    this.nodeManager = new F2ANodeManager(this.nodeConfig);
    this.networkClient = new F2ANetworkClient(this.nodeConfig);
    this.reputationSystem = new ReputationSystem(
      this.config.reputation,
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

    // 检测 OpenClaw 能力
    this.capabilities = await this.capabilityDetector.detectCapabilities(this.openclaw);
    this.capabilities = this.capabilityDetector.mergeDefaultCapabilities(this.capabilities);

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

        if (this.config.security.requireConfirmation) {
          // TODO: 发送确认请求给用户
          // 暂时自动接受
        }

        // 检查白名单/黑名单
        if (this.config.security.whitelist.length > 0 && 
            !this.config.security.whitelist.includes(payload.from)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Not in whitelist'
          };
        }

        if (this.config.security.blacklist.includes(payload.from)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'In blacklist'
          };
        }

        // 接受任务
        this.pendingTasks.set(payload.taskId, payload);

        // 异步执行
        this.executeTask(payload);

        return {
          accepted: true,
          taskId: payload.taskId
        };
      },

      onStatus: async () => {
        return {
          status: 'available',
          load: this.pendingTasks.size
        };
      }
    };
  }

  /**
   * 执行任务
   */
  private async executeTask(request: TaskRequest): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`[F2A Plugin] 执行任务: ${request.taskType}`);

      // 构建任务描述
      const taskDescription = `[F2A Remote Task from ${request.from.slice(0, 16)}...] ${request.description}`;

      // 调用 OpenClaw 执行
      const result = await this.openclaw.execute(taskDescription, {
        taskType: request.taskType,
        parameters: request.parameters,
        remote: true,
        from: request.from
      });

      const latency = Date.now() - startTime;

      // 记录成功
      this.reputationSystem.recordSuccess(request.from, request.taskId, latency);

      // 发送响应
      await this.networkClient.sendTaskResponse(request.from, {
        taskId: request.taskId,
        status: 'success',
        result,
        latency
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 记录失败
      this.reputationSystem.recordFailure(request.from, request.taskId, errorMsg);

      // 发送错误响应
      await this.networkClient.sendTaskResponse(request.from, {
        taskId: request.taskId,
        status: 'error',
        error: errorMsg
      });
    } finally {
      this.pendingTasks.delete(request.taskId);
    }
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

    const peers = peersResult.success ? peersResult.data : [];

    const content = `
🟢 F2A 状态: ${nodeStatus.data?.running ? '运行中' : '已停止'}
📡 本机 PeerID: ${nodeStatus.data?.peerId || 'N/A'}
⏱️ 运行时间: ${nodeStatus.data?.uptime ? Math.floor(nodeStatus.data.uptime / 60) + ' 分钟' : 'N/A'}
🔗 已连接 Peers: ${peers.length}

${peers.map(p => {
  const rep = this.reputationSystem.getReputation(p.peerId);
  return `  • ${p.agentInfo?.displayName || 'Unknown'} (信誉: ${rep.score})\n    ID: ${p.peerId.slice(0, 20)}...`;
}).join('\n')}
    `.trim();

    return { content, data: { status: nodeStatus.data, peers } };
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
        this.config.security.blacklist.push(params.peer_id);
        return { content: `🚫 已屏蔽 ${params.peer_id.slice(0, 20)}...` };
      }

      case 'unblock': {
        if (!params.peer_id) {
          return { content: '❌ 请提供 peer_id' };
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

  private mergeConfig(config: Record<string, unknown>): F2APluginConfig {
    return {
      autoStart: (config.autoStart as boolean) ?? true,
      webhookPort: (config.webhookPort as number) || 9002,
      agentName: (config.agentName as string) || 'OpenClaw Agent',
      capabilities: (config.capabilities as string[]) || [],
      f2aPath: config.f2aPath as string,
      controlPort: config.controlPort as number,
      controlToken: config.controlToken as string,
      p2pPort: config.p2pPort as number,
      enableMDNS: config.enableMDNS as boolean,
      bootstrapPeers: config.bootstrapPeers as string[],
      dataDir: (config.dataDir as string) || './f2a-data',
      reputation: {
        enabled: (config.reputation?.enabled as boolean) ?? true,
        initialScore: (config.reputation?.initialScore as number) || 50,
        minScoreForService: (config.reputation?.minScoreForService as number) || 20,
        decayRate: (config.reputation?.decayRate as number) || 0.01
      },
      security: {
        requireConfirmation: (config.security?.requireConfirmation as boolean) ?? false,
        whitelist: (config.security?.whitelist as string[]) || [],
        blacklist: (config.security?.blacklist as string[]) || [],
        maxTasksPerMinute: (config.security?.maxTasksPerMinute as number) || 10
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
}

// 默认导出
export default F2AOpenClawConnector;