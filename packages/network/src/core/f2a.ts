/**
 * F2A 主类 - P2P 版本
 * 整合 P2P 网络、能力发现与任务委托
 *
 * Phase 1: 集成 Node/Agent Identity 系统
 * - 使用 NodeIdentityManager 替代旧的 IdentityManager
 * - 使用 IdentityDelegator 创建和管理 Agent 身份
 *
 * Phase 4a: 工厂方法已提取到 f2a-factory.ts
 * - 使用 F2AFactory.create() 创建实例
 */

import { EventEmitter } from 'eventemitter3';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { P2PNetwork } from './p2p-network.js';
import { NodeIdentityManager } from './identity/node-identity.js';
import { AgentIdentityManager } from './identity/agent-identity.js';
import { IdentityDelegator } from './identity/delegator.js';
import { AgentRegistry } from './agent-registry.js';
import { MessageRouter } from './message-router.js';
import { MessageService } from './message-service.js';
import { Ed25519Signer } from './identity/ed25519-signer.js';
import { IdentityService } from './identity-service.js';
import { CapabilityService } from './capability-service.js';
import { Logger } from '../utils/logger.js';
import { Middleware } from '../utils/middleware.js';

import {
  F2AOptions,
  F2AEvents,
  AgentInfo,
  AgentCapability,
  Result,
  StructuredMessagePayload,
  failureFromError
} from '../types/index.js';
import type { ExportedAgentIdentity, AgentIdentity } from './identity/types.js';
import { F2AFactory } from './f2a-factory.js';

// 重导出 F2AFactory 便于使用
export { F2AFactory };

// P1-1 修复:从 package.json 读取版本号
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');

// Note: Version is read for side effect but not exported (can be added later if needed)
try {
  JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
} catch {
  // 如果无法读取 package.json,忽略
}

export interface F2AInstance {
  readonly peerId: string;
  /** 获取 Agent 信息(延迟获取,确保 peerId 在 start() 后才有效) */
  readonly agentInfo: AgentInfo;
  start(): Promise<Result<void>>;
  stop(): Promise<void>;

  // 能力管理
  registerCapability(capability: AgentCapability, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  getCapabilities(): AgentCapability[];

  // 发现
  discoverAgents(capability?: string): Promise<AgentInfo[]>;
  getConnectedPeers(): AgentInfo[];
  getAllPeers(): AgentInfo[];

  // 中间件
  useMiddleware(middleware: Middleware): void;
  removeMiddleware(name: string): boolean;
  listMiddlewares(): string[];

  // DHT
  findPeerViaDHT(peerId: string): Promise<Result<string[]>>;
  getDHTPeerCount(): number;
  isDHTEnabled(): boolean;
}

export class F2A extends EventEmitter<F2AEvents> implements F2AInstance {
  private _agentInfo: AgentInfo;
  private p2pNetwork: P2PNetwork;
  private running: boolean = false;
  readonly logger: Logger;  // Phase 4a: 改为 readonly public 供 F2AFactory 使用
  private capabilityService: CapabilityService;

  // Phase 4a: 改为 public 供 F2AFactory 设置 (internal 使用)
  public nodeIdentityManager?: NodeIdentityManager;
  public agentIdentityManager?: AgentIdentityManager;
  public identityDelegator?: IdentityDelegator;
  /** RFC 003: Ed25519 签名器，用于签名 AgentId */
  public ed25519Signer?: Ed25519Signer;
  /** Phase 2a: 身份服务 */
  public identityService?: IdentityService;

  // Phase 1: Agent Registry 和 Message Router
  // Phase 4a: 改为 public 供 F2AFactory 设置 (internal 使用)
  public agentRegistry?: AgentRegistry;
  public messageRouter?: MessageRouter;
  public messageService?: MessageService;

  /**
   * Phase 4a: 构造函数改为 public 供 F2AFactory 使用
   * 
   * @internal 请使用 F2AFactory.create() 创建实例，不要直接调用构造函数
   */
  constructor(
    agentInfo: AgentInfo,
    p2pNetwork: P2PNetwork,
    options: Required<F2AOptions>
  ) {
    super();
    this._agentInfo = agentInfo;
    this.p2pNetwork = p2pNetwork;

    // 初始化 logger,默认启用文件日志到 dataDir
    const dataDir = options.dataDir || join(homedir(), '.f2a');
    this.logger = new Logger({
      level: options.logLevel,
      component: 'F2A',
      enableConsole: true,
      enableFile: true,
      filePath: join(dataDir, 'f2a.log')
    });

    // Phase 3a: 初始化 CapabilityService
    this.capabilityService = new CapabilityService({
      logger: this.logger,
      onCapabilitiesUpdate: (capabilities) => {
        this._agentInfo.capabilities = capabilities;
      }
    });

    this.bindEvents();
  }

