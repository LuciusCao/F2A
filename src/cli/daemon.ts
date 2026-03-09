/**
 * F2A CLI Daemon Commands
 * Daemon 启动和管理命令
 */

import { spawn, ChildProcess, execSync, exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { request, RequestOptions } from 'http';

const F2A_DIR = join(homedir(), '.f2a');
const PID_FILE = join(F2A_DIR, 'daemon.pid');
const LOG_FILE = join(F2A_DIR, 'daemon.log');
const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');

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
 * 检查 daemon 是否在运行
 */
export function isDaemonRunning(): boolean {
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
  // 检查是否已有 daemon 在运行
  if (isDaemonRunning()) {
    console.error('[F2A] Daemon 已经在运行中');
    console.error('[F2A] 使用 "f2a daemon stop" 停止后再启动');
    process.exit(1);
  }

  // 检查端口是否被占用
  const portInUse = await checkPortInUse(CONTROL_PORT);
  if (portInUse) {
    console.error(`[F2A] 端口 ${CONTROL_PORT} 已被占用`);
    console.error('[F2A] 请检查是否有其他 F2A daemon 在运行，或使用 F2A_CONTROL_PORT 环境变量指定其他端口');
    process.exit(1);
  }

  console.log('[F2A] 启动 daemon (前台模式)...');
  console.log(`[F2A] 控制端口: ${CONTROL_PORT}`);
  console.log('[F2A] 按 Ctrl+C 停止');

  // 动态导入 daemon 模块并启动
  const { F2ADaemon } = await import('../daemon/index.js');
  
  // 解析引导节点
  const bootstrapPeers = process.env.BOOTSTRAP_PEERS 
    ? process.env.BOOTSTRAP_PEERS.split(',').filter(Boolean)
    : undefined;

  // P2P 端口
  const p2pPort = parseInt(process.env.F2A_P2P_PORT || '0');

  const daemon = new F2ADaemon({
    controlPort: CONTROL_PORT,
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
  // 检查是否已有 daemon 在运行
  if (isDaemonRunning()) {
    console.error('[F2A] Daemon 已经在运行中');
    const status = getDaemonStatus();
    if (status.pid) {
      console.error(`[F2A] PID: ${status.pid}`);
    }
    process.exit(1);
  }

  // 检查端口是否被占用
  const portInUse = await checkPortInUse(CONTROL_PORT);
  if (portInUse) {
    console.error(`[F2A] 端口 ${CONTROL_PORT} 已被占用`);
    console.error('[F2A] 请检查是否有其他 F2A daemon 在运行，或使用 F2A_CONTROL_PORT 环境变量指定其他端口');
    process.exit(1);
  }

  ensureF2ADir();

  console.log('[F2A] 启动 daemon (后台模式)...');
  console.log(`[F2A] 控制端口: ${CONTROL_PORT}`);
  console.log(`[F2A] 日志文件: ${LOG_FILE}`);

  // 使用 spawn 启动后台进程
  const nodePath = process.execPath;
  const daemonScript = join(process.cwd(), 'dist', 'daemon', 'main.js');
  
  // 检查 daemon 脚本是否存在
  if (!existsSync(daemonScript)) {
    console.error('[F2A] 错误: 找不到 daemon 脚本');
    console.error('[F2A] 请先运行 npm run build');
    process.exit(1);
  }

  // 构建环境变量
  const env = { ...process.env };
  if (!env.F2A_CONTROL_PORT) {
    env.F2A_CONTROL_PORT = CONTROL_PORT.toString();
  }

  // 启动后台进程
  const child = spawn(nodePath, [daemonScript], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    cwd: process.cwd(),
  });

  // 创建日志写入流
  const { createWriteStream } = await import('fs');
  const logStream = createWriteStream(LOG_FILE, { flags: 'a' });
  
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  // 等待一小段时间确认启动成功
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('启动超时'));
    }, 10000);

    let started = false;

    child.on('spawn', () => {
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
    // 发送 SIGTERM 信号
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
 * 显示 daemon 状态
 */
export async function showStatus(): Promise<void> {
  const status = getDaemonStatus();
  const port = getControlPort();
  
  console.log('F2A Daemon 状态:');
  console.log(`  运行中: ${status.running ? '是' : '否'}`);
  console.log(`  控制端口: ${port}`);
  
  if (status.running && status.pid) {
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
  } else {
    console.log('  使用 "f2a daemon" 启动 daemon');
  }
}

/**
 * 检查端口是否被占用
 */
async function checkPortInUse(port: number): Promise<boolean> {
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