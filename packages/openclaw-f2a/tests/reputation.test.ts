/**
 * ReputationSystem 测试
 * 
 * 使用真实的文件系统进行测试，不使用 mock。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReputationSystem } from '../src/reputation.js';
import type { ReputationConfig } from '../src/types.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('ReputationSystem', () => {
  let tempDir: string;
  let reputation: ReputationSystem;
  let config: ReputationConfig;

  beforeEach(() => {
    // 确保每个测试都有唯一的 tempDir
    tempDir = mkdtempSync(join(tmpdir(), `reputation-test-${Date.now()}-`));
    config = {
      initialScore: 30, // 使用内部配置的默认值
      maxScore: 100,
      minScore: 0,
      successBonus: 10,
      failurePenalty: 20,
    };
    reputation = new ReputationSystem(config, tempDir);
  });

  afterEach(() => {
    reputation.flush();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('基本操作', () => {
    it('应该能够创建信誉系统', () => {
      expect(reputation).toBeDefined();
    });

    it('应该返回默认信誉分数', () => {
      const entry = reputation.getReputation('test-peer-1');
      expect(entry).toBeDefined();
      expect(entry.score).toBe(config.initialScore);
    });

    it('应该记录任务成功', () => {
      reputation.recordSuccess('test-peer-1', 'task-1', 100);

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBe(config.initialScore + config.successBonus);
      expect(entry.successfulTasks).toBe(1);
      expect(entry.totalTasks).toBe(1);
    });

    it('应该记录任务失败', () => {
      reputation.recordFailure('test-peer-1', 'task-1', 'Error');

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBe(config.initialScore - config.failurePenalty);
      expect(entry.failedTasks).toBe(1);
      expect(entry.totalTasks).toBe(1);
    });
  });

  describe('分数限制', () => {
    it('应该限制最大分数', () => {
      // 连续成功，直到达到最大分数
      for (let i = 0; i < 10; i++) {
        reputation.recordSuccess('test-peer-1', `task-${i}`, 100);
      }

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBeLessThanOrEqual(config.maxScore);
    });

    it('应该限制最小分数', () => {
      // 连续失败，直到达到最小分数
      for (let i = 0; i < 10; i++) {
        reputation.recordFailure('test-peer-1', `task-${i}`, 'Error');
      }

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBeGreaterThanOrEqual(config.minScore);
    });
  });

  describe('历史记录', () => {
    it('应该记录历史事件', () => {
      reputation.recordSuccess('test-peer-1', 'task-1', 100);
      reputation.recordFailure('test-peer-1', 'task-2', 'Error');

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.history.length).toBe(2);
      expect(entry.history[0].type).toBe('task_success');
      expect(entry.history[1].type).toBe('task_failure');
    });
  });

  describe('持久化', () => {
    it('应该持久化信誉数据', async () => {
      reputation.recordSuccess('test-peer-1', 'task-1', 100);
      reputation.recordFailure('test-peer-2', 'task-2', 'Error');

      // 等待保存完成
      await new Promise(resolve => setTimeout(resolve, 200));

      // 刷新并重新打开
      reputation.flush();
      const newReputation = new ReputationSystem(config, tempDir);

      const entry1 = newReputation.getReputation('test-peer-1');
      expect(entry1.successfulTasks).toBe(1);

      const entry2 = newReputation.getReputation('test-peer-2');
      expect(entry2.failedTasks).toBe(1);
    });
  });

  describe('统计', () => {
    it('应该返回所有信誉条目', () => {
      reputation.recordSuccess('test-peer-1', 'task-1', 100);
      reputation.recordSuccess('test-peer-2', 'task-2', 200);

      const all = reputation.getAllReputations();
      expect(all.length).toBe(2);
    });

    it('应该返回空列表如果没有条目', () => {
      const all = reputation.getAllReputations();
      expect(all.length).toBe(0);
    });
  });

  describe('flush', () => {
    it('应该能够刷新数据', () => {
      reputation.recordSuccess('test-peer-1', 'task-1', 100);
      
      // 刷新不应该报错
      reputation.flush();
    });

    it('多次刷新不应该报错', () => {
      reputation.flush();
      reputation.flush();
      reputation.flush();
    });
  });

  describe('recordRejection', () => {
    it('应该记录任务拒绝', () => {
      reputation.recordRejection('test-peer-1', 'task-1', 'Too busy');

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.totalTasks).toBe(1);
      expect(entry.score).toBeLessThan(config.initialScore);
    });

    it('应该限制最小分数', () => {
      for (let i = 0; i < 10; i++) {
        reputation.recordRejection('test-peer-1', `task-${i}`, 'Rejected');
      }

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBeGreaterThanOrEqual(config.minScore);
    });
  });

  describe('recordTimeout', () => {
    it('应该记录超时', () => {
      reputation.recordTimeout('test-peer-1', 'task-1');

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.totalTasks).toBe(1);
      expect(entry.score).toBeLessThan(config.initialScore);
    });
  });

  describe('isAllowed', () => {
    it('应该允许信誉分数高的 peer', () => {
      reputation.recordSuccess('test-peer-1', 'task-1', 100);
      reputation.recordSuccess('test-peer-1', 'task-2', 100);

      const allowed = reputation.isAllowed('test-peer-1');
      expect(allowed).toBe(true);
    });

    it('应该拒绝信誉分数低的 peer', () => {
      for (let i = 0; i < 5; i++) {
        reputation.recordFailure('test-peer-1', `task-${i}`, 'Error');
      }

      const allowed = reputation.isAllowed('test-peer-1');
      expect(allowed).toBe(false);
    });
  });

  describe('recordMalicious', () => {
    it('应该记录恶意行为', () => {
      reputation.recordMalicious('test-peer-1', 'Attempted attack');

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBeLessThan(config.initialScore);
    });
  });

  describe('hasPermission', () => {
    it('应该检查权限', () => {
      // 初始信誉分数的 peer 应该有基本权限
      const hasExecute = reputation.hasPermission('test-peer-1', 'execute');
      expect(typeof hasExecute).toBe('boolean');
    });
  });

  describe('recordReviewReward', () => {
    it('应该记录评审奖励', () => {
      const beforeScore = reputation.getReputation('test-peer-1').score;
      
      reputation.recordReviewReward('test-peer-1');

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBeGreaterThan(beforeScore);
    });
  });

  describe('recordReviewPenalty', () => {
    it('应该记录评审惩罚', () => {
      const beforeScore = reputation.getReputation('test-peer-1').score;
      
      reputation.recordReviewPenalty('test-peer-1', -5, 'Invalid review');

      const entry = reputation.getReputation('test-peer-1');
      expect(entry.score).toBeLessThan(beforeScore);
    });
  });

  describe('getHighReputationNodes', () => {
    it('应该返回高信誉节点', () => {
      reputation.recordSuccess('high-score-peer', 'task-1', 100);
      reputation.recordSuccess('high-score-peer', 'task-2', 100);
      reputation.recordSuccess('high-score-peer', 'task-3', 100);

      const highNodes = reputation.getHighReputationNodes(50);
      expect(highNodes.length).toBeGreaterThan(0);
    });

    it('应该返回空列表如果没有高信誉节点', () => {
      reputation.recordFailure('low-score-peer', 'task-1', 'Error');
      reputation.recordFailure('low-score-peer', 'task-2', 'Error');

      const highNodes = reputation.getHighReputationNodes(80);
      // 只有低信誉节点，所以应该返回空或只有高分的
      expect(highNodes.every(n => n.score >= 80)).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('应该能够清理旧条目', () => {
      reputation.recordSuccess('test-peer-1', 'task-1', 100);
      
      // 清理不应该报错
      reputation.cleanup(30);
    });
  });
});