#!/usr/bin/env node
/**
 * F2A CLI 入口 - P2P 版本
 */

import { request, RequestOptions } from 'http';

const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');

interface Args {
  command: string;
  capability?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return { command: 'help' };
  }

  const command = args[0];
  
  // 解析参数
  let capability: string | undefined;
  const capIndex = args.indexOf('--capability') || args.indexOf('-c');
  if (capIndex !== -1 && args[capIndex + 1]) {
    capability = args[capIndex + 1];
  }

  return { command, capability };
}

function showHelp(): void {
  console.log(`
F2A CLI - Friend-to-Agent P2P Networking

Usage: f2a [command] [options]

Commands:
  status               查看节点状态
  peers                查看已连接的 Peers
  discover [options]   发现网络中的 Agents
  help                 显示帮助

Options:
  -c, --capability     按能力过滤 (discover 命令)

Environment Variables:
  F2A_CONTROL_PORT     控制服务器端口 (默认: 9001)

Examples:
  f2a status
  f2a peers
  f2a discover
  f2a discover --capability code-generation
`);
}

/**
 * 发送控制命令
 */
async function sendCommand(action: string, params?: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ action, ...params });

    const options: RequestOptions = {
      hostname: '127.0.0.1',
      port: CONTROL_PORT,
      path: '/control',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.success) {
            console.log(JSON.stringify(response, null, 2));
          } else {
            console.error('Error:', response.error);
          }
          resolve();
        } catch {
          console.log(data);
          resolve();
        }
      });
    });

    req.on('error', (err) => {
      console.error('Failed to connect to F2A daemon:', err.message);
      console.log('Make sure the daemon is running (f2a daemon start)');
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const args = parseArgs();

  switch (args.command) {
    case 'status':
      await sendCommand('status');
      break;

    case 'peers':
      await sendCommand('peers');
      break;

    case 'discover':
      await sendCommand('discover', { capability: args.capability });
      break;

    case 'help':
    default:
      showHelp();
  }
}

main().catch(console.error);
