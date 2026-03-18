#!/usr/bin/env node
/**
 * F2A CLI 入口 - P2P 版本
 */

import { request, RequestOptions } from 'http';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  startForeground,
  startBackground,
  stopDaemon,
  showStatus,
  getDaemonStatus,
} from './daemon.js';
import { initConfig, showConfig } from './init.js';
import { getConfigPath } from './config.js';

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

// 惰性获取 token，避免模块加载时立即验证（init/config 命令不需要 token）
let _controlToken: string | undefined;
function getControlTokenLazy(): string {
  if (!_controlToken) {
    _controlToken = getControlToken();
  }
  return _controlToken;
}

interface Args {
  command: string;
  subcommand?: string;
  idOrIndex?: string | number;
  capability?: string;
  reason?: string;
  detach?: boolean;
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
  
  // 解析 daemon 子命令
  let subcommand: string | undefined;
  if (command === 'daemon' && args[1]) {
    subcommand = args[1];
  }

  // 解析 ID 或序号
  let idOrIndex: string | number | undefined;
  const idArg = command === 'daemon' ? args[2] : args[1];
  if (idArg) {
    idOrIndex = /^\d+$/.test(idArg) ? parseInt(idArg) : idArg;
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

  // 解析 detach 标志
  const detach = args.includes('-d') || args.includes('--detach');

  return { command, subcommand, idOrIndex, capability, reason, detach };
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
  init                 交互式配置向导
  config               显示当前配置
  status               查看节点状态
  peers                查看已连接的 Peers
  discover [options]   发现网络中的 Agents
  pending              查看待确认连接
  confirm [id|index]   确认连接请求
  reject [id|index]    拒绝连接请求
  daemon               启动和管理 daemon 服务
  help                 显示帮助

Daemon Commands:
  f2a daemon           前台启动 daemon
  f2a daemon -d        后台启动 daemon
  f2a daemon --detach  后台启动 daemon
  f2a daemon stop      停止后台 daemon
  f2a daemon status    查看 daemon 状态

Options:
  -c, --capability     按能力过滤 (discover 命令)
  --reason [text]      拒绝原因 (reject 命令)
  -d, --detach         后台启动 daemon (daemon 命令)

Configuration:
  配置文件: ~/.f2a/config.json
  运行 f2a init 进行交互式配置

Environment Variables:
  F2A_CONTROL_PORT     控制服务器端口 (默认: 9001)
  F2A_CONTROL_TOKEN    控制服务器认证 Token
                       (如果不设置，会读取 ~/.f2a/control-token)
  F2A_P2P_PORT         P2P 监听端口 (默认: 0 随机分配)
  BOOTSTRAP_PEERS      引导节点地址 (逗号分隔)

Examples:
  # 首次使用
  f2a init             # 交互式配置
  f2a daemon -d        # 后台启动
  
  # 日常使用
  f2a status           # 查看状态
  f2a peers            # 查看已连接节点
  f2a discover         # 发现网络中的 Agents
  
  # 连接管理
  f2a pending          # 查看待确认连接
  f2a confirm 1        # 确认连接
  f2a reject 2         # 拒绝连接
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
        'X-F2A-Token': getControlTokenLazy()
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
      console.log('Make sure the daemon is running (f2a daemon)');
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
    case 'init':
      await initConfig();
      break;

    case 'config':
      showConfig();
      break;

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
        console.error('[F2A] Error: ID or index is required');
        console.error('Usage: f2a confirm [id|index]');
        process.exit(1);
      }
      await sendCommand('confirm', { id: args.idOrIndex });
      break;

    case 'reject':
      if (args.idOrIndex === undefined) {
        console.error('[F2A] Error: ID or index is required');
        console.error('Usage: f2a reject [id|index]');
        process.exit(1);
      }
      await sendCommand('reject', { id: args.idOrIndex, reason: args.reason });
      break;

    case 'daemon':
      await handleDaemonCommand(args);
      break;

    case 'help':
    default:
      showHelp();
  }
}

/**
 * 处理 daemon 命令
 * @param args - 解析后的参数
 */
async function handleDaemonCommand(args: Args): Promise<void> {
  // 如果指定了 detach 标志，后台启动
  if (args.detach && args.subcommand !== 'stop') {
    await startBackground();
    return;
  }

  switch (args.subcommand) {
    case 'stop':
      await stopDaemon();
      break;

    case 'status':
      await showStatus();
      break;

    case '-d':
    case '--detach':
      // f2a daemon -d 或 f2a daemon --detach
      await startBackground();
      break;

    case undefined:
      // f2a daemon (无子命令) - 前台启动
      await startForeground();
      break;

    default:
      console.error(`[F2A] Unknown daemon subcommand: ${args.subcommand}`);
      console.error('Usage: f2a daemon [stop|status|-d|--detach]');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('[F2A] Error:', err);
  process.exit(1);
});
