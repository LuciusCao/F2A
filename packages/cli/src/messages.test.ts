import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process.exit to prevent tests from exiting
process.exit = vi.fn() as any;

// Set environment variables before importing modules
process.env.F2A_CONTROL_TOKEN = '***';
process.env.F2A_CONTROL_PORT = '9001';

import { sendMessage, getMessages, clearMessages } from './messages.js';
import { request, RequestOptions } from 'http';
import { isJsonMode, outputJson, outputError } from './output.js';

// Mock http module
vi.mock('http', () => ({
  request: vi.fn(),
}));

// Mock output module
vi.mock('./output.js', () => ({
  isJsonMode: vi.fn(() => false),
  outputJson: vi.fn(),
  outputError: vi.fn(),
}));

// Mock control-token module
vi.mock('./control-token.js', () => ({
  getControlTokenLazy: () => 'test-token',
}));

// Mock fs module for agent token reading
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: () => '/home/test',
}));

// Mock init.js module
vi.mock('./init.js', () => ({
  readCallerConfig: vi.fn(() => null),
  readIdentityFile: vi.fn(() => null),
  readIdentityByAgentId: vi.fn((agentId: string) => ({
    agentId,
    name: 'Test Agent',
    publicKey: 'test-public-key',
    privateKey: 'test-private-key',
    capabilities: [{ name: 'chat', version: '1.0.0' }],
    webhook: { url: 'http://test' },
    createdAt: '2026-04-21T00:00:00Z',
  })),
  AGENTS_DIR: '/tmp/f2a-test/agents',
  AGENT_IDENTITIES_DIR: '/tmp/f2a-test/agent-identities',
}));

// Mock @f2a/network signChallenge
vi.mock('@f2a/network', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    signChallenge: vi.fn(() => ({
      nonce: 'test-nonce',
      nonceSignature: 'test-signature',
    })),
  };
});

import { existsSync, readFileSync } from 'fs';

