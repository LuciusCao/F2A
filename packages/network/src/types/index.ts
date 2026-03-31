/**
 * F2A P2P 网络核心类型定义
 * 基于 libp2p 的 Agent 协作网络
 * 
 * 注意：核心配置类型已迁移到 src/config/types.ts
 * 本文件保持向后兼容，从配置中心重导出
 */

import { Multiaddr } from '@multiformats/multiaddr';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// 核心配置类型（从配置中心导入）
// ============================================================================

// 从配置中心导入核心配置类型，避免重复定义
export type {
  SecurityLevel,
  LogLevel,
  P2PNetworkConfig,
  SecurityConfig,
  F2AOptions,
  WebhookConfig,
  TaskRetryOptions,
  TaskDelegateOptions,
  RateLimitConfig,
} from '../config/types.js';

// 重导出默认配置（便于使用）
export {
  DEFAULT_P2P_NETWORK_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_LOG_LEVEL,
  DEFAULT_F2A_OPTIONS,
} from '../config/defaults.js';

// ============================================================================
// 基础类型（保留在此文件中）
// ============================================================================

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
  /** 
   * Agent ID (Phase 1)
   * 独立于 PeerID 的 Agent 身份标识
   * 格式: UUID 或类似 agent-{timestamp}-{random}
   */
  agentId?: string;
}

// ============================================================================
// F2A 消息协议 - 两层设计
// ============================================================================
// 
// ┌─────────────────────────────────────────────────────────────────────┐
// │  Layer 2: Agent 协议层（语义层）                                      │
// │  - MESSAGE: 自由通信，AI-to-AI 对话                                   │
// │  - SKILL_*: 技能交换（可选扩展）                                       │
// │  职责：Agent 之间的语义交互，内容由 Agent 自由解释                      │
// └─────────────────────────────────────────────────────────────────────┘
//                              ↑ 使用网络层传输
// ┌─────────────────────────────────────────────────────────────────────┐
// │  Layer 1: 网络层协议（基础设施）                                       │
// │  - DISCOVER / DISCOVER_RESP: Agent 发现                              │
// │  - PING / PONG: 连接心跳                                             │
// │  - DECRYPT_FAILED: 加密通道异常通知                                   │
// │  职责：维护 P2P 网络连接、节点发现、基础健康检查                        │
// └─────────────────────────────────────────────────────────────────────┘
// ============================================================================

// Layer 1: 网络层协议（基础设施）
// 这些消息由网络自动处理，Agent 无需关心语义
export type NetworkMessageType = 
  | 'DISCOVER'      // 发现广播
  | 'DISCOVER_RESP' // 发现响应
  | 'PING'          // 心跳
  | 'PONG'          // 心跳响应
  | 'DECRYPT_FAILED'; // 解密失败通知

// Layer 2: Agent 协议层（语义层）
// 这些消息携带 Agent 需要理解的语义内容
export type AgentMessageType = 
  | 'MESSAGE';      // 通用消息（取代所有 TASK_* / CAPABILITY_*）

// 技能交换协议（可选扩展，属于 Agent 协议层）
export type SkillMessageType = 
  | 'SKILL_ANNOUNCE'      // 技能公告
  | 'SKILL_QUERY'         // 技能查询
  | 'SKILL_QUERY_RESPONSE' // 技能查询响应
  | 'SKILL_INVOKE'        // 技能调用
  | 'SKILL_INVOKE_RESPONSE' // 技能调用响应
  | 'SKILL_RESULT';       // 技能执行结果

// 完整消息类型 = 网络层 + Agent层 + 扩展
export type F2AMessageType = NetworkMessageType | AgentMessageType | SkillMessageType;

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

// 消息主题常量（约定 MESSAGE payload 中的 topic 值）
export const MESSAGE_TOPICS = {
  /** 任务请求 */
  TASK_REQUEST: 'task.request',
  /** 任务响应 */
  TASK_RESPONSE: 'task.response',
  /** 能力查询 */
  CAPABILITY_QUERY: 'capability.query',
  /** 能力响应 */
  CAPABILITY_RESPONSE: 'capability.response',
  /** 自由对话 */
  FREE_CHAT: 'chat',
} as const;

// 结构化消息载荷（用于 MESSAGE 类型）
export interface StructuredMessagePayload {
  /** 消息主题（区分消息类型），必须匹配 `/^[a-z0-9]+([.-][a-z0-9]+)*$/` 格式
   * - 只允许小写字母、数字、点号、连字符
   * - 不允许连续点号或连字符（如 `a..b` 或 `a--b`）
   * - 最大长度 256 字符
   */
  topic?: string;
  
