/**
 * F2A Task Queue with SQLite Persistence
 * 任务队列 + SQLite 持久化
 */

import type { TaskRequest, TaskResponse } from './types.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

// P1-8 修复：统一使用 logger.ts 的 Logger 接口
import type { Logger } from './logger.js';

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
  /** 日志记录器 */
  logger?: Logger;
}

/** 数据库行类型 */
interface TaskRow {
  id: string;
  task_type: string | null;
  description: string | null;
  parameters: string | null;
  from: string | null;
  timestamp: number | null;
  timeout: number | null;
  status: string;
  created_at: number;
  updated_at: number | null;
  result: string | null;
  error: string | null;
  latency: number | null;
  webhook_pushed: number;
}

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 30000;
/** 最小超时时间（毫秒） */
const MIN_TIMEOUT_MS = 1000;
/** 最大超时时间（毫秒） - 24小时 */
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export class TaskQueue {
  private tasks = new Map<string, QueuedTask>();
  private maxSize: number;
  private maxAgeMs: number;
  private persistEnabled: boolean;
  private cleanupThreshold: number;
  private lastCleanupTime: number = 0;
  private cleanupIntervalMs: number;
  private db?: Database.Database;
  private logger: Logger;

  constructor(options?: TaskQueueOptions) {
    this.maxSize = options?.maxSize || 1000;
    this.maxAgeMs = options?.maxAgeMs || 24 * 60 * 60 * 1000; // 24小时
    this.persistEnabled = options?.persistEnabled ?? true;
    this.cleanupThreshold = options?.cleanupThreshold || 0.8; // 默认 80% 触发清理
    this.logger = options?.logger || console;
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

      // P1 修复：在创建表之前检查数据库完整性
      this.checkDatabaseIntegrity();

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
      this.logger?.warn?.('[F2A:Queue] 数据库初始化失败，将重建', { error: String(e) });
      try {
        if (this.db) {
          this.db.close();
        }
      } catch (closeErr) {
        // 忽略关闭错误，继续重建
        this.logger?.warn?.('[F2A:Queue] 关闭数据库时出错', { error: String(closeErr) });
      }
      
      // 删除损坏的数据库文件
      if (fs.existsSync(dbPath)) {
        // P1 修复：备份损坏的数据库文件，便于后续分析
        const backupPath = `${dbPath}.corrupted.${Date.now()}`;
        try {
          fs.renameSync(dbPath, backupPath);
          this.logger?.info?.('[F2A:Queue] 已备份损坏的数据库', { backupPath });
        } catch (backupErr) {
          // 备份失败，直接删除
          fs.unlinkSync(dbPath);
        }
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
      
      this.logger?.info?.('[F2A:Queue] 数据库已重建');
    }
  }

  /**
   * P1 修复：检查数据库完整性
   * 在恢复数据前验证数据库结构是否正确
   */
  private checkDatabaseIntegrity(): void {
    if (!this.db) return;
    
    try {
      // 运行 SQLite PRAGMA integrity_check
      const result = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      
      if (result.length > 0 && result[0].integrity_check !== 'ok') {
        this.logger?.warn?.('[F2A:Queue] 数据库完整性检查失败', { result: JSON.stringify(result) });
        throw new Error(`Database integrity check failed: ${JSON.stringify(result)}`);
      }
      
      this.logger?.debug?.('[F2A:Queue] 数据库完整性检查通过');
    } catch (e) {
      this.logger?.warn?.('[F2A:Queue] 数据库完整性检查异常', { error: String(e) });
      throw e;
    }
  }

  /**
   * 从数据库恢复任务
   * 
   * P1 修复：尝试逐条恢复有效数据，避免数据库损坏时丢失所有任务
   * P1-Round2 修复：使用事务包装整个 restore 操作，确保状态一致性
   */
  private restore(): void {
    if (!this.db) return;

    // P1-Round2 修复：使用事务包装整个恢复操作
    const restoreTransaction = this.db!.transaction(() => {
      try {
        // 恢复时将 processing 状态的任务重置为 pending，避免僵尸任务
        // 这些任务在崩溃前正在处理，但未完成，需要重新执行
        this.db!.exec(`
          UPDATE tasks SET status = 'pending' WHERE status = 'processing'
        `);

        const rows = this.db!.prepare(`
          SELECT * FROM tasks 
          WHERE status IN ('pending', 'processing')
          ORDER BY created_at ASC
        `).all() as TaskRow[];

      let recoveredCount = 0;
      let skippedCount = 0;

      for (const row of rows) {
        try {
          // 验证必要字段
          if (!row.id || typeof row.id !== 'string') {
            this.logger?.warn?.('[F2A:Queue] 跳过无效记录', { reason: '缺少 id' });
            skippedCount++;
            continue;
          }
          
          if (!row.created_at || typeof row.created_at !== 'number') {
            this.logger?.warn?.('[F2A:Queue] 跳过无效记录', { id: row.id, reason: '缺少 created_at' });
            skippedCount++;
            continue;
          }

          // 检查任务是否过期
          const age = Date.now() - row.created_at;
          if (age > this.maxAgeMs) {
            // 删除过期任务
            this.db!.prepare('DELETE FROM tasks WHERE id = ?').run(row.id);
            skippedCount++;
            continue;
          }

          const task: QueuedTask = {
            taskId: row.id as string,
            taskType: (row.task_type as string) || '',
            description: (row.description as string) || '',
            parameters: this.safeJsonParse(row.parameters) as Record<string, unknown> | undefined,
            from: (row.from as string) || '',
            timestamp: (row.timestamp as number) || Date.now(),
            timeout: (row.timeout as number) || 60000,
            status: (row.status as 'pending' | 'processing' | 'completed' | 'failed') || 'pending',
            createdAt: row.created_at as number,
            updatedAt: (row.updated_at as number) || undefined,
            result: this.safeJsonParse(row.result),
            error: (row.error as string) || undefined,
            latency: (row.latency as number) || undefined,
            webhookPushed: row.webhook_pushed === 1
          };
          
          this.tasks.set(task.taskId, task);
          recoveredCount++;
        } catch (e) {
          this.logger?.warn?.('[F2A:Queue] 跳过无效任务记录', { id: row.id, error: String(e) });
          skippedCount++;
        }
      }

      if (skippedCount > 0) {
          this.logger?.info?.('[F2A:Queue] 恢复完成', { recovered: recoveredCount, skipped: skippedCount });
        } else {
          this.logger?.info?.('[F2A:Queue] 从持久化恢复任务', { count: this.tasks.size });
        }
      } catch (e) {
        // P1 修复：数据库损坏时不清空所有任务，而是尝试逐条恢复
        this.logger?.warn?.('[F2A:Queue] 批量恢复失败，尝试逐条恢复', { error: String(e) });
        
        try {
          // 尝试逐条读取并恢复
          const rows = this.db!.prepare(`SELECT * FROM tasks WHERE status IN ('pending', 'processing')`).all() as TaskRow[];
          
          for (const row of rows) {
            try {
              if (row.id && row.created_at) {
                const task: QueuedTask = {
                  taskId: row.id as string,
                  taskType: (row.task_type as string) || '',
                  description: (row.description as string) || '',
                  parameters: this.safeJsonParse(row.parameters) as Record<string, unknown> | undefined,
                  from: (row.from as string) || '',
                  timestamp: (row.timestamp as number) || Date.now(),
                  timeout: (row.timeout as number) || 60000,
                  status: 'pending', // 恢复时默认设为 pending
                  createdAt: row.created_at as number,
                  updatedAt: (row.updated_at as number) || undefined,
                  result: this.safeJsonParse(row.result),
                  error: (row.error as string) || undefined,
                  latency: (row.latency as number) || undefined,
                  webhookPushed: row.webhook_pushed === 1
                };
                this.tasks.set(task.taskId, task);
              }
            } catch (rowError) {
              // 单条记录恢复失败，跳过并继续
              this.logger?.warn?.('[F2A:Queue] 单条记录恢复失败', { id: row?.id, error: String(rowError) });
            }
          }
          
          this.logger?.info?.('[F2A:Queue] 逐条恢复完成', { count: this.tasks.size });
        } catch (recoverError) {
          // 所有恢复尝试都失败，记录错误但不清空内存
          this.logger?.error?.('[F2A:Queue] 所有恢复尝试失败，将使用空内存队列', { error: String(recoverError) });
          // 注意：这里不清空 this.tasks，保留任何可能已部分恢复的数据
        }
      }
    });
    
    // P1-Round2 修复：在事务外执行恢复
    try {
      restoreTransaction();
    } catch (e) {
      this.logger?.error?.('[F2A:Queue] 恢复事务执行失败', { error: String(e) });
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
      this.logger?.warn?.('[F2A:Queue] JSON 解析失败，跳过', { jsonPreview: json.slice(0, 50) + '...' });
      return undefined;
    }
  }

  /**
   * 添加新任务到队列
   */
  add(request: TaskRequest): QueuedTask {
    // ========== 输入验证（带默认值）==========
    
    // taskId 验证（必须）
    if (!request.taskId || typeof request.taskId !== 'string' || request.taskId.trim() === '') {
      throw new Error('taskId must be a non-empty string');
    }
    
    // from 验证（可选，默认 'unknown'）
    const from = request.from && typeof request.from === 'string' && request.from.trim() 
      ? request.from.trim() 
      : 'unknown';
    
    // timestamp 验证（可选，默认当前时间）
    let timestamp: number;
    if (request.timestamp !== undefined) {
      if (typeof request.timestamp !== 'number' || !Number.isFinite(request.timestamp)) {
        throw new Error('timestamp must be a finite number if provided');
      }
      if (request.timestamp <= 0) {
        throw new Error('timestamp must be positive');
      }
      // timestamp 不能是未来时间（允许 5 分钟的时钟偏差）
      const maxFutureTime = Date.now() + 5 * 60 * 1000;
      if (request.timestamp > maxFutureTime) {
        throw new Error('timestamp cannot be in the future');
      }
      timestamp = request.timestamp;
    } else {
      timestamp = Date.now();
    }
    
    // timeout 验证（可选，默认 DEFAULT_TIMEOUT_MS）
    let timeout: number;
    if (request.timeout !== undefined) {
      if (typeof request.timeout !== 'number' || !Number.isFinite(request.timeout)) {
        throw new Error('timeout must be a finite number if provided');
      }
      if (request.timeout < MIN_TIMEOUT_MS) {
        throw new Error(`timeout must be >= ${MIN_TIMEOUT_MS}ms`);
      }
      if (request.timeout > MAX_TIMEOUT_MS) {
        throw new Error(`timeout cannot exceed ${MAX_TIMEOUT_MS}ms (24 hours)`);
      }
      timeout = request.timeout;
    } else {
      timeout = DEFAULT_TIMEOUT_MS;
    }
    
    // ========== 队列容量管理 ==========

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
    // P0-1 修复：将 existingTask 检查移入事务内，解决竞态条件
    const preservedCreatedAt = Date.now();

    // 使用事务确保原子性（解决竞态条件）
    if (this.db) {
      const insertTask = this.db!.transaction(() => {
        // P0-1 修复：在事务开始时重新获取 existingTask，避免竞态
        const existingTaskInTransaction = this.tasks.get(request.taskId);
        const actualCreatedAt = existingTaskInTransaction?.createdAt ?? Date.now();

        // 在事务内检查队列大小（原子操作）
        // 只有新任务才需要检查容量
        if (!existingTaskInTransaction) {
          const count = this.db!.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
          if (count.count >= this.maxSize) {
            throw new Error('Task queue is full');
          }
        }

        const task: QueuedTask = {
          ...request,
          from,
          timestamp,
          timeout,
          status: 'pending',
          createdAt: actualCreatedAt,
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
    // 先检查是否已存在（原子操作）
    const existingTaskMemory = this.tasks.get(request.taskId);
    // 注意：对于新任务才检查容量限制
    if (!existingTaskMemory && this.tasks.size >= this.maxSize) {
      throw new Error('Task queue is full');
    }

    const task: QueuedTask = {
      ...request,
      from,
      timestamp,
      timeout,
      status: 'pending',
      createdAt: existingTaskMemory?.createdAt ?? preservedCreatedAt,
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
   * P1 修复：重置 processing 任务为 pending
   * 用于处理因异常导致的僵尸任务
   */
  resetProcessingTask(taskId: string): QueuedTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'processing') return undefined;

    task.status = 'pending';
    task.updatedAt = Date.now();

    if (this.db) {
      const updateTransaction = this.db!.transaction(() => {
        this.db!.prepare(`
          UPDATE tasks SET status = 'pending', updated_at = ? WHERE id = ?
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
   * 同时清理已完成/失败的任务以腾出空间
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, task] of this.tasks) {
      const age = now - task.createdAt;
      
      // 清理过期任务
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
    
    // 如果队列接近满，清理已完成和失败的任务
    const highWatermark = Math.floor(this.maxSize * 0.9);
    if (this.tasks.size >= highWatermark) {
      // P2-Round2 修复：创建快照后再排序，避免并发修改问题
      // 先收集已完成/失败的任务信息
      const completedAndFailedSnapshot: Array<{ id: string; updatedAt: number; createdAt: number }> = [];
      
      for (const [id, task] of this.tasks) {
        if (task.status === 'completed' || task.status === 'failed') {
          // P2-Round2 修复：处理 undefined 情况，使用安全默认值
          const updatedAt = task.updatedAt ?? task.createdAt ?? 0;
          const createdAt = task.createdAt ?? 0;
          completedAndFailedSnapshot.push({ id, updatedAt, createdAt });
        }
      }
      
      // 按更新时间排序，优先删除旧的已完成/失败任务
      // 在快照上排序，避免并发问题
      completedAndFailedSnapshot.sort((a, b) => {
        // P2-Round2 修复：已在收集时处理 undefined，这里直接使用
        return a.updatedAt - b.updatedAt;
      });
      
      // 删除足够多的任务以腾出空间
      const targetSize = Math.floor(this.maxSize * 0.7);
      const toRemoveCount = Math.max(0, this.tasks.size - targetSize);
      const toRemove = completedAndFailedSnapshot.slice(0, toRemoveCount).map(item => item.id);
      
      for (const id of toRemove) {
        this.tasks.delete(id);
        if (this.db) {
          this.db!.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        }
      }
      
      if (toRemove.length > 0) {
        this.logger?.info?.('[F2A:Queue] 清理已完成/失败任务以释放空间', { count: toRemove.length });
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