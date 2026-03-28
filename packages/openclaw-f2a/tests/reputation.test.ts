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
  });
});