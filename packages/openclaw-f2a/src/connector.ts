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

// ============================================================================
// 安全常量和验证工具
// ============================================================================

/** P1-7: 消息内容最大长度限制 (1MB)，防止内存耗尽 */
const MAX_MESSAGE_LENGTH = 1024 * 1024;

/** P1-6: PeerID 格式正则（libp2p 格式：12D3KooW...） */
const PEER_ID_REGEX = /^12D3KooW[A-Za-z1-9]{44}$/;

/** P1-4: URL 编码的路径遍历模式 */
const PATH_TRAVERSAL_PATTERNS = [
  '%2e%2e',     // URL 编码的 ..
  '%2E%2E',     // URL 编码的 .. (大写)
  '%252e',      // 双重 URL 编码
  '%c0%ae',     // UTF-8 overlong encoding
  '%c1%9c',     // UTF-8 overlong encoding
];

/**
 * P1-6: 验证 PeerID 格式
 * @param peerId - 待验证的 Peer ID
 * @returns 是否为有效的 libp2p Peer ID 格式
 */
export function isValidPeerId(peerId: string | undefined | null): peerId is string {
  return typeof peerId === 'string' && PEER_ID_REGEX.test(peerId);
}

/**
 * P0-1, P1-4: 验证路径安全性，防止路径遍历攻击
 * 
 * 增强版本，处理：
 * - 符号链接（通过 realpath 验证）
 * - URL 编码绕过
 * - 双重编码绕过
 * - UTF-8 overlong encoding
 * 
 * @param path - 待验证的路径
 * @param options - 可选的额外验证选项
 * @returns 如果路径安全返回 true，否则返回 false
 */
function isPathSafe(path: string | undefined | null, options?: { 
  /** 允许的根目录（路径必须在此目录下） */
  allowedRoot?: string;
  /** 是否检查符号链接（需要文件系统访问） */
  checkSymlinks?: boolean;
}): path is string {
  if (typeof path !== 'string' || path.length === 0) {
    return false;
  }
  
  // 拒绝绝对路径
  if (isAbsolute(path)) {
    return false;
  }
  
  // 拒绝包含路径遍历字符
  if (path.includes('..') || path.includes('\0')) {
    return false;
  }
  
  // 拒绝以 ~ 开头的路径（用户目录展开）
  if (path.startsWith('~')) {
    return false;
  }
  
  // P1-4: 检查 URL 编码的路径遍历模式
  const lowerPath = path.toLowerCase();
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      return false;
    }
  }
  
  // P1-4: 解码 URL 编码后再次检查
  try {
    const decodedPath = decodeURIComponent(path);
    // 解码后再次检查路径遍历
    if (decodedPath.includes('..') || decodedPath.includes('\0')) {
      return false;
    }
    // 检查解码后是否变成绝对路径
    if (isAbsolute(decodedPath)) {
      return false;
    }
  } catch {
    // 解码失败可能是恶意构造，拒绝
    return false;
  }
  
  // P1-4: 如果指定了允许的根目录，验证路径不会逃逸
  if (options?.allowedRoot) {
    try {
      const resolvedPath = join(options.allowedRoot, path);
      // 检查解析后的路径是否仍在允许的根目录下
      if (!resolvedPath.startsWith(options.allowedRoot)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  
  return true;
}

/**
 * P1-2: 统一错误提取工具函数
 * 从各种错误格式中提取错误消息，添加循环引用保护
 * @param error - 任意错误对象
 * @returns 错误消息字符串
 */
function extractErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (typeof error === 'object' && error !== null) {
      // 尝试常见的错误属性
      const err = error as Record<string, unknown>;
      if (typeof err.message === 'string') {
        return err.message;
      }
      if (typeof err.error === 'string') {
        return err.error;
      }
      if (typeof err.msg === 'string') {
        return err.msg;
      }
    }
    // P1-2: 使用 try-catch 保护 String() 调用，防止循环引用异常
    return String(error);
  } catch {
    // 如果 String() 抛出异常（如循环引用），返回安全的默认消息
    return '[Error: Unable to extract error message - possible circular reference]';
  }
}

/**
 * Issue #96: 从 IDENTITY.md 读取 agent 名字
 * @param workspace - agent workspace 目录
 * @returns agent 名字，如果读取失败返回 null
 */
function readAgentNameFromIdentity(workspace: string | undefined): string | null {
  if (!workspace) {
    return null;
  }
  
  try {
    const identityPath = join(workspace, 'IDENTITY.md');
    const fs = require('fs');
    
    if (!fs.existsSync(identityPath)) {
      return null;
    }
    
    const content = fs.readFileSync(identityPath, 'utf-8');
    
    // 解析 IDENTITY.md 中的 Name 字段
    // 格式: - **Name:** 猫咕噜 (Cat Guru)
    const nameMatch = content.match(/-\s*\*\*Name:\*\*\s*(.+?)(?:\s*\([^)]*\))?$/m);
    
    if (nameMatch && nameMatch[1]) {
      const name = nameMatch[1].trim();
      // 移除可能的英文别名（括号内的内容已在正则中处理）
      return name;
    }
    
    return null;
  } catch (err) {
    // 读取失败，返回 null
    return null;
  }
}

/** OpenClaw API Logger 类型 */
export interface ApiLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

/** 广播结果类型 */
interface BroadcastResult {
  agent: string;
  success: boolean;
  error?: string;
  latency?: number;
}

export class F2AOpenClawAdapter implements OpenClawPlugin {
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
  
  // 处理器实例（延迟初始化）
  private _toolHandlers?: ToolHandlers;
  private _claimHandlers?: ClaimHandlers;
  
  // Issue #98 & #99: 通讯录和握手机制
  private _contactManager?: ContactManager;
  private _handshakeProtocol?: HandshakeProtocol;
  
  // P1-3: 消息哈希去重缓存，防止恶意节点绕过 echo 检测
  // 存储最近处理过的消息哈希，避免重复处理
  private _processedMessageHashes: Map<string, number> = new Map();
  /** P1-3: 消息去重缓存最大条目数 */
  private static readonly MAX_MESSAGE_HASH_CACHE_SIZE = 10000;
  /** P1-3: 消息去重缓存条目最大存活时间（毫秒） */
  private static readonly MESSAGE_HASH_TTL_MS = 5 * 60 * 1000; // 5 分钟
  
