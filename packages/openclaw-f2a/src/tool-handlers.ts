/**
 * F2A OpenClaw Connector - Tool Handlers
 * 工具处理器模块 - 处理 f2a_discover, f2a_send, f2a_broadcast 等工具
 * 
 * PR #111 重构：使用新的 MESSAGE 协议
 * - 所有消息使用 MESSAGE 类型 + StructuredMessagePayload
 * - topic 字段区分消息类型（chat, task.request, task.response 等）
 */

import type {
  SessionContext,
  ToolResult,
  AgentInfo,
  AgentCapability,
  TaskResponse,
  F2APluginConfig,
  OpenClawPluginApi,
  PluginInternalAccess
} from './types.js';
import type { F2APluginPublicInterface } from './types.js';
import type { QueuedTask } from './task-queue.js';
import type { ReputationSystemLike } from './types.js';
import type { F2ANetworkClient } from './network-client.js';
import type { F2ANodeManager } from './node-manager.js';
import type { TaskQueue } from './task-queue.js';
import type { AnnouncementQueue } from './announcement-queue.js';
import type { ReviewCommittee, TaskReview, RiskFlag, ReviewResult } from '@f2a/network';
import { pluginLogger as logger } from './logger.js';
// P1-1: 导入 isValidPeerId 验证函数
import { isValidPeerId } from './connector-helpers.js';

/** 广播结果类型 */
interface BroadcastResult {
  agent: string;
  success: boolean;
  error?: string;
  latency?: number;
}

/**
 * 工具处理器参数类型
 */
export interface ToolHandlerParams {
  discover: { capability?: string; min_reputation?: number };
  send: { agent: string; message: string; topic?: string; context?: string; timeout?: number };
  broadcast: { capability: string; task: string; min_responses?: number };
  reputation: { action: string; peer_id?: string };
  pollTasks: { limit?: number; status?: 'pending' | 'processing' | 'completed' | 'failed' };
  submitResult: { task_id: string; result: string; status: 'success' | 'error' };
  // 任务评估相关工具
  estimateTask: { 
    task_type: string; 
    description: string; 
    required_capabilities?: string[] 
  };
  reviewTask: { 
    task_id: string; 
    workload: number; 
    value: number; 
    risk_flags?: RiskFlag[]; 
    comment?: string 
  };
  getReviews: { task_id: string };
  getCapabilities: { peer_id?: string; agent_name?: string };
}

/**
 * 任务评估结果
 */
export interface TaskEstimation {
  /** 工作量 (0-100) */
  workload: number;
  /** 复杂度 (1-10) */
  complexity: number;
  /** 预估时间（毫秒） */
  estimated_time_ms: number;
  /** 置信度 (0-1) */
  confidence: number;
}

/**
 * 工具处理器类
 * 包含所有核心工具的处理逻辑
 * 
 * Issue #106: 使用 F2APluginPublicInterface 解除循环依赖
 */
export class ToolHandlers {
  constructor(private plugin: F2APluginPublicInterface) {}
  
  /**
   * 类型安全的内部访问 getter
   * 避免在每个方法中重复类型转换
   */
  private get networkClient(): F2ANetworkClient {
    return this.plugin.getNetworkClient() as unknown as F2ANetworkClient;
  }
  
  private get reputationSystem(): ReputationSystemLike {
    return this.plugin.getReputationSystem();
  }
  
  private get taskQueue(): TaskQueue {
    return this.plugin.getTaskQueue() as TaskQueue;
  }
  
  private get reviewCommittee(): ReviewCommittee | undefined {
    return this.plugin.getReviewCommittee() as ReviewCommittee | undefined;
  }
  
  private get config(): F2APluginConfig {
    return this.plugin.getConfig();
  }
  
  private get api(): OpenClawPluginApi | undefined {
    return this.plugin.getApi();
  }

