import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process.exit to prevent tests from exiting
process.exit = vi.fn() as any;

// 在导入模块前设置环境变量
process.env.F2A_CONTROL_TOKEN='***';
process.env.F2A_CONTROL_PORT = '9001';

import { registerAgent, unregisterAgent, updateAgent, listAgents } from './agents.js';
import { request, RequestOptions } from 'http';
import { setJsonMode } from './output.js';

// Mock http module
vi.mock('http', () => ({
  request: vi.fn(),
}));

// Mock control-token module
vi.mock('./control-token.js', () => ({
  getControlTokenLazy: () => 'test-token',
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

describe('CLI Agent Commands', () => {
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

  describe('registerAgent', () => {
    describe('参数验证', () => {
      it('should fail when agentId is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await registerAgent({ agentId: '' });

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--agent-id'));
        
        consoleErrorSpy.mockRestore();
      });
    });

    describe('注册流程', () => {
      it('should register agent with valid agentId', async () => {
        const responseData = { 
          success: true, 
          agent: { agentId: 'agent:test:123' }, 
          nodeSignature: 'node-sig',
          nodeId: '12D3KooWnode...',
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
        
        await registerAgent({ agentId: 'agent:test:123' });

        expect(mockRequest.write).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
        
        consoleSpy.mockRestore();
      });

      it('should handle registration failure', async () => {
        const responseData = { success: false, error: 'Registration failed' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await registerAgent({ agentId: 'agent:test:123' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Registration failed'));
        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });
    });
  });

  describe('updateAgent', () => {
    describe('参数验证', () => {
      it('should fail when agentId is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await updateAgent({ agentId: '' });

        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });

      it('should warn when nothing to update', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await updateAgent({ agentId: 'agent:test:123' });

        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing to update'));
        
        consoleWarnSpy.mockRestore();
      });
    });
  });

  describe('unregisterAgent', () => {
    describe('参数验证', () => {
      it('should fail when agentId is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await unregisterAgent('');

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--agent-id'));
        
        consoleErrorSpy.mockRestore();
      });

      it('should fail when agentId starts with --', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await unregisterAgent('--invalid');

        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });
    });

    // Note: Challenge-Response flow is tested in daemon agent-handler.test.ts
    // CLI test focuses on parameter validation only
  });

  describe('listAgents', () => {
    describe('正常模式', () => {
      it('should list agents in human-readable format', async () => {
        const responseData = {
          success: true,
          agents: [
            {
              agentId: 'agent:test:123',
              name: 'Test Agent',
              capabilities: [{ name: 'chat' }],
              webhookUrl: 'http://test-webhook',
              lastActiveAt: '2026-04-22T10:00:00Z'
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
        
        await listAgents();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('🤖 Registered Agents'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Agent'));
        
        consoleSpy.mockRestore();
      });

      it('should show message when no agents found', async () => {
        const responseData = { success: true, agents: [] };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await listAgents();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No registered agents found'));
        
        consoleSpy.mockRestore();
      });

      it('should handle list failure', async () => {
        const responseData = { success: false, error: 'Daemon error' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await listAgents();

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get agent list'));
        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });
    });

    describe('JSON 模式', () => {
      beforeEach(() => {
        setJsonMode(true);
      });

      afterEach(() => {
        setJsonMode(false);
      });

      it('should output agents in JSON format', async () => {
        const responseData = {
          success: true,
          agents: [
            {
              agentId: 'agent:test:123',
              name: 'Test Agent',
              capabilities: [{ name: 'chat' }],
              webhookUrl: 'http://test-webhook',
              lastActiveAt: '2026-04-22T10:00:00Z'
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
        
        await listAgents();

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(output.success).toBe(true);
        expect(output.data.agents).toHaveLength(1);
        expect(output.data.agents[0]).toEqual({
          agentId: 'agent:test:123',
          name: 'Test Agent',
          capabilities: [{ name: 'chat' }],
          webhookUrl: 'http://test-webhook',
          lastActiveAt: '2026-04-22T10:00:00Z'
        });
        
        consoleSpy.mockRestore();
      });

      it('should output empty agents array in JSON format', async () => {
        const responseData = { success: true, agents: [] };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await listAgents();

        const output = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(output.success).toBe(true);
        expect(output.data.agents).toHaveLength(0);
        
        consoleSpy.mockRestore();
      });

      it('should output error in JSON format when list fails', async () => {
        const responseData = { success: false, error: 'Daemon error' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await listAgents();

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(output.success).toBe(false);
        expect(output.error).toBe('Daemon error');
        expect(output.code).toBe('LIST_FAILED');
        
        consoleErrorSpy.mockRestore();
      });

      it('should output error in JSON format on connection failure', async () => {
        (request as any).mockImplementation(() => {
          const req = {
            on: vi.fn((event: string, callback: Function) => {
              if (event === 'error') {
                callback(new Error('Connection refused'));
              }
            }),
            write: vi.fn(),
            end: vi.fn(),
            setTimeout: vi.fn(),
            destroy: vi.fn(),
          };
          return req;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await listAgents();

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const output = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(output.success).toBe(false);
        expect(output.error).toContain('Connection refused');
        // Connection errors are returned as LIST_FAILED by the http-client
        expect(output.code).toBe('LIST_FAILED');
        
        consoleErrorSpy.mockRestore();
      });
    });
  });
});