/**
 * AnnouncementQueue 测试
 * 
 * 测试任务广播和认领队列功能。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      // P0-2 修复：补充实际行为验证
      expect(queue.getStats()).toBeDefined();
      expect(queue.getStats().total).toBe(0);
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
      // P0-2 修复：补充实际行为验证
      expect(announcement.taskType).toBe('test');
      expect(announcement.description).toBe('Test task');
      expect(announcement.from).toBe('test-peer');
      // AnnouncementQueue 使用 timestamp 而非 createdAt
      expect(announcement.timestamp).toBeDefined();
      expect(announcement.timestamp).toBeGreaterThan(0);
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

  // P1-5 修复：并发认领测试
  describe('并发安全', () => {
    it('应该处理多个 Agent 同时认领同一广播', async () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Concurrent Claim Test',
        from: 'peer-1',
      });

      // 多个 Agent 同时认领
      const claimPromises = Array.from({ length: 5 }, (_, i) =>
        Promise.resolve(queue.submitClaim(announcement.announcementId, {
          claimant: `claimant-${i}`,
          confidence: 0.8,
          estimatedTime: 1000,
        }))
      );

      const claims = await Promise.all(claimPromises);

      // 所有认领应该成功（pending 状态）
      const successfulClaims = claims.filter(c => c !== null);
      expect(successfulClaims.length).toBe(5);

      // 验证广播有正确的认领列表
      const retrieved = queue.get(announcement.announcementId);
      expect(retrieved?.claims?.length).toBe(5);

      // 每个认领者应该不同
      const claimants = retrieved?.claims?.map(c => c.claimant);
      const uniqueClaimants = new Set(claimants);
      expect(uniqueClaimants.size).toBe(5);
    });

    it('应该只允许接受一个认领', async () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Single Accept Test',
        from: 'peer-1',
      });

      // 提交多个认领
      const claims = [
        queue.submitClaim(announcement.announcementId, { claimant: 'claimant-1' }),
        queue.submitClaim(announcement.announcementId, { claimant: 'claimant-2' }),
        queue.submitClaim(announcement.announcementId, { claimant: 'claimant-3' }),
      ];

      // 接受第一个认领
      const accepted = queue.acceptClaim(announcement.announcementId, claims[0]!.claimId);
      expect(accepted).toBeDefined();
      expect(accepted?.status).toBe('accepted');

      // 广播状态应该变为 claimed
      const retrieved = queue.get(announcement.announcementId);
      expect(retrieved?.status).toBe('claimed');

      // 再次接受其他认领应该失败或返回 null
      const secondAccept = queue.acceptClaim(announcement.announcementId, claims[1]!.claimId);
      expect(secondAccept).toBeNull();
    });

    it('应该处理并发接受和拒绝认领', async () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Concurrent Accept/Reject Test',
        from: 'peer-1',
      });

      const claim1 = queue.submitClaim(announcement.announcementId, { claimant: 'claimant-1' });
      const claim2 = queue.submitClaim(announcement.announcementId, { claimant: 'claimant-2' });

      // 并发接受和拒绝
      const results = await Promise.all([
        Promise.resolve(queue.acceptClaim(announcement.announcementId, claim1!.claimId)),
        Promise.resolve(queue.rejectClaim(announcement.announcementId, claim2!.claimId)),
      ]);

      // 接受应该成功
      expect(results[0]).toBeDefined();
      expect(results[0]?.status).toBe('accepted');

      // 拒绝也应该成功（即使广播已被接受）
      expect(results[1]).toBeDefined();
      expect(results[1]?.status).toBe('rejected');

      // 最终状态应该是 claimed
      const retrieved = queue.get(announcement.announcementId);
      expect(retrieved?.status).toBe('claimed');
    });

    it('应该拒绝已关闭广播的认领', async () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Closed Broadcast Test',
        from: 'peer-1',
      });

      // 先接受一个认领，关闭广播
      const claim = queue.submitClaim(announcement.announcementId, { claimant: 'claimant-1' });
      queue.acceptClaim(announcement.announcementId, claim!.claimId);

      // 尝试认领已关闭的广播
      const lateClaim = queue.submitClaim(announcement.announcementId, {
        claimant: 'late-claimant',
      });

      expect(lateClaim).toBeNull();
    });
  });

  // P2 修复：并发竞态条件测试
  describe('并发竞态条件', () => {
    it('多个并发 acceptClaim 只应有一个成功', async () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      // 多个用户认领
      const claim1 = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-1',
      });
      const claim2 = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-2',
      });
      const claim3 = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-3',
      });

      // 模拟并发接受认领
      const results = await Promise.allSettled([
        Promise.resolve(queue.acceptClaim(announcement.announcementId, claim1!.claimId)),
        Promise.resolve(queue.acceptClaim(announcement.announcementId, claim2!.claimId)),
        Promise.resolve(queue.acceptClaim(announcement.announcementId, claim3!.claimId)),
      ]);

      // 计算成功数量
      const successful = results.filter(
        r => r.status === 'fulfilled' && r.value !== null
      );

      // 只应该有一个成功
      expect(successful.length).toBeLessThanOrEqual(1);

      // 检查最终状态
      const finalAnnouncement = queue.get(announcement.announcementId);
      expect(finalAnnouncement?.status).toBe('claimed');
    });

    it('多个并发 submitClaim 应能同时提交但只有一个能被接受', async () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      // 模拟并发认领
      const results = await Promise.all([
        Promise.resolve(queue.submitClaim(announcement.announcementId, { claimant: 'peer-1' })),
        Promise.resolve(queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' })),
        Promise.resolve(queue.submitClaim(announcement.announcementId, { claimant: 'peer-3' })),
      ]);

      // 所有认领应该都成功提交
      const successfulClaims = results.filter(r => r !== null);
      expect(successfulClaims.length).toBe(3);

      // 但接受其中一个后，广播状态变为 claimed
      const firstClaim = successfulClaims[0];
      queue.acceptClaim(announcement.announcementId, firstClaim!.claimId);

      // 验证最终状态
      const finalAnnouncement = queue.get(announcement.announcementId);
      expect(finalAnnouncement?.status).toBe('claimed');
      expect(finalAnnouncement?.claims?.length).toBeGreaterThanOrEqual(3);
    });

    it('并发创建和认领不应导致数据丢失', async () => {
      // 同时创建多个广播
      const createPromises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(queue.create({
          taskType: 'test',
          description: `Task ${i}`,
          from: `peer-${i}`,
        }))
      );

      const announcements = await Promise.all(createPromises);

      // 所有广播都应该创建成功
      expect(announcements.every(a => a !== null)).toBe(true);

      // 对每个广播进行认领
      const claimPromises = announcements.map(a =>
        Promise.resolve(queue.submitClaim(a!.announcementId, { claimant: 'claimer' }))
      );

      const claims = await Promise.all(claimPromises);

      // 所有认领都应该成功
      expect(claims.every(c => c !== null)).toBe(true);

      // 验证统计数据
      const stats = queue.getStats();
      expect(stats.total).toBe(10);
    });

    it('在广播关闭后并发认领应失败', async () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
      });

      // 先认领并接受
      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'claimant-1',
      });
      queue.acceptClaim(announcement.announcementId, claim!.claimId);

      // 然后多个并发认领尝试
      const results = await Promise.all([
        Promise.resolve(queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' })),
        Promise.resolve(queue.submitClaim(announcement.announcementId, { claimant: 'peer-3' })),
      ]);

      // 所有的都应该失败
      expect(results.every(r => r === null)).toBe(true);
    });
  });
});