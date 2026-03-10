import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlServer } from './control-server.js';
import { TokenManager } from '../core/token-manager.js';

// Track mock server instances
let lastMockServer: any = null;

const TEST_TOKEN = 'test-token-12345';

vi.mock('http', () => ({
  createServer: vi.fn((handler) => {
    lastMockServer = {
      listen: vi.fn((port, callback) => {
        if (callback) callback();
        return { port };
      }),
      close: vi.fn((callback) => {
        if (callback) callback();
      }),
      on: vi.fn(),
      _handler: handler
    };
    return lastMockServer;
  })
}));

// Mock TokenManager
vi.mock('../core/token-manager', () => ({
  TokenManager: vi.fn().mockImplementation(() => ({
    getToken: vi.fn().mockReturnValue(TEST_TOKEN),
    verifyToken: vi.fn((token) => token === TEST_TOKEN),
    getTokenPath: vi.fn().mockReturnValue('/mock/path'),
    logTokenUsage: vi.fn() // 添加审计日志方法
  }))
}));

// Mock F2A
vi.mock('../core/f2a', () => ({
  F2A: vi.fn()
}));

// Mock RateLimiter
vi.mock('../utils/rate-limiter', () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    allowRequest: vi.fn().mockReturnValue(true),
    stop: vi.fn()
  }))
}));

describe('ControlServer', () => {
  let mockF2A: any;
  let server: ControlServer;

  beforeEach(() => {
    vi.clearAllMocks();
    lastMockServer = null;
    
    mockF2A = {
      peerId: 'test-peer-id',
      agentInfo: { displayName: 'Test Agent' },
      getConnectedPeers: vi.fn().mockReturnValue([
        { peerId: 'peer1', displayName: 'Peer 1' }
      ]),
      discoverAgents: vi.fn().mockResolvedValue([
        { peerId: 'agent1', displayName: 'Agent 1' }
      ])
    };
    
    server = new ControlServer(mockF2A, 9001);
  });

  afterEach(() => {
    server.stop();
  });

  describe('start/stop', () => {
    it('should start server on specified port', async () => {
      await server.start();
      expect(lastMockServer).not.toBeNull();
      expect(lastMockServer.listen).toHaveBeenCalledWith(9001, expect.any(Function));
    });

    it('should stop server gracefully', async () => {
      await server.start();
      server.stop();
      expect(lastMockServer.close).toHaveBeenCalled();
    });
  });

  describe('request handling', () => {
    const createMockReq = (method: string, body?: object, headers?: Record<string, string>) => ({
      method,
      headers: {
        'x-f2a-token': TEST_TOKEN,
        ...headers
      },
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn((event, callback) => {
        if (event === 'data' && body) {
          callback(Buffer.from(JSON.stringify(body)));
        }
        if (event === 'end') {
          callback();
        }
      })
    });

    const createMockRes = () => ({
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn()
    });

    it('should handle OPTIONS request for CORS', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('OPTIONS');
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
    });

    it('should reject non-POST methods', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('GET');
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(405);
    });

    it('should handle status command', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'status' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.peerId).toBe('test-peer-id');
    });

    it('should handle peers command', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'peers' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.peers).toHaveLength(1);
    });

    it('should handle discover command', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'discover', capability: 'test' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
    });

    it('should handle unknown commands', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq('POST', { action: 'unknown' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
    });

    it('should handle invalid JSON', async () => {
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = {
        method: 'POST',
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('invalid json'));
          }
          if (event === 'end') {
            callback();
          }
        })
      };
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
    });
  });

  describe('生产环境 CORS 验证测试 (P2 安全修复)', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      // 恢复原始环境变量
      process.env.NODE_ENV = originalEnv;
      delete process.env.F2A_ALLOWED_ORIGINS;
    });

    it('生产环境使用默认 localhost 配置应该记录警告', () => {
      process.env.NODE_ENV = 'production';
      
      // Logger 使用 console.log 输出日志
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // 使用默认配置（只包含 localhost）
      const testServer = new ControlServer(mockF2A, 9002);
      
      // 应该记录警告日志（输出中包含 CORS 相关警告）
      const calls = logSpy.mock.calls.map(call => call.join(' '));
      const hasCorsWarning = calls.some(msg => 
        msg.includes('CORS') && msg.includes('localhost')
      );
      expect(hasCorsWarning).toBe(true);
      
      logSpy.mockRestore();
      testServer.stop();
    });

    it('生产环境使用通配符 origin 应该抛出错误', () => {
      process.env.NODE_ENV = 'production';
      
      // 使用通配符配置应该抛出错误
      expect(() => {
        new ControlServer(mockF2A, 9002, undefined, {
          allowedOrigins: ['*']
        });
      }).toThrow('Wildcard CORS origin is not allowed in production');
    });

    it('生产环境使用明确的域名配置应该正常工作', async () => {
      process.env.NODE_ENV = 'production';
      
      // 使用明确的域名配置
      const testServer = new ControlServer(mockF2A, 9002, undefined, {
        allowedOrigins: ['https://example.com', 'https://api.example.com']
      });
      await testServer.start();
      
      // 应该正常启动
      expect(lastMockServer).not.toBeNull();
      
      testServer.stop();
    });

    it('开发环境允许使用 localhost 配置', async () => {
      process.env.NODE_ENV = 'development';
      
      // 开发环境应该允许使用默认 localhost 配置
      const testServer = new ControlServer(mockF2A, 9002);
      await testServer.start();
      
      // 应该正常启动，不抛出错误
      expect(lastMockServer).not.toBeNull();
      
      testServer.stop();
    });

    it('开发环境允许使用通配符配置', () => {
      process.env.NODE_ENV = 'development';
      
      // 开发环境应该允许使用通配符配置
      expect(() => {
        const testServer = new ControlServer(mockF2A, 9002, undefined, {
          allowedOrigins: ['*']
        });
        testServer.stop();
      }).not.toThrow();
    });

    it('应该支持从环境变量读取 CORS 配置', async () => {
      process.env.NODE_ENV = 'development';
      process.env.F2A_ALLOWED_ORIGINS = 'https://env-origin.com,https://another.com';
      
      const testServer = new ControlServer(mockF2A, 9002);
      await testServer.start();
      
      // 应该正常启动
      expect(lastMockServer).not.toBeNull();
      
      testServer.stop();
    });

    it('生产环境使用 localhost 应该记录警告', () => {
      process.env.NODE_ENV = 'production';
      
      // Logger 使用 console.log 输出日志
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // 生产环境使用 localhost 配置
      const testServer = new ControlServer(mockF2A, 9002, undefined, {
        allowedOrigins: ['http://localhost', 'https://example.com']
      });
      
      // 应该记录警告日志（输出中包含 localhost 相关警告）
      const calls = logSpy.mock.calls.map(call => call.join(' '));
      const hasLocalhostWarning = calls.some(msg => 
        msg.includes('localhost') && msg.includes('WARN')
      );
      expect(hasLocalhostWarning).toBe(true);
      
      logSpy.mockRestore();
      testServer.stop();
    });
  });
});
