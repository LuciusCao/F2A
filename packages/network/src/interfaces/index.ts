/**
 * 服务接口定义
 * 
 * 用于依赖注入、测试 mock 和服务契约定义
 */

import type { 
  AgentRegistration, 
  AgentRegistrationRequest, 
  RFC008AgentRegistrationRequest,
  AgentWebhook,
  MessageCallback
} from '../core/agent-registry.js';
import type { AgentCapability } from '../types/index.js';
import type { Result } from '../types/result.js';
import type { RoutableMessage, MessageQueue } from '../core/message-router.js';

/**
 * Agent 注册表接口
 */
export interface IAgentRegistry {
  // 注册方法
  register(request: AgentRegistrationRequest): AgentRegistration;
  registerRFC008(request: RFC008AgentRegistrationRequest): AgentRegistration;
  registerAuto(request: AgentRegistrationRequest & { publicKey?: string }): AgentRegistration;
  
  // 注销方法
  unregister(agentId: string): boolean;
  
  // 查询方法
  get(agentId: string): AgentRegistration | undefined;
  getAgentFormat(agentId: string): 'old' | 'new' | 'invalid';
  getAgentsMap(): Map<string, AgentRegistration>;
  list(): AgentRegistration[];
  findByCapability(capabilityName: string): AgentRegistration[];
  getPublicKey(agentId: string): string | undefined;
  
  // 更新方法
  updateName(agentId: string, newName: string): boolean;
  updateWebhook(agentId: string, webhook: AgentWebhook | undefined): boolean;
  updateLastActive(agentId: string): void;
  
  // 验证方法
  verifySignature(
    agentId: string, 
    signature?: string, 
    peerId?: string, 
    publicKey?: string
  ): boolean;
  validatePublicKeyFingerprint(agentId: string, publicKey: string): boolean;
  isNewFormatAgent(agentId: string): boolean;
  isOldFormatAgent(agentId: string): boolean;
  
  // 统计与清理
  getStats(): { total: number; capabilities: Record<string, number> };
  cleanupInactive(maxInactiveMs: number): number;
  
  // 持久化
  saveAsync(): Promise<void>;
}

/**
 * 消息路由接口
 */
export interface IMessageRouter {
  // 队列管理
  createQueue(agentId: string, maxSize?: number): void;
  deleteQueue(agentId: string): void;
  getQueue(agentId: string): MessageQueue | undefined;
  
  // 同步路由
  route(message: RoutableMessage): boolean;
  broadcast(message: RoutableMessage): boolean;
  
  // 异步路由
  routeAsync(message: RoutableMessage): Promise<boolean>;
  routeRemote(message: RoutableMessage): Promise<Result<void>>;
  broadcastAsync(message: RoutableMessage): Promise<boolean>;
  
  // 出站/入站路由 (RFC 005)
  routeIncoming(payload: unknown, fromPeerId: string): Promise<void>;
  routeOutgoing(message: RoutableMessage): Promise<Result<void>>;
  
  // 消息管理
  getMessages(agentId: string, limit?: number): RoutableMessage[];
  clearMessages(agentId: string, messageIds?: string[]): number;
  
  // 统计与清理
  getStats(): { 
    queues: number; 
    totalMessages: number; 
    queueStats: Record<string, { size: number; maxSize: number }> 
  };
  cleanupExpired(maxAgeMs: number): number;
  
  // Webhook 缓存
  clearWebhookCache(agentId: string): void;
  
  // 配置更新
  updateRegistry(registry: Map<string, AgentRegistration>): void;
  setP2PNetwork(p2pNetwork: unknown): void;
  
  // Peer 查找
  findPeerByAgentId(agentId: string): string | null;
}

// 重导出相关类型，方便使用者导入
export type { 
  AgentRegistration, 
  AgentRegistrationRequest, 
  RFC008AgentRegistrationRequest,
  AgentWebhook,
  MessageCallback
} from '../core/agent-registry.js';

export type { AgentCapability } from '../types/index.js';
export type { RoutableMessage, MessageQueue } from '../core/message-router.js';
export type { Result } from '../types/result.js';