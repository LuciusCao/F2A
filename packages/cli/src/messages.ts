/**
 * F2A CLI - 消息命令
 * f2a message send / f2a messages
 * 
 * RFC008 Phase 2: 使用 Challenge-Response 签名认证
 * - 必须指定 --agent-identity 参数
 * - 请求发送消息 → Daemon 返回 Challenge
 * - CLI 使用 privateKey 签名 Challenge
 * - CLI 发送 ChallengeResponse
 */

import { sendRequest } from './http-client.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { readIdentityFile } from './init.js';
import { RFC008IdentityFile, Challenge, ChallengeResponse, signChallenge } from '@f2a/network';

const F2A_DATA_DIR = join(homedir(), '.f2a');

/**
 * 更新身份文件的 lastActiveAt
 */
function updateLastActiveAt(identityPath: string): void {
  try {
    const identity = JSON.parse(readFileSync(identityPath, 'utf-8'));
    identity.lastActiveAt = new Date().toISOString();
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch {
    // 忽略更新失败
  }
}

/**
 * RFC008 Challenge-Response 认证流程
 * 
 * @param identity 身份文件
 * @param identityPath 身份文件路径
 * @param initialResult 初始请求返回的 Challenge
 * @param messagePayload 消息内容
 * @returns 最终请求结果
 */
async function challengeResponseFlow(
  identity: RFC008IdentityFile,
  identityPath: string,
  initialResult: Record<string, unknown>,
  messagePayload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // 检查是否返回了 Challenge
  const challenge = initialResult.challenge as Challenge | undefined;
  
  if (!challenge) {
    // 没有 Challenge，可能是旧版 Daemon 或其他错误
    return initialResult;
  }

  // 使用 privateKey 签名 Challenge
  const response: ChallengeResponse = signChallenge(challenge, identity.privateKey);

  // 发送带 ChallengeResponse 的请求
  const finalPayload = {
    ...messagePayload,
    challengeResponse: response,
    publicKey: identity.publicKey,
  };

  const result = await sendRequest('POST', '/api/v1/messages', finalPayload);
  
  // 更新 lastActiveAt
  updateLastActiveAt(identityPath);
  
  return result;
}

/**
 * 发送消息到指定 Agent
 * f2a message send --agent-identity <path> --to <agent_id> [--type <type>] <content>
 * 
 * RFC008 Phase 2: 必须指定身份文件
 */
export async function sendMessage(options: {
  /** 身份文件路径（必填） */
  agentIdentity: string;
  toAgentId?: string;
  content: string;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { agentIdentity, toAgentId, content, type, metadata } = options;

  // agentIdentity 必填
  if (!agentIdentity) {
    console.error('❌ 错误：缺少 --agent-identity 参数');
    console.error('用法：f2a message send --agent-identity <path> --to <agent_id> "消息内容"');
    process.exit(1);
  }

  if (!content) {
    console.error('❌ 错误：缺少消息内容');
    console.error('用法：f2a message send --agent-identity <path> --to <agent_id> "消息内容"');
    process.exit(1);
  }

  // 读取身份文件
  const identity = readIdentityFile(agentIdentity);

  if (!identity) {
    console.error('❌ 错误：找不到身份文件');
    console.error(`   Path: ${agentIdentity}`);
    console.error('请先运行: f2a agent init --name <name> --agent-identity <path>');
    process.exit(1);
  }

  const fromAgentId = identity.agentId;

  const messagePayload = {
    fromAgentId,
    toAgentId,
    content,
    type: type || 'message',
    metadata,
    publicKey: identity.publicKey,  // RFC008: 包含公钥
  };

  try {
    // 第一次请求：Daemon 可能返回 Challenge
    const initialResult = await sendRequest('POST', '/api/v1/messages', messagePayload);

    // 如果返回 Challenge，进行 Challenge-Response 流程
    if (initialResult.challenge) {
      const finalResult = await challengeResponseFlow(identity, agentIdentity, initialResult, messagePayload);
      handleSendResult(finalResult, fromAgentId, toAgentId);
    } else {
      // 直接成功或失败
      handleSendResult(initialResult, fromAgentId, toAgentId);
      updateLastActiveAt(agentIdentity);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
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
    console.log(`✅ 消息已发送`);
    console.log(`   From: ${fromAgentId.slice(0, 24)}...`);
    if (toAgentId) {
      console.log(`   To: ${toAgentId.slice(0, 24)}...`);
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
    } else if (result.code === 'CHALLENGE_FAILED') {
      console.error('提示：身份验证失败，请检查私钥是否正确');
    }
    process.exit(1);
  }
}

/**
 * 查看消息
 * f2a message list --agent-identity <path> [--unread] [--limit <n>]
 * 
 * P2-4: 使用 GET /api/v1/messages/:agentId 版本化端点
 */
export async function getMessages(options: {
  /** 身份文件路径（必填） */
  agentIdentity: string;
  unread?: boolean;
  from?: string;
  limit?: number;
}): Promise<void> {
  // agentIdentity 必填
  if (!options.agentIdentity) {
    console.error('❌ 错误：缺少 --agent-identity 参数');
    console.error('用法：f2a message list --agent-identity <path>');
    process.exit(1);
  }

  // 读取身份文件
  const identity = readIdentityFile(options.agentIdentity);

  if (!identity) {
    console.error('❌ 错误：找不到身份文件');
    console.error(`   Path: ${options.agentIdentity}`);
    process.exit(1);
  }

  const agentId = identity.agentId;
  const limit = options.limit || 50;

  try {
    const result = await sendRequest('GET', `/api/v1/messages/${agentId}?limit=${limit}`);

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

      console.log(`📨 消息 (${filtered.length} 条):`);
      console.log('');

      for (const msg of filtered.slice(0, limit)) {
        const from = msg.fromAgentId ? `${msg.fromAgentId.slice(0, 24)}...` : 'unknown';
        const to = msg.toAgentId ? `${msg.toAgentId.slice(0, 24)}...` : 'broadcast';
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
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 清除消息
 * f2a message clear --agent-identity <path> [--ids <msg_id1,msg_id2>]
 */
export async function clearMessages(options: {
  /** 身份文件路径（必填） */
  agentIdentity: string;
  messageIds?: string[];
}): Promise<void> {
  // agentIdentity 必填
  if (!options.agentIdentity) {
    console.error('❌ 错误：缺少 --agent-identity 参数');
    console.error('用法：f2a message clear --agent-identity <path>');
    process.exit(1);
  }

  // 读取身份文件
  const identity = readIdentityFile(options.agentIdentity);

  if (!identity) {
    console.error('❌ 错误：找不到身份文件');
    console.error(`   Path: ${options.agentIdentity}`);
    process.exit(1);
  }

  const agentId = identity.agentId;

  try {
    const result = await sendRequest(
      'DELETE',
      `/api/v1/messages/${agentId}`,
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
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}