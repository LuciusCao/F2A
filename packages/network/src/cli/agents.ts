/**
 * F2A CLI - Agent 管理命令
 * f2a agent register / list / unregister
 */

import { request, RequestOptions } from 'http';
import { getControlTokenLazy } from './control-token.js';

const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');

/**
 * 发送 HTTP 请求到 ControlServer
 */
async function sendRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';

    const options: RequestOptions = {
      hostname: '127.0.0.1',
      port: CONTROL_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-F2A-Token': getControlTokenLazy()
      }
    };

    if (payload) {
      (options.headers as Record<string, string>)['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ success: false, error: 'Invalid response', raw: data });
        }
      });
    });

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * 注册 Agent（RFC 003: AgentId 由节点签发）
 * f2a agent register --name <name> [--capability <cap>]... [--webhook-url <url>] [--webhook-token <token>]
 */
export async function registerAgent(options: {
  name: string;
  capabilities?: string[];
  webhookUrl?: string;
  webhookToken?: string;
}): Promise<void> {
  if (!options.name) {
    console.error('❌ 错误: 缺少 --name 参数');
    console.error('用法: f2a agent register --name <name> [--capability <cap>]...');
    process.exit(1);
  }

  try {
    const capabilities = (options.capabilities || []).map(name => ({
      name,
      version: '1.0.0',
      description: ''
    }));

    // RFC 004: Agent 级 Webhook - 构建 webhook 对象
    const webhook = options.webhookUrl ? {
      url: options.webhookUrl,
      token: options.webhookToken
    } : undefined;

    // RFC 003: 不再发送 agentId，由节点签发
    const result = await sendRequest('POST', '/api/agents', {
      name: options.name,
      capabilities,
      webhook
    });

    if (result.success) {
      const agent = result.agent as any;
      console.log(`✅ Agent 已注册（节点签发）`);
      console.log(`   AgentId: ${agent.agentId}`);
      console.log(`   Name: ${agent.name}`);
      console.log(`   PeerId: ${agent.peerId}`);
      if (capabilities.length > 0) {
        console.log(`   Capabilities: ${capabilities.map((c: any) => c.name).join(', ')}`);
      }
      if (agent.webhook) {
        console.log(`   Webhook URL: ${agent.webhook.url}`);
        if (agent.webhook.token) {
          console.log(`   Webhook Token: ${agent.webhook.token.slice(0, 4)}...${agent.webhook.token.slice(-4)}`);
        }
      }
      console.log(`   Signature: ${agent.signature?.slice(0, 16)}...`);
    } else {
      console.error(`❌ 注册失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 列出已注册的 Agent
 * f2a agent list
 */
export async function listAgents(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/api/agents');

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
        if (agent.webhook) {
          console.log(`   Webhook URL: ${agent.webhook.url}`);
          if (agent.webhook.token) {
            console.log(`   Webhook Token: ${agent.webhook.token.slice(0, 4)}...${agent.webhook.token.slice(-4)}`);
          }
        }
        console.log(`   Last Active: ${lastActive}`);
        console.log('');
      }
    } else {
      console.log('📭 没有已注册的 Agent');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 注销 Agent
 * f2a agent unregister <agent_id>
 */
export async function unregisterAgent(agentId: string): Promise<void> {
  if (!agentId) {
    console.error('❌ 错误: 缺少 Agent ID');
    console.error('用法: f2a agent unregister <agent_id>');
    process.exit(1);
  }

  try {
    const result = await sendRequest('DELETE', `/api/agents/${agentId}`);

    if (result.success) {
      console.log(`✅ Agent 已注销: ${agentId}`);
    } else {
      console.error(`❌ 注销失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}
