/**
 * TaskQueue 崩溃恢复测试
 * 测试 SQLite 持久化和恢复
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueue } from './task-queue.js';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

describe('TaskQueue 崩溃恢复测试', () => {
  let queue: TaskQueue;
  let testDir: string;

  beforeEach(() => {
    // 为每个测试使用唯一的目录，确保测试隔离
    testDir = `./test-tmp-persistence-${randomUUID()}`;
    fs.mkdirSync(testDir, { recursive: true });
    queue = new TaskQueue({
      maxSize: 1000,
      maxAgeMs: 60000,
      persistDir: testDir,
      persistEnabled: true
    });
  });

  afterEach(() => {
    try {
      queue?.close();
    } catch (e) {
      // 忽略关闭错误
    }
    // 使用唯一目录，清理更可靠
    if (testDir && fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch (e) {
        // 忽略删除错误（可能文件被锁定）
      }
    }
  });

  describe('基本持久化和恢复', () => {
    it('应该在关闭后保留 pending 任务', () => {
      queue.add({ taskId: 'pending-task-1', taskType: 'test', description: 'Pending task' });
      queue.add({ taskId: 'pending-task-2', taskType: 'test', description: 'Pending task 2' });
      
      queue.close();

      // 重新打开
      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      const stats = newQueue.getStats();
      expect(stats.pending).toBe(2);

      const task1 = newQueue.get('pending-task-1');
      expect(task1?.description).toBe('Pending task');
      expect(task1?.status).toBe('pending');

      newQueue.close();
    });

    it('应该在关闭后保留 processing 任务（恢复为 pending）', () => {
      queue.add({ taskId: 'processing-task', taskType: 'test' });
      queue.markProcessing('processing-task');
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      // 恢复后 processing 任务被重置为 pending，避免僵尸任务
      const stats = newQueue.getStats();
      expect(stats.pending).toBe(1);
      expect(stats.processing).toBe(0);

      const task = newQueue.get('processing-task');
      expect(task?.status).toBe('pending');

      newQueue.close();
    });

    it('不应该恢复已完成任务', () => {
      queue.add({ taskId: 'completed-task', taskType: 'test' });
      queue.complete('completed-task', { status: 'success', result: 'done' });
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      const stats = newQueue.getStats();
      expect(stats.completed).toBe(0); // 已完成任务不恢复到内存
      expect(stats.total).toBe(0);

      newQueue.close();
    });

    it('不应该恢复已失败任务', () => {
      queue.add({ taskId: 'failed-task', taskType: 'test' });
      queue.complete('failed-task', { status: 'error', error: 'Something went wrong' });
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      const stats = newQueue.getStats();
      expect(stats.failed).toBe(0);
      expect(stats.total).toBe(0);

      newQueue.close();
    });
  });

  describe('模拟崩溃场景', () => {
    it('应该在未正常关闭后恢复数据', () => {
      queue.add({ taskId: 'crash-task-1', taskType: 'test' });
      queue.add({ taskId: 'crash-task-2', taskType: 'test' });
      queue.markProcessing('crash-task-1');

      // 模拟崩溃：不调用 close()
      // 直接删除队列对象
      // @ts-expect-error 模拟崩溃
      queue = null;

      // 强制 GC（如果可用）
      if (global.gc) {
        global.gc();
      }

      // 重新打开
      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      // 恢复后 processing 任务被重置为 pending，避免僵尸任务
      const stats = newQueue.getStats();
      expect(stats.pending).toBe(2); // crash-task-1 和 crash-task-2
      expect(stats.processing).toBe(0);

      newQueue.close();
    });

    it('应该在部分写入后恢复一致状态', () => {
      // 直接操作数据库模拟部分写入
      const dbPath = path.join(testDir, 'task-queue.db');
      
      queue.add({ taskId: 'partial-1', taskType: 'test' });
      
      // 在事务中途关闭队列
      const db = new Database(dbPath);
      db.exec('BEGIN');
      db.prepare('INSERT INTO tasks (id, task_type, status, created_at) VALUES (?, ?, ?, ?)')
        .run('partial-2', 'test', 'pending', Date.now());
      // 不提交事务，直接关闭
      db.close();

      // 重新打开队列
      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      // partial-2 应该不在（事务未提交）
      const task = newQueue.get('partial-2');
      expect(task).toBeUndefined();

      // partial-1 应该在
      expect(newQueue.get('partial-1')).toBeDefined();

      newQueue.close();
    });

    it('应该处理数据库文件损坏', () => {
      queue.add({ taskId: 'before-corrupt', taskType: 'test' });
      queue.close();

      // 损坏数据库文件
      const dbPath = path.join(testDir, 'task-queue.db');
      fs.writeFileSync(dbPath, 'corrupted data here');

      // 应该能够创建新数据库
      expect(() => {
        const newQueue = new TaskQueue({
          maxSize: 1000,
          persistDir: testDir,
          persistEnabled: true
        });
        newQueue.close();
      }).not.toThrow();
    });
  });

  describe('数据库状态恢复', () => {
    it('应该恢复任务的完整状态', () => {
      const taskData = {
        taskId: 'full-state-task',
        taskType: 'full-test',
        description: 'Full state test',
        parameters: { key: 'value', nested: { data: 123 } }
      };
      
      queue.add(taskData);
      queue.markProcessing('full-state-task');
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      const task = newQueue.get('full-state-task');
      expect(task?.taskType).toBe('full-test');
      expect(task?.description).toBe('Full state test');
      expect(task?.parameters).toEqual({ key: 'value', nested: { data: 123 } });
      // 恢复后 processing 任务被重置为 pending，避免僵尸任务
      expect(task?.status).toBe('pending');

      newQueue.close();
    });

    it('应该恢复 webhook 推送状态', () => {
      queue.add({ taskId: 'webhook-state-task', taskType: 'webhook' });
      queue.markWebhookPushed('webhook-state-task');
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      const task = newQueue.get('webhook-state-task');
      expect(task?.webhookPushed).toBe(true);

      newQueue.close();
    });

    it('应该恢复时间戳', () => {
      const beforeAdd = Date.now();
      queue.add({ taskId: 'timestamp-task', taskType: 'timestamp' });
      queue.markProcessing('timestamp-task');
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      const task = newQueue.get('timestamp-task');
      expect(task?.createdAt).toBeGreaterThanOrEqual(beforeAdd);
      expect(task?.updatedAt).toBeDefined();
      expect(task?.updatedAt).toBeGreaterThanOrEqual(beforeAdd);

      newQueue.close();
    });
  });

  describe('多实例恢复', () => {
    it('应该在多实例间共享数据', () => {
      queue.add({ taskId: 'shared-task', taskType: 'shared' });
      queue.close();

      // 同时打开多个实例（注意：实际中应该避免这种情况）
      const queue1 = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      const task = queue1.get('shared-task');
      expect(task).toBeDefined();

      queue1.close();
    });
  });

  describe('数据库清理', () => {
    it('应该在恢复时忽略已删除的任务', () => {
      queue.add({ taskId: 'to-delete', taskType: 'delete' });
      queue.add({ taskId: 'to-keep', taskType: 'keep' });
      queue.delete('to-delete');
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      expect(newQueue.get('to-delete')).toBeUndefined();
      expect(newQueue.get('to-keep')).toBeDefined();

      newQueue.close();
    });

    it('应该正确处理大量恢复任务', () => {
      // 添加大量任务
      for (let i = 0; i < 100; i++) {
        queue.add({ taskId: `bulk-task-${i}`, taskType: 'bulk' });
      }
      
      // 标记一些为 processing
      for (let i = 0; i < 10; i++) {
        queue.markProcessing(`bulk-task-${i}`);
      }
      
      queue.close();

      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      // 恢复后 processing 任务被重置为 pending，避免僵尸任务
      const stats = newQueue.getStats();
      expect(stats.pending).toBe(100);
      expect(stats.processing).toBe(0);
      expect(stats.total).toBe(100);

      newQueue.close();
    });
  });

  describe('错误恢复', () => {
    it('应该处理无效的 JSON 数据', () => {
      const dbPath = path.join(testDir, 'task-queue.db');
      
      queue.add({ taskId: 'valid-task', taskType: 'test' });
      queue.close();

      // 插入无效 JSON
      const db = new Database(dbPath);
      db.prepare('INSERT INTO tasks (id, task_type, status, created_at, parameters) VALUES (?, ?, ?, ?, ?)')
        .run('invalid-json-task', 'test', 'pending', Date.now(), '{ invalid json }');
      db.close();

      // 应该能够启动并跳过无效数据
      const newQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: testDir,
        persistEnabled: true
      });

      // 有效任务应该存在
      expect(newQueue.get('valid-task')).toBeDefined();

      newQueue.close();
    });

    it('应该处理缺失的列', () => {
      const dbPath = path.join(testDir, 'task-queue.db');
      
      queue.close();

      // 创建一个不同 schema 的表
      const db = new Database(dbPath);
      db.exec('DROP TABLE IF EXISTS tasks');
      db.exec(`
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
          -- 缺少其他列
        )
      `);
      db.prepare('INSERT INTO tasks (id, status, created_at) VALUES (?, ?, ?)')
        .run('minimal-task', 'pending', Date.now());
      db.close();

      // 应该能够处理缺失的列
      expect(() => {
        const newQueue = new TaskQueue({
          maxSize: 1000,
          persistDir: testDir,
          persistEnabled: true
        });
        newQueue.close();
      }).not.toThrow();
    });
  });
});