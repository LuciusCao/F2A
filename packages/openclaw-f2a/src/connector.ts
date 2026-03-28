/**
 * F2A OpenClaw Connector Plugin
 * 主插件类 - 直接管理 F2A 实例
 * 
 * 架构说明：
 * - Adapter 直接创建和管理 F2A 实例（不需要独立的 daemon 进程）
 * - 收到 P2P 消息时，直接调用 OpenClaw Agent API 生成回复
 * - 这种方式更简洁，避免了 HTTP + CLI 的复杂性
 */

import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import type { 
  OpenClawPlugin, 
  OpenClawPluginApi,
  Tool, 
  SessionContext, 
  ToolResult,
  F2ANodeConfig,
  F2APluginConfig,
  AgentInfo,
  AgentCapability,
  DiscoverWebhookPayload,
  DelegateWebhookPayload,
  ApiLogger,
  F2APluginPublicInterface,
} from './types.js';
import { F2ANodeManager } from './node-manager.js';
import { F2ANetworkClient } from './network-client.js';
import { WebhookServer, WebhookHandler } from './webhook-server.js';
import { ReputationSystem, ReputationManagerAdapter } from './reputation.js';
import { INTERNAL_REPUTATION_CONFIG } from './types.js';
import { CapabilityDetector } from './capability-detector.js';
import { TaskQueue } from './task-queue.js';
import { AnnouncementQueue } from './announcement-queue.js';
import { WebhookPusher } from './webhook-pusher.js';
import { taskGuard, TaskGuardContext } from './task-guard.js';
import { ToolHandlers } from './tool-handlers.js';
import { ClaimHandlers } from './claim-handlers.js';
import { ReviewCommittee, F2A } from '@f2a/network';

// Issue #98 & #99: 通讯录和握手机制
import { ContactManager } from './contact-manager.js';
import { HandshakeProtocol } from './handshake-protocol.js';
import { FriendStatus, ContactFilter } from './contact-types.js';

// 重构：辅助函数和通讯录处理器
import { 
  isValidPeerId, 
  isPathSafe, 
  extractErrorMessage, 
  readAgentNameFromIdentity,
  mergeConfig,
  generateToken,
  checkF2AInstalled,
  formatBroadcastResults,
  resolveAgent,
  MAX_MESSAGE_LENGTH,
} from './connector-helpers.js';
import { ContactToolHandlers } from './contact-tool-handlers.js';

// 重构：工具定义
import { getNetworkTools, getTaskTools, getContactTools } from './tools/index.js';

// ============================================================================
// 内部类型定义
// ============================================================================

/** 广播结果类型 */
interface BroadcastResult {
  agent: string;
  success: boolean;
  error?: string;
  latency?: number;
}

export class F2APlugin implements OpenClawPlugin, F2APluginPublicInterface {
  name = 'f2a-openclaw-f2a';
  version = '0.3.0';

  // 核心组件（延迟初始化）
  private _nodeManager?: F2ANodeManager;
  private _networkClient?: F2ANetworkClient;
  private _webhookServer?: WebhookServer;
  private _reputationSystem?: ReputationSystem;
  private _logger?: ApiLogger;
  private _capabilityDetector?: CapabilityDetector;
  private _taskQueue?: TaskQueue;
  private _announcementQueue?: AnnouncementQueue;
  private _webhookPusher?: WebhookPusher;
  private _reviewCommittee?: ReviewCommittee;
  
  // F2A 实例（直接管理模式）
  private _f2a?: F2A;
  /** F2A 启动时间（用于计算 uptime） */
  private _f2aStartTime?: number;
  
  // 处理器实例（延迟初始化）
  private _toolHandlers?: ToolHandlers;
  private _claimHandlers?: ClaimHandlers;
  
  // Issue #98 & #99: 通讯录和握手机制
  private _contactManager?: ContactManager;
  private _handshakeProtocol?: HandshakeProtocol;
  private _contactToolHandlers?: ContactToolHandlers;
  
  // P1-3: 消息哈希去重缓存，防止恶意节点绕过 echo 检测
  // 存储最近处理过的消息哈希，避免重复处理
  private _processedMessageHashes: Map<string, number> = new Map();
  /** P1-3: 消息去重缓存最大条目数 */
  private static readonly MAX_MESSAGE_HASH_CACHE_SIZE = 10000;
  /** P1-3: 消息去重缓存条目最大存活时间（毫秒） */
  private static readonly MESSAGE_HASH_TTL_MS = 5 * 60 * 1000; // 5 分钟
  /** P2-6: 消息哈希去重阈值，短消息不计算哈希（性能优化） */
  private static readonly MESSAGE_HASH_THRESHOLD = 100; // 仅对超过 100 字符的消息启用哈希
  
  private config!: F2APluginConfig;
  private nodeConfig!: F2ANodeConfig;
  private capabilities: AgentCapability[] = [];
  private api?: OpenClawPluginApi;
  private pollTimer?: NodeJS.Timeout;
  private _initialized = false;
  
  // P2-3 修复：懒加载初始化标志，防止重复初始化
  private _initializingFlags = {
    nodeManager: false,
    networkClient: false,
    taskQueue: false,
    reputationSystem: false,
    capabilityDetector: false,
    announcementQueue: false,
    reviewCommittee: false,
    toolHandlers: false,
    claimHandlers: false,
    contactToolHandlers: false,
    contactManager: false,
    handshakeProtocol: false,
  };
  
  // ========== 懒加载 Getter ==========
  
  /**
   * 获取节点管理器（懒加载）
   * P2-3 修复：添加初始化标志防止重复初始化
   */
  private get nodeManager(): F2ANodeManager {
    if (!this._nodeManager && !this._initializingFlags.nodeManager) {
      this._initializingFlags.nodeManager = true;
      try {
        this._nodeManager = new F2ANodeManager(this.nodeConfig, this._logger);
      } finally {
        this._initializingFlags.nodeManager = false;
      }
    }
    return this._nodeManager!;
  }
  
  /**
   * 获取默认的 F2A 数据目录
   * 
   * 优先级：
   * 1. config.dataDir（用户显式配置）
   * 2. workspace/.f2a（agent workspace 目录）
   * 3. ~/.f2a（兼容旧版本）
   * 
   * 安全：
   * - P0-1: 验证 workspace 路径，防止路径遍历攻击
   * - P1-1: 优先检查 config.dataDir
   */
  private getDefaultDataDir(): string {
    // P1-1: 优先使用用户配置的 dataDir
    if (this.config?.dataDir) {
      return this.config.dataDir;
    }
    
    // 默认：使用 agent workspace 目录
    const workspace = (this.api?.config as any)?.agents?.defaults?.workspace;
    
    // P0-1: 验证 workspace 路径安全性
    if (isPathSafe(workspace)) {
      return join(workspace, '.f2a');
    }
    
    // 兼容旧版本
    return join(homedir(), '.f2a');
  }
  
