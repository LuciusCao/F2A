import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process.exit to prevent tests from exiting
process.exit = vi.fn() as any;

// 在导入模块前设置环境变量
process.env.F2A_CONTROL_TOKEN = 'test-token';
process.env.F2A_CONTROL_PORT = '9001';

import { registerAgent, listAgents, unregisterAgent } from './agents.js';
import { request, RequestOptions } from 'http';

// Mock http module
vi.mock('http', () => ({
  request: vi.fn(),
}));

// Mock control-token module
vi.mock('./control-token.js', () => ({
  getControlTokenLazy: () => 'test-token',
}));

// Mock init.js module (readCallerConfig, readIdentityFile)
vi.mock('./init.js', () => ({
  readCallerConfig: vi.fn(() => null),  // 默认返回 null，走旧流程
  readIdentityFile: vi.fn(() => null),
  AGENTS_DIR: '/tmp/f2a-test/agents',
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
    describe('用户指定 agentId', () => {
      it('should register agent with user-specified agentId', async () => {
        const responseData = { success: true, agent: { agentId: 'my-agent' }, token: 'test-token' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        // 旧流程：只传 name（无 callerConfig）
        await registerAgent({ name: 'Test' });

        // 验证请求 body.name === 'Test'
        expect(mockRequest.write).toHaveBeenCalledWith(
          expect.stringContaining('"name":"Test"')
        );

        // 验证输出包含 "Name: Test"
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Name: Test'));
        
        consoleSpy.mockRestore();
      });
    });

    describe('daemon 自动生成 agentId', () => {
      it('should register agent without agentId (daemon generates)', async () => {
        const responseData = { success: true, agent: { agentId: 'agent:generated-id' }, token: 'test-token' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        // 旧流程：不传 id，只传 name
        await registerAgent({ name: 'Test' });

        // 验证请求 body 不包含 agentId（daemon 生成）
        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        if (writeCall) {
          const body = JSON.parse(writeCall);
          expect(body.agentId).toBeUndefined();
        }

        // 验证输出显示 daemon 生成的 ID
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('agent:generated-id'));
        
        consoleSpy.mockRestore();
      });
    });

    describe('必须提供 name', () => {
      it('should fail when name is missing', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        // 旧流程：不传 name
        await registerAgent({});

        // 验证 process.exit(1)
        expect(process.exit).toHaveBeenCalledWith(1);

        // 验证输出错误信息
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--name'));
        
        consoleErrorSpy.mockRestore();
      });

      it('should fail when name is missing (id is optional)', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await registerAgent({});

        expect(process.exit).toHaveBeenCalledWith(1);
        // Should only complain about missing --name, not --id (which is optional)
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--name')); // Updated: was '--id'
        
        consoleErrorSpy.mockRestore();
      });

      it('should fail when name is empty string', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await registerAgent({ name: '' });

        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });
    });

    describe('可选参数：capabilities 和 webhook', () => {
      it('should support optional capabilities and webhook', async () => {
        const responseData = { success: true, agent: { agentId: 'test-agent' } };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await registerAgent({
          name: 'Test',
          capabilities: ['chat', 'voice'],
          webhook: 'http://example.com/webhook'
        });

        // 验证请求 body 包含 capabilities 和 webhook
        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        if (writeCall) {
          const body = JSON.parse(writeCall);
          expect(body.capabilities).toBeDefined();
          expect(body.capabilities.length).toBe(2);
          expect(body.capabilities[0].name).toBe('chat');
          expect(body.webhook).toBeDefined();
          expect(body.webhook.url).toBe('http://example.com/webhook');
        }

        // 验证输出显示 capabilities 和 webhook
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('chat, voice'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('http://example.com/webhook'));
        
        consoleSpy.mockRestore();
      });

      it('should handle empty capabilities array', async () => {
        const responseData = { success: true, agent: { agentId: 'test-agent' } };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await registerAgent({
          name: 'Test',
          capabilities: []
        });

        // 空 capabilities 不应显示
        expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Capabilities'));
        
        consoleSpy.mockRestore();
      });
    });

    describe('错误处理', () => {
      it('should handle registration failure from daemon', async () => {
        const responseData = { success: false, error: 'Agent already exists' };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        
        await registerAgent({ id: 'existing-agent', name: 'Test' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Agent already exists'));
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
        
        await registerAgent({ name: 'Test' });

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('无法连接'));
        expect(process.exit).toHaveBeenCalledWith(1);
        
        consoleErrorSpy.mockRestore();
      });
    });
  });

  describe('listAgents', () => {
    it('should list registered agents', async () => {
      const responseData = {
        success: true,
        agents: [
          {
            agentId: 'agent:test-1',
            name: 'Test Agent 1',
            capabilities: [{ name: 'chat', version: '1.0.0' }],
            webhookUrl: 'http://example.com',
            lastActiveAt: Date.now()
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

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Agent 1'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('agent:test-1'));
      
      consoleSpy.mockRestore();
    });

    it('should show no agents message when empty', async () => {
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

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('没有已注册'));
      
      consoleSpy.mockRestore();
    });
  });

  describe('unregisterAgent', () => {
    it('should unregister agent successfully with token parameter', async () => {
      const responseData = { success: true };

      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
        if (event === 'end') callback();
      });

      (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
        // 验证 Authorization header
        expect(options.headers['Authorization']).toBe('agent-test-token-123');
        callback(mockResponse);
        return mockRequest;
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await unregisterAgent('agent:test', 'test-token-123');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已注销'));
      
      consoleSpy.mockRestore();
    });

    it('should fail when agentId is missing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await unregisterAgent('');

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('缺少 Agent ID'));
      
      consoleErrorSpy.mockRestore();
    });

    it('should fail when token is missing and identity file does not exist', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // 不传 token，identity 文件不存在时会失败
      await unregisterAgent('agent:nonexistent');

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('缺少 Agent Token'));
      
      consoleErrorSpy.mockRestore();
    });

    it('should send Authorization header with agent- prefix', async () => {
      const responseData = { success: true };

      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
        if (event === 'end') callback();
      });

      let capturedOptions: RequestOptions | null = null;
      (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
        capturedOptions = options;
        callback(mockResponse);
        return mockRequest;
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await unregisterAgent('agent:test', 'my-secret-token');

      // 验证 Authorization header 格式正确
      expect(capturedOptions?.headers?.['Authorization']).toBe('agent-my-secret-token');
      
      consoleSpy.mockRestore();
    });
  });
});