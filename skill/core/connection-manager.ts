/**
 * ConnectionManager - 连接确认管理器
 * 
 * 管理待确认连接请求，支持：
 * - 1小时有效期
 * - 同一 Agent 去重（保留最新）
 * - 通过序号或 ID 确认/拒绝
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { Socket } from 'net';
import {
  PendingConnection,
  PendingConnectionView,
  ConnectionRequestEvent,
  ConfirmationEvent,
  RejectionEvent,
  ExpirationEvent,
  Result
} from '../types';

// 常量
const PENDING_TIMEOUT = 60 * 60 * 1000; // 1小时
const CLEANUP_INTERVAL = 60 * 1000; // 每分钟清理一次

export interface ConnectionManagerOptions {
  timeout?: number;
  cleanupInterval?: number;
}

export class ConnectionManager extends EventEmitter<{
  pending_added: (event: ConnectionRequestEvent) => void;
  confirmed: (event: ConfirmationEvent) => void;
  rejected: (event: RejectionEvent) => void;
  expired: (event: ExpirationEvent) => void;
}> {
  private pendingConnections: Map<string, PendingConnection> = new Map();
  private agentToConfirmation: Map<string, string> = new Map();
  private maxIndex: number = 0;
  private cleanupInterval?: NodeJS.Timeout;
  private options: Required<ConnectionManagerOptions>;

  constructor(options: ConnectionManagerOptions = {}) {
    super();
    this.options = {
      timeout: options.timeout ?? PENDING_TIMEOUT,
      cleanupInterval: options.cleanupInterval ?? CLEANUP_INTERVAL
    };
    this.startCleanup();
  }

  /**
   * 添加待确认连接
   */
  addPending(
    agentId: string,
    socket: Socket,
    publicKey: string,
    address: string,
    port: number
  ): { confirmationId: string; isDuplicate: boolean } {
    // 检查是否已有同一 Agent 的待确认请求
    const existingId = this.agentToConfirmation.get(agentId);
    let isDuplicate = false;

    if (existingId) {
      const existing = this.pendingConnections.get(existingId);
      if (existing) {
        // 关闭旧的 socket
        this.closeSocket(existing.socket);
        // 删除旧的记录
        this.pendingConnections.delete(existingId);
        console.log(`[ConnectionManager] 更新 ${agentId.slice(0, 16)}... 的连接请求（去重）`);
        isDuplicate = true;
      }
    }

    const confirmationId = randomUUID();
    const now = Date.now();

    const pending: PendingConnection = {
      confirmationId,
      agentId,
      socket,
      publicKey,
      address,
      port,
      timestamp: now,
      expiresAt: now + this.options.timeout,
      index: ++this.maxIndex
    };

    this.pendingConnections.set(confirmationId, pending);
    this.agentToConfirmation.set(agentId, confirmationId);

    this.emit('pending_added', {
      confirmationId,
      agentId,
      address,
      port,
      isDuplicate
    });

    return { confirmationId, isDuplicate };
  }

  /**
   * 获取待确认连接列表
   */
  getPendingList(): PendingConnectionView[] {
    const now = Date.now();
    const list: PendingConnectionView[] = [];

    for (const pending of this.pendingConnections.values()) {
      const remainingMs = pending.expiresAt - now;
      const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));

      list.push({
        index: pending.index,
        confirmationId: pending.confirmationId,
        shortId: pending.confirmationId.slice(0, 8),
        agentId: pending.agentId,
        agentIdShort: pending.agentId.slice(0, 16) + '...',
        address: pending.address,
        port: pending.port,
        remainingMinutes,
        requestedAt: pending.timestamp
      });
    }

    return list.sort((a, b) => a.index - b.index);
  }

  /**
   * 通过序号查找
   */
  getByIndex(index: number): PendingConnection | null {
    for (const pending of this.pendingConnections.values()) {
      if (pending.index === index) {
        return pending;
      }
    }
    return null;
  }

  /**
   * 通过 ID 查找
   */
  getById(confirmationId: string): PendingConnection | null {
    // 完整匹配
    if (this.pendingConnections.has(confirmationId)) {
      return this.pendingConnections.get(confirmationId)!;
    }

    // 短 ID 匹配（前8位）
    for (const [id, pending] of this.pendingConnections) {
      if (id.startsWith(confirmationId)) {
        return pending;
      }
    }

    return null;
  }

  /**
   * 确认连接
   */
  confirm(idOrIndex: string | number): Result<PendingConnection> {
    const pending = typeof idOrIndex === 'number'
      ? this.getByIndex(idOrIndex)
      : this.getById(idOrIndex);

    if (!pending) {
      return { success: false, error: '连接请求不存在或已过期' };
    }

    // 清理记录
    this.pendingConnections.delete(pending.confirmationId);
    this.agentToConfirmation.delete(pending.agentId);

    this.emit('confirmed', {
      confirmationId: pending.confirmationId,
      agentId: pending.agentId,
      socket: pending.socket,
      publicKey: pending.publicKey
    });

    return { success: true, data: pending };
  }

  /**
   * 拒绝连接
   */
  reject(idOrIndex: string | number, reason: string = '用户拒绝'): Result<PendingConnection> {
    const pending = typeof idOrIndex === 'number'
      ? this.getByIndex(idOrIndex)
      : this.getById(idOrIndex);

    if (!pending) {
      return { success: false, error: '连接请求不存在或已过期' };
    }

    // 关闭 socket
    this.closeSocket(pending.socket);

    // 清理记录
    this.pendingConnections.delete(pending.confirmationId);
    this.agentToConfirmation.delete(pending.agentId);

    this.emit('rejected', {
      confirmationId: pending.confirmationId,
      agentId: pending.agentId,
      reason
    });

    return { success: true, data: pending };
  }

  /**
   * 获取待确认数量
   */
  getPendingCount(): number {
    return this.pendingConnections.size;
  }

  /**
   * 检查 Agent 是否有待确认请求
   */
  hasPendingForAgent(agentId: string): boolean {
    return this.agentToConfirmation.has(agentId);
  }

  /**
   * 停止管理器
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // 关闭所有待确认连接
    for (const pending of this.pendingConnections.values()) {
      this.closeSocket(pending.socket);
    }

    this.pendingConnections.clear();
    this.agentToConfirmation.clear();
  }

  /**
   * 启动定期清理
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * 清理过期连接
   */
  private cleanup(): void {
    const now = Date.now();
    let expiredCount = 0;

    for (const [confirmationId, pending] of this.pendingConnections) {
      if (now > pending.expiresAt) {
        this.closeSocket(pending.socket);
        this.agentToConfirmation.delete(pending.agentId);
        this.pendingConnections.delete(confirmationId);
        expiredCount++;

        this.emit('expired', {
          confirmationId,
          agentId: pending.agentId
        });
      }
    }

    if (expiredCount > 0) {
      console.log(`[ConnectionManager] 清理 ${expiredCount} 个过期连接`);
    }
  }

  /**
   * 安全关闭 socket
   */
  private closeSocket(socket: Socket): void {
    try {
      socket.end();
    } catch {
      // 忽略错误
    }
  }
}