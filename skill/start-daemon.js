#!/usr/bin/env node
/**
 * F2A 后台服务启动脚本
 * 
 * 用法:
 *   node start-daemon.js [start|stop|status]
 * 
 * 环境变量:
 *   F2A_AGENT_ID - Agent ID
 *   F2A_PORT - P2P 端口 (默认 9000)
 *   F2A_SECURITY_LEVEL - 安全等级 (默认 medium)
 */

const { F2A } = require('./scripts/index');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PID_FILE = path.join(os.homedir(), '.f2a', 'daemon.pid');
const LOG_FILE = path.join(os.homedir(), '.f2a', 'daemon.log');

// 生成或加载密钥对
function getKeyPair() {
  const keyFile = path.join(os.homedir(), '.f2a', 'keys.json');
  
  if (fs.existsSync(keyFile)) {
    try {
      const keys = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      return keys;
    } catch (e) {
      console.error('[F2A] Failed to load keys, generating new ones');
    }
  }
  
  const keyPair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  fs.writeFileSync(keyFile, JSON.stringify(keyPair, null, 2), { mode: 0o600 });
  return keyPair;
}

// 启动守护进程
async function start() {
  // 检查是否已在运行
  if (fs.existsSync(PID_FILE)) {
    const pid = fs.readFileSync(PID_FILE, 'utf8');
    try {
      process.kill(parseInt(pid), 0);
      console.log(`[F2A] Daemon already running (PID: ${pid})`);
      return;
    } catch (e) {
      // 进程不存在，继续启动
    }
  }
  
  const keyPair = getKeyPair();
  
  const f2a = new F2A({
    myAgentId: process.env.F2A_AGENT_ID,
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    p2pPort: parseInt(process.env.F2A_PORT) || 9000,
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
  
  await f2a.start();
  
  // 保存 PID
  fs.writeFileSync(PID_FILE, process.pid.toString());
  
  log(`F2A Daemon started as ${f2a.myAgentId}`);
  log(`P2P Port: ${f2a.p2p.p2pPort}`);
  log(`PID: ${process.pid}`);
  
  // 保持运行
  process.stdin.resume();
  
  // 优雅退出
  process.on('SIGINT', () => {
    log('Shutting down...');
    f2a.stop();
    fs.unlinkSync(PID_FILE);
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log('Shutting down...');
    f2a.stop();
    fs.unlinkSync(PID_FILE);
    process.exit(0);
  });
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
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

// 主函数
const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    start().catch(err => {
      console.error('[F2A] Failed to start:', err.message);
      process.exit(1);
    });
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    status();
    break;
  default:
    console.log('Usage: node start-daemon.js [start|stop|status]');
    process.exit(1);
}
