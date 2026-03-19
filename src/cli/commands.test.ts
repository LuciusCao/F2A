import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process.exit to prevent tests from exiting
process.exit = vi.fn() as any;

// 在导入模块前设置环境变量
process.env.F2A_CONTROL_TOKEN = 'test-token';
process.env.F2A_CONTROL_PORT = '9001';

import { listPending, confirm, reject } from './commands.js';
import { request, RequestOptions } from 'http';

// Mock http module
vi.mock('http', () => ({
  request: vi.fn(),
}));

describe('CLI Commands', () => {
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
    (process.exit as any).mockReset();
    process.env.F2A_CONTROL_PORT = '9001';
    process.env.F2A_CONTROL_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.F2A_CONTROL_PORT;
    delete process.env.F2A_CONTROL_TOKEN;
  });

  describe('listPending', () => {
    it('should list pending connections', async () => {
      const pendingData = {
        success: true,
        pending: [
          { index: 1, agentIdShort: 'abc123', address: '192.168.1.1', port: 9000, remainingMinutes: 30 }
        ]
      };

      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') callback(Buffer.from(JSON.stringify(pendingData)));
        if (event === 'end') callback();
      });

      (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
        callback(mockResponse);
        return mockRequest;
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await listPending();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('待确认连接'));
      consoleSpy.mockRestore();
    });

    it('should show no pending message when empty', async () => {
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') callback(Buffer.from(JSON.stringify({ success: true, pending: [] })));
        if (event === 'end') callback();
      });

      (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
        callback(mockResponse);
        return mockRequest;
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await listPending();
      
      expect(consoleSpy).toHaveBeenCalledWith('没有待确认的连接请求');
      consoleSpy.mockRestore();
    });

    it('should handle connection error', async () => {
      (request as any).mockImplementation(() => {
        const req = {
          ...mockRequest,
          on: (event: string, callback: Function) => {
            if (event === 'error') callback(new Error('Connection refused'));
          }
        };
        return req;
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

      await expect(listPending()).rejects.toThrow('exit');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('confirm', () => {
    it('should confirm connection successfully', async () => {
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') callback(Buffer.from(JSON.stringify({ success: true, message: '已确认' })));
        if (event === 'end') callback();
      });

      (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
        callback(mockResponse);
        return mockRequest;
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await confirm(1);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已确认'));
      consoleSpy.mockRestore();
    });

    it('should handle confirm error', async () => {
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') callback(Buffer.from(JSON.stringify({ success: false, error: 'Invalid ID' })));
        if (event === 'end') callback();
      });

      (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
        callback(mockResponse);
        return mockRequest;
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

      await expect(confirm(999)).rejects.toThrow('exit');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('reject', () => {
    it('should reject connection with reason', async () => {
      mockResponse.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'data') callback(Buffer.from(JSON.stringify({ success: true, message: '已拒绝' })));
        if (event === 'end') callback();
      });

      (request as any).mockImplementation((options: RequestOptions, callback: Function) => {
        callback(mockResponse);
        return mockRequest;
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await reject(1, '可疑连接');
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已拒绝'));
      consoleSpy.mockRestore();
    });
  });
});
