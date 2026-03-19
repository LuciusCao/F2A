/**
 * WebhookPusher 边界、竞态和幂等性测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookPusher, WebhookPushConfig } from './webhook-pusher.js';
import type { QueuedTask } from './task-queue.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('WebhookPusher 边界问题', () => {
  let pusher: WebhookPusher;
  const defaultConfig: WebhookPushConfig = {
    url: 'http://localhost:4200',
    token: 'test-token',
    timeout: 1000,
    enabled: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pusher = new WebhookPusher(defaultConfig);
  });

  describe('推送边界', () => {
    it('应该在 disabled 时不推送', async () => {
      const disabledPusher = new WebhookPusher({
        ...defaultConfig,
        enabled: false
      });

      const task: QueuedTask = {
        taskId: 'task-1',
        status: 'pending',
        createdAt: Date.now()
      };

      const result = await disabledPusher.pushTask(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Webhook push disabled');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('应该在 URL 无效时失败', async () => {
      mockFetch.mockRejectedValue(new Error('Invalid URL'));

      const task: QueuedTask = {
        taskId: 'task-1',
        status: 'pending',
        createdAt: Date.now()
      };

      const result = await pusher.pushTask(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid URL');
    });

    it('应该在超时时失败', async () => {
      mockFetch.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 2000)
        )
      );

      const task: QueuedTask = {
        taskId: 'task-1',
        status: 'pending',
        createdAt: Date.now()
      };

      const result = await pusher.pushTask(task);

      expect(result.success).toBe(false);
    }, 5000);
  });

  describe('冷却期边界', () => {
    it('应该在连续失败 3 次后进入冷却期', async () => {
      mockFetch.mockRejectedValue(new Error('Failed'));

      const task: QueuedTask = {
        taskId: 'task-1',
        status: 'pending',
        createdAt: Date.now()
      };

      // 连续失败 3 次
      await pusher.pushTask(task);
      await pusher.pushTask(task);
      await pusher.pushTask(task);

      const status = pusher.getStatus();
      expect(status.consecutiveFailures).toBe(3);
      expect(status.inCooldown).toBe(true);
    });

    it('应该在冷却期内拒绝推送', async () => {
      mockFetch.mockRejectedValue(new Error('Failed'));

      const task: QueuedTask = {
        taskId: 'task-1',
        status: 'pending',
        createdAt: Date.now()
      };

      // 触发冷却期
      await pusher.pushTask(task);
      await pusher.pushTask(task);
      await pusher.pushTask(task);

      // 冷却期内的推送应该失败
      const result = await pusher.pushTask(task);
      expect(result.success).toBe(false);
      // 更新错误消息格式：包含剩余秒数
      expect(result.error).toMatch(/In cooldown \(\d+s remaining\)/);
    });

    it('应该在冷却期后恢复推送', async () => {
      const quickPusher = new WebhookPusher({
        ...defaultConfig
      });
      
      // 模拟快速冷却期（通过修改内部状态）
      mockFetch.mockRejectedValue(new Error('Failed'));

      const task: QueuedTask = {
        taskId: 'task-1',
        status: 'pending',
        createdAt: Date.now()
      };

      // 触发冷却期
      await quickPusher.pushTask(task);
      await quickPusher.pushTask(task);
      await quickPusher.pushTask(task);

      // 手动重置失败计数和时间，模拟冷却期结束
      (quickPusher as any).consecutiveFailures = 0;
      (quickPusher as any).lastFailureTime = 0;

      // 恢复成功
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      const result = await quickPusher.pushTask(task);
      
      expect(result.success).toBe(true);
    }, 3000);
  });

  describe('幂等性', () => {
    it('应该支持同一任务多次推送', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const task: QueuedTask = {
        taskId: 'task-1',
        status: 'pending',
        createdAt: Date.now()
      };

      const result1 = await pusher.pushTask(task);
      const result2 = await pusher.pushTask(task);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('状态管理', () => {
    it('应该正确返回状态', () => {
      const status = pusher.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.inCooldown).toBe(false);
    });

    it('应该支持动态更新配置', () => {
      pusher.updateConfig({ enabled: false });

      const status = pusher.getStatus();
      expect(status.enabled).toBe(false);
    });
  });
});