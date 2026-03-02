#!/usr/bin/env node
/**
 * F2A 后台服务启动脚本
 *
 * 用法:
 *   node start-daemon.js [start|stop|status] [options]
 *
 * 选项:
 *   --debug, -d           启用 DEBUG 日志级别
 *   --port, -p <number>   设置 P2P 端口 (默认 9000)
 *   --name, -n <name>     设置显示名称
 *   --security <level>    设置安全等级 (low|medium|high)
 *   --data-dir <path>     设置数据目录 (默认 ~/.f2a)
 *
 * 环境变量 (优先级低于命令行参数):
 *   F2A_DISPLAY_NAME   - 显示名称
 *   F2A_PORT           - P2P 端口
 *   F2A_SECURITY_LEVEL - 安全等级
 *   F2A_DATA_DIR       - 数据目录
 *   F2A_LOG_LEVEL      - 日志级别
 *   F2A_LOG_MAX_SIZE   - 日志文件最大大小
 *   F2A_LOG_MAX_FILES  - 保留的日志文件数量
 */

const { F2A } = require('./scripts/index');
const { IdentityManager } = require('./scripts/identity');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// 支持 F2A_DATA_DIR 环境变量配置数据目录
const DATA_DIR = process.env.F2A_DATA_DIR || path.join(os.homedir(), '.f2a');
const PID_FILE = path.join(DATA_DIR, 'daemon.pid');
const PID_LOCK_FILE = path.join(DATA_DIR, 'daemon.pid.lock');
const LOG_FILE = path.join(DATA_DIR, 'daemon.log');
const CONTROL_PORT = 9001; // HTTP 控制端口

// OpenClaw Webhook 配置
const OPENCLAW_HOOK_URL = process.env.OPENCLAW_HOOK_URL || 'http://127.0.0.1:18789/hooks/agent';
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN || '';

// 控制服务器配置
const CONTROL_TOKEN = process.env.F2A_CONTROL_TOKEN || 'f2a-default-token';

// 日志配置
const LOG_MAX_SIZE = parseInt(process.env.F2A_LOG_MAX_SIZE) || 10 * 1024 * 1024; // 默认 10MB
const LOG_MAX_FILES = parseInt(process.env.F2A_LOG_MAX_FILES) || 5; // 保留 5 个备份

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

// 获取文件锁（防止 PID 文件竞态）
function acquireLock() {
  try {
    // 使用独占模式创建锁文件（原子操作）
    const fd = fs.openSync(PID_LOCK_FILE, 'wx');
    fs.writeSync(fd, process.pid.toString());
    fs.closeSync(fd);
    return true;
  } catch (e) {
    return false;
  }
}

// 释放文件锁
function releaseLock() {
  try {
    if (fs.existsSync(PID_LOCK_FILE)) {
      fs.unlinkSync(PID_LOCK_FILE);
    }
  } catch (e) {
    // 忽略错误
  }
}

// 检查并轮转日志文件
function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;

    const stats = fs.statSync(LOG_FILE);
    if (stats.size < LOG_MAX_SIZE) return;

    // 轮转日志：daemon.log -> daemon.log.1 -> daemon.log.2 -> ...
    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
      const oldFile = `${LOG_FILE}.${i}`;
      const newFile = `${LOG_FILE}.${i + 1}`;

      if (fs.existsSync(oldFile)) {
        if (i === LOG_MAX_FILES - 1) {
          fs.unlinkSync(oldFile); // 删除最老的
        } else {
          fs.renameSync(oldFile, newFile);
        }
      }
    }

    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch (e) {
    console.error('[F2A] Log rotation failed:', e.message);
  }
}

