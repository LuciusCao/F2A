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
    describe('参数验证', () => {
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
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('消息内容'));
        
        consoleErrorSpy.mockRestore();
      });
    });

    describe('发送流程', () => {
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

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('发送失败'));
        
        consoleErrorSpy.mockRestore();
      });
    });
  });

  describe('getMessages', () => {
    describe('正常路径', () => {
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

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('没有消息'));
        
        consoleSpy.mockRestore();
      });
    });
  });

  describe('clearMessages', () => {
    describe('正常路径', () => {
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

    describe('参数验证', () => {
      it('should fail when agentId is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await clearMessages({ agentId: '' });

        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });
    });
  });
});