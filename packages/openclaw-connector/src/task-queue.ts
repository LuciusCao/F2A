/**
 * F2A Task Queue
 * 管理待处理和已完成的远程任务
 */

import type { TaskRequest, TaskResponse } from './types.js';

export interface QueuedTask extends TaskRequest {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  updatedAt?: number;
  result?: unknown;
  error?: string;
  latency?: number;
}

export interface TaskQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export class TaskQueue {
  private tasks = new Map<string, QueuedTask>();
  private maxSize: number;
  private maxAgeMs: number;

  constructor(options?: { maxSize?: number; maxAgeMs?: number }) {
    this.maxSize = options?.maxSize || 1000;
    this.maxAgeMs = options?.maxAgeMs || 24 * 60 * 60 * 1000; // 24小时
  }

  /**
   * 添加新任务到队列
   */
  add(request: TaskRequest): QueuedTask {
    // 清理旧任务
    this.cleanup();

    // 检查队列是否已满
    if (this.tasks.size >= this.maxSize) {
      throw new Error('Task queue is full');
    }

    const task: QueuedTask = {
      ...request,
      status: 'pending',
      createdAt: Date.now()
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
   * 标记任务为处理中
   */
  markProcessing(taskId: string): QueuedTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    task.status = 'processing';
    task.updatedAt = Date.now();
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
    return this.tasks.delete(taskId);
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
      total: tasks.length
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
    for (const [id, task] of this.tasks) {
      const age = now - task.createdAt;
      if (age > this.maxAgeMs) {
        this.tasks.delete(id);
      }
    }
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.tasks.clear();
  }
}

// 导出单例实例
export const taskQueue = new TaskQueue();