  private config!: F2APluginConfig;
  private nodeConfig!: F2ANodeConfig;
  private capabilities: AgentCapability[] = [];
  private api?: OpenClawPluginApi;
  private pollTimer?: NodeJS.Timeout;
  private _initialized = false;
  
  // ========== 懒加载 Getter ==========
  
  /**
   * 获取节点管理器（懒加载）
   */
  private get nodeManager(): F2ANodeManager {
    if (!this._nodeManager) {
      this._nodeManager = new F2ANodeManager(this.nodeConfig, this._logger);
    }
    return this._nodeManager;
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
    // 防止恶意节点构造不含特定标记的消息绕过检测
    if (content) {
      const messageHash = this.computeMessageHash(from, content);
      const now = Date.now();
      
      // 检查是否已处理过相同的消息内容
      if (this._processedMessageHashes.has(messageHash)) {
        const processedTime = this._processedMessageHashes.get(messageHash)!;
        // 如果在 TTL 内，认为是重复消息
        if (now - processedTime < F2AOpenClawAdapter.MESSAGE_HASH_TTL_MS) {
          this._logger?.debug?.(`[F2A Adapter] 检测到重复消息（哈希去重）: ${messageHash.slice(0, 16)}...`);
          return true;
        }
      }
      
      // 记录此消息哈希
      this._processedMessageHashes.set(messageHash, now);
      
      // 清理过期的条目（防止内存泄漏）
      if (this._processedMessageHashes.size > F2AOpenClawAdapter.MAX_MESSAGE_HASH_CACHE_SIZE) {
        this.cleanupMessageHashCache(now);
      }
    }
    
    return false;
  }
  
