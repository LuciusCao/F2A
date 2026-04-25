/**
 * MessageHandler 测试 - 错误响应 code 字段验证
 * P2-3: 验证所有错误响应包含 code 字段
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { MessageHandler } from './message-handler.js';
import type { MessageRouter, AgentRegistry, F2A } from '@f2a/network';
import type { AgentTokenManager } from '../agent-token-manager.js';
import type { Logger } from '@f2a/network';

// Mock 依赖
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
});

const createMockAgentRegistry = (): AgentRegistry => ({
  register: vi.fn().mockReturnValue({
    agentId: 'agent:test-peer:abc123',
    name: 'TestAgent',
    capabilities: [],
    peerId: 'test-peer-id',
    signature: 'test-sig',
    registeredAt: new Date(),
    lastActiveAt: new Date(),
    webhook: { url: 'http://test' },
  }),
  restore: vi.fn().mockReturnValue({
    agentId: 'agent:test-peer:abc123',
    name: 'TestAgent',
    capabilities: [],
    peerId: 'test-peer-id',
    signature: 'test-sig',
    registeredAt: new Date(),
    lastActiveAt: new Date(),
  }),
  unregister: vi.fn().mockReturnValue(true),
  get: vi.fn(),
  list: vi.fn().mockReturnValue([]),
  getStats: vi.fn().mockReturnValue({ total: 0 }),
  updateWebhook: vi.fn().mockReturnValue(true),
  updateLastActive: vi.fn().mockReturnValue(true),
  getAgentsMap: vi.fn().mockReturnValue(new Map()),
  save: vi.fn(),
  load: vi.fn(),
});

const createMockAgentTokenManager = (): AgentTokenManager => ({
  generate: vi.fn().mockImplementation((agentId: string) => `agent-token-${agentId.slice(0, 8)}`),
  verify: vi.fn().mockImplementation((token: string) => {
    if (!token) return { valid: false, error: 'Token is empty' };
    return { valid: true, agentId: 'agent:test-peer:abc123' };
  }),
  verifyForAgent: vi.fn().mockImplementation((token: string, agentId: string) => {
    if (!token) return { valid: false, error: 'Token is empty' };
    return { valid: true };
  }),
  revoke: vi.fn().mockReturnValue(true),
  revokeAllForAgent: vi.fn().mockReturnValue(1),
  cleanExpired: vi.fn().mockReturnValue(0),
  clear: vi.fn(),
  get: vi.fn().mockReturnValue(undefined),
  list: vi.fn().mockReturnValue([]),
  listByAgent: vi.fn().mockReturnValue([]),
  has: vi.fn().mockReturnValue(false),
  size: vi.fn().mockReturnValue(0),
});

const createMockMessageRouter = (): MessageRouter => ({
  route: vi.fn().mockResolvedValue({ success: true }),
  routeLocal: vi.fn().mockResolvedValue({ success: true }),
  routeRemote: vi.fn().mockResolvedValue({ success: true }),
  routeAsync: vi.fn().mockResolvedValue(true),
  broadcast: vi.fn().mockReturnValue(0),
  broadcastAsync: vi.fn().mockResolvedValue(0),
  createQueue: vi.fn(),
  getQueue: vi.fn(),
  deleteQueue: vi.fn(),
  getMessages: vi.fn().mockReturnValue([]),
  clearMessages: vi.fn().mockReturnValue(0),
  sendMessage: vi.fn().mockResolvedValue({ success: true }),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
});

const createMockF2A = (): F2A => ({
  peerId: 'test-peer-id',
  agentInfo: {
    peerId: 'test-peer-id',
    displayName: 'Test Agent',
    capabilities: [],
  },
  signData: vi.fn((data: string) => `sig-${data}`),
  getPeers: vi.fn().mockReturnValue([]),
  getConnectedPeers: vi.fn().mockReturnValue([]),
  getAllPeers: vi.fn().mockReturnValue([]),
  discoverAgents: vi.fn().mockResolvedValue([]),
  sendTaskTo: vi.fn().mockResolvedValue({ success: true }),
  sendMessage: vi.fn().mockResolvedValue({ success: true }),
  sendMessageToPeer: vi.fn().mockResolvedValue({ success: true }),
  registerCapability: vi.fn().mockResolvedValue({ success: true }),
  updateAgentInfo: vi.fn().mockResolvedValue({ success: true }),
  getAgentInfo: vi.fn().mockReturnValue({
    peerId: 'test-peer-id',
    displayName: 'Test Agent',
    capabilities: [],
  }),
  getOnlinePeerCount: vi.fn().mockReturnValue(0),
  getStatus: vi.fn().mockReturnValue({
    peerId: 'test-peer-id',
    onlinePeers: 0,
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

describe('MessageHandler - Error Response Code Field', () => {
  let handler: MessageHandler;
  let mockRegistry: ReturnType<typeof createMockAgentRegistry>;
  let mockTokenManager: ReturnType<typeof createMockAgentTokenManager>;
  let mockMessageRouter: ReturnType<typeof createMockMessageRouter>;
  let mockF2A: ReturnType<typeof createMockF2A>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry = createMockAgentRegistry();
    mockTokenManager = createMockAgentTokenManager();
    mockMessageRouter = createMockMessageRouter();
    mockF2A = createMockF2A();
    mockLogger = createMockLogger();

    handler = new MessageHandler({
      messageRouter: mockMessageRouter,
      agentRegistry: mockRegistry,
      f2a: mockF2A,
      agentTokenManager: mockTokenManager,
      logger: mockLogger,
    });
  });

  describe('POST /api/v1/messages - 发送消息', () => {
    it('缺少 fromAgentId 和 content 应返回 400 + code: INVALID_REQUEST', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {},
        headers: { authorization: 'agent-test-token' },
      });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required fields');
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('缺少 fromAgentId 应返回 400 + code: INVALID_REQUEST', async () => {
      const req = createMockReq({
        method: 'POST',
        body: { content: 'Hello' },
        headers: { authorization: 'agent-test-token' },
      });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required fields');
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('缺少 content 应返回 400 + code: INVALID_REQUEST', async () => {
      const req = createMockReq({
        method: 'POST',
        body: { fromAgentId: 'agent:test-peer:abc123' },
        headers: { authorization: 'agent-test-token' },
      });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing required fields');
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('缺少 Authorization header 应返回 401 + code: MISSING_TOKEN', async () => {
      const req = createMockReq({
        method: 'POST',
        body: { fromAgentId: 'agent:test-peer:abc123', content: 'Hello' },
        headers: {}, // 没有 authorization
      });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(401);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Missing Authorization header');
      expect(data.code).toBe('MISSING_TOKEN');
    });

    it('发送方 Agent 未注册应返回 400 + code: AGENT_NOT_REGISTERED', async () => {
      const req = createMockReq({
        method: 'POST',
        body: { fromAgentId: 'agent:nonexistent', content: 'Hello' },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue(undefined);
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Sender agent not registered');
      expect(data.code).toBe('AGENT_NOT_REGISTERED');
    });

    it('Token 验证失败应返回 401 + code: INVALID_TOKEN', async () => {
      const req = createMockReq({
        method: 'POST',
        body: { fromAgentId: 'agent:test-peer:abc123', content: 'Hello' },
        headers: { authorization: 'agent-invalid-token' },
      });
      (mockRegistry.get as any).mockReturnValue({
        agentId: 'agent:test-peer:abc123',
        name: 'TestAgent',
      });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({
        valid: false,
        error: 'Token verification failed',
      });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(401);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Token verification failed');
      expect(data.code).toBe('INVALID_TOKEN');
    });

    it('Token 系统错误应返回 500 + code: TOKEN_SYSTEM_ERROR', async () => {
      const req = createMockReq({
        method: 'POST',
        body: { fromAgentId: 'agent:test-peer:abc123', content: 'Hello' },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({
        agentId: 'agent:test-peer:abc123',
        name: 'TestAgent',
      });
      (mockTokenManager.verifyForAgent as any).mockImplementation(() => {
        throw new Error('Token system error');
      });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(500);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Token verification system error');
      expect(data.code).toBe('TOKEN_SYSTEM_ERROR');
    });

    it('接收方 Agent 未注册应返回 400 + code: AGENT_NOT_REGISTERED', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:nonexistent',
          content: 'Hello',
        },
        headers: { authorization: 'agent-test-token' },
      });
      // 发送方已注册
      (mockRegistry.get as any).mockImplementation((agentId: string) => {
        if (agentId === 'agent:test-peer:abc123') {
          return { agentId, name: 'TestAgent' };
        }
        return undefined;
      });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Target agent not registered');
      expect(data.code).toBe('AGENT_NOT_REGISTERED');
    });

    it('路由消息失败应返回 500 + code: ROUTE_FAILED', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Hello',
        },
        headers: { authorization: 'agent-test-token' },
      });
      // 双方都注册了
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      (mockMessageRouter.routeAsync as any).mockResolvedValue(false);
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(500);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to route message');
      expect(data.code).toBe('ROUTE_FAILED');
    });

    it('broadcastAsync 错误被内部 catch 捕获应返回 400 + code: INVALID_REQUEST', async () => {
      // 注意：当前代码行为 - broadcastAsync 的 rejection 被内部 try-catch 捕获
      // 这是因为 await broadcastAsync 在 try 块内，所以 rejection 被 catch(error) 捕获
      // 返回 400 + code: INVALID_REQUEST
      // 如果要触发外层 catch 返回 500 INTERNAL_ERROR，需要修改代码逻辑
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          content: 'Hello',
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      // broadcastAsync 在 try 块内，rejection 被内部 catch 捕获
      (mockMessageRouter.broadcastAsync as any).mockImplementation(() => {
        return Promise.reject(new Error('Broadcast failed'));
      });
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 50));

      // 当前行为：错误被内部 catch 捕获，返回 400
      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Broadcast failed');
      expect(data.code).toBe('INVALID_REQUEST');
    });

    it('成功发送消息（广播）应返回 200', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          content: 'Hello everyone',
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'agent:test-peer:abc123', name: 'TestAgent' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      (mockMessageRouter.broadcastAsync as any).mockResolvedValue(5);
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.messageId).toBeDefined();
      expect(data.broadcasted).toBe(5);
    });

    it('成功发送消息（定向）应返回 200', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Hello target',
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      (mockMessageRouter.routeAsync as any).mockResolvedValue(true);
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.messageId).toBeDefined();
    });

    // RFC 013: noReply 默认值测试
    it('未指定 expectReply 或 noReply 时，应默认 noReply=true（安全默认值）', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Hello rfc013',
          // 未指定 expectReply 或 noReply
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      // 捕获 routeAsync 接收的消息
      let capturedMessage: any = null;
      (mockMessageRouter.routeAsync as any).mockImplementation((msg: any) => {
        capturedMessage = msg;
        return Promise.resolve(true);
      });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      // 验证消息 metadata 中 noReply=true
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.metadata.noReply).toBe(true);
    });

    // RFC 013: expectReply=true 设置 noReply=false
    it('expectReply=true 应设置 noReply=false（期待回复）', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Hello expecting reply',
          expectReply: true,
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      let capturedMessage: any = null;
      (mockMessageRouter.routeAsync as any).mockImplementation((msg: any) => {
        capturedMessage = msg;
        return Promise.resolve(true);
      });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      // 验证消息 metadata 中 noReply=false
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.metadata.noReply).toBe(false);
    });

    // RFC 013: expectReply=false 设置 noReply=true
    it('expectReply=false 应设置 noReply=true（明确不期待回复）', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Hello not expecting reply',
          expectReply: false,
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      let capturedMessage: any = null;
      (mockMessageRouter.routeAsync as any).mockImplementation((msg: any) => {
        capturedMessage = msg;
        return Promise.resolve(true);
      });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      // 验证消息 metadata 中 noReply=true
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.metadata.noReply).toBe(true);
    });

    // RFC 013: noReplyReason 字段传递和存储
    it('noReplyReason 字段应正确传递到 metadata', async () => {
      const testReason = '这是一条通知消息，无需回复';
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Notification message',
          noReplyReason: testReason,
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      let capturedMessage: any = null;
      (mockMessageRouter.routeAsync as any).mockImplementation((msg: any) => {
        capturedMessage = msg;
        return Promise.resolve(true);
      });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      // 验证消息 metadata 中包含 noReplyReason
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.metadata.noReplyReason).toBe(testReason);
      // 默认 noReply=true
      expect(capturedMessage.metadata.noReply).toBe(true);
    });

    // RFC 013: Self-send + expectReply 检测（应返回 400 错误）
    it('Self-send + expectReply=true 应返回 400 + code: SELF_SEND_EXPECT_REPLY', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:abc123', // Self-send
          content: 'Self send test',
          expectReply: true, // 期待回复 - 应被拒绝
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'agent:test-peer:abc123', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(400);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Self-send cannot expect reply');
      expect(data.code).toBe('SELF_SEND_EXPECT_REPLY');
    });

    // RFC 013: Self-send 不带 expectReply 可以成功（默认 noReply=true）
    it('Self-send 不带 expectReply 应成功发送（默认 noReply=true）', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:abc123', // Self-send
          content: 'Self loopback test',
          // 未指定 expectReply，默认 noReply=true
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'agent:test-peer:abc123', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      let capturedMessage: any = null;
      (mockMessageRouter.routeAsync as any).mockImplementation((msg: any) => {
        capturedMessage = msg;
        return Promise.resolve(true);
      });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      // 验证消息 metadata 中 noReply=true
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.metadata.noReply).toBe(true);
      
      // 验证 logger 记录了 self-send accepted
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Self-send accepted'),
        expect.any(Object)
      );
    });

    // RFC 013: 向后兼容测试 - 使用旧版 noReply 参数
    it('向后兼容：指定 noReply=false 应生效（旧版参数）', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Legacy noReply test',
          noReply: false, // 旧版参数
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      let capturedMessage: any = null;
      (mockMessageRouter.routeAsync as any).mockImplementation((msg: any) => {
        capturedMessage = msg;
        return Promise.resolve(true);
      });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      // 验证消息 metadata 中 noReply=false
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.metadata.noReply).toBe(false);
    });

    // RFC 013: 向后兼容测试 - expectReply 优先级高于 noReply
    it('expectReply 优先级高于 noReply', async () => {
      const req = createMockReq({
        method: 'POST',
        body: {
          fromAgentId: 'agent:test-peer:abc123',
          toAgentId: 'agent:test-peer:xyz789',
          content: 'Priority test',
          noReply: true, // 旧版参数设为 true
          expectReply: true, // 新版参数设为 true，应优先使用
        },
        headers: { authorization: 'agent-test-token' },
      });
      (mockRegistry.get as any).mockReturnValue({ agentId: 'test', name: 'Test' });
      (mockTokenManager.verifyForAgent as any).mockReturnValue({ valid: true });
      
      let capturedMessage: any = null;
      (mockMessageRouter.routeAsync as any).mockImplementation((msg: any) => {
        capturedMessage = msg;
        return Promise.resolve(true);
      });
      
      const res = createMockRes();

      await handler.handleSendMessage(req as IncomingMessage, res as ServerResponse);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      // expectReply=true 应导致 noReply=false（优先级高于旧版 noReply=true）
      expect(capturedMessage).not.toBeNull();
      expect(capturedMessage.metadata.noReply).toBe(false);
    });
  });

  describe('GET /api/v1/messages/:agentId - 获取消息队列', () => {
    it('Agent 不存在应返回 404 + code: AGENT_NOT_FOUND', () => {
      (mockRegistry.get as any).mockReturnValue(undefined);
      const req = createMockReq({ url: '/api/v1/messages/agent:nonexistent' });
      const res = createMockRes();

      handler.handleGetMessages('agent:nonexistent', req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(404);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent not found');
      expect(data.code).toBe('AGENT_NOT_FOUND');
    });

    it('Agent 存在应返回消息队列', () => {
      (mockRegistry.get as any).mockReturnValue({
        agentId: 'agent:test-peer:abc123',
        name: 'TestAgent',
      });
      (mockRegistry.updateLastActive as any).mockReturnValue(true);
      (mockMessageRouter.getMessages as any).mockReturnValue([
        { messageId: 'msg-1', content: 'Hello' },
        { messageId: 'msg-2', content: 'World' },
      ]);
      const req = createMockReq({ url: '/api/v1/messages/agent:test-peer:abc123' });
      const res = createMockRes();

      handler.handleGetMessages('agent:test-peer:abc123', req as IncomingMessage, res as ServerResponse);

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.agentId).toBe('agent:test-peer:abc123');
      expect(data.messages).toHaveLength(2);
      expect(data.count).toBe(2);
    });
  });

  describe('DELETE /api/v1/messages/:agentId - 清除消息', () => {
    it('Agent 不存在应返回 404 + code: AGENT_NOT_FOUND', async () => {
      (mockRegistry.get as any).mockReturnValue(undefined);
      const req = createMockReq({
        method: 'DELETE',
        url: '/api/v1/messages/agent:nonexistent',
      });
      const res = createMockRes();

      handler.handleClearMessages('agent:nonexistent', req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(404);
      const data = getResponseData(res);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Agent not found');
      expect(data.code).toBe('AGENT_NOT_FOUND');
    });

    it('Agent 存在应成功清除消息', async () => {
      (mockRegistry.get as any).mockReturnValue({
        agentId: 'agent:test-peer:abc123',
        name: 'TestAgent',
      });
      (mockMessageRouter.clearMessages as any).mockReturnValue(3);
      const req = createMockReq({
        method: 'DELETE',
        url: '/api/v1/messages/agent:test-peer:abc123',
      });
      const res = createMockRes();

      handler.handleClearMessages('agent:test-peer:abc123', req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.cleared).toBe(3);
    });

    it('指定消息 ID 清除应成功', async () => {
      (mockRegistry.get as any).mockReturnValue({
        agentId: 'agent:test-peer:abc123',
        name: 'TestAgent',
      });
      (mockMessageRouter.clearMessages as any).mockReturnValue(2);
      const req = createMockReq({
        method: 'DELETE',
        url: '/api/v1/messages/agent:test-peer:abc123',
        body: { messageIds: ['msg-1', 'msg-2'] },
      });
      const res = createMockRes();

      handler.handleClearMessages('agent:test-peer:abc123', req as IncomingMessage, res as ServerResponse);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const data = getResponseData(res);
      expect(data.success).toBe(true);
      expect(data.cleared).toBe(2);
    });
  });
});