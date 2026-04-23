/**
 * F2A MCP Server - Messaging Tools
 * 实现消息拉取、发送、清除三个 MCP Tool
 */

import { sendRequest } from '../http-client.js';
import { getAgentToken } from '../identity.js';

// ============================================================================
// Tool Schemas
// ============================================================================

export const pollMessagesTool = {
  name: 'f2a_poll_messages',
  description: '从 F2A 消息队列中拉取待处理消息',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agentId: {
        type: 'string',
        description: 'Agent ID，用于指定要拉取消息队列的 Agent',
      },
      limit: {
        type: 'number',
        description: '最多拉取的消息数量（默认 50）',
      },
    },
    required: ['agentId'],
  },
};

export const sendMessageTool = {
  name: 'f2a_send_message',
  description: '发送消息/回复到指定 F2A Agent',
  inputSchema: {
    type: 'object' as const,
    properties: {
      fromAgentId: {
        type: 'string',
        description: '发送方 Agent ID',
      },
      toAgentId: {
        type: 'string',
        description: '接收方 Agent ID',
      },
      content: {
        type: 'string',
        description: '消息内容',
      },
      type: {
        type: 'string',
        description: '消息类型（如 message、task_request，默认为 message）',
      },
    },
    required: ['fromAgentId', 'toAgentId', 'content'],
  },
};

export const clearMessagesTool = {
  name: 'f2a_clear_messages',
  description: '清除 Agent 的消息队列',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agentId: {
        type: 'string',
        description: '要清除消息的 Agent ID',
      },
      messageIds: {
        type: 'array',
        description: '可选，指定要删除的消息 ID 列表；不传则清空全部',
        items: { type: 'string' },
      },
    },
    required: ['agentId'],
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * 拉取消息
 */
export async function handlePollMessages(args: {
  agentId: string;
  limit?: number;
}): Promise<string> {
  const limit = args.limit ?? 50;
  const result = await sendRequest('GET', `/api/v1/messages/${encodeURIComponent(args.agentId)}?limit=${limit}`);

  if (!result.success) {
    return `❌ 拉取消息失败：${result.error || '未知错误'}`;
  }

  const messages = (result.messages ?? []) as Array<{
    messageId?: string;
    fromAgentId?: string;
    toAgentId?: string;
    content?: string;
    type?: string;
    createdAt?: string;
  }>;

  if (messages.length === 0) {
    return '📭 该 Agent 暂无消息。';
  }

  const lines: string[] = [`📨 共 ${messages.length} 条消息（Agent: ${args.agentId}）：`, ''];

  for (const msg of messages) {
    const from = msg.fromAgentId || 'unknown';
    const to = msg.toAgentId || 'broadcast';
    const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('zh-CN') : '未知时间';
    const msgType = msg.type || 'message';
    const msgId = msg.messageId ? ` [${msg.messageId}]` : '';

    lines.push(`[${msgType}]${msgId} ${from} → ${to} (${time})`);
    lines.push(`  ${msg.content || '(无内容)'}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 发送消息
 */
export async function handleSendMessage(args: {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  type?: string;
}): Promise<string> {
  const token = getAgentToken(args.fromAgentId);
  if (!token) {
    return `❌ 无法获取 Agent「${args.fromAgentId}」的 Token。请确认该 Agent 已注册且身份文件包含 token 字段。`;
  }

  const result = await sendRequest(
    'POST',
    '/api/v1/messages',
    {
      fromAgentId: args.fromAgentId,
      toAgentId: args.toAgentId,
      content: args.content,
      type: args.type || 'message',
    },
    { Authorization: `agent-${token}` }
  );

  if (!result.success) {
    return `❌ 发送消息失败：${result.error || '未知错误'}`;
  }

  return `✅ 消息发送成功。\n   发送方: ${args.fromAgentId}\n   接收方: ${args.toAgentId}\n   消息 ID: ${result.messageId || 'N/A'}`;
}

/**
 * 清除消息
 */
export async function handleClearMessages(args: {
  agentId: string;
  messageIds?: string[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.messageIds && args.messageIds.length > 0) {
    body.messageIds = args.messageIds;
  }

  const result = await sendRequest(
    'DELETE',
    `/api/v1/messages/${encodeURIComponent(args.agentId)}`,
    Object.keys(body).length > 0 ? body : undefined
  );

  if (!result.success) {
    return `❌ 清除消息失败：${result.error || '未知错误'}`;
  }

  return `✅ 已清除 ${result.cleared ?? 0} 条消息（Agent: ${args.agentId}）。`;
}
