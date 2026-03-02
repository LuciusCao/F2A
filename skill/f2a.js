#!/usr/bin/env node
/**
 * F2A CLI - 简洁的命令行入口
 *
 * 用法:
 *   node f2a.js [command] [options]
 *
 * 命令:
 *   start       启动 F2A 服务 (默认)
 *   stop        停止 F2A 服务
 *   status      查看服务状态
 *   peers       查看已连接的 peers
 *   discover    发现局域网内的其他 Agent
 *
 * 选项:
 *   -D, --daemon     后台运行
 *   -d, --debug      启用 DEBUG 日志
 *   -p, --port       设置 P2P 端口 (默认: 9000)
 *   -n, --name       设置显示名称
 *   -h, --help       显示帮助
 *
 * 示例:
 *   node f2a.js start -D --debug
 *   node f2a.js start -D -p 9001 -n "MyAgent"
 *   node f2a.js status
 *   node f2a.js stop
 */

const { spawn } = require('child_process');
const path = require('path');

const DAEMON_SCRIPT = path.join(__dirname, 'start-daemon.js');

// 解析参数
function parseArgs(argv) {
  const args = {
    command: 'start',
    daemon: false,
    debug: false,
    help: false
  };

  let i = 2;

  // 检查 help
  if (argv.includes('--help') || argv.includes('-h')) {
    args.help = true;
    return args;
  }

  // 第一个非选项参数是命令
  if (argv[i] && !argv[i].startsWith('-')) {
    args.command = argv[i];
    i++;
  }

  // 解析选项
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--daemon' || arg === '-D') {
      args.daemon = true;
    } else if (arg === '--debug' || arg === '-d') {
      args.debug = true;
    }
  }

  return args;
}

function showHelp() {
  console.log(`
F2A CLI - Friend-to-Agent P2P Networking

Usage: node f2a.js [command] [options]

Commands:
  start       Start the F2A service (default)
  stop        Stop the F2A service
  status      Show service status
  peers       List connected peers
  discover    Discover agents on the network

Options:
  -D, --daemon         Run as daemon (background)
  -d, --debug          Enable DEBUG log level
  -p, --port <port>    Set P2P port (default: 9000)
  -n, --name <name>    Set display name
  -h, --help           Show this help message

Examples:
  node f2a.js start -D              # Start in background
  node f2a.js start -D --debug      # Start in background with debug logs
  node f2a.js start -D -p 9001      # Start on custom port
  node f2a.js status                # Check status
  node f2a.js stop                  # Stop service
  node f2a.js peers                 # List peers
`);
}

const args = parseArgs(process.argv);

if (args.help) {
  showHelp();
  process.exit(0);
}

// 构建传递给 start-daemon.js 的参数
const daemonArgs = [args.command];

// 传递所有原始选项（除了命令本身）
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  // 跳过命令参数
  if (i === 2 && !arg.startsWith('-')) continue;
  daemonArgs.push(arg);
}

// 执行
const child = spawn(process.execPath, [DAEMON_SCRIPT, ...daemonArgs], {
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code);
});
