/**
 * F2A 主入口
 */

export { F2A, F2AInstance } from './core/f2a';
export { ConnectionManager } from './core/connection-manager';
export { IdentityManager } from './core/identity';

export * from './types';
export * from './protocol/messages';

// 版本信息
export const VERSION = '1.0.0';
export const PROTOCOL_VERSION = '1.0.0';