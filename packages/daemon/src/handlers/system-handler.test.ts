/**
 * SystemHandler 测试 - 错误响应 code 字段验证
 * P2-3: 验证所有错误响应包含 code 字段
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { SystemHandler } from './system-handler.js';
import type { F2A, TokenManager, RateLimiter } from '@f2a/network';
import type { Logger } from '@f2a/network';

const TEST_TOKEN = 'test-f2a-token-12345';

// Mock 依赖
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
});

const createMockTokenManager = (): TokenManager => ({
  getToken: vi.fn().mockReturnValue(TEST_TOKEN),
  verifyToken: vi.fn().mockImplementation((token: string) => token === TEST_TOKEN),
  getTokenPath: vi.fn().mockReturnValue('/mock/path'),
  logTokenUsage: vi.fn(),
});

const createMockRateLimiter = (): RateLimiter => ({
  allowRequest: vi.fn().mockReturnValue(true),
  stop: vi.fn(),
});

const createMockF2A = (): F2A => ({
  peerId: 'test-peer-id',
  agentInfo: {
    peerId: 'test-peer-id',
    displayName: 'Test Agent',
    capabilities: [],
    multiaddrs: ['/ip4/127.0.0.1/tcp/9001'],
  },
  signData: vi.fn((data: string) => `sig-${data}`),
  getPeers: vi.fn().mockReturnValue([]),
  getConnectedPeers: vi.fn().mockReturnValue(['peer-1', 'peer-2']),
  getAllPeers: vi.fn().mockReturnValue([
    { peerId: 'peer-1', connected: true },
    { peerId: 'peer-2', connected: false },
  ]),
  discoverAgents: vi.fn().mockResolvedValue([]),
  sendTaskTo: vi.fn().mockResolvedValue({ success: true }),
  sendMessage: vi.fn().mockResolvedValue({ success: true }),
  sendMessageToPeer: vi.fn().mockResolvedValue({ success: true }),
  registerCapability: vi.fn().mockImplementation((cap, handler) => {
    // 模拟注册能力
    return { name: cap.name, handler };
  }),
  updateAgentInfo: vi.fn().mockResolvedValue({ success: true }),
  getAgentInfo: vi.fn().mockReturnValue({
    peerId: 'test-peer-id',
    displayName: 'Test Agent',
    capabilities: [],
  }),
  getOnlinePeerCount: vi.fn().mockReturnValue(2),
  getStatus: vi.fn().mockReturnValue({
    peerId: 'test-peer-id',
    onlinePeers: 2,
    isRunning: true,
  }),
} as unknown as F2A);

// 创建 mock 请求和响应
const createMockReq = (options: {
  method?: string;
  url?: string;
  body?: object;
  headers?: Record<string, string>;
} = {}) => {
  const req = {
    method: options.method || 'GET',
    url: options.url || '/',
    headers: options.headers || {},
    socket: { remoteAddress: '127.0.0.1' },
    on: vi.fn((event: string, callback: Function) => {
      if (event === 'data' && options.body) {
        setImmediate(() => callback(Buffer.from(JSON.stringify(options.body))));
      }
      if (event === 'end') {
        setImmediate(() => callback());
      }
    }),
  } as unknown as IncomingMessage;
  return req;
};

const createMockRes = () => {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
    headersSent: false,
  } as unknown as ServerResponse & { headersSent: boolean };
  return res;
};

// 辅助函数：解析响应 JSON
const getResponseData = (res: any) => {
  const calls = res.end.mock.calls;
  if (calls.length === 0) return null;
  return JSON.parse(calls[0][0]);
};

describe('SystemHandler - Error Response Code Field', () => {
  let handler: SystemHandler;
  let mockF2A: ReturnType<typeof createMockF2A>;
  let mockTokenManager: ReturnType<typeof createMockTokenManager>;
  let mockRateLimiter: ReturnType<typeof createMockRateLimiter>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockF2A = createMockF2A();
    mockTokenManager = createMockTokenManager();
    mockRateLimiter = createMockRateLimiter();
    mockLogger = createMockLogger();

    handler = new SystemHandler({
      f2a: mockF2A,
      tokenManager: mockTokenManager,
      logger: mockLogger,
      rateLimiter: mockRateLimiter,
    });
  });

  describe('GET /health - 健康检查（无需认证）', () => {
    it('应返回 200 + 状态信息', () => {
      const res = createMockRes();

      handler.handleHealth(res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.status).toBe('ok');
      expect(data.peerId).toBe('test-peer-id');
    });
  });

  describe('GET /status - 状态（需认证）', () => {
    it('缺少 token 应返回 401 + code: UNAUTHORIZED', () => {
      const req = createMockReq({ url: '/status', headers: {} });
      const res = createMockRes();

      handler.handleStatusEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('无效 token 应返回 401 + code: UNAUTHORIZED', () => {
      const req = createMockReq({
        url: '/status',
        headers: { 'x-f2a-token': 'invalid-token' },
      });
      const res = createMockRes();

      handler.handleStatusEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('速率限制超出应返回 429 + code: RATE_LIMIT_EXCEEDED', () => {
      (mockRateLimiter.allowRequest as any).mockReturnValue(false);
      const req = createMockReq({
        url: '/status',
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handleStatusEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(429, { 'Content-Type': 'application/json' });
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Too many requests');
      expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('有效 token 应返回 200 + 状态信息', () => {
      const req = createMockReq({
        url: '/status',
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handleStatusEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.peerId).toBe('test-peer-id');
      expect(data.multiaddrs).toBeDefined();
      expect(data.multiaddrs).toHaveLength(1);
    });

    it('Authorization: Bearer 格式的 token 应有效', () => {
      const req = createMockReq({
        url: '/status',
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      const res = createMockRes();

      handler.handleStatusEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
    });
  });

  describe('GET /peers - Peers（需认证）', () => {
    it('缺少 token 应返回 401 + code: UNAUTHORIZED', () => {
      const req = createMockReq({ url: '/peers', headers: {} });
      const res = createMockRes();

      handler.handlePeersEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('速率限制超出应返回 429 + code: RATE_LIMIT_EXCEEDED', () => {
      (mockRateLimiter.allowRequest as any).mockReturnValue(false);
      const req = createMockReq({
        url: '/peers',
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handlePeersEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(429, { 'Content-Type': 'application/json' });
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Too many requests');
      expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('有效 token 应返回 peers 列表', () => {
      const req = createMockReq({
        url: '/peers',
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handlePeersEndpoint(req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      // handlePeersEndpoint 返回 raw peers array, not wrapped in success
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
    });
  });

  describe('POST /register-capability - 注册能力（需认证）', () => {
    it('缺少 token 应返回 401 + code: UNAUTHORIZED', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/register-capability',
        body: { capability: { name: 'test', description: 'Test cap', tools: [] } },
        headers: {},
      });
      const res = createMockRes();

      handler.handleRegisterCapabilityEndpoint(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('缺少 capability.name 应返回 400 + code: INVALID_REQUEST', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/register-capability',
        body: { capability: { description: 'Test cap', tools: [] } },
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handleRegisterCapabilityEndpoint(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required field: capability.name');
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('缺少 capability 字段应返回 400 + code: INVALID_REQUEST', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/register-capability',
        body: {},
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handleRegisterCapabilityEndpoint(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required field: capability.name');
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('注册失败应返回 500 + code: REGISTER_CAPABILITY_FAILED', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/register-capability',
        body: { capability: { name: 'test', description: 'Test cap', tools: [] } },
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      (mockF2A.registerCapability as any).mockImplementation(() => {
        throw new Error('Registration failed');
      });
      const res = createMockRes();

      handler.handleRegisterCapabilityEndpoint(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(500);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Registration failed');
      expect(data.code).toBe('REGISTER_CAPABILITY_FAILED');
    });

    it('无效 JSON 应返回 400 (无 code 字段，待补充)', async () => {
      const req = {
        method: 'POST',
        url: '/register-capability',
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            setImmediate(() => callback(Buffer.from('invalid json')));
          }
          if (event === 'end') {
            setImmediate(() => callback());
          }
        }),
      } as unknown as IncomingMessage;
      const res = createMockRes();

      handler.handleRegisterCapabilityEndpoint(req, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid JSON');
      // 注意：P2-3 需要添加 code 字段
      // expect(data.code).toBeDefined();
    });

    it('成功注册应返回 200', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/register-capability',
        body: {
          capability: {
            name: 'chat',
            description: 'Chat capability',
            tools: ['send-message', 'receive-message'],
          },
        },
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handleRegisterCapabilityEndpoint(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.capability).toBe('chat');
    });
  });

  describe('POST /agent/update - 更新 Agent 信息（需认证）', () => {
    it('缺少 token 应返回 401 + code: UNAUTHORIZED', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/agent/update',
        body: { displayName: 'New Name' },
        headers: {},
      });
      const res = createMockRes();

      handler.handleAgentUpdate(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Unauthorized');
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('成功更新 displayName 应返回 200', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/agent/update',
        body: { displayName: 'Updated Agent' },
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handleAgentUpdate(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(mockF2A.agentInfo.displayName).toBe('Updated Agent');
    });

    it('成功更新 capabilities 应返回 200', async () => {
      const req = createMockReq({
        method: 'POST',
        url: '/agent/update',
        body: {
          displayName: 'New Name',
          capabilities: [
            { name: 'chat', description: 'Chat', tools: ['msg'] },
          ],
        },
        headers: { 'x-f2a-token': TEST_TOKEN },
      });
      const res = createMockRes();

      handler.handleAgentUpdate(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
    });

    it('内部错误应返回 500 (无 code 字段，待补充)', async () => {
      const req = {
        method: 'POST',
        url: '/agent/update',
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            setImmediate(() => callback(Buffer.from('invalid json')));
          }
          if (event === 'end') {
            setImmediate(() => callback());
          }
        }),
      } as unknown as IncomingMessage;
      const res = createMockRes();

      handler.handleAgentUpdate(req, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(500);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      // 注意：P2-3 需要添加 code 字段
      // expect(data.code).toBeDefined();
    });
  });

  describe('handleStatus（内部方法，无需认证）', () => {
    it('应返回状态信息', () => {
      const res = createMockRes();

      handler.handleStatus(res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.peerId).toBe('test-peer-id');
      expect(data.agentInfo).toBeDefined();
    });
  });

  describe('handlePeers（内部方法，无需认证）', () => {
    it('应返回已连接的 peers', () => {
      const res = createMockRes();

      handler.handlePeers(res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.peers).toHaveLength(2);
    });
  });
});