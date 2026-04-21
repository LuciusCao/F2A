import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process.exit to prevent tests from exiting
process.exit = vi.fn() as any;

// 在导入模块前设置环境变量
process.env.F2A_CONTROL_TOKEN = 'test-token';
process.env.F2A_CONTROL_PORT = '9001';

import { registerAgent, unregisterAgent, updateAgent } from './agents.js';
import { request, RequestOptions } from 'http';

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
          nodePeerId: '12D3KooWnode...',
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

        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('没有要更新'));
        
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
});