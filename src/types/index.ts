/**
 * F2A P2P 网络核心类型定义
 * 基于 libp2p 的 Agent 协作网络
 */

import { Multiaddr } from '@multiformats/multiaddr';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// 基础类型
// ============================================================================

export type SecurityLevel = 'low' | 'medium' | 'high';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// ============================================================================
// Agent 能力与身份
// ============================================================================

export interface AgentCapability {
  /** 能力名称，如 "file-operation", "web-browsing", "code-generation" */
  name: string;
  /** 能力描述 */
  description: string;
  /** 支持的工具/操作 */
  tools: string[];
  /** 能力参数schema（可选） */
  parameters?: Record<string, ParameterSchema>;
}

export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface AgentInfo {
  /** libp2p PeerID */
  peerId: string;
  /** 可读名称 */
  displayName?: string;
  /** Agent 类型 */
  agentType: 'openclaw' | 'claude-code' | 'codex' | 'custom';
  /** 版本 */
  version: string;
  /** 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 支持的协议版本 */
  protocolVersion: string;
  /** 最后活跃时间 */
  lastSeen: number;
  /** 网络地址 */
  multiaddrs: string[];
  /** 端到端加密公钥 (base64) */
  encryptionPublicKey?: string;
}

// ============================================================================
// P2P 网络配置
// ============================================================================

export interface P2PNetworkConfig {
  /** 监听端口 */
  listenPort?: number;
  /** 监听地址 */
  listenAddresses?: string[];
  /** 引导节点列表 */
  bootstrapPeers?: string[];
  /** 是否启用 MDNS 本地发现 */
  enableMDNS?: boolean;
  /** 是否启用 DHT (默认 true) */
  enableDHT?: boolean;
  /** DHT 服务器模式 (默认 false，即客户端模式) */
  dhtServerMode?: boolean;
}

export interface F2AOptions {
  /** 节点可读名称 */
  displayName?: string;
  /** Agent 类型 */
  agentType?: string;
  /** P2P 网络配置 */
  network?: P2PNetworkConfig;
  /** 安全级别 */
  security?: SecurityConfig;
  /** 日志级别 */
  logLevel?: LogLevel;
  /** 数据目录 */
  dataDir?: string;
}

export interface SecurityConfig {
  level: SecurityLevel;
  /** 是否要求确认连接 */
  requireConfirmation: boolean;
  /** 是否验证签名 */
  verifySignatures: boolean;
  /** 白名单 */
  whitelist?: Set<string>;
  /** 黑名单 */
  blacklist?: Set<string>;
  /** 速率限制 */
  rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// ============================================================================
// F2A 消息协议
// ============================================================================

export type F2AMessageType = 
  | 'DISCOVER'      // 发现广播
  | 'DISCOVER_RESP' // 发现响应
  | 'CAPABILITY_QUERY'   // 查询能力
  | 'CAPABILITY_RESPONSE' // 能力响应
  | 'TASK_REQUEST'  // 任务请求
  | 'TASK_RESPONSE' // 任务响应
  | 'TASK_DELEGATE' // 任务转委托
  | 'PING'          // 心跳
  | 'PONG';         // 心跳响应

export interface F2AMessage {
  /** 消息ID */
  id: string;
  /** 消息类型 */
  type: F2AMessageType;
  /** 发送方 PeerID */
  from: string;
  /** 目标 PeerID（广播可为空） */
  to?: string;
  /** 时间戳 */
  timestamp: number;
  /** TTL */
  ttl?: number;
  /** 载荷 */
  payload: unknown;
}

// 发现广播
export interface DiscoverPayload {
  agentInfo: AgentInfo;
}

// 能力查询
export interface CapabilityQueryPayload {
  /** 查询特定能力，空表示查询所有 */
  capabilityName?: string;
  /** 查询特定工具 */
  toolName?: string;
}

// 能力响应
export interface CapabilityResponsePayload {
  agentInfo: AgentInfo;
}

// 任务请求
export interface TaskRequestPayload {
  /** 任务ID */
  taskId: string;
  /** 任务类型 */
  taskType: string;
  /** 任务描述 */
  description: string;
  /** 任务参数 */
  parameters?: Record<string, unknown>;
  /** 超时时间（秒） */
  timeout?: number;
}

// 任务响应
export interface TaskResponsePayload {
  /** 任务ID */
  taskId: string;
  /** 状态 */
  status: 'success' | 'error' | 'rejected' | 'delegated';
  /** 结果数据 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 如果转委托，指向新节点 */
  delegatedTo?: string;
}

// ============================================================================
// 事件定义
// ============================================================================

export interface PeerDiscoveredEvent {
  peerId: string;
  agentInfo: AgentInfo;
  multiaddrs: Multiaddr[];
}

export interface PeerConnectedEvent {
  peerId: string;
  direction: 'inbound' | 'outbound';
}

export interface PeerDisconnectedEvent {
  peerId: string;
}

export interface TaskRequestEvent {
  taskId: string;
  from: string;
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
  timeout?: number;
}

export interface TaskResponseEvent {
  taskId: string;
  from: string;
  status: 'success' | 'error' | 'rejected' | 'delegated';
  result?: unknown;
  error?: string;
}

export interface NetworkStartedEvent {
  peerId: string;
  listenAddresses: string[];
}

export interface F2AEvents {
  'peer:discovered': (event: PeerDiscoveredEvent) => void;
  'peer:connected': (event: PeerConnectedEvent) => void;
  'peer:disconnected': (event: PeerDisconnectedEvent) => void;
  'task:request': (event: TaskRequestEvent) => void;
  'task:response': (event: TaskResponseEvent) => void;
  'network:started': (event: NetworkStartedEvent) => void;
  'network:stopped': () => void;
  'error': (error: Error) => void;
}

export type F2AEventEmitter = EventEmitter<F2AEvents>;

// ============================================================================
// 结果类型 (从 result.ts 重新导出)
// ============================================================================

// Result 和 AsyncResult 从 ./result 导出

// ============================================================================
// Webhook 配置
// ============================================================================

export interface WebhookConfig {
  url: string;
  token: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

// ============================================================================
// 任务委托
// ============================================================================

export interface TaskDelegateOptions {
  /** 目标能力 */
  capability: string;
  /** 任务描述 */
  description: string;
  /** 任务参数 */
  parameters?: Record<string, unknown>;
  /** 超时时间（秒） */
  timeout?: number;
  /** 是否允许多方并行执行 */
  parallel?: boolean;
  /** 最少响应数（parallel=true时） */
  minResponses?: number;
}

export interface TaskDelegateResult {
  taskId: string;
  results: {
    peerId: string;
    status: 'success' | 'error' | 'timeout';
    result?: unknown;
    error?: string;
    latency: number;
  }[];
}

// ============================================================================
// 路由表
// ============================================================================

export interface PeerInfo {
  peerId: string;
  agentInfo?: AgentInfo;
  multiaddrs: Multiaddr[];
  connected: boolean;
  latency?: number;
  /** 信誉分 */
  reputation: number;
  /** 连接时间 */
  connectedAt?: number;
  /** 最后活跃 */
  lastSeen: number;
}

// ============================================================================
// 能力注册
// ============================================================================

export interface CapabilityHandler {
  (params: Record<string, unknown>): Promise<unknown>;
}

export interface RegisteredCapability extends AgentCapability {
  handler: CapabilityHandler;
}

// ============================================================================
// 统一 Result 类型
// 从 result.ts 重新导出，用于统一的错误处理模式
// ============================================================================

export * from './result';
