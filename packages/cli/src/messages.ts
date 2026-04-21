/**
 * F2A CLI - 消息命令
 * f2a message send / list / clear
 * 
 * Challenge-Response 签名认证
 * - 按 agentId 查找本地身份文件
 * - 签名 Challenge 发送消息
 */

import { sendRequest } from './http-client.js';
import { join } from 'path';
import { readIdentityByAgentId, AGENT_IDENTITIES_DIR } from './init.js';
import type { RFC008IdentityFile, Challenge, ChallengeResponse } from '@f2a/network';
import { signChallenge } from '@f2a/network';

/**
 * Challenge-Response 认证流程
 */
async function challengeResponseFlow(
  identity: RFC008IdentityFile,
  initialResult: Record<string, unknown>,
  messagePayload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const challenge = initialResult.challenge as Challenge | undefined;
  
  if (!challenge) {
    return initialResult;
  }

  const response: ChallengeResponse = signChallenge(challenge, identity.privateKey);

  const finalPayload = {
    ...messagePayload,
    challengeResponse: response,
    publicKey: identity.publicKey,
  };

  return sendRequest('POST', '/api/v1/messages', finalPayload);
}

/**
 * 发送消息
 * f2a message send --agent-id <agentId> --to <agentId> [--type <type>] <content>
 */
export async function sendMessage(options: {
  /** Agent ID（必填） */
  agentId: string;
  toAgentId?: string;
  content: string;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { agentId, toAgentId, content, type, metadata } = options;

  if (!agentId) {
    console.error('❌ 缺少 --agent-id 参数');
    console.error('用法: f2a message send --agent-id <agentId> --to <agentId> "content"');
    process.exit(1);
  }

  if (!content) {
    console.error('❌ 缺少消息内容');
    console.error('用法: f2a message send --agent-id <agentId> --to <agentId> "content"');
    process.exit(1);
  }

  const identity = readIdentityByAgentId(agentId);

  if (!identity) {
    console.error('❌ 找不到身份文件');
    console.error(`   AgentId: ${agentId}`);
    console.error('请先运行: f2a agent init --name <name> --webhook <url>');
    process.exit(1);
  }

  const messagePayload = {
    fromAgentId: agentId,
    toAgentId,
    content,
    type: type || 'message',
    metadata,
    publicKey: identity.publicKey,
  };

  try {
    const initialResult = await sendRequest('POST', '/api/v1/messages', messagePayload);

    if (initialResult.challenge) {
      const finalResult = await challengeResponseFlow(identity, initialResult, messagePayload);
      handleSendResult(finalResult, agentId, toAgentId);
    } else {
      handleSendResult(initialResult, agentId, toAgentId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 处理发送结果
 */
function handleSendResult(
  result: Record<string, unknown>,
  fromAgentId: string,
  toAgentId?: string
): void {
  if (result.success) {
    console.log('✅ 消息已发送');
    console.log(`   From: ${fromAgentId}`);
    if (toAgentId) {
      console.log(`   To: ${toAgentId}`);
    } else {
      console.log('   To: (broadcast)');
    }
    if (result.messageId) {
      console.log(`   Message ID: ${result.messageId}`);
    }
  } else {
    console.error(`❌ 发送失败: ${result.error}`);
    if (result.code === 'AGENT_NOT_REGISTERED') {
      console.error('提示: 请确保 Agent 已注册');
    }
    process.exit(1);
  }
}

/**
 * 查看消息
 * f2a message list --agent-id <agentId> [--unread] [--limit <n>]
 */
export async function getMessages(options: {
  /** Agent ID（必填） */
  agentId: string;
  unread?: boolean;
  from?: string;
  limit?: number;
}): Promise<void> {
  if (!options.agentId) {
    console.error('❌ 缺少 --agent-id 参数');
    console.error('用法: f2a message list --agent-id <agentId>');
    process.exit(1);
  }

  const limit = options.limit || 50;

  try {
    const result = await sendRequest('GET', `/api/v1/messages/${options.agentId}?limit=${limit}`);

    if (result.success && result.messages) {
      const messages = result.messages as Array<{
        fromAgentId?: string;
        toAgentId?: string;
        content: string;
        type?: string;
        createdAt?: string;
        read?: boolean;
      }>;
      
      const filtered = options.unread
        ? messages.filter(m => !m.read)
        : options.from
          ? messages.filter(m => m.fromAgentId?.includes(options.from!))
          : messages;

      if (filtered.length === 0) {
        console.log('📭 没有消息');
        return;
      }

      console.log(`📨 消息 (${filtered.length}):`);
      console.log('');

      for (const msg of filtered.slice(0, limit)) {
        const from = msg.fromAgentId || 'unknown';
        const to = msg.toAgentId || 'broadcast';
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
    console.error(`❌ 无法连接到 Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 清除消息
 * f2a message clear --agent-id <agentId>
 */
export async function clearMessages(options: {
  /** Agent ID（必填） */
  agentId: string;
  messageIds?: string[];
}): Promise<void> {
  if (!options.agentId) {
    console.error('❌ 缺少 --agent-id 参数');
    console.error('用法: f2a message clear --agent-id <agentId>');
    process.exit(1);
  }

  try {
    const result = await sendRequest(
      'DELETE',
      `/api/v1/messages/${options.agentId}`,
      options.messageIds ? { messageIds: options.messageIds } : undefined
    );

    if (result.success) {
      console.log(`✅ 已清除 ${result.cleared || 0} 条消息`);
    } else {
      console.error(`❌ 清除失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}