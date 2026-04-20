import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process.exit to prevent tests from exiting
process.exit = vi.fn() as any;

// 在导入模块前设置环境变量
process.env.F2A_CONTROL_TOKEN = '***';
process.env.F2A_CONTROL_PORT = '9001';

import { sendMessage, getMessages, clearMessages } from './messages.js';
import { request, RequestOptions } from 'http';

// Mock http module
vi.mock('http', () => ({
  request: vi.fn(),
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
  AGENTS_DIR: '/tmp/f2a-test/agents',
}));

import { existsSync, readFileSync } from 'fs';

/**
 * messages.ts 测试 - 消息 API 调用测试
 * 
 * 测试质量标准：
 * - 正常路径：至少 3 个具体值验证
 * - 错误路径：至少 2 个错误场景
 * - 边界情况：至少 1 个边界测试
 */
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
    process.env.F2A_CONTROL_TOKEN = '***';
    
    // Default mock for existsSync and readFileSync
    (existsSync as any).mockReturnValue(true);
    (readFileSync as any).mockReturnValue(JSON.stringify({ token: 'agent-test-token' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendMessage', () => {
    describe('正常路径', () => {
      it('should send POST /api/v1/messages with correct body', async () => {
        const responseData = { success: true, messageId: 'msg-123', broadcasted: 5 };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          // 验证请求参数
          expect(options.method).toBe('POST');
          expect(options.path).toBe('/api/v1/messages');
          expect(options.hostname).toBe('127.0.0.1');
          expect(options.port).toBe(9001);
          
          // 验证 Authorization header
          expect(options.headers).toHaveProperty('Authorization', 'agent-agent-test-token');
          
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await sendMessage({
          fromAgentId: 'agent-sender',
          toAgentId: 'agent-receiver',
          content: 'Hello, World!'
        });

        // 验证请求体格式
        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        expect(writeCall).toBeDefined();
        const body = JSON.parse(writeCall);
        
        // 正常路径验证 1: fromAgentId 正确
        expect(body.fromAgentId).toBe('agent-sender');
        // 正常路径验证 2: toAgentId 正确
        expect(body.toAgentId).toBe('agent-receiver');
        // 正常路径验证 3: content 正确
        expect(body.content).toBe('Hello, World!');
        // 正常路径验证 4: 默认 type
        expect(body.type).toBe('message');

        // 验证输出
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已发送'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('agent-sender...'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('agent-receiver...'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('msg-123'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('5 agents'));

        consoleSpy.mockRestore();
      });

      it('should send broadcast message when toAgentId is omitted', async () => {
        const responseData = { success: true, messageId: 'msg-456', broadcasted: 10 };

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
          fromAgentId: 'agent-broadcaster',
          content: 'Announcement message'
        });

        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        const body = JSON.parse(writeCall);

        // 正常路径验证：广播消息
        expect(body.toAgentId).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('broadcast'));

        consoleSpy.mockRestore();
      });

      it('should send message with custom type', async () => {
        const responseData = { success: true, messageId: 'msg-789' };

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
          fromAgentId: 'agent-sender',
          content: 'Task request',
          type: 'task_request',
          metadata: { taskId: 'task-001' }
        });

        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        const body = JSON.parse(writeCall);

        // 正常路径验证：自定义 type 和 metadata
        expect(body.type).toBe('task_request');
        expect(body.metadata).toEqual({ taskId: 'task-001' });

        consoleSpy.mockRestore();
      });
    });

    describe('错误路径', () => {
      it('should fail when fromAgentId is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await sendMessage({
          fromAgentId: '',
          content: 'Hello'
        });

        // 错误路径验证 1: 显示缺少 --from 参数错误
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--from'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });

      it('should fail when content is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await sendMessage({
          fromAgentId: 'agent-test',
          content: ''
        });

        // 错误路径验证 2: 显示缺少消息内容错误
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('消息内容'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });

      it('should fail when agent token file does not exist', async () => {
        (existsSync as any).mockReturnValue(false);
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await sendMessage({
          fromAgentId: 'nonexistent-agent',
          content: 'Hello'
        });

        // 错误路径验证 3: agent token 不存在
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('token'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });

      it('should handle daemon failure response', async () => {
        const responseData = { 
          success: false, 
          error: 'Agent not registered',
          code: 'AGENT_NOT_REGISTERED'
        };

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
          fromAgentId: 'agent-unregistered',
          content: 'Hello'
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('发送失败'));
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('请确保发送方和接收方 Agent 已注册'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });

      it('should handle connection error', async () => {
        (request as any).mockImplementation(() => {
          const req = {
            on: (event: string, callback: Function) => {
              if (event === 'error') callback(new Error('Connection refused'));
            },
            write: vi.fn(),
            end: vi.fn(),
          };
          return req;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await sendMessage({
          fromAgentId: 'agent-test',
          content: 'Hello'
        });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('无法连接'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });
    });

    describe('边界情况', () => {
      it('should handle very long agentId (truncation in output)', async () => {
        const longAgentId = 'agent-' + 'a'.repeat(100);
        const responseData = { success: true };

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
          fromAgentId: longAgentId,
          content: 'Test'
        });

        // 边界验证：长 agentId 被截断显示（实际格式是 "agent-aaaaaaaaaa..."）
        const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
        expect(allOutput).toContain('agent-aaaaaaaaaa');

        consoleSpy.mockRestore();
      });

      it('should handle message with special characters', async () => {
        const specialMessage = 'Hello! 你好 🎉 "quotes" and \'apostrophes\'';
        const responseData = { success: true };

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
          fromAgentId: 'agent-test',
          content: specialMessage
        });

        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        const body = JSON.parse(writeCall);
        
        // 边界验证：特殊字符正确传递
        expect(body.content).toBe(specialMessage);

        consoleSpy.mockRestore();
      });

      it('should handle corrupted agent identity file', async () => {
        (readFileSync as any).mockImplementation(() => {
          throw new Error('File corrupted');
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await sendMessage({
          fromAgentId: 'agent-corrupted',
          content: 'Hello'
        });

        // 边界验证：读取失败时显示错误
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('token'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });
    });
  });

  describe('getMessages', () => {
    describe('正常路径', () => {
      it('should fetch messages with GET /api/v1/messages/:agentId', async () => {
        const responseData = {
          success: true,
          messages: [
            {
              fromAgentId: 'agent-sender-12345678901234567890',
              toAgentId: 'agent-receiver',
              content: 'Hello from agent',
              type: 'message',
              createdAt: Date.now()
            }
          ]
        };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          // 验证请求参数
          expect(options.method).toBe('GET');
          expect(options.path).toContain('/api/v1/messages/');
          expect(options.hostname).toBe('127.0.0.1');
          
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await getMessages({ agentId: 'agent-test' });

        // 正常路径验证 1: 正确的 API 路径
        const requestCall = (request as any).mock.calls[0][0];
        expect(requestCall.path).toContain('/api/v1/messages/agent-test');

        // 正常路径验证 2: 显示消息数量
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('消息'));

        // 正常路径验证 3: 显示消息内容
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Hello from agent'));

        consoleSpy.mockRestore();
      });

      it('should apply limit parameter correctly', async () => {
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

        await getMessages({ agentId: 'agent-test', limit: 10 });

        // 验证查询参数
        const requestCall = (request as any).mock.calls[0][0];
        expect(requestCall.path).toContain('limit=10');

        consoleSpy.mockRestore();
      });

      it('should filter unread messages when unread option is true', async () => {
        const responseData = {
          success: true,
          messages: [
            { fromAgentId: 'peer-a', content: 'Read message', read: true },
            { fromAgentId: 'peer-b', content: 'Unread message', read: false },
            { fromAgentId: 'peer-c', content: 'Another unread', read: false }
          ]
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

        await getMessages({ agentId: 'agent-test', unread: true });

        // 只显示未读消息
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unread message'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Another unread'));
        // 已读消息不应显示
        const allOutput = consoleSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).not.toContain('Read message');

        consoleSpy.mockRestore();
      });

      it('should filter messages by sender when from option is provided', async () => {
        const responseData = {
          success: true,
          messages: [
            { from: 'alice', content: 'From Alice' },
            { from: 'bob', content: 'From Bob' },
            { from: 'alice-2', content: 'From Alice 2' }
          ]
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

        await getMessages({ agentId: 'agent-test', from: 'alice' });

        // 验证 from 包含 'alice' 的消息（代码使用 m.from?.includes 匹配）
        const allOutput = consoleSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('From Alice');
        expect(allOutput).not.toContain('From Bob');

        consoleSpy.mockRestore();
      });

      it('should require agentId when not specified', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await getMessages({});

        // 修复后：不传 agentId 时报错
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('缺少 --agent'));
        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });

      it('should display message metadata correctly (type, from, to)', async () => {
        const timestamp = 1704067200000; // 2024-01-01 00:00:00 UTC
        const responseData = {
          success: true,
          messages: [
            {
              fromAgentId: 'agent-sender-with-long-id',
              toAgentId: 'agent-receiver-with-long-id',
              content: 'Test message',
              type: 'task_request',
              createdAt: timestamp
            }
          ]
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

        await getMessages({ agentId: 'agent-test' });

        const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
        
        // 验证：type 显示
        expect(allOutput).toContain('task_request');
        // 验证：sender 截断显示（实际截断到16个字符）
        expect(allOutput).toContain('agent-sender-wit...');
        // 验证：箭头格式 →
        expect(allOutput).toContain('→');
        // 验证：receiver 截断显示（实际截断到16个字符）
        expect(allOutput).toContain('agent-receiver-w...');

        consoleSpy.mockRestore();
      });
    });

    describe('错误路径', () => {
      it('should handle daemon error response', async () => {
        const responseData = { success: false, error: 'Agent not found' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await getMessages({ agentId: 'nonexistent' });

        // 应显示没有消息
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('没有消息'));

        consoleSpy.mockRestore();
      });

      it('should handle connection error', async () => {
        (request as any).mockImplementation(() => {
          const req = {
            on: (event: string, callback: Function) => {
              if (event === 'error') callback(new Error('Connection refused'));
            },
            write: vi.fn(),
            end: vi.fn(),
          };
          return req;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await getMessages({ agentId: 'agent-test' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('无法连接'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });
    });

    describe('边界情况', () => {
      it('should handle empty messages array', async () => {
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

        await getMessages({ agentId: 'agent-test' });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('没有消息'));

        consoleSpy.mockRestore();
      });

      it('should handle messages without optional fields', async () => {
        const responseData = {
          success: true,
          messages: [
            { content: 'Message without metadata' }
          ]
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

        await getMessages({ agentId: 'agent-test' });

        // 应该处理缺失的字段
        const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
        expect(allOutput).toContain('Message without metadata');
        // 缺失 fromAgentId 显示为 unknown
        expect(allOutput).toContain('unknown');
        // 缺失 toAgentId 显示为 broadcast
        expect(allOutput).toContain('broadcast');

        consoleSpy.mockRestore();
      });

      it('should limit displayed messages', async () => {
        // 创建超过 limit 的消息
        const messages = Array.from({ length: 100 }, (_, i) => ({
          fromAgentId: `agent-${i}`,
          content: `Message ${i}`,
          type: 'message'
        }));

        const responseData = { success: true, messages };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await getMessages({ agentId: 'agent-test', limit: 10 });

        // 验证只显示限制数量的消息
        const messageCalls = consoleSpy.mock.calls.filter(c => 
          c[0] && typeof c[0] === 'string' && c[0].includes('Message')
        );
        expect(messageCalls.length).toBeLessThanOrEqual(10);

        consoleSpy.mockRestore();
      });

      it('should handle invalid JSON response', async () => {
        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from('invalid json'));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        // 应该不抛出异常
        await getMessages({ agentId: 'agent-test' });

        consoleSpy.mockRestore();
      });
    });
  });

  describe('clearMessages', () => {
    describe('正常路径', () => {
      it('should delete all messages for agent', async () => {
        const responseData = { success: true, cleared: 10 };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          expect(options.method).toBe('DELETE');
          expect(options.path).toContain('/api/v1/messages/agent-test');
          
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await clearMessages({ agentId: 'agent-test' });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已清除'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('10'));

        consoleSpy.mockRestore();
      });

      it('should delete specific messages by IDs', async () => {
        const responseData = { success: true, cleared: 2 };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await clearMessages({ agentId: 'agent-test', messageIds: ['msg-1', 'msg-2'] });

        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        const body = JSON.parse(writeCall);
        expect(body.messageIds).toEqual(['msg-1', 'msg-2']);

        consoleSpy.mockRestore();
      });
    });

    describe('错误路径', () => {
      it('should handle daemon failure', async () => {
        const responseData = { success: false, error: 'Agent not found' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await clearMessages({ agentId: 'nonexistent' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('清除失败'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });

      it('should handle connection error', async () => {
        (request as any).mockImplementation(() => {
          const req = {
            on: (event: string, callback: Function) => {
              if (event === 'error') callback(new Error('Connection refused'));
            },
            write: vi.fn(),
            end: vi.fn(),
          };
          return req;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await clearMessages({ agentId: 'agent-test' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('无法连接'));
        expect(process.exit).toHaveBeenCalledWith(1);

        consoleErrorSpy.mockRestore();
      });
    });

    describe('边界情况', () => {
      it('should use default agentId', async () => {
        const responseData = { success: true, cleared: 0 };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await clearMessages({ agentId: '' });

        // 默认使用 'default' agentId
        const requestCall = (request as any).mock.calls[0][0];
        expect(requestCall.path).toContain('/api/v1/messages/default');

        consoleSpy.mockRestore();
      });
    });
  });
});