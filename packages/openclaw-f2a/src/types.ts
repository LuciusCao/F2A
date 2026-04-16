/**
 * F2A OpenClaw Connector - Core Types
 * 
 * 统一类型定义入口文件
 * - 基础类型定义在此文件
 * - Result 类型从 src/types/result.ts 重新导出（统一错误处理模式）
 */

// ============================================================================
// 统一 Result 类型（从核心库 re-export）
// ============================================================================

// 导入 SecurityConfig 和 AgentInfo 供本地使用
import type { SecurityConfig, AgentInfo } from '@f2a/network';

// ============================================================================
// Logger Types（Issue #106: 从 connector.ts 移入，解决循环依赖）
// ============================================================================

/**
 * API Logger 接口
 * 
 * 定义插件和组件使用的日志接口。
 * 此接口与 OpenClaw Plugin API 的 logger 接口兼容。
 * 
 * @example
 * ```typescript
 * const logger: ApiLogger = {
 *   info: (msg) => console.log(msg),
 *   warn: (msg) => console.warn(msg),
 *   error: (msg) => console.error(msg),
 *   debug: (msg) => console.debug(msg),
 * };
 * ```
 */
export interface ApiLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

/**
 * Plugin 内部访问接口
 * 用于 Handler 访问 Plugin 内部组件
 */
export interface PluginInternalAccess {
  networkClient?: any;
  reputationSystem?: any;
  taskQueue?: any;
  config?: any;
  f2aClient?: any;
  nodeManager?: any;
  getF2AStatus?: () => any;
  getF2A?: () => F2APublicInterface | undefined;
  reviewCommittee?: any;
}

// 重新导出核心 Result 类型，确保整个项目使用统一的错误处理模式
export type { Result, F2AError, ErrorCode, SecurityConfig } from '@f2a/network';
export { success, failure, failureFromError, createError } from '@f2a/network';

// ============================================================================
// F2A 接口类型（P2-4 修复：从 handshake-protocol.ts 移入）
// ============================================================================

/**
 * F2A 消息事件接口
 * 定义 F2A 实例接收到的消息格式
 */
export interface F2AMessageEvent {
  /** 发送方 Peer ID */
  from: string;
  /** 消息内容 */
  content: string;
  /** 消息元数据 */
  metadata?: Record<string, unknown>;
  /** 消息 ID */
  messageId: string;
}

/**
 * F2A 公共接口
 * 定义 F2A 实例对外暴露的方法和属性
 * 
 * P1-2 修复：添加 getConnectedPeers 方法，支持可选调用。
 */
export interface F2APublicInterface {
  /** 本节点的 Peer ID */
  peerId: string;
  /** Agent 信息 */
  agentInfo?: {
    displayName?: string;
    multiaddrs?: string[];
  };
  /** 获取本节点的能力列表 */
  getCapabilities(): Array<{ name: string; description?: string; tools?: string[] }>;
  /** 监听事件 */
  on(event: 'message', handler: (msg: F2AMessageEvent) => void): void;
  on(event: 'peer:connected' | 'peer:disconnected', handler: (event: { peerId: string }) => void): void;
  /** 发送消息 */
  sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<{ success: boolean; error?: { code: string; message: string } | string }>;
  /** 
   * 获取已连接的 Peers 列表（可选方法）
   * P1-2 修复：添加此方法以支持 contact-tool-handlers.ts:296 的可选调用
   */
  getConnectedPeers?(): PeerInfoLike[];
}

// ============================================================================
// OpenClaw 配置类型（扩展以支持插件配置访问）
// ============================================================================

/**
 * OpenClaw 完整配置结构
 * 
 * 注意：此接口定义了 OpenClaw 配置的已知结构。
 * 实际配置可能包含更多字段，插件应使用可选链访问。
 */
