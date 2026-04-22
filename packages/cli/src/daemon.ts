/**
 * F2A CLI Daemon Commands
 * Daemon startup and management commands
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync, renameSync, openSync, closeSync, writeSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname } from 'os';
import { request, RequestOptions } from 'http';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { loadConfig } from './config.js';
import { isJsonMode, outputJson } from './output.js';

// ESM 中使用 createRequire 来获取 require.resolve
const require = createRequire(import.meta.url);

const F2A_DIR = join(homedir(), '.f2a');
const PID_FILE = join(F2A_DIR, 'daemon.pid');
const LOG_FILE = join(F2A_DIR, 'daemon.log');
const LOCK_FILE = join(F2A_DIR, 'daemon.lock');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

// 获取当前模块所在目录（用于定位 daemon 脚本）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 确保 .f2a 目录存在
 */
function ensureF2ADir(): void {
  if (!existsSync(F2A_DIR)) {
    mkdirSync(F2A_DIR, { recursive: true });
  }
}

/**
 * 获取 PID 文件路径
 */
export function getPidFile(): string {
  return PID_FILE;
}

/**
 * 获取日志文件路径
 */
export function getLogFile(): string {
  return LOG_FILE;
}

/**
 * 检查进程是否存在
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取后台 daemon 的 PID
 */
