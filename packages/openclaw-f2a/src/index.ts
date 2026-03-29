/**
 * F2A OpenClaw Plugin - 公共 API 入口
 * OpenClaw 适配器，用于接入 F2A P2P Agent 网络
 * 
 * Issue #106: 精简导出，只导出公共 API
 */

// 主入口
export { F2APlugin } from './connector.js';
export { F2APlugin as default } from './connector.js';

// 公共类型定义
export type {
  // 基础类型
  F2APluginConfig,
  F2ANodeConfig,
  OpenClawPlugin,
  OpenClawPluginApi,
  Tool,
  SessionContext,
  ToolResult,
  ApiLogger,
  
  // 网络类型
  AgentInfo,
  AgentCapability,
  
  // 任务类型
  TaskRequest,
  TaskResponse,
  
  // 认领模式类型
  TaskAnnouncement,
  TaskClaim,
  
  // 公共接口
  F2APluginPublicInterface,
} from './types.js';

// 通讯录公共类型（Issue #98）
export { FriendStatus } from './contact-types.js';
export type {
  ContactFilter,
  ContactInfo,
} from './contact-types.js';

// 公共错误类型
export type { Result, F2AError, ErrorCode } from './types.js';

// Phase 3: Daemon 模式客户端
export { F2AClient } from './f2a-client.js';
export type {
  F2AClientConfig,
  AgentRegisterRequest,
  MessageSendRequest,
  RoutableMessage,
  DaemonResponse,
} from './f2a-client.js';

// Phase 3: 核心运行模式类型
export type { F2ARunMode } from './F2ACore.js';