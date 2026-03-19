/**
 * F2A CLI Daemon Commands
 * Daemon 启动和管理命令
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync, renameSync, openSync, closeSync, writeSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { request, RequestOptions } from 'http';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';

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
 */
export async function isDaemonRunning(): Promise<boolean> {
  const pid = readDaemonPid();
  if (pid !== null && isProcessRunning(pid)) {
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
  
  // 检查是否已有 daemon 在运行
  if (await isDaemonRunning()) {
    console.error('[F2A] Daemon 已经在运行中');
    console.error('[F2A] 使用 "f2a daemon stop" 停止后再启动');
    process.exit(1);
  }

  // 检查端口是否被占用
  const portInUse = await checkPortInUse(controlPort);
  if (portInUse) {
    console.error(`[F2A] 端口 ${controlPort} 已被占用`);
    console.error('[F2A] 请检查是否有其他 F2A daemon 在运行，或使用 F2A_CONTROL_PORT 环境变量指定其他端口');
    process.exit(1);
  }

  ensureF2ADir();
  rotateLogIfNeeded();
  
  console.log('[F2A] 启动 daemon (前台模式)...');
  console.log(`[F2A] 控制端口: ${controlPort}`);
  console.log('[F2A] 按 Ctrl+C 停止');

  // 动态导入 daemon 模块并启动
  const { F2ADaemon } = await import('../daemon/index.js');
  
  // 读取配置获取 agentName 作为 displayName
  const config = loadConfig();
  
  // 解析引导节点
  const bootstrapPeers = process.env.BOOTSTRAP_PEERS 
    ? process.env.BOOTSTRAP_PEERS.split(',').filter(Boolean)
    : config.network.bootstrapPeers;

  // P2P 端口
  const p2pPort = parseInt(process.env.F2A_P2P_PORT || '0') || config.p2pPort;

  const daemon = new F2ADaemon({
    controlPort,
    displayName: config.agentName,
    network: {
      listenPort: p2pPort,
      bootstrapPeers,
    },
  });

  // 处理信号
  const shutdown = async () => {
    console.log('\n[F2A] 正在停止 daemon...');
    await daemon.stop();
    removePidFile();
    console.log('[F2A] Daemon 已停止');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await daemon.start();
    console.log(`[F2A] Daemon 已启动，Peer ID: ${daemon.getF2A()?.peerId?.slice(0, 16)}...`);
    
    // 保持进程运行
    await new Promise<void>((resolve) => {
      process.on('exit', () => resolve());
    });
  } catch (error) {
    console.error('[F2A] 启动失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * 后台启动 daemon
 */
export async function startBackground(): Promise<void> {
  const controlPort = getControlPort();
  
  // 检查是否已有 daemon 在运行
  if (await isDaemonRunning()) {
    console.error('[F2A] Daemon 已经在运行中');
    const status = getDaemonStatus();
    if (status.pid) {
      console.error(`[F2A] PID: ${status.pid}`);
    }
    process.exit(1);
  }

  // 检查端口是否被占用
  const portInUse = await checkPortInUse(controlPort);
  if (portInUse) {
    console.error(`[F2A] 端口 ${controlPort} 已被占用`);
    console.error('[F2A] 请检查是否有其他 F2A daemon 在运行，或使用 F2A_CONTROL_PORT 环境变量指定其他端口');
    process.exit(1);
  }

  ensureF2ADir();

  // 日志轮转
  rotateLogIfNeeded();

  console.log('[F2A] 启动 daemon (后台模式)...');
  console.log(`[F2A] 控制端口: ${controlPort}`);
  console.log(`[F2A] 日志文件: ${LOG_FILE}`);

  // 使用脚本所在目录定位 daemon 脚本，而不是 process.cwd()
  // 这样可以在任何目录执行 f2a daemon 命令
  const nodePath = process.execPath;
  // __dirname = dist/cli/, 所以只需要 ../daemon/main.js
  const daemonScript = join(__dirname, '..', 'daemon', 'main.js');
  
  // 检查 daemon 脚本是否存在
  if (!existsSync(daemonScript)) {
    console.error('[F2A] 错误: 找不到 daemon 脚本');
    console.error('[F2A] 请先运行 npm run build');
    process.exit(1);
  }

  // 读取配置获取 agentName
  const config = loadConfig();

  // 构建环境变量
  const env = { ...process.env };
  if (!env.F2A_CONTROL_PORT) {
    env.F2A_CONTROL_PORT = controlPort.toString();
  }
  // 传递 agentName 作为 displayName
  if (!env.F2A_AGENT_NAME) {
    env.F2A_AGENT_NAME = config.agentName;
  }
  // 传递引导节点
  if (!env.BOOTSTRAP_PEERS && config.network.bootstrapPeers.length > 0) {
    env.BOOTSTRAP_PEERS = config.network.bootstrapPeers.join(',');
  }
  // 传递 P2P 端口
  if (!env.F2A_P2P_PORT && config.p2pPort !== 0) {
    env.F2A_P2P_PORT = config.p2pPort.toString();
  }

  // 获取文件锁（防止竞态条件）
  if (!acquireLock()) {
    console.error('[F2A] 无法获取锁，可能有其他 daemon 实例正在启动或刚刚启动');
    console.error('[F2A] 请稍后重试，或检查是否有其他 f2a daemon 进程在运行');
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

    // 等待 daemon 进程启动
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('启动超时'));
      }, 10000);

      let started = false;

      child.on('spawn', () => {
        // 再次检查竞态条件：确保没有其他进程同时写入 PID 文件
        const currentPid = readDaemonPid();
        if (currentPid !== null && currentPid !== child.pid && isProcessRunning(currentPid)) {
          // 另一个进程已启动，终止当前进程
          child.kill();
          removePidFile();
          clearTimeout(timeout);
          reject(new Error('另一个 daemon 实例已启动'));
          return;
        }
        
        // 写入 PID 文件
        writeDaemonPid(child.pid!);
        console.log(`[F2A] Daemon 已启动，PID: ${child.pid}`);
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

      // 检查进程是否立即退出
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (!started) {
          reject(new Error(`Daemon 启动失败，退出码: ${code}`));
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

  // 等待 daemon HTTP 服务就绪（轮询 /health 端点）
  // 可通过 F2A_HEALTH_TIMEOUT 环境变量配置超时时间（毫秒，默认 15000）
  console.log('[F2A] 等待 daemon 服务就绪...');
  const healthTimeout = parseInt(process.env.F2A_HEALTH_TIMEOUT || '15000', 10);
  const healthReady = await waitForDaemonHealth(controlPort, healthTimeout);
  
  if (healthReady) {
    console.log('[F2A] Daemon 服务已就绪');
  } else {
    console.warn('[F2A] 警告: Daemon 服务可能未完全就绪，请检查日志');
  }

  console.log('[F2A] 使用 "f2a daemon status" 查看状态');
  console.log('[F2A] 使用 "f2a daemon stop" 停止 daemon');
}

/**
 * 停止后台 daemon
 */
export async function stopDaemon(): Promise<void> {
  const pid = readDaemonPid();
  
  if (pid === null) {
    console.log('[F2A] 没有运行中的 daemon');
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log('[F2A] Daemon 进程已不存在，清理 PID 文件');
    removePidFile();
    return;
  }

  console.log(`[F2A] 正在停止 daemon (PID: ${pid})...`);

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

      // 如果进程还在运行，强制终止
      if (isProcessRunning(pid)) {
        console.log('[F2A] Daemon 未响应 SIGTERM，强制终止...');
        process.kill(pid, 'SIGKILL');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // 再次检查进程状态
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (!isProcessRunning(pid)) {
      console.log('[F2A] Daemon 已停止');
      removePidFile();
    } else {
      console.error('[F2A] 无法停止 daemon');
      process.exit(1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      console.error('[F2A] 没有权限停止 daemon');
      process.exit(1);
    } else if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      console.log('[F2A] Daemon 进程已不存在');
      removePidFile();
    } else {
      throw error;
    }
  }
}

/**
 * 重启后台 daemon
 * 先停止再启动，保持原有配置
 */
export async function restartDaemon(): Promise<void> {
  console.log('[F2A] 正在重启 daemon...');
  
  // 检查当前状态
  const status = getDaemonStatus();
  
  if (status.running) {
    console.log('[F2A] 停止当前 daemon...');
    await stopDaemon();
    
    // 等待一小段时间确保端口释放
    console.log('[F2A] 等待资源释放...');
    await new Promise(resolve => setTimeout(resolve, 1000));
  } else {
    console.log('[F2A] 当前没有运行中的 daemon');
  }
  
  // 检查端口是否仍被占用
  const controlPort = getControlPort();
  const portInUse = await checkPortInUse(controlPort);
  
  if (portInUse) {
    console.warn(`[F2A] 警告: 端口 ${controlPort} 仍被占用`);
    console.warn('[F2A] 等待更长时间...');
    
    // 最多等待 10 秒
    let attempts = 0;
    const maxAttempts = 20;
    
    while (portInUse && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    
    if (await checkPortInUse(controlPort)) {
      console.error(`[F2A] 错误: 端口 ${controlPort} 仍被占用，无法启动`);
      console.error('[F2A] 请手动检查并释放端口');
      process.exit(1);
    }
  }
  
  // 启动 daemon
  console.log('[F2A] 启动 daemon...');
  await startBackground();
  
  console.log('[F2A] Daemon 重启完成');
}

/**
 * 显示 daemon 状态
 */
export async function showStatus(): Promise<void> {
  const status = getDaemonStatus();
  const port = getControlPort();
  
  // 检查端口是否被占用（处理 PID 文件丢失的情况）
  const portInUse = await checkPortInUse(port);
  
  console.log('F2A Daemon 状态:');
  console.log(`  控制端口: ${port}`);
  
  if (status.running && status.pid) {
    console.log(`  运行中: 是`);
    console.log(`  PID: ${status.pid}`);
    console.log(`  日志文件: ${LOG_FILE}`);
    
    // 尝试获取更多信息
    try {
      const info = await fetchDaemonInfo(port);
      if (info) {
        console.log(`  Peer ID: ${info.peerId?.slice(0, 16)}...`);
      }
    } catch {
      // 忽略错误
    }
  } else if (portInUse) {
    // PID 文件丢失但端口被占用
    console.log(`  运行中: 是 (PID 文件丢失)`);
    console.log(`  警告: 检测到端口 ${port} 被占用，但 PID 文件不存在`);
    console.log(`  可能原因: 系统重启或 PID 文件被删除`);
    console.log(`  建议: 手动恢复 PID 文件或重启 daemon`);
    
    // 尝试获取更多信息
    try {
      const info = await fetchDaemonInfo(port);
      if (info) {
        console.log(`  Peer ID: ${info.peerId?.slice(0, 16)}...`);
      }
    } catch {
      // 忽略错误
    }
  } else {
    console.log(`  运行中: 否`);
    console.log('  使用 "f2a daemon" 启动 daemon');
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
    
    server.listen(port, '127.0.0.1');
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