  /**
   * 获取 Agent 信息
   * 使用 getter 延迟获取 peerId,避免在 start() 前读到空值
   */
  get agentInfo(): AgentInfo {
    // 返回一个代理对象,确保 peerId 始终从 p2pNetwork 获取最新值
    return {
      ...this._agentInfo,
      peerId: this.running ? this._agentInfo.peerId : ''
    };
  }

  /**
   * 工厂方法:创建 F2A 实例 (向后兼容)
   *
   * Phase 4a: 委托给 F2AFactory.create()
   *
   * @param options F2A 配置选项
   * @returns Promise<F2A> F2A 实例 (失败时抛出异常)
   * @deprecated 推荐使用 F2AFactory.create() 获取 Result 类型
   */
  static async create(options: F2AOptions = {}): Promise<F2A> {
    const result = await F2AFactory.create(options);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  }

  /**
   * 启动 F2A
   */
  async start(): Promise<Result<void>> {
    if (this.running) {
      return failureFromError('NETWORK_ALREADY_RUNNING', 'F2A already running');
    }

    this.logger.info('Starting agent', { displayName: this.agentInfo.displayName });

    // 启动 P2P 网络
    const result = await this.p2pNetwork.start();
    if (!result.success) {
      return result;
    }

    // Phase 3: 加载已在 constructor 中自动完成

    // 更新 agentInfo
    this._agentInfo.peerId = result.data.peerId;
    this._agentInfo.multiaddrs = result.data.addresses;

    this.running = true;

    this.emit('network:started', {
      peerId: result.data.peerId,
      listenAddresses: result.data.addresses
    });

    this.logger.info('Started', { peerId: result.data.peerId.slice(0, 16) });

    return { success: true, data: undefined };
  }

  /**
   * 停止 F2A
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.logger.info('Stopping');

    // Phase 3: 保存已注册的 Agent(持久化)
    if (this.agentRegistry) {
      this.agentRegistry.save();
    }

    await this.p2pNetwork.stop();

    this.running = false;
    this.emit('network:stopped');

    this.logger.info('Stopped');
  }

  /**
   * 注册能力
   * Phase 3a: 委托给 CapabilityService
   */
  registerCapability(
    capability: AgentCapability,
    handler: (params: Record<string, unknown>) => Promise<unknown>
  ): Result<void> {
    return this.capabilityService.registerCapability(capability, handler);
  }

  /**
   * 获取已注册的能力
   * Phase 3a: 委托给 CapabilityService
   */
  getCapabilities(): AgentCapability[] {
    return this.capabilityService.getCapabilities();
  }

  /**
   * 发现网络中的 Agents
   */
  async discoverAgents(capability?: string): Promise<AgentInfo[]> {
    return this.p2pNetwork.discoverAgents(capability);
  }

  /**
   * 获取已连接的 Peers
   */
  getConnectedPeers(): AgentInfo[] {
    return this.p2pNetwork.getConnectedPeers()
      .filter(p => p.agentInfo)
      .map(p => p.agentInfo!);
  }

  /**
   * 获取所有已知的 Peers(包括已断开但已发现的)
   */
  getAllPeers(): AgentInfo[] {
    // 返回所有已知节点,包括还没有交换 agentInfo 的
    // 如果 agentInfo 不存在,创建一个基本的 AgentInfo
    return this.p2pNetwork.getAllPeers()
      .map(p => {
        if (p.agentInfo) {
          return p.agentInfo;
        }
        // 创建基本的 AgentInfo
        return {
          peerId: p.peerId,
          capabilities: [],
          multiaddrs: p.multiaddrs.map(m => m.toString()),
          lastSeen: p.lastSeen,
          agentType: 'custom' as const,
          version: '0.0.0',
          protocolVersion: '1.0.0'
        };
      });
  }

  /**
   * 发送自由消息给特定 Peer(Agent 协议层)
   * Agent 之间的自然语言通信
   */
  async sendMessageToPeer(
    peerId: string,
    content: string | Record<string, unknown>,
    topic?: string
  ): Promise<Result<void>> {
    return this.p2pNetwork.sendFreeMessage(peerId, content, topic);
  }