  /**
   * 处理 f2a_discover 工具
   * 发现 F2A 网络中的 Agents
   */
  async handleDiscover(
    params: ToolHandlerParams['discover'],
    context: SessionContext
  ): Promise<ToolResult> {
    const reputationSystem = this.reputationSystem;
    
    // 新架构：优先使用 discoverAgents 方法
    let result = await this.networkClient.discoverAgents(params.capability);
    
    if (!result.success) {
      const errorMsg = result.error?.message || String(result.error) || 'Unknown error';
      return { content: `发现失败: ${errorMsg}` };
    }

    let agents = result.data || [];

    // 过滤信誉
    if (params.min_reputation !== undefined) {
      agents = agents.filter((a: AgentInfo) => {
        const rep = reputationSystem.getReputation(a.peerId);
        return rep.score >= params.min_reputation!;
      });
    }

    if (agents.length === 0) {
      return { content: '🔍 未发现符合条件的 Agents' };
    }

    const content = `
🔍 发现 ${agents.length} 个 Agents:

${agents.map((a: AgentInfo, i: number) => {
  const rep = reputationSystem.getReputation(a.peerId);
  return `${i + 1}. ${a.displayName} (信誉: ${rep.score})
   ID: ${a.peerId}
   能力: ${a.capabilities?.map((c: any) => c.name).join(', ') || '无'}`;
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

  /**
   * 处理 f2a_send 工具
   * 发送消息给特定 Agent（PR #111 新协议：MESSAGE + topic）
   */
  async handleSend(
    params: ToolHandlerParams['send'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.agent || typeof params.agent !== 'string' || params.agent.trim() === '') {
      return { content: '❌ 请提供有效的 agent 参数（Agent ID、名称或 #索引）' };
    }
    if (!params.message || typeof params.message !== 'string' || params.message.trim() === '') {
      return { content: '❌ 请提供有效的 message 参数（消息内容）' };
    }
    
    const reputationSystem = (this.plugin as unknown as PluginInternalAccess).reputationSystem;
    
    // 解析 Agent 引用
    const targetAgent = await this.resolveAgent(params.agent);
    
    if (!targetAgent) {
      return { content: `❌ 找不到 Agent: ${params.agent}` };
    }

    // 检查信誉
    const reputation = reputationSystem.getReputation(targetAgent.peerId);
    const minScore = 20;
    if (reputation.score < minScore) {
      logger.warn(`⚠️ ${targetAgent.displayName} 信誉较低 (${reputation.score})，谨慎发送`);
    }

    logger.info(`发送消息给 ${targetAgent.displayName}...`);

    // 新协议：使用 MESSAGE 类型 + StructuredMessagePayload
    const plugin = this.plugin as unknown as PluginInternalAccess;
    
    // 获取 F2A 实例
    const f2a = plugin.getF2A?.();
    const status = plugin.getF2AStatus?.();
    
    if (f2a && f2a.sendMessage && status?.running) {
      try {
        // PR #111 新协议：MESSAGE 类型 + StructuredMessagePayload
        // topic 默认为 'chat'，可显式指定
        const topic = params.topic || (params.context ? 'task.request' : 'chat');
        const messagePayload = {
          topic,
          content: {
            text: params.message,
            context: params.context,
            from: f2a.peerId,
            timestamp: Date.now()
          }
        };
        
        await f2a.sendMessage(targetAgent.peerId, JSON.stringify(messagePayload));
        
        logger.info(`消息已发送给 ${targetAgent.displayName}`);
        
        return {
          content: `✅ 消息已发送给 ${targetAgent.displayName}:

📝 ${params.message}\n\n⏳ 等待回复中...`,
          data: { sent: true, agent: targetAgent.displayName, message: params.message, topic }
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`发送失败: ${errorMsg}`);
        return { content: `❌ 发送失败: ${errorMsg}` };
      }
    }
    
    // 降级：提示 F2A 未运行
    logger.warn(`F2A 状态检查失败`, { hasF2a: !!f2a, status });
    return { content: `❌ F2A 未运行，无法发送消息` };
  }

  /**
   * 处理 f2a_broadcast 工具
   * 广播消息给所有具备某能力的 Agents（按 PR #111 新协议重构）
   */
  async handleBroadcast(
    params: ToolHandlerParams['broadcast'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.capability || typeof params.capability !== 'string' || params.capability.trim() === '') {
      return { content: '❌ 请提供有效的 capability 参数（所需能力）' };
    }
    if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
      return { content: '❌ 请提供有效的 task 参数（消息内容）' };
    }
    
    const plugin = this.plugin as unknown as PluginInternalAccess;
    const networkClient = plugin.networkClient;
    
    const discoverResult = await networkClient.discoverAgents(params.capability);
    
    if (!discoverResult.success || !discoverResult.data?.length) {
      return { content: `❌ 未发现具备 "${params.capability}" 能力的 Agents` };
    }

    const agents = discoverResult.data;
    logger.info(`广播消息给 ${agents.length} 个 Agents...`);

    const f2a = (this.plugin as any)._f2a;
    
    // 并行发送消息
    const promises = agents.map(async (agent: AgentInfo) => {
      const start = Date.now();
      
      try {
        if (f2a && f2a.sendMessage) {
          // PR #111 新协议：MESSAGE 类型
          const messagePayload = {
            topic: 'task.request',
            content: {
              text: params.task,
              from: f2a.peerId,
              timestamp: Date.now()
            }
          };
          
          await f2a.sendMessage(agent.peerId, JSON.stringify(messagePayload));
          const latency = Date.now() - start;
          
          return {
            agent: agent.displayName || agent.peerId,
            peerId: agent.peerId,
            success: true,
            latency
          };
        } else {
          return {
            agent: agent.displayName || agent.peerId,
            peerId: agent.peerId,
            success: false,
            error: 'F2A not available'
          };
        }
      } catch (err) {
        const latency = Date.now() - start;
        return {
          agent: agent.displayName || agent.peerId,
          peerId: agent.peerId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          latency
        };
      }
    });

    const results = await Promise.allSettled(promises);
    const settled = results.map((r: PromiseSettledResult<BroadcastResult>, i: number) => 
      r.status === 'fulfilled' ? r.value : { 
        agent: agents[i].displayName ?? agents[i].peerId, 
        success: false, 
        error: String(r.reason) 
      }
    ) as BroadcastResult[];

    const successful = settled.filter((r: BroadcastResult) => r.success);
    const minResponses = params.min_responses || 1;

    if (successful.length < minResponses) {
      return {
        content: `⚠️ 仅 ${successful.length} 个成功响应（需要 ${minResponses}）\n\n${this.formatBroadcastResults(settled)}`
      };
    }

    return {
      content: `✅ 消息已发送给 ${successful.length}/${settled.length} 个 Agents:\n\n${this.formatBroadcastResults(settled)}`,
      data: { results: settled }
    };
  }

  /**
   * 处理 f2a_status 工具
   * 查看网络状态
   */
  async handleStatus(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const plugin = this.plugin as unknown as PluginInternalAccess;
    const taskQueue = plugin.taskQueue;
    const reputationSystem = plugin.reputationSystem;
    
    // 新架构：直接获取 F2A 状态
    let nodeStatus: { running: boolean; peerId?: string; uptime?: number };
    let peers: any[] = [];
    
    if (plugin.getF2AStatus) {
      nodeStatus = plugin.getF2AStatus();
      
      // 使用 f2aClient 获取连接的 peers
      if (plugin.f2aClient) {
        const peersResult = await plugin.f2aClient.getConnectedPeers();
        peers = peersResult.success ? (peersResult.data || []) : [];
      }
    } else {
      // 降级：使用旧的方式
      const [nodeStatusResult, peersResult] = await Promise.all([
        plugin.nodeManager.getStatus(),
        plugin.networkClient.getConnectedPeers()
      ]);
      
      if (!nodeStatusResult.success) {
        const errorMsg = nodeStatusResult.error?.message || String(nodeStatusResult.error) || 'Unknown error';
        return { content: `❌ 获取状态失败: ${errorMsg}` };
      }
      
      nodeStatus = {
        running: nodeStatusResult.data?.running || false,
        peerId: nodeStatusResult.data?.peerId,
        uptime: nodeStatusResult.data?.uptime
      };
      peers = peersResult.success ? (peersResult.data || []) : [];
    }

    const taskStats = taskQueue.getStats();

    const content = `
🟢 F2A 状态: ${nodeStatus.running ? '运行中' : '已停止'}
📡 本机 PeerID: ${nodeStatus.peerId || 'N/A'}
⏱️ 运行时间: ${nodeStatus.uptime ? Math.floor(nodeStatus.uptime / 60) + ' 分钟' : 'N/A'}
🔗 已连接 Peers: ${peers.length}
📋 任务队列: ${taskStats.pending} 待处理, ${taskStats.processing} 处理中, ${taskStats.completed} 已完成

${peers.map((p: any) => {
  const rep = reputationSystem.getReputation(p.peerId);
  return `  • ${p.agentInfo?.displayName || p.displayName || 'Unknown'} (信誉: ${rep.score})\n    ID: ${p.peerId?.slice(0, 20)}...`;
}).join('\n')}
    `.trim();

    return { content, data: { status: nodeStatus, peers, taskStats } };
  }

  /**
   * 处理 f2a_reputation 工具
   * 查看或管理 Peer 信誉
   */
  async handleReputation(
    params: ToolHandlerParams['reputation'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.action || !['list', 'view', 'block', 'unblock'].includes(params.action)) {
      return { content: '❌ action 参数必须是 list, view, block 或 unblock' };
    }
    if ((params.action === 'view' || params.action === 'block' || params.action === 'unblock') && 
        (!params.peer_id || typeof params.peer_id !== 'string' || params.peer_id.trim() === '')) {
      return { content: '❌ view/block/unblock 操作需要提供 peer_id 参数' };
    }
    
    // P1-1: 验证 peer_id 格式（对于需要 peer_id 的操作）
    if (params.peer_id && typeof params.peer_id === 'string' && !isValidPeerId(params.peer_id)) {
      return { content: `❌ 无效的 peer_id 格式: ${(params.peer_id as string).slice(0, 20)}...` };
    }
    
    const reputationSystem = (this.plugin as unknown as PluginInternalAccess).reputationSystem;
    const config = (this.plugin as unknown as PluginInternalAccess).config;
    
    switch (params.action) {
      case 'list': {
        const reps = reputationSystem.getAllReputations();
        return {
          content: `📊 信誉记录 (${reps.length} 条):\n\n${reps.map((r: any) => 
          `  ${r.peerId.slice(0, 20)}...: ${r.score} (成功: ${r.successfulTasks}, 失败: ${r.failedTasks})`
        ).join('\n')}`
        };
      }

      case 'view': {
        if (!params.peer_id) {
          return { content: '❌ 请提供 peer_id' };
        }
        const rep = reputationSystem.getReputation(params.peer_id);
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
        if (!config.security) {
          config.security = { requireConfirmation: false, whitelist: [], blacklist: [], maxTasksPerMinute: 10 };
        }
        if (!config.security.blacklist) {
          config.security.blacklist = [];
        }
        config.security.blacklist.push(params.peer_id);
        return { content: `🚫 已屏蔽 ${params.peer_id.slice(0, 20)}...` };
      }

      case 'unblock': {
        if (!params.peer_id) {
          return { content: '❌ 请提供 peer_id' };
        }
        if (!config.security) {
          config.security = { requireConfirmation: false, whitelist: [], blacklist: [], maxTasksPerMinute: 10 };
        }
        config.security.blacklist = (config.security.blacklist || []).filter(
          (id: string) => id !== params.peer_id
        );
        return { content: `✅ 已解除屏蔽 ${params.peer_id.slice(0, 20)}...` };
      }

      default:
        return { content: `❌ 未知操作: ${params.action}` };
    }
  }

  /**
   * 处理 f2a_poll_tasks 工具
   * 查询任务队列
   */
  async handlePollTasks(
    params: ToolHandlerParams['pollTasks'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (params.limit !== undefined && (typeof params.limit !== 'number' || params.limit < 1 || params.limit > 100)) {
      return { content: '❌ limit 参数必须是 1-100 之间的数字' };
    }
    if (params.status !== undefined && !['pending', 'processing', 'completed', 'failed'].includes(params.status)) {
      return { content: '❌ status 参数必须是 pending, processing, completed 或 failed' };
    }
    
    const taskQueue = (this.plugin as unknown as PluginInternalAccess).taskQueue;
    
    let tasks: QueuedTask[];
    
    if (params.status) {
      // 按状态过滤时不改变任务状态（只是查看）
      tasks = taskQueue.getAll().filter((t: QueuedTask) => t.status === params.status);
    } else {
      // 默认返回待处理任务，并标记为 processing（防止重复执行）
      const pendingTasks = taskQueue.getPending(params.limit || 10);
      
      // P0-3/4 修复：检查 markProcessing() 返回值，处理竞态条件
      // 如果任务已被其他处理者标记为 processing，则跳过
      tasks = [];
      const skippedIds: string[] = [];
      
      for (const task of pendingTasks) {
        const markedTask = taskQueue.markProcessing(task.taskId);
        if (markedTask) {
          // 成功标记为 processing
          tasks.push(markedTask);
        } else {
          // 任务已被其他处理者获取或不存在，跳过并记录警告
          skippedIds.push(task.taskId);
          logger.warn('[F2A:Tools] 任务已被其他处理者获取，跳过: taskId=%s', task.taskId.slice(0, 16));
        }
      }
      
      if (tasks.length > 0) {
        logger.info(`已将 ${tasks.length} 个任务标记为 processing`);
      }
      if (skippedIds.length > 0) {
        logger.warn('[F2A:Tools] 跳过已被获取的任务', { count: skippedIds.length });
      }
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

  /**
   * 处理 f2a_submit_result 工具
   * 提交任务结果
   */
  async handleSubmitResult(
    params: ToolHandlerParams['submitResult'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.task_id || typeof params.task_id !== 'string' || params.task_id.trim() === '') {
      return { content: '❌ 请提供有效的 task_id 参数' };
    }
    if (!params.result || typeof params.result !== 'string') {
      return { content: '❌ 请提供有效的 result 参数' };
    }
    if (params.status !== 'success' && params.status !== 'error') {
      return { content: '❌ status 参数必须是 success 或 error' };
    }
    
    const taskQueue = (this.plugin as unknown as PluginInternalAccess).taskQueue;
    const networkClient = (this.plugin as unknown as PluginInternalAccess).networkClient;
    const reputationSystem = (this.plugin as unknown as PluginInternalAccess).reputationSystem;
    
    // 查找任务
    const task = taskQueue.get(params.task_id);
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

    taskQueue.complete(params.task_id, response);

    // 发送响应给原节点
    const sendResult = await networkClient.sendTaskResponse(task.from, response);

    if (!sendResult.success) {
      return { 
        content: `⚠️ 结果已记录，但发送给原节点失败: ${sendResult.error}`,
        data: { taskId: params.task_id, sent: false }
      };
    }

    // 更新信誉
    if (params.status === 'success') {
      reputationSystem.recordSuccess(task.from, params.task_id, response.latency!);
    } else {
      reputationSystem.recordFailure(task.from, params.task_id, params.result);
    }

    return {
      content: `✅ 任务结果已提交并发送给原节点\n   任务ID: ${params.task_id.slice(0, 16)}...\n   状态: ${params.status}\n   响应时间: ${response.latency}ms`,
      data: { taskId: params.task_id, sent: true, latency: response.latency }
    };
  }

  /**
   * 处理 f2a_task_stats 工具
   * 查看任务队列统计
   */
  async handleTaskStats(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const taskQueue = (this.plugin as unknown as PluginInternalAccess).taskQueue;
    const stats = taskQueue.getStats();
    
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

  // ========== Helper Methods ==========

  /**
   * 解析 Agent 引用
   */
  private async resolveAgent(agentRef: string): Promise<AgentInfo | null> {
    const plugin = this.plugin as unknown as PluginInternalAccess;
    
    // 新架构：优先使用 f2aClient
    let result;
    if (plugin.f2aClient) {
      result = await plugin.f2aClient.discoverAgents();
    } else {
      result = await plugin.networkClient.discoverAgents();
    }
    
    if (!result.success) return null;

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
   * 格式化广播结果
   */
  private formatBroadcastResults(results: BroadcastResult[]): string {
    return results.map(r => {
      const icon = r.success ? '✅' : '❌';
      const latency = r.latency ? ` (${r.latency}ms)` : '';
      return `${icon} ${r.agent}${latency}\n   ${r.success ? '完成' : `失败: ${r.error}`}`;
    }).join('\n\n');
  }

  // ========== 任务评估相关工具 ==========

  /**
   * 处理 f2a_estimate_task 工具
   * 评估任务成本
   */
  async handleEstimateTask(
    params: ToolHandlerParams['estimateTask'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.task_type || typeof params.task_type !== 'string' || params.task_type.trim() === '') {
      return { content: '❌ 请提供有效的 task_type 参数（任务类型）' };
    }
    if (!params.description || typeof params.description !== 'string' || params.description.trim() === '') {
      return { content: '❌ 请提供有效的 description 参数（任务描述）' };
    }

    // 基于任务类型和描述估算工作量
    const estimation = this.estimateTaskComplexity(
      params.task_type,
      params.description,
      params.required_capabilities || []
    );

    const content = `
📊 任务评估结果:

🏷️ 任务类型: ${params.task_type}
📝 描述: ${params.description.slice(0, 100)}${params.description.length > 100 ? '...' : ''}
🔧 所需能力: ${params.required_capabilities?.join(', ') || '无特定要求'}

📈 评估指标:
   • 工作量: ${estimation.workload}/100
   • 复杂度: ${estimation.complexity}/10
   • 预估时间: ${this.formatDuration(estimation.estimated_time_ms)}
   • 置信度: ${(estimation.confidence * 100).toFixed(0)}%
    `.trim();

    return {
      content,
      data: estimation
    };
  }

  /**
   * 处理 f2a_review_task 工具
   * 作为评审者评审任务
   */
  async handleReviewTask(
    params: ToolHandlerParams['reviewTask'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.task_id || typeof params.task_id !== 'string' || params.task_id.trim() === '') {
      return { content: '❌ 请提供有效的 task_id 参数' };
    }
    if (typeof params.workload !== 'number' || params.workload < 0 || params.workload > 100) {
      return { content: '❌ workload 参数必须是 0-100 之间的数字' };
    }
    if (typeof params.value !== 'number' || params.value < -100 || params.value > 100) {
      return { content: '❌ value 参数必须是 -100 到 100 之间的数字' };
    }

    const reviewCommittee = (this.plugin as unknown as PluginInternalAccess).reviewCommittee;
    const reputationSystem = (this.plugin as unknown as PluginInternalAccess).reputationSystem;
    
    if (!reviewCommittee) {
      return { content: '❌ 评审系统未初始化' };
    }

    // 获取评审者 ID（从 context 或使用默认）
    const reviewerId = context.sessionId || 'anonymous-reviewer';

    // 检查评审者资格
    if (!reputationSystem.hasPermission(reviewerId, 'review')) {
      return { content: '❌ 您的信誉等级不足以进行评审' };
    }

    // 提交评审
    const result = reviewCommittee.submitReview({
      taskId: params.task_id,
      reviewerId,
      dimensions: {
        workload: params.workload,
        value: params.value
      },
      riskFlags: params.risk_flags,
      comment: params.comment,
      timestamp: Date.now()
    });

    if (!result.success) {
      return { content: `❌ 评审提交失败: ${result.message}` };
    }

    // 检查评审是否完成
    const isComplete = reviewCommittee.isReviewComplete(params.task_id);
    
    const content = `
✅ 评审已提交

📋 任务ID: ${params.task_id.slice(0, 16)}...
📊 您的评审:
   • 工作量: ${params.workload}/100
   • 价值分: ${params.value}
   ${params.risk_flags?.length ? `• 风险标记: ${params.risk_flags.join(', ')}` : ''}
   ${params.comment ? `• 评论: ${params.comment}` : ''}

${isComplete ? '🎉 评审已完成，可以使用 f2a_get_reviews 查看最终结果' : '⏳ 等待其他评审者...'}
    `.trim();

    return {
      content,
      data: {
        taskId: params.task_id,
        submitted: true,
        reviewComplete: isComplete
      }
    };
  }

  /**
   * 处理 f2a_get_reviews 工具
   * 获取任务的评审结果
   */
  async handleGetReviews(
    params: ToolHandlerParams['getReviews'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.task_id || typeof params.task_id !== 'string' || params.task_id.trim() === '') {
      return { content: '❌ 请提供有效的 task_id 参数' };
    }

    const reviewCommittee = (this.plugin as unknown as PluginInternalAccess).reviewCommittee;
    
    if (!reviewCommittee) {
      return { content: '❌ 评审系统未初始化' };
    }

    // 获取评审状态
    const pendingReview = reviewCommittee.getReviewStatus(params.task_id);
    
    if (!pendingReview) {
      // 尝试获取已完成的评审结果（如果存储了的话）
      return { content: `❌ 找不到任务 ${params.task_id.slice(0, 16)}... 的评审记录` };
    }

    // 检查是否完成
    if (pendingReview.reviews.length < pendingReview.requiredReviewers) {
      const content = `
⏳ 评审进行中

📋 任务ID: ${params.task_id.slice(0, 16)}...
📝 任务描述: ${pendingReview.taskDescription.slice(0, 100)}...
📊 进度: ${pendingReview.reviews.length}/${pendingReview.requiredReviewers}

已收到的评审:
${pendingReview.reviews.map((r: any, i: number) => 
  `  ${i + 1}. 工作量: ${r.dimensions.workload}, 价值: ${r.dimensions.value}`
).join('\n')}
      `.trim();
      
      return {
        content,
        data: {
          taskId: params.task_id,
          status: 'in_progress',
          current: pendingReview.reviews.length,
          required: pendingReview.requiredReviewers,
          reviews: pendingReview.reviews.map((r: any) => ({
            reviewerId: r.reviewerId.slice(0, 16) + '...',
            workload: r.dimensions.workload,
            value: r.dimensions.value,
            riskFlags: r.riskFlags,
            comment: r.comment
          }))
        }
      };
    }

    // 评审已完成，结算结果
    const result = reviewCommittee.finalizeReview(params.task_id);
    
    if (!result) {
      return { content: '❌ 无法结算评审结果' };
    }

    const content = `
🎉 评审完成

📋 任务ID: ${params.task_id.slice(0, 16)}...
📊 最终评估:
   • 最终工作量: ${result.finalWorkload.toFixed(1)}/100
   • 最终价值分: ${result.finalValue.toFixed(1)}
   • 评审人数: ${result.reviews.length}
   ${result.outliers.length > 0 ? `• 偏离评审: ${result.outliers.length} 个` : ''}

详细评审:
${result.reviews.map((r: any, i: number) => {
  const isOutlier = result.outliers.includes(r);
  const outlierMark = isOutlier ? ' ⚠️ (偏离)' : '';
  return `  ${i + 1}. 工作量: ${r.dimensions.workload}, 价值: ${r.dimensions.value}${outlierMark}`;
}).join('\n')}
    `.trim();

    return {
      content,
      data: {
        taskId: params.task_id,
        status: 'completed',
        finalWorkload: result.finalWorkload,
        finalValue: result.finalValue,
        reviewerCount: result.reviews.length,
        outlierCount: result.outliers.length
      }
    };
  }

  /**
   * 处理 f2a_get_capabilities 工具
   * 获取指定 Agent 的能力列表
   */
  async handleGetCapabilities(
    params: ToolHandlerParams['getCapabilities'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 需要提供 peer_id 或 agent_name 其中之一
    if (!params.peer_id && !params.agent_name) {
      return { content: '❌ 请提供 peer_id 或 agent_name 参数' };
    }

    // P1-1: 验证 peer_id 格式（如果提供了的话）
    if (params.peer_id && typeof params.peer_id === 'string' && !isValidPeerId(params.peer_id)) {
      // 注意：允许部分匹配（前缀），所以只检查基本格式
      // 基本检查：必须以 12D3KooW 开头
      const peerIdStr = params.peer_id as string;
      if (!peerIdStr.startsWith('12D3KooW')) {
        return { content: `❌ 无效的 peer_id 格式: ${peerIdStr.slice(0, 20)}...` };
      }
    }

    const networkClient = (this.plugin as unknown as PluginInternalAccess).networkClient;
    
    // 发现所有 agents
    const result = await networkClient.discoverAgents();
    
    if (!result.success) {
      return { content: `❌ 查询失败: ${result.error.message}` };
    }

    const agents = result.data || [];

    // 根据 peer_id 或 agent_name 查找
    let targetAgent: AgentInfo | undefined;
    
    if (params.peer_id) {
      // 精确匹配或前缀匹配
      targetAgent = agents.find((a: AgentInfo) => 
        a.peerId === params.peer_id || 
        a.peerId.startsWith(params.peer_id!)
      );
    } else if (params.agent_name) {
      // 精确匹配或模糊匹配
      targetAgent = agents.find((a: AgentInfo) => 
        a.displayName === params.agent_name ||
        (a.displayName?.toLowerCase().includes(params.agent_name!.toLowerCase()) ?? false)
      );
    }

    if (!targetAgent) {
      const searchBy = params.peer_id ? `peer_id=${params.peer_id}` : `agent_name=${params.agent_name}`;
      return { content: `❌ 找不到 Agent: ${searchBy}` };
    }

    const capabilities: AgentCapability[] = targetAgent.capabilities || [];

    const content = `
🔧 Agent 能力列表

📋 Agent: ${targetAgent.displayName}
🆔 Peer ID: ${targetAgent.peerId.slice(0, 24)}...

能力 (${capabilities.length} 个):
${capabilities.length > 0 
  ? capabilities.map((cap, i) => 
      `  ${i + 1}. ${cap.name}
     ${cap.description}
     ${cap.tools?.length ? `工具: ${cap.tools.join(', ')}` : ''}`
    ).join('\n')
  : '  暂无能力信息'}
    `.trim();

    return {
      content,
      data: {
        peerId: targetAgent.peerId,
        displayName: targetAgent.displayName,
        capabilities
      }
    };
  }

  // ========== 任务评估辅助方法 ==========

  /**
   * 估算任务复杂度
   * 基于任务类型、描述和所需能力进行估算
   */
  private estimateTaskComplexity(
    taskType: string,
    description: string,
    requiredCapabilities: string[]
  ): TaskEstimation {
    // 基础复杂度（根据任务类型）
    const typeComplexityMap: Record<string, number> = {
      'code-generation': 5,
      'code-review': 3,
      'file-operation': 2,
      'data-analysis': 6,
      'web-search': 2,
      'api-call': 3,
      'testing': 4,
      'documentation': 3,
      'debugging': 7,
      'refactoring': 6,
      'deployment': 5,
      'security-audit': 8
    };

    const baseComplexity = typeComplexityMap[taskType.toLowerCase()] || 4;

    // 描述长度影响复杂度
    const descLength = description.length;
    const descComplexityBonus = descLength > 500 ? 2 : descLength > 200 ? 1 : 0;

    // 所需能力数量影响复杂度
    const capComplexityBonus = requiredCapabilities.length > 3 ? 2 : requiredCapabilities.length > 1 ? 1 : 0;

    // 计算最终复杂度 (1-10)
    const complexity = Math.min(10, Math.max(1, baseComplexity + descComplexityBonus + capComplexityBonus));

    // 工作量估算 (0-100)
    // 基于复杂度和描述长度
    const workload = Math.min(100, Math.max(0, 
      complexity * 8 + Math.min(descLength / 20, 20)
    ));

    // 预估时间（毫秒）
    // 复杂度越高，时间越长
    const baseTime = 60000; // 1分钟基础
    const estimatedTimeMs = baseTime * complexity * (1 + requiredCapabilities.length * 0.3);

    // 置信度 (0-1)
    // 熟悉的任务类型置信度更高
    const isKnownType = taskType.toLowerCase() in typeComplexityMap;
    const confidence = isKnownType ? 0.8 : 0.5;

    return {
      workload: Math.round(workload),
      complexity,
      estimated_time_ms: Math.round(estimatedTimeMs),
      confidence
    };
  }

  /**
   * 格式化持续时间
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}min`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }
}