// 启动守护进程
async function start() {
  // 获取文件锁防止竞态
  if (!acquireLock()) {
    console.log('[F2A] Another instance is starting, please wait...');
    process.exit(1);
  }

  try {
    // 检查是否已在运行
    if (fs.existsSync(PID_FILE)) {
      const pid = fs.readFileSync(PID_FILE, 'utf8');
      try {
        process.kill(parseInt(pid), 0);
        console.log(`[F2A] Daemon already running (PID: ${pid})`);
        releaseLock();
        return;
      } catch (e) {
        // 进程不存在，继续启动
      }
    }

    // 初始化身份管理器并获取/创建身份
    const identityManager = new IdentityManager({ configDir: DATA_DIR });
    const displayName = process.env.F2A_DISPLAY_NAME;
    const identity = identityManager.getOrCreateIdentity(displayName);

    // 显示身份信息
    if (identity.isNew) {
      console.log('🆕 新身份已创建');
    } else {
      console.log('📋 已加载现有身份');
    }
    console.log(`🆔 Agent ID: ${identity.agentId}`);
    if (identity.displayName) {
      console.log(`🏷️  显示名称: ${identity.displayName}`);
    }
    console.log(`💾 身份文件: ${identityManager.getConfigPath()}`);
    console.log('');

    const f2a = new F2A({
      myAgentId: identity.agentId,
      myPublicKey: identity.publicKey,
      myPrivateKey: identity.privateKey,
      p2pPort: parseInt(process.env.F2A_PORT) || 9000,
      logLevel: process.env.F2A_LOG_LEVEL || 'INFO',
      security: {
        level: process.env.F2A_SECURITY_LEVEL || 'medium',
        requireConfirmation: true
      }
    });

    // 事件监听
    f2a.on('connected', ({ peerId, type }) => {
      log(`Connected to: ${peerId.slice(0, 16)}... via ${type}`);
    });

    f2a.on('disconnected', ({ peerId }) => {
      log(`Disconnected from: ${peerId.slice(0, 16)}...`);
    });

    f2a.on('message', ({ peerId, message }) => {
      if (message.type === 'message') {
        log(`Message from ${peerId.slice(0, 16)}...: ${message.content}`);
      }
    });

    // 连接请求通知 - 发送到 OpenClaw
    f2a.on('confirmation_required', async ({ agentId, address, port, confirmationId }) => {
      log(`Connection request from: ${agentId.slice(0, 16)}... at ${address}:${port}`);
      
      // 发送 webhook 通知到 OpenClaw
      await sendOpenClawNotification(agentId, address, port, confirmationId);
    });

    await f2a.start();

    // 启动 HTTP 控制端点
    startControlServer(f2a);

    // 保存 PID
    fs.writeFileSync(PID_FILE, process.pid.toString(), { mode: 0o600 });

    log(`F2A Daemon started as ${f2a.myAgentId}`);
    log(`P2P Port: ${f2a.p2p.p2pPort}`);
    log(`Control Port: ${CONTROL_PORT}`);
    log(`PID: ${process.pid}`);

    // 释放启动锁，保留 PID 文件用于运行时检查
    releaseLock();

    // 保持运行
    process.stdin.resume();

    // 优雅退出
    process.on('SIGINT', () => {
      log('Shutting down...');
      f2a.stop();
      cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      log('Shutting down...');
      f2a.stop();
      cleanup();
      process.exit(0);
    });
  } catch (err) {
    releaseLock();
    throw err;
  }
}

// 清理函数
function cleanup() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    releaseLock();
  } catch (e) {
    // 忽略错误
  }
}

// 停止守护进程
function stop() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('[F2A] Daemon not running');
    return;
  }

  const pid = fs.readFileSync(PID_FILE, 'utf8');
  try {
    process.kill(parseInt(pid), 'SIGTERM');
    console.log(`[F2A] Daemon stopped (PID: ${pid})`);
    fs.unlinkSync(PID_FILE);
  } catch (e) {
    console.error(`[F2A] Failed to stop daemon: ${e.message}`);
    fs.unlinkSync(PID_FILE);
  }
}