  /**
   * P1-2, P1-5, P1-3: 检测是否为回声消息（避免循环）
   * 
   * 使用多层验证策略：
   * 1. 检查 metadata 中的特定标记（不仅仅是 type === 'reply'）
   * 2. 检查消息来源可信度
   * 3. 检查消息内容的特殊标记
   * 4. P1-3: 基于消息内容哈希的去重机制（防止恶意绕过）
   * 
   * @param msg - 接收到的消息
   * @returns 是否为应该跳过的回声消息
   */
  private isEchoMessage(msg: { 
    from: string; 
    content: string; 
    metadata?: Record<string, unknown>; 
    messageId: string 
  }): boolean {
    const { metadata, content, from } = msg;
    
    // 层1: 检查 metadata 中的标记
    // P1-5: 不能只依赖 metadata.type，恶意节点可以伪造
    // 我们检查更具体的标记组合
    if (metadata) {
      // 检查是否是我们自己发出的回复标记
      if (metadata.type === 'reply' && metadata.replyTo) {
        // 进一步验证：检查是否来自可信源（我们自己发出的消息）
        // 如果有 replyTo，说明这是一个回复消息
        return true;
      }
      
      // 检查显式的跳过标记
      if (metadata._f2a_skip_echo === true || metadata['x-openclaw-skip'] === true) {
        return true;
      }
    }
    
    // 层2: 检查消息内容中的特殊标记
    // P1-2: 使用更严格的匹配，避免误判正常消息
    if (content) {
      // 使用特殊的标记格式 [[F2A:REPLY:...]]
      // 而不是简单的 "NO_REPLY" 字符串
      if (content.includes('[[F2A:REPLY:') || content.includes('[[reply_to_current]]')) {
        return true;
      }
      
      // 检查是否以 NO_REPLY 标记开头（更严格）
      if (content.startsWith('NO_REPLY:') || content.startsWith('[NO_REPLY]')) {
        return true;
      }
    }
    
    // 层3: 检查消息来源是否是我们自己的 peerId（防止自循环）
    if (this._f2a && from === this._f2a.peerId) {
      return true;
    }
    
    // 层4 (P1-3): 基于消息内容哈希的去重机制
    // P2-6 性能优化：仅对超过阈值的长消息启用哈希去重
    if (content && content.length > F2APlugin.MESSAGE_HASH_THRESHOLD) {
      const messageHash = this.computeMessageHash(from, content);
      const now = Date.now();
      
      // 检查是否已处理过相同的消息内容
      if (this._processedMessageHashes.has(messageHash)) {
        const processedTime = this._processedMessageHashes.get(messageHash)!;
        // 如果在 TTL 内，认为是重复消息
        if (now - processedTime < F2APlugin.MESSAGE_HASH_TTL_MS) {
          this._logger?.debug?.(`[F2A] 检测到重复消息（哈希去重）: ${messageHash.slice(0, 16)}...`);
          return true;
        }
      }
      
      // 记录此消息哈希
      this._processedMessageHashes.set(messageHash, now);
      
      // 清理过期的条目（防止内存泄漏）
      if (this._processedMessageHashes.size > F2APlugin.MAX_MESSAGE_HASH_CACHE_SIZE) {
        this.cleanupMessageHashCache(now);
      }
    }
    
    return false;
  }
  
  /**
   * P1-3: 计算消息内容哈希
   * P2-2 修复：使用 crypto.createHash('sha256') 替代简单哈希
   * 用于基于内容的去重
   */
  private computeMessageHash(from: string, content: string): string {
    const crypto = require('crypto');
    const data = `${from}:${content}`;
    // 使用 SHA256 算法生成安全的哈希值
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    // 返回前 32 字符作为标识（足够用于去重）
    return `msg-${hash.slice(0, 32)}-${data.length}`;
  }
  
  /**
   * P1-3: 清理过期的消息哈希缓存
   */
  private cleanupMessageHashCache(now: number): void {
    const ttl = F2APlugin.MESSAGE_HASH_TTL_MS;
    for (const [hash, timestamp] of this._processedMessageHashes.entries()) {
      if (now - timestamp > ttl) {
        this._processedMessageHashes.delete(hash);
      }
    }
  }
  
  /**
   * 获取网络客户端（懒加载）
   * 新架构：直接使用 F2A 实例的方法，不再通过 HTTP
   */
  private get networkClient(): F2ANetworkClient {
    if (!this._networkClient) {
      this._networkClient = new F2ANetworkClient(this.nodeConfig, this._logger);
    }
    return this._networkClient;
  }
  
  /**
   * 获取任务队列（懒加载）
   * 只有在真正需要处理任务时才初始化 SQLite 数据库
   * P2-3 修复：添加初始化标志防止重复初始化
   */
  private get taskQueue(): TaskQueue {
    if (!this._taskQueue && !this._initializingFlags.taskQueue) {
      this._initializingFlags.taskQueue = true;
      try {
        const dataDir = this.getDefaultDataDir();
        this._taskQueue = new TaskQueue({
          maxSize: this.config.maxQueuedTasks || 100,
          maxAgeMs: 24 * 60 * 60 * 1000, // 24小时
          persistDir: dataDir,
          persistEnabled: true,
          logger: this._logger
        });
        this._logger?.info('[F2A] TaskQueue 已初始化（懒加载）');
      } finally {
        this._initializingFlags.taskQueue = false;
      }
    }
    return this._taskQueue!;
  }
  
  /**
   * 获取信誉系统（懒加载）
   */
  private get reputationSystem(): ReputationSystem {
    if (!this._reputationSystem) {
      this._reputationSystem = new ReputationSystem(
        {
          enabled: INTERNAL_REPUTATION_CONFIG.enabled,
          initialScore: INTERNAL_REPUTATION_CONFIG.initialScore,
          minScoreForService: INTERNAL_REPUTATION_CONFIG.minScoreForService,
          decayRate: INTERNAL_REPUTATION_CONFIG.decayRate,
        },
        this.getDefaultDataDir()
      );
    }
    return this._reputationSystem;
  }
  
