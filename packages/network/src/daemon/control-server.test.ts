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

// Create mock F2A instance with all needed methods
const createMockF2A = () => ({
  peerId: 'test-peer-id',
  agentInfo: {
    peerId: 'test-peer-id',
    displayName: 'Test Agent',
    capabilities: []
  },
  getPeers: vi.fn().mockReturnValue([]),
  getConnectedPeers: vi.fn().mockReturnValue([
    { peerId: 'peer1', displayName: 'Peer 1' }
  ]),
  getAllPeers: vi.fn().mockReturnValue([]),
  discoverAgents: vi.fn().mockResolvedValue([]),
  sendTaskTo: vi.fn().mockResolvedValue({ success: true, result: 'done' }),
  sendMessage: vi.fn().mockResolvedValue({ success: true }),
  sendMessageToPeer: vi.fn().mockResolvedValue({ success: true }),
  registerCapability: vi.fn().mockResolvedValue({ success: true }),
  updateAgentInfo: vi.fn().mockResolvedValue({ success: true }),
  getAgentInfo: vi.fn().mockReturnValue({
    peerId: 'test-peer-id',
    displayName: 'Test Agent',
    capabilities: []
  }),
  getOnlinePeerCount: vi.fn().mockReturnValue(0),
  getStatus: vi.fn().mockReturnValue({
    peerId: 'test-peer-id',
    onlinePeers: 0,
    isRunning: true
  }),
  // Phase 1: 添加 Agent Registry 和 Message Router mock
  getAgentRegistry: vi.fn().mockReturnValue({
    register: vi.fn().mockReturnValue({
      agentId: 'agent:test-peer-id:12345678',
      name: 'Test Agent',
      capabilities: [],
      peerId: 'test-peer-id',
      signature: 'test-signature',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
    }),
    unregister: vi.fn().mockReturnValue(true),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    findByCapability: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({ total: 0, capabilities: {} }),
  }),
  getMessageRouter: vi.fn().mockReturnValue({
    createQueue: vi.fn(),
    deleteQueue: vi.fn(),
    getQueue: vi.fn(),
    route: vi.fn().mockReturnValue(true),
    routeRemote: vi.fn().mockResolvedValue({ success: true }),
    broadcast: vi.fn().mockReturnValue(true),
    getMessages: vi.fn().mockReturnValue([]),
    clearMessages: vi.fn().mockReturnValue(0),
    getStats: vi.fn().mockReturnValue({ queues: 0, totalMessages: 0, queueStats: {} }),
    setP2PNetwork: vi.fn(),
  }),
});

// Mock RateLimiter - we'll control this in tests
let mockRateLimiterAllow = true;
vi.mock('../utils/rate-limiter', () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    allowRequest: vi.fn(() => mockRateLimiterAllow),
    stop: vi.fn()
  }))
}));

