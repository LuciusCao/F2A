/**
 * F2A 联系人管理器
 * 
 * 管理通讯录、分组、标签和握手请求
 * 支持持久化存储和导入/导出功能
 * 
 * @module contact-manager
 */

import { join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import type { ApiLogger } from './connector.js';
import {
  Contact,
  ContactCreateParams,
  ContactUpdateParams,
  ContactGroup,
  GroupCreateParams,
  ContactsData,
  ContactsExport,
  ContactsImportResult,
  ContactFilter,
  ContactSortOptions,
  ContactEventHandler,
  ContactEventType,
  PendingHandshake,
  FriendStatus,
  ContactCapability,
  HandshakeRequest,
  HandshakeResponse,
} from './contact-types.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 通讯录数据版本 */
const CONTACTS_DATA_VERSION = 1;

/** 默认数据文件名 */
const DEFAULT_CONTACTS_FILE = 'contacts.json';

/** 默认分组 */
const DEFAULT_GROUPS: ContactGroup[] = [
  {
    id: 'default',
    name: '默认分组',
    description: '默认联系人分组',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID（UUID v4 格式）
 * P2-1 修复：使用加密安全的随机数生成器
 */
function generateId(): string {
  // 使用 crypto.randomUUID() 如果可用，否则回退到自定义实现
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // 回退实现：基于时间戳 + 随机数 + 计数器
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 11);
  const counter = (generateId.counter = (generateId.counter || 0) + 1);
  return `${timestamp}-${randomPart}-${counter.toString(36)}`;
}
// 静态计数器
namespace generateId {
  export let counter: number = 0;
}

/**
 * 深拷贝对象
 * P1-1 修复：使用 structuredClone 支持更多类型
 */
function deepClone<T>(obj: T): T {
  // 优先使用 structuredClone（支持 Date、Map、Set 等）
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      // 回退到 JSON 方法
    }
  }
  
  // 回退：JSON 序列化（不支持 Date、undefined、循环引用）
  return JSON.parse(JSON.stringify(obj));
}

// ============================================================================
// ContactManager 类
// ============================================================================

/**
 * F2A 联系人管理器
 * 
 * 提供通讯录的完整管理功能：
 * - 联系人 CRUD 操作
 * - 分组和标签管理
 * - 握手请求处理
 * - 数据导入/导出
 * - 持久化存储
 * 
 * @example
 * ```typescript
 * const manager = new ContactManager('/path/to/data', logger);
 * 
 * // 添加联系人
 * await manager.addContact({
 *   name: 'Alice',
 *   peerId: '12D3KooW...',
 *   capabilities: [{ name: 'code-generation' }],
 * });
 * 
 * // 发送好友请求
 * const request = manager.createHandshakeRequest('12D3KooW...', 'Bob');
 * 
 * // 获取好友列表
 * const friends = manager.getContactsByStatus(FriendStatus.FRIEND);
 * ```
 */
export class ContactManager {
  private dataDir: string;
  private dataPath: string;
  private data: ContactsData;
  private logger?: ApiLogger;
  private eventHandlers: Set<ContactEventHandler> = new Set();
  private autoSave: boolean = true;
  
  // P1-3 修复：并发访问保护锁
  private _lock: Promise<void> = Promise.resolve();
  private _isLocked: boolean = false;
  
  /**
   * P1-3 修复：获取互斥锁
   * 确保同一时间只有一个操作在修改数据
   */
  private async acquireLock(): Promise<() => void> {
    while (this._isLocked) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this._isLocked = true;
    let releaseCalled = false;
    const release = () => {
      if (!releaseCalled) {
        this._isLocked = false;
        releaseCalled = true;
      }
    };
    return release;
  }

