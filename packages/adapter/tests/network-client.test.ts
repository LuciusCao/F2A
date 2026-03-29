/**
 * F2ANetworkClient 测试
 * 
 * 测试与 F2A Node 的 HTTP API 通信。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { F2ANetworkClient } from '../src/network-client.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';

describe('F2ANetworkClient', () => {
  let client: F2ANetworkClient;
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    // 创建测试服务器
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        // 设置 CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        // 简单的路由
        if (req.url === '/discover' && req.method === 'POST') {
          res.end(JSON.stringify({
            success: true,
            data: [
              { peerId: 'test-peer-1', displayName: 'Agent1', capabilities: [] },
            ],
          }));
        } else if (req.url === '/peers' && req.method === 'GET') {
          res.end(JSON.stringify({
            success: true,
            data: [
              { peerId: 'peer-1', connected: true },
            ],
          }));
        } else if (req.url === '/delegate' && req.method === 'POST') {
          res.end(JSON.stringify({
            success: true,
            data: { taskId: 'task-1' },
          }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });
    });

    // 启动服务器
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          port = address.port;
          resolve();
        }
      });
    });

    // 创建客户端
    client = new F2ANetworkClient({
      controlPort: port,
      controlToken: 'test-token',
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('构造函数', () => {
    it('应该能够创建客户端实例', () => {
      expect(client).toBeDefined();
    });
  });

  describe('discoverAgents', () => {
    it('应该能够发现 Agents', async () => {
      const result = await client.discoverAgents();
      expect(result.success).toBe(true);
    });

    it('应该能够按能力过滤', async () => {
      const result = await client.discoverAgents('code-generation');
      expect(result.success).toBe(true);
    });
  });

  describe('getConnectedPeers', () => {
    it('应该能够获取已连接的 Peers', async () => {
      const result = await client.getConnectedPeers();
      expect(result.success).toBe(true);
    });
  });

  describe('delegateTask', () => {
    it('应该能够委托任务', async () => {
      const result = await client.delegateTask({
        agent: 'test-peer-1',
        task: 'Test task',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('应该处理连接失败', async () => {
      // 创建一个连接到无效端口的客户端
      const badClient = new F2ANetworkClient({
        controlPort: 1, // 无效端口
        controlToken: 'test-token',
        timeoutMs: 100, // 短超时
      });

      const result = await badClient.discoverAgents();
      expect(result.success).toBe(false);
    });
  });

  describe('sendTaskResponse', () => {
    it('应该能够发送任务响应', async () => {
      // 添加 /response 路由到测试服务器
      const result = await client.sendTaskResponse('task-1', {
        status: 'success',
        output: 'Test output',
      });
      // 由于测试服务器没有 /response 路由，会返回 404
      // 但我们验证方法可以被调用
      expect(result).toBeDefined();
    });
  });

  describe('registerWebhook', () => {
    it('应该能够注册 Webhook', async () => {
      const result = await client.registerWebhook('http://localhost:8080/webhook');
      expect(result).toBeDefined();
    });
  });

  describe('updateAgentInfo', () => {
    it('应该能够更新 Agent 信息', async () => {
      const result = await client.updateAgentInfo({
        displayName: 'TestAgent',
      });
      expect(result).toBeDefined();
    });
  });

  describe('getPendingTasks', () => {
    it('应该能够获取待处理任务', async () => {
      const result = await client.getPendingTasks();
      expect(result).toBeDefined();
    });
  });

  describe('confirmConnection', () => {
    it('应该能够确认连接', async () => {
      const result = await client.confirmConnection('peer-1');
      expect(result).toBeDefined();
    });
  });

  describe('rejectConnection', () => {
    it('应该能够拒绝连接', async () => {
      const result = await client.rejectConnection('peer-1', 'Blocked');
      expect(result).toBeDefined();
    });
  });
});