describe('ControlServer', () => {
  let mockF2A: any;
  let server: ControlServer;

  beforeEach(() => {
    vi.clearAllMocks();
    lastMockServer = null;
    mockRateLimiterAllow = true;
    
    mockF2A = createMockF2A();
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

    it('严格模式下禁止 localhost origin', () => {
      process.env.NODE_ENV = 'development';
      process.env.F2A_STRICT_CORS = 'true';
      
      // 严格模式下使用 localhost 应该抛出错误
      expect(() => {
        new ControlServer(mockF2A, 9002, undefined, {
          allowedOrigins: ['http://localhost']
        });
      }).toThrow('Localhost CORS origin is not allowed in strict mode');
      
      delete process.env.F2A_STRICT_CORS;
    });

    it('严格模式下禁止 localhost/127.0.0.1 origins', () => {
      process.env.NODE_ENV = 'development';
      process.env.F2A_STRICT_CORS = 'true';
      
      // 严格模式下使用 127.0.0.1 应该抛出错误
      expect(() => {
        new ControlServer(mockF2A, 9002, undefined, {
          allowedOrigins: ['http://127.0.0.1:3000', 'https://example.com']
        });
      }).toThrow('Localhost/127.0.0.1 CORS origins are not allowed in strict mode');
      
      delete process.env.F2A_STRICT_CORS;
    });
  });

  describe('HTTP endpoints', () => {
    const createMockReq = (overrides: Partial<any> = {}) => ({
      method: 'GET',
      url: '/',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn((event, callback) => {
        if (event === 'end') callback();
      }),
      ...overrides
    });

    const createMockRes = () => ({
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn()
    });

    it('should handle GET /health without auth', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ method: 'GET', url: '/health' });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.status).toBe('ok');
      expect(responseData.peerId).toBe('test-peer-id');
      
      server.stop();
    });

    it('should handle GET /status with X-F2A-Token', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'GET', 
        url: '/status',
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.peerId).toBe('test-peer-id');
      
      server.stop();
    });

    it('should handle GET /status with Bearer token', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'GET', 
        url: '/status',
        headers: { authorization: `Bearer ${TEST_TOKEN}` }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      
      server.stop();
    });

    it('should reject GET /status without auth', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ method: 'GET', url: '/status' });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should handle GET /peers with auth', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'GET', 
        url: '/peers',
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should reject GET /peers without auth', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ method: 'GET', url: '/peers' });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should return 429 when rate limited on GET /status', async () => {
      mockRateLimiterAllow = false;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'GET', 
        url: '/status',
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(429);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.error).toBe('Too many requests');
      
      mockRateLimiterAllow = true;
      server.stop();
    });

    it('should return 429 when rate limited on GET /peers', async () => {
      mockRateLimiterAllow = false;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'GET', 
        url: '/peers',
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(429);
      
      mockRateLimiterAllow = true;
      server.stop();
    });
  });

  describe('POST endpoints', () => {
    const createMockReq = (overrides: Partial<any> = {}) => ({
      method: 'POST',
      url: '/',
      headers: { 'x-f2a-token': TEST_TOKEN },
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn((event, callback) => {
        if (event === 'data' && overrides.body) {
          callback(Buffer.from(JSON.stringify(overrides.body)));
        }
        if (event === 'end') callback();
      }),
      ...overrides
    });

    const createMockRes = () => ({
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn()
    });

    it('should handle POST /register-capability with auth', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'POST', 
        url: '/register-capability',
        body: { capability: { name: 'test-cap', description: 'Test', tools: [] } }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should reject POST /register-capability without auth', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'POST', 
        url: '/register-capability',
        headers: {},
        body: { capability: { name: 'test-cap', description: 'Test', tools: [] } }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should handle POST /register-capability with invalid JSON', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = {
        method: 'POST',
        url: '/register-capability',
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('invalid json'));
          }
          if (event === 'end') callback();
        })
      };
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      
      server.stop();
    });

    it('should handle POST /agent/update with displayName', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'POST', 
        url: '/agent/update',
        body: { displayName: 'New Name' }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      expect(mockF2A.agentInfo.displayName).toBe('New Name');
      
      server.stop();
    });

    it('should handle POST /agent/update with capabilities', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'POST', 
        url: '/agent/update',
        body: { capabilities: ['test-cap'] }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should reject POST /agent/update without auth', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'POST', 
        url: '/agent/update',
        headers: {},
        body: { displayName: 'New Name' }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should handle POST /agent/update with invalid JSON', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = {
        method: 'POST',
        url: '/agent/update',
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from('invalid json'));
          }
          if (event === 'end') callback();
        })
      };
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(500);
      
      server.stop();
    });
  });

  describe('POST command handling', () => {
    const createMockReq = (body?: object, headers?: Record<string, string>) => ({
      method: 'POST',
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

    it('should handle delegate command with valid parameters', async () => {
      mockRateLimiterAllow = true;
      mockF2A.sendTaskTo = vi.fn().mockResolvedValue({ success: true, result: 'done' });
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'delegate', 
        peerId: 'peer-123', 
        taskType: 'test-task',
        description: 'Test task',
        parameters: { foo: 'bar' }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should reject delegate command missing peerId', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'delegate', 
        taskType: 'test-task'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.error).toContain('Missing required fields');
      
      server.stop();
    });

    it('should reject delegate command missing taskType', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'delegate', 
        peerId: 'peer-123'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      
      server.stop();
    });

    it('should handle delegate command failure', async () => {
      mockRateLimiterAllow = true;
      mockF2A.sendTaskTo = vi.fn().mockRejectedValue(new Error('Connection failed'));
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'delegate', 
        peerId: 'peer-123', 
        taskType: 'test-task'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(500);
      
      server.stop();
    });

    it('should handle send command with valid parameters', async () => {
      mockRateLimiterAllow = true;
      mockF2A.sendMessage = vi.fn().mockResolvedValue({ success: true });
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'send', 
        peerId: 'peer-123', 
        content: 'Hello!'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should reject send command missing peerId', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'send', 
        content: 'Hello!'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      
      server.stop();
    });

    it('should reject send command missing content', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'send', 
        peerId: 'peer-123'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      
      server.stop();
    });

    it('should handle send command failure', async () => {
      mockRateLimiterAllow = true;
      mockF2A.sendMessageToPeer = vi.fn().mockRejectedValue(new Error('Send failed'));
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'send', 
        peerId: 'peer-123', 
        content: 'Hello!'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(500);
      
      server.stop();
    });

    it('should handle register-capability command', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'register-capability', 
        capability: { name: 'test-cap', description: 'Test', tools: [] }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should reject register-capability command missing capability.name', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        action: 'register-capability'
      });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      
      server.stop();
    });

    it('should handle discover command without capability filter', async () => {
      mockRateLimiterAllow = true;
      mockF2A.discoverAgents = vi.fn().mockResolvedValue([
        { peerId: 'agent1', displayName: 'Agent 1' }
      ]);
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ action: 'discover' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should handle discover command failure', async () => {
      mockRateLimiterAllow = true;
      mockF2A.discoverAgents = vi.fn().mockRejectedValue(new Error('Discovery failed'));
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ action: 'discover', capability: 'test' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(500);
      
      server.stop();
    });

    it('should return 429 when rate limited', async () => {
      mockRateLimiterAllow = false;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ action: 'status' });
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(429);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.code).toBe('RATE_LIMIT_EXCEEDED');
      
      mockRateLimiterAllow = true;
      server.stop();
    });

    it('should return 401 with invalid token', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = {
        method: 'POST',
        headers: { 'x-f2a-token': 'invalid-token' },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(Buffer.from(JSON.stringify({ action: 'status' })));
          }
          if (event === 'end') callback();
        })
      };
      const res = createMockRes();
      
      handler(req, res);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.code).toBe('UNAUTHORIZED');
      
      server.stop();
    });

    it('should handle request body too large', async () => {
      mockRateLimiterAllow = true;
      
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      
      // Create a request that simulates body size exceeding limit
      const req = {
        method: 'POST',
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            // Simulate large chunk
            callback(Buffer.alloc(1024 * 1024 + 1)); // > 1MB
          }
          if (event === 'end') {
            // This won't be called because req.destroy() is called
          }
        }),
        destroy: vi.fn()
      };
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for the data event to be processed
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // The handler should return 413 for large body
      expect(res.writeHead).toHaveBeenCalledWith(413);
      
      server.stop();
    });
  });

  describe('CORS headers', () => {
    const createMockReq = (overrides: Partial<any> = {}) => ({
      method: 'OPTIONS',
      url: '/',
      headers: { origin: 'http://localhost' },
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn(),
      ...overrides
    });

    const createMockRes = () => ({
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn()
    });

    it('should set CORS headers with matching origin', async () => {
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: { origin: 'http://localhost' }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type, X-F2A-Token, Authorization');
      
      server.stop();
    });

    it('should set default origin when origin not in allowed list', async () => {
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: { origin: 'http://unknown-origin.com' }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Should use first allowed origin as default
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost');
      
      server.stop();
    });

    it('should use first allowed origin when no origin header', async () => {
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: {} // no origin
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost');
      
      server.stop();
    });
  });

  describe('Bearer token extraction', () => {
    const createMockReq = (overrides: Partial<any> = {}) => ({
      method: 'GET',
      url: '/status',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn((event, callback) => {
        if (event === 'end') callback();
      }),
      ...overrides
    });

    const createMockRes = () => ({
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn()
    });

    it('should accept valid Bearer token', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: { authorization: `Bearer ${TEST_TOKEN}` }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });

    it('should reject invalid Bearer token', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: { authorization: 'Bearer invalid-token' }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should handle malformed Authorization header', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: { authorization: 'Basic abc123' } // Not Bearer
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should handle empty Authorization header', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: { authorization: '' }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should prefer X-F2A-Token over Authorization', async () => {
      mockRateLimiterAllow = true;
      const server = new ControlServer(mockF2A, 9001);
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          authorization: 'Bearer other-token'
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Should succeed because X-F2A-Token is valid
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });
  });
});
