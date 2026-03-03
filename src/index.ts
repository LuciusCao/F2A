/**
 * F2A SDK 入口
 * P2P networking protocol for OpenClaw Agents
 */

export { F2A } from './core/f2a';
export { P2PNetwork } from './core/p2p-network';
export { TokenManager, defaultTokenManager } from './core/token-manager';
export * from './types';

// 版本号
export const VERSION = '1.0.1';