  /** 消息内容（文本或结构化对象）
   * - 文本格式：最大 1MB (1,048,576 字符)
   * - 对象格式：任意 JSON 结构化对象
   */
  content: string | Record<string, unknown>;
  
  /** 引用的消息 ID（用于回复链），最大长度 128 字符 */
  replyTo?: string;
}

// 类型别名：保留兼容性的结构化消息类型
/** @deprecated 使用 MESSAGE + StructuredMessagePayload 替代 */
export interface TaskRequestPayload extends StructuredMessagePayload {
  topic: typeof MESSAGE_TOPICS.TASK_REQUEST;
  content: {
    taskId: string;
    taskType: string;
    description: string;
    parameters?: Record<string, unknown>;
    timeout?: number;
  };
}

/** @deprecated 使用 MESSAGE + StructuredMessagePayload 替代 */
export interface TaskResponsePayload extends StructuredMessagePayload {
  topic: typeof MESSAGE_TOPICS.TASK_RESPONSE;
  content: {
    taskId: string;
    status: 'success' | 'error' | 'rejected' | 'delegated';
    result?: unknown;
    error?: string;
    delegatedTo?: string;
  };
}

/** @deprecated 使用 MESSAGE + StructuredMessagePayload 替代 */
export interface CapabilityQueryPayload extends StructuredMessagePayload {
  topic: typeof MESSAGE_TOPICS.CAPABILITY_QUERY;
  content: {
    capabilityName?: string;
    toolName?: string;
  };
}

/** @deprecated 使用 MESSAGE + StructuredMessagePayload 替代 */
export interface CapabilityResponsePayload extends StructuredMessagePayload {
  topic: typeof MESSAGE_TOPICS.CAPABILITY_RESPONSE;
  content: {
    agentInfo: AgentInfo;
  };
}

// 自由消息（Agent 之间的自然语言通信）
export interface MessagePayload {
  /** 消息内容（自然语言） */
  content: string;
  /** 可选元数据 */
  metadata?: Record<string, unknown>;
  /** 消息引用（回复某条消息时使用） */
  replyTo?: string;
}

// 消息响应
export interface MessageResponsePayload {
  /** 原消息ID */
  originalMessageId: string;
  /** 响应内容 */
  content: string;
  /** 可选元数据 */
  metadata?: Record<string, unknown>;
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

export interface NetworkStartedEvent {
  peerId: string;
  listenAddresses: string[];
}

// Agent 协议层事件：通用消息事件（取代 TaskRequest/Response 事件）
export interface MessageEvent {
  /** 消息 ID */
  messageId: string;
  /** 发送方 PeerID */
  from: string;
  /** 消息内容 */
  content: string | Record<string, unknown>;
  /** 消息主题 */
  topic?: string;
  /** 引用的消息 ID */
  replyTo?: string;
}

// 兼容性类型别名（已废弃）
/** @deprecated 使用 MessageEvent 替代 */
export interface TaskRequestEvent {
  taskId: string;
  from: string;
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
  timeout?: number;
}

/** @deprecated 使用 MessageEvent 替代 */
export interface TaskResponseEvent {
  taskId: string;
  from: string;
  status: 'success' | 'error' | 'rejected' | 'delegated';
  result?: unknown;
  error?: string;
}

export interface F2AEvents {
  // 网络层事件
  'peer:discovered': (event: PeerDiscoveredEvent) => void;
  'peer:connected': (event: PeerConnectedEvent) => void;
  'peer:disconnected': (event: PeerDisconnectedEvent) => void;
  'network:started': (event: NetworkStartedEvent) => void;
  'network:stopped': () => void;
  'error': (error: Error) => void;
  // Agent 协议层事件
  'peer:message': (event: MessageEvent) => void;
}

export type F2AEventEmitter = EventEmitter<F2AEvents>;

// ============================================================================
// 结果类型 (从 result.ts 重新导出)
// ============================================================================

// Result 和 AsyncResult 从 ./result 导出

// ============================================================================
// 任务委托结果（注意：TaskDelegateOptions 已移到 config/types.ts）
// ============================================================================

/** 任务委托结果 */
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

export * from './result.js';

// ============================================================================
// 能力量化类型 (Phase 2)
// 从 capability-quant.ts 重新导出
// ============================================================================

export * from './capability-quant.js';
export * from './skill-exchange.js';
