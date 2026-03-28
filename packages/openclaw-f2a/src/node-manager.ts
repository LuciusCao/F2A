/**
 * F2A Node Manager
 * 管理 F2A Network 服务的生命周期
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import type { F2ANodeConfig, Result } from './types.js';
import { getErrorMessage } from '@f2a/network';
import { generateToken } from './connector-helpers.js'; // P1-1 修复：导入加密安全的 token 生成函数

/** Logger 接口 */
interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

const sleep = promisify(setTimeout);

// PID 文件路径
const PID_FILE_NAME = 'f2a-node.pid';

/** 健康检查重启配置 */
interface HealthCheckRestartConfig {
  /** 最大连续重启次数 */
  maxRestarts: number;
  /** 重启计数重置时间窗口（毫秒） */
  resetWindowMs: number;
  /** 冷却期基础时间（毫秒） */
  cooldownBaseMs: number;
  /** 冷却期最大时间（毫秒） */
  cooldownMaxMs: number;
}

/** 默认重启配置 */
const DEFAULT_RESTART_CONFIG: HealthCheckRestartConfig = {
  maxRestarts: 3,           // 最多连续重启 3 次
  resetWindowMs: 60000,     // 1 分钟内重置计数
  cooldownBaseMs: 5000,     // 冷却期基础 5 秒
  cooldownMaxMs: 60000      // 冷却期最大 60 秒
};

export class F2ANodeManager {
  private process: ChildProcess | null = null;
  private config: F2ANodeConfig;
  private healthCheckInterval?: NodeJS.Timeout;
  private pidFilePath: string;
  private logger: Logger;
  
  // P1 修复：健康检查重启限制
  private restartConfig: HealthCheckRestartConfig;
  private consecutiveRestarts: number = 0;
  private lastRestartTime: number = 0;
  private isRestarting: boolean = false;

  constructor(config: Partial<F2ANodeConfig>, logger?: Logger) {
    this.config = {
      nodePath: config.nodePath || './F2A',
      controlPort: config.controlPort || 9001,
      controlToken: config.controlToken || this.generateToken(),
      p2pPort: config.p2pPort || 9000,
      enableMDNS: config.enableMDNS ?? true,
      bootstrapPeers: config.bootstrapPeers || []
    };
    this.pidFilePath = join(this.config.nodePath, PID_FILE_NAME);
    this.restartConfig = { ...DEFAULT_RESTART_CONFIG };
    this.logger = logger || console;
    
    // 启动时清理孤儿进程
    this.cleanupOrphanProcesses();
  }

  /**
   * 清理孤儿进程
   * 检查 PID 文件中记录的进程是否仍在运行，如果是则尝试清理
   */
  private cleanupOrphanProcesses(): void {
    if (!existsSync(this.pidFilePath)) {
      return;
    }

    try {
      const pidStr = readFileSync(this.pidFilePath, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);

      if (isNaN(pid)) {
        // PID 文件无效，删除
        unlinkSync(this.pidFilePath);
        return;
      }

      // 检查进程是否存在
      try {
        process.kill(pid, 0); // 不实际发送信号，只检查进程是否存在
        // 进程存在，尝试终止
        this.logger.info('[F2A:Node] 发现孤儿进程，尝试终止: pid=%d', pid);
        try {
          process.kill(pid, 'SIGTERM');
          // 等待进程终止
          setTimeout(() => {
            try {
              process.kill(pid, 0); // 检查是否还在运行
              process.kill(pid, 'SIGKILL'); // 强制终止
            } catch {
              // 进程已终止
            }
          }, 3000);
        } catch (killError) {
          // 无法终止，可能是权限问题
          this.logger.warn('[F2A:Node] 无法终止孤儿进程: pid=%d, error=%s', pid, getErrorMessage(killError));
        }
      } catch {
        // 进程不存在，只删除 PID 文件
      }

      // 删除 PID 文件
      unlinkSync(this.pidFilePath);
      this.logger.info('[F2A:Node] 孤儿进程清理完成');
    } catch (error) {
      this.logger.warn('[F2A:Node] 清理孤儿进程失败: error=%s', getErrorMessage(error));
    }
  }