  /**
   * 注册中间件
   */
  useMiddleware(middleware: Middleware): void {
    this.p2pNetwork.useMiddleware(middleware);
  }

  /**
   * 移除中间件
   */
  removeMiddleware(name: string): boolean {
    return this.p2pNetwork.removeMiddleware(name);
  }

  /**
   * 获取已注册中间件列表
   */
  listMiddlewares(): string[] {
    return this.p2pNetwork.listMiddlewares();
  }

  /**
   * 通过 DHT 查找节点
   */
  async findPeerViaDHT(peerId: string): Promise<Result<string[]>> {
    return this.p2pNetwork.findPeerViaDHT(peerId);
  }

  /**
   * 获取 DHT 路由表大小
   */
  getDHTPeerCount(): number {
    return this.p2pNetwork.getDHTPeerCount();
  }

  /**
   * 检查 DHT 是否启用
   */
  isDHTEnabled(): boolean {
    return this.p2pNetwork.isDHTEnabled();
  }

  /**
   * 获取 PeerID
   */
  get peerId(): string {
    return this.agentInfo.peerId;
  }

  /**
   * 绑定内部事件
   */
  private bindEvents(): void {
    // 转发 P2P 网络事件
    this.p2pNetwork.on('peer:discovered', (event) => {
      this.emit('peer:discovered', event);
    });

    this.p2pNetwork.on('peer:connected', (event) => {
      this.emit('peer:connected', event);
    });

    this.p2pNetwork.on('peer:disconnected', (event) => {
      this.emit('peer:disconnected', event);
    });

    // 处理收到的 Agent 协议层消息
    // RFC 005: 使用 MessageRouter.routeIncoming() 统一处理入站消息
    this.p2pNetwork.on('message:received', async (message, peerId) => {
      if (message.type === 'MESSAGE') {
        const payload = message.payload as StructuredMessagePayload;
        
        // 根据 topic 分发处理
        if (payload.topic === 'agent.message') {
          // RFC 005: Agent 协议层消息 - 通过 MessageRouter.routeIncoming() 路由
          if (this.messageRouter) {
            await this.messageRouter.routeIncoming(payload.content, peerId);
          }
        } else {
          // 其他消息:发出事件供上层处理
          this.emit('peer:message', {
            messageId: message.id,
            from: peerId,
            content: payload.content,
            topic: payload.topic,
            replyTo: payload.replyTo
          });
        }
      }
    });

    this.p2pNetwork.on('error', (error) => {
      this.emit('error', error);
    });
  }

  // ========================================================================
  // Phase 1: Node/Agent Identity 方法
  // ========================================================================

  /**
   * 获取 Node ID
   *
   * Node ID 是物理节点的持久化标识,存储在 ~/.f2a/node-identity.json
   */
  getNodeId(): string | null {
    return this.nodeIdentityManager?.getNodeId() || null;
  }

  /**
   * 签名方法(RFC 003: AgentId 签发)
   *
   * 使用 Ed25519 私钥签名，支持跨节点验证
   *
   * @param data 要签名的数据
   * @returns Base64 编码的 Ed25519 签名
   */
  signData(data: string): string {
    // RFC 003 P0 修复: 使用 Ed25519Signer 进行真正的签名
    if (this.ed25519Signer && this.ed25519Signer.canSign()) {
      try {
        const signature = this.ed25519Signer.signSync(data);
        this.logger.debug('Data signed with Ed25519', {
          dataPrefix: data.slice(0, 16),
          signaturePrefix: signature.slice(0, 16)
        });
        return signature;
      } catch (err) {
        this.logger.error('Ed25519 signing failed, fallback to hash', {
          error: err instanceof Error ? err.message : String(err)
        });
        // 降级到旧的 hash 方式（向后兼容）
      }
    }

    // 向后兼容：如果没有 Ed25519Signer，使用旧的 hash 方式
    // 这种情况下签名无法被其他节点验证
    this.logger.warn('signData using legacy hash method (Ed25519Signer not available)');
    const publicKey = this._agentInfo.encryptionPublicKey || '';
    const signaturePrefix = publicKey.slice(0, 32);
    const dataHash = Buffer.from(data).toString('base64').slice(0, 32);
    return `${signaturePrefix}:${dataHash}`;
  }

