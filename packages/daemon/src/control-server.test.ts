import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlServer } from './control-server.js';
import { tmpdir } from 'os';
import { join } from 'path';

// Track mock server instances
let lastMockServer: any = null;
const TEST_TOKEN = 'test-token-12345';
let mockRateLimiterAllow = true;

// Mock http
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

// Mock @f2a/network - 统一 mock
vi.mock('@f2a/network', async (importOriginal) => {
  const actual = await importOriginal() as any;
  
  // Mock AgentRegistry
  const MockAgentRegistry = vi.fn().mockImplementation(() => ({
    register: vi.fn().mockReturnValue({
      agentId: 'agent:test-peer:abc123',
      name: 'TestAgent',
      capabilities: [],
      peerId: 'test-peer-id-12345678',
      signature: 'mock-sig',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
    }),
    restore: vi.fn().mockReturnValue({
      agentId: 'agent:test-peer:abc123',
      name: 'TestAgent',
      capabilities: [],
      peerId: 'test-peer-id-12345678',
      signature: 'mock-sig',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
    }),
    unregister: vi.fn().mockReturnValue(true),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({ total: 0 }),
    updateWebhook: vi.fn().mockReturnValue(true),
    updateLastActive: vi.fn().mockReturnValue(true),
    getAgentsMap: vi.fn().mockReturnValue(new Map()),
    save: vi.fn(),
    load: vi.fn(),
  }));
  
  // Mock MessageRouter
  const MockMessageRouter = vi.fn().mockImplementation(() => ({
    route: vi.fn().mockResolvedValue({ success: true }),
    routeLocal: vi.fn().mockResolvedValue({ success: true }),
    routeRemote: vi.fn().mockResolvedValue({ success: true }),
    createQueue: vi.fn(),
    getQueue: vi.fn(),
    clearQueue: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
  }));
  
  return {
    ...actual,
    Logger: vi.fn().mockImplementation(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
    TokenManager: vi.fn().mockImplementation(() => ({
      getToken: vi.fn().mockReturnValue(TEST_TOKEN),
      verifyToken: vi.fn((token) => token === TEST_TOKEN),
      getTokenPath: vi.fn().mockReturnValue('/mock/path'),
      logTokenUsage: vi.fn(),
    })),
    RateLimiter: vi.fn().mockImplementation(() => ({
      allowRequest: vi.fn(() => mockRateLimiterAllow),
      stop: vi.fn(),
    })),
    F2A: vi.fn(),
    AgentRegistry: MockAgentRegistry,
    MessageRouter: MockMessageRouter,
    getErrorMessage: vi.fn((e) => e?.message || 'Unknown error'),
  };
});

// Create mock F2A instance
const createMockF2A = () => {
  const mockAgentRegistry = {
    register: vi.fn().mockImplementation((request) => ({
      agentId: 'agent:test-peer:abc123',
      name: request.name, // 返回请求中的 name
      capabilities: request.capabilities || [],
      peerId: 'test-peer-id-12345678',
      signature: 'mock-sig',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
    })),
    restore: vi.fn().mockReturnValue({
      agentId: 'agent:test-peer:abc123',
      name: 'TestAgent',
      capabilities: [],
      peerId: 'test-peer-id-12345678',
      signature: 'mock-sig',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
    }),
    unregister: vi.fn().mockReturnValue(true),
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({ total: 0 }),
    updateWebhook: vi.fn().mockReturnValue(true),
    updateLastActive: vi.fn().mockReturnValue(true),
    getAgentsMap: vi.fn().mockReturnValue(new Map()),
    save: vi.fn(),
    load: vi.fn(),
  };
  
  const mockMessageRouter = {
    route: vi.fn().mockResolvedValue({ success: true }),
    routeLocal: vi.fn().mockResolvedValue({ success: true }),
    routeRemote: vi.fn().mockResolvedValue({ success: true }),
    createQueue: vi.fn(),
    getQueue: vi.fn(),
    clearQueue: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
  };
  
  return {
    peerId: 'test-peer-id-12345678',
    agentInfo: {
      peerId: 'test-peer-id-12345678',
      displayName: 'Test Agent',
      capabilities: []
    },
    signData: vi.fn((data: string) => `sig-${data.slice(0, 16)}`),
    getPeers: vi.fn().mockReturnValue([]),
    getConnectedPeers: vi.fn().mockReturnValue([]),
    getAllPeers: vi.fn().mockReturnValue([]),
    discoverAgents: vi.fn().mockResolvedValue([]),
    sendTaskTo: vi.fn().mockResolvedValue({ success: true }),
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
    // P0 修复：添加 getAgentRegistry 和 getMessageRouter
    getAgentRegistry: vi.fn().mockReturnValue(mockAgentRegistry),
    getMessageRouter: vi.fn().mockReturnValue(mockMessageRouter),
  };
};

describe('ControlServer', () => {
  let mockF2A: any;
  let server: ControlServer;

  beforeEach(() => {
    vi.clearAllMocks();
    lastMockServer = null;
    mockRateLimiterAllow = true;
    mockF2A = createMockF2A();
    server = new ControlServer(mockF2A, 9001, undefined, { dataDir: join(tmpdir(), 'f2a-test') });
  });

  afterEach(() => {
    server.stop();
  });

  // Helper functions
  const createMockReq = (options: {
    method?: string;
    url?: string;
    body?: object;
    headers?: Record<string, string>;
  } = {}) => {
    const req = {
      method: options.method || 'GET',
      url: options.url || '/',
      headers: {
        ...options.headers  // 不默认添加 token，由测试控制
      },
      socket: { remoteAddress: '127.0.0.1' },
      on: vi.fn((event: string, callback: Function) => {
        if (event === 'data' && options.body) {
          callback(Buffer.from(JSON.stringify(options.body)));
        }
        if (event === 'end') {
          callback();
        }
      }),
    };
    return req as any;
  };

  const createMockRes = () => {
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn(),
    };
    return res as any;
  };

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

  describe('authentication', () => {
    it('should reject requests without token', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ 
        method: 'GET',
        url: '/status',
        headers: {}  // 没有 token
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      
      server.stop();
    });

    it('should accept valid X-F2A-Token', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ headers: { 'x-f2a-token': TEST_TOKEN } });
      const res = createMockRes();
      
      handler(req, res);
      
      // Should succeed for valid token
      expect(res.writeHead).not.toHaveBeenCalledWith(401);
      
      server.stop();
    });
  });

  describe('GET /status', () => {
    it('should return status with valid token', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ url: '/status', headers: { 'x-f2a-token': TEST_TOKEN } });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });
  });

  describe('GET /api/agents', () => {
    it('should return agents list', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ url: '/api/agents', headers: { 'x-f2a-token': TEST_TOKEN } });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });
  });

  describe('POST /api/agents (RFC 003)', () => {
    it('should register agent with node-issued AgentId', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({
        method: 'POST',
        url: '/api/agents',
        body: { name: '猫咕噜', capabilities: ['chat'] },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(201);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.agent.agentId).toMatch(/^agent:/);
      expect(responseData.agent.name).toBe('猫咕噜');
      expect(responseData.agent.signature).toBeDefined();
      
      server.stop();
    });

    it('should reject request without name', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({
        method: 'POST',
        url: '/api/agents',
        body: { capabilities: ['chat'] },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.error).toContain('Missing required field: name');
      
      server.stop();
    });
  });

  describe('rate limiting', () => {
    it('should reject when rate limit exceeded', async () => {
      mockRateLimiterAllow = false;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ url: '/status' });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(429);
      
      server.stop();
    });
  });
});
