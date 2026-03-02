/**
 * F2A 主入口
 */

// 核心模块
export { F2A, F2AInstance } from './core/f2a';
export { ConnectionManager } from './core/connection-manager';
export { IdentityManager } from './core/identity';
export { ServerlessP2P } from './core/serverless';

// Daemon 模块
export { F2ADaemon } from './daemon/index';
export { WebhookService } from './daemon/webhook';
export { ControlServer } from './daemon/control-server';

// CLI 模块
export * from './cli/commands';

// 类型和协议
export * from './types';
export * from './protocol/messages';

// 版本信息
export const VERSION = '1.0.0';
export const PROTOCOL_VERSION = '1.0.0';