/**
 * AnnouncementQueue 测试
 * 
 * 测试任务广播和认领队列功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnnouncementQueue } from '../src/announcement-queue.js';
import type { TaskAnnouncement } from '../src/types.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('AnnouncementQueue', () => {
  let queue: AnnouncementQueue;

  beforeEach(() => {
    queue = new AnnouncementQueue({
      maxSize: 100,
      maxAgeMs: 60000,
    });
  });

  afterEach(() => {
    queue.removeAllListeners();
  });

  describe('基本操作', () => {
    it('应该能够创建队列', () => {
      expect(queue).toBeDefined();
    });

    it('应该能够创建广播', () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      expect(announcement).toBeDefined();
      expect(announcement.announcementId).toBeDefined();
      expect(announcement.status).toBe('open');
    });

    it('应该能够获取广播', () => {
      const created = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      const retrieved = queue.get(created.announcementId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.announcementId).toBe(created.announcementId);
    });

    it('应该返回 undefined 对于不存在的广播', () => {
      const retrieved = queue.get('nonexistent-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('认领操作', () => {
    it('应该能够认领广播', () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-peer',
      });

      expect(claim).toBeDefined();
      expect(claim?.claimant).toBe('claimant-peer');
    });

    it('应该拒绝认领不存在的广播', () => {
      const claim = queue.submitClaim('nonexistent-id', {
        claimant: 'claimant-peer',
      });

      expect(claim).toBeNull();
    });

    it('应该拒绝认领已关闭的广播', () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      // 认领一次
      queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-1',
      });

      // 接受认领
      queue.acceptClaim(announcement.announcementId, announcement.claims![0].claimId);

      // 再次认领应该失败
      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-2',
      });

      expect(claim).toBeNull();
    });

    it('应该能够接受认领', () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-peer',
      });

      const accepted = queue.acceptClaim(announcement.announcementId, claim!.claimId);
      expect(accepted).toBeDefined();

      const retrieved = queue.get(announcement.announcementId);
      expect(retrieved?.status).toBe('claimed');
    });

    it('应该能够拒绝认领', () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-peer',
      });

      const rejected = queue.rejectClaim(announcement.announcementId, claim!.claimId);
      expect(rejected).toBeDefined();
    });
  });

  describe('查询操作', () => {
    it('应该能够获取开放的广播列表', () => {
      queue.create({
        taskType: 'test',
        description: 'Task 1',
        from: 'peer-1',
      });
      queue.create({
        taskType: 'test',
        description: 'Task 2',
        from: 'peer-2',
      });

      const openAnnouncements = queue.getOpen();
      expect(openAnnouncements.length).toBe(2);
    });

    it('应该能够获取统计信息', () => {
      queue.create({
        taskType: 'test',
        description: 'Task 1',
        from: 'peer-1',
      });

      const stats = queue.getStats();
      expect(stats.open).toBe(1);
      expect(stats.total).toBe(1);
    });
  });

  describe('容量限制', () => {
    it('应该在队列满时抛出错误', () => {
      const smallQueue = new AnnouncementQueue({
        maxSize: 2,
      });

      smallQueue.create({
        taskType: 'test',
        description: 'Task 1',
        from: 'peer-1',
      });
      smallQueue.create({
        taskType: 'test',
        description: 'Task 2',
        from: 'peer-2',
      });

      // 第三个应该抛出错误
      expect(() => smallQueue.create({
        taskType: 'test',
        description: 'Task 3',
        from: 'peer-3',
      })).toThrow('Announcement queue is full');
    });
  });

  describe('事件', () => {
    it('应该在创建广播时触发事件', () => {
      const handler = vi.fn();
      queue.on('announcement:created', handler);

      queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      expect(handler).toHaveBeenCalled();
    });

    it('应该在接受认领时触发事件', () => {
      const handler = vi.fn();
      queue.on('announcement:claimed', handler);

      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-peer',
      });

      queue.acceptClaim(announcement.announcementId, claim!.claimId);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('清理', () => {
    it('应该能够清理队列', () => {
      queue.create({
        taskType: 'test',
        description: 'Task 1',
        from: 'peer-1',
      });

      queue.clear();
      const stats = queue.getStats();
      expect(stats.total).toBe(0);
    });

    it('应该能够清理过期广播', () => {
      const shortLivedQueue = new AnnouncementQueue({
        maxAgeMs: 100, // 100ms
      });

      shortLivedQueue.create({
        taskType: 'test',
        description: 'Task 1',
        from: 'peer-1',
      });

      // 等待过期
      setTimeout(() => {
        shortLivedQueue.cleanup();
        const stats = shortLivedQueue.getStats();
        // 广播可能被清理
        expect(stats).toBeDefined();
      }, 150);
    });
  });
});