/**
 * F2A 配置中心
 * 
 * 统一的配置类型导出入口，解决配置类型分散问题。
 * 
 * 使用方式：
 * ```typescript
 * import type { 
 *   P2PNetworkConfig, 
 *   SecurityConfig, 
 *   F2AOptions 
 * } from '@f2a/config';
 * 
 * import { 
 *   DEFAULT_P2P_NETWORK_CONFIG,
 *   DEFAULT_SECURITY_CONFIG 
 * } from '@f2a/config';
 * ```
 * 
 * 配置层级说明：
 * - 核心配置（本模块）：P2P网络、安全、日志、Webhook
 * - 模块配置：各模块保持自己的配置（ReputationConfig 等）
 * - 适配器配置：OpenClaw 适配器专用配置
 * 
 * P2-2 修复：移除对 ../types/index.js 的依赖，避免循环导入
 */

// ============================================================================
// 类型定义
// ============================================================================

// 导出所有核心配置类型
export type {
  // 基础枚举
  SecurityLevel,
  LogLevel,
  
  // 核心网络配置
  P2PNetworkConfig,
  SecurityConfig,
  WebhookConfig,
  
  // F2A 核心选项
  F2AOptions,
  
  // 任务委托配置
  TaskRetryOptions,
  TaskDelegateOptions,
  
  // 工具配置（重导出）
  RateLimitConfig,
  
  // 模块配置（重导出，保持向后兼容）
  ReputationConfig,
  EconomyConfig,
  ReviewCommitteeConfig,
  CapabilityManagerConfig,
  InvitationConfig,
  IdentityManagerOptions,
} from './types.js';

// ============================================================================
// 默认值
// ============================================================================

// 导出默认配置
export {
  // P2P 网络
  DEFAULT_P2P_NETWORK_CONFIG,
  
  // 安全
  DEFAULT_SECURITY_CONFIG,
  
  // 日志
  DEFAULT_LOG_LEVEL,
  
  // F2A 核心选项
  DEFAULT_F2A_OPTIONS,
  
  // 数据目录
  DEFAULT_DATA_DIR,
  IDENTITY_FILE,
  
  // 速率限制
  DEFAULT_RATE_LIMIT_CONFIG,
} from './defaults.js';

// ============================================================================
// 向后兼容重导出
// ============================================================================

// P2-2 修复：移除对 ../types/index.js 的依赖，直接从具体文件导入
// 这样可以避免循环依赖：config/index.ts -> types/index.ts -> config/types.ts

// 结果类型 - 直接从 result.ts 导入，不经过 types/index.ts
export type { Result, F2AError, ErrorCode } from '../types/result.js';
export { success, failure, failureFromError, createError } from '../types/result.js';

// ============================================================================
// 配置验证工具
// ============================================================================

/**
 * 验证 P2P 网络配置
 */
export function validateP2PNetworkConfig(
  config: Partial<import('./types.js').P2PNetworkConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // 验证端口范围
  if (config.listenPort !== undefined) {
    if (config.listenPort < 0 || config.listenPort > 65535) {
      errors.push('listenPort must be between 0 and 65535');
    }
  }
  
  // 验证引导节点格式
  if (config.bootstrapPeers) {
    for (const peer of config.bootstrapPeers) {
      if (!peer.startsWith('/')) {
        errors.push(`Invalid bootstrap peer format: ${peer}`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 验证安全配置
 */
export function validateSecurityConfig(
  config: Partial<import('./types.js').SecurityConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // 验证安全级别
  if (config.level && !['low', 'medium', 'high'].includes(config.level)) {
    errors.push(`Invalid security level: ${config.level}`);
  }
  
  // 验证速率限制
  if (config.rateLimit) {
    if (config.rateLimit.maxRequests < 1) {
      errors.push('rateLimit.maxRequests must be at least 1');
    }
    if (config.rateLimit.windowMs < 1000) {
      errors.push('rateLimit.windowMs must be at least 1000ms');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 深度合并配置
 */
export function mergeConfig<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };
  
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = target[key];
      
      if (
        sourceValue !== undefined &&
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        targetValue !== undefined &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        // 递归合并嵌套对象
        result[key] = mergeConfig(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[Extract<keyof T, string>];
      } else {
        // 直接赋值
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }
  
  return result;
}