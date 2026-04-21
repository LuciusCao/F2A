/**
 * F2A CLI - Agent 管理命令
 * f2a agent register / list / unregister
 * 
 * Challenge-Response 注册流程
 * - 按 agentId 查找本地身份文件
 * - 发送 publicKey 到 Daemon
 * - 接收 nodeSignature 并保存
 */

import { sendRequest } from './http-client.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { readIdentityByAgentId, AGENT_IDENTITIES_DIR } from './init.js';
import type { RFC008IdentityFile, Challenge, ChallengeResponse } from '@f2a/network';
import { signChallenge } from '@f2a/network';

/**
 * 更新身份文件（添加 nodeSignature）
 */
function updateIdentityWithNodeSignature(
  agentId: string,
  identity: RFC008IdentityFile,
  nodeSignature: string,
  nodePeerId: string
): boolean {
  try {
    identity.nodeSignature = nodeSignature;
    identity.nodePeerId = nodePeerId;
    identity.lastActiveAt = new Date().toISOString();
    
    const identityPath = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 注册 Agent
 * f2a agent register --agent-id <agentId> [--force]
 * 
 * Challenge-Response 注册流程：
 * - 按 agentId 查找本地身份文件
 * - 发送 publicKey 到 Daemon 进行注册
 * - 接收 nodeSignature 并保存
 */
export async function registerAgent(options: {
  /** Agent ID（必填） */
  agentId: string;
  force?: boolean;
}): Promise<void> {
  if (!options.agentId) {
    console.error('❌ 缺少 --agent-id 参数');
    console.error('用法：f2a agent register --agent-id <agentId>');
    process.exit(1);
  }

  const identity = readIdentityByAgentId(options.agentId);

  if (!identity) {
    console.error('❌ 找不到身份文件');
    console.error(`   AgentId: ${options.agentId}`);
    console.error('请先运行: f2a agent init --name <name> --webhook <url>');
    process.exit(1);
  }

  // 检查是否已注册
  if (identity.nodeSignature && !options.force) {
    console.log('✅ Agent 已注册');
    console.log(`   AgentId: ${identity.agentId}`);
    console.log(`   Node PeerId: ${identity.nodePeerId || 'N/A'}`);
    console.log('   使用 --force 强制重新注册');
    return;
  }

  try {
    const capabilities = (identity.capabilities || []).map((c: { name: string; version: string } | string) => ({
      name: typeof c === 'string' ? c : c.name,
      version: '1.0.0',
      description: ''
    }));

    const requestBody = {
      agentId: identity.agentId,
      publicKey: identity.publicKey,
      name: identity.name || 'unnamed',
      capabilities,
      webhook: identity.webhook,
    };

    const result = await sendRequest('POST', '/api/v1/agents', requestBody);

    if (result.success) {
      const nodeSignature = result.nodeSignature as string | undefined;
      const nodePeerId = result.nodePeerId as string | undefined;

      if (nodeSignature && nodePeerId) {
        updateIdentityWithNodeSignature(options.agentId, identity, nodeSignature, nodePeerId);
      }

      console.log('✅ Agent 已注册');
      console.log(`   AgentId: ${identity.agentId}`);
      console.log(`   Name: ${identity.name || 'N/A'}`);
      if (capabilities.length > 0) {
        console.log(`   Capabilities: ${capabilities.map((c: { name: string }) => c.name).join(', ')}`);
      }
      if (identity.webhook) {
        console.log(`   Webhook: ${identity.webhook.url}`);
      }
      if (nodePeerId) {
        console.log(`   Node: ${nodePeerId.slice(0, 24)}...`);
      }
    } else {
      console.error(`❌ 注册失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 列出已注册的 Agent（从 Daemon）
 * f2a agent list
 */
export async function listAgents(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/api/v1/agents');

    if (!result.success) {
      console.error(`❌ 获取 Agent 列表失败: ${result.error}`);
      console.error('请确保 Daemon 正在运行: f2a daemon start');
      process.exit(1);
    }

    if (result.agents) {
      const agents = result.agents as Array<{
        agentId: string;
        name: string;
        capabilities?: Array<{ name: string }>;
        webhookUrl?: string;
        lastActiveAt?: string;
      }>;

      if (agents.length === 0) {
        console.log('📭 没有已注册的 Agent');
        return;
      }

      console.log(`🤖 已注册的 Agent (${agents.length}):`);
      console.log('');

      for (const agent of agents) {
        const lastActive = agent.lastActiveAt
          ? new Date(agent.lastActiveAt).toLocaleString('zh-CN')
          : 'never';

        console.log(`🔹 ${agent.name}`);
        console.log(`   ID: ${agent.agentId}`);
        if (agent.capabilities && agent.capabilities.length > 0) {
          console.log(`   Capabilities: ${agent.capabilities.map(c => c.name).join(', ')}`);
        }
        if (agent.webhookUrl) {
          console.log(`   Webhook: ${agent.webhookUrl}`);
        }
        console.log(`   Last Active: ${lastActive}`);
        console.log('');
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 更新 Agent 配置（Challenge-Response 验证）
 * f2a agent update --agent-id <agentId> [--webhook <url>] [--name <name>]
 * 
 * 流程：
 * 1. 发送 PATCH 请求到 Daemon
 * 2. 如果返回 challenge，用私钥签名
 * 3. 发送带签名的请求完成更新
 * 4. 同时更新本地身份文件
 */
export async function updateAgent(options: {
  agentId: string;
  webhook?: string;
  name?: string;
}): Promise<void> {
  if (!options.agentId) {
    console.error('❌ 缺少 --agent-id 参数');
    console.error('用法: f2a agent update --agent-id <agentId> [--webhook <url>] [--name <name>]');
    process.exit(1);
  }

  const identity = readIdentityByAgentId(options.agentId);

  if (!identity) {
    console.error('❌ 找不到身份文件');
    console.error(`   AgentId: ${options.agentId}`);
    console.error('请先运行: f2a agent init --name <name> --webhook <url>');
    process.exit(1);
  }

  if (!identity.privateKey) {
    console.error('❌ 身份文件缺少私钥，无法签名验证');
    console.error(`   AgentId: ${options.agentId}`);
    console.error('请确保身份文件完整，或重新创建');
    process.exit(1);
  }

  // 检查是否有要更新的内容
  const updates: string[] = [];
  if (options.webhook) updates.push('webhook');
  if (options.name) updates.push('name');

  if (updates.length === 0) {
    console.log('⚠️  没有要更新的内容');
    console.error('请提供 --webhook 或 --name 参数');
    process.exit(1);
  }

  try {
    // 构造更新 payload
    const updatePayload: Record<string, unknown> = {
      publicKey: identity.publicKey,
    };

    if (options.webhook) {
      updatePayload.webhook = { url: options.webhook }; 
    }
    if (options.name) {
      updatePayload.name = options.name;
    }

    // 1. 发送 PATCH 请求
    const initialResult = await sendRequest('PATCH', `/api/v1/agents/${options.agentId}`, updatePayload);

    // 2. 处理 Challenge-Response
    if (initialResult.challenge) {
      const challenge = initialResult.challenge as Challenge;
      const response: ChallengeResponse = signChallenge(challenge, identity.privateKey);
      
      const finalPayload = {
        ...updatePayload,
        challengeResponse: response,
      }; 
      
      const finalResult = await sendRequest('PATCH', `/api/v1/agents/${options.agentId}`, finalPayload);
      handleUpdateResult(finalResult, identity, options);
    } else {
      handleUpdateResult(initialResult, identity, options);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 处理更新结果（更新本地文件）
 */
function handleUpdateResult(
  result: Record<string, unknown>,
  identity: RFC008IdentityFile,
  options: { agentId: string; webhook?: string; name?: string }
): void {
  if (result.success) {
    // 更新本地身份文件
    if (options.webhook) {
      identity.webhook = { url: options.webhook }; 
    }
    if (options.name) {
      identity.name = options.name;
    }
    identity.lastActiveAt = new Date().toISOString();
    
    const identityPath = join(AGENT_IDENTITIES_DIR, `${options.agentId}.json`);
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });

    console.log('✅ Agent 已更新');
    console.log(`   AgentId: ${options.agentId}`);
    if (options.name) {
      console.log(`   Name: ${options.name}`);
    }
    if (options.webhook) {
      console.log(`   Webhook: ${options.webhook}`);
    }
    console.log('');
    console.log('💡 Daemon 和本地身份文件已同步更新');
  } else {
    console.error(`❌ 更新失败: ${result.error}`);
    if (result.code === 'AGENT_NOT_FOUND') {
      console.error('提示: Agent 未注册，请先注册');
      console.error('      f2a agent register --agent-id ' + options.agentId);
    } else if (result.code === 'CHALLENGE_FAILED') {
      console.error('提示: 身份验证失败，请检查身份文件是否完整');
    }
    process.exit(1);
  }
}

/**
 * 注销 Agent
 * f2a agent unregister --agent-id <agentId>
 */
export async function unregisterAgent(agentId: string): Promise<void> {
  if (!agentId || agentId.startsWith('--')) {
    console.error('❌ 缺少 --agent-id 参数');
    console.error('用法: f2a agent unregister --agent-id <agentId>');
    process.exit(1);
  }

  try {
    const result = await sendRequest('DELETE', `/api/v1/agents/${agentId}`);

    if (result.success) {
      console.log('✅ Agent 已注销');
      console.log(`   AgentId: ${agentId}`);
      console.log('   身份文件已保留，可重新注册');
    } else {
      console.error(`❌ 注销失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}