// 查看状态
function status() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('[F2A] Daemon not running');
    return;
  }

  const pid = fs.readFileSync(PID_FILE, 'utf8');
  try {
    process.kill(parseInt(pid), 0);
    console.log(`[F2A] Daemon running (PID: ${pid})`);

    // 显示身份信息
    const identityManager = new IdentityManager({ configDir: DATA_DIR });
    const info = identityManager.getIdentityInfo();
    if (info) {
      console.log(`🆔 Agent ID: ${info.agentId}`);
      if (info.displayName) {
        console.log(`🏷️  显示名称: ${info.displayName}`);
      }
    }

    // 显示日志
    if (fs.existsSync(LOG_FILE)) {
      const logs = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-10);
      console.log('\nRecent logs:');
      logs.forEach(line => {
        if (line.trim()) console.log('  ' + line);
      });
    }
  } catch (e) {
    console.log('[F2A] Daemon not running (stale PID file)');
    fs.unlinkSync(PID_FILE);
  }
}

// 日志函数
function log(message) {
  // 检查并轮转日志
  rotateLogIfNeeded();

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

// 解析命令行参数
function parseArgs(argv) {
  const args = {
    command: 'start',
    debug: false,
    daemon: false,
    port: null,
    name: null,
    security: null,
    dataDir: null,
    showHelp: false
  };

  let i = 2; // 从 process.argv[2] 开始

  // 先检查是否有 help 选项
  for (let j = i; j < argv.length; j++) {
    if (argv[j] === '--help' || argv[j] === '-h') {
      args.showHelp = true;
      return args;
    }
  }

  // 第一个参数是命令（如果不是选项）
  if (argv[i] && !argv[i].startsWith('-')) {
    args.command = argv[i];
    i++;
  }

  // 解析选项
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--debug' || arg === '-d') {
      args.debug = true;
      i++;
    } else if (arg === '--daemon' || arg === '-D') {
      args.daemon = true;
      i++;
    } else if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      args.port = parseInt(argv[i + 1]);
      i += 2;
    } else if ((arg === '--name' || arg === '-n') && argv[i + 1]) {
      args.name = argv[i + 1];
      i += 2;
    } else if (arg === '--security' && argv[i + 1]) {
      args.security = argv[i + 1];
      i += 2;
    } else if (arg === '--data-dir' && argv[i + 1]) {
      args.dataDir = argv[i + 1];
      i += 2;
    } else {
      i++;
    }
  }

  return args;
}

// 显示帮助信息
function showHelp() {
  console.log(`
F2A Daemon - Friend-to-Agent P2P Networking

Usage: node start-daemon.js [command] [options]

Commands:
  start       Start the daemon (default)
  stop        Stop the daemon
  status      Show daemon status

Options:
  -d, --debug              Enable DEBUG log level
  -D, --daemon             Run as daemon (background)
  -p, --port <number>      Set P2P port (default: 9000)
  -n, --name <name>        Set display name
      --security <level>   Set security level (low|medium|high)
      --data-dir <path>    Set data directory (default: ~/.f2a)
  -h, --help               Show this help message

Examples:
  node start-daemon.js start --daemon
  node start-daemon.js start -D --debug
  node start-daemon.js start -D -p 9001 -n "MyAgent"
  node start-daemon.js status
  node start-daemon.js stop
`);
}

// 主函数
const args = parseArgs(process.argv);

// 显示帮助信息
if (args.showHelp) {
  showHelp();
  process.exit(0);
}

// 应用参数（优先级：命令行 > 环境变量 > 默认值）
if (args.debug) {
  process.env.F2A_LOG_LEVEL = 'DEBUG';
}
if (args.port) {
  process.env.F2A_PORT = args.port.toString();
}
if (args.name) {
  process.env.F2A_DISPLAY_NAME = args.name;
}
if (args.security) {
  process.env.F2A_SECURITY_LEVEL = args.security;
}
if (args.dataDir) {
  process.env.F2A_DATA_DIR = args.dataDir;
}

