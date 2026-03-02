/**
 * F2A 主类
 * 整合所有功能模块
 */

import { EventEmitter } from 'eventemitter3';
import { ConnectionManager } from './connection-manager';
import { IdentityManager } from './identity';
import {
  F2AOptions,
  F2AEvents,
  AgentIdentity,
  ConnectionConfig,
  PendingConnectionView,
  Result,
  DiscoveredAgent,
  WebhookConfig
} from '../types';

export interface F2AInstance {
  readonly agentId: string;
  readonly publicKey: string;
  start(): Promise<void>;
  stop(): void;
  
  // 连接管理
  getPendingConnections(): PendingConnectionView[];
  confirmConnection(idOrIndex: string | number): Result<void>;
  rejectConnection(idOrIndex: string | number, reason?: string): Result<void>;
  
  // 发现
  getDiscoveredAgents(): DiscoveredAgent[];
  
  // 消息
  sendMessage(peerId: string, content: string): void;
  
  // Skill
  querySkills(peerId: string): Promise<unknown>;
  invokeSkill(peerId: string, skill: string, parameters: unknown): Promise<unknown>;
  registerSkill(name: string, definition: unknown): void;
}

export class F2A extends EventEmitter<F2AEvents> implements F2AInstance {
  public readonly agentId: string;
  public readonly publicKey: string;
  
  private identity: AgentIdentity;
  private connectionManager: ConnectionManager;
  private options: Required<F2AOptions>;
  private running: boolean = false;

  private constructor(
    identity: AgentIdentity,
    connectionManager: ConnectionManager,
    options: Required<F2AOptions>
  ) {
    super();
    this.identity = identity;
    this.agentId = identity.agentId;
    this.publicKey = identity.publicKey;
    this.connectionManager = connectionManager;
    this.options = options;

    this.bindEvents();
  }

  /**
   * 工厂方法：创建 F2A 实例
   */
  static async create(options: F2AOptions = {}): Promise<F2A> {
    // 默认配置
    const mergedOptions: Required<F2AOptions> = {
      myAgentId: options.myAgentId ?? '',
      myPublicKey: options.myPublicKey ?? '',
      myPrivateKey: options.myPrivateKey ?? '',
      p2pPort: options.p2pPort ?? 9000,
      controlPort: options.controlPort ?? 9001,
      logLevel: options.logLevel ?? 'INFO',
      security: {
        level: 'medium',
        requireConfirmation: true,
        verifySignatures: true,
        ...options.security
      },
      dataDir: options.dataDir ?? '',
      webhook: options.webhook ?? {
        url: 'http://127.0.0.1:18789/hooks/agent',
        token: ''
      }
    };

    // 加载或创建身份
    const identityManager = new IdentityManager({ configDir: mergedOptions.dataDir });
    const identityInfo = identityManager.getOrCreateIdentity();

    // 创建连接管理器
    const connectionManager = new ConnectionManager();

    // 创建实例
    const f2a = new F2A(
      identityInfo,
      connectionManager,
      mergedOptions
    );

    return f2a;
  }

  /**
   * 启动 F2A
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('F2A already running');
    }

    console.log(`[F2A] Starting as ${this.agentId}`);
    
    // TODO: 启动 P2P 网络、发现服务、控制服务器等
    
    this.running = true;
    this.emit('started', { port: this.options.p2pPort });
  }

  /**
   * 停止 F2A
   */
  stop(): void {
    if (!this.running) return;

    console.log('[F2A] Stopping...');
    
    this.connectionManager.stop();
    // TODO: 停止其他服务
    
    this.running = false;
    this.emit('stopped');
  }

  /**
   * 获取待确认连接列表
   */
  getPendingConnections(): PendingConnectionView[] {
    return this.connectionManager.getPendingList();
  }

  /**
   * 确认连接
   */
  confirmConnection(idOrIndex: string | number): Result<void> {
    const result = this.connectionManager.confirm(idOrIndex);
    if (result.success) {
      // TODO: 完成连接建立
      return { success: true, data: undefined };
    }
    return result;
  }

  /**
   * 拒绝连接
   */
  rejectConnection(idOrIndex: string | number, reason?: string): Result<void> {
    const result = this.connectionManager.reject(idOrIndex, reason);
    if (result.success) {
      return { success: true, data: undefined };
    }
    return result;
  }

  /**
   * 获取发现的 Agents
   */
  getDiscoveredAgents(): DiscoveredAgent[] {
    // TODO: 实现发现服务
    return [];
  }

  /**
   * 发送消息
   */
  sendMessage(peerId: string, content: string): void {
    // TODO: 实现消息发送
    console.log(`[F2A] Sending message to ${peerId}: ${content}`);
  }

  /**
   * 查询技能
   */
  async querySkills(peerId: string): Promise<unknown> {
    // TODO: 实现技能查询
    return [];
  }

  /**
   * 调用技能
   */
  async invokeSkill(peerId: string, skill: string, parameters: unknown): Promise<unknown> {
    // TODO: 实现技能调用
    return null;
  }

  /**
   * 注册技能
   */
  registerSkill(name: string, definition: unknown): void {
    // TODO: 实现技能注册
    console.log(`[F2A] Registering skill: ${name}`);
  }

  /**
   * 绑定内部事件
   */
  private bindEvents(): void {
    // 转发 ConnectionManager 事件
    this.connectionManager.on('pending_added', (event) => {
      this.emit('confirmation_required', event);
    });

    this.connectionManager.on('confirmed', (event) => {
      this.emit('peer_connected', {
        peerId: event.agentId,
        type: 'tcp',
        publicKey: event.publicKey
      });
    });

    this.connectionManager.on('rejected', (event) => {
      console.log(`[F2A] Connection rejected: ${event.agentId}`);
    });
  }
}