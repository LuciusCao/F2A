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
});