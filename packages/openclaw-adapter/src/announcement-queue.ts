/**
 * F2A Announcement Queue
 * 管理任务广播和认领（Claim Pattern）
 * 
 * 设计说明：
 * - 默认导出类而非单例，便于测试和依赖注入
 * - createAnnouncementQueue() 工厂函数提供默认实例
 */

import type { TaskAnnouncement, TaskClaim } from './types.js';
import { randomUUID } from 'crypto';
import { queueLogger as logger } from './logger.js';
import { EventEmitter } from 'eventemitter3';

export interface AnnouncementQueueStats {
  open: number;
  claimed: number;
  delegated: number;
  expired: number;
  total: number;
}

export interface AnnouncementQueueOptions {
  maxSize?: number;
  maxAgeMs?: number;
}

/** 过期事件载荷 */
export interface AnnouncementExpiredEvent {
  announcementId: string;
  taskType: string;
  from: string;
  timestamp: number;
  reason: 'timeout' | 'manual';
}

/** 事件类型定义 */
export interface AnnouncementQueueEvents {
  'announcement:expired': (event: AnnouncementExpiredEvent) => void;
  'announcement:created': (announcement: TaskAnnouncement) => void;
  'announcement:claimed': (announcement: TaskAnnouncement, claim: TaskClaim) => void;
}

export class AnnouncementQueue extends EventEmitter<AnnouncementQueueEvents> {
  private announcements = new Map<string, TaskAnnouncement>();
  private maxSize: number;
  private maxAgeMs: number;

  constructor(options?: { maxSize?: number; maxAgeMs?: number }) {
    super();
    this.maxSize = options?.maxSize || 100;
    this.maxAgeMs = options?.maxAgeMs || 30 * 60 * 1000; // 30分钟
  }

  /**
   * 创建任务广播
   */
  create(announcement: Omit<TaskAnnouncement, 'announcementId' | 'timestamp' | 'status' | 'claims'>): TaskAnnouncement {
    // 清理过期
    this.cleanup();

    // 检查容量
    if (this.announcements.size >= this.maxSize) {
      logger.error(' create: queue is full, size=%d, maxSize=%d', this.announcements.size, this.maxSize);
      throw new Error('Announcement queue is full');
    }

    // 使用 crypto.randomUUID() 生成唯一 ID，避免碰撞
    const id = `ann-${randomUUID()}`;
    const created: TaskAnnouncement = {
      ...announcement,
      announcementId: id,
      timestamp: Date.now(),
      status: 'open',
      claims: []
    };

    this.announcements.set(id, created);
    logger.info(' create: announcementId=%s, from=%s, taskType=%s', id, announcement.from, announcement.taskType);
    
    // 发出创建事件
    this.emit('announcement:created', created);
    
    return created;
  }

