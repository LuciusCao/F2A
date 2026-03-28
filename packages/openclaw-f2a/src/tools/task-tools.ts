/**
 * F2A 任务工具定义
 * 
 * 包含任务队列、公告、认领、评审等工具。
 */

import type { Tool } from '../types.js';

/**
 * 获取任务相关工具定义
 */
export function getTaskTools(
  handlers: {
    handlePollTasks: Tool['handler'];
    handleSubmitResult: Tool['handler'];
    handleTaskStats: Tool['handler'];
    handleAnnounce: Tool['handler'];
    handleListAnnouncements: Tool['handler'];
    handleClaim: Tool['handler'];
    handleManageClaims: Tool['handler'];
    handleMyClaims: Tool['handler'];
    handleAnnouncementStats: Tool['handler'];
    handleEstimateTask: Tool['handler'];
    handleReviewTask: Tool['handler'];
    handleGetReviews: Tool['handler'];
    handleGetCapabilities: Tool['handler'];
  }
): Tool[] {
  return [
    {
      name: 'f2a_poll_tasks',
      description: '查询本节点收到的远程任务队列（待 OpenClaw 执行）',
      parameters: {
        limit: {
          type: 'number',
          description: '最大返回任务数',
          required: false,
        },
        status: {
          type: 'string',
          description: '任务状态过滤: pending, processing, completed, failed',
          required: false,
          enum: ['pending', 'processing', 'completed', 'failed'],
        },
      },
      handler: handlers.handlePollTasks,
    },
    {
      name: 'f2a_submit_result',
      description: '提交远程任务的执行结果，发送给原节点',
      parameters: {
        task_id: {
          type: 'string',
          description: '任务ID',
          required: true,
        },
        result: {
          type: 'string',
          description: '任务执行结果',
          required: true,
        },
        status: {
          type: 'string',
          description: '执行状态: success 或 error',
          required: true,
          enum: ['success', 'error'],
        },
      },
      handler: handlers.handleSubmitResult,
    },
    {
      name: 'f2a_task_stats',
      description: '查看任务队列统计信息',
      parameters: {},
      handler: handlers.handleTaskStats,
    },
    {
      name: 'f2a_announce',
      description: '广播任务到 F2A 网络，等待其他 Agent 认领（认领模式）',
      parameters: {
        task_type: {
          type: 'string',
          description: '任务类型',
          required: true,
        },
        description: {
          type: 'string',
          description: '任务描述',
          required: true,
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒）',
          required: false,
        },
        reward: {
          type: 'number',
          description: '任务奖励',
          required: false,
        },
        required_capabilities: {
          type: 'array',
          description: '所需能力列表',
          required: false,
        },
        estimated_complexity: {
          type: 'number',
          description: '预估复杂度 (1-10)',
          required: false,
        },
      },
      handler: handlers.handleAnnounce,
    },
    {
      name: 'f2a_list_announcements',
      description: '查看当前开放的任务广播（可认领）',
      parameters: {
        capability: {
          type: 'string',
          description: '按能力过滤',
          required: false,
        },
        limit: {
          type: 'number',
          description: '最大返回数量',
          required: false,
        },
      },
      handler: handlers.handleListAnnouncements,
    },
    {
      name: 'f2a_claim',
      description: '认领一个开放的任务广播',
      parameters: {
        announcement_id: {
          type: 'string',
          description: '广播ID',
          required: true,
        },
        estimated_time: {
          type: 'number',
          description: '预计完成时间（毫秒）',
          required: false,
        },
        confidence: {
          type: 'number',
          description: '信心指数 (0-1)',
          required: false,
        },
      },
      handler: handlers.handleClaim,
    },
    {
      name: 'f2a_manage_claims',
      description: '管理我的任务广播的认领（接受/拒绝）',
      parameters: {
        action: {
          type: 'string',
          description: '操作: list, accept, reject',
          required: true,
          enum: ['list', 'accept', 'reject'],
        },
        announcement_id: {
          type: 'string',
          description: '广播ID',
          required: true,
        },
        claim_id: {
          type: 'string',
          description: '认领ID（accept/reject 时需要）',
          required: false,
        },
      },
      handler: handlers.handleManageClaims,
    },
    {
      name: 'f2a_my_claims',
      description: '查看我提交的任务认领状态',
      parameters: {
        status: {
          type: 'string',
          description: '状态过滤: pending, accepted, rejected, all',
          required: false,
          enum: ['pending', 'accepted', 'rejected', 'all'],
        },
      },
      handler: handlers.handleMyClaims,
    },
    {
      name: 'f2a_announcement_stats',
      description: '查看任务广播统计',
      parameters: {},
      handler: handlers.handleAnnouncementStats,
    },
    {
      name: 'f2a_estimate_task',
      description: '评估任务成本（工作量、复杂度、预估时间）',
      parameters: {
        task_type: {
          type: 'string',
          description: '任务类型',
          required: true,
        },
        description: {
          type: 'string',
          description: '任务描述',
          required: true,
        },
        required_capabilities: {
          type: 'array',
          description: '所需能力列表',
          required: false,
        },
      },
      handler: handlers.handleEstimateTask,
    },
    {
      name: 'f2a_review_task',
      description: '作为评审者评审任务的工作量和价值',
      parameters: {
        task_id: {
          type: 'string',
          description: '任务ID',
          required: true,
        },
        workload: {
          type: 'number',
          description: '工作量评估 (0-100)',
          required: true,
        },
        value: {
          type: 'number',
          description: '价值评估 (-100 ~ 100)',
          required: true,
        },
        comment: {
          type: 'string',
          description: '评审意见',
          required: false,
        },
        risk_flags: {
          type: 'array',
          description: '风险标记: dangerous, malicious, spam, invalid',
          required: false,
        },
      },
      handler: handlers.handleReviewTask,
    },
    {
      name: 'f2a_get_reviews',
      description: '获取任务的评审汇总结果',
      parameters: {
        task_id: {
          type: 'string',
          description: '任务ID',
          required: true,
        },
      },
      handler: handlers.handleGetReviews,
    },
    {
      name: 'f2a_get_capabilities',
      description: '获取指定 Agent 的能力列表',
      parameters: {
        peer_id: {
          type: 'string',
          description: 'Agent 的 Peer ID 或名称',
          required: false,
        },
      },
      handler: handlers.handleGetCapabilities,
    },
  ];
}