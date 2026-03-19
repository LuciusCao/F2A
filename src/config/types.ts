/**
 * F2A 配置类型统一管理
 * 
 * 本文件集中定义所有核心配置类型，解决配置类型分散在多个文件的问题。
 * 
 * 配置层级：
 * 1. 核心配置（本文件）- P2P网络、安全、日志等基础配置
 * 2. 模块配置（各模块文件）- 信誉、经济、评审等模块专用配置
 * 3. 适配器配置（packages）- OpenClaw 适配器专用配置
 * 
 * 设计原则：
 * - 核心配置集中管理，便于维护
 * - 模块专用配置保持在模块内，便于内聚
 * - 适配器配置独立，避免循环依赖
 */

// ============================================================================
// 导入模块配置（保持向后兼容）
// ============================================================================

// 从 rate-limiter 导入，避免重复定义
export type { RateLimitConfig } from '../utils/rate-limiter.js';

// ============================================================================
// 基础枚举类型
// ============================================================================

/** 安全级别 */
export type SecurityLevel = 'low' | 'medium' | 'high';

/** 日志级别 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// ============================================================================
// 核心网络配置
// ============================================================================

/**
 * P2P 网络配置
 * 
 * 用于配置 libp2p 网络层参数
 */
export interface P2PNetworkConfig {
  /** 监听端口 */
  listenPort?: number;
  /** 监听地址 */
  listenAddresses?: string[];
  /** 引导节点列表 */
  bootstrapPeers?: string[];
  /** 引导节点指纹映射 - key为multiaddr或peerId，value为预期的PeerID */
  bootstrapPeerFingerprints?: Record<string, string>;
  /** 信任的 Peer 白名单（不会被清理） */
  trustedPeers?: string[];
  /** 是否启用 MDNS 本地发现 */
  enableMDNS?: boolean;
  /** 是否启用 DHT (默认 true) */
  enableDHT?: boolean;
  /** DHT 服务器模式 (默认 false，即客户端模式) */
  dhtServerMode?: boolean;
}

// ============================================================================
// 安全配置
// ============================================================================

/**
 * 安全配置
 * 
 * 用于配置节点安全策略
 */
export interface SecurityConfig {
  /** 安全级别 */
  level?: SecurityLevel;
  /** 是否要求确认连接 */
  requireConfirmation?: boolean;
  /** 是否验证签名 */
  verifySignatures?: boolean;
  /** 白名单（Peer ID 列表） */
  whitelist?: string[];
  /** 黑名单（Peer ID 列表） */
  blacklist?: string[];
  /** 速率限制 */
  rateLimit?: import('../utils/rate-limiter.js').RateLimitConfig;
  /** 每分钟最大任务数（用于限流） */
  maxTasksPerMinute?: number;
}

// ============================================================================
// Webhook 配置
// ============================================================================

/**
 * Webhook 配置
 * 
 * 用于外部系统回调通知
 */
export interface WebhookConfig {
  /** 回调 URL */
  url: string;
  /** 认证 token */
  token: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
}

// ============================================================================
// F2A 核心选项
// ============================================================================

/**
 * F2A 节点核心选项
 * 
 * 创建 F2A 节点时的主要配置接口
 */
export interface F2AOptions {
  /** 节点可读名称 */
  displayName?: string;
  /** Agent 类型 */
  agentType?: string;
  /** P2P 网络配置 */
  network?: P2PNetworkConfig;
  /** 安全配置 */
  security?: SecurityConfig;
  /** 日志级别 */
  logLevel?: LogLevel;
  /** 数据目录 */
  dataDir?: string;
}

// ============================================================================
// 任务委托配置
// ============================================================================

/** 任务委托重试选项 */
export interface TaskRetryOptions {
  /** 最大重试次数（默认 3） */
  maxRetries?: number;
  /** 重试间隔毫秒（默认 1000） */
  retryDelayMs?: number;
  /** 发现超时毫秒（默认 5000） */
  discoverTimeoutMs?: number;
}

/** 任务委托选项 */
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
  /** 重试选项 */
  retryOptions?: TaskRetryOptions;
}

// ============================================================================
// 重导出模块配置类型
// ============================================================================

// 信誉配置 - 从核心模块重导出
export type { ReputationConfig } from '../core/reputation.js';

// 经济配置 - 从核心模块重导出
export type { EconomyConfig } from '../core/autonomous-economy.js';

// 评审委员会配置 - 从核心模块重导出
export type { ReviewCommitteeConfig } from '../core/review-committee.js';

// 能力管理器配置 - 从核心模块重导出
export type { CapabilityManagerConfig } from '../core/capability-manager.js';

// 邀请配置 - 从核心模块重导出
export type { InvitationConfig } from '../core/reputation-security.js';

// 身份管理器选项 - 从核心模块重导出
export type { IdentityManagerOptions } from '../core/identity/types.js';