  /**
   * 获取能力检测器（懒加载）
   */
  private get capabilityDetector(): CapabilityDetector {
    if (!this._capabilityDetector) {
      this._capabilityDetector = new CapabilityDetector();
    }
    return this._capabilityDetector;
  }
  
  /**
   * 获取广播队列（懒加载）
   */
  private get announcementQueue(): AnnouncementQueue {
    if (!this._announcementQueue) {
      this._announcementQueue = new AnnouncementQueue({
        maxSize: 50,
        maxAgeMs: 30 * 60 * 1000, // 30分钟
        logger: this._logger
      });
    }
    return this._announcementQueue;
  }
  
  /**
   * 获取评审委员会（懒加载）
   */
  private get reviewCommittee(): ReviewCommittee {
    if (!this._reviewCommittee) {
      const reputationAdapter = new ReputationManagerAdapter(this.reputationSystem);
      this._reviewCommittee = new ReviewCommittee(reputationAdapter, {
        minReviewers: 1,
        maxReviewers: 5,
        minReputation: INTERNAL_REPUTATION_CONFIG.minScoreForReview,
        reviewTimeout: 5 * 60 * 1000 // 5 分钟
      });
    }
    return this._reviewCommittee;
  }
  
  /**
   * 获取工具处理器（延迟初始化，支持未初始化时调用getTools）
   */
  private get toolHandlers(): ToolHandlers {
    if (!this._toolHandlers) {
      this._toolHandlers = new ToolHandlers(this);
    }
    return this._toolHandlers;
  }
  
  /**
   * 获取认领处理器（延迟初始化）
   */
  private get claimHandlers(): ClaimHandlers {
    if (!this._claimHandlers) {
      this._claimHandlers = new ClaimHandlers(this);
    }
    return this._claimHandlers;
  }
  
  /**
   * 通讯录工具处理器（延迟初始化）
   */
  private get contactToolHandlers(): ContactToolHandlers {
    if (!this._contactToolHandlers) {
      this._contactToolHandlers = new ContactToolHandlers(this);
    }
    return this._contactToolHandlers;
  }
  
  /**
   * Issue #98: 获取联系人管理器（延迟初始化）
   * P2-3 修复：添加初始化标志防止重复初始化
   */
  private get contactManager(): ContactManager {
    if (!this._contactManager && !this._initializingFlags.contactManager) {
      this._initializingFlags.contactManager = true;
      try {
        const dataDir = this.getDefaultDataDir();
        this._contactManager = new ContactManager(dataDir, this._logger);
        this._logger?.info('[F2A] ContactManager 已初始化');
      } finally {
        this._initializingFlags.contactManager = false;
      }
    }
    return this._contactManager!;
  }
  
  /**
   * Issue #99: 获取握手协议处理器（延迟初始化）
   * 依赖 F2A 实例和 ContactManager
   * P2-3 修复：传递握手配置 + 添加初始化标志防止重复初始化
   */
  private get handshakeProtocol(): HandshakeProtocol {
    if (!this._handshakeProtocol && !this._initializingFlags.handshakeProtocol && this._f2a && this._contactManager) {
      this._initializingFlags.handshakeProtocol = true;
      try {
        this._handshakeProtocol = new HandshakeProtocol(
          this._f2a,
          this._contactManager,
          this._logger,
          this.config.handshake  // P2-3 修复：传递配置
        );
        this._logger?.info('[F2A] HandshakeProtocol 已初始化');
      } finally {
        this._initializingFlags.handshakeProtocol = false;
      }
    }
    return this._handshakeProtocol!;
  }
  
  /**
   * 检查是否已初始化（用于判断是否需要启动服务）
   */
  isInitialized(): boolean {
    return this._initialized;
  }
  
  /**
   * 获取 F2A 状态（供 tool-handlers 使用）
   */
  getF2AStatus(): { running: boolean; peerId?: string; uptime?: number } {
    if (!this._f2a) {
      return { running: false };
    }
    return {
      running: true,
      peerId: this._f2a.peerId,
      uptime: this._f2aStartTime ? Date.now() - this._f2aStartTime : undefined
    };
  }
  
  /**
   * 获取 F2A 实例（供 contact-tool-handlers 使用）
   * 返回 F2A 实例供需要直接访问的场景使用
   */
  getF2A(): unknown {
    return this._f2a;
  }
  
  // ========== 握手协议方法 ==========
  
  /**
   * 发送好友请求（实现 F2APluginPublicInterface）
   */
  async sendFriendRequest(peerId: string, message?: string): Promise<string | null> {
    if (!this._handshakeProtocol) {
      this._logger?.warn('[F2A] 握手协议未初始化');
      return null;
    }
    return this._handshakeProtocol.sendFriendRequest(peerId, message);
  }
  
  /**
   * 接受好友请求（实现 F2APluginPublicInterface）
   */
  async acceptFriendRequest(requestId: string): Promise<boolean> {
    if (!this._handshakeProtocol) {
      this._logger?.warn('[F2A] 握手协议未初始化');
      return false;
    }
    return this._handshakeProtocol.acceptRequest(requestId);
  }
  
  /**
   * 拒绝好友请求（实现 F2APluginPublicInterface）
   */
  async rejectFriendRequest(requestId: string, reason?: string): Promise<boolean> {
    if (!this._handshakeProtocol) {
      this._logger?.warn('[F2A] 握手协议未初始化');
      return false;
    }
    return this._handshakeProtocol.rejectRequest(requestId, reason);
  }
  
  /**
   * 获取 F2A Client（供 tool-handlers 使用）
   * 直接访问 F2A 实例的方法
   */
  get f2aClient() {
    return {
      discoverAgents: async (capability?: string) => {
        if (!this._f2a) {
          return { success: false, error: { message: 'F2A 实例未初始化' } };
        }
        try {
          const agents = await this._f2a.discoverAgents(capability);
          return { success: true, data: agents };
        } catch (err) {
          return { success: false, error: { message: extractErrorMessage(err) } };
        }
      },
      getConnectedPeers: async () => {
        if (!this._f2a) {
          return { success: false, error: { message: 'F2A 实例未初始化' } };
        }
        try {
          // 从 F2A 实例获取连接的 peers
          const peers = (this._f2a as any).p2pNetwork?.getConnectedPeers?.() || [];
          return { success: true, data: peers };
        } catch (err) {
          return { success: false, error: { message: extractErrorMessage(err) } };
        }
      }
    };
  }
  
  // ========== F2APluginPublicInterface 公开方法 ==========
  
