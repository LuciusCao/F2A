/**
 * F2A SDK 入口
 * P2P networking protocol for OpenClaw Agents
 */

// 核心 P2P 网络
export { F2A } from './core/f2a';
export { P2PNetwork } from './core/p2p-network';
export { TokenManager, defaultTokenManager } from './core/token-manager';
export { E2EECrypto, defaultE2EECrypto } from './core/e2ee-crypto';

// 信誉系统 (Phase 1-4)
export { ReputationManager, REPUTATION_TIERS } from './core/reputation';
export type { 
  ReputationEntry, 
  ReputationEvent, 
  ReputationLevel,
  ReputationTier,
  ReputationConfig,
  ReputationStorage
} from './core/reputation';

export { ReviewCommittee } from './core/review-committee';
export type {
  TaskReview,
  ReviewResult,
  ReviewDimensions,
  RiskFlag,
  ReviewCommitteeConfig,
  PendingReview
} from './core/review-committee';

export { AutonomousEconomy } from './core/autonomous-economy';
export type {
  TaskRequest,
  TaskCost,
  TaskReward,
  EconomyConfig,
  PriorityQueueItem,
  TaskExecutionResult
} from './core/autonomous-economy';

// 信誉安全机制 (Phase 3)
export { 
  ChainSignatureManager, 
  InvitationManager, 
  ChallengeManager 
} from './core/reputation-security';
export type {
  SignedReputationEvent,
  ReviewerSignature,
  InvitationRecord,
  InvitationConfig,
  ChallengeRecord,
  ChallengeResult
} from './core/reputation-security';

// 工具模块
export { Logger } from './utils/logger';
export { RateLimiter } from './utils/rate-limiter';
export { RequestSigner } from './utils/signature';
export { 
  createMessageSizeLimitMiddleware,
  createMessageTypeFilterMiddleware 
} from './utils/middleware';
export type { Middleware, MiddlewareContext, MiddlewareResult } from './utils/middleware';

// 类型定义
export * from './types';

// 版本号
export const VERSION = '1.0.1';
