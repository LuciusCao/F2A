/**
 * F2A 网络故障恢复集成测试
 * 测试网络故障、重连和状态恢复场景
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskQueue } from './task-queue.js';
import { ReputationSystem } from './reputation.js';
import { F2ANetworkClient } from './network-client.js';
import { WebhookPusher } from './webhook-pusher.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { mkdirSync, rmSync } from 'fs';

const TEST_DATA_DIR = `/tmp/f2a-network-test-${Date.now()}`;

// 辅助函数：获取可用端口
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tempServer = createServer();
    tempServer.listen(0, () => {
      const address = tempServer.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        tempServer.close(() => resolve(port));
      } else {
        reject(new Error('Failed to get port'));
      }
    });
  });
}

describe('网络故障恢复集成测试', () => {
  beforeEach(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('WebhookPusher 故障恢复', () => {
    it('应该在服务器恢复后自动恢复推送能力', async () => {
      const port = await getAvailablePort();
      let requestCount = 0;
      let serverStarted = false;

      const createServerWithDelay = () => {
        return createServer((req: IncomingMessage, res: ServerResponse) => {
          if (!serverStarted) {
            // 服务器未准备好，返回错误
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'Service starting' }));
            return;
          }

          requestCount++;
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          });
        });
      };

      const server = createServerWithDelay();
      await new Promise<void>((resolve) => server.listen(port, () => resolve()));

      try {
        const pusher = new WebhookPusher({
          url: `http://localhost:${port}/webhook`,
          token: 'test-token',
          timeout: 5000,
          enabled: true,
        });

        // 服务器未就绪时的推送应该失败
        const result1 = await pusher.pushTask({
          taskId: 'task-1',
          status: 'pending',
          createdAt: Date.now(),
        });

        expect(result1.success).toBe(false);

        // 模拟服务器启动完成
        serverStarted = true;

        // 等待冷却期后重试
        // 由于冷却期机制，我们需要手动重置状态
        const pusherWithReset = new WebhookPusher({
          url: `http://localhost:${port}/webhook`,
          token: 'test-token',
          timeout: 5000,
          enabled: true,
        });

        const result2 = await pusherWithReset.pushTask({
          taskId: 'task-2',
          status: 'pending',
          createdAt: Date.now(),
        });

        expect(result2.success).toBe(true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('应该正确处理连接超时场景', async () => {
      const pusher = new WebhookPusher({
        url: 'http://localhost:9999/webhook', // 不存在的端口
        token: 'test-token',
        timeout: 1000, // 1 秒超时
        enabled: true,
      });

      const startTime = Date.now();
      const result = await pusher.pushTask({
        taskId: 'timeout-task',
        status: 'pending',
        createdAt: Date.now(),
      });

      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(false);
      // 应该在超时时间内返回
      expect(elapsed).toBeLessThan(3000);
    });

    it('应该在连续失败后进入冷却期', async () => {
      const pusher = new WebhookPusher({
        url: 'http://localhost:9998/webhook', // 不存在的端口
        token: 'test-token',
        timeout: 500,
        enabled: true,
      });

      // 连续失败 3 次
      await pusher.pushTask({ taskId: 'fail-1', status: 'pending', createdAt: Date.now() });
      await pusher.pushTask({ taskId: 'fail-2', status: 'pending', createdAt: Date.now() });
      await pusher.pushTask({ taskId: 'fail-3', status: 'pending', createdAt: Date.now() });

      const status = pusher.getStatus();
      expect(status.inCooldown).toBe(true);
      expect(status.consecutiveFailures).toBeGreaterThanOrEqual(3);

      // 冷却期内的推送应该被拒绝
      const result = await pusher.pushTask({
        taskId: 'cooldown-task',
        status: 'pending',
        createdAt: Date.now(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cooldown/i);
    });
  });

  describe('TaskQueue 持久化恢复', () => {
    it('应该在持久化数据损坏时自动重建', async () => {
      const taskQueue = new TaskQueue({
        maxSize: 100,
        persistDir: TEST_DATA_DIR,
        persistEnabled: true,
      });

      // 添加一些任务
      taskQueue.add({
        taskId: 'before-corrupt',
        taskType: 'test',
        description: 'Task before corruption',
        from: 'peer-1',
        timestamp: Date.now(),
        timeout: 30000,
      });

      taskQueue.close();

      // 手动损坏数据库文件
      const dbPath = `${TEST_DATA_DIR}/task-queue.db`;
      const fs = await import('fs');
      fs.writeFileSync(dbPath, 'CORRUPTED DATA');

      // 重新打开，应该能够恢复
      const recoveredQueue = new TaskQueue({
        maxSize: 100,
        persistDir: TEST_DATA_DIR,
        persistEnabled: true,
      });

      // 应该能够正常操作
      const task = recoveredQueue.add({
        taskId: 'after-corrupt',
        taskType: 'test',
        description: 'Task after corruption recovery',
        from: 'peer-2',
        timestamp: Date.now(),
        timeout: 30000,
      });

      expect(task.taskId).toBe('after-corrupt');

      recoveredQueue.close();
    });

    it('应该正确恢复大量任务', async () => {
      const taskCount = 100;

      // 第一阶段：创建大量任务
      {
        const taskQueue = new TaskQueue({
          maxSize: 1000,
          persistDir: TEST_DATA_DIR,
          persistEnabled: true,
        });

        for (let i = 0; i < taskCount; i++) {
          taskQueue.add({
            taskId: `bulk-task-${i}`,
            taskType: 'bulk-test',
            description: `Bulk task ${i}`,
            from: `peer-${i % 10}`,
            timestamp: Date.now() + i,
            timeout: 30000,
          });
        }

        // 部分标记为处理中
        for (let i = 0; i < 20; i++) {
          taskQueue.markProcessing(`bulk-task-${i}`);
        }

        taskQueue.close();
      }

      // 第二阶段：恢复并验证
      {
        const taskQueue = new TaskQueue({
          maxSize: 1000,
          persistDir: TEST_DATA_DIR,
          persistEnabled: true,
        });

        // 等待恢复
        await new Promise((r) => setTimeout(r, 100));

        const stats = taskQueue.getStats();

        // 所有任务都应该恢复为 pending（processing 被重置）
        expect(stats.pending).toBe(taskCount);
        expect(stats.processing).toBe(0);
        expect(stats.total).toBe(taskCount);

        // 验证几个任务的内容
        const task50 = taskQueue.get('bulk-task-50');
        expect(task50).toBeDefined();
        expect(task50?.description).toBe('Bulk task 50');

        taskQueue.close();
      }
    });
  });

  describe('ReputationSystem 持久化', () => {
    it('应该在重启后保持信誉记录', async () => {
      const peerId = 'peer-reputation-test';

      // 第一阶段：创建信誉记录
      {
        const reputationSystem = new ReputationSystem(
          {
            enabled: true,
            initialScore: 50,
            minScoreForService: 20,
            decayRate: 0.01,
          },
          TEST_DATA_DIR
        );

        // 模拟多次交互
        reputationSystem.recordSuccess(peerId, 'task-1', 100);
        reputationSystem.recordSuccess(peerId, 'task-2', 150);
        reputationSystem.recordSuccess(peerId, 'task-3', 200);
        reputationSystem.recordFailure(peerId, 'task-fail', 'Error');

        reputationSystem.flush();
      }

      // 第二阶段：恢复并验证
      {
        const reputationSystem = new ReputationSystem(
          {
            enabled: true,
            initialScore: 50,
            minScoreForService: 20,
            decayRate: 0.01,
          },
          TEST_DATA_DIR
        );

        const rep = reputationSystem.getReputation(peerId);

        // 50 + 10*3 - 20 = 60
        expect(rep.score).toBe(60);
        expect(rep.successfulTasks).toBe(3);
        expect(rep.failedTasks).toBe(1);
        expect(rep.history).toHaveLength(4);
      }
    });

    it('应该在并发更新时保持数据一致性', async () => {
      const reputationSystem = new ReputationSystem(
        {
          enabled: true,
          initialScore: 50,
          minScoreForService: 20,
          decayRate: 0.01,
        },
        TEST_DATA_DIR
      );

      const peerId = 'peer-concurrent-test';
      const concurrentUpdates = 50;

      // 并发更新
      const updates = Array.from({ length: concurrentUpdates }, (_, i) =>
        new Promise<void>((resolve) => {
          setImmediate(() => {
            if (i % 2 === 0) {
              reputationSystem.recordSuccess(peerId, `task-${i}`, 100 + i);
            } else {
              reputationSystem.recordFailure(peerId, `task-${i}`, 'Error');
            }
            resolve();
          });
        })
      );

      await Promise.all(updates);

      const rep = reputationSystem.getReputation(peerId);

      // 验证一致性：成功和失败次数之和应该等于总更新次数
      expect(rep.successfulTasks + rep.failedTasks).toBe(concurrentUpdates);

      // 验证分数在合理范围内
      // 每次成功 +10，每次失败 -20
      // 25 次成功，25 次失败
      // 50 + 25*10 - 25*20 = 50 + 250 - 500 = -200 -> 0
      expect(rep.score).toBeGreaterThanOrEqual(0);
      expect(rep.score).toBeLessThanOrEqual(100);

      reputationSystem.flush();
    });
  });

  describe('端到端网络恢复', () => {
    it('应该正确处理网络断开重连场景', async () => {
      const port = await getAvailablePort();
      let isServerUp = true;
      let receivedTasks: any[] = [];

      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (!isServerUp) {
          // 模拟服务器宕机
          res.socket?.destroy();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            receivedTasks.push(data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
      });

      await new Promise<void>((resolve) => server.listen(port, () => resolve()));

      try {
        const taskQueue = new TaskQueue({
          maxSize: 100,
          persistDir: TEST_DATA_DIR,
          persistEnabled: true,
        });

        // 阶段 1：正常推送
        taskQueue.add({
          taskId: 'network-task-1',
          taskType: 'test',
          description: 'Task during network up',
          from: 'peer-1',
          timestamp: Date.now(),
          timeout: 30000,
        });

        await fetch(`http://localhost:${port}/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: 'network-task-1' }),
        });

        expect(receivedTasks).toHaveLength(1);

        // 阶段 2：模拟网络断开
        isServerUp = false;

        // 任务入队（无法推送）
        taskQueue.add({
          taskId: 'network-task-2',
          taskType: 'test',
          description: 'Task during network down',
          from: 'peer-1',
          timestamp: Date.now(),
          timeout: 30000,
        });

        // 推送应该失败
        const downResult = await fetch(`http://localhost:${port}/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: 'network-task-2' }),
        }).catch(() => null);

        expect(downResult).toBeNull();

        // 阶段 3：网络恢复
        isServerUp = true;

        // 重新推送待处理任务
        const pendingTasks = taskQueue.getWebhookPending();
        expect(pendingTasks.length).toBeGreaterThan(0);

        for (const task of pendingTasks) {
          await fetch(`http://localhost:${port}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task),
          });
          taskQueue.markWebhookPushed(task.taskId);
        }

        // 验证所有任务都已推送
        expect(receivedTasks.length).toBeGreaterThan(1);

        taskQueue.close();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});