  /**
   * 发现 Agents（公开接口）
   * @param capability 能力过滤（可选）
   */
  async discoverAgents(capability?: string): Promise<{ success: boolean; data?: AgentInfo[]; error?: { message: string } }> {
    return this.f2aClient.discoverAgents(capability);
  }
  
  /**
   * 获取连接的 Peers（公开接口）
   */
  async getConnectedPeers(): Promise<{ success: boolean; data?: unknown[]; error?: { message: string } }> {
    return this.f2aClient.getConnectedPeers();
  }
  
  /**
   * 发送消息（公开接口）
   * @param to 目标 Peer ID
   * @param content 消息内容
   * @param metadata 消息元数据（可选）
   */
  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    if (!this._f2a) {
      return { success: false, error: 'F2A 实例未初始化' };
    }
    try {
      await (this._f2a as any).sendMessage(to, content, metadata);
      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  }
  
  // ========== F2APluginPublicInterface 公开 getter ==========
  
  /** 公开配置访问 */
  getConfig(): F2APluginConfig {
    return this.config;
  }
  
  /** 公开 API 访问 */
  getApi(): OpenClawPluginApi | undefined {
    return this.api;
  }
  
  /** 公开网络客户端访问 */
  getNetworkClient(): unknown {
    return this.networkClient;
  }
  
  /** 公开信誉系统访问 */
  getReputationSystem(): unknown {
    return this.reputationSystem;
  }
  
  /** 公开节点管理器访问 */
  getNodeManager(): unknown {
    return this.nodeManager;
  }
  
  /** 公开任务队列访问 */
  getTaskQueue(): unknown {
    return this.taskQueue;
  }
  
  /** 公开公告队列访问 */
  getAnnouncementQueue(): unknown {
    return this.announcementQueue;
  }
  
  /** 公开评审委员会访问 */
  getReviewCommittee(): unknown | undefined {
    return this.reviewCommittee;
  }
  
  /** 公开联系人管理器访问 */
  getContactManager(): unknown {
    return this.contactManager;
  }
  
  /** 公开握手协议处理器访问 */
  getHandshakeProtocol(): unknown {
    return this.handshakeProtocol;
  }

  /**
   * 初始化插件
   * 
   * 架构重构：延迟初始化策略
   * - 构造函数/initialize 只保存配置，不打开任何资源
   * - TaskQueue/WebhookServer 在首次访问时才初始化
   * - 这允许 `openclaw gateway status` 等 CLI 命令能正常退出
   */
  async initialize(config: Record<string, unknown> & { _api?: OpenClawPluginApi }): Promise<void> {
    // 保存 OpenClaw logger（统一日志格式）
    this._logger = config._api?.logger;
    this._logger?.info('[F2A] 初始化（延迟模式）...');

    // 保存 API 引用（用于触发心跳等）
    this.api = config._api;
    
    // 合并配置（只保存，不初始化资源）
    this.config = mergeConfig(config);
    this.nodeConfig = {
      nodePath: this.config.f2aPath || './F2A',
      controlPort: this.config.controlPort || 9001,
      controlToken: this.config.controlToken || generateToken(),
      p2pPort: this.config.p2pPort || 9000,
      enableMDNS: this.config.enableMDNS ?? true,
      bootstrapPeers: this.config.bootstrapPeers || [],
      dataDir: this.config.dataDir
    };

    // 初始化 Webhook 推送器（如果配置了）
    if (this.config.webhookPush?.enabled !== false && this.config.webhookPush?.url) {
      this._webhookPusher = new WebhookPusher(this.config.webhookPush, this._logger);
      this._logger?.info('[F2A] Webhook 推送已配置');
    }

    // 检测能力（基于配置，不依赖 OpenClaw 会话）
    // 这是轻量级操作，不需要延迟
    this.capabilities = this.capabilityDetector.getDefaultCapabilities();
    if (this.config.capabilities?.length) {
      this.capabilities = this.capabilityDetector.mergeCustomCapabilities(
        this.capabilities,
        this.config.capabilities
      );
    }

    // 注意：registerCleanupHandlers() 移到 enable() 中调用
    // 因为它注册 process.on 事件处理器，会阻止 CLI 进程退出

    this._logger?.info('[F2A] 初始化完成（延迟模式）');
    this._logger?.info(`[F2A] Agent 名称: ${this.config.agentName}`);
    this._logger?.info(`[F2A] 能力数: ${this.capabilities.length}`);
    this._logger?.info('[F2A] 资源将在首次使用时初始化（TaskQueue/WebhookServer 等）');
  }