export interface OpenClawConfig extends Record<string, unknown> {
  /** 插件配置容器 */
  plugins?: {
    /** 插件条目映射 */
    entries?: Record<string, { config?: Record<string, unknown> }>;
  };
  /** Agent 配置 */
  agents?: {
    /** 默认 Agent 配置 */
    defaults?: {
      /** 工作空间路径 */
      workspace?: string;
    };
  };
}

// ============================================================================
// OpenClaw Plugin SDK Types
// ============================================================================
export interface OpenClawPlugin {
  name: string;
  version: string;
  initialize(config: Record<string, unknown>): Promise<void>;
  getTools(): Tool[];
  shutdown?(): Promise<void>;
  onEvent?(event: string, payload: unknown): Promise<void>;
}

// OpenClaw Plugin API (外部插件可用接口)
export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: {
    version: string;
    config: {
      loadConfig: (path?: string) => Promise<Record<string, unknown>>;
      writeConfigFile: (path: string, config: unknown) => Promise<void>;
    };
    system: {
      enqueueSystemEvent: (event: string, payload?: unknown) => void;
      requestHeartbeatNow: () => void;
      runCommandWithTimeout: (command: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
    };
    media: {
      loadWebMedia: (url: string) => Promise<Buffer>;
      detectMime: (data: Buffer) => string;
    };
    tts: {
      textToSpeechTelephony: (options: { text: string; cfg: unknown }) => Promise<{ audio: Buffer; sampleRate: number }>;
    };
    stt: {
      transcribeAudioFile: (options: { filePath: string; cfg: unknown; mime?: string }) => Promise<{ text?: string }>;
    };
    logging: {
      shouldLogVerbose: () => boolean;
      getChildLogger: (bindings?: Record<string, unknown>) => unknown;
    };
    /** Subagent API for spawning child agents */
    subagent?: {
      run: (params: { 
        sessionKey: string; 
        message: string; 
        provider?: string; 
        model?: string; 
        deliver?: boolean;
        /** P1-3: 幂等性键，防止重复创建会话 */
        idempotencyKey?: string;
      }) => Promise<{ runId: string }>;
      waitForRun: (params: { runId: string; timeoutMs?: number }) => Promise<{ status: 'ok' | 'error' | 'timeout'; error?: string }>;
      getSessionMessages: (params: { sessionKey: string; limit?: number }) => Promise<{ messages: unknown[] }>;
    };
  };
  /** Channel API - 参考 feishu 插件实现 */
  channel?: {
    routing: {
      resolveAgentRoute: (params: { 
        sessionKey?: string; 
        agentId?: string;
        peerId?: string;
        lane?: string;
      }) => { sessionKey: string; agentId?: string };
      buildAgentSessionKey: (params: { peerId: string; lane?: string }) => string;
    };
    reply: {
      dispatchReplyFromConfig: (params: {
        ctx: unknown;
        cfg: unknown;
        dispatcher?: unknown;
        replyOptions?: unknown;
      }) => Promise<{ queuedFinal: boolean; counts: { final: number } }>;
      formatAgentEnvelope: (params: {
        body: string;
        options?: unknown;
      }) => unknown;
      finalizeInboundContext: (params: {
        SessionKey: string;
        AgentId?: string;
        PeerId?: string;
        ReplyTo?: string;
        ChannelType?: string;
        InboundId?: string;
        Sender?: string;
        SenderId?: string;
        SenderName?: string;
        ExtraContext?: Record<string, unknown>;
      }) => unknown;
      resolveEnvelopeFormatOptions: (cfg: unknown) => unknown;
    };
  };
  logger?: {
    info: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
    debug?: (message: string, ...args: unknown[]) => void;
  };
  registerTool?: (tool: unknown, opts?: { optional?: boolean }) => void;
  registerService?: (service: { id: string; start: () => void | Promise<void>; stop?: () => void | Promise<void> }) => void;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  handler: (params: any, context: SessionContext) => Promise<ToolResult>;
}

export interface ParameterSchema {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  /** 数组类型的元素类型定义 */
  items?: {
    type: string;
    description?: string;
    enum?: string[];
  };
}

