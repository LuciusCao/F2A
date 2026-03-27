/**
 * F2A 联系人类型定义
 * 
 * 定义通讯录相关的类型接口，支持：
 * - 联系人信息存储
 * - 分组/标签管理
 * - 好友状态管理
 * 
 * @module contact-types
 */

// ============================================================================
// 好友状态枚举
// ============================================================================

/**
 * 好友关系状态
 * 
 * 状态流转：
 * - stranger → pending (发送好友请求)
 * - pending → friend (对方接受)
 * - pending → stranger (对方拒绝或超时)
 * - friend → blocked (拉黑)
 * - blocked → stranger (解除拉黑)
 */
export enum FriendStatus {
  /** 陌生人：未建立任何关系 */
  STRANGER = 'stranger',
  /** 待处理：已发送/收到好友请求，等待响应 */
  PENDING = 'pending',
  /** 好友：双方互为好友，可以发送任务消息 */
  FRIEND = 'friend',
  /** 已拉黑：被拉黑，无法发送任何消息 */
  BLOCKED = 'blocked',
}

// ============================================================================
// 联系人信息接口
// ============================================================================

/**
 * 联系人能力信息
 */
export interface ContactCapability {
  /** 能力名称 */
  name: string;
  /** 能力描述 */
  description?: string;
  /** 支持的工具列表 */
  tools?: string[];
}

/**
 * 联系人信息
 * 
 * 存储在通讯录中的联系人详细信息
 */
