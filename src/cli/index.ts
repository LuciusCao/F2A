#!/usr/bin/env node
/**
 * F2A CLI 入口 - P2P 版本
 */

import { request, RequestOptions } from 'http';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');

/**
 * 获取控制 Token
 * 优先从环境变量读取，其次从默认文件位置读取
 * @returns 控制 Token，如果未找到返回空字符串
 */
function getControlToken(): string {
  // 1. 优先使用环境变量
  const envToken = process.env.F2A_CONTROL_TOKEN;
  if (envToken) {
    return envToken;
  }

  // 2. 从默认文件位置读取
  const tokenPath = join(homedir(), '.f2a', 'control-token');
  if (existsSync(tokenPath)) {
    const fileToken = readFileSync(tokenPath, 'utf-8').trim();
    if (fileToken) {
      return fileToken;
    }
  }

  // 3. 如果都没有，返回空字符串（会导致认证失败）
  console.warn('⚠️  Warning: F2A_CONTROL_TOKEN not set and no token file found.');
  console.warn('    Token file location:', tokenPath);
  console.warn('    Please start the F2A daemon first, or set F2A_CONTROL_TOKEN.');
  return '';
}

const CONTROL_TOKEN = getControlToken();

interface Args {
  command: string;
  idOrIndex?: string | number;
  capability?: string;
  reason?: string;
}

/**
 * 解析命令行参数
 * @returns 解析后的参数对象
 */
function parseArgs(): Args {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return { command: 'help' };
  }

  const command = args[0];
  
  // 解析 ID 或序号
  let idOrIndex: string | number | undefined;
  if (args[1]) {
    idOrIndex = /^\d+$/.test(args[1]) ? parseInt(args[1]) : args[1];
  }

  // 解析能力过滤
  let capability: string | undefined;
  const capIndex = args.indexOf('--capability');
  if (capIndex !== -1 && args[capIndex + 1]) {
    capability = args[capIndex + 1];
  }

  // 解析原因
  let reason: string | undefined;
  const reasonIndex = args.indexOf('--reason');
  if (reasonIndex !== -1 && args[reasonIndex + 1]) {
    reason = args[reasonIndex + 1];
  }

  return { command, idOrIndex, capability, reason };
}

/**
 * 显示帮助信息
 * @returns void
 */
function showHelp(): void {
  console.log(`
F2A CLI - Friend-to-Agent P2P Networking

Usage: f2a [command] [options]

Commands:
  status               查看节点状态
  peers                查看已连接的 Peers
  discover [options]   发现网络中的 Agents
  pending              查看待确认连接
  confirm [id|index]   确认连接请求
  reject [id|index]    拒绝连接请求
  help                 显示帮助

Options:
  -c, --capability     按能力过滤 (discover 命令)
  --reason [text]      拒绝原因 (reject 命令)

Environment Variables:
  F2A_CONTROL_PORT     控制服务器端口 (默认: 9001)
  F2A_CONTROL_TOKEN    控制服务器认证 Token
                       (如果不设置，会读取 ~/.f2a/control-token)

Examples:
  f2a status
  f2a peers
  f2a discover
  f2a discover --capability code-generation
  f2a pending
  f2a confirm 1
  f2a reject 2 --reason "unknown"
`);
}

/**
 * 发送控制命令到 F2A Daemon
 * @param action - 命令动作
 * @param params - 命令参数（可选）
 * @returns Promise，命令执行完成后 resolve
 * @throws 当网络请求失败时 reject
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
        'Content-Length': Buffer.byteLength(payload),
        'X-F2A-Token': CONTROL_TOKEN
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
            if (res.statusCode === 401) {
              console.error('❌ Authentication failed. Please check your F2A_CONTROL_TOKEN.');
            } else {
              console.error('Error:', response.error);
            }
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
 * 主函数 - CLI 入口
 * @returns Promise，程序退出时 resolve
 * @throws 当命令执行失败时 reject
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

    case 'pending':
      await sendCommand('pending');
      break;

    case 'confirm':
      if (args.idOrIndex === undefined) {
        console.error('[F2A] 错误: 需要指定 ID 或序号');
        console.error('用法: f2a confirm [id|index]');
        process.exit(1);
      }
      await sendCommand('confirm', { id: args.idOrIndex });
      break;

    case 'reject':
      if (args.idOrIndex === undefined) {
        console.error('[F2A] 错误: 需要指定 ID 或序号');
        console.error('用法: f2a reject [id|index]');
        process.exit(1);
      }
      await sendCommand('reject', { id: args.idOrIndex, reason: args.reason });
      break;

    case 'help':
    default:
      showHelp();
  }
}

main().catch(err => {
  console.error('[F2A] 错误:', err);
  process.exit(1);
});