  /**
   * P1-3: 计算消息内容哈希
   * 用于基于内容的去重
   */
  private computeMessageHash(from: string, content: string): string {
    // 使用简单的哈希算法，避免依赖 crypto 模块
    const data = `${from}:${content}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `msg-${hash.toString(16)}-${data.length}`;
  }
  
  /**
   * P1-3: 清理过期的消息哈希缓存
   */
  private cleanupMessageHashCache(now: number): void {
    const ttl = F2AOpenClawAdapter.MESSAGE_HASH_TTL_MS;
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
   */
  private get taskQueue(): TaskQueue {
    if (!this._taskQueue) {
      const dataDir = this.getDefaultDataDir();
      this._taskQueue = new TaskQueue({
        maxSize: this.config.maxQueuedTasks || 100,
        maxAgeMs: 24 * 60 * 60 * 1000, // 24小时
        persistDir: dataDir,
        persistEnabled: true,
        logger: this._logger
      });
      this._logger?.info('[F2A Adapter] TaskQueue 已初始化（懒加载）');
    }
    return this._taskQueue;
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
   * Issue #98: 获取联系人管理器（延迟初始化）
   */
  private get contactManager(): ContactManager {
    if (!this._contactManager) {
      const dataDir = this.getDefaultDataDir();
      this._contactManager = new ContactManager(dataDir, this._logger);
      this._logger?.info('[F2A Adapter] ContactManager 已初始化');
    }
    return this._contactManager;
  }
  
  /**
   * Issue #99: 获取握手协议处理器（延迟初始化）
   * 依赖 F2A 实例和 ContactManager
   */
  private get handshakeProtocol(): HandshakeProtocol {
    if (!this._handshakeProtocol && this._f2a && this._contactManager) {
      this._handshakeProtocol = new HandshakeProtocol(
        this._f2a,
        this._contactManager,
        this._logger
      );
      this._logger?.info('[F2A Adapter] HandshakeProtocol 已初始化');
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
      uptime: (this._f2a as any).startTime ? Date.now() - (this._f2a as any).startTime : undefined
    };
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
    this._logger?.info('[F2A Adapter] 初始化（延迟模式）...');

    // 保存 API 引用（用于触发心跳等）
    this.api = config._api;
    
    // 合并配置（只保存，不初始化资源）
    this.config = this.mergeConfig(config);
    this.nodeConfig = {
      nodePath: this.config.f2aPath || './F2A',
      controlPort: this.config.controlPort || 9001,
      controlToken: this.config.controlToken || this.generateToken(),
      p2pPort: this.config.p2pPort || 9000,
      enableMDNS: this.config.enableMDNS ?? true,
      bootstrapPeers: this.config.bootstrapPeers || [],
      dataDir: this.config.dataDir
    };

    // 初始化 Webhook 推送器（如果配置了）
    if (this.config.webhookPush?.enabled !== false && this.config.webhookPush?.url) {
      this._webhookPusher = new WebhookPusher(this.config.webhookPush, this._logger);
      this._logger?.info('[F2A Adapter] Webhook 推送已配置');
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

    this._logger?.info('[F2A Adapter] 初始化完成（延迟模式）');
    this._logger?.info(`[F2A Adapter] Agent 名称: ${this.config.agentName}`);
    this._logger?.info(`[F2A Adapter] 能力数: ${this.capabilities.length}`);
    this._logger?.info('[F2A Adapter] 资源将在首次使用时初始化（TaskQueue/WebhookServer 等）');
  }

  /**
   * 启用适配器（直接创建 F2A 实例）
   * 
   * 新架构：Adapter 直接管理 F2A 实例，不需要独立的 daemon 进程。
   * 这样消息处理可以直接调用 OpenClaw API，避免 HTTP + CLI 的复杂性。
   */
  async enable(): Promise<void> {
    if (this._initialized) {
      this._logger?.info('[F2A Adapter] 适配器已启用，跳过');
      return;
    }
    
    this._logger?.info('[F2A Adapter] 启用适配器（直接管理模式）...');
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
        } catch {}
        console.log(msg);
        this._logger?.info(msg);
      };
      
      debugLog(`[F2A Adapter] 使用数据目录: ${dataDir}`);
      debugLog(`[F2A Adapter] workspace: ${(this.api?.config as any)?.agents?.defaults?.workspace}`);
      debugLog(`[F2A Adapter] config.dataDir: ${this.config.dataDir}`);
      
      // Issue #96: 从 IDENTITY.md 读取 agent 名字
      const workspace = (this.api?.config as any)?.agents?.defaults?.workspace;
      const identityName = readAgentNameFromIdentity(workspace);
      
      // 优先级：IDENTITY.md > config.agentName > 默认值
      const displayName = identityName || this.config.agentName || 'OpenClaw Agent';
      
      if (identityName) {
        debugLog(`[F2A Adapter] 从 IDENTITY.md 读取 agent 名字: ${identityName}`);
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
          this._logger?.warn(`[F2A Adapter] 拒绝来自无效 PeerID 的消息: ${String(msg.from).slice(0, 20)}`);
          return;
        }
        
        // P1-7: 检查消息长度限制
        if (msg.content && msg.content.length > MAX_MESSAGE_LENGTH) {
          this._logger?.warn(`[F2A Adapter] 消息过长 (${msg.content.length} bytes)，拒绝处理`);
          return;
        }
        
        const logMsg = `[F2A Adapter] 收到 P2P 消息: from=${msg.from.slice(0, 16)}, content=${msg.content?.slice(0, 50)}`;
        this._logger?.info(logMsg);
        
        // 写入文件日志
        try {
          const fs = require('fs');
          const logPath = join(homedir(), '.openclaw/logs/adapter-debug.log');
          fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${logMsg}\n`);
        } catch {}
        
        try {
          // P1-2, P1-5: 改进的回声循环检测
          // 使用更严格的检测逻辑，防止恶意绕过
          const isReply = this.isEchoMessage(msg);
          
          if (isReply) {
            this._logger?.info('[F2A Adapter] 跳过 Agent 回复，避免回声循环');
            return;
          }
          
          // 调用 OpenClaw Agent 生成回复
          const reply = await this.invokeOpenClawAgent(msg.from, msg.content, msg.messageId);
          
          // 发送回复
          if (reply && this._f2a) {
            await (this._f2a as any).sendMessage(msg.from, reply, { type: 'reply', replyTo: msg.messageId });
            this._logger?.info('[F2A Adapter] 回复已发送', { to: msg.from.slice(0, 16) });
          }
        } catch (err) {
          this._logger?.error('[F2A Adapter] 处理消息失败', { error: extractErrorMessage(err) });
        }
      });
      
      // 监听其他事件
      this._f2a.on('peer:connected', (event: { peerId: string }) => {
        this._logger?.info('[F2A Adapter] Peer 连接', { peerId: event.peerId.slice(0, 16) });
      });
      
      this._f2a.on('peer:disconnected', (event: { peerId: string }) => {
        this._logger?.info('[F2A Adapter] Peer 断开', { peerId: event.peerId.slice(0, 16) });
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
      
      this._logger?.info('[F2A Adapter] F2A 实例已启动', { 
        peerId: this._f2a.peerId?.slice(0, 16),
        multiaddrs: this._f2a.agentInfo?.multiaddrs?.length || 0
      });
      
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this._logger?.error(`[F2A Adapter] 创建 F2A 实例失败: ${errorMsg}`);
      this._logger?.warn('[F2A Adapter] F2A Adapter 将以降级模式运行，P2P 功能不可用');
      
      // 清理失败的实例
      if (this._f2a) {
        try {
          await this._f2a.stop();
        } catch {}
        this._f2a = undefined;
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
      this._logger?.info(`[F2A Adapter] Webhook 服务器已启动: ${this._webhookServer.getUrl()}`);
    } catch (err) {
      const errorMsg = extractErrorMessage(err);
      this._logger?.warn(`[F2A Adapter] Webhook 服务器启动失败: ${errorMsg}`);
    }

    // 启动兜底轮询
    this.startFallbackPolling();
    
    if (this._f2a) {
      this._logger?.info(`[F2A Adapter] P2P 已就绪，Peer ID: ${this._f2a.peerId?.slice(0, 20)}...`);
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
        this._logger?.info('[F2A Adapter] 回复已发送', { to: fromPeerId.slice(0, 16) });
      } catch (err) {
        this._logger?.error('[F2A Adapter] 发送回复失败', { error: extractErrorMessage(err) });
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
      } catch {}
      this._logger?.info(msg);
    };
    
    debugLog(`[F2A Adapter] invokeOpenClawAgent: sessionKey=${sessionKey}`);
    debugLog(`[F2A Adapter] API: hasApi=${!!this.api}, hasChannel=${!!this.api?.channel}`);
    
    // 创建 F2A 回复 dispatcher
    const f2aDispatcher = this.createF2AReplyDispatcher(fromPeerId, replyToMessageId);
    
    // 使用 OpenClaw Channel API (参考飞书插件)
    if (this.api?.channel?.reply?.dispatchReplyFromConfig) {
      debugLog('[F2A Adapter] 使用 Channel API');
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
        
        debugLog(`[F2A Adapter] Channel API 完成: ${JSON.stringify(result)}`);
        return undefined; // dispatcher 会自动发送回复
        
      } catch (err) {
        debugLog(`[F2A Adapter] Channel API 失败: ${extractErrorMessage(err)}`);
      }
    }
    
    // 降级：使用 subagent API
    if (this.api?.runtime?.subagent?.run) {
      debugLog('[F2A Adapter] 使用 Subagent API');
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
            
            debugLog(`[F2A Adapter] Subagent 回复文本: ${reply?.slice(0, 100)}...`);
            
            if (reply) {
              // 手动发送回复
              await f2aDispatcher.deliver({ text: reply });
              return undefined;
            }
          }
        }
      } catch (err) {
        debugLog(`[F2A Adapter] Subagent 失败: ${extractErrorMessage(err)}`);
      }
    }
    
    // 最终降级
    debugLog('[F2A Adapter] 使用降级回复');
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
          this._logger?.info('[F2A Adapter] F2A 实例已停止');
        } catch {}
      }
      
      // 同步关闭其他资源
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      if (this._webhookServer) {
        try {
          (this._webhookServer as any).server?.close();
        } catch {}
      }
      if (this._taskQueue) {
        try {
          this._taskQueue.close();
        } catch {}
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
          this._logger?.info(`[F2A Adapter] 兜底轮询: ${pending.length} 个待推送任务`);
          
          for (const task of pending) {
            const result = await this._webhookPusher.pushTask(task);
            if (result.success) {
              this._taskQueue.markWebhookPushed(task.taskId);
            }
          }
        }
      } catch (error) {
        this._logger?.error('[F2A Adapter] 兜底轮询失败:', error);
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
          this._logger?.warn(`[F2A Adapter] 检测到僵尸任务 ${task.taskId.slice(0, 8)}... (processing ${Math.round(processingTime / 1000)}s)，重置为 pending`);
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
    return [
      {
        name: 'f2a_discover',
        description: '发现 F2A 网络中的 Agents，可以按能力过滤',
        parameters: {
          capability: {
            type: 'string',
            description: '按能力过滤，如 code-generation, file-operation',
            required: false
          },
          min_reputation: {
            type: 'number',
            description: '最低信誉分数 (0-100)',
            required: false
          }
        },
        handler: this.toolHandlers.handleDiscover.bind(this.toolHandlers)
      },
      {
        name: 'f2a_delegate',
        description: '委托任务给网络中的特定 Agent',
        parameters: {
          agent: {
            type: 'string',
            description: '目标 Agent ID、名称或 #索引 (如 #1)',
            required: true
          },
          task: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          context: {
            type: 'string',
            description: '任务上下文或附件',
            required: false
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒）',
            required: false
          }
        },
        handler: this.toolHandlers.handleDelegate.bind(this.toolHandlers)
      },
      {
        name: 'f2a_broadcast',
        description: '广播任务给所有具备某能力的 Agents（并行执行）',
        parameters: {
          capability: {
            type: 'string',
            description: '所需能力',
            required: true
          },
          task: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          min_responses: {
            type: 'number',
            description: '最少响应数',
            required: false
          }
        },
        handler: this.toolHandlers.handleBroadcast.bind(this.toolHandlers)
      },
      {
        name: 'f2a_status',
        description: '查看 F2A 网络状态和已连接 Peers',
        parameters: {},
        handler: this.toolHandlers.handleStatus.bind(this.toolHandlers)
      },
      {
        name: 'f2a_reputation',
        description: '查看或管理 Peer 信誉',
        parameters: {
          action: {
            type: 'string',
            description: '操作: list, view, block, unblock',
            required: true,
            enum: ['list', 'view', 'block', 'unblock']
          },
          peer_id: {
            type: 'string',
            description: 'Peer ID',
            required: false
          }
        },
        handler: this.toolHandlers.handleReputation.bind(this.toolHandlers)
      },
      // 新增：任务队列相关工具
      {
        name: 'f2a_poll_tasks',
        description: '查询本节点收到的远程任务队列（待 OpenClaw 执行）',
        parameters: {
          limit: {
            type: 'number',
            description: '最大返回任务数',
            required: false
          },
          status: {
            type: 'string',
            description: '任务状态过滤: pending, processing, completed, failed',
            required: false,
            enum: ['pending', 'processing', 'completed', 'failed']
          }
        },
        handler: this.toolHandlers.handlePollTasks.bind(this.toolHandlers)
      },
      {
        name: 'f2a_submit_result',
        description: '提交远程任务的执行结果，发送给原节点',
        parameters: {
          task_id: {
            type: 'string',
            description: '任务ID',
            required: true
          },
          result: {
            type: 'string',
            description: '任务执行结果',
            required: true
          },
          status: {
            type: 'string',
            description: '执行状态: success 或 error',
            required: true,
            enum: ['success', 'error']
          }
        },
        handler: this.toolHandlers.handleSubmitResult.bind(this.toolHandlers)
      },
      {
        name: 'f2a_task_stats',
        description: '查看任务队列统计信息',
        parameters: {},
        handler: this.toolHandlers.handleTaskStats.bind(this.toolHandlers)
      },
      // 认领模式工具
      {
        name: 'f2a_announce',
        description: '广播任务到 F2A 网络，等待其他 Agent 认领（认领模式）',
        parameters: {
          task_type: {
            type: 'string',
            description: '任务类型',
            required: true
          },
          description: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          required_capabilities: {
            type: 'array',
            description: '所需能力列表',
            required: false
          },
          estimated_complexity: {
            type: 'number',
            description: '预估复杂度 (1-10)',
            required: false
          },
          reward: {
            type: 'number',
            description: '任务奖励',
            required: false
          },
          timeout: {
            type: 'number',
            description: '超时时间（毫秒）',
            required: false
          }
        },
        handler: this.claimHandlers.handleAnnounce.bind(this.claimHandlers)
      },
      {
        name: 'f2a_list_announcements',
        description: '查看当前开放的任务广播（可认领）',
        parameters: {
          capability: {
            type: 'string',
            description: '按能力过滤',
            required: false
          },
          limit: {
            type: 'number',
            description: '最大返回数量',
            required: false
          }
        },
        handler: this.claimHandlers.handleListAnnouncements.bind(this.claimHandlers)
      },
      {
        name: 'f2a_claim',
        description: '认领一个开放的任务广播',
        parameters: {
          announcement_id: {
            type: 'string',
            description: '广播ID',
            required: true
          },
          estimated_time: {
            type: 'number',
            description: '预计完成时间（毫秒）',
            required: false
          },
          confidence: {
            type: 'number',
            description: '信心指数 (0-1)',
            required: false
          }
        },
        handler: this.claimHandlers.handleClaim.bind(this.claimHandlers)
      },
      {
        name: 'f2a_manage_claims',
        description: '管理我的任务广播的认领（接受/拒绝）',
        parameters: {
          announcement_id: {
            type: 'string',
            description: '广播ID',
            required: true
          },
          action: {
            type: 'string',
            description: '操作: list, accept, reject',
            required: true,
            enum: ['list', 'accept', 'reject']
          },
          claim_id: {
            type: 'string',
            description: '认领ID（accept/reject 时需要）',
            required: false
          }
        },
        handler: this.claimHandlers.handleManageClaims.bind(this.claimHandlers)
      },
      {
        name: 'f2a_my_claims',
        description: '查看我提交的任务认领状态',
        parameters: {
          status: {
            type: 'string',
            description: '状态过滤: pending, accepted, rejected, all',
            required: false,
            enum: ['pending', 'accepted', 'rejected', 'all']
          }
        },
        handler: this.claimHandlers.handleMyClaims.bind(this.claimHandlers)
      },
      {
        name: 'f2a_announcement_stats',
        description: '查看任务广播统计',
        parameters: {},
        handler: this.claimHandlers.handleAnnouncementStats.bind(this.claimHandlers)
      },
      // 任务评估相关工具
      {
        name: 'f2a_estimate_task',
        description: '评估任务成本（工作量、复杂度、预估时间）',
        parameters: {
          task_type: {
            type: 'string',
            description: '任务类型',
            required: true
          },
          description: {
            type: 'string',
            description: '任务描述',
            required: true
          },
          required_capabilities: {
            type: 'array',
            description: '所需能力列表',
            required: false
          }
        },
        handler: this.toolHandlers.handleEstimateTask.bind(this.toolHandlers)
      },
      {
        name: 'f2a_review_task',
        description: '作为评审者评审任务的工作量和价值',
        parameters: {
          task_id: {
            type: 'string',
            description: '任务ID',
            required: true
          },
          workload: {
            type: 'number',
            description: '工作量评估 (0-100)',
            required: true
          },
          value: {
            type: 'number',
            description: '价值评估 (-100 ~ 100)',
            required: true
          },
          risk_flags: {
            type: 'array',
            description: '风险标记: dangerous, malicious, spam, invalid',
            required: false
          },
          comment: {
            type: 'string',
            description: '评审意见',
            required: false
          }
        },
        handler: this.toolHandlers.handleReviewTask.bind(this.toolHandlers)
      },
      {
        name: 'f2a_get_reviews',
        description: '获取任务的评审汇总结果',
        parameters: {
          task_id: {
            type: 'string',
            description: '任务ID',
            required: true
          }
        },
        handler: this.toolHandlers.handleGetReviews.bind(this.toolHandlers)
      },
      {
        name: 'f2a_get_capabilities',
        description: '获取指定 Agent 的能力列表',
        parameters: {
          peer_id: {
            type: 'string',
            description: 'Agent 的 Peer ID 或名称',
            required: false
          }
        },
        handler: this.toolHandlers.handleGetCapabilities.bind(this.toolHandlers)
      },
      // ========== Issue #98 & #99: 通讯录和握手机制工具 ==========
      {
        name: 'f2a_contacts',
        description: '管理通讯录联系人。Actions: list（列出联系人）, get（获取详情）, add（添加）, remove（删除）, update（更新）, block（拉黑）, unblock（解除拉黑）',
        parameters: {
          action: {
            type: 'string',
            description: '操作类型: list, get, add, remove, update, block, unblock',
            required: true,
            enum: ['list', 'get', 'add', 'remove', 'update', 'block', 'unblock']
          },
          contact_id: {
            type: 'string',
            description: '联系人 ID（get/remove/update/block/unblock 时需要）',
            required: false
          },
          peer_id: {
            type: 'string',
            description: 'Peer ID（add 时需要，get/remove 时可选）',
            required: false
          },
          name: {
            type: 'string',
            description: '联系人名称（add/update 时需要）',
            required: false
          },
          groups: {
            type: 'array',
            description: '分组列表',
            required: false
          },
          tags: {
            type: 'array',
            description: '标签列表',
            required: false
          },
          notes: {
            type: 'string',
            description: '备注信息',
            required: false
          },
          status: {
            type: 'string',
            description: '按状态过滤（list 时可选）: stranger, pending, friend, blocked',
            required: false,
            enum: ['stranger', 'pending', 'friend', 'blocked']
          },
          group: {
            type: 'string',
            description: '按分组过滤（list 时可选）',
            required: false
          }
        },
        handler: this.handleContacts.bind(this)
      },
      {
        name: 'f2a_contact_groups',
        description: '管理联系人分组。Actions: list（列出分组）, create（创建）, update（更新）, delete（删除）',
        parameters: {
          action: {
            type: 'string',
            description: '操作类型: list, create, update, delete',
            required: true,
            enum: ['list', 'create', 'update', 'delete']
          },
          group_id: {
            type: 'string',
            description: '分组 ID（update/delete 时需要）',
            required: false
          },
          name: {
            type: 'string',
            description: '分组名称（create/update 时需要）',
            required: false
          },
          description: {
            type: 'string',
            description: '分组描述',
            required: false
          },
          color: {
            type: 'string',
            description: '分组颜色（十六进制，如 #FF5733）',
            required: false
          }
        },
        handler: this.handleContactGroups.bind(this)
      },
      {
        name: 'f2a_friend_request',
        description: '发送好友请求给指定 Agent',
        parameters: {
          peer_id: {
            type: 'string',
            description: '目标 Agent 的 Peer ID',
            required: true
          },
          message: {
            type: 'string',
            description: '附加消息',
            required: false
          }
        },
        handler: this.handleFriendRequest.bind(this)
      },
      {
        name: 'f2a_pending_requests',
        description: '查看和处理待处理的好友请求。Actions: list（列出请求）, accept（接受）, reject（拒绝）',
        parameters: {
          action: {
            type: 'string',
            description: '操作类型: list, accept, reject',
            required: true,
            enum: ['list', 'accept', 'reject']
          },
          request_id: {
            type: 'string',
            description: '请求 ID（accept/reject 时需要）',
            required: false
          },
          reason: {
            type: 'string',
            description: '拒绝原因（reject 时可选）',
            required: false
          }
        },
        handler: this.handlePendingRequests.bind(this)
      },
      {
        name: 'f2a_contacts_export',
        description: '导出通讯录数据',
        parameters: {},
        handler: this.handleContactsExport.bind(this)
      },
      {
        name: 'f2a_contacts_import',
        description: '导入通讯录数据',
        parameters: {
          data: {
            type: 'object',
            description: '导入的通讯录数据（JSON 格式）',
            required: true
          },
          merge: {
            type: 'boolean',
            description: '是否合并（true）或覆盖（false），默认 true',
            required: false
          }
        },
        handler: this.handleContactsImport.bind(this)
      }
    ];
  }

  /**
   * 创建 Webhook 处理器
   */
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
          this._logger?.warn(`[F2A Adapter] TaskGuard 阻止任务 ${payload.taskId}: ${blockReasons}`);
          return {
            accepted: false,
            taskId: payload.taskId,
            reason: `TaskGuard blocked: ${blockReasons}`
          };
        }

        if (taskGuardReport.requiresConfirmation) {
          // 任务需要确认（警告但不阻止）
          const warnReasons = taskGuardReport.warnings.map(w => w.message).join('; ');
          this._logger?.warn(`[F2A Adapter] TaskGuard 警告 ${payload.taskId}: ${warnReasons}`);
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
              this._logger?.info(`[F2A Adapter] 任务 ${task.taskId} 已通过 webhook 推送 (${result.latency}ms)`);
            } else {
              this._logger?.info(`[F2A Adapter] Webhook 推送失败: ${result.error}，任务将在轮询时处理`);
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
          this._logger?.warn(`[F2A Adapter] onMessage: 拒绝来自无效 PeerID 的消息: ${String(payload.from).slice(0, 20)}`);
          return { response: 'Invalid sender' };
        }
        
        // P1-7: 检查消息长度限制
        if (payload.content && payload.content.length > MAX_MESSAGE_LENGTH) {
          this._logger?.warn(`[F2A Adapter] onMessage: 消息过长 (${payload.content.length} bytes)，拒绝处理`);
          return { response: 'Message too long' };
        }
        
        this._logger?.info('[F2A Adapter] 收到 P2P 消息', { 
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
          this._logger?.error('[F2A Adapter] 处理消息失败', { error: extractErrorMessage(error) });
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
  mergeConfig(config: Record<string, unknown> & { _api?: unknown }): F2APluginConfig {
    return {
      autoStart: (config.autoStart as boolean) ?? true,
      webhookPort: (config.webhookPort as number) || 9002,
      agentName: (config.agentName as string) || 'OpenClaw Agent',
      capabilities: (config.capabilities as string[]) || [],
      f2aPath: config.f2aPath as string | undefined,
      controlPort: config.controlPort as number | undefined,
      controlToken: config.controlToken as string | undefined,
      p2pPort: config.p2pPort as number | undefined,
      enableMDNS: config.enableMDNS as boolean | undefined,
      bootstrapPeers: config.bootstrapPeers as string[] | undefined,
      // dataDir 只保存用户显式配置的值，默认值在 getDefaultDataDir() 中处理
      dataDir: config.dataDir as string | undefined,
      maxQueuedTasks: (config.maxQueuedTasks as number) || 100,
      pollInterval: config.pollInterval as number | undefined,
      // 保留 webhookPush 配置（修复：之前丢失导致 webhook 推送被禁用）
      webhookPush: config.webhookPush as { enabled?: boolean; url: string; token: string; timeout?: number } | undefined,
      reputation: {
        enabled: ((config.reputation as Record<string, unknown>)?.enabled as boolean) ?? INTERNAL_REPUTATION_CONFIG.enabled,
        initialScore: ((config.reputation as Record<string, unknown>)?.initialScore as number) || INTERNAL_REPUTATION_CONFIG.initialScore,
        minScoreForService: ((config.reputation as Record<string, unknown>)?.minScoreForService as number) || INTERNAL_REPUTATION_CONFIG.minScoreForService,
        decayRate: ((config.reputation as Record<string, unknown>)?.decayRate as number) || INTERNAL_REPUTATION_CONFIG.decayRate
      },
      security: {
        requireConfirmation: ((config.security as Record<string, unknown>)?.requireConfirmation as boolean) ?? false,
        whitelist: ((config.security as Record<string, unknown>)?.whitelist as string[]) || [],
        blacklist: ((config.security as Record<string, unknown>)?.blacklist as string[]) || [],
        maxTasksPerMinute: ((config.security as Record<string, unknown>)?.maxTasksPerMinute as number) || 10
      }
    };
  }

  private generateToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = 'f2a-';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  /**
   * 检查 F2A CLI 是否已安装
   * 通过执行 `f2a version` 命令来检测
   */
  private async checkF2AInstalled(): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync('f2a version', { timeout: 5000 });
      this._logger?.info(`[F2A Adapter] F2A CLI 已安装: ${stdout.trim()}`);
      return true;
    } catch (error) {
      // 如果是命令不存在，说明 CLI 未安装
      if (error instanceof Error && (error.message.includes('ENOENT') || error.message.includes('not found'))) {
        this._logger?.debug?.('[F2A Adapter] F2A CLI 未安装');
        return false;
      }
      // P2-3 修复：timeout 也视为 CLI 未安装（CLI 可能存在但响应慢）
      if (error instanceof Error && error.message.includes('ETIMEDOUT')) {
        this._logger?.debug?.('[F2A Adapter] F2A CLI 响应超时，视为未安装');
        return false;
      }
      // 其他错误，可能是 CLI 已安装但有问题
      this._logger?.debug?.(`[F2A Adapter] F2A CLI 检测异常: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 通过 CLI 启动 F2A daemon
   * 执行 `f2a daemon -d` 命令（后台模式）
   */
  private async startDaemonViaCLI(): Promise<boolean> {
    try {
      const { spawn } = await import('child_process');
      
      return new Promise((resolve) => {
        this._logger?.info('[F2A Adapter] 执行: f2a daemon -d');
        
        // 设置 messageHandlerUrl 环境变量，让 daemon 将消息推送到 adapter 的 webhook
        const env = { ...process.env };
        if (this._webhookServer) {
          const webhookUrl = `${this._webhookServer.getUrl()}/message`;
          env.F2A_MESSAGE_HANDLER_URL = webhookUrl;
          this._logger?.info(`[F2A Adapter] 配置消息处理 URL: ${webhookUrl}`);
        }
        
        const proc = spawn('f2a', ['daemon', '-d'], {
          detached: true,  // P1-1 修复：让 daemon 独立运行，不随父进程退出
          stdio: 'ignore',  // P1-2 修复：ignore stdio 配合 detached 使用
          env  // 传递环境变量
        });
        
        // P1-2 修复：detached + ignore stdio 后，需要 unref 让父进程可以独立退出
        proc.unref();
        
        proc.on('error', (err) => {
          this._logger?.error(`[F2A Adapter] 启动 daemon 失败: ${err.message}`);
          resolve(false);
        });
        
        // P2-1 修复：daemon 启动后 CLI 会自动等待服务就绪后退出
        // 我们只需要等待一段时间后检查 daemon 是否真的在运行
        setTimeout(async () => {
          const running = await this._nodeManager?.isRunning();
          if (running) {
            this._logger?.info('[F2A Adapter] F2A daemon 服务已就绪');
            resolve(true);
          } else {
            this._logger?.warn('[F2A Adapter] F2A daemon 启动超时，请检查日志: ~/.f2a/daemon.log');
            resolve(false);
          }
        }, 5000);
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this._logger?.error(`[F2A Adapter] 启动 daemon 失败: ${errMsg}`);
      return false;
    }
  }

  /**
   * 格式化广播结果（公共方法，供测试和外部调用）
   */
  formatBroadcastResults(results: BroadcastResult[]): string {
    return results.map(r => {
      const icon = r.success ? '✅' : '❌';
      const latency = r.latency ? ` (${r.latency}ms)` : '';
      return `${icon} ${r.agent}${latency}\n   ${r.success ? '完成' : `失败: ${r.error}`}`;
    }).join('\n\n');
  }

  /**
   * 解析 Agent 引用（公共方法，供测试和外部调用）
   */
  async resolveAgent(agentRef: string): Promise<AgentInfo | null> {
    const result = await this.networkClient?.discoverAgents();
    if (!result?.success) return null;

    const agents = result.data || [];

    // #索引格式
    if (agentRef.startsWith('#')) {
      const index = parseInt(agentRef.slice(1)) - 1;
      return agents[index] || null;
    }

    // 精确匹配
    const exact = agents.find((a: AgentInfo) => 
      a.peerId === agentRef || 
      a.displayName === agentRef
    );
    if (exact) return exact;

    // 模糊匹配
    const fuzzy = agents.find((a: AgentInfo) => 
      a.peerId.startsWith(agentRef) ||
      (a.displayName?.toLowerCase().includes(agentRef.toLowerCase()) ?? false)
    );

    return fuzzy || null;
  }

  // ============================================================================
  // Issue #98 & #99: 通讯录和握手机制工具处理方法
  // ============================================================================

  /**
   * 处理通讯录工具
   */
  private async handleContacts(
    params: {
      action: 'list' | 'get' | 'add' | 'remove' | 'update' | 'block' | 'unblock';
      contact_id?: string;
      peer_id?: string;
      name?: string;
      groups?: string[];
      tags?: string[];
      notes?: string;
      status?: string;
      group?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const cm = this.contactManager;
      
      switch (params.action) {
        case 'list': {
          const filter: ContactFilter = {};
          if (params.status) {
            filter.status = params.status as FriendStatus;
          }
          if (params.group) {
            filter.group = params.group;
          }
          const contacts = cm.getContacts(filter, { field: 'name', order: 'asc' });
          const stats = cm.getStats();
          
          return {
            content: `📋 **通讯录** (${stats.total} 个联系人)\n\n` +
              contacts.map(c => {
                const statusIcon = {
                  [FriendStatus.FRIEND]: '💚',
                  [FriendStatus.STRANGER]: '⚪',
                  [FriendStatus.PENDING]: '🟡',
                  [FriendStatus.BLOCKED]: '🔴',
                }[c.status];
                return `${statusIcon} **${c.name}**\n   Peer: ${c.peerId.slice(0, 16)}...\n   信誉: ${c.reputation} | 状态: ${c.status}`;
              }).join('\n\n') || '暂无联系人'
          };
        }
        
        case 'get': {
          let contact;
          if (params.contact_id) {
            contact = cm.getContact(params.contact_id);
          } else if (params.peer_id) {
            contact = cm.getContactByPeerId(params.peer_id);
          } else {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          if (!contact) {
            return { content: '❌ 联系人不存在' };
          }
          
          return {
            content: `👤 **${contact.name}**\n` +
              `   ID: ${contact.id}\n` +
              `   Peer ID: ${contact.peerId}\n` +
              `   状态: ${contact.status}\n` +
              `   信誉: ${contact.reputation}\n` +
              `   分组: ${contact.groups.join(', ') || '无'}\n` +
              `   标签: ${contact.tags.join(', ') || '无'}\n` +
              `   最后通信: ${contact.lastCommunicationTime ? new Date(contact.lastCommunicationTime).toLocaleString() : '从未'}\n` +
              (contact.notes ? `   备注: ${contact.notes}` : '')
          };
        }
        
        case 'add': {
          if (!params.peer_id || !params.name) {
            return { content: '❌ 需要提供 peer_id 和 name' };
          }
          
          const contact = cm.addContact({
            name: params.name,
            peerId: params.peer_id,
            groups: params.groups,
            tags: params.tags,
            notes: params.notes,
          });
          
          return { content: `✅ 已添加联系人: ${contact.name} (${contact.peerId.slice(0, 16)})` };
        }
        
        case 'remove': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const success = cm.removeContact(contactId);
          return { content: success ? '✅ 已删除联系人' : '❌ 联系人不存在' };
        }
        
        case 'update': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const contact = cm.updateContact(contactId, {
            name: params.name,
            groups: params.groups,
            tags: params.tags,
            notes: params.notes,
          });
          
          return { content: contact ? `✅ 已更新联系人: ${contact.name}` : '❌ 联系人不存在' };
        }
        
        case 'block': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const success = cm.blockContact(contactId);
          return { content: success ? '✅ 已拉黑联系人' : '❌ 联系人不存在' };
        }
        
        case 'unblock': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const success = cm.unblockContact(contactId);
          return { content: success ? '✅ 已解除拉黑' : '❌ 联系人不存在' };
        }
        
        default:
          return { content: '❌ 未知操作' };
      }
    } catch (err) {
      return { content: `❌ 操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 处理分组管理工具
   */
  private async handleContactGroups(
    params: {
      action: 'list' | 'create' | 'update' | 'delete';
      group_id?: string;
      name?: string;
      description?: string;
      color?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const cm = this.contactManager;
      
      switch (params.action) {
        case 'list': {
          const groups = cm.getGroups();
          return {
            content: `📁 **分组列表** (${groups.length} 个)\n\n` +
              groups.map(g => `• **${g.name}** (${g.id})\n   ${g.description || '无描述'}`).join('\n\n')
          };
        }
        
        case 'create': {
          if (!params.name) {
            return { content: '❌ 需要提供分组名称' };
          }
          
          const group = cm.createGroup({
            name: params.name,
            description: params.description,
            color: params.color,
          });
          
          return { content: `✅ 已创建分组: ${group.name}` };
        }
        
        case 'update': {
          if (!params.group_id) {
            return { content: '❌ 需要提供 group_id' };
          }
          
          const group = cm.updateGroup(params.group_id, {
            name: params.name,
            description: params.description,
            color: params.color,
          });
          
          return { content: group ? `✅ 已更新分组: ${group.name}` : '❌ 分组不存在' };
        }
        
        case 'delete': {
          if (!params.group_id) {
            return { content: '❌ 需要提供 group_id' };
          }
          
          const success = cm.deleteGroup(params.group_id);
          return { content: success ? '✅ 已删除分组' : '❌ 无法删除（分组不存在或为默认分组）' };
        }
        
        default:
          return { content: '❌ 未知操作' };
      }
    } catch (err) {
      return { content: `❌ 操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 处理好友请求工具
   */
  private async handleFriendRequest(
    params: {
      peer_id: string;
      message?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      if (!this._f2a) {
        return { content: '❌ F2A 实例未初始化' };
      }
      
      if (!this._contactManager) {
        // 确保联系人管理器已初始化
        this.contactManager;
      }
      
      if (!this._handshakeProtocol) {
        // 初始化握手协议
        this.handshakeProtocol;
      }
      
      if (!this._handshakeProtocol) {
        return { content: '❌ 握手协议未初始化' };
      }
      
      const requestId = await this._handshakeProtocol.sendFriendRequest(
        params.peer_id,
        params.message
      );
      
      if (requestId) {
        return { content: `✅ 好友请求已发送\n请求 ID: ${requestId}\n等待对方响应...` };
      } else {
        return { content: '❌ 发送好友请求失败' };
      }
    } catch (err) {
      return { content: `❌ 发送失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 处理待处理请求工具
   */
  private async handlePendingRequests(
    params: {
      action: 'list' | 'accept' | 'reject';
      request_id?: string;
      reason?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const cm = this.contactManager;
      
      switch (params.action) {
        case 'list': {
          const pending = cm.getPendingHandshakes();
          
          if (pending.length === 0) {
            return { content: '📭 暂无待处理的好友请求' };
          }
          
          return {
            content: `📬 **待处理的好友请求** (${pending.length} 个)\n\n` +
              pending.map(p => 
                `• **${p.fromName}**\n   Peer: ${p.from.slice(0, 16)}...\n   请求 ID: ${p.requestId}\n   收到: ${new Date(p.receivedAt).toLocaleString()}` +
                (p.message ? `\n   消息: ${p.message}` : '')
              ).join('\n\n')
          };
        }
        
        case 'accept': {
          if (!params.request_id) {
            return { content: '❌ 需要提供 request_id' };
          }
          
          if (!this._handshakeProtocol) {
            return { content: '❌ 握手协议未初始化' };
          }
          
          const success = await this._handshakeProtocol.acceptRequest(params.request_id);
          return { content: success ? '✅ 已接受好友请求，双方已成为好友' : '❌ 接受失败' };
        }
        
        case 'reject': {
          if (!params.request_id) {
            return { content: '❌ 需要提供 request_id' };
          }
          
          if (!this._handshakeProtocol) {
            return { content: '❌ 握手协议未初始化' };
          }
          
          const success = await this._handshakeProtocol.rejectRequest(params.request_id, params.reason);
          return { content: success ? '✅ 已拒绝好友请求' : '❌ 拒绝失败' };
        }
        
        default:
          return { content: '❌ 未知操作' };
      }
    } catch (err) {
      return { content: `❌ 操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 处理导出通讯录工具
   */
  private async handleContactsExport(
    _params: Record<string, never>,
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const cm = this.contactManager;
      const data = cm.exportContacts(this._f2a?.peerId);
      
      return {
        content: `📤 **通讯录导出成功**\n\n` +
          `联系人: ${data.contacts.length} 个\n` +
          `分组: ${data.groups.length} 个\n` +
          `导出时间: ${new Date(data.exportedAt).toLocaleString()}\n\n` +
          '```json\n' + JSON.stringify(data, null, 2) + '\n```',
        data,
      };
    } catch (err) {
      return { content: `❌ 导出失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 处理导入通讯录工具
   */
  private async handleContactsImport(
    params: {
      data: Record<string, unknown>;
      merge?: boolean;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const cm = this.contactManager;
      const result = cm.importContacts(params.data as any, params.merge ?? true);
      
      if (result.success) {
        return {
          content: `📥 **通讯录导入完成**\n\n` +
            `✅ 导入联系人: ${result.importedContacts} 个\n` +
            `✅ 导入分组: ${result.importedGroups} 个\n` +
            `⏭️ 跳过联系人: ${result.skippedContacts} 个` +
            (result.errors.length ? `\n\n⚠️ 错误:\n${result.errors.join('\n')}` : '')
        };
      } else {
        return {
          content: `❌ 导入失败\n\n错误:\n${result.errors.join('\n')}`
        };
      }
    } catch (err) {
      return { content: `❌ 导入失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 关闭插件，清理资源
   * 只清理已初始化的资源
   */
  async shutdown(): Promise<void> {
    this._logger?.info('[F2A Adapter] 正在关闭...');
    
    // 停止轮询定时器
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    
    // Issue #99: 关闭握手协议
    if (this._handshakeProtocol) {
      this._handshakeProtocol.shutdown();
      this._logger?.info('[F2A Adapter] HandshakeProtocol 已关闭');
      this._handshakeProtocol = undefined;
    }
    
    // Issue #98: 刷新通讯录数据
    if (this._contactManager) {
      this._contactManager.flush();
      this._logger?.info('[F2A Adapter] ContactManager 数据已保存');
      this._contactManager = undefined;
    }
    
    // 停止 F2A 实例（新架构直接管理）
    if (this._f2a) {
      try {
        await this._f2a.stop();
        this._logger?.info('[F2A Adapter] F2A 实例已停止');
      } catch (err) {
        this._logger?.warn('[F2A Adapter] F2A 实例停止失败', { error: extractErrorMessage(err) });
      }
      this._f2a = undefined;
    }
    
    // 停止 Webhook 服务器（只有已启动时才关闭）
    if (this._webhookServer) {
      await this._webhookServer.stop?.();
      this._logger?.info('[F2A Adapter] Webhook 服务器已停止');
    }
    
    // P1 修复：关闭前刷新信誉系统数据，确保持久化
    if (this._reputationSystem) {
      this._reputationSystem.flush();
      this._logger?.info('[F2A Adapter] 信誉系统数据已保存');
    }
    
    // P1 修复：关闭 TaskGuard，停止持久化定时器并保存最终状态
    taskGuard.shutdown();
    this._logger?.info('[F2A Adapter] TaskGuard 已关闭');
    
    // 停止 F2A Node（只有已启动时才关闭）
    if (this._nodeManager) {
      await this._nodeManager.stop();
      this._logger?.info('[F2A Adapter] F2A Node 管理器已停止');
    }
    
    // 关闭任务队列连接（只有已初始化时才关闭）
    // 保留持久化数据，不删除任务，这样重启后可以恢复未完成的任务
    if (this._taskQueue) {
      this._taskQueue.close();
      this._logger?.info('[F2A Adapter] 任务队列已关闭，持久化数据已保留');
    }
    
    this._initialized = false;
    this._logger?.info('[F2A Adapter] 已关闭');
  }
}

// 默认导出
export default F2AOpenClawAdapter;