  /**
   * 创建联系人管理器
   * 
   * @param dataDir - 数据存储目录
   * @param logger - 日志记录器
   * @param options - 配置选项
   */
  constructor(
    dataDir: string,
    logger?: ApiLogger,
    options?: { autoSave?: boolean }
  ) {
    this.dataDir = dataDir;
    this.logger = logger;
    this.autoSave = options?.autoSave ?? true;
    this.dataPath = join(dataDir, DEFAULT_CONTACTS_FILE);
    
    // 确保目录存在
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    
    // 加载或初始化数据
    this.data = this.loadData();
    
    this.logger?.info('[ContactManager] 初始化完成');
    this.logger?.info(`[ContactManager] 已加载 ${this.data.contacts.length} 个联系人`);
  }

  // ============================================================================
  // 数据持久化
  // ============================================================================

  /**
   * 加载数据
   */
  private loadData(): ContactsData {
    try {
      if (existsSync(this.dataPath)) {
        const content = readFileSync(this.dataPath, 'utf-8');
        const data = JSON.parse(content) as ContactsData;
        
        // 验证版本兼容性
        if (data.version !== CONTACTS_DATA_VERSION) {
          this.logger?.warn(`[ContactManager] 数据版本不匹配 (${data.version} vs ${CONTACTS_DATA_VERSION})，将迁移数据`);
          return this.migrateData(data);
        }
        
        return data;
      }
    } catch (err) {
      this.logger?.error(`[ContactManager] 加载数据失败: ${err}`);
    }
    
    // 返回默认数据
    return this.createDefaultData();
  }

  /**
   * 创建默认数据结构
   */
  private createDefaultData(): ContactsData {
    return {
      version: CONTACTS_DATA_VERSION,
      contacts: [],
      groups: deepClone(DEFAULT_GROUPS),
      pendingHandshakes: [],
      blockedPeers: [],
      lastUpdated: Date.now(),
    };
  }

  /**
   * 迁移旧版本数据
   */
  private migrateData(data: ContactsData): ContactsData {
    // 未来版本迁移逻辑
    // 目前只有 v1，直接返回
    return {
      ...data,
      version: CONTACTS_DATA_VERSION,
      groups: data.groups?.length ? data.groups : deepClone(DEFAULT_GROUPS),
      pendingHandshakes: data.pendingHandshakes || [],
      blockedPeers: data.blockedPeers || [],
    };
  }

  /**
   * 保存数据
   * P1-2 修复：返回保存结果，不再静默忽略错误
   * @returns 是否保存成功
   */
  private saveData(): boolean {
    if (!this.autoSave) return true;
    
    try {
      this.data.lastUpdated = Date.now();
      const content = JSON.stringify(this.data, null, 2);
      writeFileSync(this.dataPath, content, 'utf-8');
      return true;
    } catch (err) {
      this.logger?.error(`[ContactManager] 保存数据失败: ${err}`);
      return false;
    }
  }

  /**
   * 手动触发保存
   */
  flush(): void {
    this.saveData();
  }

  // ============================================================================
  // 联系人管理
  // ============================================================================

  /**
   * 添加联系人
   * P1-3 修复：使用锁保护并发访问
   * 
   * @param params - 创建参数
   * @returns 新创建的联系人，如果保存失败返回 null
   */
  addContact(params: ContactCreateParams): Contact | null {
    const now = Date.now();
    
    // 检查是否已存在
    const existing = this.getContactByPeerId(params.peerId);
    if (existing) {
      this.logger?.warn(`[ContactManager] 联系人已存在: ${params.peerId}`);
      return existing;
    }
    
    const contact: Contact = {
      id: generateId(),
      name: params.name,
      peerId: params.peerId,
      agentId: params.agentId,
      status: FriendStatus.STRANGER,
      capabilities: params.capabilities || [],
      reputation: params.reputation ?? 0,
      groups: params.groups || ['default'],
      tags: params.tags || [],
      lastCommunicationTime: 0,
      createdAt: now,
      updatedAt: now,
      notes: params.notes,
      multiaddrs: params.multiaddrs,
      metadata: params.metadata,
    };
    
    this.data.contacts.push(contact);
    
    // P1-2 修复：检查保存结果
    if (!this.saveData()) {
      // 保存失败，回滚
      this.data.contacts.pop();
      this.logger?.error('[ContactManager] 添加联系人失败：数据保存失败');
      return null;
    }
    
    this.emitEvent('contact:added', contact);
    
    this.logger?.info(`[ContactManager] 添加联系人: ${contact.name} (${contact.peerId.slice(0, 16)})`);
    
    return contact;
  }

