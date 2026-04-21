/**
 * F2A CLI - Agent 管理命令
 * f2a agent register / list / unregister
 * 
 * RFC008 Phase 2: 支持 Challenge-Response 注册流程
 * - 读取已生成的身份文件（必须指定 --agent-identity）
 * - 发送 publicKey 到 Daemon
 * - 接收 nodeSignature
 * - 保存 nodeSignature 到身份文件
 */

import { sendRequest } from './http-client.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { readIdentityFile } from './init.js';
import { RFC008IdentityFile } from '@f2a/network';

/**
 * 更新身份文件（添加 nodeSignature）
 */
function updateIdentityWithNodeSignature(
  identityPath: string,
  identity: RFC008IdentityFile,
  nodeSignature: string,
  nodePeerId: string
): boolean {
  try {
    // 更新 nodeSignature 和 nodePeerId
    identity.nodeSignature = nodeSignature;
    identity.nodePeerId = nodePeerId;
    identity.lastActiveAt = new Date().toISOString();
    
    // 写入文件
    writeFileSync(identityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 注册 Agent
 * f2a agent register --agent-identity <path> [--name <name>] [--capability <cap>]... [--webhook <url>]
 * 
 * RFC008 Phase 2: Challenge-Response 注册流程
 * - 必须指定 --agent-identity 参数
 * - 读取身份文件中的 agentId 和 publicKey
 * - 发送到 Daemon 进行注册
 * - 接收 nodeSignature 并保存
 */
export async function registerAgent(options: {
  /** 身份文件路径（必填） */
  agentIdentity: string;
  name?: string;
  capabilities?: string[];
  webhook?: string;
  force?: boolean;
}): Promise<void> {
  // agentIdentity 必填
  if (!options.agentIdentity) {
    console.error('❌ 错误：缺少 --agent-identity 参数');
    console.error('用法：f2a agent register --agent-identity <path> [--name <name>]');
    process.exit(1);
  }

  // 读取身份文件
  const identity = readIdentityFile(options.agentIdentity);

  if (!identity) {
    console.error('❌ 错误：找不到身份文件');
    console.error(`   Path: ${options.agentIdentity}`);
    console.error('请先运行: f2a agent init --name <name> --agent-identity <path>');
    process.exit(1);
  }

  // 检查是否已注册（已有 nodeSignature）
  if (identity.nodeSignature && !options.force) {
    console.log(`✅ Agent 已注册`);
    console.log(`   AgentId: ${identity.agentId}`);
    console.log(`   Node PeerId: ${identity.nodePeerId || 'N/A'}`);
    console.log('   使用 --force 强制重新注册');
    return;
  }

  // RFC008 注册请求
  try {
    const capabilities = (options.capabilities || identity.capabilities || []).map((name: { name: string; version: string } | string) => ({
      name: typeof name === 'string' ? name : name.name,
      version: '1.0.0',
      description: ''
    }));

    const requestBody: Record<string, unknown> = {
      agentId: identity.agentId,
      publicKey: identity.publicKey,
      name: options.name || identity.name || 'unnamed',
      capabilities,
      rfc008: true,  // 标记为 RFC008 格式
    };

    if (options.webhook || identity.webhook) {
      requestBody.webhook = { url: options.webhook || identity.webhook?.url };
    }

    const result = await sendRequest('POST', '/api/v1/agents', requestBody);

    if (result.success) {
      // RFC008: 接收 nodeSignature
      const nodeSignature = result.nodeSignature as string | undefined;
      const nodePeerId = result.nodePeerId as string | undefined;

      if (nodeSignature && nodePeerId) {
        // 保存 nodeSignature 到身份文件
        updateIdentityWithNodeSignature(options.agentIdentity, identity, nodeSignature, nodePeerId);
      }

      console.log(`✅ Agent 已注册 (RFC008)`);
      console.log(`   AgentId: ${identity.agentId}`);
      console.log(`   Name: ${requestBody.name}`);
      if (capabilities.length > 0) {
        console.log(`   Capabilities: ${capabilities.map((c: { name: string }) => c.name).join(', ')}`);
      }
      if (nodeSignature) {
        console.log(`   Node Signature: ✅ 已签发`);
        console.log(`   Node PeerId: ${nodePeerId || 'N/A'}`);
      }
      if (options.webhook || identity.webhook) {
        console.log(`   Webhook: ${options.webhook || identity.webhook?.url}`);
      }
    } else {
      console.error(`❌ 注册失败：${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 列出已注册的 Agent
 * f2a agent list
 */
export async function listAgents(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/api/v1/agents');

    if (!result.success) {
      console.error(`❌ 获取 Agent 列表失败：${result.error}`);
      console.error('请确保 Daemon 正在运行：f2a daemon start');
      process.exit(1);
      return;
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

      console.log(`🤖 已注册的 Agent (${agents.length} 个):`);
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
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 注销 Agent
 * f2a agent unregister <agent_id> [--agent-identity <path>]
 */
export async function unregisterAgent(agentId: string, agentIdentity?: string): Promise<void> {
  if (!agentId) {
    console.error('❌ 错误：缺少 Agent ID');
    console.error('用法：f2a agent unregister <agent_id> --agent-identity <path>');
    process.exit(1);
  }

  // 从身份文件读取 token（如果提供了身份路径）
  let token: string | undefined;
  if (agentIdentity) {
    const identity = readIdentityFile(agentIdentity);
    if (identity && identity.agentId === agentId) {
      // 使用签名验证代替 token（RFC008）
      token = undefined; // RFC008 使用签名验证
    }
  }

  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `agent-${token}`;
    }

    const result = await sendRequest('DELETE', `/api/v1/agents/${agentId}`, undefined, headers);

    if (result.success) {
      console.log(`✅ Agent 已注销: ${agentId}`);
      if (agentIdentity) {
        console.log(`   Identity file preserved: ${agentIdentity}`);
        console.log('   如需删除身份文件，请手动删除');
      }
    } else {
      console.error(`❌ 注销失败：${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}