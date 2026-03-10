/**
 * F2A OpenClaw Connector - Tool Handlers
 * 工具处理器模块 - 处理 f2a_discover, f2a_delegate 等工具
 */

import type {
  SessionContext,
  ToolResult,
  AgentInfo,
  AgentCapability,
  TaskResponse,
  F2APluginConfig,
  OpenClawPluginApi
} from './types.js';
import type { F2AOpenClawAdapter } from './connector.js';
import type { QueuedTask } from './task-queue.js';
import type { ReputationSystem } from './reputation.js';
import type { F2ANetworkClient } from './network-client.js';
import type { F2ANodeManager } from './node-manager.js';
import type { TaskQueue } from './task-queue.js';
import type { AnnouncementQueue } from './announcement-queue.js';
import type { ReviewCommittee, TaskReview, RiskFlag, ReviewResult } from '../../src/core/review-committee.js';
import { pluginLogger as logger } from './logger.js';

/** 广播结果类型 */
interface BroadcastResult {
  agent: string;
  success: boolean;
  error?: string;
  latency?: number;
}

/**
 * Adapter 内部接口 - 用于类型安全的属性访问
 */
interface AdapterInternalAccess {
  networkClient: F2ANetworkClient;
  reputationSystem: ReputationSystem;
  nodeManager: F2ANodeManager;
  taskQueue: TaskQueue;
  announcementQueue: AnnouncementQueue;
  config: F2APluginConfig;
  api?: OpenClawPluginApi;
}

/**
 * 工具处理器参数类型
 */
export interface ToolHandlerParams {
  discover: { capability?: string; min_reputation?: number };
  delegate: { agent: string; task: string; context?: string; timeout?: number };
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
 */
export class ToolHandlers {
  constructor(private adapter: F2AOpenClawAdapter) {}

