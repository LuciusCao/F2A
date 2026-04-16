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
 * 注册 Agent
 * f2a agent register --id <id> --name <name> [--capability <cap>]... [--webhook <url>]
 */
export async function registerAgent(options: {
  id: string;
  name: string;
  capabilities?: string[];
  webhook?: string;
}): Promise<void> {
  if (!options.id || !options.name) {
    console.error('❌ 错误: 缺少 --id 或 --name 参数');
    console.error('用法: f2a agent register --id <id> --name <name> [--capability <cap>]...');
    process.exit(1);
  }

  try {
    const capabilities = (options.capabilities || []).map(name => ({
      name,
      version: '1.0.0',
      description: ''
    }));

    const result = await sendRequest('POST', '/api/agents', {
      agentId: options.id,
      name: options.name,
      capabilities,
      webhookUrl: options.webhook
    });

    if (result.success) {
      console.log(`✅ Agent 已注册`);
      console.log(`   ID: ${options.id}`);
      console.log(`   Name: ${options.name}`);
      if (capabilities.length > 0) {
        console.log(`   Capabilities: ${capabilities.map((c: any) => c.name).join(', ')}`);
      }
      if (options.webhook) {
        console.log(`   Webhook: ${options.webhook}`);
      }
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
