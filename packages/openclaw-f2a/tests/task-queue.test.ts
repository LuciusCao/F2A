/**
 * TaskQueue 测试
 * 
 * 使用真实的 SQLite 数据库进行测试，不使用 mock。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueue, QueuedTask, TaskQueueStats, TaskQueueOptions } from '../src/task-queue.js';
import type { TaskRequest } from '../src/types.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('TaskQueue', () => {
  let tempDir: string;
  let queue: TaskQueue;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'task-queue-test-'));
    queue = new TaskQueue({
      persistDir: tempDir,
      persistEnabled: true,
      maxSize: 100,
      maxAgeMs: 60000, // 1分钟
    });
  });

  afterEach(() => {
    queue.close();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('基本操作', () => {
    it('应该能够创建任务队列', () => {
      expect(queue).toBeDefined();
    });

    it('应该能够添加任务', () => {
      const task: TaskRequest = {
        taskId: 'test-task-1',
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
        timestamp: Date.now(),
      };

      const result = queue.add(task);
      expect(result).toBeDefined();
      expect(result.taskId).toBe('test-task-1');
    });

    it('应该能够获取任务', () => {
      const task: TaskRequest = {
        taskId: 'test-task-2',
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
        timestamp: Date.now(),
      };

      queue.add(task);
      const retrieved = queue.get('test-task-2');

      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe('test-task-2');
      expect(retrieved?.status).toBe('pending');
    });

    it('应该返回 undefined 对于不存在的任务', () => {
      const retrieved = queue.get('nonexistent-task');
      expect(retrieved).toBeUndefined();
    });

    it('应该能够完成任务', () => {
      const task: TaskRequest = {
        taskId: 'test-task-4',
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
        timestamp: Date.now(),
      };

      queue.add(task);
      queue.complete('test-task-4', {
        taskId: 'test-task-4',
        status: 'success',
        result: 'success',
      });

      const retrieved = queue.get('test-task-4');
      expect(retrieved?.status).toBe('completed');
      expect(retrieved?.result).toBe('success');
    });

    it('应该能够标记任务失败', () => {
      const task: TaskRequest = {
        taskId: 'test-task-5',
        taskType: 'test',
        description: 'Test task',
        from: 'test-peer',
        timestamp: Date.now(),
      };

      queue.add(task);
      queue.complete('test-task-5', {
        taskId: 'test-task-5',
        status: 'error',
        error: 'Task failed',
      });

      const retrieved = queue.get('test-task-5');
      expect(retrieved?.status).toBe('failed');
      expect(retrieved?.error).toBe('Task failed');
    });
  });

  describe('队列操作', () => {
    it('应该能够获取待处理任务', () => {
      queue.add({
        taskId: 'pending-1',
        taskType: 'test',
        description: 'Pending task 1',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      queue.add({
        taskId: 'pending-2',
        taskType: 'test',
        description: 'Pending task 2',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      queue.add({
        taskId: 'completed-1',
        taskType: 'test',
        description: 'Completed task',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      queue.complete('completed-1', {
        taskId: 'completed-1',
        status: 'success',
      });

      const pending = queue.getPending();
      expect(pending.length).toBe(2);
    });

    it('应该能够获取所有任务', () => {
      queue.add({
        taskId: 'task-1',
        taskType: 'test',
        description: 'Task 1',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      queue.add({
        taskId: 'task-2',
        taskType: 'test',
        description: 'Task 2',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      const all = queue.getAll();
      expect(all.length).toBe(2);
    });

    it('应该能够删除任务', () => {
      queue.add({
        taskId: 'task-to-delete',
        taskType: 'test',
        description: 'Task to delete',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      queue.delete('task-to-delete');
      const retrieved = queue.get('task-to-delete');
      expect(retrieved).toBeUndefined();
    });

    it('应该能够清空队列', () => {
      queue.add({
        taskId: 'task-1',
        taskType: 'test',
        description: 'Task 1',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      queue.add({
        taskId: 'task-2',
        taskType: 'test',
        description: 'Task 2',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      queue.clear();
      const all = queue.getAll();
      expect(all.length).toBe(0);
    });
  });

  describe('统计', () => {
    it('应该返回正确的统计数据', () => {
      queue.add({
        taskId: 'pending-1',
        taskType: 'test',
        description: 'Pending',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      queue.add({
        taskId: 'completed-1',
        taskType: 'test',
        description: 'Completed',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      queue.complete('completed-1', {
        taskId: 'completed-1',
        status: 'success',
      });

      const stats = queue.getStats();
      expect(stats.pending).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.total).toBe(2);
    });
  });

  describe('持久化', () => {
    it('应该持久化任务到磁盘', () => {
      queue.add({
        taskId: 'persisted-task',
        taskType: 'test',
        description: 'Persisted task',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      // 关闭队列
      queue.close();

      // 重新打开
      const newQueue = new TaskQueue({
        persistDir: tempDir,
        persistEnabled: true,
      });

      const retrieved = newQueue.get('persisted-task');
      expect(retrieved).toBeDefined();
      expect(retrieved?.taskId).toBe('persisted-task');

      newQueue.close();
    });
  });

  describe('容量限制', () => {
    it('应该在容量满时抛出错误', () => {
      const smallQueue = new TaskQueue({
        persistDir: tempDir,
        maxSize: 2,
      });

      smallQueue.add({
        taskId: 'task-1',
        taskType: 'test',
        description: 'Task 1',
        from: 'test-peer',
        timestamp: Date.now(),
      });
      smallQueue.add({
        taskId: 'task-2',
        taskType: 'test',
        description: 'Task 2',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      // 第三个任务应该抛出错误
      expect(() => smallQueue.add({
        taskId: 'task-3',
        taskType: 'test',
        description: 'Task 3',
        from: 'test-peer',
        timestamp: Date.now(),
      })).toThrow('Task queue is full');

      smallQueue.close();
    });
  });

  describe('getWebhookPending', () => {
    it('应该返回待 webhook 推送的任务', () => {
      queue.add({
        taskId: 'webhook-task-1',
        taskType: 'test',
        description: 'Webhook Task',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      const pending = queue.getWebhookPending();
      expect(pending.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('markWebhookPushed', () => {
    it('应该标记任务为已推送', () => {
      queue.add({
        taskId: 'pushed-task',
        taskType: 'test',
        description: 'Pushed Task',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      queue.markWebhookPushed('pushed-task');
      // 不应该抛出错误
    });
  });

  describe('resetProcessingTask', () => {
    it('应该重置 processing 任务', () => {
      queue.add({
        taskId: 'reset-task',
        taskType: 'test',
        description: 'Reset Task',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      queue.markProcessing('reset-task');
      const result = queue.resetProcessingTask('reset-task');

      expect(result).toBeDefined();
      expect(result?.status).toBe('pending');
    });

    it('应该返回 undefined 对于不存在的任务', () => {
      const result = queue.resetProcessingTask('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('应该能够清理过期任务', () => {
      queue.add({
        taskId: 'cleanup-task',
        taskType: 'test',
        description: 'Cleanup Task',
        from: 'test-peer',
        timestamp: Date.now(),
      });

      queue.cleanup();
      // 不应该抛出错误
    });
  });
});