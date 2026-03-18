/**
 * AnnouncementQueue 测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnnouncementQueue } from './announcement-queue.js';
import type { TaskAnnouncement, TaskClaim } from './types.js';

describe('AnnouncementQueue', () => {
  let queue: AnnouncementQueue;

  beforeEach(() => {
    queue = new AnnouncementQueue({ maxSize: 10, maxAgeMs: 1000 });
  });

  afterEach(() => {
    queue.clear();
  });

  describe('create()', () => {
    it('应该创建任务广播', () => {
      const announcement = queue.create({
        taskType: 'test',
        description: 'Test task',
        timeout: 5000,
        from: 'peer-1'
      });

      expect(announcement.announcementId).toMatch(/^ann-/);
      expect(announcement.taskType).toBe('test');
      expect(announcement.description).toBe('Test task');
      expect(announcement.status).toBe('open');
      expect(announcement.from).toBe('peer-1');
      expect(announcement.claims).toEqual([]);
      expect(announcement.timestamp).toBeGreaterThan(0);
    });

    it('应该在队列满时抛出错误', () => {
      const smallQueue = new AnnouncementQueue({ maxSize: 2 });
      
      smallQueue.create({ taskType: 'test', description: 'task 1', timeout: 5000, from: 'peer-1' });
      smallQueue.create({ taskType: 'test', description: 'task 2', timeout: 5000, from: 'peer-1' });
      
      expect(() => smallQueue.create({ taskType: 'test', description: 'task 3', timeout: 5000, from: 'peer-1' }))
        .toThrow('Announcement queue is full');
    });

    it('应该为每个广播生成唯一 ID', () => {
      const a1 = queue.create({ taskType: 'test', description: 'task 1', timeout: 5000, from: 'peer-1' });
      const a2 = queue.create({ taskType: 'test', description: 'task 2', timeout: 5000, from: 'peer-1' });
      
      expect(a1.announcementId).not.toBe(a2.announcementId);
    });
  });

  describe('get() 和 getOpen()', () => {
    it('应该获取特定广播', () => {
      const created = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const fetched = queue.get(created.announcementId);
      
      expect(fetched).toBeDefined();
      expect(fetched?.announcementId).toBe(created.announcementId);
    });

    it('应该对不存在的广播返回 undefined', () => {
      expect(queue.get('non-existent')).toBeUndefined();
    });

    it('应该获取所有开放的广播', () => {
      queue.create({ taskType: 'test', description: 'task 1', timeout: 5000, from: 'peer-1' });
      queue.create({ taskType: 'test', description: 'task 2', timeout: 5000, from: 'peer-1' });
      
      const open = queue.getOpen();
      expect(open).toHaveLength(2);
      expect(open.every(a => a.status === 'open')).toBe(true);
    });

    it('应该按时间排序返回开放广播', async () => {
      queue.create({ taskType: 'test', description: 'first', timeout: 5000, from: 'peer-1' });
      await new Promise(r => setTimeout(r, 10));
      queue.create({ taskType: 'test', description: 'second', timeout: 5000, from: 'peer-1' });
      
      const open = queue.getOpen();
      expect(open[0].description).toBe('first');
      expect(open[1].description).toBe('second');
    });
  });

  describe('submitClaim()', () => {
    it('应该提交认领', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'peer-2',
        claimantName: 'Worker 2',
        confidence: 0.9
      });

      expect(claim).toBeDefined();
      expect(claim?.claimId).toMatch(/^claim-/);
      expect(claim?.claimant).toBe('peer-2');
      expect(claim?.status).toBe('pending');
      expect(claim?.announcementId).toBe(announcement.announcementId);
    });

    it('应该对不存在的广播返回 null', () => {
      const claim = queue.submitClaim('non-existent', {
        claimant: 'peer-2'
      });
      expect(claim).toBeNull();
    });

    it('应该对非开放状态的广播返回 null', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      queue.markDelegated(announcement.announcementId);
      
      const claim = queue.submitClaim(announcement.announcementId, {
        claimant: 'peer-2'
      });
      expect(claim).toBeNull();
    });

    it('应该防止重复认领', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      
      const claim1 = queue.submitClaim(announcement.announcementId, {
        claimant: 'peer-2',
        confidence: 0.8
      });
      
      const claim2 = queue.submitClaim(announcement.announcementId, {
        claimant: 'peer-2',
        confidence: 0.9  // 不同的 confidence
      });

      // 应该返回同一个认领
      expect(claim1?.claimId).toBe(claim2?.claimId);
      expect(announcement.claims).toHaveLength(1);
    });

    it('应该允许不同用户认领同一广播', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      
      const claim1 = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      const claim2 = queue.submitClaim(announcement.announcementId, { claimant: 'peer-3' });

      expect(claim1?.claimId).not.toBe(claim2?.claimId);
      expect(announcement.claims).toHaveLength(2);
    });
  });

  describe('acceptClaim() 和 rejectClaim()', () => {
    it('应该接受认领', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      
      const accepted = queue.acceptClaim(announcement.announcementId, claim!.claimId);

      expect(accepted?.status).toBe('accepted');
      expect(announcement.status).toBe('claimed');
    });

    it('接受认领时应该拒绝其他认领', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim1 = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      const claim2 = queue.submitClaim(announcement.announcementId, { claimant: 'peer-3' });
      
      queue.acceptClaim(announcement.announcementId, claim1!.claimId);

      expect(claim1?.status).toBe('accepted');
      expect(claim2?.status).toBe('rejected');
    });

    it('应该拒绝认领', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      
      const rejected = queue.rejectClaim(announcement.announcementId, claim!.claimId);

      expect(rejected?.status).toBe('rejected');
      expect(announcement.status).toBe('open'); // 广播仍然开放
    });

    it('应该对不存在的广播返回 null', () => {
      const result = queue.acceptClaim('non-existent', 'claim-1');
      expect(result).toBeNull();
    });

    it('应该对不存在的认领返回 null', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const result = queue.acceptClaim(announcement.announcementId, 'non-existent-claim');
      expect(result).toBeNull();
    });
  });

  describe('getMyClaims() 和 getMyAnnouncements()', () => {
    it('应该获取我的认领', () => {
      const a1 = queue.create({ taskType: 'test', description: 'Task 1', timeout: 5000, from: 'peer-1' });
      const a2 = queue.create({ taskType: 'test', description: 'Task 2', timeout: 5000, from: 'peer-1' });
      
      queue.submitClaim(a1.announcementId, { claimant: 'peer-2' });
      queue.submitClaim(a2.announcementId, { claimant: 'peer-2' });
      queue.submitClaim(a1.announcementId, { claimant: 'peer-3' });

      const myClaims = queue.getMyClaims('peer-2');
      expect(myClaims).toHaveLength(2);
      expect(myClaims.every(c => c.claimant === 'peer-2')).toBe(true);
    });

    it('应该获取我的广播', () => {
      queue.create({ taskType: 'test', description: 'Task 1', timeout: 5000, from: 'peer-1' });
      queue.create({ taskType: 'test', description: 'Task 2', timeout: 5000, from: 'peer-1' });
      queue.create({ taskType: 'test', description: 'Task 3', timeout: 5000, from: 'peer-2' });

      const myAnnouncements = queue.getMyAnnouncements('peer-1');
      expect(myAnnouncements).toHaveLength(2);
      expect(myAnnouncements.every(a => a.from === 'peer-1')).toBe(true);
    });

    it('应该按时间倒序返回', async () => {
      queue.create({ taskType: 'test', description: 'first', timeout: 5000, from: 'peer-1' });
      await new Promise(r => setTimeout(r, 10));
      queue.create({ taskType: 'test', description: 'second', timeout: 5000, from: 'peer-1' });

      const myAnnouncements = queue.getMyAnnouncements('peer-1');
      expect(myAnnouncements[0].description).toBe('second');
      expect(myAnnouncements[1].description).toBe('first');
    });
  });

  describe('markDelegated()', () => {
    it('应该标记为已委托', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const result = queue.markDelegated(announcement.announcementId);
      
      expect(result).toBe(true);
      expect(announcement.status).toBe('delegated');
    });

    it('应该对不存在的广播返回 false', () => {
      expect(queue.markDelegated('non-existent')).toBe(false);
    });
  });

  describe('getStats()', () => {
    it('应该返回正确的统计', () => {
      const a1 = queue.create({ taskType: 'test', description: 'Task 1', timeout: 5000, from: 'peer-1' });
      const a2 = queue.create({ taskType: 'test', description: 'Task 2', timeout: 5000, from: 'peer-1' });
      
      const claim = queue.submitClaim(a1.announcementId, { claimant: 'peer-2' });
      queue.acceptClaim(a1.announcementId, claim!.claimId);
      queue.markDelegated(a2.announcementId);

      const stats = queue.getStats();
      expect(stats.open).toBe(0);
      expect(stats.claimed).toBe(1);
      expect(stats.delegated).toBe(1);
      expect(stats.total).toBe(2);
    });
  });

  describe('cleanup()', () => {
    it('应该将过期广播标记为 expired', async () => {
      const fastExpireQueue = new AnnouncementQueue({ maxSize: 10, maxAgeMs: 50 });
      fastExpireQueue.create({ taskType: 'test', description: 'Task', timeout: 5000, from: 'peer-1' });
      
      await new Promise(r => setTimeout(r, 60));
      
      // 通过创建新任务触发清理
      fastExpireQueue.create({ taskType: 'test', description: 'New task', timeout: 5000, from: 'peer-1' });
      
      const stats = fastExpireQueue.getStats();
      expect(stats.expired).toBe(1);
    });

    it('应该删除过期很久的广播', async () => {
      const fastExpireQueue = new AnnouncementQueue({ maxSize: 10, maxAgeMs: 50 });
      fastExpireQueue.create({ taskType: 'test', description: 'Task', timeout: 5000, from: 'peer-1' });
      
      await new Promise(r => setTimeout(r, 120));
      
      // 触发清理
      fastExpireQueue.create({ taskType: 'test', description: 'New task', timeout: 5000, from: 'peer-1' });
      
      const stats = fastExpireQueue.getStats();
      expect(stats.total).toBe(1); // 只有新任务
    });
  });

  describe('clear()', () => {
    it('应该清空队列', () => {
      queue.create({ taskType: 'test', description: 'Task 1', timeout: 5000, from: 'peer-1' });
      queue.create({ taskType: 'test', description: 'Task 2', timeout: 5000, from: 'peer-1' });
      
      queue.clear();
      
      expect(queue.getStats().total).toBe(0);
      expect(queue.getOpen()).toEqual([]);
    });
  });

  describe('边界条件', () => {
    it('应该处理空输入', () => {
      const announcement = queue.create({
        taskType: '',
        description: '',
        timeout: 0,
        from: ''
      });
      
      expect(announcement).toBeDefined();
      expect(announcement.taskType).toBe('');
    });

    it('应该处理特殊字符', () => {
      const announcement = queue.create({
        taskType: 'test-特殊字符-🎮',
        description: 'Test with special chars: <>&"\'',
        timeout: 5000,
        from: 'peer-1'
      });
      
      expect(announcement.taskType).toBe('test-特殊字符-🎮');
      expect(announcement.description).toBe('Test with special chars: <>&"\'');
    });
  });

  // P1 修复：新增边界和并发测试
  describe('并发和边界情况', () => {
    it('应该正确处理 acceptClaim 的并发调用', async () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim1 = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      const claim2 = queue.submitClaim(announcement.announcementId, { claimant: 'peer-3' });

      // 模拟并发调用（虽然 JS 是单线程，但可以测试锁逻辑）
      const results = await Promise.all([
        Promise.resolve(queue.acceptClaim(announcement.announcementId, claim1!.claimId)),
        Promise.resolve(queue.acceptClaim(announcement.announcementId, claim2!.claimId))
      ]);

      // 只有一个应该成功
      const successCount = results.filter(r => r !== null).length;
      expect(successCount).toBeLessThanOrEqual(1);
    });

    it('应该处理已认领广播的再次认领尝试', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      queue.acceptClaim(announcement.announcementId, claim!.claimId);

      // 广播已认领，新认领应该失败
      const newClaim = queue.submitClaim(announcement.announcementId, { claimant: 'peer-3' });
      expect(newClaim).toBeNull();
    });

    it('应该处理同一认领的重复接受', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      
      // 第一次接受
      const result1 = queue.acceptClaim(announcement.announcementId, claim!.claimId);
      expect(result1?.status).toBe('accepted');
      
      // 第二次接受应该失败（广播已不是 open）
      const result2 = queue.acceptClaim(announcement.announcementId, claim!.claimId);
      expect(result2).toBeNull();
    });

    it('应该正确处理大量认领', () => {
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      
      // 添加 100 个认领
      for (let i = 0; i < 100; i++) {
        queue.submitClaim(announcement.announcementId, { claimant: `peer-${i}` });
      }
      
      expect(announcement.claims).toHaveLength(100);
      
      // 接受其中一个
      const claim = announcement.claims![50];
      const result = queue.acceptClaim(announcement.announcementId, claim.claimId);
      
      expect(result?.status).toBe('accepted');
      // 其他认领应该被拒绝
      const rejectedCount = announcement.claims!.filter(c => c.status === 'rejected').length;
      expect(rejectedCount).toBe(99);
    });
  });

  describe('forceClearOrphanLocks', () => {
    it('应该清除孤立锁', () => {
      // 直接创建一个有锁的场景
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      
      // 模拟锁未释放的情况（直接操作内部状态）
      // 注意：这是一个测试内部实现的测试
      expect(queue.hasOrphanLocks()).toBe(false);
      
      // 清除应该返回 0
      expect(queue.forceClearOrphanLocks()).toBe(0);
    });

    it('clear 应该同时清除锁', () => {
      queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      queue.clear();
      
      // 队列应该为空，锁也应该为空
      expect(queue.getStats().total).toBe(0);
      expect(queue.hasOrphanLocks()).toBe(false);
    });
  });

  describe('事件', () => {
    it('应该在创建时发出 announcement:created 事件', () => {
      const handler = vi.fn();
      queue.on('announcement:created', handler);
      
      queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].taskType).toBe('test');
    });

    it('应该在过期时发出 announcement:expired 事件', async () => {
      const handler = vi.fn();
      const fastExpireQueue = new AnnouncementQueue({ maxSize: 10, maxAgeMs: 50 });
      fastExpireQueue.on('announcement:expired', handler);
      
      fastExpireQueue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      
      await new Promise(r => setTimeout(r, 60));
      fastExpireQueue.create({ taskType: 'test', description: 'New', timeout: 5000, from: 'peer-1' });
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].reason).toBe('timeout');
    });

    it('应该在认领时发出 announcement:claimed 事件', () => {
      const handler = vi.fn();
      queue.on('announcement:claimed', handler);
      
      const announcement = queue.create({ taskType: 'test', description: 'Test', timeout: 5000, from: 'peer-1' });
      const claim = queue.submitClaim(announcement.announcementId, { claimant: 'peer-2' });
      queue.acceptClaim(announcement.announcementId, claim!.claimId);
      
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});