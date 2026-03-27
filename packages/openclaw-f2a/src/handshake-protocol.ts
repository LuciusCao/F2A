/**
 * F2A 握手协议处理器
 * 
 * 处理 Agent 之间的好友请求和握手流程
 * - 发送好友请求
 * - 接收和处理好友请求
 * - 接受/拒绝好友请求
 * - 管理好友状态
 * 
 * @module handshake-protocol
 */

import type { F2A } from '@f2a/network';
import { ContactManager } from './contact-manager.js';
import {
  FriendStatus,
  ContactCapability,
  HandshakeRequest,
  HandshakeResponse,
  PendingHandshake,
} from './contact-types.js';
import type { ApiLogger } from './connector.js';

// ============================================================================
// 常量定义
// ============================================================================

/** 握手协议消息类型 */
export const HANDSHAKE_MESSAGE_TYPES = {
  /** 好友请求 */
  FRIEND_REQUEST: 'FRIEND_REQUEST',
  /** 好友请求响应 */
  FRIEND_RESPONSE: 'FRIEND_RESPONSE',
} as const;

/** 握手请求超时时间（毫秒） */
const HANDSHAKE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

/** 重试配置 */
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 1000,
};

// ============================================================================
// 握手协议消息接口
// ============================================================================

/**
 * 好友请求消息
 */
export interface FriendRequestMessage {
  type: typeof HANDSHAKE_MESSAGE_TYPES.FRIEND_REQUEST;
  requestId: string;
  fromName: string;
  capabilities: ContactCapability[];
  timestamp: number;
  message?: string;
}

/**
 * 好友响应消息
 */
export interface FriendResponseMessage {
  type: typeof HANDSHAKE_MESSAGE_TYPES.FRIEND_RESPONSE;
  requestId: string;
  accepted: boolean;
  fromName?: string;
  capabilities?: ContactCapability[];
  timestamp: number;
  reason?: string;
}

// ============================================================================
// HandshakeProtocol 类
// ============================================================================

/**
 * 握手协议处理器
 * 
 * 管理 Agent 之间的好友关系建立流程：
 * 1. 发送好友请求
 * 2. 接收并处理好友请求
 * 3. 接受/拒绝好友请求
 * 4. 维护好友状态
 * 
 * 握手流程：
 * ```
 * Agent A                          Agent B
 *    |                                |
 *    |--- FRIEND_REQUEST ------------>|
 *    |                                | (添加到待处理列表)
 *    |                                | (通知用户)
 *    |<-- FRIEND_RESPONSE (accept) ---|
 *    | (双方互存通讯录)                |
 *    |                                |
 * ```
 * 
 * @example
 * ```typescript
 * const protocol = new HandshakeProtocol(f2a, contactManager, logger);
 * 
 * // 发送好友请求
 * await protocol.sendFriendRequest(peerId, 'Hi, I want to be friends');
 * 
 * // 处理收到的请求
 * protocol.on('request', (request) => {
 *   // 显示给用户确认
 * });
 * ```
 */
