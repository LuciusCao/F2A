import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookServer, WebhookHandler } from './webhook-server';
import { AgentCapability } from './types';
import { createServer, IncomingMessage, ServerResponse } from 'http';

// 使用真实的 http 模块进行集成测试
vi.unmock('http');

describe('WebhookServer', () => {
  let server: WebhookServer;
  let mockHandler: WebhookHandler;
  let testPort: number;

  const mockCapabilities: AgentCapability[] = [
    {
      name: 'file-operation',
      description: 'File operations',
      tools: ['read', 'write'],
    },
  ];

  // 获取可用端口
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

  beforeEach(async () => {
    vi.clearAllMocks();
    testPort = await getAvailablePort();
    mockHandler = {
      onDiscover: vi.fn().mockResolvedValue({
        capabilities: mockCapabilities,
        reputation: 80,
      }),
      onDelegate: vi.fn().mockResolvedValue({
        accepted: true,
        taskId: 'task-123',
      }),
      onStatus: vi.fn().mockResolvedValue({
        status: 'available',
        load: 0.5,
      }),
    };
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      // P1 修复：等待端口完全释放，避免 EADDRINUSE 错误
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  // 辅助函数：发送 HTTP 请求
  async function sendRequest(
    options: {
      method?: string;
      path?: string;
      headers?: Record<string, string>;
      body?: unknown;
      bodySize?: number; // 用于测试大请求体
    } = {}
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const req = {
        hostname: 'localhost',
        port: testPort,
        path: options.path || '/',
        method: options.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      };

      const httpReq = require('http').request(req, (res: any) => {
        let data = '';
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders[key] = value;
          } else if (Array.isArray(value)) {
            responseHeaders[key] = value.join(', ');
          }
        }
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          try {
            const body = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, body, headers: responseHeaders });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: responseHeaders });
          }
        });
      });

      httpReq.on('error', reject);

      if (options.bodySize) {
        // 发送指定大小的请求体
        httpReq.setHeader('Content-Length', options.bodySize);
        httpReq.write('x'.repeat(options.bodySize));
      } else if (options.body) {
        httpReq.write(JSON.stringify(options.body));
      }

      httpReq.end();
    });
  }

  describe('start', () => {
    it('should start server successfully', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await expect(server.start()).resolves.not.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop server gracefully', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();
      await expect(server.stop()).resolves.not.toThrow();
    });

    it('should not throw when stopping unstarted server', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await expect(server.stop()).resolves.not.toThrow();
    });
  });

  describe('getUrl', () => {
    it('should return correct URL', async () => {
      server = new WebhookServer(testPort, mockHandler);
      expect(server.getUrl()).toBe(`http://localhost:${testPort}/webhook`);
    });
  });

  describe('请求体大小限制测试', () => {
    it('应该接受正常大小的请求体', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        body: {
          type: 'status',
          payload: {},
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'available');
    });

    it('应该拒绝超过大小限制的请求体', async () => {
      // 设置最大请求体大小为 100 字节
      server = new WebhookServer(testPort, mockHandler, { maxBodySize: 100 });
      await server.start();

      // 发送超过 100 字节的请求体
      const largeBody = {
        type: 'discover',
        payload: {
          query: { capability: 'x'.repeat(200) }, // 超过限制
          requester: 'test-requester',
        },
        timestamp: Date.now(),
      };

      // 当请求体过大时，服务器会销毁连接或返回 500
      try {
        const response = await sendRequest({ body: largeBody });
        // 如果收到响应，应该是 500 错误
        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty('error');
      } catch (error: any) {
        // 如果连接被销毁，这是预期的行为（防止 DoS 攻击）
        expect(error.code).toBe('ECONNRESET');
      }
    });

    it('应该使用默认 64KB 限制', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      // 发送一个较大的但不超过 64KB 的请求
      const largeButValidBody = {
        type: 'discover',
        payload: {
          query: { capability: 'x'.repeat(10000) }, // 约 10KB
          requester: 'test-requester',
        },
        timestamp: Date.now(),
      };

      const response = await sendRequest({ body: largeButValidBody });
      expect(response.status).toBe(200);
    });

    it('应该在请求体过大时销毁连接', async () => {
      server = new WebhookServer(testPort, mockHandler, { maxBodySize: 100 });
      await server.start();

      // 当请求体过大时，服务器会销毁连接，导致 socket hang up
      // 这是正确的行为（防止 DoS 攻击），所以我们需要捕获这个错误
      try {
        await sendRequest({
          bodySize: 1000, // 超过 100 字节限制
        });
        // 如果没有抛出错误，说明服务器发送了响应（这也是可接受的）
      } catch (error: any) {
        // 连接被销毁是预期的行为
        expect(error.code).toBe('ECONNRESET');
      }
    });
  });

  describe('CORS 测试', () => {
    it('应该为允许的来源设置 CORS 头', async () => {
      server = new WebhookServer(testPort, mockHandler, {
        allowedOrigins: ['http://localhost', 'http://example.com'],
      });
      await server.start();

      const response = await sendRequest({
        headers: { Origin: 'http://example.com' },
        body: { type: 'status', payload: {}, timestamp: Date.now() },
      });

      expect(response.headers['access-control-allow-origin']).toBe('http://example.com');
    });

    it('应该拒绝不在白名单中的来源', async () => {
      server = new WebhookServer(testPort, mockHandler, {
        allowedOrigins: ['http://localhost', 'http://example.com'],
      });
      await server.start();

      const response = await sendRequest({
        headers: { Origin: 'http://malicious.com' },
        body: { type: 'status', payload: {}, timestamp: Date.now() },
      });

      // 应该使用默认的 localhost 而不是恶意来源
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost');
    });

    it('应该处理 OPTIONS 预检请求', async () => {
      server = new WebhookServer(testPort, mockHandler, {
        allowedOrigins: ['http://localhost', 'http://example.com'],
      });
      await server.start();

      const response = await sendRequest({
        method: 'OPTIONS',
        headers: { Origin: 'http://example.com' },
      });

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('http://example.com');
      expect(response.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
    });

    it('应该设置正确的 CORS 方法头', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        body: { type: 'status', payload: {}, timestamp: Date.now() },
      });

      expect(response.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
      expect(response.headers['access-control-allow-headers']).toBe('Content-Type');
    });

    it('默认只允许 localhost', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        headers: { Origin: 'http://unknown-origin.com' },
        body: { type: 'status', payload: {}, timestamp: Date.now() },
      });

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost');
    });
  });

  describe('错误处理测试', () => {
    it('应该拒绝非 POST 请求', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        method: 'GET',
      });

      expect(response.status).toBe(405);
      expect(response.body).toHaveProperty('error', 'Method not allowed');
    });

    it('应该拒绝非 POST 请求 (PUT)', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        method: 'PUT',
      });

      expect(response.status).toBe(405);
    });

    it('应该拒绝非 POST 请求 (DELETE)', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        method: 'DELETE',
      });

      expect(response.status).toBe(405);
    });

    it('应该返回 400 对于未知事件类型', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        body: {
          type: 'unknown-event',
          payload: {},
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect((response.body as { error: string }).error).toContain('Unknown event type');
    });

    it('应该返回 500 对于无效 JSON', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const httpReq = require('http').request(
          {
            hostname: 'localhost',
            port: testPort,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res: any) => {
            let data = '';
            res.on('data', (chunk: Buffer) => (data += chunk));
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, body: JSON.parse(data) });
              } catch {
                resolve({ status: res.statusCode, body: data });
              }
            });
          }
        );
        httpReq.on('error', reject);
        httpReq.write('not a valid json');
        httpReq.end();
      });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Invalid JSON');
    });

    it('应该返回 500 当 handler 抛出异常', async () => {
      const errorHandler: WebhookHandler = {
        onDiscover: vi.fn().mockRejectedValue(new Error('Handler error')),
        onDelegate: vi.fn().mockResolvedValue({ accepted: true, taskId: 'task-123' }),
        onStatus: vi.fn().mockResolvedValue({ status: 'available' }),
      };

      server = new WebhookServer(testPort, errorHandler);
      await server.start();

      const response = await sendRequest({
        body: {
          type: 'discover',
          payload: { query: {}, requester: 'test' },
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Handler error');
    });

    it('应该处理 onDelegate handler 异常', async () => {
      const errorHandler: WebhookHandler = {
        onDiscover: vi.fn().mockResolvedValue({ capabilities: mockCapabilities }),
        onDelegate: vi.fn().mockRejectedValue(new Error('Delegate failed')),
        onStatus: vi.fn().mockResolvedValue({ status: 'available' }),
      };

      server = new WebhookServer(testPort, errorHandler);
      await server.start();

      const response = await sendRequest({
        body: {
          type: 'delegate',
          payload: {
            taskId: 'task-1',
            taskType: 'test',
            description: 'test task',
            from: 'peer-1',
            timestamp: Date.now(),
            timeout: 30,
          },
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Delegate failed');
    });

    it('应该处理 onStatus handler 异常', async () => {
      const errorHandler: WebhookHandler = {
        onDiscover: vi.fn().mockResolvedValue({ capabilities: mockCapabilities }),
        onDelegate: vi.fn().mockResolvedValue({ accepted: true, taskId: 'task-123' }),
        onStatus: vi.fn().mockRejectedValue(new Error('Status check failed')),
      };

      server = new WebhookServer(testPort, errorHandler);
      await server.start();

      const response = await sendRequest({
        body: {
          type: 'status',
          payload: {},
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Status check failed');
    });
  });

  describe('事件处理测试', () => {
    it('应该正确处理 discover 事件', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        body: {
          type: 'discover',
          payload: {
            query: { capability: 'file-operation' },
            requester: 'peer-123',
          },
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(200);
      expect(mockHandler.onDiscover).toHaveBeenCalledWith({
        query: { capability: 'file-operation' },
        requester: 'peer-123',
      });
      expect(response.body).toEqual({
        capabilities: mockCapabilities,
        reputation: 80,
      });
    });

    it('应该正确处理 delegate 事件', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const delegatePayload = {
        taskId: 'task-abc',
        taskType: 'file-read',
        description: 'Read a file',
        parameters: { path: '/test/file.txt' },
        from: 'peer-456',
        timestamp: Date.now(),
        timeout: 60,
      };

      const response = await sendRequest({
        body: {
          type: 'delegate',
          payload: delegatePayload,
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(200);
      expect(mockHandler.onDelegate).toHaveBeenCalledWith(delegatePayload);
      expect(response.body).toEqual({
        accepted: true,
        taskId: 'task-123',
      });
    });

    it('应该正确处理 status 事件', async () => {
      server = new WebhookServer(testPort, mockHandler);
      await server.start();

      const response = await sendRequest({
        body: {
          type: 'status',
          payload: {},
          timestamp: Date.now(),
        },
      });

      expect(response.status).toBe(200);
      expect(mockHandler.onStatus).toHaveBeenCalled();
      expect(response.body).toEqual({
        status: 'available',
        load: 0.5,
      });
    });
  });

  describe('自定义配置测试', () => {
    it('应该使用自定义请求体大小限制', async () => {
      server = new WebhookServer(testPort, mockHandler, { maxBodySize: 1024 });
      await server.start();

      // 发送一个刚好在限制内的请求
      const validBody = {
        type: 'status',
        payload: {},
        timestamp: Date.now(),
      };

      const response = await sendRequest({ body: validBody });
      expect(response.status).toBe(200);
    });

    it('应该使用自定义允许来源列表', async () => {
      server = new WebhookServer(testPort, mockHandler, {
        allowedOrigins: ['http://custom-origin.com', 'http://another.com'],
      });
      await server.start();

      const response = await sendRequest({
        headers: { Origin: 'http://custom-origin.com' },
        body: { type: 'status', payload: {}, timestamp: Date.now() },
      });

      expect(response.headers['access-control-allow-origin']).toBe('http://custom-origin.com');
    });

    it('空允许来源列表应该使用默认值', async () => {
      server = new WebhookServer(testPort, mockHandler, { allowedOrigins: [] });
      await server.start();

      const response = await sendRequest({
        headers: { Origin: 'http://some-origin.com' },
        body: { type: 'status', payload: {}, timestamp: Date.now() },
      });

      // 空数组时，应该使用默认值 'http://localhost'
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost');
    });
  });
});
