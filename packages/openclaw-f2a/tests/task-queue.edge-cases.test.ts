/**
 * TaskQueue 边界、竞态和幂等性测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueue } from '../src/task-queue.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// P0-6 修复：使用唯一的临时目录
function createUniqueTestDir(): string {
  return mkdtempSync(join(tmpdir(), 'task-queue-edge-'));
}

describe('TaskQueue 边界问题', () => {
  let queue: TaskQueue;
  let testDir: string;

  beforeEach(() => {
    testDir = createUniqueTestDir();
    queue = new TaskQueue({
      maxSize: 5,
      maxAgeMs: 1000,
      persistDir: testDir,
      persistEnabled: true
    });
  });

  afterEach(() => {
    queue.close();
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
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
        persistDir: testDir,
        persistEnabled: true
      });

      // 恢复后 processing 任务被重置为 pending，避免僵尸任务
      const stats = newQueue.getStats();
      expect(stats.pending).toBe(2); // task-1 和 task-2
      expect(stats.processing).toBe(0);

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
    // P1-10 修复：验证参数错误消息内容
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

// P1 修复：测试僵尸任务重置功能
describe('resetProcessingTask', () => {
  let queue: TaskQueue;
  let testDir: string;

  beforeEach(() => {
    testDir = createUniqueTestDir();
    queue = new TaskQueue({
      maxSize: 5,
      maxAgeMs: 1000,
      persistDir: testDir,
      persistEnabled: true
    });
  });

  afterEach(() => {
    queue.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('应该将 processing 任务重置为 pending', () => {
    queue.add({ taskId: 'task-1', taskType: 'test', from: 'peer-1', timestamp: Date.now(), timeout: 30000 });
    queue.markProcessing('task-1');
    
    expect(queue.get('task-1')?.status).toBe('processing');
    
    const result = queue.resetProcessingTask('task-1');
    
    expect(result?.status).toBe('pending');
    expect(queue.get('task-1')?.status).toBe('pending');
  });

  it('应该只重置 processing 状态的任务', () => {
    queue.add({ taskId: 'task-1', taskType: 'test', from: 'peer-1', timestamp: Date.now(), timeout: 30000 });
    // 任务状态是 pending，不应该被重置
    const result = queue.resetProcessingTask('task-1');
    expect(result).toBeUndefined();
    expect(queue.get('task-1')?.status).toBe('pending');
  });

  it('应该对不存在的任务返回 undefined', () => {
    const result = queue.resetProcessingTask('non-existent');
    expect(result).toBeUndefined();
  });

  it('应该更新 updatedAt 时间戳', () => {
    queue.add({ taskId: 'task-1', taskType: 'test', from: 'peer-1', timestamp: Date.now(), timeout: 30000 });
    queue.markProcessing('task-1');
    
    const beforeReset = Date.now();
    const result = queue.resetProcessingTask('task-1');
    const afterReset = Date.now();
    
    expect(result?.updatedAt).toBeGreaterThanOrEqual(beforeReset);
    expect(result?.updatedAt).toBeLessThanOrEqual(afterReset);
  });

  it('应该在持久化后保持重置状态', () => {
    queue.add({ taskId: 'task-1', taskType: 'test', from: 'peer-1', timestamp: Date.now(), timeout: 30000 });
    queue.markProcessing('task-1');
    queue.resetProcessingTask('task-1');
    queue.close();

    // 创建新队列，应该恢复任务且状态为 pending
    const newQueue = new TaskQueue({
      maxSize: 5,
      maxAgeMs: 1000,
      persistDir: testDir,
      persistEnabled: true
    });
    expect(newQueue.get('task-1')?.status).toBe('pending');
    newQueue.close();
  });
});