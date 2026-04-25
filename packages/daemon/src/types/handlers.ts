/**
 * F2A Handler 类型定义
 *
 * 从 control-server.ts 提取的 Handler 相关类型定义
 * 用于后续 ControlServer 拆分重构
 *
 * RFC008: 新增 ChallengeHandlerDeps
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type {
  Logger,
  TokenManager,
  AgentRegistry,
  AgentRegistration,
  MessageRouter,
  MessageStore,
  F2A,
  E2EECrypto,
  ChallengeStore
} from '@f2a/network';
import type { AgentIdentityStore } from '../agent-identity-store.js';
import type { AgentTokenManager } from '../agent-token-manager.js';

// ============================================================================
// Challenge 类型 (从 control-server.ts 提取)
// ============================================================================

/**
 * Challenge 类型（旧格式兼容）
 * 用于 Agent 身份验证的 Challenge-Response 流程
 * 
 * RFC003: 使用 nonce
 * RFC008: 使用 challenge + timestamp + operation
 */
export interface Challenge {
  nonce?: string;  // RFC003 兼容
  challenge?: string;  // RFC008
  webhook?: { url: string };
  timestamp?: number | string;
  operation?: string;
  expiresInSeconds?: number;
  /** 更新操作的数据（用于 update 操作） */
  updateData?: {
    webhook?: { url: string; token?: string }; 
    name?: string;
  };
}

// ============================================================================
// 认证上下文
// ============================================================================

/**
 * 认证上下文
 * 包含请求认证信息
 */
export interface AuthContext {
  token: string;
  clientIp: string;
}

// ============================================================================
// Handler 依赖类型
// ============================================================================

/**
 * 基础 Handler 依赖
 * 所有 Handler 共享的基础依赖
 */
export interface HandlerDeps {
  logger: Logger;
}

/**
 * SystemHandler 依赖
 * 系统相关操作的依赖
 */
export interface SystemHandlerDeps extends HandlerDeps {
  f2a: F2A;
  tokenManager: TokenManager;
}

/**
 * P2PHandler 依赖
 * P2P 网络操作的依赖
 */
export interface P2PHandlerDeps extends HandlerDeps {
  f2a: F2A;
}

/**
 * MessageHandler 依赖
 * 消息路由操作的依赖
 */
export interface MessageHandlerDeps extends HandlerDeps {
  messageRouter: MessageRouter;
  agentRegistry: AgentRegistry;
  f2a: F2A;
  agentTokenManager: AgentTokenManager;
  messageStore?: MessageStore;
}

/**
 * AgentHandler 依赖
 * Agent 管理操作的依赖
 * 注意: pendingChallenges 是有状态的,在 AgentHandler 内部创建
 */
export interface AgentHandlerDeps extends HandlerDeps {
  agentRegistry: AgentRegistry;
  identityStore: AgentIdentityStore;
  agentTokenManager: AgentTokenManager;
  e2eeCrypto: E2EECrypto;
  messageRouter: MessageRouter;
}

/**
 * ChallengeHandler 依赖
 * RFC008 Challenge-Response 认证的依赖
 */
export interface ChallengeHandlerDeps extends HandlerDeps {
  agentRegistry: AgentRegistry;
  identityStore: AgentIdentityStore;
  agentTokenManager: AgentTokenManager;
  messageRouter: MessageRouter;
  /** Challenge 有效期(秒),默认 30 */
  challengeExpirySeconds?: number;
  /** 自动清理间隔(毫秒),默认 60000 */
  cleanupIntervalMs?: number;
}

// ============================================================================
// HTTP Handler 类型
// ============================================================================

/**
 * 通用 HTTP Handler 函数类型
 */
export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthContext
) => Promise<void> | void;

/**
 * 带路径参数的 HTTP Handler 函数类型
 */
export type HttpHandlerWithParams<T = Record<string, string>> = (
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthContext,
  params: T
) => Promise<void> | void;