export interface SessionContext {
  sessionId: string;
  workspace: string;
  toJSON(): Record<string, unknown>;
}

export interface ToolResult {
  content: string;
  data?: unknown;
}

// F2A Network Types
export interface F2ANodeConfig {
  nodePath: string;
  controlPort: number;
  controlToken: string;
  p2pPort: number;
  enableMDNS: boolean;
  bootstrapPeers: string[];
  dataDir?: string;
  /** 请求超时（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试基础延迟（毫秒），默认 1000 */
  retryDelayMs?: number;
}

// F2A Plugin Configuration
export interface F2APluginConfig {
  autoStart?: boolean;
  webhookPort?: number;
  webhookToken?: string;
  agentName?: string;
  capabilities?: string[];
  f2aPath?: string;
  controlPort?: number;
  controlToken?: string;
  p2pPort?: number;
  enableMDNS?: boolean;
  bootstrapPeers?: string[];
  dataDir?: string;
  maxQueuedTasks?: number;
  /** 兜底轮询间隔（毫秒），默认 60 秒 */
  pollInterval?: number;
  /** P1 修复：processing 任务超时时间（毫秒），超过此时间将被重置为 pending，默认 5 分钟 */
  processingTimeoutMs?: number;
  /** Webhook 推送配置 */
  webhookPush?: WebhookPushConfig;
  reputation?: ReputationConfig;
  security?: SecurityConfig;
  /** 握手协议配置 */
  handshake?: HandshakeConfig;
}

/**
 * 握手协议配置
 * P2-3 修复：将硬编码值移到配置项
 */
export interface HandshakeConfig {
  /** 好友请求超时时间（毫秒），默认 5 分钟 */
  timeoutMs?: number;
  /** 发送重试次数，默认 3 */
  maxRetries?: number;
  /** 重试延迟（毫秒），默认 1000 */
  retryDelayMs?: number;
}

/** 默认握手协议配置 */
export const DEFAULT_HANDSHAKE_CONFIG: Required<HandshakeConfig> = {
  timeoutMs: 5 * 60 * 1000,  // 5 分钟
  maxRetries: 3,
  retryDelayMs: 1000,
};

export interface ReputationConfig {
  // 已废弃：reputation 核心参数由程序内部控制
  // 不再允许用户配置 enabled、initialScore、minScoreForService、decayRate
  // 这些是核心经济机制参数，必须统一管理
}

/**
 * 程序内部控制的信誉配置
 * 用户不可配置，防止作弊
 */
export const INTERNAL_REPUTATION_CONFIG = {
  enabled: true,                    // 强制启用
  initialScore: 30,                 // 新用户低分起步
  minScoreForService: 50,           // 低于此分无法接任务
  decayRate: 0.01,                  // 每小时衰减率
  reviewReward: 3,                  // 评审奖励
  reviewPenalty: 5,                 // 评审惩罚
  minScoreForReview: 40,            // 评审最低信誉
} as const;

// ============================================================================
// F2A 核心类型（从 @f2a/network 重新导出，避免重复定义）
// ============================================================================
export type { AgentInfo, AgentCapability, PeerInfo } from '@f2a/network';

// Task Types
export interface TaskRequest {
  taskId: string;
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
  from: string;
  timestamp: number;
  timeout: number;
}

export interface TaskResponse {
  taskId: string;
  status: 'success' | 'error' | 'rejected' | 'timeout';
  result?: unknown;
  error?: string;
  latency?: number;
}

export interface DelegateOptions {
  peerId: string;
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
  timeout?: number;
}

// Webhook Types
export interface WebhookEvent {
  type: 'discover' | 'delegate' | 'status' | 'reputation_update';
  payload: unknown;
  timestamp: number;
  signature?: string;
}

export interface DiscoverWebhookPayload {
  query: {
    capability?: string;
    minReputation?: number;
  };
  requester: string;
}

