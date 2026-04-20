/**
 * P2P Handler Types - P2P 网络处理器类型定义
 * 
 * 用于拆分 p2p-network.ts 的处理器依赖注入
 */

import type { F2AMessage, AgentInfo, StructuredMessagePayload } from './index.js';
import type { E2EECrypto } from '../core/e2ee-crypto.js';
import type { PeerManager } from '../core/peer-manager.js';
import type { Logger } from '../utils/logger.js';
import type { MiddlewareManager } from '../utils/middleware.js';
import type { AgentRegistry } from '../core/agent-registry.js';
import type { AgentIdentityVerifier } from '../core/identity/agent-identity-verifier.js';
import type { EventEmitter } from 'eventemitter3';
import type { Libp2p } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';
import type { KeyExchangeService } from '../core/key-exchange-service.js';
import type { DiscoveryService } from '../core/discovery-service.js';
import type { DHTService } from '../core/dht-service.js';

// ============================================================================
// MessageHandler 依赖接口
// ============================================================================

/**
 * MessageHandler 依赖注入接口
 * 
 * MessageHandler 需要的所有外部依赖
 */
export interface MessageHandlerDeps {
  /** E2EE 加密器 */
  e2eeCrypto: E2EECrypto;
  /** Peer 状态管理器 */
  peerManager: PeerManager;
  /** 日志器 */
  logger: Logger;
  /** 中间件管理器 */
  middlewareManager: MiddlewareManager;
  /** Agent 注册表（可选，用于签名验证） */
  agentRegistry?: AgentRegistry;
  /** Agent 身份验证器（可选，用于 RFC003 验证） */
  agentIdentityVerifier?: AgentIdentityVerifier;
  /** 发送消息的回调（由 P2PNetwork 提供） */
  sendMessage: (peerId: string, message: F2AMessage, encrypt?: boolean) => Promise<void>;
  /** 事件发射器（由 P2PNetwork 提供） */
  emitter: EventEmitter<MessageHandlerEvents>;
  /** Agent 信息（用于签名验证） */
  agentInfo: AgentInfo;
  /** 解密失败速率限制检查 */
  decryptFailedRateLimiter: { allowRequest: (key: string) => boolean };
  /** DISCOVER 消息速率限制检查 */
  discoverRateLimiter: { allowRequest: (key: string) => boolean };
  /** Pending tasks map (for task response handling) */
  pendingTasks: Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: string) => void;
    timeout: NodeJS.Timeout;
    resolved: boolean;
  }>;
  /** 是否启用 AgentId 签名验证 */
  enableAgentIdVerification: boolean;
  /** KEY_EXCHANGE 消息处理回调（未提取到 MessageHandler） */
  onKeyExchange: (message: F2AMessage, peerId: string) => Promise<void>;
}

/**
 * MessageHandler 事件类型
 */
export interface MessageHandlerEvents {
  'message:received': (message: F2AMessage, peerId: string) => void;
  'error': (error: Error) => void;
  'peer:discovered': (event: { peerId: string; agentInfo: AgentInfo; multiaddrs: unknown[] }) => void;
  'security:invalid-signature': (event: { agentId: string; peerId: string; error?: string }) => void;
}

// ============================================================================
// KeyExchangeService 依赖接口
// ============================================================================

/**
 * KeyExchangeService 依赖注入接口
 */
export interface KeyExchangeServiceDeps {
  /** E2EE 加密器 */
  e2eeCrypto: E2EECrypto;
  /** 日志器 */
  logger: Logger;
  /** 发送消息的回调 */
  sendMessage: (peerId: string, message: F2AMessage) => Promise<void>;
}

// ============================================================================
// EventHandlerSetup 依赖接口
// ============================================================================

/**
 * EventHandlerSetup 依赖注入接口
 */
export interface EventHandlerSetupDeps {
  /** libp2p 节点 */
  node: Libp2p;
  /** Peer 状态管理器 */
  peerManager: PeerManager;
  /** 日志器 */
  logger: Logger;
  /** 消息处理器 */
  messageHandler: MessageHandlerLike;
  /** 密钥交换服务 */
  keyExchangeService: KeyExchangeService;
  /** E2EE 加密器 */
  e2eeCrypto: E2EECrypto;
  /** Agent 信息 */
  agentInfo: AgentInfo;
  /** DISCOVER 消息速率限制器 */
  discoverRateLimiter: { allowRequest: (key: string) => boolean };
  /** 发现新 Agent 的回调 */
  onPeerDiscovered: (event: { peerId: string; agentInfo: AgentInfo; multiaddrs: Multiaddr[] }) => void;
  /** Agent 连接回调 */
  onPeerConnected: (event: { peerId: string; direction: string }) => void;
  /** Agent 断开回调 */
  onPeerDisconnected: (event: { peerId: string }) => void;
  /** 发送 DISCOVER 消息的回调 */
  sendDiscoverMessage: (peerId: string, multiaddrs: Multiaddr[]) => Promise<void>;
  /** 是否启用 E2EE */
  enableE2EE: boolean;
}