  /**
   * 获取所有开放的广播
   */
  getOpen(): TaskAnnouncement[] {
    // 在获取开放广播前先清理过期数据，避免返回过期数据
    this.cleanup();
    
    return Array.from(this.announcements.values())
      .filter(a => a.status === 'open')
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 获取特定广播
   */
  get(announcementId: string): TaskAnnouncement | undefined {
    return this.announcements.get(announcementId);
  }

  /**
   * 提交认领
   */
  submitClaim(
    announcementId: string,
    claim: Omit<TaskClaim, 'claimId' | 'timestamp' | 'status' | 'announcementId'>
  ): TaskClaim | null {
    const announcement = this.announcements.get(announcementId);
    if (!announcement) {
      logger.warn(' submitClaim: announcement not found, id=%s, claimant=%s', announcementId, claim.claimant);
      return null;
    }
    if (announcement.status !== 'open') {
      logger.warn(' submitClaim: announcement not open, id=%s, status=%s, claimant=%s', announcementId, announcement.status, claim.claimant);
      return null;
    }

    // 检查该 claimant 是否已经提交过认领（防止重复认领）
    const existingClaim = announcement.claims?.find(c => c.claimant === claim.claimant);
    if (existingClaim) {
      logger.info(' submitClaim: duplicate claim ignored, id=%s, claimant=%s, existingClaimId=%s', announcementId, claim.claimant, existingClaim.claimId);
      // 返回已存在的认领，而不是创建新的
      return existingClaim;
    }

    // 使用 crypto.randomUUID() 生成唯一 ID
    const claimId = `claim-${randomUUID()}`;
    const created: TaskClaim = {
      ...claim,
      claimId,
      announcementId,
      timestamp: Date.now(),
      status: 'pending'
    };

    if (!announcement.claims) {
      announcement.claims = [];
    }
    announcement.claims.push(created);

    logger.info(' submitClaim: claimId=%s, announcementId=%s, claimant=%s', claimId, announcementId, claim.claimant);
    return created;
  }

  /**
   * 接受认领
   * 使用 double-check locking 模式防止竞态条件
   */
  acceptClaim(announcementId: string, claimId: string): TaskClaim | null {
    const announcement = this.announcements.get(announcementId);
    if (!announcement) {
      logger.warn(' acceptClaim: announcement not found, id=%s, claimId=%s', announcementId, claimId);
      return null;
    }

    // Double-check locking: 第一次检查广播状态
    if (announcement.status !== 'open') {
      logger.warn(' acceptClaim: announcement not open, id=%s, status=%s, claimId=%s', announcementId, announcement.status, claimId);
      return null;
    }

    const claim = announcement.claims?.find(c => c.claimId === claimId);
    if (!claim) {
      logger.warn(' acceptClaim: claim not found, announcementId=%s, claimId=%s', announcementId, claimId);
      return null;
    }

    // Double-check locking: 第二次检查广播状态（在找到认领后）
    // 这确保在查找认领和修改状态之间没有其他操作改变了广播状态
    if (announcement.status !== 'open') {
      logger.warn(' acceptClaim: race condition detected, announcement status changed, id=%s, status=%s, claimId=%s', announcementId, announcement.status, claimId);
      return null;
    }

    // 标记该认领为接受
    claim.status = 'accepted';

    // 拒绝其他认领
    const rejectedCount = announcement.claims?.filter(c => {
      if (c.claimId !== claimId) {
        c.status = 'rejected';
        return true;
      }
      return false;
    }).length || 0;

    // 标记广播为已认领
    announcement.status = 'claimed';

    logger.info(' acceptClaim: claimId=%s, announcementId=%s, claimant=%s, rejectedCount=%d', claimId, announcementId, claim.claimant, rejectedCount);
    
    // 发出认领事件
    this.emit('announcement:claimed', announcement, claim);
    
    return claim;
  }

  /**
   * 拒绝认领
   */
  rejectClaim(announcementId: string, claimId: string): TaskClaim | null {
    const announcement = this.announcements.get(announcementId);
    if (!announcement) {
      logger.warn(' rejectClaim: announcement not found, id=%s, claimId=%s', announcementId, claimId);
      return null;
    }

    const claim = announcement.claims?.find(c => c.claimId === claimId);
    if (!claim) {
      logger.warn(' rejectClaim: claim not found, announcementId=%s, claimId=%s', announcementId, claimId);
      return null;
    }

    claim.status = 'rejected';
    logger.info(' rejectClaim: claimId=%s, announcementId=%s, claimant=%s', claimId, announcementId, claim.claimant);
    return claim;
  }

  /**
   * 标记为已委托
   */
  markDelegated(announcementId: string): boolean {
    const announcement = this.announcements.get(announcementId);
    if (!announcement) return false;

    announcement.status = 'delegated';
    return true;
  }

  /**
   * 获取我的认领（作为认领方）
   */
  getMyClaims(claimantId: string): TaskClaim[] {
    const claims: TaskClaim[] = [];
    for (const announcement of this.announcements.values()) {
      const myClaims = announcement.claims?.filter(c => c.claimant === claimantId);
      if (myClaims) {
        claims.push(...myClaims);
      }
    }
    return claims.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取我的广播（作为发布方）
   */
  getMyAnnouncements(fromId: string): TaskAnnouncement[] {
    return Array.from(this.announcements.values())
      .filter(a => a.from === fromId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取统计
   */
  getStats(): AnnouncementQueueStats {
    const all = Array.from(this.announcements.values());
    return {
      open: all.filter(a => a.status === 'open').length,
      claimed: all.filter(a => a.status === 'claimed').length,
      delegated: all.filter(a => a.status === 'delegated').length,
      expired: all.filter(a => a.status === 'expired').length,
      total: all.length
    };
  }

  /**
   * 清理过期
   */
  cleanup(): void {
    const now = Date.now();
    let expiredCount = 0;
    let deletedCount = 0;
    
    for (const [id, announcement] of this.announcements) {
      const age = now - announcement.timestamp;
      if (age > this.maxAgeMs) {
        if (announcement.status === 'open') {
          announcement.status = 'expired';
          expiredCount++;
          
          // 发出过期事件，通知外部系统
          const expiredEvent: AnnouncementExpiredEvent = {
            announcementId: announcement.announcementId,
            taskType: announcement.taskType,
            from: announcement.from,
            timestamp: announcement.timestamp,
            reason: 'timeout'
          };
          this.emit('announcement:expired', expiredEvent);
          logger.info('cleanup: announcement expired, id=%s, taskType=%s, from=%s', 
            announcement.announcementId, announcement.taskType, announcement.from);
        }
        // 删除已过期一段时间的
        if (age > this.maxAgeMs * 2) {
          this.announcements.delete(id);
          deletedCount++;
        }
      }
    }
    
    if (expiredCount > 0 || deletedCount > 0) {
      logger.info(' cleanup: expired=%d, deleted=%d, remaining=%d', expiredCount, deletedCount, this.announcements.size);
    }
  }

  /**
   * 清空
   */
  clear(): void {
    this.announcements.clear();
  }
}

// 工厂函数：创建新的 AnnouncementQueue 实例
export function createAnnouncementQueue(options?: { maxSize?: number; maxAgeMs?: number }): AnnouncementQueue {
  return new AnnouncementQueue(options);
}

// 默认实例（向后兼容，但建议使用依赖注入）
export const announcementQueue = new AnnouncementQueue();