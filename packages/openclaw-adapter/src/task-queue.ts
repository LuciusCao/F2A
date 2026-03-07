/**
 * F2A Task Queue with SQLite Persistence
 * 任务队列 + SQLite 持久化
 */

import type { TaskRequest, TaskResponse } from './types.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

export interface QueuedTask extends TaskRequest {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  updatedAt?: number;
  result?: unknown;
  error?: string;
  latency?: number;
  webhookPushed?: boolean;  // 是否已通过 webhook 推送
}

export interface TaskQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  webhookPending: number;  // 待 webhook 推送的任务数
}

export interface TaskQueueOptions {
  maxSize?: number;
  maxAgeMs?: number;
  persistDir?: string;  // 持久化目录
  persistEnabled?: boolean;
}

export class TaskQueue {
  private tasks = new Map<string, QueuedTask>();
  private maxSize: number;
  private maxAgeMs: number;
  private persistEnabled: boolean;
  private db?: Database.Database;

  constructor(options?: TaskQueueOptions) {
    this.maxSize = options?.maxSize || 1000;
    this.maxAgeMs = options?.maxAgeMs || 24 * 60 * 60 * 1000; // 24小时
    this.persistEnabled = options?.persistEnabled ?? true;

    if (this.persistEnabled && options?.persistDir) {
      this.initPersistence(options.persistDir);
    }
  }

  /**
   * 初始化 SQLite 持久化
   */
  private initPersistence(persistDir: string): void {
    // 确保目录存在
    if (!fs.existsSync(persistDir)) {
      fs.mkdirSync(persistDir, { recursive: true });
    }

    const dbPath = path.join(persistDir, 'task-queue.db');
    this.db = new Database(dbPath);

    // 创建表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        task_type TEXT,
        description TEXT,
        parameters TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        result TEXT,
        error TEXT,
        latency INTEGER,
        webhook_pushed INTEGER DEFAULT 0
      );
      
      CREATE INDEX IF NOT EXISTS idx_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_created ON tasks(created_at);
    `);

    // 恢复未完成的任务到内存
    this.restore();
  }

  /**
   * 从数据库恢复任务
   */
  private restore(): void {
    if (!this.db) return;

    const rows = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE status IN ('pending', 'processing')
      ORDER BY created_at ASC
    `).all() as any[];

    for (const row of rows) {
      const task: QueuedTask = {
        taskId: row.id,
        taskType: row.task_type,
        description: row.description,
        parameters: row.parameters ? JSON.parse(row.parameters) : undefined,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        result: row.result ? JSON.parse(row.result) : undefined,
        error: row.error,
        latency: row.latency,
        webhookPushed: row.webhook_pushed === 1
      };
      this.tasks.set(task.taskId, task);
    }

    console.log(`[TaskQueue] Restored ${rows.length} tasks from persistence`);
  }

  /**
   * 添加新任务到队列
   */
  add(request: TaskRequest): QueuedTask {
    // 输入验证：taskId 必须是非空字符串
    if (!request.taskId || typeof request.taskId !== 'string' || request.taskId.trim() === '') {
      throw new Error('taskId must be a non-empty string');
    }

    // 清理旧任务
    this.cleanup();

    // 检查是否为重复添加（保留原 createdAt）
    const existingTask = this.tasks.get(request.taskId);
    const preservedCreatedAt = existingTask?.createdAt ?? Date.now();

    // 使用事务确保原子性（解决竞态条件）
    if (this.db) {
      const insertTask = this.db!.transaction(() => {
        // 在事务内检查队列大小（原子操作）
        const count = this.db!.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
        if (count.count >= this.maxSize && !existingTask) {
          throw new Error('Task queue is full');
        }

        const task: QueuedTask = {
          ...request,
          status: 'pending',
          createdAt: preservedCreatedAt,
          webhookPushed: false
        };

        this.db!.prepare(`
          INSERT OR REPLACE INTO tasks 
          (id, task_type, description, parameters, status, created_at, webhook_pushed)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(
          task.taskId,
          task.taskType || null,
          task.description || null,
          task.parameters ? JSON.stringify(task.parameters) : null,
          task.status,
          task.createdAt
        );

        return task;
      });

      const task = insertTask();
      // 同步内存状态
      this.tasks.set(request.taskId, task);
      return task;
    }

    // 无 DB 时，在内存中检查队列是否已满
    // 注意：对于新任务才检查容量限制
    if (!existingTask && this.tasks.size >= this.maxSize) {
      throw new Error('Task queue is full');
    }

    const task: QueuedTask = {
      ...request,
      status: 'pending',
      createdAt: preservedCreatedAt,
      webhookPushed: false
    };

    this.tasks.set(request.taskId, task);
    return task;
  }

  /**
   * 获取待处理任务
   */
  getPending(limit: number = 10): QueuedTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }

  /**
   * 获取待 webhook 推送的任务
   */
  getWebhookPending(): QueuedTask[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'pending' && !t.webhookPushed)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 标记任务为已推送 webhook
   */
  markWebhookPushed(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.webhookPushed = true;
    task.updatedAt = Date.now();

    if (this.db) {
      this.db!.prepare(`
        UPDATE tasks SET webhook_pushed = 1, updated_at = ? WHERE id = ?
      `).run(task.updatedAt, taskId);
    }
  }

  /**
   * 标记任务为处理中
   */
  markProcessing(taskId: string): QueuedTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    task.status = 'processing';
    task.updatedAt = Date.now();

    if (this.db) {
      this.db!.prepare(`
        UPDATE tasks SET status = 'processing', updated_at = ? WHERE id = ?
      `).run(task.updatedAt, taskId);
    }

    return task;
  }

  /**
   * 完成任务
   */
  complete(taskId: string, response: TaskResponse): QueuedTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    if (response.status === 'success') {
      task.status = 'completed';
      task.result = response.result;
    } else {
      task.status = 'failed';
      task.error = response.error;
    }

    task.latency = response.latency;
    task.updatedAt = Date.now();

    if (this.db) {
      this.db!.prepare(`
        UPDATE tasks 
        SET status = ?, result = ?, error = ?, latency = ?, updated_at = ?
        WHERE id = ?
      `).run(
        task.status,
        task.result ? JSON.stringify(task.result) : null,
        task.error || null,
        task.latency || null,
        task.updatedAt,
        taskId
      );
    }

    return task;
  }

  /**
   * 获取任务
   */
  get(taskId: string): QueuedTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 删除任务
   */
  delete(taskId: string): boolean {
    const deleted = this.tasks.delete(taskId);
    
    if (deleted && this.db) {
      this.db!.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    }

    return deleted;
  }

  /**
   * 获取队列统计
   */
  getStats(): TaskQueueStats {
    const tasks = Array.from(this.tasks.values());
    return {
      pending: tasks.filter(t => t.status === 'pending').length,
      processing: tasks.filter(t => t.status === 'processing').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      total: tasks.length,
      webhookPending: tasks.filter(t => t.status === 'pending' && !t.webhookPushed).length
    };
  }

  /**
   * 获取所有任务
   */
  getAll(): QueuedTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 清理过期任务
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, task] of this.tasks) {
      const age = now - task.createdAt;
      if (age > this.maxAgeMs) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.tasks.delete(id);
      if (this.db) {
        this.db!.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      }
    }
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.tasks.clear();
    if (this.db) {
      this.db!.exec('DELETE FROM tasks');
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }
}