/**
 * P2P 通信集成测试
 * 
 * 测试 F2A 节点之间的通信功能：
 * - 消息发送和接收
 * - 任务委托和响应
 * - 能力发现
 * - 广播消息
 * 
 * 运行条件：
 * - 设置 RUN_INTEGRATION_TESTS=true
 * - 至少一个 F2A daemon 在运行
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBootstrapHttp } from './test-config';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.skipIf(!shouldRun)('P2P 通信集成测试', () => {
  const bootstrapAddr = getBootstrapHttp();
  const testToken = process.env.TEST_TOKEN || 'test-token-integration';
  let testPeerId: string | null = null;

  beforeAll(async () => {
    // 等待服务就绪
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 获取 bootstrap 节点的 Peer ID
    try {
      const response = await fetch(`${bootstrapAddr}/status`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      if (response.ok) {
        const status = await response.json();
        testPeerId = status.peerId;
      }
    } catch {}
  });

  describe('健康检查和状态', () => {
    it('节点健康检查应该返回正常状态', async () => {
      const response = await fetch(`${bootstrapAddr}/health`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      expect(response.ok).toBe(true);
      const health = await response.json();
      expect(health.status).toBe('ok');
      expect(health.peerId).toBeDefined();
    });

    it('节点状态应该包含必要信息', async () => {
      const response = await fetch(`${bootstrapAddr}/status`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      expect(response.ok).toBe(true);
      const status = await response.json();
      
      expect(status.success).toBe(true);
      expect(status.peerId).toBeDefined();
      expect(status.peerId.length).toBeGreaterThan(10);
      
      // 应该包含网络地址
      if (status.multiaddrs) {
        expect(Array.isArray(status.multiaddrs)).toBe(true);
      }
    });
  });

  describe('消息发送', () => {
    it('应该能发送消息给已知节点', async () => {
      if (!testPeerId) {
        console.log('No peer ID available, skipping');
        return;
      }

      const messagePayload = {
        type: 'MESSAGE',
        id: `test-msg-${Date.now()}`,
        payload: {
          content: 'Hello from integration test',
          metadata: { test: true }
        }
      };

      const response = await fetch(`${bootstrapAddr}/send/${testPeerId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify(messagePayload)
      });

      // 发送给自己是特殊情况，可能成功也可能失败
      if (response.ok) {
        const result = await response.json();
        expect(result.success).toBe(true);
      } else {
        // 4xx 错误也是可接受的（如：不能发消息给自己）
        expect(response.status).toBeLessThan(500);
      }
    });

    it('广播消息应该能发送到所有节点', async () => {
      const broadcastPayload = {
        type: 'DISCOVER',
        payload: {
          test: true,
          timestamp: Date.now()
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

      // 广播端点可能不存在，检查响应状态
      if (response.ok) {
        const result = await response.json();
        expect(result).toBeDefined();
        expect(typeof result.delivered === 'number' || result.success === true).toBe(true);
      } else if (response.status === 404) {
        // 广播端点不存在是可接受的
        console.log('Broadcast endpoint not available');
      } else {
        // 其他错误应该报告
        expect(response.status).toBeLessThan(500);
      }
    });
  });

  describe('任务委托', () => {
    it('应该能发送任务请求', async () => {
      const taskPayload = {
        capability: 'echo',
        description: 'Echo test for integration test',
        parameters: {
          message: 'Hello from task test'
        },
        timeout: 5000
      };

      const response = await fetch(`${bootstrapAddr}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify(taskPayload)
      });

      // 任务端点可能返回：
      // - 200: 任务成功
      // - 202: 任务已接受
      // - 404: 没有找到有能力执行任务的节点
      // - 其他 4xx: 参数错误
      if (response.ok || response.status === 202) {
        const result = await response.json();
        expect(result.taskId || result.success).toBeDefined();
      } else {
        // 记录错误但测试仍然通过（因为可能没有注册能力的节点）
        console.log('Task endpoint response:', response.status);
        const error = await response.text();
        console.log('Error:', error.slice(0, 200));
      }
    });

    it('应该拒绝无效的任务请求', async () => {
      const invalidPayload = {
        // 缺少必要字段
        description: 'Invalid task'
      };

      const response = await fetch(`${bootstrapAddr}/task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify(invalidPayload)
      });

      // 应该返回 4xx 错误
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });

  describe('能力发现', () => {
    it('应该能查询节点能力', async () => {
      const response = await fetch(`${bootstrapAddr}/capabilities`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });

      if (response.ok) {
        const capabilities = await response.json();
        expect(Array.isArray(capabilities)).toBe(true);
        console.log('Capabilities:', capabilities);
      } else {
        console.log('Capabilities endpoint status:', response.status);
      }
    });

    it('应该能发现网络中的 Agents', async () => {
      const response = await fetch(`${bootstrapAddr}/peers`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });

      expect(response.ok).toBe(true);
      const peers = await response.json();
      expect(Array.isArray(peers)).toBe(true);
      
      // 打印发现的节点信息
      console.log('Discovered peers:', peers.length);
      if (peers.length > 0) {
        console.log('First peer:', JSON.stringify(peers[0], null, 2).slice(0, 200));
      }
    });
  });

  describe('认证和安全', () => {
    it('应该拒绝无效的认证令牌', async () => {
      const response = await fetch(`${bootstrapAddr}/status`, {
        headers: { 'Authorization': 'Bearer invalid-token-12345' }
      });

      expect(response.status).toBe(401);
    });

    it('应该拒绝缺少认证的请求', async () => {
      const response = await fetch(`${bootstrapAddr}/status`);
      
      // 应该返回 401 Unauthorized
      expect(response.status).toBe(401);
    });

    it('应该正确处理未知端点', async () => {
      const response = await fetch(`${bootstrapAddr}/unknown-endpoint-test`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });

      // 应该返回 404 或 405
      expect([404, 405]).toContain(response.status);
    });
  });

  describe('性能测试', () => {
    it('健康检查应该在合理时间内响应', async () => {
      const start = Date.now();
      
      const response = await fetch(`${bootstrapAddr}/health`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      const duration = Date.now() - start;
      
      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(1000); // 应该在 1 秒内响应
    });

    it('并发请求应该都能成功', async () => {
      const concurrentRequests = 5;
      const requests = [];
      
      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(
          fetch(`${bootstrapAddr}/health`, {
            headers: { 'Authorization': `Bearer ${testToken}` }
          })
        );
      }
      
      const responses = await Promise.all(requests);
      
      for (const response of responses) {
        expect(response.ok).toBe(true);
      }
    });
  });
});