export class HandshakeProtocol {
  private f2a: F2A;
  private contactManager: ContactManager;
  private logger?: ApiLogger;
  private eventHandlers: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  
  /** 待响应的请求（我们发出的请求） */
  private outgoingRequests: Map<string, {
    request: HandshakeRequest;
    toPeerId: string;
    sentAt: number;
    timeout?: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(
    f2a: F2A,
    contactManager: ContactManager,
    logger?: ApiLogger
  ) {
    this.f2a = f2a;
    this.contactManager = contactManager;
    this.logger = logger;
    
    // 绑定消息处理器
    this.setupMessageHandler();
  }

  // ============================================================================
  // 初始化
  // ============================================================================

  /**
   * 设置消息处理器
   */
  private setupMessageHandler(): void {
    // 监听来自 F2A 的消息
    (this.f2a as any).on('message', async (msg: {
      from: string;
      content: string;
      metadata?: Record<string, unknown>;
      messageId: string;
    }) => {
      await this.handleMessage(msg.from, msg.content, msg.metadata);
    });
    
    this.logger?.info('[HandshakeProtocol] 消息处理器已设置');
  }

  // ============================================================================
  // 发送好友请求
  // ============================================================================

  /**
   * 发送好友请求
   * 
   * @param toPeerId - 目标 Peer ID
   * @param message - 附加消息
   * @returns 请求 ID，如果发送失败返回 null
   */
  async sendFriendRequest(
    toPeerId: string,
    message?: string
  ): Promise<string | null> {
    try {
      // 检查是否已是好友
      if (this.contactManager.isFriend(toPeerId)) {
        this.logger?.warn('[HandshakeProtocol] 对方已是好友');
        return null;
      }
      
      // 检查是否被拉黑
      if (this.contactManager.isBlocked(toPeerId)) {
        this.logger?.warn('[HandshakeProtocol] 对方已被拉黑');
        return null;
      }
      
      // 检查是否已发送过请求
      const existing = Array.from(this.outgoingRequests.values())
        .find(r => r.toPeerId === toPeerId);
      if (existing && Date.now() - existing.sentAt < HANDSHAKE_TIMEOUT_MS) {
        this.logger?.warn('[HandshakeProtocol] 已有待响应的请求');
        return existing.request.requestId;
      }
      
      // 创建请求
      const myCapabilities = this.getMyCapabilities();
      const request: HandshakeRequest = {
        requestId: this.generateRequestId(),
        from: this.f2a.peerId,
        fromName: this.f2a.agentInfo?.displayName || 'OpenClaw Agent',
        capabilities: myCapabilities,
        timestamp: Date.now(),
        message,
      };
      
      // 构造消息
      const msg: FriendRequestMessage = {
        type: HANDSHAKE_MESSAGE_TYPES.FRIEND_REQUEST,
        requestId: request.requestId,
        fromName: request.fromName,
        capabilities: request.capabilities,
        timestamp: request.timestamp,
        message: request.message,
      };
      
      // 发送消息（带重试）
      let lastError: Error | null = null;
      for (let i = 0; i < RETRY_CONFIG.maxRetries; i++) {
        try {
          const result = await (this.f2a as any).sendMessage(
            toPeerId,
            JSON.stringify(msg),
            { type: 'handshake' }
          );
          
          if (result?.success !== false) {
            // 记录待响应请求
            this.outgoingRequests.set(request.requestId, {
              request,
              toPeerId,
              sentAt: Date.now(),
              timeout: this.setupRequestTimeout(request.requestId),
            });
            
            // 更新联系人状态为 pending
            let contact = this.contactManager.getContactByPeerId(toPeerId);
            if (contact) {
              this.contactManager.updateContact(contact.id, {
                status: FriendStatus.PENDING,
              });
            } else {
              contact = this.contactManager.addContact({
                name: 'Pending Request',
                peerId: toPeerId,
              });
              this.contactManager.updateContact(contact.id, {
                status: FriendStatus.PENDING,
              });
            }
            
            this.logger?.info(`[HandshakeProtocol] 好友请求已发送: ${toPeerId.slice(0, 16)}`);
            return request.requestId;
          }
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          this.logger?.warn(`[HandshakeProtocol] 发送失败 (尝试 ${i + 1}/${RETRY_CONFIG.maxRetries}): ${lastError.message}`);
          
          if (i < RETRY_CONFIG.maxRetries - 1) {
            await this.sleep(RETRY_CONFIG.retryDelayMs * (i + 1));
          }
        }
      }
      
      this.logger?.error(`[HandshakeProtocol] 发送好友请求失败: ${lastError?.message}`);
      return null;
    } catch (err) {
      this.logger?.error(`[HandshakeProtocol] 发送好友请求异常: ${err}`);
      return null;
    }
  }

  /**
   * 设置请求超时
   */
  private setupRequestTimeout(requestId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const pending = this.outgoingRequests.get(requestId);
      if (pending) {
        this.outgoingRequests.delete(requestId);
        this.logger?.info(`[HandshakeProtocol] 请求超时: ${requestId}`);
        this.emit('timeout', { requestId, toPeerId: pending.toPeerId });
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }

  // ============================================================================
  // 处理收到的消息
  // ============================================================================

  /**
   * 处理收到的消息
   */
  private async handleMessage(
    from: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    // 只处理握手消息
    if (metadata?.type !== 'handshake') {
      return;
    }
    
    try {
      const msg = JSON.parse(content);
      
      switch (msg.type) {
        case HANDSHAKE_MESSAGE_TYPES.FRIEND_REQUEST:
          await this.handleFriendRequest(from, msg as FriendRequestMessage);
          break;
          
        case HANDSHAKE_MESSAGE_TYPES.FRIEND_RESPONSE:
          await this.handleFriendResponse(from, msg as FriendResponseMessage);
          break;
          
        default:
          // 不是握手消息，忽略
          break;
      }
    } catch (err) {
      // JSON 解析失败，不是我们处理的消息
    }
  }

  /**
   * 处理好友请求
   */
  private async handleFriendRequest(
    from: string,
    msg: FriendRequestMessage
  ): Promise<void> {
    this.logger?.info(`[HandshakeProtocol] 收到好友请求: ${msg.fromName} (${from.slice(0, 16)})`);
    
    // 检查是否被拉黑
    if (this.contactManager.isBlocked(from)) {
      this.logger?.info('[HandshakeProtocol] 来源已被拉黑，忽略请求');
      // 发送拒绝响应
      await this.sendResponse(from, msg.requestId, false, 'Blocked');
      return;
    }
    
    // 构造握手请求
    const request: HandshakeRequest = {
      requestId: msg.requestId,
      from,
      fromName: msg.fromName,
      capabilities: msg.capabilities,
      timestamp: msg.timestamp,
      message: msg.message,
    };
    
    // 添加到待处理列表
    this.contactManager.addPendingHandshake(request);
    
    // 触发事件
    this.emit('request', {
      requestId: msg.requestId,
      from,
      fromName: msg.fromName,
      capabilities: msg.capabilities,
      message: msg.message,
    });
  }

  /**
   * 处理好友响应
   */
  private async handleFriendResponse(
    from: string,
    msg: FriendResponseMessage
  ): Promise<void> {
    this.logger?.info(`[HandshakeProtocol] 收到好友响应: ${msg.accepted ? 'accepted' : 'rejected'}`);
    
    // 查找对应的请求
    const pending = this.outgoingRequests.get(msg.requestId);
    if (!pending) {
      this.logger?.warn(`[HandshakeProtocol] 未找到对应的请求: ${msg.requestId}`);
      return;
    }
    
    // 清除超时定时器
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    this.outgoingRequests.delete(msg.requestId);
    
    // 构造响应
    const response: HandshakeResponse = {
      requestId: msg.requestId,
      from,
      accepted: msg.accepted,
      fromName: msg.fromName,
      capabilities: msg.capabilities,
      timestamp: msg.timestamp,
      reason: msg.reason,
    };
    
    // 处理响应
    const success = this.contactManager.handleHandshakeResponse(response);
    
    // 触发事件
    this.emit('response', {
      requestId: msg.requestId,
      from,
      accepted: msg.accepted,
      success,
    });
  }

  // ============================================================================
  // 发送响应
  // ============================================================================

  /**
   * 接受好友请求
   */
  async acceptRequest(requestId: string): Promise<boolean> {
    const myCapabilities = this.getMyCapabilities();
    const myName = this.f2a.agentInfo?.displayName || 'OpenClaw Agent';
    
    const response = this.contactManager.acceptHandshake(
      requestId,
      myName,
      myCapabilities
    );
    
    if (!response) {
      this.logger?.warn(`[HandshakeProtocol] 未找到请求: ${requestId}`);
      return false;
    }
    
    // 发送响应
    const pending = this.contactManager.getPendingHandshakeFrom(response.from);
    if (!pending) return false;
    
    return await this.sendResponse(
      pending.from,
      requestId,
      true,
      undefined,
      myName,
      myCapabilities
    );
  }

  /**
   * 拒绝好友请求
   */
  async rejectRequest(requestId: string, reason?: string): Promise<boolean> {
    const response = this.contactManager.rejectHandshake(requestId, reason);
    
    if (!response) {
      this.logger?.warn(`[HandshakeProtocol] 未找到请求: ${requestId}`);
      return false;
    }
    
    const pending = this.contactManager.getPendingHandshakeFrom(response.from);
    if (!pending) return false;
    
    return await this.sendResponse(pending.from, requestId, false, reason);
  }

  /**
   * 发送响应消息
   */
  private async sendResponse(
    toPeerId: string,
    requestId: string,
    accepted: boolean,
    reason?: string,
    fromName?: string,
    capabilities?: ContactCapability[]
  ): Promise<boolean> {
    const msg: FriendResponseMessage = {
      type: HANDSHAKE_MESSAGE_TYPES.FRIEND_RESPONSE,
      requestId,
      accepted,
      fromName,
      capabilities,
      timestamp: Date.now(),
      reason,
    };
    
    try {
      await (this.f2a as any).sendMessage(
        toPeerId,
        JSON.stringify(msg),
        { type: 'handshake' }
      );
      return true;
    } catch (err) {
      this.logger?.error(`[HandshakeProtocol] 发送响应失败: ${err}`);
      return false;
    }
  }

  // ============================================================================
  // 工具方法
  // ============================================================================

  /**
   * 获取自己的能力列表
   */
  private getMyCapabilities(): ContactCapability[] {
    const caps = this.f2a.getCapabilities();
    return caps.map(cap => ({
      name: cap.name,
      description: cap.description,
      tools: cap.tools,
    }));
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // 事件处理
  // ============================================================================

  /**
   * 添加事件处理器
   */
  on(event: 'request' | 'response' | 'timeout', handler: (...args: unknown[]) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * 移除事件处理器
   */
  off(event: 'request' | 'response' | 'timeout', handler: (...args: unknown[]) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * 触发事件
   */
  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch (err) {
          this.logger?.error(`[HandshakeProtocol] 事件处理器错误: ${err}`);
        }
      }
    }
  }

  // ============================================================================
  // 清理
  // ============================================================================

  /**
   * 清理资源
   */
  shutdown(): void {
    // 清除所有超时定时器
    for (const pending of this.outgoingRequests.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
    }
    this.outgoingRequests.clear();
    this.eventHandlers.clear();
    
    this.logger?.info('[HandshakeProtocol] 已关闭');
  }
}

// 默认导出
export default HandshakeProtocol;