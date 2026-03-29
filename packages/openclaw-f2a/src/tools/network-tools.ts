/**
 * F2A 网络工具定义
 * 
 * 包含网络发现、委托、广播、状态、信誉等工具。
 */

import type { Tool } from '../types.js';

/**
 * 获取网络相关工具定义
 */
export function getNetworkTools(
  handlers: {
    handleDiscover: Tool['handler'];
    handleDelegate: Tool['handler'];
    handleBroadcast: Tool['handler'];
    handleStatus: Tool['handler'];
    handleReputation: Tool['handler'];
  }
): Tool[] {
  return [
    {
      name: 'f2a_discover',
      description: '发现 F2A 网络中的 Agents，可以按能力过滤',
      parameters: {
        capability: {
          type: 'string',
          description: '按能力过滤，如 code-generation, file-operation',
          required: false,
        },
        min_reputation: {
          type: 'number',
          description: '最低信誉分数 (0-100)',
          required: false,
        },
      },
      handler: handlers.handleDiscover,
    },
    {
      name: 'f2a_delegate',
      description: '委托任务给网络中的特定 Agent',
      parameters: {
        agent: {
          type: 'string',
          description: '目标 Agent ID、名称或 #索引 (如 #1)',
          required: true,
        },
        task: {
          type: 'string',
          description: '任务描述',
          required: true,
        },
        context: {
          type: 'string',
          description: '任务上下文或附件',
          required: false,
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒）',
          required: false,
        },
      },
      handler: handlers.handleDelegate,
    },
    {
      name: 'f2a_broadcast',
      description: '广播任务给所有具备某能力的 Agents（并行执行）',
      parameters: {
        capability: {
          type: 'string',
          description: '所需能力',
          required: true,
        },
        task: {
          type: 'string',
          description: '任务描述',
          required: true,
        },
        min_responses: {
          type: 'number',
          description: '最少响应数',
          required: false,
        },
      },
      handler: handlers.handleBroadcast,
    },
    {
      name: 'f2a_status',
      description: '查看 F2A 网络状态和已连接 Peers',
      parameters: {},
      handler: handlers.handleStatus,
    },
    {
      name: 'f2a_reputation',
      description: '查看或管理 Peer 信誉',
      parameters: {
        action: {
          type: 'string',
          description: '操作: list, view, block, unblock',
          required: true,
          enum: ['list', 'view', 'block', 'unblock'],
        },
        peer_id: {
          type: 'string',
          description: 'Peer ID',
          required: false,
        },
      },
      handler: handlers.handleReputation,
    },
  ];
}