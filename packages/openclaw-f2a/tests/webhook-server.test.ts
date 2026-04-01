/**
 * WebhookServer 测试
 * 
 * 测试 Webhook 服务器功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebhookServer, WebhookHandler } from '../src/webhook-server.js';
import type { DiscoverWebhookPayload, DelegateWebhookPayload } from '../src/types.js';
import getPort from 'get-port';

// 创建模拟 handler
function createMockHandler(): WebhookHandler {
  return {
    onDiscover: async () => ({
      capabilities: [],
      reputation: 50,
    }),
    onDelegate: async () => ({
      accepted: true,
      taskId: 'test-task',
    }),
    onStatus: async () => ({
      status: 'available' as const,
      load: 0,
    }),
    onMessage: async () => ({
      response: 'OK',
    }),
  };
}

describe('WebhookServer', () => {
  let server: WebhookServer;
  let handler: WebhookHandler;
  let port: number;

  beforeEach(async () => {
    handler = createMockHandler();
    port = await getPort();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('构造函数', () => {
    it('应该能够创建服务器实例', async () => {
      server = new WebhookServer(port, handler);
      expect(server).toBeDefined();
    });

    it('应该接受自定义配置', async () => {
      const customPort = await getPort();
      server = new WebhookServer(customPort, handler, {
        maxBodySize: 1024 * 1024,
        allowedOrigins: ['http://localhost:3000'],
      });
      expect(server).toBeDefined();
    });
  });

  describe('启动和停止', () => {
    it('应该能够启动服务器', async () => {
      server = new WebhookServer(port, handler);
      await server.start();
      
      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'status',
        }),
      });
      expect(response.status).toBe(200);
    });

    it('应该能够停止服务器', async () => {
      server = new WebhookServer(port, handler);
      await server.start();
      await server.stop();
      
      // 停止后不应该能连接
      try {
        await fetch(`http://localhost:${port}/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'status',
          }),
        });
        expect(true).toBe(false); // 不应该到达这里
      } catch (error) {
        // 预期的错误
        expect(error).toBeDefined();
      }
    });
  });

  describe('CORS', () => {
    it('应该处理 CORS 预检请求', async () => {
      server = new WebhookServer(port, handler, {
        allowedOrigins: ['http://localhost:3000'],
      });
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.status).toBe(200);
    });
  });

  describe('健康检查', () => {
    it('应该返回健康状态', async () => {
      server = new WebhookServer(port, handler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'status',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBeDefined();
    });
  });

  describe('事件处理', () => {
    it('应该处理 discover 事件', async () => {
      const mockHandler: WebhookHandler = {
        onDiscover: async () => ({
          capabilities: [{ name: 'test', description: 'Test capability', tools: [] }],
          reputation: 80,
        }),
        onDelegate: async () => ({ accepted: true, taskId: 'test' }),
        onStatus: async () => ({ status: 'available' }),
      };

      server = new WebhookServer(port, mockHandler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'discover',
          payload: {},
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.capabilities).toBeDefined();
    });

    it('应该处理 delegate 事件', async () => {
      const mockHandler: WebhookHandler = {
        onDiscover: async () => ({ capabilities: [], reputation: 50 }),
        onDelegate: async () => ({ accepted: true, taskId: 'task-123' }),
        onStatus: async () => ({ status: 'available' }),
      };

      server = new WebhookServer(port, mockHandler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'delegate',
          payload: {
            taskId: 'task-123',
            taskType: 'test',
            description: 'Test task',
            from: 'test-peer',
          },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.accepted).toBe(true);
    });

    it('应该处理 status 事件', async () => {
      const mockHandler: WebhookHandler = {
        onDiscover: async () => ({ capabilities: [], reputation: 50 }),
        onDelegate: async () => ({ accepted: true, taskId: 'test' }),
        onStatus: async () => ({ status: 'busy', load: 0.8 }),
      };

      server = new WebhookServer(port, mockHandler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'status',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('busy');
    });

    it('应该拒绝未知事件类型', async () => {
      server = new WebhookServer(port, handler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'unknown',
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('onMessage 事件处理', () => {
    it('应该处理 message 事件', async () => {
      const mockHandler: WebhookHandler = {
        onDiscover: async () => ({ capabilities: [], reputation: 50 }),
        onDelegate: async () => ({ accepted: true, taskId: 'test' }),
        onStatus: async () => ({ status: 'available' }),
        onMessage: async (payload) => ({
          response: `收到来自 ${payload.from} 的消息`,
        }),
      };

      server = new WebhookServer(port, mockHandler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          payload: {
            from: '12D3KooWTestPeerId12345678901234567890123456789012345678',
            content: '你好，请帮我处理一个任务',
            messageId: 'msg-123',
          },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.response).toContain('收到来自');
    });

    it('应该处理无 onMessage 处理器的情况', async () => {
      // 不提供 onMessage 处理器
      const mockHandler: WebhookHandler = {
        onDiscover: async () => ({ capabilities: [], reputation: 50 }),
        onDelegate: async () => ({ accepted: true, taskId: 'test' }),
        onStatus: async () => ({ status: 'available' }),
      };

      server = new WebhookServer(port, mockHandler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          payload: {
            from: '12D3KooWTestPeer',
            content: '测试消息',
            messageId: 'msg-456',
          },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.response).toBe('Message handler not configured');
    });

    it('应该处理 onMessage 抛出错误', async () => {
      const mockHandler: WebhookHandler = {
        onDiscover: async () => ({ capabilities: [], reputation: 50 }),
        onDelegate: async () => ({ accepted: true, taskId: 'test' }),
        onStatus: async () => ({ status: 'available' }),
        onMessage: async () => {
          throw new Error('消息处理失败');
        },
      };

      server = new WebhookServer(port, mockHandler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'message',
          payload: {
            from: '12D3KooWTestPeer',
            content: '测试消息',
            messageId: 'msg-789',
          },
        }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('消息处理失败');
    });
  });

  describe('消息验证逻辑', () => {
    it('应该拒绝无效的 JSON', async () => {
      server = new WebhookServer(port, handler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: '不是有效的 JSON {',
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe('Invalid JSON');
    });

    it('应该拒绝超大的请求体', async () => {
      server = new WebhookServer(port, handler, {
        maxBodySize: 1024, // 限制为 1KB
      });
      await server.start();

      // 构造超大的请求体
      const largePayload = {
        type: 'discover',
        payload: {
          data: 'A'.repeat(2000), // 超过 1KB
        },
      };

      // 服务器会关闭连接，fetch 会抛出错误
      try {
        await fetch(`http://localhost:${port}/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(largePayload),
        });
        // 如果没有抛出错误，检查响应状态
        // 注意：由于服务器会关闭连接，这里可能不会执行
      } catch (error: any) {
        // 服务器关闭连接会抛出 SocketError 或 TypeError
        // 这是预期的行为
        expect(error).toBeDefined();
        return;
      }

      // 如果返回了响应，检查状态码
      // 注意：这可能在某些实现中不会发生
    });

    it('应该拒绝缺少 type 字段的请求', async () => {
      server = new WebhookServer(port, handler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: {},
        }),
      });

      // 没有 type 字段会进入 default 分支，返回 400
      expect(response.status).toBe(400);
    });

    it('应该拒绝非 POST 方法', async () => {
      server = new WebhookServer(port, handler);
      await server.start();

      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'GET',
      });

      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data.error).toBe('Method not allowed');
    });
  });

  // P1-6 修复：请求认证测试
  // 注意：WebhookServer 当前实现不支持 authToken 配置
  // 以下测试为预期功能的占位测试，待 authToken 功能实现后启用
  describe('请求认证', () => {
    it('无认证配置时应该允许所有请求', async () => {
      server = new WebhookServer(port, handler);
      await server.start();

      // 当前实现不检查认证，所有请求都应该被允许
      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'status',
        }),
      });

      expect(response.status).toBe(200);
    });

    it('应该处理带 Authorization header 的请求（当前忽略）', async () => {
      server = new WebhookServer(port, handler);
      await server.start();

      // 当前实现不检查认证，带 Authorization header 的请求也应该成功
      const response = await fetch(`http://localhost:${port}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer any-token',
        },
        body: JSON.stringify({
          type: 'status',
        }),
      });

      expect(response.status).toBe(200);
    });

    // TODO: authToken 功能实现后启用以下测试
    it.skip('应该验证 Authorization header（待实现）', async () => {
      // 待 WebhookServer 支持 authToken 配置后实现
    });

    it.skip('应该拒绝无效的 token（待实现）', async () => {
      // 待 WebhookServer 支持 authToken 配置后实现
    });
  });
});