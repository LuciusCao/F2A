/**
 * F2A Daemon
 * 后台服务主入口
 */

import { F2A } from '../core/f2a';
import { ConnectionManager } from '../core/connection-manager';
import { ServerlessP2P } from '../core/serverless';
import { WebhookService } from './webhook';
import { ControlServer } from './control-server';
import { IdentityManager } from '../core/identity';
import {
  F2AOptions,
  AgentIdentity,
  ConnectionConfig,
  WebhookConfig
} from '../types';

export interface DaemonOptions extends F2AOptions {
  webhook?: WebhookConfig;
}

export class F2ADaemon {
  private options: DaemonOptions;
  private identity: AgentIdentity;
  private connectionManager: ConnectionManager;
  private p2p?: ServerlessP2P;
  private webhook?: WebhookService;
  private controlServer?: ControlServer;
  private running: boolean = false;

  constructor(options: DaemonOptions) {
    this.options = options;
    
    // 加载身份
    const identityManager = new IdentityManager({ configDir: options.dataDir });
    const identityInfo = identityManager.getOrCreateIdentity();
    this.identity = identityInfo;
    
    // 创建连接管理器
    this.connectionManager = new ConnectionManager();
  }

  /**
   * 启动 Daemon
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Daemon already running');
    }

    console.log('🚀 Starting F2A Daemon...');
    console.log(`🆔 Agent ID: ${this.identity.agentId}`);

    // 创建配置
    const config: ConnectionConfig = {
      p2pPort: this.options.p2pPort || 9000,
      controlPort: this.options.controlPort || 9001,
      security: {
        level: 'medium',
        requireConfirmation: true,
        verifySignatures: true,
        whitelist: new Set(),
        blacklist: new Set(),
        rateLimit: { maxRequests: 10, windowMs: 60000 },
        ...this.options.security
      }
    };

    // 启动 P2P 网络
    this.p2p = new ServerlessP2P({
      identity: this.identity,
      config,
      connectionManager: this.connectionManager
    });

    await this.p2p.start();

    // 绑定事件
    this.bindEvents();

    // 启动 Webhook 服务
    if (this.options.webhook?.token) {
      this.webhook = new WebhookService(this.options.webhook);
    }

    // 启动控制服务器
    this.controlServer = new ControlServer({
      port: config.controlPort,
      token: process.env.F2A_CONTROL_TOKEN || 'f2a-default-token',
      connectionManager: this.connectionManager
    });
    await this.controlServer.start();

    this.running = true;
    console.log('✅ F2A Daemon started');

    // 优雅退出
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * 停止 Daemon
   */
  stop(): void {
    if (!this.running) return;

    console.log('🛑 Stopping F2A Daemon...');

    this.controlServer?.stop();
    this.p2p?.stop();
    this.connectionManager.stop();

    this.running = false;
    console.log('✅ F2A Daemon stopped');
    process.exit(0);
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    if (!this.p2p) return;

    // 发现 Agent
    this.p2p.on('agent_discovered', (agent) => {
      console.log(`[Daemon] Discovered: ${agent.agentId.slice(0, 16)}...`);
    });

    // Peer 连接
    this.p2p.on('peer_connected', ({ peerId }) => {
      console.log(`[Daemon] Connected: ${peerId.slice(0, 16)}...`);
    });

    // Peer 断开
    this.p2p.on('peer_disconnected', ({ peerId }) => {
      console.log(`[Daemon] Disconnected: ${peerId.slice(0, 16)}...`);
    });

    // 收到消息
    this.p2p.on('message', ({ peerId, message }) => {
      if (message.type === 'message') {
        console.log(`[Daemon] Message from ${peerId.slice(0, 16)}...: ${(message as any).content}`);
      }
    });

    // 连接请求 - 发送 Webhook 通知
    this.connectionManager.on('pending_added', async (event) => {
      console.log(`[Daemon] Pending connection: ${event.agentId.slice(0, 16)}...`);
      
      if (this.webhook) {
        const shortId = event.confirmationId.slice(0, 8);
        await this.webhook.send({
          message: `[F2A] 收到新的连接请求\n\nAgent ID: ${event.agentId.slice(0, 16)}...\n地址: ${event.address}:${event.port}\n请求ID: ${shortId}\n\n回复 "f2a 允许 ${shortId}" 来接受连接\n回复 "f2a 拒绝 ${shortId}" 来拒绝连接`,
          name: 'F2A',
          wakeMode: 'now',
          deliver: true
        });
      }
    });
  }
}