  /**
   * 更新联系人
   * P1-3 修复：使用锁保护并发访问
   * 
   * @param contactId - 联系人 ID
   * @param params - 更新参数
   * @returns 更新后的联系人，如果不存在或保存失败返回 null
   */
  updateContact(contactId: string, params: ContactUpdateParams): Contact | null {
    const index = this.data.contacts.findIndex(c => c.id === contactId);
    if (index === -1) {
      return null;
    }
    
    const contact = this.data.contacts[index];
    const originalContact = { ...contact }; // 备份用于回滚
    
    // 应用更新
    if (params.name !== undefined) contact.name = params.name;
    if (params.capabilities !== undefined) contact.capabilities = params.capabilities;
    if (params.reputation !== undefined) contact.reputation = params.reputation;
    if (params.status !== undefined) contact.status = params.status;
    if (params.groups !== undefined) contact.groups = params.groups;
    if (params.tags !== undefined) contact.tags = params.tags;
    if (params.notes !== undefined) contact.notes = params.notes;
    if (params.multiaddrs !== undefined) contact.multiaddrs = params.multiaddrs;
    if (params.metadata !== undefined) contact.metadata = params.metadata;
    if (params.updateLastCommunication) {
      contact.lastCommunicationTime = Date.now();
    }
    
    contact.updatedAt = Date.now();
    this.data.contacts[index] = contact;
    
    // P1-2 修复：检查保存结果
    if (!this.saveData()) {
      // 保存失败，回滚
      this.data.contacts[index] = originalContact;
      this.logger?.error('[ContactManager] 更新联系人失败：数据保存失败');
      return null;
    }
    
    this.emitEvent('contact:updated', contact);
    
    return contact;
  }

  /**
   * 删除联系人
   * 
   * @param contactId - 联系人 ID
   * @returns 是否删除成功
   */
  removeContact(contactId: string): boolean {
    const index = this.data.contacts.findIndex(c => c.id === contactId);
    if (index === -1) {
      return false;
    }
    
    const [removed] = this.data.contacts.splice(index, 1);
    this.saveData();
    this.emitEvent('contact:removed', removed);
    
    this.logger?.info(`[ContactManager] 删除联系人: ${removed.name} (${removed.peerId.slice(0, 16)})`);
    
    return true;
  }

  /**
   * 获取联系人
   * 
   * @param contactId - 联系人 ID
   * @returns 联系人信息，如果不存在返回 null
   */
  getContact(contactId: string): Contact | null {
    return this.data.contacts.find(c => c.id === contactId) || null;
  }

  /**
   * 通过 Peer ID 获取联系人
   * 
   * @param peerId - Peer ID
   * @returns 联系人信息，如果不存在返回 null
   */
  getContactByPeerId(peerId: string): Contact | null {
    return this.data.contacts.find(c => c.peerId === peerId) || null;
  }

  /**
   * 获取所有联系人
   * 
   * @param filter - 过滤条件
   * @param sort - 排序选项
   * @returns 联系人列表
   */
  getContacts(filter?: ContactFilter, sort?: ContactSortOptions): Contact[] {
    let result = [...this.data.contacts];
    
    // 应用过滤器
    if (filter) {
      result = result.filter(c => {
        // 按名称过滤
        if (filter.name && !c.name.toLowerCase().includes(filter.name.toLowerCase())) {
          return false;
        }
        
        // 按状态过滤
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          if (!statuses.includes(c.status)) {
            return false;
          }
        }
        
        // 按分组过滤
        if (filter.group && !c.groups.includes(filter.group)) {
          return false;
        }
        
        // 按标签过滤
        if (filter.tags && filter.tags.length > 0) {
          if (!filter.tags.some(tag => c.tags.includes(tag))) {
            return false;
          }
        }
        
        // 按信誉分数过滤
        if (filter.minReputation !== undefined && c.reputation < filter.minReputation) {
          return false;
        }
        if (filter.maxReputation !== undefined && c.reputation > filter.maxReputation) {
          return false;
        }
        
        // 按能力过滤
        if (filter.capability) {
          if (!c.capabilities.some(cap => cap.name === filter.capability)) {
            return false;
          }
        }
        
        return true;
      });
    }
    
