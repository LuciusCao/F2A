/**
 * F2A CLI - 消息命令
 * f2a message send / f2a messages
 * 
 * RFC008 Phase 2: 使用 Challenge-Response 签名认证
 * - 请求发送消息 → Daemon 返回 Challenge
 * - CLI 使用 privateKey 签名 Challenge
 * - CLI 发送 ChallengeResponse
 * - 兼容旧 Token 认证方式
 */

import { sendRequest } from './http-client.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { readCallerConfig, readIdentityFile, AGENTS_DIR } from './init.js';
import { RFC008IdentityFile, Challenge, ChallengeResponse, signChallenge, isNewFormat } from '@f2a/network';

/**
 * 获取 Agent Token（用于 Authorization header）
 * 旧版兼容：从 ~/.f2a/agents/{agentId}.json 读取 token
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
 * 更新身份文件的 lastActiveAt
 */
function updateLastActiveAt(agentId: string): void {
  try {
    const identityFile = join(AGENTS_DIR, `${agentId}.json`);
    if (existsSync(identityFile)) {
      const identity = JSON.parse(readFileSync(identityFile, 'utf-8'));
      identity.lastActiveAt = new Date().toISOString();
      writeFileSync(identityFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
    }
  } catch {
    // 忽略更新失败
  }
}

/**
 * RFC008 Challenge-Response 认证流程
 * 
 * @param identity 身份文件
 * @param initialResult 初始请求返回的 Challenge
 * @param messagePayload 消息内容
 * @returns 最终请求结果
 */
async function challengeResponseFlow(
  identity: RFC008IdentityFile,
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

  return sendRequest('POST', '/api/v1/messages', finalPayload);
}

/**
 * 发送消息到指定 Agent
 * f2a message send --from <agent_id> --to <agent_id> [--type <type>] <content>
 * 
 * RFC008 Phase 2: 使用 Challenge-Response 签名认证
 * 
 * 流程：
 * 1. 如果有 Caller 配置（RFC008 新格式）：
 *    - 发送请求 → Daemon 返回 Challenge
 *    - 使用 privateKey 签名 → 发送 ChallengeResponse
 * 
 * 2. 如果没有 Caller 配置（旧格式）：
 *    - 使用 Token 认证（向后兼容）
 */
export async function sendMessage(options: {
  fromAgentId?: string;
  toAgentId?: string;
  content: string;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
  callerConfig?: string;
}): Promise<void> {
  const { toAgentId, content, type, metadata, callerConfig } = options;

  if (!content) {
    console.error('❌ 错误：缺少消息内容');
    console.error('用法：f2a message send [--from <agent_id>] --to <agent_id> "消息内容"');
    process.exit(1);
  }

  // 尝试读取 Caller 配置（RFC008）
  const callerCfg = readCallerConfig(callerConfig);
  let fromAgentId = options.fromAgentId;

  if (callerCfg) {
    // 使用 Caller 配置中的 agentId
    fromAgentId = callerCfg.agentId;
  }

  if (!fromAgentId) {
    console.error('❌ 错误：缺少 --from 参数');
    console.error('用法：');
    console.error('  RFC008: f2a message send --to <agent_id> "消息内容"');
    console.error('  旧格式: f2a message send --from <agent_id> --to <agent_id> "消息内容"');
    process.exit(1);
  }

  // 检查是否是 RFC008 新格式的 AgentId
  const isNewRFC008 = isNewFormat(fromAgentId);

  if (isNewRFC008) {
    // RFC008 Challenge-Response 流程
    const identity = readIdentityFile(fromAgentId);

    if (!identity) {
      console.error(`❌ 错误：找不到 Agent ${fromAgentId} 的身份文件`);
      console.error('请先运行: f2a agent init --name <name>');
      process.exit(1);
    }

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
        const finalResult = await challengeResponseFlow(identity, initialResult, messagePayload);
        handleSendResult(finalResult, fromAgentId, toAgentId);
      } else {
        // 直接成功或失败
        handleSendResult(initialResult, fromAgentId, toAgentId);
      }

      // 更新 lastActiveAt
      updateLastActiveAt(fromAgentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ 无法连接到 F2A Daemon：${message}`);
      console.error('请确保 Daemon 正在运行：f2a daemon start');
      process.exit(1);
    }
  } else {
    // 旧格式：使用 Token 认证
    const agentToken = getAgentToken(fromAgentId);
    if (!agentToken) {
      console.error(`❌ 错误：找不到 Agent ${fromAgentId} 的 token`);
      console.error('请先注册 Agent：f2a agent register --name <name>');
      process.exit(1);
    }

    try {
      const result = await sendRequest(
        'POST',
        '/api/v1/messages',
        {
          fromAgentId,
          toAgentId,
          content,
          type: type || 'message',
          metadata,
        },
        { Authorization: `agent-${agentToken}` }
      );

      handleSendResult(result, fromAgentId, toAgentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`❌ 无法连接到 F2A Daemon：${message}`);
      console.error('请确保 Daemon 正在运行：f2a daemon start');
      process.exit(1);
    }
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
    } else if (result.code === 'CHALLENGE_FAILED') {
      console.error('提示：身份验证失败，请检查私钥是否正确');
    }
    process.exit(1);
  }
}

/**
 * 查看消息
 * f2a message list [--agent <agent_id>] [--unread] [--limit <n>]
 * 
 * P2-4: 使用 GET /api/v1/messages/:agentId 版本化端点
 */
export async function getMessages(options: {
  unread?: boolean;
  from?: string;
  limit?: number;
  agentId?: string;
}): Promise<void> {
  // 尝试读取 Caller 配置（RFC008）
  const callerCfg = readCallerConfig();
  let agentId = options.agentId;

  if (!agentId && callerCfg) {
    // 使用 Caller 配置中的 agentId
    agentId = callerCfg.agentId;
  }

  if (!agentId) {
    console.error('❌ 错误：缺少 --agent 参数');
    console.error('用法：');
    console.error('  f2a message list --agent <agent_id>');
    console.error('  或先运行 f2a agent init 创建 Caller 配置');
    process.exit(1);
  }

  const limit = options.limit || 50;

  try {
    const result = await sendRequest('GET', `/api/v1/messages/${agentId}?limit=${limit}`);

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
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
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