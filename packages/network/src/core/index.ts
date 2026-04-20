/**
 * Core Layer Export
 * RFC 005: MessageRouter 和 AgentRegistry 统一入口
 */

// 核心类
export { F2A } from './f2a.js';
export { P2PNetwork } from './p2p-network.js';

// P2P 处理器（Phase 2 拆分）
export { MessageHandler } from './message-handler.js';
export { KeyExchangeService } from './key-exchange-service.js';
export { EventHandlerSetupService } from './event-handler-setup.js';
export { MessageSender } from './message-sender.js';
export { AgentDiscoverer } from './agent-discoverer.js';

export { MessageRouter, RoutableMessage, MessageRouterEvents } from './message-router.js';
export { MessageQueue, QueueManager } from './queue-manager.js';
export { AgentWebhookPayload, WebhookPusher } from './webhook-pusher.js';
export { AgentRegistry, AgentRegistration, AgentRegistrationRequest, AgentWebhook, MessageCallback, PersistedAgentRegistration, PersistedAgentRegistry } from './agent-registry.js';

// 能力管理
export { CapabilityManager } from './capability-manager.js';
export { SkillExchangeManager } from './skill-exchange-manager.js';

// 身份系统
export { IdentityManager } from './identity/index.js';
export { NodeIdentityManager } from './identity/node-identity.js';
export { AgentIdentityManager } from './identity/agent-identity.js';
export { IdentityDelegator } from './identity/delegator.js';

// 消息存储
export { MessageStore } from './message-store.js';

// NAT 穿越
export { NATTraversalManager, NATType, ConnectionStrategy } from './nat-traversal.js';

// 信誉系统
export { ReputationManager } from './reputation.js';
export type { ReputationLevel, ReputationTier } from './reputation.js';

// 其他
export { AutonomousEconomy } from './autonomous-economy.js';
export { ReviewCommittee } from './review-committee.js';
export { TokenManager } from './token-manager.js';