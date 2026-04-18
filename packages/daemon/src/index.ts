/**
 * @f2a/daemon - F2A 后台服务
 * 
 * 导出 Daemon 类和主要组件
 */

import { F2A } from '@f2a/network';
import { ControlServer } from './control-server.js';
import { F2AOptions, WebhookConfig } from '@f2a/network';
import { join } from 'path';
import { homedir } from 'os';
import { Logger } from '@f2a/network';

// Phase 1: 导出新增组件
export { AgentRegistry, AgentRegistration, AgentRegistrationRequest } from './agent-registry.js';
export { MessageRouter, RoutableMessage, MessageQueue } from './message-router.js';
export { ControlServer, ControlServerOptions } from './control-server.js';

// Phase 6: 导出 Agent Identity 管理组件
export { AgentIdentityStore, AgentIdentity, AgentWebhook } from './agent-identity-store.js';

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

// Daemon 版本
export const DAEMON_VERSION = '0.5.0';

// 默认导出
export default F2ADaemon;
// Phase 7: 导出 Session Token Manager (RFC 007)
export { AgentTokenManager, AgentTokenData, AgentTokenManagerOptions } from './agent-token-manager.js';

// Phase 1 (P0-3): 导出认证中间件
export { AuthMiddleware, AuthResult, AuthMiddlewareDeps } from './middleware/auth.js';
