/**
 * F2A OpenClaw Adapter - 主入口
 * OpenClaw 适配器，用于接入 F2A P2P Agent 网络
 */

export { F2APlugin } from './connector.js';
export { F2ANodeManager } from './node-manager.js';
export { F2ANetworkClient } from './network-client.js';
export { WebhookServer, WebhookHandler } from './webhook-server.js';
export { ReputationSystem } from './reputation.js';
export { CapabilityDetector } from './capability-detector.js';
export { TaskQueue, QueuedTask, TaskQueueStats } from './task-queue.js';
export { AnnouncementQueue, AnnouncementQueueStats } from './announcement-queue.js';
export { TaskGuard, TaskGuardReport, TaskGuardRule, TaskGuardConfig, taskGuard } from './task-guard.js';
export * from './types.js';

// Issue #98: 通讯录模块
export { ContactManager } from './contact-manager.js';
export * from './contact-types.js';

// Issue #99: 握手协议模块
export { HandshakeProtocol, HANDSHAKE_MESSAGE_TYPES } from './handshake-protocol.js';
export type { FriendRequestMessage, FriendResponseMessage } from './handshake-protocol.js';

// 默认导出
export { F2APlugin as default } from './connector.js';