export interface DelegateWebhookPayload extends TaskRequest {
  // TaskRequest 本身已包含所有字段
}

// Reputation Types - 从 @f2a/network 重新导出并扩展
// 重构说明：改用 core 层的 ReputationManager，类型保持兼容
export type { ReputationEntry as CoreReputationEntry } from '@f2a/network';

/**
 * 扩展的信誉条目类型（用于 TaskGuard 等本地组件）
 * 包含 core 层的基本字段 + 本地扩展字段
 */
export interface ReputationEntry {
  peerId: string;
  score: number;
  level?: string;  // core 层字段
  lastUpdated?: number;  // core 层字段
  // 本地扩展字段（可选，兼容旧代码）
  successfulTasks?: number;
  failedTasks?: number;
  totalTasks?: number;
  avgResponseTime?: number;
  lastInteraction?: number;
  history: ReputationEvent[];
}

export interface ReputationEvent {
  type: 'task_success' | 'task_failure' | 'task_rejected' | 'timeout' | 'malicious' | 'review_reward' | 'review_penalty';
  taskId?: string;
  delta: number;
  timestamp: number;
  reason?: string;
}

// Claim Types - 认领模式
export interface TaskAnnouncement {
  announcementId: string;
  taskType: string;
  description: string;
  requiredCapabilities?: string[];
  estimatedComplexity?: number;
  reward?: number;
  timeout: number;
  from: string;
  timestamp: number;
  status: 'open' | 'claimed' | 'delegated' | 'expired';
  claims?: TaskClaim[];
}

export interface TaskClaim {
  claimId: string;
  announcementId: string;
  claimant: string;
  claimantName?: string;
  estimatedTime?: number;
  confidence?: number;
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
}

/**
 * Webhook 推送配置
 * 
 * 用于配置 F2A 向 OpenClaw 推送事件通知的参数。
 * 当任务状态变化、收到认领请求等事件发生时，会通过此配置推送通知。
 * 
 * @example
 * ```typescript
 * const config: WebhookPushConfig = {
 *   url: 'https://openclaw.example.com/webhook/f2a',
 *   token: 'secret-token-xxx',
 *   timeout: 5000,
 *   enabled: true
 * };
 * ```
 */
export interface WebhookPushConfig {
  /** OpenClaw webhook URL，用于接收推送通知 */
  url: string;
  /** Webhook 认证 token，用于验证推送请求的合法性 */
  token: string;
  /** 推送超时时间（毫秒），默认 30000ms */
  timeout?: number;
  /** 是否启用 webhook 推送，默认 false */
  enabled?: boolean;
}

/**
 * 认领 Webhook 载荷
 * 
 * 当有 Agent 认领你发布的任务广播时，会通过 webhook 推送此载荷。
 * 包含认领者的信息和认领详情，可用于自动或手动审核认领请求。
 */
export interface ClaimWebhookPayload {
  /** 任务广播 ID，对应 TaskAnnouncement.announcementId */
  announcementId: string;
  /** 认领 ID，唯一标识此次认领 */
  claimId: string;
  /** 认领者的 F2A Peer ID */
  claimant: string;
  /** 认领者的显示名称（可选） */
  claimantName?: string;
  /** 预估完成时间（毫秒，可选） */
  estimatedTime?: number;
  /** 完成任务的信心程度（0-1，可选） */
  confidence?: number;
}

// ============================================================================
// Agent Identity Types
// ============================================================================

/**
 * Agent 身份信息
 * 
 * Agent 是 F2A 网络中的逻辑实体，独立于物理节点 (Node)。
 * AgentID 用于标识 Agent，PeerID 用于标识物理节点。
 */
