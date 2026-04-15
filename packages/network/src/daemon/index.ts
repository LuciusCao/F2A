/**
 * F2A Daemon
 * 后台服务主入口 - P2P 版本
 * 
 * Phase 1 扩展：支持 Agent 注册和消息路由
 */

import { F2A } from '../core/f2a.js';
import { ControlServer } from './control-server.js';
import { F2AOptions, WebhookConfig } from '../types/index.js';
import { join } from 'path';
import { homedir } from 'os';
import { Logger } from '../utils/logger.js';

// Phase 1: 导出新增组件
export { AgentRegistry, AgentRegistration, MessageSignaturePayload } from './agent-registry.js';
export { MessageRouter, RoutableMessage, MessageQueue } from './message-router.js';

export interface DaemonOptions extends F2AOptions {
  webhook?: WebhookConfig;
  controlPort?: number;
}

export class F2ADaemon {
  private options: DaemonOptions;
  private f2a?: F2A;
  private controlServer?: ControlServer;
  private running: boolean = false;
  private logger: Logger;

  constructor(options: DaemonOptions = {}) {
    this.options = {
      controlPort: 9001,
      dataDir: join(homedir(), '.f2a'),
      ...options
    };
    this.logger = new Logger({ component: 'daemon' });
  }

  /**
   * 启动 Daemon
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Daemon already running');
    }

    this.logger.info('Starting F2A Daemon', {
      version: process.env.npm_package_version
    });

    // 创建并启动 F2A
    this.f2a = await F2A.create(this.options);
    const result = await this.f2a.start();
    
    if (!result.success) {
      const errorData = (result as { error: unknown }).error;
      const errorMsg = typeof errorData === 'string' 
        ? errorData 
        : JSON.stringify(errorData);
      throw new Error(`Failed to start F2A: ${errorMsg}`);
    }

    // 启动控制服务器
    this.controlServer = new ControlServer(this.f2a, this.options.controlPort!, undefined, {
      dataDir: this.options.dataDir,
    });
    await this.controlServer.start();

    this.running = true;
    this.logger.info('F2A Daemon started', {
      peerId: this.f2a.peerId.slice(0, 16) + '...',
      controlPort: this.options.controlPort
    });
  }

  /**
   * 停止 Daemon
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.logger.info('Stopping F2A Daemon');

    await this.controlServer?.stop();
    await this.f2a?.stop();

    this.running = false;
    this.logger.info('F2A Daemon stopped');
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
