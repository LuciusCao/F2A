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
  enableRelayServer: false,  // Phase 2: 默认不提供 Relay 服务
  messageHandlerUrl: '',     // 默认不配置消息处理 URL
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
  level: 'medium' as SecurityLevel,
  requireConfirmation: true,
