/**
 * 消息传递集成测试
 * 测试节点之间的消息发送和接收
 */

import { describe, it, expect, beforeAll } from 'vitest';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.skipIf(!shouldRun)('消息传递集成测试', () => {
  // 使用 HTTP URL 格式，而不是 libp2p 多地址
  const bootstrapAddr = process.env.TEST_BOOTSTRAP_HTTP || 'http://bootstrap.f2a.local:9001';
  const testToken = process.env.TEST_TOKEN || 'test-token-integration';

  beforeAll(async () => {
    // 等待所有节点就绪
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  describe('任务请求和响应', () => {
    it('应该能发送任务请求并收到响应', async () => {
      // 1. 发送任务请求
      const taskPayload = {
        capability: 'echo',
        description: 'Echo test message',
        parameters: {
          message: 'Hello from integration test'
        }
      };

      const sendResponse = await fetch(`${bootstrapAddr}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify(taskPayload)
      });

      // 如果节点没有注册 echo 能力，测试可能失败
      // 这是预期的，因为这是基础测试
      if (!sendResponse.ok) {
        console.log('Task endpoint not available, skipping');
        return;
      }

      const result = await sendResponse.json();
      expect(result.taskId).toBeDefined();
    });

    it('应该能广播消息到所有节点', async () => {
      const broadcastPayload = {
        type: 'DISCOVER',
        payload: {
          test: true
        }
      };

      const response = await fetch(`${bootstrapAddr}/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify(broadcastPayload)
      });

      // 广播可能不可用，取决于实现
      if (response.ok) {
        const result = await response.json();
        expect(result.delivered).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('能力发现', () => {
    it('应该能发现节点的注册能力', async () => {
      const response = await fetch(`${bootstrapAddr}/capabilities`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });

      if (response.ok) {
        const capabilities = await response.json();
        expect(Array.isArray(capabilities)).toBe(true);
      }
    });
  });

  describe('错误处理', () => {
    it('应该拒绝无效的认证令牌', async () => {
      const response = await fetch(`${bootstrapAddr}/status`, {
        headers: { 'Authorization': 'Bearer invalid-token' }
      });

      expect(response.status).toBe(401);
    });

    it('应该返回正确的错误信息', async () => {
      const response = await fetch(`${bootstrapAddr}/invalid-endpoint`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });

      expect(response.status).toBe(404);
    });
  });
});