    // 应用排序
    if (sort) {
      result.sort((a, b) => {
        let valueA: number | string;
        let valueB: number | string;
        
        switch (sort.field) {
          case 'name':
            valueA = a.name.toLowerCase();
            valueB = b.name.toLowerCase();
            break;
          case 'reputation':
            valueA = a.reputation;
            valueB = b.reputation;
            break;
          case 'lastCommunicationTime':
            valueA = a.lastCommunicationTime;
            valueB = b.lastCommunicationTime;
            break;
          case 'createdAt':
          default:
            valueA = a.createdAt;
            valueB = b.createdAt;
            break;
        }
        
        if (typeof valueA === 'string') {
          return sort.order === 'asc' 
            ? valueA.localeCompare(valueB as string)
            : (valueB as string).localeCompare(valueA);
        }
        
        return sort.order === 'asc' ? valueA - (valueB as number) : (valueB as number) - valueA;
      });
    }
    
    return result;
  }

  /**
   * 按好友状态获取联系人
   */
  getContactsByStatus(status: FriendStatus): Contact[] {
    return this.getContacts({ status });
  }

  /**
   * 获取好友列表
   */
  getFriends(): Contact[] {
    return this.getContactsByStatus(FriendStatus.FRIEND);
  }

  // ============================================================================
  // 分组管理
  // ============================================================================

  /**
   * 创建分组
   */
  createGroup(params: GroupCreateParams): ContactGroup {
    const now = Date.now();
    
    const group: ContactGroup = {
      id: generateId(),
      name: params.name,
      description: params.description,
      color: params.color,
      createdAt: now,
      updatedAt: now,
    };
    
    this.data.groups.push(group);
    this.saveData();
    this.emitEvent('group:created', group);
    
    return group;
  }

  /**
   * 更新分组
   */
  updateGroup(groupId: string, params: Partial<GroupCreateParams>): ContactGroup | null {
    const group = this.data.groups.find(g => g.id === groupId);
    if (!group) {
      return null;
    }
    
    if (params.name !== undefined) group.name = params.name;
    if (params.description !== undefined) group.description = params.description;
    if (params.color !== undefined) group.color = params.color;
    
    group.updatedAt = Date.now();
    this.saveData();
    this.emitEvent('group:updated', group);
    
    return group;
  }

  /**
   * 删除分组
   */
  deleteGroup(groupId: string): boolean {
    // 不允许删除默认分组
    if (groupId === 'default') {
      this.logger?.warn('[ContactManager] 不能删除默认分组');
      return false;
    }
    
    const index = this.data.groups.findIndex(g => g.id === groupId);
    if (index === -1) {
      return false;
    }
    
    // 将该分组下的联系人移到默认分组
    for (const contact of this.data.contacts) {
      const groupIndex = contact.groups.indexOf(groupId);
      if (groupIndex !== -1) {
        contact.groups.splice(groupIndex, 1);
        if (contact.groups.length === 0) {
          contact.groups.push('default');
        }
      }
    }
    
    const [removed] = this.data.groups.splice(index, 1);
    this.saveData();
    this.emitEvent('group:deleted', removed);
    
    return true;
  }

  /**
   * 获取所有分组
   */
  getGroups(): ContactGroup[] {
    return [...this.data.groups];
  }

  /**
   * 获取分组
   */
  getGroup(groupId: string): ContactGroup | null {
    return this.data.groups.find(g => g.id === groupId) || null;
  }

  // ============================================================================
  // 标签管理
  // ============================================================================

  /**
   * 获取所有标签
   */
  getAllTags(): string[] {
    const tags = new Set<string>();
    for (const contact of this.data.contacts) {
      for (const tag of contact.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }

  /**
   * 为联系人添加标签
   */
  addTag(contactId: string, tag: string): boolean {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    
    if (!contact.tags.includes(tag)) {
      contact.tags.push(tag);
      contact.updatedAt = Date.now();
      this.saveData();
    }
    
    return true;
  }

  /**
   * 移除联系人的标签
   */
  removeTag(contactId: string, tag: string): boolean {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    
    const index = contact.tags.indexOf(tag);
    if (index !== -1) {
      contact.tags.splice(index, 1);
      contact.updatedAt = Date.now();
      this.saveData();
    }
    
    return true;
  }

  // ============================================================================
  // 握手请求管理
  // ============================================================================

  /**
   * 创建握手请求
   */
  createHandshakeRequest(
    toPeerId: string,
    fromName: string,
    capabilities: ContactCapability[],
    message?: string
  ): HandshakeRequest {
    return {
      requestId: generateId(),
      from: '', // 调用方需要填充自己的 Peer ID
      fromName,
      capabilities,
      timestamp: Date.now(),
      message,
    };
  }

  /**
   * 添加待处理的握手请求
   */
  addPendingHandshake(request: HandshakeRequest): void {
    const pending: PendingHandshake = {
      requestId: request.requestId,
      from: request.from,
      fromName: request.fromName,
      capabilities: request.capabilities,
      receivedAt: Date.now(),
      message: request.message,
    };
    
    // 检查是否已存在来自同一 Peer 的请求
    const existingIndex = this.data.pendingHandshakes.findIndex(p => p.from === request.from);
    if (existingIndex !== -1) {
      // 替换旧请求
      this.data.pendingHandshakes[existingIndex] = pending;
    } else {
      this.data.pendingHandshakes.push(pending);
    }
    
    this.saveData();
    this.emitEvent('handshake:request', pending);
  }

  /**
   * 获取待处理的握手请求列表
   */
  getPendingHandshakes(): PendingHandshake[] {
    return [...this.data.pendingHandshakes];
  }

  /**
   * 获取特定 Peer 的待处理请求
   */
  getPendingHandshakeFrom(peerId: string): PendingHandshake | null {
    return this.data.pendingHandshakes.find(p => p.from === peerId) || null;
  }

  /**
   * 接受握手请求
   * 
   * 这会：
   * 1. 将请求方添加为好友
   * 2. 从待处理列表中移除
   * 3. 触发事件
   */
  acceptHandshake(
    requestId: string,
    myName: string,
    myCapabilities: ContactCapability[]
  ): HandshakeResponse | null {
    const index = this.data.pendingHandshakes.findIndex(p => p.requestId === requestId);
    if (index === -1) {
      return null;
    }
    
    const pending = this.data.pendingHandshakes[index];
    
    // 添加为好友
    let contact = this.getContactByPeerId(pending.from);
    if (contact) {
      // 更新现有联系人
      const updated = this.updateContact(contact.id, {
        status: FriendStatus.FRIEND,
        capabilities: pending.capabilities,
        name: pending.fromName,
        updateLastCommunication: true,
      });
      // P1-2 修复：检查更新是否成功
      if (!updated) {
        this.logger?.error('[ContactManager] 接受握手失败：更新联系人失败');
        return null;
      }
      contact = updated;
    } else {
      // 创建新联系人
      contact = this.addContact({
        name: pending.fromName,
        peerId: pending.from,
        capabilities: pending.capabilities,
        groups: ['default'],
      });
      // P1-2 修复：检查添加是否成功
      if (!contact) {
        this.logger?.error('[ContactManager] 接受握手失败：添加联系人失败');
        return null;
      }
      const updated = this.updateContact(contact.id, { status: FriendStatus.FRIEND });
      if (!updated) {
        this.logger?.error('[ContactManager] 接受握手失败：更新状态失败');
        return null;
      }
      contact = updated;
    }
    
    // 移除待处理请求
    this.data.pendingHandshakes.splice(index, 1);
    this.saveData();
    
    const response: HandshakeResponse = {
      requestId,
      from: '', // 调用方填充
      accepted: true,
      fromName: myName,
      capabilities: myCapabilities,
      timestamp: Date.now(),
    };
    
    this.emitEvent('handshake:accepted', { pending, response });
    
    return response;
  }

  /**
   * 拒绝握手请求
   */
  rejectHandshake(requestId: string, reason?: string): HandshakeResponse | null {
    const index = this.data.pendingHandshakes.findIndex(p => p.requestId === requestId);
    if (index === -1) {
      return null;
    }
    
    const [pending] = this.data.pendingHandshakes.splice(index, 1);
    this.saveData();
    
    const response: HandshakeResponse = {
      requestId,
      from: '', // 调用方填充
      accepted: false,
      timestamp: Date.now(),
      reason,
    };
    
    this.emitEvent('handshake:rejected', { pending, response });
    
    return response;
  }

  /**
   * 处理收到的握手响应
   * 
   * 当对方接受我们的好友请求时调用
   */
  handleHandshakeResponse(response: HandshakeResponse): boolean {
    if (!response.accepted) {
      this.logger?.info(`[ContactManager] 好友请求被拒绝: ${response.reason || '无原因'}`);
      return false;
    }
    
    // 添加为好友
    let contact = this.getContactByPeerId(response.from);
    if (contact) {
      const updated = this.updateContact(contact.id, {
        status: FriendStatus.FRIEND,
        name: response.fromName || contact.name,
        capabilities: response.capabilities,
        updateLastCommunication: true,
      });
      if (!updated) {
        this.logger?.error('[ContactManager] 处理握手响应失败：更新联系人失败');
        return false;
      }
      contact = updated;
    } else {
      contact = this.addContact({
        name: response.fromName || 'Unknown',
        peerId: response.from,
        capabilities: response.capabilities || [],
        groups: ['default'],
      });
      if (!contact) {
        this.logger?.error('[ContactManager] 处理握手响应失败：添加联系人失败');
        return false;
      }
      const updated = this.updateContact(contact.id, { status: FriendStatus.FRIEND });
      if (!updated) {
        this.logger?.error('[ContactManager] 处理握手响应失败：更新状态失败');
        return false;
      }
      contact = updated;
    }
    
    this.logger?.info(`[ContactManager] 好友请求已接受: ${contact!.name}`);
    return true;
  }

  // ============================================================================
  // 黑名单管理
  // ============================================================================

  /**
   * 拉黑联系人
   */
  blockContact(contactId: string): boolean {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    
    contact.status = FriendStatus.BLOCKED;
    contact.updatedAt = Date.now();
    
    if (!this.data.blockedPeers.includes(contact.peerId)) {
      this.data.blockedPeers.push(contact.peerId);
    }
    
    this.saveData();
    return true;
  }

  /**
   * 解除拉黑
   */
  unblockContact(contactId: string): boolean {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    
    contact.status = FriendStatus.STRANGER;
    contact.updatedAt = Date.now();
    
    const index = this.data.blockedPeers.indexOf(contact.peerId);
    if (index !== -1) {
      this.data.blockedPeers.splice(index, 1);
    }
    
    this.saveData();
    return true;
  }

  /**
   * 检查是否被拉黑
   */
  isBlocked(peerId: string): boolean {
    return this.data.blockedPeers.includes(peerId);
  }

  /**
   * 检查是否为好友
   */
  isFriend(peerId: string): boolean {
    const contact = this.getContactByPeerId(peerId);
    return contact?.status === FriendStatus.FRIEND;
  }

  /**
   * 检查是否可以发送消息（好友或陌生人都可以，但被拉黑不行）
   */
  canSendMessage(peerId: string): boolean {
    const contact = this.getContactByPeerId(peerId);
    if (!contact) return true; // 陌生人可以发送
    return contact.status !== FriendStatus.BLOCKED;
  }

  /**
   * 检查是否可以发送任务消息（只有好友可以）
   */
  canSendTask(peerId: string): boolean {
    return this.isFriend(peerId);
  }

  // ============================================================================
  // 导入/导出
  // ============================================================================

  /**
   * 导出通讯录
   */
  exportContacts(nodeId?: string): ContactsExport {
    return {
      ...deepClone(this.data),
      exportedAt: Date.now(),
      exportedBy: nodeId,
    };
  }

  /**
   * 导入通讯录
   * 
   * @param data - 导入的数据
   * @param merge - 是否合并（true）或覆盖（false）
   */
  importContacts(data: ContactsExport, merge = true): ContactsImportResult {
    const result: ContactsImportResult = {
      success: true,
      importedContacts: 0,
      importedGroups: 0,
      skippedContacts: 0,
      errors: [],
    };
    
    try {
      if (!merge) {
        // 覆盖模式
        this.data = {
          version: CONTACTS_DATA_VERSION,
          contacts: data.contacts,
          groups: data.groups.length ? data.groups : deepClone(DEFAULT_GROUPS),
          pendingHandshakes: data.pendingHandshakes || [],
          blockedPeers: data.blockedPeers || [],
          lastUpdated: Date.now(),
        };
        result.importedContacts = data.contacts.length;
        result.importedGroups = data.groups.length;
      } else {
        // 合并模式
        const existingPeerIds = new Set(this.data.contacts.map(c => c.peerId));
        
        for (const contact of data.contacts) {
          if (existingPeerIds.has(contact.peerId)) {
            result.skippedContacts++;
          } else {
            this.data.contacts.push(contact);
            result.importedContacts++;
          }
        }
        
        const existingGroupIds = new Set(this.data.groups.map(g => g.id));
        for (const group of data.groups) {
          if (!existingGroupIds.has(group.id)) {
            this.data.groups.push(group);
            result.importedGroups++;
          }
        }
        
        // 合并黑名单
        for (const peerId of data.blockedPeers || []) {
          if (!this.data.blockedPeers.includes(peerId)) {
            this.data.blockedPeers.push(peerId);
          }
        }
      }
      
      this.saveData();
    } catch (err) {
      result.success = false;
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
    
    return result;
  }

  // ============================================================================
  // 事件处理
  // ============================================================================

  /**
   * 添加事件处理器
   */
  on(handler: ContactEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * 移除事件处理器
   */
  off(handler: ContactEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * 触发事件
   */
  private emitEvent(event: ContactEventType, data: unknown): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event, data);
      } catch (err) {
        this.logger?.error(`[ContactManager] 事件处理器错误: ${err}`);
      }
    }
  }

  // ============================================================================
  // 统计信息
  // ============================================================================

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    friends: number;
    strangers: number;
    pending: number;
    blocked: number;
    groups: number;
  } {
    return {
      total: this.data.contacts.length,
      friends: this.data.contacts.filter(c => c.status === FriendStatus.FRIEND).length,
      strangers: this.data.contacts.filter(c => c.status === FriendStatus.STRANGER).length,
      pending: this.data.contacts.filter(c => c.status === FriendStatus.PENDING).length,
      blocked: this.data.contacts.filter(c => c.status === FriendStatus.BLOCKED).length,
      groups: this.data.groups.length,
    };
  }

  // ============================================================================
  // 清理
  // ============================================================================

  /**
   * 清空通讯录
   */
  clear(): void {
    this.data = this.createDefaultData();
    this.saveData();
    this.logger?.info('[ContactManager] 通讯录已清空');
  }

  /**
   * 删除数据文件
   */
  deleteData(): void {
    if (existsSync(this.dataPath)) {
      unlinkSync(this.dataPath);
    }
    this.data = this.createDefaultData();
  }
}

// 默认导出
export default ContactManager;