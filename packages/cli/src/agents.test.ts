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

describe('CLI Agent Commands', () => {
  const mockRequest = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
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
        const responseData = { success: true, agent: { agentId: 'my-agent' } };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        await registerAgent({ id: 'my-agent', name: 'Test' });

        // 验证请求 body.agentId === 'my-agent'
        expect(mockRequest.write).toHaveBeenCalledWith(
          expect.stringContaining('"agentId":"my-agent"')
        );

        // 验证输出包含 "ID: my-agent"
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('ID: my-agent'));
        
        consoleSpy.mockRestore();
      });
    });

    describe('daemon 自动生成 agentId', () => {
      it('should register agent without agentId (daemon generates)', async () => {
        const responseData = { success: true, agent: { agentId: 'agent:generated-id' } };

        mockResponse.on.mockImplementation((event: string, callback: Function) => {
          if (event === 'data') callback(Buffer.from(JSON.stringify(responseData)));
          if (event === 'end') callback();
        });

        (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
          callback(mockResponse);
          return mockRequest;
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        // 不传 id
        await registerAgent({ name: 'Test' });

        // 验证请求 body 不包含 agentId
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
        
        // 不传 name
        await registerAgent({ id: 'test' });

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
        
        await registerAgent({ id: 'test', name: '' });

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

        // 验证请求 body 包含 capabilities 和 webhookUrl
        const writeCall = mockRequest.write.mock.calls[0]?.[0];
        if (writeCall) {
          const body = JSON.parse(writeCall);
          expect(body.capabilities).toBeDefined();
          expect(body.capabilities.length).toBe(2);
          expect(body.capabilities[0].name).toBe('chat');
          expect(body.webhookUrl).toBe('http://example.com/webhook');
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
        
        await registerAgent({ id: 'test', name: 'Test' });

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
    it('should unregister agent successfully', async () => {
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
      
      await unregisterAgent('agent:test');

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
  });
});