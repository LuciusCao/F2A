/**
 * F2A Node Manager
 * 管理 F2A Network 服务的生命周期
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import type { F2ANodeConfig, Result } from './types.js';

const sleep = promisify(setTimeout);

export class F2ANodeManager {
  private process: ChildProcess | null = null;
  private config: F2ANodeConfig;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(config: Partial<F2ANodeConfig>) {
    this.config = {
      nodePath: config.nodePath || './F2A',
      controlPort: config.controlPort || 9001,
      controlToken: config.controlToken || this.generateToken(),
      p2pPort: config.p2pPort || 9000,
      enableMDNS: config.enableMDNS ?? true,
      bootstrapPeers: config.bootstrapPeers || []
    };
  }

  /**
   * 确保 F2A Node 在运行
   */
  async ensureRunning(): Promise<Result<void>> {
    if (await this.isRunning()) {
      console.log('[F2A] Node 已在运行');
      return { success: true };
    }

    return this.start();
  }

  /**
   * 启动 F2A Node
   */
  async start(): Promise<Result<void>> {
    const daemonPath = join(this.config.nodePath, 'dist/daemon/index.js');

    if (!existsSync(daemonPath)) {
      return {
        success: false,
        error: `F2A Node 未找到: ${daemonPath}\n请先运行: cd ${this.config.nodePath} && npm install && npm run build`
      };
    }

    console.log('[F2A] 启动 Node...');
    console.log(`[F2A] Control Port: ${this.config.controlPort}`);
    console.log(`[F2A] P2P Port: ${this.config.p2pPort}`);

    try {
      this.process = spawn('node', [daemonPath], {
        cwd: this.config.nodePath,
        env: {
          ...process.env,
          F2A_CONTROL_PORT: String(this.config.controlPort),
          F2A_CONTROL_TOKEN: this.config.controlToken,
          F2A_P2P_PORT: String(this.config.p2pPort),
          F2A_ENABLE_MDNS: String(this.config.enableMDNS),
          F2A_BOOTSTRAP_PEERS: JSON.stringify(this.config.bootstrapPeers)
        },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.process.unref();

      // 记录日志
      this.process.stdout?.on('data', (data) => {
        console.log(`[F2A Node] ${data.toString().trim()}`);
      });

      this.process.stderr?.on('data', (data) => {
        console.error(`[F2A Node Error] ${data.toString().trim()}`);
      });

      // 等待启动完成
      await this.waitForReady(30000);

      // 启动健康检查
      this.startHealthCheck();

      console.log('[F2A] Node 启动成功');
      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
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
      console.log('[F2A] 停止 Node...');
      
      // 尝试优雅关闭
      this.process.kill('SIGTERM');
      
      // 等待 5 秒
      await sleep(5000);
      
      // 如果还在运行，强制关闭
      if (this.process.exitCode === null) {
        this.process.kill('SIGKILL');
      }
      
      this.process = null;
    }
  }

  /**
   * 检查 Node 是否运行中
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.config.controlPort}/health`, {
        headers: {
          'Authorization': `Bearer ${this.config.controlToken}`
        }
      });
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
        return { success: false, error: 'Node 未响应' };
      }

      const data = await response.json() as { running: boolean; peerId?: string; connectedPeers?: number; uptime?: number };
      return { success: true, data };

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
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
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      const isHealthy = await this.isRunning();
      if (!isHealthy && this.process) {
        console.warn('[F2A] Node 健康检查失败，尝试重启...');
        await this.stop();
        await sleep(1000);
        await this.start();
      }
    }, 30000); // 每 30 秒检查一次
  }

  /**
   * 生成随机 Token
   */
  private generateToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = 'f2a-';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  getConfig(): F2ANodeConfig {
    return { ...this.config };
  }
}