  /**
   * 保存 PID 到文件
   */
  private savePid(pid: number): void {
    try {
      writeFileSync(this.pidFilePath, String(pid), { mode: 0o644 });
      this.logger.info('[F2A:Node] PID 文件已保存: path=%s', this.pidFilePath);
    } catch (error) {
      this.logger.warn('[F2A:Node] 保存 PID 文件失败: error=%s', getErrorMessage(error));
    }
  }

  /**
   * 删除 PID 文件
   */
  private removePidFile(): void {
    try {
      if (existsSync(this.pidFilePath)) {
        unlinkSync(this.pidFilePath);
      }
    } catch (error) {
      this.logger.warn('[F2A:Node] 删除 PID 文件失败: error=%s', getErrorMessage(error));
    }
  }

  /**
   * 确保 F2A Node 在运行
   */
  async ensureRunning(): Promise<Result<void>> {
    if (await this.isRunning()) {
      this.logger.info('[F2A:Node] Node 已在运行');
      return { success: true, data: undefined };
    }

    return this.start();
  }

  /**
   * 启动 F2A Node
   */
  async start(): Promise<Result<void>> {
    const daemonPath = join(this.config.nodePath, 'dist/daemon/main.js');

    if (!existsSync(daemonPath)) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR' as const, message: `F2A Node 未找到: ${daemonPath}\n请先运行: cd ${this.config.nodePath} && npm install && npm run build` }
      };
    }

    this.logger.info('[F2A:Node] 启动 Node...');
    this.logger.info('[F2A:Node] Control Port: %d', this.config.controlPort);
    this.logger.info('[F2A:Node] P2P Port: %d', this.config.p2pPort);

    try {
      this.process = spawn('node', [daemonPath], {
        cwd: this.config.nodePath,
        env: {
          ...process.env,
          F2A_CONTROL_PORT: String(this.config.controlPort),
          F2A_CONTROL_TOKEN: this.config.controlToken,
          F2A_P2P_PORT: String(this.config.p2pPort),
          F2A_ENABLE_MDNS: String(this.config.enableMDNS),
          BOOTSTRAP_PEERS: this.config.bootstrapPeers?.join(',') || ''
        },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // 记录子进程 PID
      const pid = this.process.pid;
      if (pid) {
        this.savePid(pid);
      }

      // 监听进程退出事件
      this.process.on('exit', (code, signal) => {
        this.logger.info('[F2A:Node] Node 进程退出: code=%s, signal=%s', code, signal);
        this.removePidFile();
        this.process = null;
      });

      this.process.on('error', (err) => {
        this.logger.error('[F2A:Node] Node 进程错误: error=%s', getErrorMessage(err));
        this.removePidFile();
      });

      this.process.unref();

      // 记录日志
      this.process.stdout?.on('data', (data) => {
        this.logger.info('[F2A:Node] Node stdout: %s', data.toString().trim());
      });

      this.process.stderr?.on('data', (data) => {
        this.logger.error('[F2A:Node] Node stderr: %s', data.toString().trim());
      });

      // 等待启动完成
      await this.waitForReady(30000);

      // 启动健康检查
      this.startHealthCheck();

      // P1 修复：成功启动后重置重启计数器
      this.consecutiveRestarts = 0;

      this.logger.info('[F2A:Node] Node 启动成功');
      return { success: true, data: undefined };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.removePidFile();
      return { success: false, error: { code: 'INTERNAL_ERROR' as const, message: errorMsg } };
    }
  }

  /**
   * 停止 F2A Node
   */
  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.process) {
      this.logger.info('[F2A:Node] 停止 Node...');
      
      // 尝试优雅关闭
      this.process.kill('SIGTERM');
      
      // 等待 5 秒
      await sleep(5000);
      
      // 如果还在运行，强制关闭
      if (this.process.exitCode === null) {
        this.process.kill('SIGKILL');
      }
      
      this.process = null;
    } else {
      // 没有当前进程引用，但可能存在孤儿进程
      // 尝试从 PID 文件读取并终止
      if (existsSync(this.pidFilePath)) {
        try {
          const pidStr = readFileSync(this.pidFilePath, 'utf-8').trim();
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid)) {
            this.logger.info('[F2A:Node] 尝试终止残留进程: pid=%d', pid);
            try {
              process.kill(pid, 'SIGTERM');
              await sleep(3000);
              try {
                process.kill(pid, 0);
                process.kill(pid, 'SIGKILL');
              } catch {
                // 进程已终止
              }
            } catch {
              // 进程不存在或无权限
            }
          }
        } catch (error) {
          this.logger.warn('[F2A:Node] 清理残留进程失败: error=%s', error);
        }
      }
    }

    // 清理 PID 文件
    this.removePidFile();
  }

  /**
   * 检查 Node 是否运行中
   */
  async isRunning(): Promise<boolean> {
    try {
      // 添加超时，避免阻塞 Gateway 启动
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 秒超时
      
      const response = await fetch(`http://localhost:${this.config.controlPort}/health`, {
        headers: {
          'Authorization': `Bearer ${this.config.controlToken}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 获取 Node 状态
   */
  async getStatus(): Promise<Result<{
    running: boolean;
    peerId?: string;
    connectedPeers?: number;
    uptime?: number;
  }>> {
    try {
      const response = await fetch(`http://localhost:${this.config.controlPort}/status`, {
        headers: {
          'Authorization': `Bearer ${this.config.controlToken}`
        }
      });

      if (!response.ok) {
        return { success: false, error: { code: 'INTERNAL_ERROR' as const, message: 'Node 未响应' } };
      }

      const data = await response.json() as { running: boolean; peerId?: string; connectedPeers?: number; uptime?: number };
      return { success: true, data };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { 
        success: false, 
        error: { code: 'INTERNAL_ERROR' as const, message }
      };
    }
  }

  /**
   * 等待 Node 就绪
   */
  private async waitForReady(timeout: number): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (await this.isRunning()) {
        return;
      }
      await sleep(500);
    }
    
    throw new Error('Node 启动超时');
  }

  /**
   * 启动健康检查
   * 
   * P1 修复：添加重启次数限制和冷却期，防止无限重启循环
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      // 如果正在重启，跳过本次检查
      if (this.isRestarting) {
        return;
      }

      const isHealthy = await this.isRunning();
      if (!isHealthy && this.process) {
        // 检查是否达到重启限制
        const now = Date.now();
        
        // 如果距离上次重启超过重置窗口，重置计数
        if (now - this.lastRestartTime > this.restartConfig.resetWindowMs) {
          this.consecutiveRestarts = 0;
        }
        
        // 检查是否达到最大重启次数
        if (this.consecutiveRestarts >= this.restartConfig.maxRestarts) {
          this.logger.error(
            '[F2A:Node] Node 健康检查失败，已达到最大重启次数: maxRestarts=%d, resetWindowMs=%d',
            this.restartConfig.maxRestarts,
            Math.round(this.restartConfig.resetWindowMs / 1000)
          );
          return;
        }
        
        // 计算冷却期（指数退避）
        const cooldownMs = Math.min(
          this.restartConfig.cooldownBaseMs * Math.pow(2, this.consecutiveRestarts),
          this.restartConfig.cooldownMaxMs
        );
        
        this.logger.warn(
          '[F2A:Node] Node 健康检查失败，尝试重启: attempt=%d/%d, cooldownMs=%d',
          this.consecutiveRestarts + 1,
          this.restartConfig.maxRestarts,
          Math.round(cooldownMs / 1000)
        );
        
        this.isRestarting = true;
        this.consecutiveRestarts++;
        this.lastRestartTime = now;
        
        try {
          await this.stop();
          await sleep(cooldownMs);
          await this.start();
        } catch (error) {
          this.logger.error('[F2A:Node] 重启失败: error=%s', getErrorMessage(error));
        } finally {
          this.isRestarting = false;
        }
      }
    }, 30000); // 每 30 秒检查一次
    
    // 防止定时器阻止进程退出
    if (this.healthCheckInterval.unref) {
      this.healthCheckInterval.unref();
    }
  }

  /**
   * 生成随机 Token
   */
  /**
   * 生成 Token
   * P1-1 修复：使用 connector-helpers 中加密安全的 generateToken()
   */
  private generateToken(): string {
    return `f2a-${generateToken()}`;
  }

  getConfig(): F2ANodeConfig {
    return { ...this.config };
  }
}