/**
 * F2A OpenClaw Connector - Tool Handlers
 * 工具处理器模块 - 处理 f2a_discover, f2a_delegate 等工具
 */

import type {
  SessionContext,
  ToolResult,
  AgentInfo,
  TaskResponse
} from './types.js';
import type { F2AOpenClawAdapter } from './connector.js';
import type { QueuedTask } from './task-queue.js';
import { pluginLogger as logger } from './logger.js';

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
    const networkClient = (this.adapter as any).networkClient;
    const reputationSystem = (this.adapter as any).reputationSystem;
    
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
    const networkClient = (this.adapter as any).networkClient;
    const reputationSystem = (this.adapter as any).reputationSystem;
    
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
      reputationSystem.recordFailure(targetAgent.peerId, 'unknown', result.error);
      return { content: `❌ 委托失败: ${result.error}` };
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
    const networkClient = (this.adapter as any).networkClient;
    
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

  /**
   * 处理 f2a_status 工具
   * 查看网络状态
   */
  async handleStatus(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const nodeManager = (this.adapter as any).nodeManager;
    const networkClient = (this.adapter as any).networkClient;
    const taskQueue = (this.adapter as any).taskQueue;
    const reputationSystem = (this.adapter as any).reputationSystem;
    
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
    const reputationSystem = (this.adapter as any).reputationSystem;
    const config = (this.adapter as any).config;
    
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
    const taskQueue = (this.adapter as any).taskQueue;
    
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
    const taskQueue = (this.adapter as any).taskQueue;
    const networkClient = (this.adapter as any).networkClient;
    const reputationSystem = (this.adapter as any).reputationSystem;
    
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
    const taskQueue = (this.adapter as any).taskQueue;
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
    const networkClient = (this.adapter as any).networkClient;
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
  private formatBroadcastResults(results: any[]): string {
    return results.map(r => {
      const icon = r.success ? '✅' : '❌';
      const latency = r.latency ? ` (${r.latency}ms)` : '';
      return `${icon} ${r.agent}${latency}\n   ${r.success ? '完成' : `失败: ${r.error}`}`;
    }).join('\n\n');
  }
}