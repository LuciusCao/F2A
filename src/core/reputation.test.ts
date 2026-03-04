/**
 * 信誉系统测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReputationManager, REPUTATION_TIERS, ReputationLevel } from './reputation';

describe('ReputationManager', () => {
  let manager: ReputationManager;

  beforeEach(() => {
    manager = new ReputationManager();
  });

  describe('初始信誉', () => {
    it('should assign initial score of 70', () => {
      const entry = manager.getReputation('peer-1');
      expect(entry.score).toBe(70);
      expect(entry.level).toBe('contributor');
    });

    it('should create same entry for same peer', () => {
      const entry1 = manager.getReputation('peer-1');
      const entry2 = manager.getReputation('peer-1');
      expect(entry1).toBe(entry2);
    });

    it('should create different entries for different peers', () => {
      const entry1 = manager.getReputation('peer-1');
      const entry2 = manager.getReputation('peer-2');
      expect(entry1).not.toBe(entry2);
      expect(entry1.peerId).toBe('peer-1');
      expect(entry2.peerId).toBe('peer-2');
    });
  });

  describe('信誉等级', () => {
    it('should return correct tier for score', () => {
      const tier0 = manager.getTier(10);
      expect(tier0.level).toBe('restricted');

      const tier1 = manager.getTier(30);
      expect(tier1.level).toBe('novice');

      const tier2 = manager.getTier(50);
      expect(tier2.level).toBe('participant');

      const tier3 = manager.getTier(70);
      expect(tier3.level).toBe('contributor');

      const tier4 = manager.getTier(90);
      expect(tier4.level).toBe('core');
    });

    it('should have correct permissions for each tier', () => {
      // restricted
      expect(manager.getTier(10).permissions.canPublish).toBe(false);
      expect(manager.getTier(10).permissions.canExecute).toBe(true);
      expect(manager.getTier(10).permissions.canReview).toBe(false);

      // novice
      expect(manager.getTier(30).permissions.canPublish).toBe(true);
      expect(manager.getTier(30).permissions.canReview).toBe(false);

      // participant+
      expect(manager.getTier(50).permissions.canReview).toBe(true);

      // contributor
      expect(manager.getTier(70).permissions.publishDiscount).toBe(0.9);

      // core
      expect(manager.getTier(90).permissions.publishDiscount).toBe(0.7);
      expect(manager.getTier(90).permissions.publishPriority).toBe(5);
    });
  });

  describe('权限检查', () => {
    it('should check publish permission correctly', () => {
      // 70 分应该可以发布
      expect(manager.hasPermission('peer-1', 'publish')).toBe(true);

      // 降低到受限者
      manager.recordFailure('peer-1', 'task-1', 'test');
      manager.recordFailure('peer-1', 'task-2', 'test');
      manager.recordFailure('peer-1', 'task-3', 'test');
      manager.recordFailure('peer-1', 'task-4', 'test');
      
      // 多次失败后可能降到受限者
      const entry = manager.getReputation('peer-1');
      if (entry.score < 20) {
        expect(manager.hasPermission('peer-1', 'publish')).toBe(false);
      }
    });

    it('should always allow execute permission', () => {
      expect(manager.hasPermission('peer-1', 'execute')).toBe(true);
    });

    it('should check review permission correctly', () => {
      // 70 分是参与者，可以评审
      expect(manager.hasPermission('peer-1', 'review')).toBe(true);
    });
  });

  describe('EWMA 分数更新', () => {
    it('should update score with EWMA on success', () => {
      manager.recordSuccess('peer-1', 'task-1');
      const entry = manager.getReputation('peer-1');
      
      // EWMA: newScore = 0.3 * 80 + 0.7 * 70 = 24 + 49 = 73
      expect(entry.score).toBeCloseTo(73, 1);
    });

    it('should update score with EWMA on failure', () => {
      manager.recordFailure('peer-1', 'task-1', 'test');
      const entry = manager.getReputation('peer-1');
      
      // EWMA: newScore = 0.3 * 50 + 0.7 * 70 = 15 + 49 = 64
      expect(entry.score).toBeCloseTo(64, 1);
    });

    it('should cap score at 100', () => {
      // 多次成功应该封顶在 100
      for (let i = 0; i < 20; i++) {
        manager.recordSuccess('peer-1', `task-${i}`);
      }
      const entry = manager.getReputation('peer-1');
      expect(entry.score).toBeLessThanOrEqual(100);
    });

    it('should not go below 0', () => {
      // 多次失败应该保底在 0
      for (let i = 0; i < 20; i++) {
        manager.recordFailure('peer-1', `task-${i}`, 'test');
      }
      const entry = manager.getReputation('peer-1');
      expect(entry.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('事件历史', () => {
    it('should record success events', () => {
      manager.recordSuccess('peer-1', 'task-1');
      const entry = manager.getReputation('peer-1');
      
      expect(entry.history.length).toBe(2); // initial + success
      expect(entry.history[1].type).toBe('task_success');
      expect(entry.history[1].taskId).toBe('task-1');
    });

    it('should record failure events with reason', () => {
      manager.recordFailure('peer-1', 'task-1', 'timeout');
      const entry = manager.getReputation('peer-1');
      
      expect(entry.history.length).toBe(2);
      expect(entry.history[1].type).toBe('task_failure');
      expect(entry.history[1].reason).toBe('timeout');
    });

    it('should record rejection events', () => {
      manager.recordRejection('peer-1', 'task-1', 'busy');
      const entry = manager.getReputation('peer-1');
      
      expect(entry.history.some(e => e.type === 'task_rejected')).toBe(true);
    });

    it('should record review rewards', () => {
      manager.recordReviewReward('peer-1', 3);
      const entry = manager.getReputation('peer-1');
      
      expect(entry.history.some(e => e.type === 'review_given')).toBe(true);
    });

    it('should record review penalties', () => {
      manager.recordReviewPenalty('peer-1', -5, 'outlier');
      const entry = manager.getReputation('peer-1');
      
      expect(entry.history.some(e => e.type === 'review_penalty')).toBe(true);
    });
  });

  describe('排序和查询', () => {
    it('should return reputations sorted by score', () => {
      manager.recordSuccess('peer-1', 'task-1');
      manager.recordFailure('peer-2', 'task-2', 'test');
      manager.recordSuccess('peer-3', 'task-3');
      manager.recordSuccess('peer-3', 'task-4');

      const all = manager.getAllReputations();
      expect(all[0].score).toBeGreaterThanOrEqual(all[1].score);
      expect(all[1].score).toBeGreaterThanOrEqual(all[2].score);
    });

    it('should filter high reputation nodes', () => {
      // peer-1 保持高信誉
      manager.recordSuccess('peer-1', 'task-1');
      
      // peer-2 降低信誉
      for (let i = 0; i < 5; i++) {
        manager.recordFailure('peer-2', `task-${i}`, 'test');
      }

      const highReputation = manager.getHighReputationNodes(50);
      expect(highReputation.some(e => e.peerId === 'peer-1')).toBe(true);
    });
  });

  describe('发布折扣和优先级', () => {
    it('should return correct publish discount', () => {
      // 70 分是 contributor，折扣 0.9
      expect(manager.getPublishDiscount('peer-1')).toBe(0.9);

      // 提升到 core
      for (let i = 0; i < 10; i++) {
        manager.recordSuccess('peer-1', `task-${i}`);
      }
      const entry = manager.getReputation('peer-1');
      if (entry.level === 'core') {
        expect(manager.getPublishDiscount('peer-1')).toBe(0.7);
      }
    });

    it('should return correct publish priority', () => {
      // 70 分是 contributor，优先级 3
      expect(manager.getPublishPriority('peer-1')).toBe(3);
    });
  });

  describe('自定义配置', () => {
    it('should use custom initial score', () => {
      const customManager = new ReputationManager({ initialScore: 50 });
      const entry = customManager.getReputation('peer-1');
      expect(entry.score).toBe(50);
    });

    it('should use custom alpha for EWMA', () => {
      const customManager = new ReputationManager({ alpha: 0.5 });
      customManager.recordSuccess('peer-1', 'task-1');
      const entry = customManager.getReputation('peer-1');
      
      // EWMA: newScore = 0.5 * 80 + 0.5 * 70 = 40 + 35 = 75
      expect(entry.score).toBeCloseTo(75, 1);
    });
  });
});

describe('REPUTATION_TIERS', () => {
  it('should have 5 tiers', () => {
    expect(REPUTATION_TIERS.length).toBe(5);
  });

  it('should cover all score ranges', () => {
    const levels = REPUTATION_TIERS.map(t => t.level);
    expect(levels).toContain('restricted');
    expect(levels).toContain('novice');
    expect(levels).toContain('participant');
    expect(levels).toContain('contributor');
    expect(levels).toContain('core');
  });
});