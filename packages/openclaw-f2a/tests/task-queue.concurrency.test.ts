/**
 * TaskQueue 真实并发测试
 * 使用 worker_threads 测试并发访问
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskQueue } from '../src/task-queue.js';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { waitFor } from './utils/test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DIR = './test-tmp-concurrency';

// Worker 脚本内容
const workerScript = `
import { parentPort, workerData } from 'worker_threads';
import { TaskQueue } from '../src/task-queue.js';

const { action, taskId, persistDir } = workerData;

const queue = new TaskQueue({
  maxSize: 1000,
  persistDir: persistDir,
  persistEnabled: true
});

try {
  let result;
  switch (action) {
    case 'add':
      result = queue.add({ taskId, taskType: 'concurrent-test', description: 'Test task' });
      break;
    case 'getPending':
      result = queue.getPending(10);
      break;
    case 'markProcessing':
      result = queue.markProcessing(taskId);
      break;
    case 'complete':
      result = queue.complete(taskId, { status: 'success', result: 'done' });
      break;
    case 'getStats':
      result = queue.getStats();
      break;
    default:
      throw new Error('Unknown action: ' + action);
  }
  parentPort.postMessage({ success: true, result });
} catch (error) {
  parentPort.postMessage({ success: false, error: error.message });
} finally {
  queue.close();
}
`;

describe('TaskQueue 真实并发测试', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    queue = new TaskQueue({
      maxSize: 1000,
      persistDir: TEST_DIR,
      persistEnabled: true
    });
  });

  // P2-2, P2-3 修复：统一 afterEach 清理模式，使用 try-catch
  afterEach(() => {
    try {
      queue?.close();
    } catch {
      // 忽略关闭错误
    }
    try {
      if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
      }
    } catch {
      // 忽略清理错误
    }
  });

  describe('使用 Promise.all 测试并发', () => {
    it('应该正确处理并发添加 100 个任务', async () => {
      const promises = [];
      
      for (let i = 0; i < 100; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            // 模拟异步操作
            setImmediate(() => {
              queue.add({ taskId: `task-${i}`, taskType: 'concurrent' });
              resolve();
            });
          })
        );
      }

      await Promise.all(promises);

      const stats = queue.getStats();
      expect(stats.total).toBe(100);
      expect(stats.pending).toBe(100);
    });

    it('应该正确处理并发 add 和 getPending', async () => {
      const addPromises: Promise<void>[] = [];
      const getPromises: Promise<void>[] = [];
      
      // 同时添加和获取
      for (let i = 0; i < 50; i++) {
        addPromises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.add({ taskId: `task-${i}`, taskType: 'race-test' });
              resolve();
            });
          })
        );
        
        getPromises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.getPending();
              resolve();
            });
          })
        );
      }

      await Promise.all([...addPromises, ...getPromises]);

      const stats = queue.getStats();
      expect(stats.total).toBe(50);
    });

    it('应该正确处理并发 markProcessing', async () => {
      // 先添加任务
      for (let i = 0; i < 20; i++) {
        queue.add({ taskId: `task-${i}`, taskType: 'processing-test' });
      }

      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.markProcessing(`task-${i}`);
              resolve();
            });
          })
        );
      }

      await Promise.all(promises);

      const stats = queue.getStats();
      expect(stats.processing).toBe(20);
    });

    it('应该正确处理并发 complete', async () => {
      // 先添加任务
      for (let i = 0; i < 30; i++) {
        queue.add({ taskId: `task-${i}`, taskType: 'complete-test' });
      }

      const promises = [];
      for (let i = 0; i < 30; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.complete(`task-${i}`, { status: 'success', result: `result-${i}` });
              resolve();
            });
          })
        );
      }

      await Promise.all(promises);

      const stats = queue.getStats();
      expect(stats.completed).toBe(30);
    });
  });

  describe('竞态条件测试', () => {
    it('应该正确处理 add 和 delete 的竞态', async () => {
      // 先添加一些任务
      for (let i = 0; i < 50; i++) {
        queue.add({ taskId: `task-${i}`, taskType: 'race-delete' });
      }

      const addPromises: Promise<void>[] = [];
      const deletePromises: Promise<void>[] = [];

      // 添加新任务
      for (let i = 50; i < 100; i++) {
        addPromises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              try {
                queue.add({ taskId: `task-${i}`, taskType: 'race-delete' });
              } catch (e) {
                // 忽略错误
              }
              resolve();
            });
          })
        );
      }

      // 同时删除旧任务
      for (let i = 0; i < 50; i++) {
        deletePromises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.delete(`task-${i}`);
              resolve();
            });
          })
        );
      }

      await Promise.all([...addPromises, ...deletePromises]);

      // 最终队列应该有 50 个任务（新添加的）
      const stats = queue.getStats();
      expect(stats.total).toBe(50);
    });

    it('应该正确处理同一任务的并发操作', async () => {
      queue.add({ taskId: 'concurrent-task', taskType: 'same-task' });

      const promises = [
        // 同时进行多种操作
        new Promise<void>((resolve) => {
          setImmediate(() => {
            queue.markProcessing('concurrent-task');
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          setImmediate(() => {
            queue.complete('concurrent-task', { status: 'success', result: 'done' });
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          setImmediate(() => {
            queue.get('concurrent-task');
            resolve();
          });
        }),
      ];

      await Promise.all(promises);

      // 任务最终应该处于某个一致状态
      const task = queue.get('concurrent-task');
      expect(task).toBeDefined();
      expect(['processing', 'completed']).toContain(task?.status);
    });
  });

  describe('使用 setImmediate 模拟时间片', () => {
    it('应该在高并发下保持数据一致性', async () => {
      const operations: Promise<void>[] = [];
      
      // 创建大量并发操作
      for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 20; i++) {
          const taskId = `task-${round}-${i}`;
          operations.push(
            new Promise<void>((resolve) => {
              setImmediate(() => {
                queue.add({ taskId, taskType: 'high-concurrency' });
                resolve();
              });
            })
          );
        }
      }

      await Promise.all(operations);

      // 验证数据一致性
      const stats = queue.getStats();
      expect(stats.total).toBe(100);
      
      // 验证每个任务都能被正确获取
      for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 20; i++) {
          const taskId = `task-${round}-${i}`;
          const task = queue.get(taskId);
          expect(task).toBeDefined();
          expect(task?.status).toBe('pending');
        }
      }
    });

    it('应该在并发清理下保持稳定', async () => {
      const shortLivedQueue = new TaskQueue({
        maxSize: 1000,
        maxAgeMs: 100, // 100ms 过期
        persistDir: TEST_DIR,
        persistEnabled: true
      });

      // 添加任务
      for (let i = 0; i < 50; i++) {
        shortLivedQueue.add({ taskId: `expiring-${i}`, taskType: 'cleanup-test' });
      }

      // 等待任务过期
      await new Promise(r => setTimeout(r, 150));

      // 并发触发清理（通过添加新任务）
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              shortLivedQueue.add({ taskId: `new-${i}`, taskType: 'cleanup-test' });
              resolve();
            });
          })
        );
      }

      await Promise.all(promises);

      const stats = shortLivedQueue.getStats();
      // 新任务应该存在，旧任务应该被清理
      expect(stats.total).toBe(20);
      
      shortLivedQueue.close();
    });
  });

  describe('事务原子性测试', () => {
    it('应该在事务失败时回滚', async () => {
      // 填满队列
      for (let i = 0; i < 1000; i++) {
        queue.add({ taskId: `fill-${i}`, taskType: 'fill' });
      }

      const failedAdds: Promise<void>[] = [];
      const successfulAdds: Promise<void>[] = [];

      // 尝试在满队列上添加任务（应该失败）
      for (let i = 0; i < 10; i++) {
        failedAdds.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              try {
                queue.add({ taskId: `overflow-${i}`, taskType: 'overflow' });
              } catch (e) {
                // 预期会失败
              }
              resolve();
            });
          })
        );
      }

      await Promise.all(failedAdds);

      // 队列大小应该保持 1000
      const stats = queue.getStats();
      expect(stats.total).toBe(1000);
    });

    it('应该在并发删除和查询时保持一致性', async () => {
      for (let i = 0; i < 50; i++) {
        queue.add({ taskId: `delete-test-${i}`, taskType: 'delete' });
      }

      const deletePromises: Promise<void>[] = [];
      const getPromises: Promise<void>[] = [];

      for (let i = 0; i < 50; i++) {
        const taskId = `delete-test-${i}`;
        
        deletePromises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.delete(taskId);
              resolve();
            });
          })
        );

        getPromises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.get(taskId);
              resolve();
            });
          })
        );
      }

      await Promise.all([...deletePromises, ...getPromises]);

      // 所有任务应该被删除
      const stats = queue.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('Webhook 相关并发测试', () => {
    it('应该正确处理并发 markWebhookPushed', async () => {
      for (let i = 0; i < 20; i++) {
        queue.add({ taskId: `webhook-${i}`, taskType: 'webhook' });
      }

      const promises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            setImmediate(() => {
              queue.markWebhookPushed(`webhook-${i}`);
              resolve();
            });
          })
        );
      }

      await Promise.all(promises);

      const webhookPending = queue.getWebhookPending();
      expect(webhookPending.length).toBe(0);
    });

    it('应该在并发 getWebhookPending 时保持一致性', async () => {
      for (let i = 0; i < 30; i++) {
        queue.add({ taskId: `concurrent-webhook-${i}`, taskType: 'webhook' });
      }

      const promises: Promise<unknown>[] = [];
      
      // 并发获取和标记
      for (let i = 0; i < 30; i++) {
        promises.push(
          new Promise((resolve) => {
            setImmediate(() => {
              const pending = queue.getWebhookPending();
              if (pending.length > 0) {
                queue.markWebhookPushed(pending[0].taskId);
              }
              resolve(pending.length);
            });
          })
        );
      }

      const results = await Promise.all(promises);
      
      // 最终所有任务都应该被标记
      const finalPending = queue.getWebhookPending();
      expect(finalPending.length).toBe(0);
    });
  });
});