describe('CLI Messages Commands', () => {
  const mockRequest = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    setTimeout: vi.fn(),
    destroy: vi.fn(),
  };

  const mockResponse = {
    statusCode: 200,
    on: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (process.exit as any).mockClear();
    process.env.F2A_CONTROL_PORT = '9001';
    process.env.F2A_CONTROL_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendMessage', () => {
    describe('Parameter validation', () => {
      it('should fail when agentId is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await sendMessage({ agentId: '', content: 'hello' });

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--agent-id'));
        
        consoleErrorSpy.mockRestore();
      });

      it('should fail when content is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await sendMessage({ agentId: 'agent:test:123', content: '' });

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('message content'));
        
        consoleErrorSpy.mockRestore();
      });
    });

    describe('Send flow', () => {
      it('should send direct message successfully', async () => {
        const responseData = { success: true, messageId: 'msg:123' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await sendMessage({
          agentId: 'agent:test:123',
          toAgentId: 'agent:receiver:456',
          content: 'hello',
        });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
        
        consoleSpy.mockRestore();
      });

      it('should send broadcast message when toAgentId is omitted', async () => {
        const responseData = { success: true, messageId: 'msg:123' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await sendMessage({
          agentId: 'agent:test:123',
          content: 'broadcast',
        });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('(broadcast)'));
        
        consoleSpy.mockRestore();
      });

      it('should handle send failure', async () => {
        const responseData = { success: false, error: 'Agent not registered' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await sendMessage({
          agentId: 'agent:test:123',
          content: 'hello',
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to send'));
        
        consoleErrorSpy.mockRestore();
      });
    });

    // RFC 013: Safe by default 测试
    describe('RFC 013: noReply and expectReply', () => {
      // 测试默认 noReply=true（安全默认值）
      it('默认情况下应设置 noReply=true（不期待回复）', async () => {
        const responseData = { success: true, messageId: 'msg:rfc013-1' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        let capturedBody: string | null = null;
        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          // 捕获请求 body
          mockRequest.write.mockImplementation((data: string) => {
            capturedBody = data;
          });
          callback(mockResponse);
          return mockRequest;
        });

        await sendMessage({
          agentId: 'agent:test:123',
          toAgentId: 'agent:receiver:456',
          content: 'hello rfc013',
        });

        // 验证发送的 payload 中 noReply=true
        expect(capturedBody).not.toBeNull();
        const payload = JSON.parse(capturedBody!);
        expect(payload.noReply).toBe(true);
      });

      // 测试 --expect-reply 设置 noReply=false
      it('expectReply=true 应设置 noReply=false（期待回复）', async () => {
        const responseData = { success: true, messageId: 'msg:rfc013-2' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        let capturedBody: string | null = null;
        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          mockRequest.write.mockImplementation((data: string) => {
            capturedBody = data;
          });
          callback(mockResponse);
          return mockRequest;
        });

        await sendMessage({
          agentId: 'agent:test:123',
          toAgentId: 'agent:receiver:456',
          content: 'expect reply test',
          expectReply: true,
        });

        // 验证发送的 payload 中 noReply=false
        expect(capturedBody).not.toBeNull();
        const payload = JSON.parse(capturedBody!);
        expect(payload.noReply).toBe(false);
      });

      // 测试 --reason 参数传递到 payload
      it('reason 参数应传递到 noReplyReason 字段', async () => {
        const responseData = { success: true, messageId: 'msg:rfc013-3' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        let capturedBody: string | null = null;
        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          mockRequest.write.mockImplementation((data: string) => {
            capturedBody = data;
          });
          callback(mockResponse);
          return mockRequest;
        });

        const testReason = 'This is a notification, no reply needed';
        await sendMessage({
          agentId: 'agent:test:123',
          toAgentId: 'agent:receiver:456',
          content: 'notification',
          reason: testReason,
        });

        // 验证发送的 payload 中包含 noReplyReason
        expect(capturedBody).not.toBeNull();
        const payload = JSON.parse(capturedBody!);
        expect(payload.noReplyReason).toBe(testReason);
        // 默认情况下 noReply=true
        expect(payload.noReply).toBe(true);
      });

      // 测试 Self-send + --expect-reply 报错
      it('Self-send + expectReply 应报错（防止无限循环）', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await sendMessage({
          agentId: 'agent:self:123',
          toAgentId: 'agent:self:123', // Self-send
          content: 'self send test',
          expectReply: true, // 期待回复 - 应报错
        });

        // 验证报错信息
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Self-send cannot expect reply'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });

      // 测试 Self-send 不带 expectReply 可以成功发送（noReply=true）
      it('Self-send 不带 expectReply 应成功发送（默认 noReply=true）', async () => {
        const responseData = { success: true, messageId: 'msg:rfc013-self' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        let capturedBody: string | null = null;
        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          mockRequest.write.mockImplementation((data: string) => {
            capturedBody = data;
          });
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await sendMessage({
          agentId: 'agent:self:123',
          toAgentId: 'agent:self:123', // Self-send
          content: 'self loopback test',
          // 没有 expectReply，默认 noReply=true
        });

        // 验证成功发送
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
        // 验证 payload 中 noReply=true
        expect(capturedBody).not.toBeNull();
        const payload = JSON.parse(capturedBody!);
        expect(payload.noReply).toBe(true);

        consoleSpy.mockRestore();
      });

      // JSON 模式下测试 Self-send + expectReply 报错
      it('JSON 模式下 Self-send + expectReply 应返回错误 JSON', async () => {
        (isJsonMode as any).mockReturnValue(true);

        await sendMessage({
          agentId: 'agent:self:123',
          toAgentId: 'agent:self:123',
          content: 'self send json test',
          expectReply: true,
        });

        expect(outputError).toHaveBeenCalledWith(
          expect.stringContaining('Self-send cannot expect reply'),
          'SELF_SEND_EXPECT_REPLY_FORBIDDEN'
        );

        (isJsonMode as any).mockReturnValue(false);
      });
    });
  });

  describe('getMessages', () => {
    describe('Normal flow', () => {
      it('should display messages when messages exist', async () => {
        const responseData = {
          success: true,
          messages: [
            {
              messageId: 'msg:1',
              fromAgentId: 'agent:sender:123',
              toAgentId: 'agent:test:456',
              content: 'Hello',
              type: 'message',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
        };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await getMessages({ agentId: 'agent:test:456' });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Hello'));
        
        consoleSpy.mockRestore();
      });

      it('should display empty when no messages', async () => {
        const responseData = { success: true, messages: [] };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await getMessages({ agentId: 'agent:test:456' });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No messages'));
        
        consoleSpy.mockRestore();
      });
    });

    describe('JSON output mode', () => {
      it('should output messages as JSON when jsonMode is enabled', async () => {
        const responseData = {
          success: true,
          messages: [
            {
              messageId: 'msg:1',
              fromAgentId: 'agent:sender:123',
              toAgentId: 'agent:test:456',
              content: 'Hello',
              type: 'message',
              createdAt: '2024-01-01T00:00:00Z',
              read: false,
            },
            {
              messageId: 'msg:2',
              fromAgentId: 'agent:sender:789',
              toAgentId: 'agent:test:456',
              content: 'World',
              type: 'task_request',
              createdAt: '2024-01-02T00:00:00Z',
              read: true,
            },
          ],
        };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        (isJsonMode as any).mockReturnValue(true);
        
        await getMessages({ agentId: 'agent:test:456' });

        expect(outputJson).toHaveBeenCalledWith({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: 'Hello' }),
            expect.objectContaining({ content: 'World' }),
          ]),
          total: 2,
          unread: 1,
        });

        (isJsonMode as any).mockReturnValue(false);
      });

      it('should output error JSON when agentId is missing in jsonMode', async () => {
        (isJsonMode as any).mockReturnValue(true);
        
        await getMessages({ agentId: '' });

        expect(outputError).toHaveBeenCalledWith('Missing required --agent-id parameter', 'MISSING_AGENT_ID');
        
        (isJsonMode as any).mockReturnValue(false);
      });

      it('should output error JSON when API request fails', async () => {
        const responseData = { success: false, error: 'Agent not found' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        (isJsonMode as any).mockReturnValue(true);
        
        await getMessages({ agentId: 'agent:test:456' });

        expect(outputError).toHaveBeenCalledWith('Agent not found', 'MESSAGES_FAILED');
        
        (isJsonMode as any).mockReturnValue(false);
      });

      it('should output error JSON when daemon is not running', async () => {
        const responseData = { 
          success: false, 
          error: 'Connection failed: ECONNREFUSED. Please ensure daemon is running.' 
        };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        (isJsonMode as any).mockReturnValue(true);
        
        await getMessages({ agentId: 'agent:test:456' });

        expect(outputError).toHaveBeenCalledWith(
          expect.stringContaining('ECONNREFUSED'),
          'MESSAGES_FAILED'
        );
        
        (isJsonMode as any).mockReturnValue(false);
      });

      it('should filter unread messages in JSON mode', async () => {
        const responseData = {
          success: true,
          messages: [
            {
              messageId: 'msg:1',
              content: 'Unread',
              read: false,
            },
            {
              messageId: 'msg:2',
              content: 'Read',
              read: true,
            },
          ],
        };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        (isJsonMode as any).mockReturnValue(true);
        
        await getMessages({ agentId: 'agent:test:456', unread: true });

        expect(outputJson).toHaveBeenCalledWith({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: 'Unread' }),
          ]),
          total: 1,
          unread: 1,
        });

        (isJsonMode as any).mockReturnValue(false);
      });

      it('should output empty messages array as JSON', async () => {
        const responseData = { success: true, messages: [] };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        (isJsonMode as any).mockReturnValue(true);
        
        await getMessages({ agentId: 'agent:test:456' });

        expect(outputJson).toHaveBeenCalledWith({
          messages: [],
          total: 0,
          unread: 0,
        });

        (isJsonMode as any).mockReturnValue(false);
      });
    });
  });

  describe('clearMessages', () => {
    describe('Normal flow', () => {
      it('should clear messages successfully', async () => {
        const responseData = { success: true, cleared: 5 };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await clearMessages({ agentId: 'agent:test:456' });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
        
        consoleSpy.mockRestore();
      });
    });

    describe('Parameter validation', () => {
      it('should fail when agentId is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await clearMessages({ agentId: '' });

        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });
    });
  });
});