function readDaemonPid(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (isNaN(pid)) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * 写入 daemon PID 到文件
 */
function writeDaemonPid(pid: number): void {
  ensureF2ADir();
  writeFileSync(PID_FILE, pid.toString(), 'utf-8');
}

/**
 * 删除 PID 文件
 */
function removePidFile(): void {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
}

/**
 * 获取文件锁（防止竞态条件）
 * @returns 是否成功获取锁
 */
export function acquireLock(): boolean {
  try {
    ensureF2ADir();
    
    // 检查是否存在过期锁（进程已死亡但锁文件残留）
    if (existsSync(LOCK_FILE)) {
      try {
        const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
        if (!isNaN(lockPid) && !isProcessRunning(lockPid)) {
          // 进程已死亡，清理过期锁
          unlinkSync(LOCK_FILE);
        } else {
          // 锁被其他活跃进程持有
          return false;
        }
      } catch {
        // 无法读取锁文件，尝试删除
        unlinkSync(LOCK_FILE);
      }
    }
    
    // 尝试创建锁文件（原子操作）
    const fd = openSync(LOCK_FILE, 'wx');
    writeSync(fd, process.pid.toString());
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * 释放文件锁（仅释放当前进程持有的锁）
 */
export function releaseLock(): void {
  if (!existsSync(LOCK_FILE)) {
    return;
  }
  
  try {
    // 验证锁文件中的 PID 是否为当前进程，避免误删其他进程的锁
    const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
    if (!isNaN(lockPid) && lockPid === process.pid) {
      unlinkSync(LOCK_FILE);
    }
    // 如果 PID 不匹配，说明锁已被其他进程持有，不删除
  } catch {
    // 读取失败，可能锁文件已损坏或被删除，忽略
  }
}

/**
 * 检查日志文件大小并轮转
 */
export function rotateLogIfNeeded(): void {
  if (!existsSync(LOG_FILE)) {
    return;
  }
  
  try {
    const stats = statSync(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE) {
      const oldLogFile = LOG_FILE + '.old';
      if (existsSync(oldLogFile)) {
        unlinkSync(oldLogFile);
      }
      renameSync(LOG_FILE, oldLogFile);
    }
  } catch {
    // 忽略错误
  }
}

/**
 * 检查 daemon 是否在运行
 * 优先检查 PID 文件，如果 PID 文件丢失但端口被占用，也认为是运行中
 * P1-3 修复：同时检查 /health 端点，避免误判正在启动中的 daemon
 */
export async function isDaemonRunning(): Promise<boolean> {
  const pid = readDaemonPid();
  if (pid !== null && isProcessRunning(pid)) {
    // PID 存在且进程正在运行，直接返回 true
    return true;
  }
  
  // PID 文件丢失或进程不存在，检查端口是否被占用
  const controlPort = getControlPort();
  const portInUse = await checkPortInUse(controlPort);
  return portInUse;
}

// 同步版本用于向后兼容（不检查端口）
export function isDaemonRunningSync(): boolean {
  const pid = readDaemonPid();
  if (pid === null) {
    return false;
  }
  return isProcessRunning(pid);
}

/**
 * 获取控制端口（运行时读取）
 */
function getControlPort(): number {
  return parseInt(process.env.F2A_CONTROL_PORT || '9001');
}

/**
 * 获取 daemon 状态信息
 */
export function getDaemonStatus(): { running: boolean; pid?: number; port: number } {
  const pid = readDaemonPid();
  const running = pid !== null && isProcessRunning(pid);
  return {
    running,
    pid: running ? pid! : undefined,
    port: getControlPort()
  };
}

/**
 * 前台启动 daemon
 */
export async function startForeground(): Promise<void> {
  const controlPort = getControlPort();
  
  // Check if daemon is already running
  if (await isDaemonRunning()) {
    console.error('[F2A] Error: Daemon is already running. Please stop it before starting a new instance.');
    console.error('[F2A] Hint: Use "f2a daemon stop" to stop the existing daemon first.');
    process.exit(1);
  }

  // Check if port is in use
  const portInUse = await checkPortInUse(controlPort);
  if (portInUse) {
    console.error(`[F2A] Error: Port ${controlPort} is already in use.`);
    console.error('[F2A] Hint: Check if another F2A daemon is running, or set F2A_CONTROL_PORT environment variable to use a different port.');
    process.exit(1);
  }

  ensureF2ADir();
  rotateLogIfNeeded();
  
  console.log('[F2A] Starting daemon (foreground mode)...');
  console.log(`[F2A] Control port: ${controlPort}`);
  console.log('[F2A] Press Ctrl+C to stop.');

  // 动态导入 daemon 模块并启动
  const { F2ADaemon } = await import('@f2a/daemon');
  
  // 读取配置
  const config = loadConfig();
  
  // Node displayName: 使用 hostname (去掉 .local 后缀)
  const hostnameShort = hostname().split('.')[0];
  
  // 解析引导节点
  const bootstrapPeers = process.env.BOOTSTRAP_PEERS 
    ? process.env.BOOTSTRAP_PEERS.split(',').filter(Boolean)
    : config.network.bootstrapPeers;

  // P2P 端口
  const p2pPort = parseInt(process.env.F2A_P2P_PORT || '0') || config.p2pPort;

  // 消息处理 URL
  const messageHandlerUrl = process.env.F2A_MESSAGE_HANDLER_URL || config.messageHandlerUrl;

  const daemon = new F2ADaemon({
    controlPort,
    displayName: hostnameShort,
    network: {
      listenPort: p2pPort,
      bootstrapPeers,
    },
    messageHandlerUrl,
  });

  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\n[F2A] Stopping daemon...');
    await daemon.stop();
    removePidFile();
    console.log('[F2A] Daemon stopped successfully.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await daemon.start();
    console.log(`[F2A] Daemon started successfully. Node ID: ${daemon.getF2A()?.peerId?.slice(0, 16)}...`);
    
    // Keep process running
    await new Promise<void>((resolve) => {
      process.on('exit', () => resolve());
    });
  } catch (error) {
    console.error('[F2A] Error: Failed to start daemon:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * 后台启动 daemon
 */
export async function startBackground(): Promise<void> {
  const controlPort = getControlPort();
  
  // Check if daemon is already running
  if (await isDaemonRunning()) {
    console.error('[F2A] Error: Daemon is already running. Please stop it before starting a new instance.');
    const status = getDaemonStatus();
    if (status.pid) {
      console.error(`[F2A] PID: ${status.pid}`);
    }
    process.exit(1);
  }

  // Check if port is in use
  const portInUse = await checkPortInUse(controlPort);
  if (portInUse) {
    console.error(`[F2A] Error: Port ${controlPort} is already in use.`);
    console.error('[F2A] Hint: Check if another F2A daemon is running, or set F2A_CONTROL_PORT environment variable to use a different port.');
    process.exit(1);
  }

  ensureF2ADir();

  // Rotate log file
  rotateLogIfNeeded();

  console.log('[F2A] Starting daemon (background mode)...');
  console.log(`[F2A] Control port: ${controlPort}`);
  console.log(`[F2A] Log file: ${LOG_FILE}`);

  // 使用 require.resolve 定位 @f2a/daemon 包的位置
  // 这样无论 npm 如何 hoisting 依赖，都能找到正确的路径
  const nodePath = process.execPath;
  let daemonScript: string;
  
  try {
    // 尝试通过 require.resolve 找到 daemon 包
    const daemonPackagePath = require.resolve('@f2a/daemon/package.json');
    const daemonDistPath = join(dirname(daemonPackagePath), 'dist', 'main.js');
    daemonScript = daemonDistPath;
  } catch {
    // fallback: 尝试本地开发路径
    daemonScript = join(__dirname, '..', 'daemon', 'main.js');
  }
  
  // Check if daemon script exists
  if (!existsSync(daemonScript)) {
    console.error('[F2A] Error: Daemon script not found.');
    console.error('[F2A] Hint: Please run "npm run build" first to compile the daemon module.');
    process.exit(1);
  }

  // 读取配置
  const config = loadConfig();
  
  // Node displayName
  const hostnameShort = hostname().split('.')[0];

  // 构建环境变量
  const env = { ...process.env };
  if (!env.F2A_CONTROL_PORT) {
    env.F2A_CONTROL_PORT = controlPort.toString();
  }
  // 传递 displayName
  if (!env.F2A_NODE_NAME) {
    env.F2A_NODE_NAME = hostnameShort;
  }
  // 传递引导节点
  if (!env.BOOTSTRAP_PEERS && config.network.bootstrapPeers.length > 0) {
    env.BOOTSTRAP_PEERS = config.network.bootstrapPeers.join(',');
  }
  // 传递 P2P 端口
  if (!env.F2A_P2P_PORT && config.p2pPort !== 0) {
    env.F2A_P2P_PORT = config.p2pPort.toString();
  }

  // Acquire file lock (prevent race conditions)
  if (!acquireLock()) {
    console.error('[F2A] Error: Cannot acquire lock. Another daemon instance may be starting or has just started.');
    console.error('[F2A] Hint: Please try again later, or check if another f2a daemon process is running.');
    process.exit(1);
  }

  try {
    // 启动后台进程
    const child = spawn(nodePath, [daemonScript], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],  // 忽略所有 stdio，避免父进程等待
      env,
      // 使用跨平台的工作目录
      cwd: homedir(),
    });

    // Wait for daemon process to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Startup timeout: Daemon process did not start within 10 seconds.'));
      }, 10000);

      let started = false;

      child.on('spawn', () => {
        // 再次检查竞态条件：确保没有其他进程同时写入 PID 文件
        const currentPid = readDaemonPid();
        if (currentPid !== null && currentPid !== child.pid && isProcessRunning(currentPid)) {
          // Another process already started, terminate current process
          // Note: Do not delete PID file, it belongs to another process
          child.kill();
          clearTimeout(timeout);
          reject(new Error('Race condition: Another daemon instance has already started.'));
          return;
        }
        
        // Write PID file
        writeDaemonPid(child.pid!);
        console.log(`[F2A] Daemon started successfully. PID: ${child.pid}`);
        started = true;
        clearTimeout(timeout);
        resolve();
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (!started) {
          reject(err);
        }
      });

      // Check if process exits immediately
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (!started) {
          reject(new Error(`Daemon startup failed with exit code: ${code}. Check daemon.log for details.`));
        }
      });
    });

    // 分离子进程
    child.unref();
  } catch (error) {
    // 启动失败，释放锁
    releaseLock();
    throw error;
  }
  
  // 释放文件锁（daemon 已成功启动）
  releaseLock();

  // Wait for daemon HTTP service to be ready (poll /health endpoint)
  // Timeout can be configured via F2A_HEALTH_TIMEOUT environment variable (milliseconds, default 15000)
  console.log('[F2A] Waiting for daemon service to be ready...');
  const healthTimeout = parseInt(process.env.F2A_HEALTH_TIMEOUT || '15000', 10);
  const healthReady = await waitForDaemonHealth(controlPort, healthTimeout);
  
  if (healthReady) {
    console.log('[F2A] Daemon service is ready.');
  } else {
    console.warn('[F2A] Warning: Daemon service may not be fully ready. Please check the log file for details.');
  }

  console.log('[F2A] Hint: Use "f2a daemon status" to check daemon status.');
  console.log('[F2A] Hint: Use "f2a daemon stop" to stop the daemon.');
}