export interface Contact {
  /** 联系人 ID（通常是 PeerID） */
  id: string;
  /** Agent 显示名称 */
  name: string;
  /** Peer ID（libp2p 格式） */
  peerId: string;
  /** Agent ID（可选，独立于 PeerID） */
  agentId?: string;
  /** 好友状态 */
  status: FriendStatus;
  /** 能力列表 */
  capabilities: ContactCapability[];
  /** 信誉分数 (0-100) */
  reputation: number;
  /** 分组列表 */
  groups: string[];
  /** 标签列表 */
  tags: string[];
  /** 最后通信时间（Unix 时间戳毫秒） */
  lastCommunicationTime: number;
  /** 创建时间（Unix 时间戳毫秒） */
  createdAt: number;
  /** 更新时间（Unix 时间戳毫秒） */
  updatedAt: number;
  /** 备注信息 */
  notes?: string;
  /** 网络地址列表 */
  multiaddrs?: string[];
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 联系人创建参数
 */
export interface ContactCreateParams {
  /** Agent 显示名称 */
  name: string;
  /** Peer ID */
  peerId: string;
  /** Agent ID（可选） */
  agentId?: string;
  /** 能力列表 */
  capabilities?: ContactCapability[];
  /** 信誉分数（默认 0） */
  reputation?: number;
  /** 分组列表 */
  groups?: string[];
  /** 标签列表 */
  tags?: string[];
  /** 备注信息 */
  notes?: string;
  /** 网络地址 */
  multiaddrs?: string[];
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 联系人更新参数
 */
export interface ContactUpdateParams {
  /** Agent 显示名称 */
  name?: string;
  /** 能力列表 */
  capabilities?: ContactCapability[];
  /** 信誉分数 */
  reputation?: number;
  /** 好友状态 */
  status?: FriendStatus;
  /** 分组列表（覆盖） */
  groups?: string[];
  /** 标签列表（覆盖） */
  tags?: string[];
  /** 备注信息 */
  notes?: string;
  /** 网络地址 */
  multiaddrs?: string[];
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
  /** 更新最后通信时间 */
  updateLastCommunication?: boolean;
}

// ============================================================================
// 分组接口
// ============================================================================

/**
 * 联系人分组
 */
export interface ContactGroup {
  /** 分组 ID */
  id: string;
  /** 分组名称 */
  name: string;
  /** 分组描述 */
  description?: string;
  /** 分组颜色（十六进制） */
  color?: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 分组创建参数
 */
export interface GroupCreateParams {
  /** 分组名称 */
  name: string;
  /** 分组描述 */
  description?: string;
  /** 分组颜色 */
  color?: string;
}

// ============================================================================
// 握手协议接口
// ============================================================================

/**
 * 握手请求
 */
export interface HandshakeRequest {
  /** 请求 ID */
  requestId: string;
  /** 发送方 Peer ID */
  from: string;
  /** 发送方名称 */
  fromName: string;
  /** 发送方能力列表 */
  capabilities: ContactCapability[];
  /** 时间戳 */
  timestamp: number;
  /** 附加消息 */
  message?: string;
}

/**
 * 握手响应
 */
export interface HandshakeResponse {
  /** 请求 ID */
  requestId: string;
  /** 响应方 Peer ID */
  from: string;
  /** 是否接受 */
  accepted: boolean;
  /** 响应方名称 */
  fromName?: string;
  /** 响应方能力列表 */
  capabilities?: ContactCapability[];
  /** 时间戳 */
  timestamp: number;
  /** 拒绝原因（如果拒绝） */
  reason?: string;
}

/**
 * 待处理的握手请求
 */
export interface PendingHandshake {
  /** 请求 ID */
  requestId: string;
  /** 发送方 Peer ID */
  from: string;
  /** 发送方名称 */
  fromName: string;
  /** 发送方能力列表 */
  capabilities: ContactCapability[];
  /** 收到时间 */
  receivedAt: number;
  /** 附加消息 */
  message?: string;
}

// ============================================================================
// 通讯录数据结构
// ============================================================================

/**
 * 通讯录数据结构（用于持久化）
 */
export interface ContactsData {
  /** 版本号 */
  version: number;
  /** 联系人列表 */
  contacts: Contact[];
  /** 分组列表 */
  groups: ContactGroup[];
  /** 待处理的握手请求 */
  pendingHandshakes: PendingHandshake[];
  /** 黑名单（Peer ID 列表） */
  blockedPeers: string[];
  /** 最后更新时间 */
  lastUpdated: number;
}

// ============================================================================
// 导入/导出接口
// ============================================================================

/**
 * 通讯录导出数据
 */
export interface ContactsExport extends ContactsData {
  /** 导出时间 */
  exportedAt: number;
  /** 导出来源（节点 ID） */
  exportedBy?: string;
}

/**
 * 通讯录导入结果
 */
export interface ContactsImportResult {
  /** 是否成功 */
  success: boolean;
  /** 导入的联系人数量 */
  importedContacts: number;
  /** 导入的分组数量 */
  importedGroups: number;
  /** 跳过的联系人数量（已存在） */
  skippedContacts: number;
  /** 错误信息 */
  errors: string[];
}

// ============================================================================
// 查询接口
// ============================================================================

/**
 * 联系人查询过滤器
 */
export interface ContactFilter {
  /** 按名称模糊搜索 */
  name?: string;
  /** 按好友状态过滤 */
  status?: FriendStatus | FriendStatus[];
  /** 按分组过滤 */
  group?: string;
  /** 按标签过滤 */
  tags?: string[];
  /** 最低信誉分数 */
  minReputation?: number;
  /** 最高信誉分数 */
  maxReputation?: number;
  /** 按能力过滤 */
  capability?: string;
}

/**
 * 联系人排序选项
 */
export interface ContactSortOptions {
  /** 排序字段 */
  field: 'name' | 'reputation' | 'lastCommunicationTime' | 'createdAt';
  /** 排序方向 */
  order: 'asc' | 'desc';
}

// ============================================================================
// 事件接口
// ============================================================================

/**
 * 联系人事件类型
 */
export type ContactEventType = 
  | 'contact:added'
  | 'contact:updated'
  | 'contact:removed'
  | 'group:created'
  | 'group:updated'
  | 'group:deleted'
  | 'handshake:request'
  | 'handshake:accepted'
  | 'handshake:rejected';

/**
 * 联系人事件处理器
 */
export type ContactEventHandler = (event: ContactEventType, data: unknown) => void;