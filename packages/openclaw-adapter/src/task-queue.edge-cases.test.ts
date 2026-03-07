/**
 * TaskQueue 边界、竞态和幂等性测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueue } from './task-queue.js';
import fs from 'fs';
import path from 'path';

const TEST_DIR = './test-tmp';

describe('TaskQueue 边界问题', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    queue = new TaskQueue({
      maxSize: 5,
      maxAgeMs: 1000,
      persistDir: TEST_DIR,
      persistEnabled: true
    });
  });

  afterEach(() => {
    queue.close();
    // 清理测试目录
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('队列边界', () => {
    it('应该在队列满时抛出错误', () => {
      // 添加 5 个任务（达到上限）
      for (let i = 0; i < 5; i++) {
        queue.add({ taskId: `task-${i}`, taskType: 'test' });
      }

      // 第 6 个应该失败
      expect(() => queue.add({ taskId: 'task-6', taskType: 'test' }))
        .toThrow('Task queue is full');
    });

    it('应该在队列空时返回空数组', () => {
      expect(queue.getPending()).toEqual([]);
      expect(queue.getStats().pending).toBe(0);
    });

    it('应该正确处理 null/undefined 参数', () => {
      // @ts-expect-error 测试边界
      expect(() => queue.add(null)).toThrow();
      // @ts-expect-error 测试边界
      expect(() => queue.add(undefined)).toThrow();
    });
  });

  describe('任务过期清理', () => {
    it('应该清理过期任务', async () => {
      queue.add({ taskId: 'task-1', taskType: 'test' });
      expect(queue.getStats().pending).toBe(1);

      // 等待过期
      await new Promise(r => setTimeout(r, 1100));

      // 触发清理（通过添加新任务）
      queue.add({ taskId: 'task-2', taskType: 'test' });
      
      // 旧任务应该被清理
      expect(queue.get('task-1')).toBeUndefined();
    });
  });

  describe('幂等性', () => {
    it('应该覆盖相同 taskId 的任务', () => {
      queue.add({ taskId: 'task-1', taskType: 'test', description: 'first' });
      queue.add({ taskId: 'task-1', taskType: 'test', description: 'second' });

      const task = queue.get('task-1');
      expect(task?.description).toBe('second');
      expect(queue.getStats().total).toBe(1); // 只有一个任务
    });

    it('应该正确处理重复的 markProcessing', () => {
      queue.add({ taskId: 'task-1', taskType: 'test' });
      
      const first = queue.markProcessing('task-1');
      const second = queue.markProcessing('task-1');

      expect(first?.status).toBe('processing');
      expect(second?.status).toBe('processing');
      expect(queue.getStats().processing).toBe(1);
    });

    it('应该正确处理重复的 complete', () => {
      queue.add({ taskId: 'task-1', taskType: 'test' });
      
      queue.complete('task-1', { status: 'success', result: 'first' });
      queue.complete('task-1', { status: 'success', result: 'second' });

      const task = queue.get('task-1');
      expect(task?.result).toBe('second');
    });
  });

  describe('SQLite 持久化', () => {
    it('应该在关闭后保留任务', () => {
      queue.add({ taskId: 'task-1', taskType: 'test' });
      queue.add({ taskId: 'task-2', taskType: 'test' });
      queue.markProcessing('task-1');

      queue.close();

      // 重新打开
      const newQueue = new TaskQueue({
        maxSize: 5,
        persistDir: TEST_DIR,
        persistEnabled: true
      });

      const stats = newQueue.getStats();
      expect(stats.pending).toBe(1); // task-2
      expect(stats.processing).toBe(1); // task-1

      newQueue.close();
    });
  });
});

describe('并发竞态条件', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue({ maxSize: 1000 });
  });

  afterEach(() => {
    queue.close();
  });

  it('应该正确处理批量添加', () => {
    // add() 是同步方法，不需要 Promise.resolve 包装
    for (let i = 0; i < 100; i++) {
      queue.add({ taskId: `task-${i}`, taskType: 'test' });
    }

    expect(queue.getStats().total).toBe(100);
  });

  it('应该正确处理批量 add 和 getPending', () => {
    // 同步操作，不需要 Promise 包装
    for (let i = 0; i < 50; i++) {
      queue.add({ taskId: `task-${i}`, taskType: 'test' });
      queue.getPending();
    }

    // 最终应该有 50 个任务
    expect(queue.getStats().total).toBe(50);
  });

  it('应该正确处理批量 complete', () => {
    for (let i = 0; i < 50; i++) {
      queue.add({ taskId: `task-${i}`, taskType: 'test' });
    }

    // complete() 是同步方法，不需要 Promise 包装
    for (let i = 0; i < 50; i++) {
      queue.complete(`task-${i}`, { status: 'success' });
    }

    expect(queue.getStats().completed).toBe(50);
  });

  it('应该正确处理 taskId 输入验证', () => {
    // 空字符串应该抛出错误
    expect(() => queue.add({ taskId: '', taskType: 'test' })).toThrow('taskId must be a non-empty string');
    
    // 只有空格的字符串应该抛出错误
    expect(() => queue.add({ taskId: '   ', taskType: 'test' })).toThrow('taskId must be a non-empty string');
    
    // 正常的 taskId 应该成功
    expect(() => queue.add({ taskId: 'valid-task', taskType: 'test' })).not.toThrow();
  });

  it('应该保留重新添加任务的 createdAt 时间戳', () => {
    queue.add({ taskId: 'task-1', taskType: 'test', description: 'first' });
    const originalTask = queue.get('task-1');
    const originalCreatedAt = originalTask?.createdAt;

    // 等待一小段时间
    const start = Date.now();
    while (Date.now() - start < 10) { /* spin */ }

    // 重新添加相同 taskId 的任务
    queue.add({ taskId: 'task-1', taskType: 'test', description: 'second' });
    const updatedTask = queue.get('task-1');

    // createdAt 应该保持不变
    expect(updatedTask?.createdAt).toBe(originalCreatedAt);
    // 但 description 应该更新
    expect(updatedTask?.description).toBe('second');
  });
});