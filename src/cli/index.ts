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
import { configureCommand, listConfig, getConfigValue, setConfigValue } from './configure.js';
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
  helpTarget?: string;
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
  
  // 检查是否是 help 命令或 -h/--help 标志
  if (command === '-h' || command === '--help') {
    return { command: 'help' };
  }
  
  if (command === 'help' && args[1]) {
    return { command: 'help', helpTarget: args[1] };
  }

  // 解析子命令（daemon 和 config）
  let subcommand: string | undefined;
  if ((command === 'daemon' || command === 'config') && args[1]) {
    // 检查是否是 help 请求
    if (args[1] === '-h' || args[1] === '--help') {
      return { command: 'help', helpTarget: command };
    }
    subcommand = args[1];
  }

  // 解析 ID 或序号
  let idOrIndex: string | number | undefined;
  const idArg = command === 'daemon' ? args[2] : args[1];
  if (idArg && !idArg.startsWith('-')) {
    idOrIndex = /^\d+$/.test(idArg) ? parseInt(idArg) : idArg;
  }

  // 解析能力过滤
  let capability: string | undefined;
  const capIndex = args.indexOf('-c');
  const capLongIndex = args.indexOf('--capability');
  const capFlagIndex = capIndex !== -1 ? capIndex : capLongIndex;
  if (capFlagIndex !== -1 && args[capFlagIndex + 1]) {
    capability = args[capFlagIndex + 1];
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
 * 显示主帮助信息
 */
function showMainHelp(): void {
  console.log(`
F2A CLI - Friend-to-Agent P2P Networking

Usage: f2a [command] [options]

Commands:
  configure            交互式配置向导
  config               配置管理 (get/set/list)
  status               查看节点状态
  peers                查看已连接的 Peers
  discover [options]   发现网络中的 Agents
  pending              查看待确认连接
  confirm [id|index]   确认连接请求
  reject [id|index]    拒绝连接请求
  daemon [subcommand]  启动和管理 daemon 服务
  help [command]       显示帮助信息

Use "f2a help [command]" for more information about a command.

Configuration:
  配置文件: ~/.f2a/config.json
  运行 f2a configure 进行交互式配置

Environment Variables:
  F2A_CONTROL_PORT     控制服务器端口 (默认: 9001)
  F2A_CONTROL_TOKEN    控制服务器认证 Token
                       (如果不设置，会读取 ~/.f2a/control-token)
  F2A_P2P_PORT         P2P 监听端口 (默认: 0 随机分配)
  BOOTSTRAP_PEERS      引导节点地址 (逗号分隔)
`);
}

/**
 * 显示指定命令的帮助信息
 */
function showCommandHelp(command: string): void {
  switch (command) {
    case 'configure':
      console.log(`
Usage: f2a configure

交互式配置向导。首次运行会创建新配置，后续运行会显示当前值并允许修改。

Examples:
  f2a configure        # 启动配置向导
`);
      break;

    case 'config':
      console.log(`
Usage: f2a config [subcommand]

配置管理命令，用于直接读写配置值。

Subcommands:
  f2a config list                    列出所有配置
  f2a config get <key>               获取配置项值
  f2a config set <key> <value>       设置配置项值

Examples:
  f2a config list
  f2a config get agentName
  f2a config get network.bootstrapPeers
  f2a config set agentName "my-agent"
  f2a config set autoStart true
  f2a config set p2pPort 9000
  f2a config set network.bootstrapPeers '["/ip4/..."]'

Notes:
  - 支持嵌套 key，如 network.bootstrapPeers
  - 布尔值: true/false
  - 数字: 直接输入数字
  - 数组/对象: 使用 JSON 格式字符串
`);
      break;

    case 'daemon':
      console.log(`
Usage: f2a daemon [subcommand] [options]

启动和管理 F2A daemon 服务。

Subcommands:
  f2a daemon           前台启动 daemon
  f2a daemon -d        后台启动 daemon
  f2a daemon --detach  后台启动 daemon
  f2a daemon stop      停止后台 daemon
  f2a daemon status    查看 daemon 状态

Options:
  -d, --detach         后台启动 daemon

Examples:
  f2a daemon           # 前台启动（用于调试）
  f2a daemon -d        # 后台启动
  f2a daemon stop      # 停止后台 daemon
  f2a daemon status    # 查看 daemon 状态
`);
      break;

    case 'discover':
      console.log(`
Usage: f2a discover [options]

发现网络中的 Agents。

Options:
  -c, --capability <name>   按能力过滤

Examples:
  f2a discover                    # 发现所有 Agents
  f2a discover -c code-generation # 发现具有代码生成能力的 Agents
`);
      break;

    case 'confirm':
      console.log(`
Usage: f2a confirm [id|index]

确认待处理的连接请求。

Parameters:
  id|index    连接的 ID 或序号（从 f2a pending 查看）

Examples:
  f2a pending       # 查看待确认连接列表
  f2a confirm 1     # 确认序号为 1 的连接
  f2a confirm abc123 # 确认 ID 为 abc123 的连接
`);
      break;

    case 'reject':
      console.log(`
Usage: f2a reject [id|index] [--reason <text>]

拒绝待处理的连接请求。

Parameters:
  id|index        连接的 ID 或序号（从 f2a pending 查看）

Options:
  --reason <text> 拒绝原因（可选）

Examples:
  f2a pending              # 查看待确认连接列表
  f2a reject 1             # 拒绝序号为 1 的连接
  f2a reject 1 --reason "不信任该节点"
`);
      break;

    case 'status':
    case 'peers':
    case 'pending':
      console.log(`
Usage: f2a ${command}

${getCommandDescription(command)}
`);
      break;

    default:
      console.log(`
Unknown command: ${command}

Use "f2a help" to see available commands.
`);
  }
}

/**
 * 获取命令描述
 */
function getCommandDescription(command: string): string {
  switch (command) {
    case 'status':
      return '查看 F2A 节点状态，包括 PeerID、监听地址、连接数等信息。';
    case 'peers':
      return '查看已连接的 Peers 列表。';
    case 'pending':
      return '查看待确认的入站连接请求列表。';
    default:
      return '';
  }
}

/**
 * 显示废弃提示
 */
function showDeprecatedInit(): void {
  console.log('');
  console.log('\x1b[33m⚠️  Warning: "f2a init" is deprecated.\x1b[0m');
  console.log('\x1b[33m   Please use "f2a configure" instead.\x1b[0m');
  console.log('');
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

  // 处理 help 命令
  if (args.command === 'help') {
    if (args.helpTarget) {
      showCommandHelp(args.helpTarget);
    } else {
      showMainHelp();
    }
    return;
  }

  switch (args.command) {
    case 'init':
      showDeprecatedInit();
      await configureCommand();
      break;

    case 'configure':
      await configureCommand();
      break;

    case 'config':
      await handleConfigCommand(args);
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

    default:
      console.error(`[F2A] Unknown command: ${args.command}`);
      console.error('Use "f2a help" to see available commands.');
      process.exit(1);
  }
}

/**
 * 处理 config 子命令
 */
async function handleConfigCommand(args: Args): Promise<void> {
  const subcommand = args.subcommand;
  // 获取命令行参数中 config 之后的所有参数
  const configIndex = process.argv.indexOf('config');
  const remainingArgs = configIndex >= 0 ? process.argv.slice(configIndex + 1) : [];
  
  switch (subcommand) {
    case 'list':
    case undefined:
      // f2a config 或 f2a config list
      listConfig();
      break;

    case 'get':
      {
        const key = remainingArgs[1];
        if (!key) {
          console.error('[F2A] Error: Configuration key is required');
          console.error('Usage: f2a config get <key>');
          process.exit(1);
        }
        getConfigValue(key);
      }
      break;

    case 'set':
      {
        const key = remainingArgs[1];
        const value = remainingArgs[2];
        if (!key || value === undefined) {
          console.error('[F2A] Error: Both key and value are required');
          console.error('Usage: f2a config set <key> <value>');
          process.exit(1);
        }
        setConfigValue(key, value);
      }
      break;

    case '-h':
    case '--help':
      showCommandHelp('config');
      break;

    default:
      console.error(`[F2A] Unknown config subcommand: ${subcommand}`);
      console.error('Usage: f2a config [list|get|set]');
      process.exit(1);
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
