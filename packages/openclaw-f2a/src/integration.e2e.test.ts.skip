/**
 * F2A 端到端集成测试
 * 测试完整的业务流程，使用真实的 SQLite 和 HTTP 服务器
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2AOpenClawAdapter } from './connector.js';
import { TaskQueue } from './task-queue.js';
import { ReputationSystem } from './reputation.js';
import { AnnouncementQueue } from './announcement-queue.js';
import { WebhookServer, WebhookHandler } from './webhook-server.js';
import { TaskGuard } from './task-guard.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// 测试配置 - 使用随机后缀避免冲突
let TEST_DATA_DIR = `/tmp/f2a-integration-test-${Date.now()}`;

// 辅助函数：获取可用端口（确保端口真正可用）
async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tempServer = createServer();
    tempServer.listen(0, () => {
      const address = tempServer.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        tempServer.close(() => {
          // 等待端口完全释放
          setTimeout(() => resolve(port), 50);
        });
      } else {
        reject(new Error('Failed to get port'));
      }
    });
  });
}

// 辅助函数：等待端口释放
async function waitForPortRelease(port: number, maxWait: number = 1000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = require('http').request({
          hostname: 'localhost',
          port,
          path: '/',
          method: 'HEAD',
          timeout: 100,
        }, () => resolve());
        req.on('error', () => resolve());
        req.end();
      });
      await new Promise(r => setTimeout(r, 100));
    } catch {
      break;
    }
  }
}

// 辅助函数：发送 HTTP 请求
async function sendRequest(options: {
  port: number;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = {
      hostname: 'localhost',
      port: options.port,
      path: options.path || '/webhook',
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    const httpReq = require('http').request(req, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk));
      res.on('end', () => {
        try {
          const body = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    httpReq.on('error', reject);
    if (options.body) {
      httpReq.write(JSON.stringify(options.body));
    }
    httpReq.end();
  });
}

describe('F2A 端到端集成测试', () => {
  beforeEach(() => {
    // 每个测试使用独立的目录
    TEST_DATA_DIR = `/tmp/f2a-integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // 创建测试目录
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(async () => {
    // 等待端口释放
    await new Promise(r => setTimeout(r, 100));
    // 清理测试目录
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('任务委托完整流程', () => {
    it('应该完成从任务入队 → Webhook 推送 → 处理 → 提交结果的完整流程', async () => {
      const port = await getAvailablePort();
      const taskQueue = new TaskQueue({
        maxSize: 100,
        persistDir: TEST_DATA_DIR,
        persistEnabled: true,
      });

      // 记录收到的推送
      let receivedTask: any = null;

      // 创建模拟的 webhook 接收服务器
      const webhookReceiver = createServer((req: IncomingMessage, res: ServerResponse) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            receivedTask = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch {
            res.writeHead(500);
            res.end();
          }
        });
      });

      await new Promise<void>((resolve) => webhookReceiver.listen(port + 1, () => resolve()));

      try {
        // 等待服务器完全启动
        await new Promise(r => setTimeout(r, 50));
        
        // 1. 任务入队
        const task = taskQueue.add({
          taskId: 'e2e-task-1',
          taskType: 'code-generation',
          description: 'Write a hello world function',
          from: 'peer-requester',
          timestamp: Date.now(),
          timeout: 60000,
        });

        expect(task.status).toBe('pending');
        expect(task.taskId).toBe('e2e-task-1');

        // 2. 模拟 Webhook 推送
        const pendingTasks = taskQueue.getWebhookPending();
        expect(pendingTasks.length).toBe(1);

        // 模拟推送到 webhook 接收器
        const pushResult = await fetch(`http://localhost:${port + 1}/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingTasks[0]),
        });

        expect(pushResult.ok).toBe(true);

        // 等待接收
        await new Promise((r) => setTimeout(r, 100));
        expect(receivedTask).not.toBeNull();
        expect(receivedTask.taskId).toBe('e2e-task-1');

        // 标记为已推送
        taskQueue.markWebhookPushed('e2e-task-1');

        // 3. 模拟处理任务
        taskQueue.markProcessing('e2e-task-1');
        const processingTask = taskQueue.get('e2e-task-1');
        expect(processingTask?.status).toBe('processing');

        // 4. 提交结果
        taskQueue.complete('e2e-task-1', {
          taskId: 'e2e-task-1',
          status: 'success',
          result: 'function hello() { console.log("Hello, World!"); }',
          latency: 1500,
        });

        const completedTask = taskQueue.get('e2e-task-1');
        expect(completedTask?.status).toBe('completed');
        expect(completedTask?.result).toContain('Hello, World!');

        // 验证统计
        const stats = taskQueue.getStats();
        expect(stats.completed).toBe(1);
        expect(stats.pending).toBe(0);
      } finally {
        taskQueue.close();
        await new Promise<void>((resolve) => webhookReceiver.close(() => resolve()));
      }
    });

    it('应该正确处理任务失败场景', async () => {
      const taskQueue = new TaskQueue({
        maxSize: 100,
        persistDir: TEST_DATA_DIR,
        persistEnabled: true,
      });

      try {
        // 添加任务
        taskQueue.add({
          taskId: 'failing-task',
          taskType: 'test',
          description: 'This task will fail',
          from: 'peer-1',
          timestamp: Date.now(),
          timeout: 30000,
        });

        // 标记处理中
        taskQueue.markProcessing('failing-task');

        // 提交失败结果
        taskQueue.complete('failing-task', {
          taskId: 'failing-task',
          status: 'error',
          error: 'Something went wrong',
          latency: 500,
        });

        const task = taskQueue.get('failing-task');
        expect(task?.status).toBe('failed');
        expect(task?.error).toBe('Something went wrong');

        const stats = taskQueue.getStats();
        expect(stats.failed).toBe(1);
      } finally {
        taskQueue.close();
      }
    });
  });

  describe('信誉系统端到端', () => {
    it('应该在任务成功后更新信誉并影响权限', async () => {
      const reputationSystem = new ReputationSystem(
        {
          enabled: true,
          initialScore: 30,
          minScoreForService: 20, // 注意：isAllowed 使用 INTERNAL_REPUTATION_CONFIG.minScoreForService (50)
          decayRate: 0.01,
        },
        TEST_DATA_DIR
      );

      const peerId = 'peer-test-success';

      // 初始信誉检查 (30 < 50，所以不允许)
      let rep = reputationSystem.getReputation(peerId);
      expect(rep.score).toBe(30);
      expect(reputationSystem.isAllowed(peerId)).toBe(false);

      // 模拟任务成功，分数增加
      reputationSystem.recordSuccess(peerId, 'task-1', 1000);
      reputationSystem.recordSuccess(peerId, 'task-2', 800);

      rep = reputationSystem.getReputation(peerId);
      expect(rep.score).toBeGreaterThan(30);
      expect(rep.successfulTasks).toBe(2);
      expect(rep.avgResponseTime).toBeGreaterThan(0);
      
      // 分数达到 50+ 后允许服务
      expect(rep.score).toBeGreaterThanOrEqual(50);
      expect(reputationSystem.isAllowed(peerId)).toBe(true);

      // 多次失败降低信誉
      for (let i = 0; i < 5; i++) {
        reputationSystem.recordFailure(peerId, `fail-task-${i}`, 'Error');
      }

      rep = reputationSystem.getReputation(peerId);
      // 30 + 10 + 10 - 20*5 = 30 + 20 - 100 = -50 -> 0
      expect(rep.score).toBe(0);
      expect(reputationSystem.isAllowed(peerId)).toBe(false);

      // 刷新确保持久化
      reputationSystem.flush();
    });

    it('应该在持久化后恢复信誉数据', async () => {
      const peerId = 'peer-persistence-test';

      // 创建并写入数据
      {
        const reputationSystem = new ReputationSystem(
          {
            enabled: true,
            initialScore: 30,
            minScoreForService: 20,
            decayRate: 0.01,
          },
          TEST_DATA_DIR
        );

        reputationSystem.recordSuccess(peerId, 'task-1', 500);
        reputationSystem.flush();
      }

      // 重新加载验证持久化
      {
        const reputationSystem = new ReputationSystem(
          {
            enabled: true,
            initialScore: 30,
            minScoreForService: 20,
            decayRate: 0.01,
          },
          TEST_DATA_DIR
        );

        const rep = reputationSystem.getReputation(peerId);
        expect(rep.score).toBeGreaterThan(30);
        expect(rep.successfulTasks).toBe(1);
      }
    });
  });

  describe('Webhook 推送流程', () => {
    it('应该正确处理 Webhook 推送失败后的重试', async () => {
      const port = await getAvailablePort();
      let requestCount = 0;
      let successAfterAttempts = 3;

      const webhookServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        requestCount++;
        if (requestCount < successAfterAttempts) {
          // 前两次返回错误
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'Service unavailable' }));
        } else {
          // 第三次成功
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }
      });

      await new Promise<void>((resolve) => webhookServer.listen(port + 2, () => resolve()));

      try {
        const taskQueue = new TaskQueue({
          maxSize: 100,
          persistDir: TEST_DATA_DIR,
          persistEnabled: true,
        });

        taskQueue.add({
          taskId: 'retry-task',
          taskType: 'test',
          description: 'Test webhook retry',
          from: 'peer-1',
          timestamp: Date.now(),
          timeout: 30000,
        });

        // 模拟重试逻辑
        let lastSuccess = false;
        for (let attempt = 1; attempt <= 5; attempt++) {
          const result = await fetch(`http://localhost:${port + 2}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: 'retry-task' }),
          });

          if (result.ok) {
            lastSuccess = true;
            break;
          }
        }

        expect(lastSuccess).toBe(true);
        expect(requestCount).toBe(successAfterAttempts);

        taskQueue.close();
      } finally {
        await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
      }
    });
  });

  describe('崩溃恢复流程', () => {
    it('应该在崩溃后恢复未处理的任务', async () => {
      // 第一次：创建任务并模拟崩溃（不正常关闭）
      {
        const taskQueue = new TaskQueue({
          maxSize: 100,
          persistDir: TEST_DATA_DIR,
          persistEnabled: true,
        });

        taskQueue.add({
          taskId: 'crash-task-1',
          taskType: 'important',
          description: 'Important task that should survive crash',
          from: 'peer-critical',
          timestamp: Date.now(),
          timeout: 60000,
        });

        taskQueue.add({
          taskId: 'crash-task-2',
          taskType: 'important',
          description: 'Another important task',
          from: 'peer-critical',
          timestamp: Date.now(),
          timeout: 60000,
        });

        // 标记一个为 processing
        taskQueue.markProcessing('crash-task-1');

        // 不调用 close()，模拟崩溃
        // 直接清空内存引用
      }

      // 第二次：重新打开，验证恢复
      {
        const taskQueue = new TaskQueue({
          maxSize: 100,
          persistDir: TEST_DATA_DIR,
          persistEnabled: true,
        });

        // 等待恢复
        await new Promise((r) => setTimeout(r, 100));

        const stats = taskQueue.getStats();
        // 两个任务都应该恢复为 pending（processing 会被重置）
        expect(stats.pending).toBe(2);
        expect(stats.processing).toBe(0);

        // 验证任务内容
        const task1 = taskQueue.get('crash-task-1');
        expect(task1?.description).toContain('Important task');
        expect(task1?.status).toBe('pending'); // processing 被重置为 pending

        const task2 = taskQueue.get('crash-task-2');
        expect(task2?.description).toContain('Another important task');

        taskQueue.close();
      }
    });

    it('应该正确处理数据库损坏场景', async () => {
      // 创建一个损坏的数据库文件
      const dbPath = join(TEST_DATA_DIR, 'task-queue.db');
      writeFileSync(dbPath, 'corrupted data that is not valid sqlite');

      // 应该能够重建数据库
      const taskQueue = new TaskQueue({
        maxSize: 100,
        persistDir: TEST_DATA_DIR,
        persistEnabled: true,
      });

      // 应该可以正常添加任务
      const task = taskQueue.add({
        taskId: 'after-corrupt',
        taskType: 'test',
        description: 'Task after corruption recovery',
        from: 'peer-1',
        timestamp: Date.now(),
        timeout: 30000,
      });

      expect(task.taskId).toBe('after-corrupt');

      taskQueue.close();
    });
  });

  describe('并发场景', () => {
    it('应该正确处理多个 Agent 同时委托任务', async () => {
      const taskQueue = new TaskQueue({
        maxSize: 1000,
        persistDir: TEST_DATA_DIR,
        persistEnabled: true,
      });

      try {
        // 模拟 10 个 Agent 同时委托任务
        const agentCount = 10;
        const tasksPerAgent = 5;

        const addPromises: Promise<void>[] = [];

        for (let agent = 0; agent < agentCount; agent++) {
          for (let task = 0; task < tasksPerAgent; task++) {
            addPromises.push(
              new Promise<void>((resolve) => {
                setImmediate(() => {
                  try {
                    taskQueue.add({
                      taskId: `agent-${agent}-task-${task}`,
                      taskType: 'concurrent-test',
                      description: `Task from agent ${agent}`,
                      from: `peer-agent-${agent}`,
                      timestamp: Date.now(),
                      timeout: 30000,
                    });
                  } catch {
                    // 忽略错误
                  }
                  resolve();
                });
              })
            );
          }
        }

        await Promise.all(addPromises);

        const stats = taskQueue.getStats();
        expect(stats.pending).toBe(agentCount * tasksPerAgent);
        expect(stats.total).toBe(agentCount * tasksPerAgent);

        // 验证每个任务都能被正确获取
        for (let agent = 0; agent < agentCount; agent++) {
          for (let task = 0; task < tasksPerAgent; task++) {
            const t = taskQueue.get(`agent-${agent}-task-${task}`);
            expect(t).toBeDefined();
            expect(t?.from).toBe(`peer-agent-${agent}`);
          }
        }
      } finally {
        taskQueue.close();
      }
    });

    it('应该正确处理同一任务的并发操作', async () => {
      const taskQueue = new TaskQueue({
        maxSize: 100,
        persistDir: TEST_DATA_DIR,
        persistEnabled: true,
      });

      try {
        taskQueue.add({
          taskId: 'concurrent-ops-task',
          taskType: 'test',
          description: 'Task with concurrent operations',
          from: 'peer-1',
          timestamp: Date.now(),
          timeout: 30000,
        });

        // 并发执行多种操作
        const operations = [
          // 尝试标记为 processing
          () => taskQueue.markProcessing('concurrent-ops-task'),
          // 尝试读取
          () => taskQueue.get('concurrent-ops-task'),
          // 再次标记（幂等性测试）
          () => taskQueue.markProcessing('concurrent-ops-task'),
        ];

        const results = await Promise.all(operations.map((op) => Promise.resolve(op())));

        // 任务应该处于一致的状态
        const task = taskQueue.get('concurrent-ops-task');
        expect(task).toBeDefined();
        expect(['pending', 'processing']).toContain(task?.status);
      } finally {
        taskQueue.close();
      }
    });
  });

  describe('AnnouncementQueue 端到端', () => {
    it('应该完成从发布广播 → 认领 → 接受 → 委托的完整流程', async () => {
      const announcementQueue = new AnnouncementQueue({
        maxSize: 50,
        maxAgeMs: 30 * 60 * 1000,
      });

      try {
        // 1. 发布者创建任务广播
        const announcement = announcementQueue.create({
          taskType: 'code-review',
          description: 'Review pull request #123',
          requiredCapabilities: ['typescript', 'code-review'],
          estimatedComplexity: 5,
          reward: 100,
          timeout: 300000,
          from: 'peer-publisher',
        });

        expect(announcement.status).toBe('open');
        expect(announcement.announcementId).toMatch(/^ann-/);

        // 2. 多个 Agent 认领任务
        const claim1 = announcementQueue.submitClaim(announcement.announcementId, {
          claimant: 'peer-worker-1',
          claimantName: 'Worker Alpha',
          estimatedTime: 120000,
          confidence: 0.85,
        });

        const claim2 = announcementQueue.submitClaim(announcement.announcementId, {
          claimant: 'peer-worker-2',
          claimantName: 'Worker Beta',
          estimatedTime: 90000,
          confidence: 0.95,
        });

        expect(claim1).toBeDefined();
        expect(claim2).toBeDefined();
        expect(announcement.claims).toHaveLength(2);

        // 3. 发布者查看认领列表
        const myAnnouncements = announcementQueue.getMyAnnouncements('peer-publisher');
        expect(myAnnouncements).toHaveLength(1);
        expect(myAnnouncements[0].claims).toHaveLength(2);

        // 4. 发布者接受一个认领
        const acceptedClaim = announcementQueue.acceptClaim(
          announcement.announcementId,
          claim2!.claimId
        );

        expect(acceptedClaim?.status).toBe('accepted');
        expect(announcement.status).toBe('claimed');

        // 其他认领应该被拒绝
        const rejectedClaim = announcementQueue.get(announcement.announcementId)?.claims?.find(
          (c) => c.claimId === claim1?.claimId
        );
        expect(rejectedClaim?.status).toBe('rejected');

        // 5. 标记为已委托
        announcementQueue.markDelegated(announcement.announcementId);
        expect(announcement.status).toBe('delegated');

        // 验证统计
        const stats = announcementQueue.getStats();
        expect(stats.delegated).toBe(1);
      } finally {
        announcementQueue.clear();
      }
    });

    it('应该正确处理广播过期场景', async () => {
      const fastExpireQueue = new AnnouncementQueue({
        maxSize: 50,
        maxAgeMs: 100, // 100ms 过期
      });

      try {
        const announcement = fastExpireQueue.create({
          taskType: 'quick-task',
          description: 'This will expire soon',
          timeout: 100,
          from: 'peer-1',
        });

        expect(announcement.status).toBe('open');

        // 等待过期
        await new Promise((r) => setTimeout(r, 150));

        // 触发清理（通过创建新任务）
        fastExpireQueue.create({
          taskType: 'new-task',
          description: 'New task',
          timeout: 1000,
          from: 'peer-2',
        });

        const stats = fastExpireQueue.getStats();
        expect(stats.expired).toBe(1);
      } finally {
        fastExpireQueue.clear();
      }
    });
  });

  describe('TaskGuard 集成测试', () => {
    it('应该在完整流程中正确应用安全规则', async () => {
      const guard = new TaskGuard();

      // 正常任务应该通过
      const normalTask = {
        taskId: 'normal-task',
        taskType: 'code-generation',
        description: 'Write a function to sort an array',
        from: 'peer-1',
        timestamp: Date.now(),
        timeout: 30000,
      };

      let report = guard.check(normalTask);
      expect(report.passed).toBe(true);

      // 危险任务应该被阻止
      const dangerousTask = {
        taskId: 'dangerous-task',
        taskType: 'shell',
        description: 'rm -rf /',
        from: 'peer-2',
        timestamp: Date.now(),
        timeout: 30000,
      };

      report = guard.check(dangerousTask);
      expect(report.passed).toBe(false);
      expect(report.blocks.some((b) => b.ruleId === 'dangerous-keywords')).toBe(true);

      // 低信誉用户执行敏感操作应该被阻止
      const sensitiveTask = {
        taskId: 'sensitive-task',
        taskType: 'file-operation',
        description: 'Delete old logs',
        from: 'peer-3',
        timestamp: Date.now(),
        timeout: 30000,
      };

      report = guard.check(sensitiveTask, {
        requesterReputation: {
          peerId: 'peer-3',
          score: 10, // 非常低的信誉
          successfulTasks: 1,
          failedTasks: 20,
          totalTasks: 21,
          avgResponseTime: 5000,
          lastInteraction: Date.now(),
          history: [],
        },
      });

      // 检查是否因为低信誉而被阻止或警告
      // 注意：具体行为取决于 TaskGuard 的配置
      expect(report.results.some((r) => r.ruleId === 'reputation')).toBe(true);
    });
  });

  describe('WebhookServer 真实 HTTP 测试', () => {
    it('应该正确处理真实的 HTTP 请求', async () => {
      const port = await getAvailablePort();

      const handler: WebhookHandler = {
        onDiscover: async (payload) => ({
          capabilities: [{ name: 'test-capability', description: 'Test capability', parameters: {} }],
          reputation: 80,
        }),
        onDelegate: async (payload) => ({
          accepted: true,
          taskId: payload.taskId,
        }),
        onStatus: async () => ({
          status: 'available',
          load: 0.5,
        }),
      };

      const server = new WebhookServer(port, handler);
      await server.start();

      try {
        // 测试 discover
        const discoverRes = await sendRequest({
          port,
          body: {
            type: 'discover',
            payload: { query: {}, requester: 'test-peer' },
            timestamp: Date.now(),
          },
        });
        expect(discoverRes.status).toBe(200);
        expect((discoverRes.body as any).capabilities).toBeDefined();

        // 测试 delegate
        const delegateRes = await sendRequest({
          port,
          body: {
            type: 'delegate',
            payload: {
              taskId: 'http-test-task',
              taskType: 'test',
              description: 'Test via HTTP',
              from: 'test-peer',
              timestamp: Date.now(),
              timeout: 30000,
            },
            timestamp: Date.now(),
          },
        });
        expect(delegateRes.status).toBe(200);
        expect((delegateRes.body as any).accepted).toBe(true);

        // 测试 status
        const statusRes = await sendRequest({
          port,
          body: {
            type: 'status',
            payload: {},
            timestamp: Date.now(),
          },
        });
        expect(statusRes.status).toBe(200);
        expect((statusRes.body as any).status).toBe('available');
      } finally {
        await server.stop();
        // 等待端口释放
        await new Promise((r) => setTimeout(r, 50));
      }
    });
  });
});