switch (args.command) {
  case 'start':
    // 如果指定了 --daemon，则 fork 到后台运行
    if (args.daemon) {
      const { spawn } = require('child_process');

      // 获取当前脚本的参数，去掉 --daemon/-D
      const childArgs = process.argv.slice(2).filter(
        arg => arg !== '--daemon' && arg !== '-D'
      );

      console.log('[F2A] Starting daemon in background...');

      // 使用 __filename 确保指向 start-daemon.js
      const scriptPath = __filename;
      const child = spawn(process.execPath, [scriptPath, ...childArgs], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore']
      });

      child.unref();

      // 等待一小段时间确认启动成功
      setTimeout(() => {
        status();
        process.exit(0);
      }, 1500);
    } else {
      start().catch(err => {
        console.error('[F2A] Failed to start:', err.message);
        process.exit(1);
      });
    }
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    status();
    break;
  default:
    console.log(`Unknown command: ${args.command}`);
    showHelp();
    process.exit(1);
}

// 发送 OpenClaw 通知（带重试）
async function sendOpenClawNotification(agentId, address, port, confirmationId, retries = 3) {
  if (!OPENCLAW_HOOK_TOKEN) {
    log('[HOOK] OPENCLAW_HOOK_TOKEN not set, skipping notification');
    return;
  }

  const shortId = confirmationId.slice(0, 8);
  const payload = JSON.stringify({
    message: `[F2A] 收到新的连接请求

Agent ID: ${agentId.slice(0, 16)}...
地址: ${address}:${port}
请求ID: ${shortId}

回复 "f2a 允许 ${shortId}" 来接受连接
回复 "f2a 拒绝 ${shortId}" 来拒绝连接`,
    name: 'F2A',
    wakeMode: 'now',
    deliver: true
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request(OPENCLAW_HOOK_URL, {
          method: 'POST',
          timeout: 5000, // 5秒超时
          headers: {
            'Authorization': `Bearer ${OPENCLAW_HOOK_TOKEN}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          if (res.statusCode === 200 || res.statusCode === 202) {
            log(`[HOOK] Notification sent to OpenClaw (attempt ${attempt})`);
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Timeout'));
        });

        req.write(payload);
        req.end();
      });
      
      // 成功发送，退出重试循环
      return;
    } catch (err) {
      log(`[HOOK] Attempt ${attempt} failed: ${err.message}`);
      
      if (attempt < retries) {
        // 等待 1 秒后重试
        await new Promise(r => setTimeout(r, 1000));
      } else {
        log(`[HOOK] All ${retries} attempts failed, notification not sent`);
      }
    }
  }
}

// 启动 HTTP 控制服务器
function startControlServer(f2a) {
  const server = http.createServer((req, res) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-F2A-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // 验证 token
    const token = req.headers['x-f2a-token'];
    if (token !== CONTROL_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/control') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { action, idOrIndex, reason } = JSON.parse(body);
        let result;

        switch (action) {
          case 'list-pending':
            const pending = f2a.getPendingConnections();
            result = { success: true, pending };
            break;

          case 'confirm':
            const confirmResult = f2a.confirmConnection(idOrIndex);
            if (confirmResult.success) {
              result = { 
                success: true, 
                message: `已接受 ${confirmResult.pending.agentId.slice(0, 16)}... 的连接` 
              };
            } else {
              result = { success: false, error: confirmResult.error };
            }
            break;

          case 'reject':
            const rejectResult = f2a.rejectConnection(idOrIndex, reason);
            if (rejectResult.success) {
              result = { 
                success: true, 
                message: `已拒绝 ${rejectResult.pending.agentId.slice(0, 16)}... 的连接` 
              };
            } else {
              result = { success: false, error: rejectResult.error };
            }
            break;

          default:
            result = { success: false, error: 'Unknown action' };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
      }
    });
  });

  server.listen(CONTROL_PORT, () => {
    log(`Control server listening on port ${CONTROL_PORT}`);
  });

  return server;
}
