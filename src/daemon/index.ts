/**
 * F2A Daemon
 * 后台服务主入口 - P2P 版本
 */

import { F2A } from '../core/f2a';
import { ControlServer } from './control-server';
import { F2AOptions, WebhookConfig } from '../types';

export interface DaemonOptions extends F2AOptions {
  webhook?: WebhookConfig;
  controlPort?: number;
}

export class F2ADaemon {
  private options: DaemonOptions;
  private f2a?: F2A;
  private controlServer?: ControlServer;
  private running: boolean = false;

  constructor(options: DaemonOptions = {}) {
    this.options = {
      controlPort: 9001,
      ...options
    };
  }

  /**
   * 启动 Daemon
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Daemon already running');
    }

    console.log('[Daemon] Starting F2A Daemon...');

    // 创建并启动 F2A
    this.f2a = await F2A.create(this.options);
    const result = await this.f2a.start();
    
    if (!result.success) {
      throw new Error(`Failed to start F2A: ${result.error}`);
    }

    // 启动控制服务器
    this.controlServer = new ControlServer(this.f2a, this.options.controlPort!);
    await this.controlServer.start();

    this.running = true;
    console.log(`[Daemon] F2A Daemon started with peerId: ${this.f2a.peerId.slice(0, 16)}...`);
  }

  /**
   * 停止 Daemon
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('[Daemon] Stopping F2A Daemon...');

    await this.controlServer?.stop();
    await this.f2a?.stop();

    this.running = false;
    console.log('[Daemon] F2A Daemon stopped');
  }

  /**
   * 获取 F2A 实例
   */
  getF2A(): F2A | undefined {
    return this.f2a;
  }

  /**
   * 是否运行中
   */
  isRunning(): boolean {
    return this.running;
  }
}

// 默认导出
export default F2ADaemon;
