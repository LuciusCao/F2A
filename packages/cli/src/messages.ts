/**
 * F2A CLI - 消息命令
 * f2a message send / f2a messages
 * 
 * Phase 1 修复：使用正确的 /api/messages 端点
 */

import { sendRequest } from './http-client.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 获取 Agent Token（用于 Authorization header）
 * 从 ~/.f2a/agents/{agentId}.json 读取 token
 */
function getAgentToken(agentId: string): string | undefined {
  const dataDir = join(homedir(), '.f2a');
  const identityFile = join(dataDir, 'agents', `${agentId}.json`);
  
  if (!existsSync(identityFile)) {
    return undefined;
  }
  
  try {
    const identity = JSON.parse(readFileSync(identityFile, 'utf-8'));
    return identity.token as string | undefined;
  } catch {
    return undefined;
  }
}

/**
 * 发送消息到指定 Agent
 * f2a message send --from <agent_id> --to <agent_id> [--type <type>] <content>
 * 
 * Phase 1 修复：使用 POST /api/messages 端点
 * 需要 Authorization header: agent-{token}
 */
export async function sendMessage(options: {
  fromAgentId: string;
  toAgentId?: string;
  content: string;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { fromAgentId, toAgentId, content, type, metadata } = options;

  if (!fromAgentId) {
    console.error('❌ 错误：缺少 --from 参数');
    console.error('用法：f2a message send --from <agent_id> [--to <agent_id>] "消息内容"');
    process.exit(1);
  }

  if (!content) {
    console.error('❌ 错误：缺少消息内容');
    console.error('用法：f2a message send --from <agent_id> "消息内容"');
    process.exit(1);
  }

  // 获取 Agent Token
  const agentToken = getAgentToken(fromAgentId);
  if (!agentToken) {
    console.error(`❌ 错误：找不到 Agent ${fromAgentId} 的 token`);
    console.error('请先注册 Agent：f2a agent register --name <name>');
    process.exit(1);
  }

  try {
    // Phase 1 修复：使用 POST /api/messages 端点
    const result = await sendRequest(
      'POST',
      '/api/messages',
      {
        fromAgentId,
        toAgentId,
        content,
        type: type || 'message',
        metadata,
      },
      { Authorization: `agent-${agentToken}` }
    );

    if (result.success) {
      console.log(`✅ 消息已发送`);
      console.log(`   From: ${fromAgentId.slice(0, 16)}...`);
      if (toAgentId) {
        console.log(`   To: ${toAgentId.slice(0, 16)}...`);
      } else {
        console.log(`   To: (broadcast)`);
      }
      if (result.messageId) {
        console.log(`   Message ID: ${result.messageId}`);
      }
      if (result.broadcasted) {
        console.log(`   Broadcasted to ${result.broadcasted} agents`);
      }
    } else {
      console.error(`❌ 发送失败：${result.error}`);
      if (result.code === 'AGENT_NOT_REGISTERED') {
        console.error('提示：请确保发送方和接收方 Agent 已注册');
      }
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 查看消息
 * f2a message list [--agent <agent_id>] [--unread] [--limit <n>]
 * 
 * Phase 1：使用 GET /api/messages/:agentId 端点（已正确）
 */
export async function getMessages(options: {
  unread?: boolean;
  from?: string;
  limit?: number;
  agentId?: string;
}): Promise<void> {
  const agentId = options.agentId || 'default';
  const limit = options.limit || 50;

  try {
    const result = await sendRequest('GET', `/api/messages/${agentId}?limit=${limit}`);

    if (result.success && result.messages) {
      const messages = (result.messages as any[]);
      const filtered = options.unread
        ? messages.filter((m: any) => !m.read)
        : options.from
          ? messages.filter((m: any) => m.from?.includes(options.from!))
          : messages;

      if (filtered.length === 0) {
        console.log('📭 没有消息');
        return;
      }

      console.log(`📨 消息 (${filtered.length} 条):`);
      console.log('');

      for (const msg of filtered.slice(0, limit)) {
        const from = msg.fromAgentId ? `${msg.fromAgentId.slice(0, 16)}...` : 'unknown';
        const to = msg.toAgentId ? `${msg.toAgentId.slice(0, 16)}...` : 'broadcast';
        const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('zh-CN') : '';
        const msgType = msg.type || 'message';

        console.log(`[${msgType}] ${from} → ${to} (${time})`);
        console.log(`   ${msg.content}`);
        console.log('');
      }
    } else {
      console.log('📭 没有消息');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 清除消息
 * f2a message clear --agent <agent_id> [--ids <msg_id1,msg_id2>]
 */
export async function clearMessages(options: {
  agentId: string;
  messageIds?: string[];
}): Promise<void> {
  const agentId = options.agentId || 'default';

  try {
    const result = await sendRequest(
      'DELETE',
      `/api/messages/${agentId}`,
      options.messageIds ? { messageIds: options.messageIds } : undefined
    );

    if (result.success) {
      console.log(`✅ 已清除 ${result.cleared || 0} 条消息`);
    } else {
      console.error(`❌ 清除失败：${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}