  /**
   * 处理 f2a_discover 工具
   * 发现 F2A 网络中的 Agents
   */
  async handleDiscover(
    params: ToolHandlerParams['discover'],
    context: SessionContext
  ): Promise<ToolResult> {
    const networkClient = (this.adapter as unknown as AdapterInternalAccess).networkClient;
    const reputationSystem = (this.adapter as unknown as AdapterInternalAccess).reputationSystem;
    
    const result = await networkClient.discoverAgents(params.capability);
    
    if (!result.success) {
      return { content: `发现失败: ${result.error}` };
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

  /**
   * 处理 f2a_delegate 工具
   * 委托任务给特定 Agent
   */
  async handleDelegate(
    params: ToolHandlerParams['delegate'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.agent || typeof params.agent !== 'string' || params.agent.trim() === '') {
      return { content: '❌ 请提供有效的 agent 参数（Agent ID、名称或 #索引）' };
    }
    if (!params.task || typeof params.task !== 'string' || params.task.trim() === '') {
      return { content: '❌ 请提供有效的 task 参数（任务描述）' };
    }
    
    const networkClient = (this.adapter as unknown as AdapterInternalAccess).networkClient;
    const reputationSystem = (this.adapter as unknown as AdapterInternalAccess).reputationSystem;
    
    // 解析 Agent 引用
    const targetAgent = await this.resolveAgent(params.agent);
    
    if (!targetAgent) {
      return { content: `❌ 找不到 Agent: ${params.agent}` };
    }

    // 检查信誉
    if (!reputationSystem.isAllowed(targetAgent.peerId)) {
      return { 
        content: `⚠️ ${targetAgent.displayName} 信誉过低 (${reputationSystem.getReputation(targetAgent.peerId).score})，建议谨慎委托`
      };
    }

    logger.info(`委托任务给 ${targetAgent.displayName}...`);

    const result = await networkClient.delegateTask({
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
      reputationSystem.recordFailure(targetAgent.peerId, 'unknown', result.error.message);
      return { content: `❌ 委托失败: ${result.error.message}` };
    }

    return {
      content: `✅ ${targetAgent.displayName} 已完成任务:\n\n${JSON.stringify(result.data, null, 2)}`,
      data: result.data
    };
  }

  /**
   * 处理 f2a_broadcast 工具
   * 广播任务给所有具备某能力的 Agents
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
      return { content: '❌ 请提供有效的 task 参数（任务描述）' };
    }
    
    const networkClient = (this.adapter as unknown as AdapterInternalAccess).networkClient;
    
    const discoverResult = await networkClient.discoverAgents(params.capability);
    
    if (!discoverResult.success || !discoverResult.data?.length) {
      return { content: `❌ 未发现具备 "${params.capability}" 能力的 Agents` };
    }

    const agents = discoverResult.data;
    logger.info(`广播任务给 ${agents.length} 个 Agents...`);

    // 并行委托
    const promises = agents.map(async (agent: AgentInfo) => {
      const start = Date.now();
      const result = await networkClient.delegateTask({
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
        error: result.success ? undefined : (result.error?.message || 'Unknown error'),
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

  /**
   * 处理 f2a_status 工具
   * 查看网络状态
   */
  async handleStatus(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const nodeManager = (this.adapter as unknown as AdapterInternalAccess).nodeManager;
    const networkClient = (this.adapter as unknown as AdapterInternalAccess).networkClient;
    const taskQueue = (this.adapter as unknown as AdapterInternalAccess).taskQueue;
    const reputationSystem = (this.adapter as unknown as AdapterInternalAccess).reputationSystem;
    
    const [nodeStatus, peersResult] = await Promise.all([
      nodeManager.getStatus(),
      networkClient.getConnectedPeers()
    ]);

    if (!nodeStatus.success) {
      return { content: `❌ 获取状态失败: ${nodeStatus.error}` };
    }

    const peers = peersResult.success ? (peersResult.data || []) : [];
    const taskStats = taskQueue.getStats();

    const content = `
🟢 F2A 状态: ${nodeStatus.data?.running ? '运行中' : '已停止'}
📡 本机 PeerID: ${nodeStatus.data?.peerId || 'N/A'}
⏱️ 运行时间: ${nodeStatus.data?.uptime ? Math.floor(nodeStatus.data.uptime / 60) + ' 分钟' : 'N/A'}
🔗 已连接 Peers: ${peers.length}
📋 任务队列: ${taskStats.pending} 待处理, ${taskStats.processing} 处理中, ${taskStats.completed} 已完成

${peers.map((p: any) => {
  const rep = reputationSystem.getReputation(p.peerId);
  return `  • ${p.agentInfo?.displayName || 'Unknown'} (信誉: ${rep.score})\n    ID: ${p.peerId.slice(0, 20)}...`;
}).join('\n')}
    `.trim();

    return { content, data: { status: nodeStatus.data, peers, taskStats } };
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
    
    const reputationSystem = (this.adapter as unknown as AdapterInternalAccess).reputationSystem;
    const config = (this.adapter as unknown as AdapterInternalAccess).config;
    
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
        config.security.blacklist = config.security.blacklist.filter(
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
    
    const taskQueue = (this.adapter as unknown as AdapterInternalAccess).taskQueue;
    
    let tasks: QueuedTask[];
    
    if (params.status) {
      // 按状态过滤时不改变任务状态（只是查看）
      tasks = taskQueue.getAll().filter((t: QueuedTask) => t.status === params.status);
    } else {
      // 默认返回待处理任务，并标记为 processing（防止重复执行）
      tasks = taskQueue.getPending(params.limit || 10);
      
      // 将返回的任务标记为 processing，防止重复获取
      for (const task of tasks) {
        taskQueue.markProcessing(task.taskId);
      }
      
      if (tasks.length > 0) {
        logger.info(`已将 ${tasks.length} 个任务标记为 processing`);
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
    
    const taskQueue = (this.adapter as unknown as AdapterInternalAccess).taskQueue;
    const networkClient = (this.adapter as unknown as AdapterInternalAccess).networkClient;
    const reputationSystem = (this.adapter as unknown as AdapterInternalAccess).reputationSystem;
    
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
    const taskQueue = (this.adapter as unknown as AdapterInternalAccess).taskQueue;
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
    const networkClient = (this.adapter as unknown as AdapterInternalAccess).networkClient;
    const result = await networkClient.discoverAgents();
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
      a.displayName.toLowerCase().includes(agentRef.toLowerCase())
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

    const reviewCommittee = (this.adapter as unknown as AdapterInternalAccess).reviewCommittee;
    const reputationSystem = (this.adapter as unknown as AdapterInternalAccess).reputationSystem;
    
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

    const reviewCommittee = (this.adapter as unknown as AdapterInternalAccess).reviewCommittee;
    
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
${pendingReview.reviews.map((r, i) => 
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
          reviews: pendingReview.reviews.map(r => ({
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
${result.reviews.map((r, i) => {
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

    const networkClient = (this.adapter as unknown as AdapterInternalAccess).networkClient;
    
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
        a.displayName.toLowerCase().includes(params.agent_name!.toLowerCase())
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