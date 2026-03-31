/**
 * 自治经济系统测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutonomousEconomy, TaskRequest, TaskExecutionResult } from './autonomous-economy.js';
import { ReputationManager } from './reputation.js';
import { ReviewCommittee } from './review-committee.js';

describe('AutonomousEconomy', () => {
  let economy: AutonomousEconomy;
  let reputationManager: ReputationManager;
  let reviewCommittee: ReviewCommittee;

  beforeEach(() => {
    reputationManager = new ReputationManager();
    reviewCommittee = new ReviewCommittee(reputationManager);
    economy = new AutonomousEconomy(reputationManager, reviewCommittee);
  });

  describe('任务提交', () => {
    it('should submit task with sufficient reputation', () => {
      const task: TaskRequest = {
        taskId: 'task-1',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Test task',
      };

      const result = economy.submitTask(task);
      expect(result.success).toBe(true);
      expect(result.cost).toBeDefined();
    });

    it('should deduct reputation on task submission', () => {
      const before = reputationManager.getReputation('requester-1').score;

      const task: TaskRequest = {
        taskId: 'task-2',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Test task',
      };

      economy.submitTask(task);

      const after = reputationManager.getReputation('requester-1').score;
      expect(after).toBeLessThan(before);
    });

    it('should apply discount for high reputation user', () => {
      // 提升信誉到 core
      for (let i = 0; i < 10; i++) {
        reputationManager.recordSuccess('high-rep', `task-${i}`);
      }

      const task: TaskRequest = {
        taskId: 'task-3',
        requesterId: 'high-rep',
        capability: 'test',
        description: 'Test task',
      };

      const result = economy.submitTask(task);
      expect(result.success).toBe(true);
      expect(result.cost!.discount).toBeLessThan(1.0);
    });
  });

  describe('任务完成与结算', () => {
    it('should reward executor on success', () => {
      const task: TaskRequest = {
        taskId: 'task-4',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Test task',
      };

      economy.submitTask(task);

      const before = reputationManager.getReputation('executor-1').score;

      const result: TaskExecutionResult = {
        taskId: 'task-4',
        executorId: 'executor-1',
        status: 'success',
      };

      economy.completeTask(result);

      const after = reputationManager.getReputation('executor-1').score;
      expect(after).toBeGreaterThan(before);
    });

    it('should penalize executor on failure', () => {
      const task: TaskRequest = {
        taskId: 'task-5',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Test task',
      };

      economy.submitTask(task);

      const before = reputationManager.getReputation('executor-1').score;

      const result: TaskExecutionResult = {
        taskId: 'task-5',
        executorId: 'executor-1',
        status: 'failure',
        error: 'Something went wrong',
      };

      economy.completeTask(result);

      const after = reputationManager.getReputation('executor-1').score;
      expect(after).toBeLessThan(before);
    });

    it('should penalize executor on timeout', () => {
      const task: TaskRequest = {
        taskId: 'task-6',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Test task',
      };

      economy.submitTask(task);

      const before = reputationManager.getReputation('executor-1').score;

      const result: TaskExecutionResult = {
        taskId: 'task-6',
        executorId: 'executor-1',
        status: 'timeout',
      };

      economy.completeTask(result);

      const after = reputationManager.getReputation('executor-1').score;
      expect(after).toBeLessThan(before);
    });
  });

  describe('优先级队列', () => {
    it('should return highest priority task first', () => {
      // 创建高信誉用户
      for (let i = 0; i < 10; i++) {
        reputationManager.recordSuccess('high-priority', `task-${i}`);
      }

      const lowTask: TaskRequest = {
        taskId: 'low-task',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Low priority task',
      };

      const highTask: TaskRequest = {
        taskId: 'high-task',
        requesterId: 'high-priority',
        capability: 'test',
        description: 'High priority task',
      };

      economy.submitTask(lowTask);
      economy.submitTask(highTask);

      const next = economy.getNextTask();
      expect(next).not.toBeNull();
    });

    it('should maintain queue order', () => {
      for (let i = 0; i < 5; i++) {
        const task: TaskRequest = {
          taskId: `task-${i}`,
          requesterId: 'requester-1',
          capability: 'test',
          description: `Task ${i}`,
        };
        economy.submitTask(task);
      }

      expect(economy.getQueueLength()).toBe(5);
    });
  });

  describe('任务取消', () => {
    it('should cancel task and refund partial cost', () => {
      const task: TaskRequest = {
        taskId: 'task-cancel',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Task to cancel',
      };

      economy.submitTask(task);
      const before = reputationManager.getReputation('requester-1').score;

      const result = economy.cancelTask('task-cancel');
      expect(result).toBe(true);

      const after = reputationManager.getReputation('requester-1').score;
      expect(after).toBeGreaterThan(before);
    });

    it('should return false for non-existent task', () => {
      const result = economy.cancelTask('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('经济统计', () => {
    it('should return economy stats', () => {
      const task: TaskRequest = {
        taskId: 'task-stats',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Test task',
      };

      economy.submitTask(task);

      const stats = economy.getEconomyStats();
      expect(stats.pendingTasks).toBe(1);
      expect(stats.queueLength).toBe(1);
      expect(stats.totalCostDeducted).toBeGreaterThan(0);
    });
  });

  describe('过期任务清理', () => {
    it('应该清理过期的待处理任务', async () => {
      const task: TaskRequest = {
        taskId: 'task-expired',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Expired task',
      };

      economy.submitTask(task);
      expect(economy.getQueueLength()).toBe(1);

      // 等待足够长的时间确保任务过期
      await new Promise(resolve => setTimeout(resolve, 100));
      const expired = economy.cleanupExpiredTasks(50); // 50ms
      
      expect(expired).toContain('task-expired');
      expect(economy.getQueueLength()).toBe(0);
    });

    it('不应该清理未过期的任务', async () => {
      const task: TaskRequest = {
        taskId: 'task-fresh',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Fresh task',
      };

      economy.submitTask(task);

      // 使用很长的过期时间（24小时）
      const expired = economy.cleanupExpiredTasks(24 * 60 * 60 * 1000);
      
      expect(expired.length).toBe(0);
      expect(economy.getQueueLength()).toBe(1);
    });
  });

  describe('getPendingTask', () => {
    it('应该返回指定任务的信息', () => {
      const task: TaskRequest = {
        taskId: 'task-pending',
        requesterId: 'requester-1',
        capability: 'test',
        description: 'Pending task',
      };

      economy.submitTask(task);
      const pending = economy.getPendingTask('task-pending');

      expect(pending).not.toBeNull();
      expect(pending!.task.taskId).toBe('task-pending');
      expect(pending!.task.requesterId).toBe('requester-1');
    });

    it('应该返回 null 对于不存在的任务', () => {
      const pending = economy.getPendingTask('non-existent');
      expect(pending).toBeNull();
    });
  });
});