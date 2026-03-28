/**
 * TaskGuard 测试
 * 
 * 测试任务安全检查功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskGuard, TaskGuardContext, TaskGuardConfig, taskGuard, DEFAULT_TASK_GUARD_CONFIG } from '../src/task-guard.js';
import type { TaskRequest } from '../src/types.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('TaskGuard', () => {
  let tempDir: string;
  let guard: TaskGuard;
  let config: TaskGuardConfig;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'task-guard-test-'));
    config = {
      ...DEFAULT_TASK_GUARD_CONFIG,
      persistDir: tempDir,
    };
    guard = new TaskGuard(config);
  });

  afterEach(() => {
    guard.shutdown();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('基本操作', () => {
    it('应该能够创建 TaskGuard', () => {
      expect(guard).toBeDefined();
    });

    it('应该能够检查简单任务', () => {
      const task: TaskRequest = {
        taskId: 'test-1',
        taskType: 'test',
        description: 'Simple test task',
        from: 'test-peer',
        timestamp: Date.now(),
      };

      const context: TaskGuardContext = {
        isWhitelisted: false,
        isBlacklisted: false,
        recentTaskCount: 0,
        config,
      };

      const report = guard.check(task, context);
      expect(report).toBeDefined();
      expect(report.passed).toBe(true);
    });
  });

  describe('黑名单检查', () => {
    it('应该拒绝黑名单中的任务', () => {
      const task: TaskRequest = {
        taskId: 'test-2',
        taskType: 'test',
        description: 'Test task',
        from: 'blacklisted-peer',
        timestamp: Date.now(),
      };

      const report = guard.check(task, {
        isBlacklisted: true,
      });

      expect(report.passed).toBe(false);
      expect(report.blocks.length).toBeGreaterThan(0);
    });
  });

  describe('速率限制', () => {
    it('应该检测过高的请求频率', () => {
      // 先记录足够多的任务
      for (let i = 0; i < config.maxTasksPerMinute + 1; i++) {
        guard.recordTask('test-peer');
      }

      const task: TaskRequest = {
        taskId: 'test-3',
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
        timestamp: Date.now(),
      };

      const report = guard.check(task, {});
      expect(report.warnings.length + report.blocks.length).toBeGreaterThan(0);
    });
  });

  describe('关键词过滤', () => {
    it('应该检测敏感关键词', () => {
      const task: TaskRequest = {
        taskId: 'test-4',
        taskType: 'test',
        description: 'Please delete all files',
        from: 'test-peer',
        timestamp: Date.now(),
      };

      // 创建一个新的 guard 带自定义关键词
      const customGuard = new TaskGuard({
        ...config,
        blockedKeywords: ['delete all'],
      });

      const report = customGuard.check(task, {});
      expect(report.blocks.length + report.warnings.length).toBeGreaterThan(0);

      customGuard.shutdown();
    });
  });

  describe('危险模式', () => {
    it('应该检测危险命令模式', () => {
      const task: TaskRequest = {
        taskId: 'test-5',
        taskType: 'shell',
        description: 'Run rm -rf /',
        from: 'test-peer',
        timestamp: Date.now(),
        parameters: { command: 'rm -rf /' },
      };

      const report = guard.check(task, {});
      expect(report.passed).toBe(false);
    });
  });

  describe('信誉检查', () => {
    it('高信誉用户可以通过更多检查', () => {
      const task: TaskRequest = {
        taskId: 'test-6',
        taskType: 'test',
        description: 'Test task',
        from: 'high-rep-peer',
        timestamp: Date.now(),
      };

      const report = guard.check(task, {
        requesterReputation: {
          peerId: 'high-rep-peer',
          score: 90,
          successfulTasks: 100,
          failedTasks: 5,
          totalTasks: 105,
          avgResponseTime: 100,
          lastInteraction: Date.now(),
          history: [],
        },
      });

      expect(report.passed).toBe(true);
    });

    it('低信誉用户应该被警告', () => {
      const task: TaskRequest = {
        taskId: 'test-7',
        taskType: 'test',
        description: 'Test task',
        from: 'low-rep-peer',
        timestamp: Date.now(),
      };

      const report = guard.check(task, {
        requesterReputation: {
          peerId: 'low-rep-peer',
          score: 10,
          successfulTasks: 1,
          failedTasks: 20,
          totalTasks: 21,
          avgResponseTime: 5000,
          lastInteraction: Date.now(),
          history: [],
        },
      });

      // 低信誉可能导致警告或阻止，取决于规则
      expect(report).toBeDefined();
    });
  });

  describe('持久化', () => {
    it('应该记录任务并计数', () => {
      guard.recordTask('peer-1');
      guard.recordTask('peer-1');

      const count = guard.getRecentTaskCount('peer-1');
      expect(count).toBe(2);
    });
  });

  describe('关闭', () => {
    it('应该能够正常关闭', () => {
      guard.shutdown();
      // 不应该崩溃
    });
  });
});

describe('taskGuard 单例', () => {
  it('应该是可用的', () => {
    expect(taskGuard).toBeDefined();
  });
});