/**
 * F2A CLI - Agent 管理命令
 * f2a agent register / list / unregister
 * Phase 4: 保存 token 到 identity 文件
 */

import { getControlTokenLazy } from './control-token.js';
import { sendRequest } from './http-client.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Phase 4: 保存 identity 文件（含 token）
 */
function saveIdentityWithToken(agentId: string, token: string): boolean {
  try {
    const dataDir = join(homedir(), '.f2a');
    const agentsDir = join(dataDir, 'agents');
    
    // 确保目录存在
    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true });
    }
    
    const identityFile = join(agentsDir, `${agentId}.json`);
    
    // 读取现有 identity（如果存在）
    let identity: Record<string, unknown>;
    if (existsSync(identityFile)) {
      identity = JSON.parse(readFileSync(identityFile, 'utf-8'));
    } else {
      // 如果不存在，创建基本的 identity 结构
      identity = {
        agentId,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };
    }
    
    // 更新 token 和 lastActiveAt
    identity.token = token;
    identity.lastActiveAt = new Date().toISOString();
    
    // 写入文件
    writeFileSync(identityFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**

/**
 * 注册 Agent
 * f2a agent register [--id <id>] --name <name> [--capability <cap>]... [--webhook <url>]
 * 注：--id 参数可选，若不提供则由 daemon 自动生成
 * Phase 4: 保存 token 到 identity 文件
 */
export async function registerAgent(options: {
  id?: string;
  name: string;
  capabilities?: string[];
  webhook?: string;
}): Promise<void> {
  // name 必填，id 可选（由 daemon 自动生成）
  if (!options.name) {
    console.error('❌ 错误：缺少 --name 参数');
    console.error('用法：f2a agent register [--id <id>] --name <name> [--capability <cap>]...');
    process.exit(1);
  }

  try {
    const capabilities = (options.capabilities || []).map(name => ({
      name,
      version: '1.0.0',
      description: ''
    }));

    // 构建请求 body，只有用户提供 id 时才发送 agentId
    const requestBody: Record<string, unknown> = {
      name: options.name,
      capabilities,
    };
    // webhook 需要嵌套结构
    if (options.webhook) {
      requestBody.webhook = { url: options.webhook };
    }
    if (options.id) {
      requestBody.agentId = options.id;
    }

    const result = await sendRequest('POST', '/api/v1/agents', requestBody);

    if (result.success) {
      // 获取实际的 agentId（用户指定或 daemon 生成）
      const actualAgentId = options.id || (result.agent as any)?.agentId;
      
      console.log(`✅ Agent 已注册`);
      console.log(`   ID: ${actualAgentId}`);
      console.log(`   Name: ${options.name}`);
      if (capabilities.length > 0) {
        console.log(`   Capabilities: ${capabilities.map((c: any) => c.name).join(', ')}`);
      }
      if (options.webhook) {
        console.log(`   Webhook: ${options.webhook}`);
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

    if (result.success && result.agents) {
      const agents = result.agents as any[];

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
          console.log(`   Capabilities: ${agent.capabilities.map((c: any) => c.name).join(', ')}`);
        }
        if (agent.webhookUrl) {
          console.log(`   Webhook: ${agent.webhookUrl}`);
        }
        console.log(`   Last Active: ${lastActive}`);
        console.log('');
      }
    } else {
      console.log('📭 没有已注册的 Agent');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 从 identity 文件读取 token
 */
function getTokenFromIdentity(agentId: string): string | null {
  try {
    const identityFile = join(homedir(), '.f2a', 'agents', `${agentId}.json`);
    if (!existsSync(identityFile)) {
      return null;
    }
    const identity = JSON.parse(readFileSync(identityFile, 'utf-8'));
    return identity.token as string | null;
  } catch {
    return null;
  }
}

/**
 * 注销 Agent
 * f2a agent unregister <agent_id> [--token <token>]
 */
export async function unregisterAgent(agentId: string, token?: string): Promise<void> {
  if (!agentId) {
    console.error('❌ 错误：缺少 Agent ID');
    console.error('用法：f2a agent unregister <agent_id> [--token <token>]');
    process.exit(1);
  }

  // 如果没有传入 token，尝试从 identity 文件读取
  const agentToken = token || getTokenFromIdentity(agentId);
  
  if (!agentToken) {
    console.error('❌ 错误：缺少 Agent Token');
    console.error('请提供 --token 参数，或确保 identity 文件中包含 token');
    console.error('用法：f2a agent unregister <agent_id> --token <token>');
    process.exit(1);
  }

  try {
    const result = await sendRequest('DELETE', `/api/v1/agents/${agentId}`, undefined, {
      'Authorization': `agent-${agentToken}`
    });

    if (result.success) {
      // 删除 identity 文件（如果存在）
      const identityFile = join(homedir(), '.f2a', 'agents', `${agentId}.json`);
      if (existsSync(identityFile)) {
        try {
          const { unlinkSync } = await import('fs');
          unlinkSync(identityFile);
        } catch {
          // 忽略删除失败
        }
      }
      console.log(`✅ Agent 已注销: ${agentId}`);
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