export interface AgentIdentity {
  /** Agent 唯一标识符 */
  agentId: string;
  /** Agent 显示名称 */
  name: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 可选：关联的 PeerID */
  peerId?: string;
  /** 可选：公钥（用于验证签名） */
  publicKey?: string;
  /** 可选：扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** Agent ID（可选，不提供则自动生成） */
  id?: string;
  /** Agent 名称 */
  name?: string;
  /** 数据目录 */
  dataDir?: string;
  /** 是否启用 mDNS 发现 */
  enableMDNS?: boolean;
  /** P2P 端口 */
  p2pPort?: number;
  /** Bootstrap 节点列表 */
  bootstrapPeers?: string[];
  /** 可选：扩展配置 */
  [key: string]: unknown;
}

// ============================================================================
// F2A Plugin Public Interface（Issue #106: Handler 依赖解耦）
// ============================================================================

/**
 * F2A 插件公开接口
 * 
 * 定义 Handler 需要访问的公开方法和属性。
 * 此接口用于解耦 Handler 和 F2APlugin 具体实现，提高类型安全性。
 * 
 * P2-1 修复：为所有组件访问方法添加具体返回类型，避免 unknown。
 * 
 * @example
 * ```typescript
 * // Handler 通过接口接收依赖
 * class ToolHandlers {
 *   constructor(private plugin: F2APluginPublicInterface) {}
 *   
 *   async handleDiscover() {
 *     const agents = await this.plugin.discoverAgents('code-generation');
 *     // ...
 *   }
 * }
 * ```
 */
export interface F2APluginPublicInterface {
  // ========== 配置访问 ==========
  
  /** 获取插件配置 */
  getConfig(): F2APluginConfig;
  
  /** 获取 OpenClaw API */
  getApi(): OpenClawPluginApi | undefined;
  
  // ========== 核心组件访问 ==========
  // P2-1 修复：返回具体类型而非 unknown
  
  /** 获取网络客户端 */
  getNetworkClient(): F2ANetworkClientLike;
  
  /** 获取信誉系统 */
  getReputationSystem(): ReputationSystemLike;
  
  /** 获取节点管理器 */
  getNodeManager(): NodeManagerLike;
  
  /** 获取任务队列 */
  getTaskQueue(): TaskQueueLike;
  
  /** 获取公告队列 */
  getAnnouncementQueue(): AnnouncementQueueLike;
  
  /** 获取评审委员会 */
  getReviewCommittee(): ReviewCommitteeLike | undefined;
  
  // ========== 通讯录和握手 ==========
  // P1-1 修复：返回具体类型而非 unknown
  
  /** 获取联系人管理器 */
  getContactManager(): ContactManagerLike;
  
  /** 获取握手协议处理器 */
  getHandshakeProtocol(): HandshakeProtocolLike;
  
  // ========== F2A 实例访问 ==========
  
  /** 获取 F2A 状态 */
  getF2AStatus(): { running: boolean; peerId?: string; uptime?: number };
  
  /** 发现 Agents */
  discoverAgents(capability?: string): Promise<{ success: boolean; data?: AgentInfo[]; error?: { message: string } }>;
  
  /** 获取连接的 Peers */
  getConnectedPeers(): Promise<{ success: boolean; data?: PeerInfoLike[]; error?: { message: string } }>;
  
  /** 发送消息 */
  sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  
  // ========== F2A 实例直接访问 ==========
  // P2-1 修复：返回 F2APublicInterface 而非 unknown
  
  /** 获取 F2A 实例（公共接口） */
  getF2A(): F2APublicInterface | undefined;
  
  // ========== 握手协议方法 ==========
  
  /** 发送好友请求 */
  sendFriendRequest(peerId: string, message?: string): Promise<string | null>;
  
  /** 接受好友请求 */
  acceptFriendRequest(requestId: string): Promise<boolean>;
  
  /** 拒绝好友请求 */
  rejectFriendRequest(requestId: string, reason?: string): Promise<boolean>;
}

// ============================================================================
// 类型接口定义（P2-1 修复：用于 F2APluginPublicInterface 返回类型）
// ============================================================================
// 
// 设计说明：
// 这些简化接口用于 F2APluginPublicInterface 的返回类型声明。
// 由于实际实现类可能有更复杂的方法签名，这里使用宽泛的类型定义。
// Handler 代码在使用这些返回值时，会根据实际需要进行类型转换或使用 any 类型断言。
// ============================================================================

