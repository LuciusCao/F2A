/**
 * F2A 默认配置值
 * 
 * 集中管理所有核心配置的默认值
 */

import type {
  P2PNetworkConfig,
  SecurityConfig,
  F2AOptions,
  LogLevel,
  SecurityLevel,
} from './types.js';

// ============================================================================
// P2P 网络默认配置
// ============================================================================

/**
 * 默认 P2P 网络配置
 */
export const DEFAULT_P2P_NETWORK_CONFIG: Required<P2PNetworkConfig> = {
  listenPort: 0, // 随机分配
  listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
  bootstrapPeers: [],
  bootstrapPeerFingerprints: {},
  trustedPeers: [],
  enableMDNS: true,
  enableDHT: true,
  dhtServerMode: false,
  enableNATTraversal: false, // Phase 2: 默认禁用，需要用户显式启用
};

// ============================================================================
// 安全默认配置
// ============================================================================

/**
 * 默认安全配置
 */
export const DEFAULT_SECURITY_CONFIG: Required<Omit<SecurityConfig, 'rateLimit'>> & {
  rateLimit: Required<import('../utils/rate-limiter.js').RateLimitConfig>;
} = {
  level: 'medium' as SecurityLevel,
  requireConfirmation: true,
  verifySignatures: true,
  whitelist: [],
  blacklist: [],
  rateLimit: {
    maxRequests: 100,
    windowMs: 60000,
    burstMultiplier: 1.5,
    skipSuccessfulRequests: false,
  },
  maxTasksPerMinute: 60,
};

// ============================================================================
// 日志默认配置
// ============================================================================

/**
 * 默认日志级别
 */
export const DEFAULT_LOG_LEVEL: LogLevel = 'INFO';

// ============================================================================
// F2A 核心默认配置
// ============================================================================

/**
 * 默认 F2A 选项
 */
export const DEFAULT_F2A_OPTIONS: Required<Omit<F2AOptions, 'network' | 'security'>> & {
  network: Required<P2PNetworkConfig>;
  security: Required<Omit<SecurityConfig, 'rateLimit'>> & {
    rateLimit: Required<import('../utils/rate-limiter.js').RateLimitConfig>;
  };
} = {
  displayName: 'F2A-Node',
  agentType: 'openclaw',
  network: DEFAULT_P2P_NETWORK_CONFIG,
  security: DEFAULT_SECURITY_CONFIG,
  logLevel: DEFAULT_LOG_LEVEL,
  dataDir: '.f2a',
};

// ============================================================================
// 默认数据目录
// ============================================================================

/**
 * 默认数据目录名
 */
export const DEFAULT_DATA_DIR = '.f2a';

/**
 * 身份文件名
 */
export const IDENTITY_FILE = 'identity.json';

// ============================================================================
// 速率限制默认配置
// ============================================================================

/**
 * 默认速率限制配置
 */
export const DEFAULT_RATE_LIMIT_CONFIG: Required<import('../utils/rate-limiter.js').RateLimitConfig> = {
  maxRequests: 100,
  windowMs: 60000,
  burstMultiplier: 1.5,
  skipSuccessfulRequests: false,
};