  /**
   * 获取 Ed25519 公钥（用于消息中携带，供其他节点验证）
   *
   * @returns Base64 编码的 Ed25519 公钥，或 null 如果不可用
   */
  getEd25519PublicKey(): string | null {
    if (this.ed25519Signer) {
      try {
        return this.ed25519Signer.getPublicKey();
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * 获取 Agent ID
   *
   * Agent ID 是 Agent 的独立标识,由 Node 签发
   */
  getAgentId(): string | null {
    return this.agentIdentityManager?.getAgentId() || null;
  }

  /**
   * 获取 Agent 名称
   */
  getAgentName(): string | null {
    return this.agentIdentityManager?.getAgentName() || null;
  }

  /**
   * 获取 Agent Identity(不包含私钥)
   */
  getAgentIdentity(): AgentIdentity | null {
    return this.agentIdentityManager?.getAgentIdentity() || null;
  }

  /**
   * 导出 Node Identity(用于备份/迁移)
   *
   * WARNING: 返回敏感的私钥材料
   */
  async exportNodeIdentity(): Promise<Result<{ nodeId: string; peerId: string; privateKey: string }>> {
    if (!this.identityService) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Identity service not initialized');
    }
    return this.identityService.exportNodeIdentity();
  }

  /**
   * 导出 Agent Identity(用于备份/迁移)
   *
   * WARNING: 返回敏感的私钥材料
   */
  async exportAgentIdentity(): Promise<Result<ExportedAgentIdentity>> {
    if (!this.identityService) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Identity service not initialized');
    }
    return this.identityService.exportAgentIdentity();
  }

  /**
   * 检查 Agent 身份是否过期
   */
  isAgentExpired(): boolean {
    return this.agentIdentityManager?.isExpired() || false;
  }

  /**
   * 续期 Agent 身份
   *
   * @param newExpiresAt 新的过期时间
   */
  async renewAgentIdentity(newExpiresAt: Date): Promise<Result<AgentIdentity>> {
    if (!this.identityService) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Identity service not initialized');
    }
    return this.identityService.renewAgentIdentity(newExpiresAt);
  }

  // ========================================================================
  // Phase 1: Agent Registry 和 Message Router getter 方法
  // ========================================================================

  /**
   * 获取 IdentityService
   */
  getIdentityService(): IdentityService {
    if (!this.identityService) {
      throw new Error('IdentityService not initialized');
    }
    return this.identityService;
  }

  /**
   * 获取 Agent Registry
   */
  getAgentRegistry(): AgentRegistry {
    if (!this.agentRegistry) {
      throw new Error('AgentRegistry not initialized');
    }
    return this.agentRegistry;
  }

  /**
   * 获取 Message Router
   */
  getMessageRouter(): MessageRouter {
    if (!this.messageRouter) {
      throw new Error('MessageRouter not initialized');
    }
    return this.messageRouter;
  }

  /**
   * 获取 Message Service
   */
  getMessageService(): MessageService {
    if (!this.messageService) {
      throw new Error('MessageService not initialized');
    }
    return this.messageService;
  }

  /**
   * 获取 Capability Service
   * Phase 3a: 新增 getter
   */
  getCapabilityService(): CapabilityService {
    return this.capabilityService;
  }

  // ========================================================================
  // 统一消息发送入口
  // ========================================================================

  /**
   * 统一消息发送入口
   *
   * 支持 Agent 间通信,自动判断本地路由或远程 P2P 发送
   * 委托给 MessageService 处理
   *
   * @param fromAgentId 发送方 Agent ID
   * @param toAgentId 目标 Agent ID
   * @param content 消息内容
   * @param options 可选配置
   * @returns Result<void> 发送结果
   */
  async sendMessage(
    fromAgentId: string,
    toAgentId: string,
    content: string | Record<string, unknown>,
    options?: {
      type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
      metadata?: Record<string, unknown>;
    }
  ): Promise<Result<void>> {
    // 委托给 MessageService
    if (!this.messageService) {
      return failureFromError('INTERNAL_ERROR', 'MessageService not initialized');
    }
    return this.messageService.sendMessage(fromAgentId, toAgentId, content, options);
  }

  /**
   * 设置 MessageRouter 的 P2P 网络引用
   * 用于支持远程消息路由
   */
  setMessageRouterP2PNetwork(): void {
    if (this.messageRouter && this.p2pNetwork) {
      this.messageRouter.setP2PNetwork(this.p2pNetwork);
      this.logger.info('MessageRouter P2P network configured');
    }
  }
}
