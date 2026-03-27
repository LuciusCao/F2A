/**
 * F2A 联系人管理器
 * 
 * 管理通讯录、分组、标签和握手请求
 * 支持持久化存储和导入/导出功能
 * 
 * ⚠️ 并发安全说明
 * 
 * ContactManager 不是线程安全的。在 Node.js 单线程事件循环环境下，
 * 只要避免在同一个事件循环 tick 内发起多个修改操作，就是安全的。
 * 
 * 如果需要在多进程/集群环境下使用，请使用外部锁服务（如 Redis）。
 * 
 * @module contact-manager
 */

import { join, resolve, normalize } from 'path';
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

/** P1-4 修复：最大联系人数量限制 */
const MAX_CONTACTS = 10000;

/** P1-4 修复：导入数据最大大小（字节） */
const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10MB

/** P2-1 修复：PeerID 格式正则（libp2p 格式：12D3KooW...） */
const PEER_ID_REGEX = /^12D3KooW[A-Za-z0-9]{44}$/;

/** P2-1 修复：名称最大长度 */
const MAX_NAME_LENGTH = 100;

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

  /**
   * P2-1 修复：验证 PeerID 格式
   * libp2p 格式：12D3KooW + 44 个 base58 字符
   */
  private validatePeerId(peerId: string): boolean {
    return PEER_ID_REGEX.test(peerId);
  }

  /**
   * P2-1 修复：验证名称
   * 限制长度，防止过长的名称
   */
  private validateName(name: string): boolean {
    return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH;
  }

  /**
   * P1-3 修复：验证联系人字段完整性
   * 用于导入数据验证
   */
  private validateContactFields(contact: unknown): contact is Contact {
    if (!contact || typeof contact !== 'object') return false;
    
    const c = contact as Partial<Contact>;
    
    // 必须字段
    if (typeof c.id !== 'string' || c.id.length === 0) return false;
    if (typeof c.name !== 'string' || !this.validateName(c.name)) return false;
    if (typeof c.peerId !== 'string' || c.peerId.length === 0) return false;
    
    // 可选字段类型检查
    if (c.agentId !== undefined && typeof c.agentId !== 'string') return false;
    if (c.status !== undefined && typeof c.status !== 'string') return false;
    if (c.reputation !== undefined && typeof c.reputation !== 'number') return false;
    if (c.notes !== undefined && typeof c.notes !== 'string') return false;
    if (c.createdAt !== undefined && typeof c.createdAt !== 'number') return false;
    if (c.updatedAt !== undefined && typeof c.updatedAt !== 'number') return false;
    if (c.lastCommunicationTime !== undefined && typeof c.lastCommunicationTime !== 'number') return false;
    
    // 数组字段检查
    if (c.capabilities !== undefined && !Array.isArray(c.capabilities)) return false;
    if (c.groups !== undefined && !Array.isArray(c.groups)) return false;
    if (c.tags !== undefined && !Array.isArray(c.tags)) return false;
    if (c.multiaddrs !== undefined && !Array.isArray(c.multiaddrs)) return false;
    
    return true;
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
    // P1-3 修复：验证 dataDir，防止路径遍历攻击
    if (!dataDir || typeof dataDir !== 'string') {
      throw new Error('[ContactManager] dataDir 必须是非空字符串');
    }
    
    // P1-3 修复：使用 path.resolve 和 path.normalize 规范化路径
    // 解析为绝对路径，消除 .. 和 . 符号
    const normalizedDataDir = resolve(normalize(dataDir));
    
    // 检查规范化后的路径是否仍在预期范围内
    // 如果路径包含 ..，规范化后应该被消除
    // 如果结果路径与原始路径差异过大，可能存在问题
    const originalNormalized = normalize(dataDir);
    if (originalNormalized !== normalizedDataDir && !dataDir.startsWith('/')) {
      logger?.warn(`[ContactManager] 路径被规范化: ${dataDir} -> ${normalizedDataDir}`);
    }
    
    // 检查路径遍历（规范化后的路径不应包含 ..）
    if (normalizedDataDir.includes('..')) {
      throw new Error('[ContactManager] dataDir 路径无效（路径遍历风险）');
    }
    
    this.dataDir = normalizedDataDir;
    this.logger = logger;
    this.autoSave = options?.autoSave ?? true;
    this.dataPath = join(normalizedDataDir, DEFAULT_CONTACTS_FILE);
    
    // 确保目录存在
    if (!existsSync(normalizedDataDir)) {
      mkdirSync(normalizedDataDir, { recursive: true });
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
   * P2-1 修复：添加输入验证
   * P1 修复：支持传入 status 参数
   * 
   * @param params - 创建参数
   * @returns 新创建的联系人，如果保存失败返回 null
   */
  addContact(params: ContactCreateParams): Contact | null {
    // P2-1 修复：验证输入
    if (!this.validateName(params.name)) {
      this.logger?.error('[ContactManager] 添加联系人失败：名称无效或过长');
      return null;
    }
    
    // P1-4 修复：PeerID 验证失败时拒绝添加联系人
    if (!this.validatePeerId(params.peerId)) {
      this.logger?.error(`[ContactManager] 添加联系人失败：PeerID 格式无效: ${params.peerId.slice(0, 16)}...`);
      return null;
    }
    
    // P1-1 修复：检查联系人数量限制
    if (this.data.contacts.length >= MAX_CONTACTS) {
      this.logger?.error(`[ContactManager] 联系人数量已达上限 (${MAX_CONTACTS})`);
      return null;
    }
    
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
      status: params.status ?? FriendStatus.STRANGER,  // P1 修复：支持传入 status，默认为 STRANGER
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
   * P2-1 修复：添加输入验证
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
    const originalContact = deepClone(contact); // P1 修复：使用深拷贝备份用于回滚
    
    // P2-1 修复：验证名称
    if (params.name !== undefined && !this.validateName(params.name)) {
      this.logger?.error('[ContactManager] 更新联系人失败：名称无效或过长');
      return null;
    }
    
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
   * P1-2 修复：添加保存检查和回滚
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
    
    // P1-2 修复：检查保存结果，失败时恢复联系人
    if (!this.saveData()) {
      // 保存失败，恢复联系人
      this.data.contacts.splice(index, 0, removed);
      this.logger?.error('[ContactManager] 删除联系人失败：数据保存失败');
      return false;
    }
    
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
   * P1-2 修复：添加保存检查和回滚
   */
  createGroup(params: GroupCreateParams): ContactGroup | null {
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
    
    // P1-2 修复：检查保存结果，失败时恢复
    if (!this.saveData()) {
      // 保存失败，回滚
      this.data.groups.pop();
      this.logger?.error('[ContactManager] 创建分组失败：数据保存失败');
      return null;
    }
    
    this.emitEvent('group:created', group);
    
    return group;
  }

  /**
   * 更新分组
   * P1-2 修复：添加保存检查和回滚
   */
  updateGroup(groupId: string, params: Partial<GroupCreateParams>): ContactGroup | null {
    const group = this.data.groups.find(g => g.id === groupId);
    if (!group) {
      return null;
    }
    
    // 备份原始数据用于回滚
    const originalGroup = { ...group };
    
    if (params.name !== undefined) group.name = params.name;
    if (params.description !== undefined) group.description = params.description;
    if (params.color !== undefined) group.color = params.color;
    
    group.updatedAt = Date.now();
    
    // P1-2 修复：检查保存结果，失败时恢复
    if (!this.saveData()) {
      // 保存失败，回滚
      Object.assign(group, originalGroup);
      this.logger?.error('[ContactManager] 更新分组失败：数据保存失败');
      return null;
    }
    
    this.emitEvent('group:updated', group);
    
    return group;
  }

  /**
   * 删除分组
   * P1-2 修复：添加保存检查和回滚
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
    
    // 备份受影响的联系人分组信息用于回滚
    const affectedContacts = this.data.contacts
      .filter(c => c.groups.includes(groupId))
      .map(c => ({ contact: c, originalGroups: [...c.groups] }));
    
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
    
    // P1-2 修复：检查保存结果，失败时恢复
    if (!this.saveData()) {
      // 保存失败，回滚
      this.data.groups.splice(index, 0, removed);
      for (const { contact, originalGroups } of affectedContacts) {
        contact.groups = originalGroups;
      }
      this.logger?.error('[ContactManager] 删除分组失败：数据保存失败');
      return false;
    }
    
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
   * P1-2 修复：在移除 pendingHandshakes 前检查 saveData
   * 
   * 这会：
   * 1. 将请求方添加为好友
   * 2. 从待处理列表中移除（仅在保存成功后）
   * 3. 触发事件
   * 
   * @returns 包含响应和对方 Peer ID 的对象，或 null
   */
  acceptHandshake(
    requestId: string,
    myName: string,
    myCapabilities: ContactCapability[]
  ): { response: HandshakeResponse; fromPeerId: string } | null {
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
      // P1 修复：创建新联系人时直接设置 status 为 FRIEND，避免状态不一致
      contact = this.addContact({
        name: pending.fromName,
        peerId: pending.from,
        capabilities: pending.capabilities,
        groups: ['default'],
        status: FriendStatus.FRIEND,  // 直接设置为好友
      });
      // 检查添加是否成功
      if (!contact) {
        this.logger?.error('[ContactManager] 接受握手失败：添加联系人失败');
        return null;
      }
      // 不再需要额外调用 updateContact 设置状态
    }
    
    // P1-2 修复：先保存数据，成功后再移除待处理请求
    // 这样如果保存失败，待处理请求仍然存在，可以重试
    if (!this.saveData()) {
      this.logger?.error('[ContactManager] 接受握手失败：保存数据失败');
      // 不移除 pendingHandshakes，允许重试
      return null;
    }
    
    // 保存成功，移除待处理请求
    this.data.pendingHandshakes.splice(index, 1);
    
    // 再次保存以记录 pendingHandshakes 的移除
    if (!this.saveData()) {
      this.logger?.warn('[ContactManager] 移除待处理请求后保存失败，但好友已添加');
      // 继续执行，因为好友已经添加成功
    }
    
    const response: HandshakeResponse = {
      requestId,
      from: '', // 调用方填充
      accepted: true,
      fromName: myName,
      capabilities: myCapabilities,
      timestamp: Date.now(),
    };
    
    this.emitEvent('handshake:accepted', { pending, response });
    
    return { response, fromPeerId: pending.from };
  }

  /**
   * 拒绝握手请求
   * P1-2 修复：在移除 pendingHandshakes 前检查 saveData
   * 
   * @returns 包含响应和对方 Peer ID 的对象，或 null
   */
  rejectHandshake(requestId: string, reason?: string): { response: HandshakeResponse; fromPeerId: string } | null {
    const index = this.data.pendingHandshakes.findIndex(p => p.requestId === requestId);
    if (index === -1) {
      return null;
    }
    
    const pending = this.data.pendingHandshakes[index];
    
    // P1-2 修复：先保存数据，确保状态持久化
    if (!this.saveData()) {
      this.logger?.error('[ContactManager] 拒绝握手失败：保存数据失败');
      return null;
    }
    
    // 保存成功后，移除待处理请求
    this.data.pendingHandshakes.splice(index, 1);
    
    // 再次保存以记录 pendingHandshakes 的移除
    if (!this.saveData()) {
      this.logger?.warn('[ContactManager] 移除待处理请求后保存失败');
      // 继续执行，因为主要操作已完成
    }
    
    const response: HandshakeResponse = {
      requestId,
      from: '', // 调用方填充
      accepted: false,
      timestamp: Date.now(),
      reason,
    };
    
    this.emitEvent('handshake:rejected', { pending, response });
    
    return { response, fromPeerId: pending.from };
  }

  /**
   * 处理收到的握手响应
   * P1 修复：添加 PeerID 验证，优化状态设置
   * 
   * 当对方接受我们的好友请求时调用
   */
  handleHandshakeResponse(response: HandshakeResponse): boolean {
    if (!response.accepted) {
      this.logger?.info(`[ContactManager] 好友请求被拒绝: ${response.reason || '无原因'}`);
      return false;
    }
    
    // P1 修复：验证 PeerID 格式
    if (!this.validatePeerId(response.from)) {
      this.logger?.warn(`[ContactManager] 无效的 PeerID 格式: ${response.from.slice(0, 16)}...`);
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
      // P1 修复：创建新联系人时直接设置 status 为 FRIEND
      contact = this.addContact({
        name: response.fromName || 'Unknown',
        peerId: response.from,
        capabilities: response.capabilities || [],
        groups: ['default'],
        status: FriendStatus.FRIEND,  // 直接设置为好友
      });
      if (!contact) {
        this.logger?.error('[ContactManager] 处理握手响应失败：添加联系人失败');
        return false;
      }
    }
    
    this.logger?.info(`[ContactManager] 好友请求已接受: ${contact!.name}`);
    return true;
  }

  // ============================================================================
  // 黑名单管理
  // ============================================================================

  /**
   * 拉黑联系人
   * P1-2 修复：添加保存检查和回滚
   */
  blockContact(contactId: string): boolean {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    
    // 备份原始状态用于回滚
    const originalStatus = contact.status;
    const wasBlocked = this.data.blockedPeers.includes(contact.peerId);
    
    contact.status = FriendStatus.BLOCKED;
    contact.updatedAt = Date.now();
    
    if (!this.data.blockedPeers.includes(contact.peerId)) {
      this.data.blockedPeers.push(contact.peerId);
    }
    
    // P1-2 修复：检查保存结果，失败时恢复
    if (!this.saveData()) {
      // 保存失败，回滚
      contact.status = originalStatus;
      contact.updatedAt = Date.now();
      if (!wasBlocked) {
        const index = this.data.blockedPeers.indexOf(contact.peerId);
        if (index !== -1) {
          this.data.blockedPeers.splice(index, 1);
        }
      }
      this.logger?.error('[ContactManager] 拉黑联系人失败：数据保存失败');
      return false;
    }
    
    return true;
  }

  /**
   * 解除拉黑
   * P1-2 修复：添加保存检查和回滚
   */
  unblockContact(contactId: string): boolean {
    const contact = this.getContact(contactId);
    if (!contact) return false;
    
    // 备份原始状态用于回滚
    const originalStatus = contact.status;
    const blockedIndex = this.data.blockedPeers.indexOf(contact.peerId);
    
    contact.status = FriendStatus.STRANGER;
    contact.updatedAt = Date.now();
    
    if (blockedIndex !== -1) {
      this.data.blockedPeers.splice(blockedIndex, 1);
    }
    
    // P1-2 修复：检查保存结果，失败时恢复
    if (!this.saveData()) {
      // 保存失败，回滚
      contact.status = originalStatus;
      contact.updatedAt = Date.now();
      if (blockedIndex !== -1) {
        this.data.blockedPeers.splice(blockedIndex, 0, contact.peerId);
      }
      this.logger?.error('[ContactManager] 解除拉黑失败：数据保存失败');
      return false;
    }
    
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
   * P1-4 修复：添加数据大小和联系人数量限制
   * P1-3 修复：验证每个联系人的字段
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
      // P1-4 修复：检查数据大小
      const dataSize = JSON.stringify(data).length;
      if (dataSize > MAX_IMPORT_SIZE) {
        result.success = false;
        result.errors.push(`数据大小超出限制: ${dataSize} > ${MAX_IMPORT_SIZE} 字节`);
        return result;
      }
      
      // P1-4 修复：检查联系人数量
      if (data.contacts && data.contacts.length > MAX_CONTACTS) {
        result.success = false;
        result.errors.push(`联系人数量超出限制: ${data.contacts.length} > ${MAX_CONTACTS}`);
        return result;
      }
      
      if (!merge) {
        // P1-3 修复：覆盖模式也要验证数据结构
        const validContacts: Contact[] = [];
        for (let i = 0; i < data.contacts.length; i++) {
          if (this.validateContactFields(data.contacts[i])) {
            validContacts.push(data.contacts[i]);
          } else {
            result.errors.push(`联系人 #${i + 1} 字段验证失败，已跳过`);
            result.skippedContacts++;
          }
        }
        
        // 覆盖模式
        this.data = {
          version: CONTACTS_DATA_VERSION,
          contacts: validContacts,
          groups: data.groups.length ? data.groups : deepClone(DEFAULT_GROUPS),
          pendingHandshakes: data.pendingHandshakes || [],
          blockedPeers: data.blockedPeers || [],
          lastUpdated: Date.now(),
        };
        result.importedContacts = validContacts.length;
        result.importedGroups = data.groups.length;
      } else {
        // 合并模式
        const existingPeerIds = new Set(this.data.contacts.map(c => c.peerId));
        
        // P1-4 修复：检查合并后的总数（使用验证后的有效联系人）
        const validContacts = data.contacts.filter(c => this.validateContactFields(c));
        const invalidCount = data.contacts.length - validContacts.length;
        if (invalidCount > 0) {
          result.errors.push(`${invalidCount} 个联系人字段验证失败，已跳过`);
          result.skippedContacts += invalidCount;
        }
        
        const totalAfterMerge = this.data.contacts.length + validContacts.filter(c => !existingPeerIds.has(c.peerId)).length;
        if (totalAfterMerge > MAX_CONTACTS) {
          result.success = false;
          result.errors.push(`合并后联系人数量超出限制: ${totalAfterMerge} > ${MAX_CONTACTS}`);
          return result;
        }
        
        for (const contact of validContacts) {
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