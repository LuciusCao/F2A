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
 *   pending     查看待确认连接
 *   confirm     确认连接请求
 *   reject      拒绝连接请求
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
 *   node f2a.js pending
 *   node f2a.js confirm 1
 *   node f2a.js reject abc-123 --reason "不认识"
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const DAEMON_SCRIPT = path.join(__dirname, 'daemon.js');
const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT) || 9001;
const CONTROL_TOKEN = process.env.F2A_CONTROL_TOKEN || 'f2a-default-token';

// 解析参数
function parseArgs(argv) {
  const args = {
    command: 'start',
    daemon: false,
    debug: false,
    help: false,
    idOrIndex: null,
    reason: null
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

  // 解析选项和参数
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--daemon' || arg === '-D') {
      args.daemon = true;
    } else if (arg === '--debug' || arg === '-d') {
      args.debug = true;
    } else if (arg === '--reason' && argv[i + 1]) {
      args.reason = argv[i + 1];
      i++;
    } else if (!arg.startsWith('-') && !args.idOrIndex) {
      args.idOrIndex = arg;
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
  pending     List pending connection requests
  confirm     Confirm a pending connection
  reject      Reject a pending connection

Options:
  -D, --daemon         Run as daemon (background)
  -d, --debug          Enable DEBUG log level
  -p, --port <port>    Set P2P port (default: 9000)
  -n, --name <name>    Set display name
  --reason <text>      Reason for rejection
  -h, --help           Show this help message

Examples:
  node f2a.js start -D                    # Start in background
  node f2a.js start -D --debug            # Start with debug logs
  node f2a.js pending                     # List pending requests
  node f2a.js confirm 1                   # Confirm by index
  node f2a.js confirm abc-123             # Confirm by ID
  node f2a.js reject 2 --reason "unknown" # Reject with reason
  node f2a.js status                      # Check status
  node f2a.js stop                        # Stop service
`);
}

// 发送控制命令到 Daemon
function sendControlCommand(action, idOrIndex, reason) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      action,
      idOrIndex,
      reason
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port: CONTROL_PORT,
      path: '/control',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-F2A-Token': CONTROL_TOKEN,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          resolve({ success: false, error: 'Invalid response' });
        }
      });
    });

    req.on('error', (err) => {
      console.error(`[F2A] Cannot connect to daemon: ${err.message}`);
      console.error('[F2A] Is the daemon running? Try: node f2a.js status');
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// 处理控制命令
async function handleControlCommand(command, idOrIndex, reason) {
  if (!idOrIndex) {
    console.error('[F2A] Error: ID or index required');
    console.error(`Usage: node f2a.js ${command} <id-or-index>`);
    process.exit(1);
  }

  // 尝试转换为数字（如果是纯数字）
  const parsedId = /^\d+$/.test(idOrIndex) ? parseInt(idOrIndex) : idOrIndex;

  try {
    const result = await sendControlCommand(command, parsedId, reason);
    if (result.success) {
      console.log(`[F2A] ${result.message}`);
    } else {
      console.error(`[F2A] Error: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    process.exit(1);
  }
}

// 获取待连接列表
async function listPending() {
  try {
    const result = await sendControlCommand('list-pending');
    if (result.success && result.pending && result.pending.length > 0) {
      console.log(`待确认连接 (${result.pending.length}个):`);
      result.pending.forEach(p => {
        console.log(`${p.index}. ${p.agentIdShort} 来自 ${p.address}:${p.port} [剩余${p.remainingMinutes}分钟]`);
      });
    } else {
      console.log('没有待确认的连接请求');
    }
  } catch (err) {
    process.exit(1);
  }
}

const args = parseArgs(process.argv);

if (args.help) {
  showHelp();
  process.exit(0);
}

// 处理控制命令
if (args.command === 'pending') {
  listPending();
  return;
}

if (args.command === 'confirm') {
  handleControlCommand('confirm', args.idOrIndex);
  return;
}

if (args.command === 'reject') {
  handleControlCommand('reject', args.idOrIndex, args.reason);
  return;
}

// 其他命令传递给 daemon.js
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