/**
 * Peer 信息接口（简化版）
 * 用于 getConnectedPeers 返回类型
 */
export interface PeerInfoLike {
  peerId: string;
  name?: string;
  capabilities?: string[];
  reputation?: number;
  connectedAt?: number;
  [key: string]: unknown;  // 允许额外属性
}

/**
 * ContactManager 简化接口
 * P1-1 修复：定义 ContactManager 的公共方法签名
 * 
 * 设计原则：使用宽泛类型以兼容实际实现，避免严格的类型匹配问题。
 * 注意：使用 any[] 作为数组返回类型，以便 Handler 可以访问元素属性。
 */
export interface ContactManagerLike {
  /** 获取联系人列表 */
  getContacts: (...args: unknown[]) => any[];
  /** 获取单个联系人 */
  getContact: (id: string) => any;
  /** 按 Peer ID 查找联系人 */
  getContactByPeerId: (peerId: string) => any;
  /** 添加联系人 */
  addContact: (params: unknown) => any;
  /** 删除联系人 */
  removeContact: (id: string) => boolean;
  /** 更新联系人 */
  updateContact: (id: string, params: unknown) => any;
  /** 拉黑联系人 */
  blockContact: (id: string) => boolean;
  /** 解除拉黑 */
  unblockContact: (id: string) => boolean;
  /** 获取分组列表 */
  getGroups: () => any[];
  /** 创建分组 */
  createGroup: (params: unknown) => any;
  /** 更新分组 */
  updateGroup: (id: string, params: unknown) => any;
  /** 删除分组 */
  deleteGroup: (id: string) => boolean;
  /** 获取待处理握手请求 */
  getPendingHandshakes: () => any[];
  /** 获取统计数据 */
  getStats: () => { total: number; friends: number; strangers: number; pending: number; blocked: number };
  /** 导出通讯录 */
  exportContacts: (peerId: string) => any;
  /** 导入通讯录 */
  importContacts: (data: unknown, merge?: boolean) => { success: boolean; importedContacts: number; importedGroups: number; skippedContacts: number; errors: string[] };
}

/**
 * HandshakeProtocol 简化接口
 * P1-1 修复：定义 HandshakeProtocol 的公共方法签名
 */
export interface HandshakeProtocolLike {
  /** 发送好友请求 */
  sendFriendRequest: (peerId: string, message?: string) => Promise<string | null>;
  /** 接受好友请求 */
  acceptRequest: (requestId: string) => Promise<boolean>;
  /** 拒绝好友请求 */
  rejectRequest: (requestId: string, reason?: string) => Promise<boolean>;
  /** 处理收到的请求（可选） */
  handleRequest?: (request: unknown) => Promise<void>;
  /** 获取待处理请求（可选） */
  getPendingRequests?: () => unknown[];
}

/**
 * F2ANetworkClient 简化接口
 * P2-1 修复：定义网络客户端公共方法签名
 */
export interface F2ANetworkClientLike {
  /** 发现 Agents */
  discoverAgents: (capability?: string) => Promise<{ success: boolean; data?: AgentInfo[]; error?: { message: string } }>;
  /** 获取已连接的 Peers */
  getConnectedPeers: () => Promise<{ success: boolean; data?: PeerInfoLike[]; error?: { message: string } }>;
  /** 委托任务（可选） */
  delegateTask?: (peerId: string, task: unknown) => Promise<{ success: boolean; taskId?: string; error?: string }>;
}

/**
 * ReputationSystem 简化接口
 * P2-1 修复：定义信誉系统公共方法签名
 * 
 * 重构说明：改用 @f2a/network 的 ReputationManager，保持接口兼容
 */
