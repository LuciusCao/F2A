/**
 * F2A MCP Server - Discovery Tools
 * 实现 Agent 列表查询和状态查询两个 MCP Tool
 */

import { sendRequest } from '../http-client.js';

// ============================================================================
// Tool Schemas
// ============================================================================

export const listAgentsTool = {
  name: 'f2a_list_agents',
  description: '列出 F2A 网络中已注册的 Agent',
  inputSchema: {
    type: 'object' as const,
    properties: {
      capability: {
        type: 'string',
        description: '可选，按能力名称过滤 Agent',
      },
    },
  },
};

export const getAgentStatusTool = {
  name: 'f2a_get_agent_status',
  description: '获取指定 Agent 的详情和消息队列状态',
  inputSchema: {
    type: 'object' as const,
    properties: {
      agentId: {
        type: 'string',
        description: '要查询的 Agent ID',
      },
    },
    required: ['agentId'],
  },
};

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * 列出 Agent
 */
export async function handleListAgents(args: {
  capability?: string;
}): Promise<string> {
  const result = await sendRequest('GET', '/api/v1/agents');

  if (!result.success) {
    return `❌ 获取 Agent 列表失败：${result.error || '未知错误'}`;
  }

  const agents = (result.agents ?? []) as Array<{
    agentId?: string;
    name?: string;
    capabilities?: Array<{ name: string; version?: string }>;
    registeredAt?: string;
    lastActiveAt?: string;
    webhook?: string | { url: string };
  }>;

  let filtered = agents;
  if (args.capability) {
    filtered = agents.filter((a) =>
      (a.capabilities ?? []).some((c) => c.name === args.capability)
    );
  }

  if (filtered.length === 0) {
    return args.capability
      ? `📭 未找到具备「${args.capability}」能力的 Agent。`
      : '📭 网络中暂无已注册的 Agent。';
  }

  const lines: string[] = [
    `🌐 共 ${filtered.length} 个 Agent${args.capability ? `（过滤条件: ${args.capability}）` : ''}：`,
    '',
  ];

  for (const agent of filtered) {
    const id = agent.agentId || 'unknown';
    const name = agent.name || 'unnamed';
    const caps = (agent.capabilities ?? [])
      .map((c) => `${c.name}${c.version ? `@${c.version}` : ''}`)
      .join(', ') || 'none';
    const registered = agent.registeredAt
      ? new Date(agent.registeredAt).toLocaleString('zh-CN')
      : 'unknown';
    const active = agent.lastActiveAt
      ? new Date(agent.lastActiveAt).toLocaleString('zh-CN')
      : 'unknown';
    const webhookUrl =
      typeof agent.webhook === 'string'
        ? agent.webhook
        : agent.webhook?.url || 'none';

    lines.push(`• ${name} (${id})`);
    lines.push(`  能力: ${caps}`);
    lines.push(`  注册时间: ${registered}`);
    lines.push(`  最后活跃: ${active}`);
    lines.push(`  Webhook: ${webhookUrl}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 获取 Agent 状态
 */
export async function handleGetAgentStatus(args: {
  agentId: string;
}): Promise<string> {
  const result = await sendRequest('GET', `/api/v1/agents/${encodeURIComponent(args.agentId)}`);

  if (!result.success) {
    return `❌ 获取 Agent 状态失败：${result.error || '未知错误'}`;
  }

  const agent = result.agent as
    | {
        agentId?: string;
        name?: string;
        capabilities?: Array<{ name: string; version?: string }>;
        registeredAt?: string;
        lastActiveAt?: string;
        webhook?: string | { url: string };
      }
    | undefined;

  const queue = result.queue as
    | { size?: number; maxSize?: number }
    | undefined;

  if (!agent) {
    return `⚠️ 未找到 Agent「${args.agentId}」的详细信息。`;
  }

  const id = agent.agentId || args.agentId;
  const name = agent.name || 'unnamed';
  const caps = (agent.capabilities ?? [])
    .map((c) => `${c.name}${c.version ? `@${c.version}` : ''}`)
    .join(', ') || 'none';
  const registered = agent.registeredAt
    ? new Date(agent.registeredAt).toLocaleString('zh-CN')
    : 'unknown';
  const active = agent.lastActiveAt
    ? new Date(agent.lastActiveAt).toLocaleString('zh-CN')
    : 'unknown';
  const webhookUrl =
    typeof agent.webhook === 'string'
      ? agent.webhook
      : agent.webhook?.url || 'none';

  const queueSize = queue?.size ?? 'unknown';
  const queueMax = queue?.maxSize ?? 'unknown';

  const lines: string[] = [
    `📋 Agent 详情：${name} (${id})`,
    '',
    `• 能力: ${caps}`,
    `• 注册时间: ${registered}`,
    `• 最后活跃: ${active}`,
    `• Webhook: ${webhookUrl}`,
    '',
    `📬 消息队列：${queueSize} / ${queueMax}`,
  ];

  return lines.join('\n');
}
