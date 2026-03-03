/**
 * F2A SDK 入口
 * 简化版导出，供 OpenClaw 集成使用
 */

export { F2A } from './core/f2a';
export { P2PNetwork } from './core/p2p-network';
export { OpenClawF2AAdapter } from './adapters/openclaw';
export * from './types';

// 版本号
export const VERSION = '1.0.0';