  /**
   * 启用适配器（直接创建 F2A 实例）
   * 
   * 新架构：Adapter 直接管理 F2A 实例，不需要独立的 daemon 进程。
   * 这样消息处理可以直接调用 OpenClaw API，避免 HTTP + CLI 的复杂性。
   */
  async enable(): Promise<void> {
    if (this._initialized) {
      this._logger?.info('[F2A] 适配器已启用，跳过');
      return;
    }
    
    this._logger?.info('[F2A] 启用适配器（直接管理模式）...');
    this._initialized = true;
    
    // 注册清理处理器
    this.registerCleanupHandlers();

    // 直接创建 F2A 实例（新架构）
    try {
      // 使用统一的默认数据目录计算方法
      const dataDir = this.getDefaultDataDir();
      
      // 文件日志确保不被丢失
      const debugLog = (msg: string) => {
        const fs = require('fs');
        const logPath = join(homedir(), '.openclaw/logs/adapter-debug.log');
        try {
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
        } catch {
          // P3-1 修复：日志文件写入失败时静默忽略（不影响主流程）
          // 这是调试日志，失败不应影响程序执行
        }
        console.log(msg);
        this._logger?.info(msg);
      };
      
      debugLog(`[F2A] 使用数据目录: ${dataDir}`);
      debugLog(`[F2A] workspace: ${(this.api?.config as any)?.agents?.defaults?.workspace}`);
      debugLog(`[F2A] config.dataDir: ${this.config.dataDir}`);
      
      // Issue #96: 从 IDENTITY.md 读取 agent 名字
      const workspace = (this.api?.config as any)?.agents?.defaults?.workspace;
      const identityName = readAgentNameFromIdentity(workspace);
      
      // 优先级：IDENTITY.md > config.agentName > 默认值
      const displayName = identityName || this.config.agentName || 'OpenClaw Agent';
      
      if (identityName) {
        debugLog(`[F2A] 从 IDENTITY.md 读取 agent 名字: ${identityName}`);
      }
      
      this._f2a = await F2A.create({
        displayName,
        dataDir,
        network: {
          listenPort: this.config.p2pPort || 0,
          bootstrapPeers: this.config.bootstrapPeers || [],
          enableMDNS: this.config.enableMDNS ?? true,
          enableDHT: false,
        }
      });
      
      // 监听 P2P 消息，调用 OpenClaw Agent 生成回复
      (this._f2a as any).on('message', async (msg: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }) => {
        // P1-6: 验证 PeerID 格式
        if (!isValidPeerId(msg.from)) {
          this._logger?.warn(`[F2A] 拒绝来自无效 PeerID 的消息: ${String(msg.from).slice(0, 20)}`);
          return;
        }
        
        // P1-7: 检查消息长度限制
        if (msg.content && msg.content.length > MAX_MESSAGE_LENGTH) {
          this._logger?.warn(`[F2A] 消息过长 (${msg.content.length} bytes)，拒绝处理`);
          return;
        }
        
        const logMsg = `[F2A] 收到 P2P 消息: from=${msg.from.slice(0, 16)}, content=${msg.content?.slice(0, 50)}`;
        this._logger?.info(logMsg);
        
        // 写入文件日志
        try {
          const fs = require('fs');
          const logPath = join(homedir(), '.openclaw/logs/adapter-debug.log');
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${logMsg}\n`);
        } catch {
          // P3-1 修复：日志文件写入失败时静默忽略（不影响主流程）
        }
        
        try {
          // P1-2, P1-5: 改进的回声循环检测
          // 使用更严格的检测逻辑，防止恶意绕过
          const isReply = this.isEchoMessage(msg);
          
          if (isReply) {
            this._logger?.info('[F2A] 跳过 Agent 回复，避免回声循环');
            return;
          }
          
          // 调用 OpenClaw Agent 生成回复
          const reply = await this.invokeOpenClawAgent(msg.from, msg.content, msg.messageId);
          
          // 发送回复
          if (reply && this._f2a) {
            await (this._f2a as any).sendMessage(msg.from, reply, { type: 'reply', replyTo: msg.messageId });
            this._logger?.info('[F2A] 回复已发送', { to: msg.from.slice(0, 16) });
          }
        } catch (err) {
          this._logger?.error('[F2A] 处理消息失败', { error: extractErrorMessage(err) });
        }
      });
      
      // 监听其他事件
      this._f2a.on('peer:connected', (event: { peerId: string }) => {
        this._logger?.info('[F2A] Peer 连接', { peerId: event.peerId.slice(0, 16) });
      });
      
      this._f2a.on('peer:disconnected', (event: { peerId: string }) => {
        this._logger?.info('[F2A] Peer 断开', { peerId: event.peerId.slice(0, 16) });
      });
      
      // 启动 F2A（带超时保护，避免阻塞 Gateway）
      const START_TIMEOUT_MS = 10000; // 10 秒超时
      
      const startPromise = this._f2a.start();
      const timeoutPromise = new Promise<typeof startPromise>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('F2A 启动超时'));
        }, START_TIMEOUT_MS);
        timer.unref(); // 确保 Gateway 可以退出
      });
      
      const result = await Promise.race([startPromise, timeoutPromise]);
      if (!result.success) {
        throw new Error(`F2A 启动失败: ${result.error}`);
      }
      
      this._logger?.info('[F2A] F2A 实例已启动', { 
        peerId: this._f2a.peerId?.slice(0, 16),
        multiaddrs: this._f2a.agentInfo?.multiaddrs?.length || 0
      });
      
      // 记录启动时间（用于计算 uptime）
      this._f2aStartTime = Date.now();
      
      // 初始化 ContactManager 和 HandshakeProtocol 以接收消息
      this.contactManager; // 触发延迟初始化
      this.handshakeProtocol; // 触发延迟初始化
      
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this._logger?.error(`[F2A] 创建 F2A 实例失败: ${errorMsg}`);
      this._logger?.warn('[F2A] F2A Adapter 将以降级模式运行，P2P 功能不可用');
      
      // 清理失败的实例
      if (this._f2a) {
        try {
          await this._f2a.stop();
        } catch {
          // P3-1 修复：清理失败时忽略，不影响程序继续执行
          this._logger?.debug?.('[F2A] F2A 实例停止失败（清理阶段）');
        }
        this._f2a = undefined;
        this._f2aStartTime = undefined;
      }
    }

    // 仍然启动 Webhook 服务器（用于任务委托等场景）
    try {
      this._webhookServer = new WebhookServer(
        this.config.webhookPort || 0,
        this.createWebhookHandler(),
        { logger: this._logger }
      );
      await this._webhookServer.start();
      this._logger?.info(`[F2A] Webhook 服务器已启动: ${this._webhookServer.getUrl()}`);
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this._logger?.warn(`[F2A] Webhook 服务器启动失败: ${errorMsg}`);
    }

    // 启动兜底轮询
    this.startFallbackPolling();
    
    if (this._f2a) {
      this._logger?.info(`[F2A] P2P 已就绪，Peer ID: ${this._f2a.peerId?.slice(0, 20)}...`);
    }
  }

  /**
   * 调用 OpenClaw Agent 生成回复
   * 使用 OpenClaw Plugin API 而不是 CLI
   */
  /**
   * 创建 F2A 回复 Dispatcher
   * 参考 feishu 插件的 createFeishuReplyDispatcher
   * 
   * Dispatcher 定义了如何将 Agent 的回复发送回 P2P 网络
   */
  private createF2AReplyDispatcher(fromPeerId: string, messageId?: string) {
    const sendReply = async (text: string) => {
      if (!this._f2a || !text?.trim()) {
        return;
      }
      
      try {
        await (this._f2a as any).sendMessage(fromPeerId, text, {
          type: 'reply',
          replyTo: messageId,
        });
        this._logger?.info('[F2A] 回复已发送', { to: fromPeerId.slice(0, 16) });
      } catch (err) {
        this._logger?.error('[F2A] 发送回复失败', { error: extractErrorMessage(err) });
      }
    };

    // 返回 dispatcher 对象，格式与 OpenClaw 兼容
    return {
      deliver: async (payload: { text?: string }, _info?: unknown) => {
        const text = payload.text ?? '';
        if (!text.trim()) {
          return;
        }
        
        // 分块发送（如果文本太长）
        const chunkLimit = 4000;
        for (let i = 0; i < text.length; i += chunkLimit) {
          const chunk = text.slice(i, i + chunkLimit);
          await sendReply(chunk);
        }
      },
    };
  }

  /**
   * 调用 OpenClaw Agent 生成回复
   * 参考 feishu 插件实现，使用 api.channel.reply.dispatchReplyFromConfig
   */
  private async invokeOpenClawAgent(fromPeerId: string, message: string, replyToMessageId?: string): Promise<string | undefined> {
    const sessionKey = `f2a-${fromPeerId.slice(0, 16)}`;
    
    const debugLog = (msg: string) => {
      try {
        const fs = require('fs');
        const logPath = join(homedir(), '.openclaw/logs/adapter-debug.log');
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
      } catch {
        // P3-1 修复：日志文件写入失败时静默忽略（不影响主流程）
      }
      this._logger?.info(msg);
    };
    
    debugLog(`[F2A] invokeOpenClawAgent: sessionKey=${sessionKey}`);
    debugLog(`[F2A] API: hasApi=${!!this.api}, hasChannel=${!!this.api?.channel}`);
    
    // 创建 F2A 回复 dispatcher
    const f2aDispatcher = this.createF2AReplyDispatcher(fromPeerId, replyToMessageId);
    
    // 使用 OpenClaw Channel API (参考飞书插件)
    if (this.api?.channel?.reply?.dispatchReplyFromConfig) {
      debugLog('[F2A] 使用 Channel API');
      try {
        const route = this.api.channel.routing.resolveAgentRoute({
          peerId: sessionKey,
        });
        
        const ctx = this.api.channel.reply.finalizeInboundContext({
          SessionKey: route.sessionKey,
          PeerId: sessionKey,
          Sender: 'F2P P2P',
          SenderId: fromPeerId.slice(0, 16),
          ChannelType: 'p2p',
          InboundId: fromPeerId.slice(0, 16),
        });
        
        // 使用 F2A dispatcher 发送回复
        const result = await this.api.channel.reply.dispatchReplyFromConfig({
          ctx,
          cfg: this.config,
          dispatcher: f2aDispatcher,
        });
        
        debugLog(`[F2A] Channel API 完成: ${JSON.stringify(result)}`);
        return undefined; // dispatcher 会自动发送回复
        
      } catch (err) {
        debugLog(`[F2A] Channel API 失败: ${extractErrorMessage(err)}`);
      }
    }
    
    // 降级：使用 subagent API
    if (this.api?.runtime?.subagent?.run) {
      debugLog('[F2A] 使用 Subagent API');
      try {
        // 生成 idempotencyKey（必需参数）
        const idempotencyKey = `f2a-${fromPeerId.slice(0, 16)}-${Date.now()}`;
        
        // P1-3: 使用正确的类型，移除 as any
        const runResult = await this.api.runtime.subagent.run({
          sessionKey,
          message,
          deliver: false,
          idempotencyKey,
        });
        
        const waitResult = await this.api.runtime.subagent.waitForRun({
          runId: runResult.runId,
          timeoutMs: 60000,
        });
        
        if (waitResult.status === 'ok') {
          const messagesResult = await this.api.runtime.subagent.getSessionMessages({
            sessionKey,
            limit: 1,
          });
          
          if (messagesResult.messages && messagesResult.messages.length > 0) {
            const lastMessage = messagesResult.messages[messagesResult.messages.length - 1] as any;
            
            // 提取回复文本（content 可能是数组或字符串）
            let reply = '';
            if (Array.isArray(lastMessage?.content)) {
              // 找到 type='text' 的元素
              const textBlock = lastMessage.content.find((block: any) => block.type === 'text');
              reply = textBlock?.text || '';
            } else {
              reply = lastMessage?.content || lastMessage?.text || '';
            }
            
            debugLog(`[F2A] Subagent 回复文本: ${reply?.slice(0, 100)}...`);
            
            if (reply) {
              // 手动发送回复
              await f2aDispatcher.deliver({ text: reply });
              return undefined;
            }
          }
        }
      } catch (err) {
        debugLog(`[F2A] Subagent 失败: ${extractErrorMessage(err)}`);
      }
    }
    
    // 最终降级
    debugLog('[F2A] 使用降级回复');
    const fallbackReply = `收到你的消息："${message.slice(0, 30)}"。我是 ${this.config.agentName || 'OpenClaw Agent'}，很高兴与你交流！`;
    await f2aDispatcher.deliver({ text: fallbackReply });
    return undefined;
  }

  /**
   * 注册清理处理器
   */
  private registerCleanupHandlers(): void {
    const autoCleanup = async () => {
      // 关闭 F2A 实例
      if (this._f2a) {
        try {
          await this._f2a.stop();
          this._logger?.info('[F2A] F2A 实例已停止');
        } catch {
          // P3-1 修复：清理阶段停止失败时静默忽略
          this._logger?.debug?.('[F2A] F2A 实例停止失败（清理阶段）');
        }
      }
      
      // 同步关闭其他资源
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      if (this._webhookServer) {
        try {
          (this._webhookServer as any).server?.close();
        } catch {
          // P3-1 修复：清理阶段关闭失败时静默忽略
        }
      }
      if (this._taskQueue) {
        try {
          this._taskQueue.close();
        } catch {
          // P3-1 修复：清理阶段关闭失败时静默忽略
        }
      }
    };
    
    process.once('beforeExit', autoCleanup);
    process.once('SIGINT', autoCleanup);
    process.once('SIGTERM', autoCleanup);
  }

  /**
   * 兜底轮询
   * 当 webhook 推送失败时，轮询确保任务不会丢失
   */
  private startFallbackPolling(): void {
    const interval = this.config.pollInterval || 60000; // 默认 60 秒
    
    this.pollTimer = setInterval(async () => {
      // P1 修复：定期检查并重置超时的 processing 任务，防止僵尸任务
      // 只有在 TaskQueue 已初始化时才检查
      if (this._taskQueue) {
        this.resetTimedOutProcessingTasks();
      }
      
      if (!this._webhookPusher) {
        // 没有配置 webhook，不轮询（保持原有轮询模式）
        return;
      }

      // 只有在 TaskQueue 已初始化时才处理
      if (!this._taskQueue) {
        return;
      }

      try {
        // 获取未推送的任务
        const pending = this._taskQueue.getWebhookPending();
        
        if (pending.length > 0) {
          this._logger?.info(`[F2A] 兜底轮询: ${pending.length} 个待推送任务`);
          
          for (const task of pending) {
            const result = await this._webhookPusher.pushTask(task);
            if (result.success) {
              this._taskQueue.markWebhookPushed(task.taskId);
            }
          }
        }
      } catch (error) {
        this._logger?.error('[F2A] 兜底轮询失败:', error);
      }
    }, interval);
    
    // 防止定时器阻止进程退出
    if (this.pollTimer.unref) {
      this.pollTimer.unref();
    }
  }
  
  /**
   * P1 修复：重置超时的 processing 任务
   * 如果任务在 processing 状态停留超过超时时间，将其重置为 pending
   * 防止因处理失败导致的僵尸任务
   */
  private resetTimedOutProcessingTasks(): void {
    if (!this._taskQueue) return;
    
    const stats = this._taskQueue.getStats();
    if (stats.processing === 0) {
      return; // 没有处理中的任务，无需检查
    }
    
    const allTasks = this._taskQueue.getAll();
    const now = Date.now();
    const processingTimeout = this.config.processingTimeoutMs || 5 * 60 * 1000; // 默认 5 分钟
    
    for (const task of allTasks) {
      if (task.status === 'processing') {
        const taskTimeout = task.timeout || 30000; // 使用任务自身的超时或默认 30 秒
        const maxAllowedTime = Math.max(taskTimeout * 2, processingTimeout); // 至少 2 倍任务超时或 processingTimeout
        const processingTime = now - (task.updatedAt || task.createdAt);
        
        if (processingTime > maxAllowedTime) {
          this._logger?.warn(`[F2A] 检测到僵尸任务 ${task.taskId.slice(0, 8)}... (processing ${Math.round(processingTime / 1000)}s)，重置为 pending`);
          // 将任务重置为 pending 状态
          this._taskQueue.resetProcessingTask(task.taskId);
        }
      }
    }
  }

  /**
   * 获取插件提供的 Tools
   */
  getTools(): Tool[] {
    // 网络、状态、信誉工具
    const networkTools = getNetworkTools({
      handleDiscover: this.toolHandlers.handleDiscover.bind(this.toolHandlers),
      handleDelegate: this.toolHandlers.handleDelegate.bind(this.toolHandlers),
      handleBroadcast: this.toolHandlers.handleBroadcast.bind(this.toolHandlers),
      handleStatus: this.toolHandlers.handleStatus.bind(this.toolHandlers),
      handleReputation: this.toolHandlers.handleReputation.bind(this.toolHandlers),
    });

    // 任务工具
    const taskTools = getTaskTools({
      handlePollTasks: this.toolHandlers.handlePollTasks.bind(this.toolHandlers),
      handleSubmitResult: this.toolHandlers.handleSubmitResult.bind(this.toolHandlers),
      handleTaskStats: this.toolHandlers.handleTaskStats.bind(this.toolHandlers),
      handleAnnounce: this.claimHandlers.handleAnnounce.bind(this.claimHandlers),
      handleListAnnouncements: this.claimHandlers.handleListAnnouncements.bind(this.claimHandlers),
      handleClaim: this.claimHandlers.handleClaim.bind(this.claimHandlers),
      handleManageClaims: this.claimHandlers.handleManageClaims.bind(this.claimHandlers),
      handleMyClaims: this.claimHandlers.handleMyClaims.bind(this.claimHandlers),
      handleAnnouncementStats: this.claimHandlers.handleAnnouncementStats.bind(this.claimHandlers),
      handleEstimateTask: this.toolHandlers.handleEstimateTask.bind(this.toolHandlers),
      handleReviewTask: this.toolHandlers.handleReviewTask.bind(this.toolHandlers),
      handleGetReviews: this.toolHandlers.handleGetReviews.bind(this.toolHandlers),
      handleGetCapabilities: this.toolHandlers.handleGetCapabilities.bind(this.toolHandlers),
    });

    // 通讯录工具
    const contactTools = getContactTools({
      handleContacts: this.contactToolHandlers.handleContacts.bind(this.contactToolHandlers),
      handleContactGroups: this.contactToolHandlers.handleContactGroups.bind(this.contactToolHandlers),
      handleFriendRequest: this.contactToolHandlers.handleFriendRequest.bind(this.contactToolHandlers),
      handlePendingRequests: this.contactToolHandlers.handlePendingRequests.bind(this.contactToolHandlers),
      handleContactsExport: this.contactToolHandlers.handleContactsExport.bind(this.contactToolHandlers),
      handleContactsImport: this.contactToolHandlers.handleContactsImport.bind(this.contactToolHandlers),
    });

    return [...networkTools, ...taskTools, ...contactTools];
  }
  private createWebhookHandler(): WebhookHandler {
    return {
      onDiscover: async (payload: DiscoverWebhookPayload) => {
        // 检查请求者信誉（懒加载触发）
        if (!this.reputationSystem.isAllowed(payload.requester)) {
          return {
            capabilities: [],
            reputation: this.reputationSystem.getReputation(payload.requester).score
          };
        }

        // 过滤能力
        let caps = this.capabilities;
        if (payload.query.capability) {
          caps = caps.filter(c => 
            c.name === payload.query.capability ||
            c.tools?.includes(payload.query.capability!)
          );
        }

        return {
          capabilities: caps,
          reputation: this.reputationSystem.getReputation(payload.requester).score
        };
      },

      onDelegate: async (payload: DelegateWebhookPayload) => {
        // 安全检查（懒加载触发 reputationSystem）
        if (!this.reputationSystem.isAllowed(payload.from)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Reputation too low'
          };
        }

        // 检查白名单/黑名单
        const whitelist = this.config.security?.whitelist || [];
        const blacklist = this.config.security?.blacklist || [];
        const isWhitelisted = whitelist.length > 0 && whitelist.includes(payload.from);
        const isBlacklisted = blacklist.includes(payload.from);

        if (whitelist.length > 0 && !isWhitelisted) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Not in whitelist'
          };
        }

        if (isBlacklisted) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'In blacklist'
          };
        }

        // TaskGuard 安全检查
        const requesterReputation = this.reputationSystem.getReputation(payload.from);
        const taskGuardContext: Partial<TaskGuardContext> = {
          requesterReputation,
          isWhitelisted,
          isBlacklisted,
          recentTaskCount: 0 // Will be tracked internally by TaskGuard
        };

        const taskGuardReport = taskGuard.check(payload, taskGuardContext);

        if (!taskGuardReport.passed) {
          // 任务被阻止
          const blockReasons = taskGuardReport.blocks.map(b => b.message).join('; ');
          this._logger?.warn(`[F2A] TaskGuard 阻止任务 ${payload.taskId}: ${blockReasons}`);
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: `TaskGuard blocked: ${blockReasons}`
          };
        }

        if (taskGuardReport.requiresConfirmation) {
          // 任务需要确认（警告但不阻止）
          const warnReasons = taskGuardReport.warnings.map(w => w.message).join('; ');
          this._logger?.warn(`[F2A] TaskGuard 警告 ${payload.taskId}: ${warnReasons}`);
          // 未来可以扩展为请求用户确认
          // 目前记录警告但继续处理任务
        }

        // 检查队列是否已满（懒加载触发 taskQueue）
        const stats = this.taskQueue.getStats();
        if (stats.pending >= (this.config.maxQueuedTasks || 100)) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: 'Task queue is full'
          };
        }

        // 添加任务到队列
        try {
          const task = this.taskQueue.add(payload);
          
          // 优先使用 webhook 推送
          if (this._webhookPusher) {
            const result = await this._webhookPusher.pushTask(task);
            if (result.success) {
              this.taskQueue.markWebhookPushed(task.taskId);
              this._logger?.info(`[F2A] 任务 ${task.taskId} 已通过 webhook 推送 (${result.latency}ms)`);
            } else {
              this._logger?.info(`[F2A] Webhook 推送失败: ${result.error}，任务将在轮询时处理`);
            }
          }
          
          // 触发 OpenClaw 心跳，让它知道有新任务
          this.api?.runtime?.system?.requestHeartbeatNow?.();
          
          return {
            accepted: true,
            taskId: payload.taskId
          };
        } catch (error) {
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: error instanceof Error ? error.message : 'Failed to queue task'
          };
        }
      },

      onMessage: async (payload: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }) => {
        // P1-6: 验证 PeerID 格式
        if (!isValidPeerId(payload.from)) {
          this._logger?.warn(`[F2A] onMessage: 拒绝来自无效 PeerID 的消息: ${String(payload.from).slice(0, 20)}`);
          return { response: 'Invalid sender' };
        }
        
        // P1-7: 检查消息长度限制
        if (payload.content && payload.content.length > MAX_MESSAGE_LENGTH) {
          this._logger?.warn(`[F2A] onMessage: 消息过长 (${payload.content.length} bytes)，拒绝处理`);
          return { response: 'Message too long' };
        }
        
        this._logger?.info('[F2A] 收到 P2P 消息', { 
          from: payload.from.slice(0, 16), 
          content: payload.content.slice(0, 50) 
        });

        try {
          // 调用 OpenClaw Agent 处理消息
          // 使用 peerId 作为 session id，确保同一个对话者使用同一个 session
          const sessionId = `f2a-${payload.from.slice(0, 16)}`;
          
          // 构造消息，包含发送者信息
          const message = `[来自 ${payload.metadata?.from || payload.from.slice(0, 16)}] ${payload.content}`;
          
          // 调用 openclaw agent 命令
          const result = await this.invokeOpenClawAgent(payload.from, message);
          
          return { response: result || '收到消息，但我暂时无法生成回复。' };
        } catch (error) {
          this._logger?.error('[F2A] 处理消息失败', { error: extractErrorMessage(error) });
          return { response: '抱歉，我遇到了一些问题，无法处理你的消息。' };
        }
      },

      onStatus: async () => {
        // 如果 TaskQueue 未初始化，返回空闲状态
        if (!this._taskQueue) {
          return {
            status: 'available',
            load: 0,
            queued: 0,
            processing: 0
          };
        }
        
        const stats = this._taskQueue.getStats();
        return {
          status: 'available',
          load: stats.pending + stats.processing,
          queued: stats.pending,
          processing: stats.processing
        };
      }
    };
  }

  /**
   * 注册到 F2A Node
   */
  private async registerToNode(): Promise<void> {
    if (!this._webhookServer) return;
    
    await this.networkClient.registerWebhook(this._webhookServer.getUrl());
    
    await this.networkClient.updateAgentInfo({
      displayName: this.config.agentName,
      capabilities: this.capabilities
    });
  }

  // ========== Helpers ==========

  /**
   * 合并配置（公开方法供处理器使用）
   */
  async shutdown(): Promise<void> {
    this._logger?.info('[F2A] 正在关闭...');
    
    // 停止轮询定时器
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    
    // Issue #99: 关闭握手协议
    if (this._handshakeProtocol) {
      this._handshakeProtocol.shutdown();
      this._logger?.info('[F2A] HandshakeProtocol 已关闭');
      this._handshakeProtocol = undefined;
    }
    
    // Issue #98: 刷新通讯录数据
    if (this._contactManager) {
      this._contactManager.flush();
      this._logger?.info('[F2A] ContactManager 数据已保存');
      this._contactManager = undefined;
    }
    
    // 停止 F2A 实例（新架构直接管理）
    if (this._f2a) {
      try {
        await this._f2a.stop();
        this._logger?.info('[F2A] F2A 实例已停止');
      } catch (err) {
        this._logger?.warn('[F2A] F2A 实例停止失败', { error: extractErrorMessage(err) });
      }
      this._f2a = undefined;
      this._f2aStartTime = undefined;
    }
    
    // 停止 Webhook 服务器（只有已启动时才关闭）
    if (this._webhookServer) {
      await this._webhookServer.stop?.();
      this._logger?.info('[F2A] Webhook 服务器已停止');
    }
    
    // P1 修复：关闭前刷新信誉系统数据，确保持久化
    if (this._reputationSystem) {
      this._reputationSystem.flush();
      this._logger?.info('[F2A] 信誉系统数据已保存');
    }
    
    // P1 修复：关闭 TaskGuard，停止持久化定时器并保存最终状态
    taskGuard.shutdown();
    this._logger?.info('[F2A] TaskGuard 已关闭');
    
    // 停止 F2A Node（只有已启动时才关闭）
    if (this._nodeManager) {
      await this._nodeManager.stop();
      this._logger?.info('[F2A] F2A Node 管理器已停止');
    }
    
    // 关闭任务队列连接（只有已初始化时才关闭）
    // 保留持久化数据，不删除任务，这样重启后可以恢复未完成的任务
    if (this._taskQueue) {
      this._taskQueue.close();
      this._logger?.info('[F2A] 任务队列已关闭，持久化数据已保留');
    }
    
    this._initialized = false;
    this._logger?.info('[F2A] 已关闭');
  }
}

// 默认导出
export default F2APlugin;