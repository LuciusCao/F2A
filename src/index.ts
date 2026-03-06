/**
 * F2A SDK 入口
 * P2P networking protocol for OpenClaw Agents
 */

// 核心 P2P 网络
export { F2A } from './core/f2a.js';
export { P2PNetwork } from './core/p2p-network.js';
export { TokenManager, defaultTokenManager } from './core/token-manager.js';
export { E2EECrypto, defaultE2EECrypto } from './core/e2ee-crypto.js';

// 信誉系统 (Phase 1-4)
export { ReputationManager, REPUTATION_TIERS } from './core/reputation.js';
export type { 
  ReputationEntry, 
  ReputationEvent, 
  ReputationLevel,
  ReputationTier,
  ReputationConfig,
  ReputationStorage
} from './core/reputation.js';

export { ReviewCommittee } from './core/review-committee.js';
export type {
  TaskReview,
  ReviewResult,
  ReviewDimensions,
  RiskFlag,
  ReviewCommitteeConfig,
  PendingReview
} from './core/review-committee.js';

export { AutonomousEconomy } from './core/autonomous-economy.js';
export type {
  TaskRequest,
  TaskCost,
  TaskReward,
  EconomyConfig,
  PriorityQueueItem,
  TaskExecutionResult
} from './core/autonomous-economy.js';

// 信誉安全机制 (Phase 3)
export { 
  ChainSignatureManager, 
  InvitationManager, 
  ChallengeManager 
} from './core/reputation-security.js';
export type {
  SignedReputationEvent,
  ReviewerSignature,
  InvitationRecord,
  InvitationConfig,
  ChallengeRecord,
  ChallengeResult
} from './core/reputation-security.js';

// 工具模块
export { Logger } from './utils/logger.js';
export { RateLimiter } from './utils/rate-limiter.js';
export { RequestSigner } from './utils/signature.js';
export { 
  createMessageSizeLimitMiddleware,
  createMessageTypeFilterMiddleware 
} from './utils/middleware.js';
export type { Middleware, MiddlewareContext, MiddlewareResult } from './utils/middleware.js';

// 类型定义
export * from './types/index.js';

// 版本号
export const VERSION = '1.0.1';