/**
 * 停止后台 daemon
 */
export async function stopDaemon(): Promise<void> {
  const pid = readDaemonPid();
  
  if (pid === null) {
    console.log('[F2A] No daemon is currently running.');
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log('[F2A] Daemon process no longer exists. Cleaning up PID file.');
    removePidFile();
    return;
  }

  console.log(`[F2A] Stopping daemon (PID: ${pid})...`);

  try {
    // 跨平台信号处理
    // Windows 不支持 SIGTERM，使用 SIGKILL 或 taskkill
    const isWindows = process.platform === 'win32';
    
    if (isWindows) {
      // Windows: 使用 taskkill 强制终止进程树
      const { execSync } = await import('child_process');
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // 如果 taskkill 失败，尝试使用 process.kill
        process.kill(pid, 'SIGKILL');
      }
    } else {
      // Unix: 发送 SIGTERM 信号
      process.kill(pid, 'SIGTERM');

      // 等待进程退出
      let attempts = 0;
      const maxAttempts = 30; // 最多等待 3 秒

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (!isProcessRunning(pid)) {
          break;
        }
        attempts++;
      }

      // Force kill if process is still running
      if (isProcessRunning(pid)) {
        console.log('[F2A] Daemon did not respond to SIGTERM. Force killing...');
        process.kill(pid, 'SIGKILL');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Check process status again
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (!isProcessRunning(pid)) {
      console.log('[F2A] Daemon stopped successfully.');
      removePidFile();
    } else {
      console.error('[F2A] Error: Cannot stop daemon. Process may be stuck or requires higher privileges.');
      process.exit(1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      console.error('[F2A] Error: Permission denied. Cannot stop daemon.');
      process.exit(1);
    } else if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      console.log('[F2A] Daemon process no longer exists.');
      removePidFile();
    } else {
      throw error;
    }
  }
}