export interface ReputationSystemLike {
  /** 获取信誉信息（包含 score、peerId、history 等属性） */
  getReputation: (peerId: string) => { score: number; peerId: string; history: ReputationEvent[]; [key: string]: unknown };
  /** 检查权限 */
  hasPermission?: (peerId: string, permission: 'publish' | 'execute' | 'review') => boolean;
  /** 获取所有信誉记录 */
  getAllReputations?: () => Array<{ score: number; peerId: string; history: ReputationEvent[]; [key: string]: unknown }>;
  /** 获取高信誉节点 */
  getHighReputationNodes?: (minScore: number) => Array<{ score: number; peerId: string; history: ReputationEvent[]; [key: string]: unknown }>;
  /** 记录成功 */
  recordSuccess?: (peerId: string, taskId: string, delta?: number, latency?: number) => void;
  /** 记录失败 */
  recordFailure?: (peerId: string, taskId: string, reason?: string, delta?: number) => void;
  /** 记录评审奖励 */
  recordReviewReward?: (peerId: string, delta?: number) => void;
  /** 记录评审惩罚 */
  recordReviewPenalty?: (peerId: string, delta?: number, reason?: string) => void;
  /** 更新信誉分数（可选） */
  updateReputation?: (peerId: string, delta: number, reason?: string) => void;
  /** 获取高分 Agents（可选） */
  getTopAgents?: (capability?: string, limit?: number) => unknown[];
  /** 记录事件（可选） */
  recordEvent?: (peerId: string, event: unknown) => void;
}

/**
 * NodeManager 简化接口
 * P2-1 修复：定义节点管理器公共方法签名
 */
export interface NodeManagerLike {
  /** 启动节点 */
  start: () => Promise<void>;
  /** 停止节点 */
  stop: () => Promise<void>;
  /** 获取状态 */
  getStatus: () => { running: boolean; peerId?: string };
  /** 获取 Peer ID（可选） */
  getPeerId?: () => string | undefined;
}

/**
 * TaskQueue 简化接口
 * P2-1 修复：定义任务队列公共方法签名
 */
export interface TaskQueueLike {
  /** 添加任务 */
  add(task: unknown): unknown;
  /** 获取任务（可选） */
  getTask?: (taskId: string) => unknown;
  /** 获取待处理任务（可选） */
  getPendingTasks?: (limit?: number) => unknown[];
  /** 更新任务状态（可选） */
  updateTaskStatus?: (taskId: string, status: string) => boolean;
  /** 移除任务（可选） */
  removeTask?: (taskId: string) => boolean;
  /** 队列大小 */
  size?: () => number;
  /** 关闭队列（可选） */
  close?: () => void;
  /** 获取统计 */
  getStats(): unknown;
  /** 获取所有任务 */
  getAll(): unknown[];
  /** 重置处理中的任务为待处理 */
  resetProcessingTask(taskId: string): void;
  /** 获取待 webhook 推送的任务 */
  getWebhookPending(): unknown[];
  /** 标记任务为已推送 webhook */
  markWebhookPushed(taskId: string): void;
}

/**
 * AnnouncementQueue 简化接口
 * P2-1 修复：定义公告队列公共方法签名
 */
export interface AnnouncementQueueLike {
  /** 添加公告（可选） */
  add?: (announcement: unknown) => string;
  /** 获取公告（可选） */
  get?: (announcementId: string) => unknown;
  /** 获取开放公告（可选） */
  getOpenAnnouncements?: (capability?: string, limit?: number) => unknown[];
  /** 移除公告（可选） */
  remove?: (announcementId: string) => boolean;
}

/**
 * ReviewCommittee 简化接口
 * P2-1 修复：定义评审委员会公共方法签名
 */
export interface ReviewCommitteeLike {
  /** 请求评审（可选） */
  requestReview?: (taskId: string) => Promise<string[]>;
  /** 提交评审（可选） */
  submitReview?: (taskId: string, reviewerId: string, review: unknown) => Promise<boolean>;
  /** 获取评审列表（可选） */
  getReviews?: (taskId: string) => unknown[];
}