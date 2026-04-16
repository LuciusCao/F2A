/**
 * @f2a/daemon - F2A 后台服务
 * 
 * 导出 Daemon 类和主要组件
 */

export { F2ADaemon, DaemonOptions } from './index.js';
export { AgentRegistry, AgentRegistration } from './agent-registry.js';
export { MessageRouter, RoutableMessage, MessageQueue } from './message-router.js';
export { ControlServer, ControlServerOptions } from './control-server.js';
export { WebhookServer, WebhookConfig } from './webhook.js';

// Daemon 版本
export const DAEMON_VERSION = '0.5.0';