/**
 * MessageHandler 接口（简化版，避免循环依赖）
 */
export interface MessageHandlerLike {
  handleMessage(message: F2AMessage, peerId: string): Promise<void>;
}

// ============================================================================
// MessageSender 依赖接口
// ============================================================================

/**
 * MessageSender 依赖注入接口
 */
export interface MessageSenderDeps {
  /** libp2p 节点 */
  node: Libp2p;
  /** E2EE 加密器 */
  e2eeCrypto: E2EECrypto;
  /** 日志器 */
  logger: Logger;
  /** Peer 状态管理器 */
  peerManager: PeerManager;
  /** 是否启用 E2EE */
  enableE2EE: boolean;
}

// ============================================================================
// AgentDiscoverer 依赖接口
// ============================================================================

/**
 * AgentDiscoverer 依赖注入接口
 */
export interface AgentDiscovererDeps {
  /** Peer 状态管理器 */
  peerManager: PeerManager;
  /** 发现服务 */
  discoveryService: DiscoveryService;
  /** DHT 服务 */
  dhtService: DHTService;
  /** 日志器 */
  logger: Logger;
  /** 消息发送器 */
  broadcast: (message: F2AMessage) => Promise<void>;
  /** Agent 信息 */
  agentInfo: AgentInfo;
  /** 等待 peer:discovered 事件的回调 */
  waitForPeerDiscovered: (capability: string | undefined, timeoutMs: number) => Promise<AgentInfo[]>;
}

// ============================================================================
// 处理结果类型
// ============================================================================

/**
 * 加密消息处理结果
 * 
 * 用于 handleEncryptedMessage 内部流程控制
 */
export interface DecryptResult {
  /** 是否继续处理 */
  action: 'continue' | 'return';
  /** 处理后的消息（可能被修改） */
  message: F2AMessage;
}

/**
 * 消息处理结果
 * 
 * 用于 handleMessage 内部流程控制
 */
export interface HandleResult {
  /** 是否继续处理 */
  action: 'continue' | 'return' | 'drop';
  /** 处理后的消息（可能被修改） */
  message: F2AMessage;
}

/**
 * 发送方身份验证结果
 */
export interface SenderVerificationResult {
  /** 是否验证通过 */
  valid: boolean;
  /** 失败原因（如果验证失败） */
  reason?: string;
}

// ============================================================================
// 消息类型枚举（用于 dispatch）
// ============================================================================

/**
 * F2A 消息类型
 * 
 * 与 F2AMessage.type 对应
 */
export type F2AMessageType = 
  | 'DISCOVER'
  | 'DISCOVER_RESP'
  | 'DECRYPT_FAILED'
  | 'KEY_EXCHANGE'
  | 'PING'
  | 'PONG'
  | 'MESSAGE';

/**
 * Agent 消息 topic 类型
 */
export type AgentMessageTopic = 
  | 'capability_query'
  | 'capability_response'
  | 'task_request'
  | 'task_response'
  | 'task_cancel'
  | 'agent_message';

// ============================================================================
// 辅助函数类型
// ============================================================================

/**
 * 消息验证函数类型
 */
export type MessageValidator = (message: F2AMessage) => {
  success: boolean;
  error?: { errors: Array<{ message: string }> };
};

/**
 * 结构化 payload 验证函数类型
 */
export type PayloadValidator = (payload: unknown) => {
  success: boolean;
  data?: StructuredMessagePayload;
  error?: { errors: Array<{ message: string }> };
};

// ============================================================================
// BoundEventHandler 类型
// ============================================================================

import type { PeerId } from '@libp2p/interface';

/**
 * 绑定的事件处理器引用
 */
export interface BoundEventHandlers {
  peerDiscovery: ((evt: CustomEvent<{ id: PeerId; multiaddrs: Multiaddr[] }>) => Promise<void>) | undefined;
  peerConnect: ((evt: CustomEvent<PeerId>) => Promise<void>) | undefined;
  peerDisconnect: ((evt: CustomEvent<PeerId>) => Promise<void>) | undefined;
}