/**
 * Restart background daemon
 * Stop then start, keeping original configuration
 */
export async function restartDaemon(): Promise<void> {
  console.log('[F2A] Restarting daemon...');
  
  // Check current status
  const status = getDaemonStatus();
  
  if (status.running) {
    console.log('[F2A] Stopping current daemon...');
    await stopDaemon();
    
    // Wait briefly for port to be released
    console.log('[F2A] Waiting for resources to be released...');
    await new Promise(resolve => setTimeout(resolve, 1000));
  } else {
    console.log('[F2A] No daemon is currently running.');
  }
  
  // Check if port is still in use
  const controlPort = getControlPort();
  const portInUse = await checkPortInUse(controlPort);
  
  if (portInUse) {
    console.warn(`[F2A] Warning: Port ${controlPort} is still in use.`);
    console.warn('[F2A] Waiting longer for port to be released...');
    
    // Wait up to 10 seconds
    let attempts = 0;
    const maxAttempts = 20;
    
    while (portInUse && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    
    if (await checkPortInUse(controlPort)) {
      console.error(`[F2A] Error: Port ${controlPort} is still in use. Cannot start daemon.`);
      console.error('[F2A] Hint: Please manually check and release the port.');
      process.exit(1);
    }
  }
  
  // Start daemon
  console.log('[F2A] Starting daemon...');
  await startBackground();
  
  console.log('[F2A] Daemon restart completed successfully.');
}

/**
 * Show daemon status
 */
export async function showStatus(): Promise<void> {
  const status = getDaemonStatus();
  const port = getControlPort();
  
  // Check if port is in use (handle PID file missing case)
  const portInUse = await checkPortInUse(port);
  
  // JSON output mode
  if (isJsonMode()) {
    if (status.running && status.pid) {
      // Daemon running with PID
      try {
        const info = await fetchDaemonInfo(port);
        outputJson({
          running: true,
          pid: status.pid,
          port: port,
          peerId: info?.peerId,
          logFile: LOG_FILE
        });
      } catch {
        outputJson({
          running: true,
          pid: status.pid,
          port: port,
          logFile: LOG_FILE
        });
      }
    } else if (portInUse) {
      // PID file missing but port in use
      try {
        const info = await fetchDaemonInfo(port);
        outputJson({
          running: true,
          port: port,
          peerId: info?.peerId,
          warning: 'PID file missing - port in use but no PID file found'
        });
      } catch {
        outputJson({
          running: true,
          port: port,
          warning: 'PID file missing - port in use but no PID file found'
        });
      }
    } else {
      // Daemon not running
      outputJson({
        running: false,
        port: port
      });
    }
    return;
  }
  
  // Human-readable output mode
  console.log('F2A Daemon Status:');
  console.log(`  Control port: ${port}`);
  
  if (status.running && status.pid) {
    console.log(`  Running: Yes`);
    console.log(`  PID: ${status.pid}`);
    console.log(`  Log file: ${LOG_FILE}`);
    
    // Try to get more info
    try {
      const info = await fetchDaemonInfo(port);
      if (info) {
        console.log(`  Node ID: ${info.peerId?.slice(0, 16)}...`);
      }
    } catch {
      // Ignore errors
    }
  } else if (portInUse) {
    // PID file missing but port in use
    console.log(`  Running: Yes (PID file missing)`);
    console.log(`  Warning: Port ${port} is in use but PID file does not exist.`);
    console.log(`  Possible cause: System reboot or PID file was deleted.`);
    console.log(`  Suggestion: Manually restore PID file or restart daemon.`);
    
    // Try to get more info
    try {
      const info = await fetchDaemonInfo(port);
      if (info) {
        console.log(`  Node ID: ${info.peerId?.slice(0, 16)}...`);
      }
    } catch {
      // Ignore errors
    }
  } else {
    console.log(`  Running: No`);
    console.log('  Hint: Use "f2a daemon" to start the daemon.');
  }
}

/**
 * 检查端口是否被占用
 * 使用 net 模块直接检测，比 HTTP 请求更可靠
 */
async function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true); // 端口被占用
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close(() => resolve(false)); // 端口可用
    });
    
    // 使用 0.0.0.0 检测，因为 daemon 可能监听所有接口
    server.listen(port, '0.0.0.0');
  });
}

/**
 * 等待 daemon HTTP 服务就绪
 * 轮询 /health 端点直到服务可用
 */
async function waitForDaemonHealth(port: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 200; // 每 200ms 检查一次
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const healthy = await checkDaemonHealth(port);
      if (healthy) {
        return true;
      }
    } catch {
      // 忽略错误，继续轮询
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return false;
}

/**
 * 检查 daemon 健康状态
 */
async function checkDaemonHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = request({
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        timeout: 1000,
      }, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * 从运行中的 daemon 获取信息
 */
async function fetchDaemonInfo(port?: number): Promise<{ peerId?: string } | null> {
  return new Promise((resolve) => {
    const req = request({
      hostname: '127.0.0.1',
      port: port || getControlPort(),
      path: '/health',
      method: 'GET',
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}