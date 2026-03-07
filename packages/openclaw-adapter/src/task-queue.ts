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
  /** 清理阈值比例（当队列大小超过 maxSize * cleanupThreshold 时触发清理，默认 0.8） */
  cleanupThreshold?: number;
}

export class TaskQueue {
  private tasks = new Map<string, QueuedTask>();
  private maxSize: number;
  private maxAgeMs: number;
  private persistEnabled: boolean;
  private cleanupThreshold: number;
  private lastCleanupTime: number = 0;
  private cleanupIntervalMs: number;
  private db?: Database.Database;

  constructor(options?: TaskQueueOptions) {
    this.maxSize = options?.maxSize || 1000;
    this.maxAgeMs = options?.maxAgeMs || 24 * 60 * 60 * 1000; // 24小时
    this.persistEnabled = options?.persistEnabled ?? true;
    this.cleanupThreshold = options?.cleanupThreshold || 0.8; // 默认 80% 触发清理
    // 清理间隔：至少每 maxAgeMs/10 时间执行一次清理检查
    this.cleanupIntervalMs = Math.min(this.maxAgeMs / 10, 60000); // 最多 1 分钟

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
    
    try {
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
    } catch (e) {
      // 数据库损坏或无法访问，删除并重新创建
      console.warn(`[TaskQueue] 数据库初始化失败，将重建: ${e}`);
      try {
        if (this.db) {
          this.db.close();
        }
      } catch {}
      
      // 删除损坏的数据库文件
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      
      // 重新创建
      this.db = new Database(dbPath);
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
      
      console.log('[TaskQueue] 数据库已重建');
    }
  }

  /**
   * 从数据库恢复任务
   */
  private restore(): void {
    if (!this.db) return;

    try {
      // 恢复时将 processing 状态的任务重置为 pending，避免僵尸任务
      // 这些任务在崩溃前正在处理，但未完成，需要重新执行
      this.db.exec(`
        UPDATE tasks SET status = 'pending' WHERE status = 'processing'
      `);

      const rows = this.db.prepare(`
        SELECT * FROM tasks 
        WHERE status IN ('pending', 'processing')
        ORDER BY created_at ASC
      `).all() as any[];

      for (const row of rows) {
        try {
          const task: QueuedTask = {
            taskId: row.id,
            taskType: row.task_type,
            description: row.description,
            parameters: this.safeJsonParse(row.parameters),
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            result: this.safeJsonParse(row.result),
            error: row.error,
            latency: row.latency,
            webhookPushed: row.webhook_pushed === 1
          };
          this.tasks.set(task.taskId, task);
        } catch (e) {
          console.warn(`[TaskQueue] 跳过无效任务记录: ${row.id}`, e);
        }
      }

      console.log(`[TaskQueue] Restored ${this.tasks.size} tasks from persistence`);
    } catch (e) {
      console.warn('[TaskQueue] 恢复任务失败，将使用空队列', e);
      this.tasks.clear();
    }
  }

  /**
   * 安全解析 JSON，失败返回 undefined
   */
  private safeJsonParse(json: string | null | undefined): unknown {
    if (!json) return undefined;
    try {
      return JSON.parse(json);
    } catch {
      console.warn(`[TaskQueue] JSON 解析失败，跳过: ${json.slice(0, 50)}...`);
      return undefined;
    }
  }

  /**
   * 添加新任务到队列
   */
  add(request: TaskRequest): QueuedTask {
    // 输入验证：taskId 必须是非空字符串
    if (!request.taskId || typeof request.taskId !== 'string' || request.taskId.trim() === '') {
      throw new Error('taskId must be a non-empty string');
    }

    // 智能清理策略：
    // 1. 队列大小超过阈值时触发完整清理
    // 2. 距离上次清理超过清理间隔时触发清理
    const now = Date.now();
    const cleanupTriggerSize = Math.floor(this.maxSize * this.cleanupThreshold);
    const shouldCleanup = 
      this.tasks.size >= cleanupTriggerSize ||
      (now - this.lastCleanupTime) > this.cleanupIntervalMs;

    if (shouldCleanup) {
      this.cleanup();
      this.lastCleanupTime = now;
    }

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
      // 使用事务确保内存和数据库状态一致
      const updateTransaction = this.db!.transaction(() => {
        this.db!.prepare(`
          UPDATE tasks SET status = 'processing', updated_at = ? WHERE id = ?
        `).run(task.updatedAt, taskId);
      });
      updateTransaction();
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
      // 使用事务确保内存和数据库状态一致
      const updateTransaction = this.db!.transaction(() => {
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
      });
      updateTransaction();
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