/**
 * F2A CLI - Agent 管理命令
 * f2a agent register / list / unregister
 * 
 * RFC008 Phase 2: 支持 Challenge-Response 注册流程
 * - 读取已生成的身份文件
 * - 发送 publicKey 到 Daemon
 * - 接收 nodeSignature
 * - 保存 nodeSignature 到身份文件
 */

import { sendRequest } from './http-client.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { readCallerConfig, readIdentityFile, AGENT_IDENTITIES_DIR, DEFAULT_CALLER_CONFIG } from './init.js';
import { RFC008IdentityFile } from '@f2a/network';

/**
 * 保存 identity 文件（含 nodeSignature）
 * RFC008: 更新身份文件，添加 nodeSignature 和 nodePeerId
 */
function saveIdentityWithNodeSignature(
  identity: RFC008IdentityFile,
  nodeSignature: string,
  nodePeerId: string
): boolean {
  try {
    const identityFile = join(AGENT_IDENTITIES_DIR, `${identity.agentId}.json`);
    
    // 更新 nodeSignature 和 nodePeerId
    identity.nodeSignature = nodeSignature;
    identity.nodePeerId = nodePeerId;
    identity.lastActiveAt = new Date().toISOString();
    
    // 写入文件
    writeFileSync(identityFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 保存 identity 文件（含 token）
 * 旧版兼容：用于旧格式的 AgentId
 */
function saveIdentityWithToken(agentId: string, token: string): boolean {
  try {
    // 确保目录存在
    if (!existsSync(AGENT_IDENTITIES_DIR)) {
      mkdirSync(AGENT_IDENTITIES_DIR, { recursive: true });
    }
    
    const identityFile = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);
    
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
 * 注册 Agent
 * f2a agent register [--caller-config <path>] [--name <name>] [--capability <cap>]... [--webhook <url>]
 * 
 * RFC008 Phase 2: 支持 Challenge-Response 注册流程
 * - 读取已生成的身份文件（通过 init 命令）
 * - 发送 agentId + publicKey + name + capabilities 到 Daemon
 * - 接收 nodeSignature 和 nodePeerId
 * - 保存到身份文件
 * 
 * 兼容旧流程：如果没有身份文件，使用旧的 token 注册方式
 */
export async function registerAgent(options: {
  callerConfig?: string;
  name?: string;
  capabilities?: string[];
  webhook?: string;
  force?: boolean;
}): Promise<void> {
  // 尝试读取 Caller 配置
  const callerConfig = readCallerConfig(options.callerConfig);

  if (callerConfig) {
    // RFC008 新流程：使用已生成的身份文件
    const identity = readIdentityFile(callerConfig.agentId);

    if (!identity) {
      console.error('❌ 错误：找不到身份文件');
      console.error(`   AgentId: ${callerConfig.agentId}`);
      console.error('请先运行: f2a agent init --name <name>');
      process.exit(1);
    }

    // 检查是否已注册（已有 nodeSignature）
    if (identity.nodeSignature) {
      console.log(`✅ Agent 已注册`);
      console.log(`   AgentId: ${identity.agentId}`);
      console.log(`   Node PeerId: ${identity.nodePeerId || 'N/A'}`);
      if (options.force) {
        console.log('   使用 --force 强制重新注册');
      } else {
        return;
      }
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
          saveIdentityWithNodeSignature(identity, nodeSignature, nodePeerId);
        }

        console.log(`✅ Agent 已注册 (RFC008)`);
        console.log(`   AgentId: ${identity.agentId}`);
        console.log(`   Name: ${requestBody.name}`);
        if (capabilities.length > 0) {
          console.log(`   Capabilities: ${capabilities.map((c: any) => c.name).join(', ')}`);
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
    return;
  }

  // 旧流程：如果没有 Caller 配置，需要 name 参数
  if (!options.name) {
    console.error('❌ 错误：缺少 --name 参数');
    console.error('用法：');
    console.error('  RFC008: f2a agent init --name <name> && f2a agent register');
    console.error('  旧格式: f2a agent register --name <name> [--capability <cap>]...');
    process.exit(1);
  }

  try {
    const capabilities = (options.capabilities || []).map(name => ({
      name,
      version: '1.0.0',
      description: ''
    }));

    // 构建请求 body
    const requestBody: Record<string, unknown> = {
      name: options.name,
      capabilities,
    };
    if (options.webhook) {
      requestBody.webhook = { url: options.webhook };
    }

    const result = await sendRequest('POST', '/api/v1/agents', requestBody);

    if (result.success) {
      const actualAgentId = (result.agent as any)?.agentId;
      
      // 旧流程：保存 token 到 identity 文件
      const token = result.token as string | undefined;
      if (actualAgentId && token) {
        saveIdentityWithToken(actualAgentId, token);
      }
      
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

    if (!result.success) {
      console.error(`❌ 获取 Agent 列表失败：${result.error}`);
      console.error('请确保 Daemon 正在运行：f2a daemon start');
      process.exit(1);
      return;
    }

    if (result.agents) {
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
    const identityFile = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);
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
      const identityFile = join(AGENT_IDENTITIES_DIR, `${agentId}.json`);
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
