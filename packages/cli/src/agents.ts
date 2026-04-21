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
import type { RFC008IdentityFile } from '@f2a/network';

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