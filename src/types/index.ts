/**
 * F2A 核心类型定义
 */

import { Socket } from 'net';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// 基础类型
// ============================================================================

export type SecurityLevel = 'low' | 'medium' | 'high';

export type ConnectionType = 'tcp' | 'webrtc';

export type MessageType = 
  | 'identity_challenge'
  | 'identity_response'
  | 'connection_pending'
  | 'confirmation_result'
  | 'message'
  | 'message_ack'
  | 'skill_query'
  | 'skill_response'
  | 'skill_invoke'
  | 'skill_result'
  | 'group_message'
  | 'group_invite'
  | 'key_exchange'
  | 'webrtc_offer'
  | 'webrtc_answer'
  | 'webrtc_ice';

// ============================================================================
// Agent 身份
// ============================================================================

export interface AgentIdentity {
  agentId: string;
  publicKey: string;
  privateKey: string;
  displayName?: string;
}

export interface IdentityInfo extends AgentIdentity {
  isNew: boolean;
  createdAt: number;
}

// ============================================================================
// 连接配置
// ============================================================================

export interface ConnectionConfig {
  p2pPort: number;
  controlPort: number;
  discoveryPort?: number;
  multicastPort?: number;
  security: SecurityConfig;
  logLevel?: LogLevel;
}

export interface SecurityConfig {
  level: SecurityLevel;
  requireConfirmation: boolean;
  verifySignatures: boolean;
  whitelist?: Set<string>;
  blacklist?: Set<string>;
  rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// ============================================================================
// 待确认连接
// ============================================================================

export interface PendingConnection {
  confirmationId: string;
  agentId: string;
  socket: Socket;
  publicKey: string;
  address: string;
  port: number;
  timestamp: number;
  expiresAt: number;
  index: number;
}

export interface PendingConnectionView {
  index: number;
  confirmationId: string;
  shortId: string;
  agentId: string;
  agentIdShort: string;
  address: string;
  port: number;
  remainingMinutes: number;
  requestedAt: number;
}

// ============================================================================
// 消息定义
// ============================================================================

export interface F2AMessage {
  type: MessageType;
  id?: string;
  timestamp: number;
  agentId?: string;
}

export interface IdentityChallengeMessage extends F2AMessage {
  type: 'identity_challenge';
  publicKey: string;
  challenge: string;
}

export interface IdentityResponseMessage extends F2AMessage {
  type: 'identity_response';
  publicKey: string;
  signature: string;
}

export interface ConnectionPendingMessage extends F2AMessage {
  type: 'connection_pending';
  confirmationId: string;
  message: string;
  timeout: number;
}

export interface ConfirmationResultMessage extends F2AMessage {
  type: 'confirmation_result';
  confirmationId: string;
  accepted: boolean;
  reason?: string;
}

export interface TextMessage extends F2AMessage {
  type: 'message';
  from: string;
  to: string;
  content: string;
}

// ============================================================================
// 事件定义
// ============================================================================

export interface ConnectionRequestEvent {
  confirmationId: string;
  agentId: string;
  address: string;
  port: number;
  isDuplicate: boolean;
}

export interface PeerConnectedEvent {
  peerId: string;
  type: ConnectionType;
  publicKey?: string;
}

export interface PeerDisconnectedEvent {
  peerId: string;
}

export interface MessageEvent {
  peerId: string;
  message: F2AMessage;
}

export interface ConfirmationEvent {
  confirmationId: string;
  agentId: string;
  socket: Socket;
  publicKey: string;
}

export interface RejectionEvent {
  confirmationId: string;
  agentId: string;
  reason: string;
}

export interface ExpirationEvent {
  confirmationId: string;
  agentId: string;
}

// ============================================================================
// Skill 定义
// ============================================================================

export interface SkillDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  handler: (params: unknown) => Promise<unknown>;
}

export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  default?: unknown;
  description?: string;
}

// ============================================================================
// 结果类型
// ============================================================================

export type Result<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

export type AsyncResult<T> = Promise<Result<T>>;

// ============================================================================
// 发现机制
// ============================================================================

export interface DiscoveredAgent {
  agentId: string;
  address: string;
  port: number;
  publicKey?: string;
  lastSeen: number;
  capabilities?: string[];
}

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
// F2A 选项
// ============================================================================

export interface F2AOptions {
  myAgentId?: string;
  myPublicKey?: string;
  myPrivateKey?: string;
  p2pPort?: number;
  controlPort?: number;
  logLevel?: LogLevel;
  security?: Partial<SecurityConfig>;
  dataDir?: string;
  webhook?: WebhookConfig;
}

// ============================================================================
// 事件发射器接口
// ============================================================================

export interface F2AEvents {
  'confirmation_required': (event: ConnectionRequestEvent) => void;
  'peer_connected': (event: PeerConnectedEvent) => void;
  'peer_disconnected': (event: PeerDisconnectedEvent) => void;
  'message': (event: MessageEvent) => void;
  'agent_discovered': (agent: DiscoveredAgent) => void;
  'started': (info: { port: number }) => void;
  'stopped': () => void;
}

export type F2AEventEmitter = EventEmitter<F2AEvents>;

// ============================================================================
// 工具类型
// ============================================================================

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

export type Nullable<T> = T | null | undefined;