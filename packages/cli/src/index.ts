/**
 * @f2a/cli - F2A CLI 工具
 * 
 * 导出所有 CLI 命令，方便其他项目复用
 */

export * from './messages.js';
export * from './agents.js';
export * from './daemon.js';
export * from './configure.js';
export * from './config.js';
export * from './identity.js';
export * from './commands.js';
export * from './control-token.js';

// CLI 版本
export const CLI_VERSION = '0.5.0';
