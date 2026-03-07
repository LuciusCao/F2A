/**
 * F2A Announcement Queue
 * 管理任务广播和认领（Claim Pattern）
 */

import type { TaskAnnouncement, TaskClaim } from './types.js';
import { randomUUID } from 'crypto';

export interface AnnouncementQueueStats {
  open: number;
  claimed: number;
  delegated: number;
  expired: number;
  total: number;
}

export class AnnouncementQueue {
  private announcements = new Map<string, TaskAnnouncement>();
  private maxSize: number;
  private maxAgeMs: number;

  constructor(options?: { maxSize?: number; maxAgeMs?: number }) {
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
    return created;
  }

  /**
   * 获取所有开放的广播
   */
  getOpen(): TaskAnnouncement[] {
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
    if (!announcement) return null;
    if (announcement.status !== 'open') return null;

    // 检查该 claimant 是否已经提交过认领（防止重复认领）
    const existingClaim = announcement.claims?.find(c => c.claimant === claim.claimant);
    if (existingClaim) {
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

    return created;
  }

  /**
   * 接受认领
   */
  acceptClaim(announcementId: string, claimId: string): TaskClaim | null {
    const announcement = this.announcements.get(announcementId);
    if (!announcement) return null;

    const claim = announcement.claims?.find(c => c.claimId === claimId);
    if (!claim) return null;

    // 标记该认领为接受
    claim.status = 'accepted';

    // 拒绝其他认领
    announcement.claims?.forEach(c => {
      if (c.claimId !== claimId) {
        c.status = 'rejected';
      }
    });

    // 标记广播为已认领
    announcement.status = 'claimed';

    return claim;
  }

  /**
   * 拒绝认领
   */
  rejectClaim(announcementId: string, claimId: string): TaskClaim | null {
    const announcement = this.announcements.get(announcementId);
    if (!announcement) return null;

    const claim = announcement.claims?.find(c => c.claimId === claimId);
    if (!claim) return null;

    claim.status = 'rejected';
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
    for (const [id, announcement] of this.announcements) {
      const age = now - announcement.timestamp;
      if (age > this.maxAgeMs) {
        if (announcement.status === 'open') {
          announcement.status = 'expired';
        }
        // 删除已过期一段时间的
        if (age > this.maxAgeMs * 2) {
          this.announcements.delete(id);
        }
      }
    }
  }

  /**
   * 清空
   */
  clear(): void {
    this.announcements.clear();
  }
}

// 导出单例
export const announcementQueue = new AnnouncementQueue();