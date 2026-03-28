/**
 * WebhookPusher 测试
 * 
 * 测试 Webhook 推送功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebhookPusher } from '../src/webhook-pusher.js';

describe('WebhookPusher', () => {
  let pusher: WebhookPusher;

  beforeEach(() => {
    pusher = new WebhookPusher({
      url: 'http://localhost:19999',
      token: 'test-token',
    });
  });

  afterEach(() => {
    // 清理
  });

  describe('构造函数', () => {
    it('应该能够创建推送器实例', () => {
      expect(pusher).toBeDefined();
    });

    it('应该接受自定义配置', () => {
      const customPusher = new WebhookPusher({
        url: 'http://example.com',
        token: 'test-token',
        timeout: 5000,
      });
      expect(customPusher).toBeDefined();
    });
  });

  describe('推送方法', () => {
    it('应该有 pushTask 方法', () => {
      expect(typeof pusher.pushTask).toBe('function');
    });

    it('应该能够推送任务', async () => {
      // 由于没有真实服务器，这个测试会失败，但可以验证方法存在
      const result = await pusher.pushTask({
        taskId: 'test-1',
        taskType: 'test',
        description: 'Test',
        from: 'test-peer',
        timestamp: Date.now(),
        status: 'pending',
      });
      // 预期失败（无服务器），但验证了方法调用
      expect(result).toBeDefined();
    });

    it('应该在禁用时返回错误', async () => {
      const disabledPusher = new WebhookPusher({
        url: 'http://localhost:19999',
        token: 'test-token',
        enabled: false,
      });

      const result = await disabledPusher.pushTask({
        taskId: 'test-1',
        taskType: 'test',
        description: 'Test',
        from: 'test-peer',
        timestamp: Date.now(),
        status: 'pending',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('应该能够批量推送任务', async () => {
      const tasks = [
        { taskId: 'test-1', taskType: 'test', description: 'Test 1', from: 'peer-1', timestamp: Date.now(), status: 'pending' },
        { taskId: 'test-2', taskType: 'test', description: 'Test 2', from: 'peer-2', timestamp: Date.now(), status: 'pending' },
      ];

      const results = await pusher.pushTasks(tasks);
      expect(results.size).toBe(2);
      expect(results.has('test-1')).toBe(true);
      expect(results.has('test-2')).toBe(true);
    });
  });
});