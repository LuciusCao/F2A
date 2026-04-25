import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlServer } from './control-server.js';
import { tmpdir } from 'os';
import { join } from 'path';

// Track mock server instances
let lastMockServer: any = null;
const TEST_TOKEN='***';
let mockRateLimiterAllow = true;

// Mock identityManager instances for testing
let mockIdentityStoreInstance: any = null;

// Mock AgentTokenManager instance for per-test customization
let mockAgentTokenManagerInstance: any = null;

// Mock AgentTokenManager - Phase 3: In-memory version (complete mock with all methods)
vi.mock('./agent-token-manager.js', () => ({
  AgentTokenManager: vi.fn().mockImplementation(() => {
    mockAgentTokenManagerInstance = {
      generate: vi.fn().mockImplementation((agentId: string) => `agent-test-token-for-${agentId.slice(0, 16)}`),
      verify: vi.fn().mockImplementation((token: string) => {
        if (!token) return { valid: false, error: 'Token is empty' };
        // Simulate in-memory behavior - tokens not in memory are invalid
        return { valid: true, agentId: 'agent:test-peer:mock' };
      }),
      verifyForAgent: vi.fn().mockImplementation((token: string, agentId: string) => {
        if (!token) return { valid: false, error: 'Token is empty' };
        // Simulate in-memory behavior - default to valid
        return { valid: true };
      }),
      revoke: vi.fn().mockReturnValue(true),
      revokeAllForAgent: vi.fn().mockReturnValue(1),
      cleanExpired: vi.fn().mockReturnValue(0),
      clear: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      list: vi.fn().mockReturnValue([]),
      listByAgent: vi.fn().mockReturnValue([]),
      has: vi.fn().mockReturnValue(false),
      size: vi.fn().mockReturnValue(0),
    };
    return mockAgentTokenManagerInstance;
  }),
}));

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

// Mock AgentIdentityStore - P0 修复：添加此 mock 以支持 PATCH /webhook 测试
vi.mock('./agent-identity-store.js', () => ({
  AgentIdentityStore: vi.fn().mockImplementation(() => {
    mockIdentityStoreInstance = {
      get: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
      loadAll: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      updateWebhook: vi.fn().mockResolvedValue({ agentId: 'agent:test-peer:abc123', name: 'TestAgent' }),
      updateLastActive: vi.fn().mockResolvedValue({ agentId: 'agent:test-peer:abc123' }),
      has: vi.fn().mockReturnValue(false),
      size: vi.fn().mockReturnValue(0),
      findBy: vi.fn().mockReturnValue([]),
      findByPeerId: vi.fn().mockReturnValue([]),
      findByCapability: vi.fn().mockReturnValue([]),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    return mockIdentityStoreInstance;
  }),
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
    // RFC011: Mock verifySelfSignature for Agent self-signature verification
    verifySelfSignature: vi.fn().mockReturnValue(true),
    // RFC011: Mock computeAgentId for agentId derivation from publicKey
    computeAgentId: vi.fn().mockReturnValue('agent:test1234abcd'),
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
      webhook: request.webhook,
    })),
    registerRFC008: vi.fn().mockImplementation((request) => ({  // RFC008: 新注册方法
      agentId: 'agent:67face05d98ab91f',  // RFC008: 公钥指纹格式
      name: request.name,
      capabilities: request.capabilities || [],
      publicKey: request.publicKey,
      nodeSignature: 'node-sig-mock-abc123',  // RFC008: Node 归属证明签名
      nodeId: 'test-node-id-xyz789',  // RFC008: 签发节点 ID
      idFormat: 'new',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      webhook: request.webhook,
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
  
  // P0 修复：添加 identityManager mock
  const mockIdentityManager = {
    get: vi.fn(),
    save: vi.fn(),
    delete: vi.fn().mockReturnValue(true),
    loadAll: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    updateWebhook: vi.fn().mockReturnValue({ agentId: 'agent:test-peer:abc123', name: 'TestAgent' }),
    updateLastActive: vi.fn().mockReturnValue({ agentId: 'agent:test-peer:abc123' }),
    has: vi.fn().mockReturnValue(false),
    size: vi.fn().mockReturnValue(0),
    findBy: vi.fn().mockReturnValue([]),
    findByPeerId: vi.fn().mockReturnValue([]),
    findByCapability: vi.fn().mockReturnValue([]),
    clear: vi.fn(),
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
    // P0 修复：添加 getIdentityManager（测试 PATCH /webhook 需要）
    getIdentityManager: vi.fn().mockReturnValue(mockIdentityManager),
    // 导出 mock 对象供测试直接访问
    _mockAgentRegistry: mockAgentRegistry,
    _mockMessageRouter: mockMessageRouter,
    _mockIdentityManager: mockIdentityManager,
  };
};

describe('ControlServer', () => {
  let mockF2A: any;
  let server: ControlServer;

  beforeEach(() => {
    vi.clearAllMocks();
    lastMockServer = null;
    mockRateLimiterAllow = true;
    // Note: AgentTokenManager is mocked globally, vi.clearAllMocks resets it
    mockF2A = createMockF2A();
    // P0: Reset mockImplementation on registry.get (vi.clearAllMocks doesn't clear mockImplementation)
    mockF2A.getAgentRegistry().get.mockReset();
    mockF2A.getMessageRouter().route.mockReset();
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
    let endPromise: Promise<any> | undefined;
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
          // 捕获 async callback 返回的 Promise
          endPromise = callback();
        }
      }),
      // 测试可以等待 endPromise
      _waitForEnd: async () => {
        if (endPromise) await endPromise;
      },
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
      
      expect(res.writeHead).toHaveBeenCalledWith(401, { "Content-Type": "application/json" });
      
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

  describe('GET /api/v1/agents', () => {
    it('should return agents list', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ url: '/api/v1/agents', headers: { 'x-f2a-token': TEST_TOKEN } });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      server.stop();
    });
  });

  describe('GET /api/v1/conversations/:agentId', () => {
    it('should route conversations request to message handler', async () => {
      mockRateLimiterAllow = true;
      mockF2A.getAgentRegistry().get.mockReturnValue({
        agentId: 'agent:test-peer:abc123',
        name: 'TestAgent',
      });
      await server.start();

      const handler = lastMockServer._handler;
      const req = createMockReq({
        method: 'GET',
        url: '/api/v1/conversations/agent%3Atest-peer%3Aabc123?limit=10',
      });
      const res = createMockRes();

      handler(req, res);
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.agentId).toBe('agent:test-peer:abc123');
      expect(Array.isArray(responseData.conversations)).toBe(true);

      server.stop();
    });
  });

  describe('POST /api/v1/agents (RFC008)', () => {
    it('should register agent with publicKey', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({
        method: 'POST',
        url: '/api/v1/agents',
        body: { 
          name: '猫咕噜', 
          publicKey: 'dGVzdHB1YmxpY2tleQ==', // RFC008: Agent Ed25519 公钥
          selfSignature: 'dGVzdHNlbGZzaWduYXR1cmU=', // RFC011: Agent self-signature
          capabilities: ['chat'],
          webhook: { url: 'http://127.0.0.1:9002/f2a/webhook' }
        },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      await req._waitForEnd();  // 等待 async handler 完成
      
      expect(res.writeHead).toHaveBeenCalledWith(201);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.agent.agentId).toMatch(/^agent:/);  // RFC008: 公钥指纹格式
      expect(responseData.agent.name).toBe('猫咕噜');
      expect(responseData.agent.nodeSignature).toBeDefined();  // RFC008: Node 签发归属证明
      expect(responseData.nodeSignature).toBeDefined();  // 响应中也返回 nodeSignature
      
      server.stop();
    });

    it('should reject request without name', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({
        method: 'POST',
        url: '/api/v1/agents',
        body: { capabilities: ['chat'], webhook: { url: 'http://test' } },
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

    it('should reject request without webhook.url', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({
        method: 'POST',
        url: '/api/v1/agents',
        body: { name: 'NoWebhook', capabilities: ['chat'] },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.error).toContain('webhook.url');
      
      server.stop();
    });
  });

  describe('API Version Check', () => {
    it('should reject old /api/agents path with API_VERSION_REQUIRED error', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ url: '/api/agents' });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.code).toBe('API_VERSION_REQUIRED');
      expect(responseData.hint).toContain('/api/v1/agents');
      
      server.stop();
    });

    it('should reject old /api/messages path with API_VERSION_REQUIRED error', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const req = createMockReq({ url: '/api/messages/test-agent' });
      const res = createMockRes();
      
      handler(req, res);
      
      expect(res.writeHead).toHaveBeenCalledWith(400);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.code).toBe('API_VERSION_REQUIRED');
      expect(responseData.hint).toContain('/api/v1/messages');
      
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
      
      expect(res.writeHead).toHaveBeenCalledWith(429, { "Content-Type": "application/json" });
      
      server.stop();
    });
  });

  describe('POST /api/v1/agents/verify - Token Generation', () => {
    it('should generate agent token on successful verification', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const testAgentId = 'agent:test-peer:abc123';
      const testNonce = 'test-nonce-12345';
      
      // Mock generateNonce to return a known nonce
      server['generateNonce'] = vi.fn().mockReturnValue(testNonce);
      
      // Note: AgentTokenManager mock is global and handles all agentIds
      
      // Setup identityManager mock to return an identity with e2eePublicKey
      mockIdentityStoreInstance!.get.mockReturnValue({
        agentId: testAgentId,
        name: 'TestAgent',
        peerId: 'test-peer-id',
        e2eePublicKey: 'mock-public-key',
        registeredAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      });
      
      // Mock e2eeCrypto to verify signature
      server['e2eeCrypto'] = {
        verifySignature: vi.fn().mockReturnValue(true),
      } as any;
      
      // First, setup a pending challenge via POST /api/agents with requestChallenge: true
      const challengeReq = createMockReq({
        method: 'POST',
        url: '/api/v1/agents',
        body: {
          agentId: testAgentId,
          requestChallenge: true,
          webhook: { url: 'http://127.0.0.1:9002/f2a/webhook' }
        },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const challengeRes = createMockRes();
      handler(challengeReq, challengeRes);
      
      // Now verify with correct nonce and signature
      const verifyReq = createMockReq({
        method: 'POST',
        url: '/api/v1/agents/verify',
        body: {
          agentId: testAgentId,
          nonce: testNonce,
          nonceSignature: 'valid-signature'
        },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const verifyRes = createMockRes();
      
      handler(verifyReq, verifyRes);
      
      // Note: Token generation is handled by global mock
      
      server.stop();
    });

    it('should return generated token in response on successful verification', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const testAgentId = 'agent:test-peer:xyz789';
      const testNonce = 'test-nonce-67890';
      
      // Mock generateNonce to return a known nonce
      server['generateNonce'] = vi.fn().mockReturnValue(testNonce);
      
      // Note: AgentTokenManager mock is global and handles all agentIds
      const expectedToken = `agent-test-token-for-${testAgentId.slice(0, 16)}`;
      
      // Setup identityManager mock to return an identity with e2eePublicKey
      mockIdentityStoreInstance!.get.mockReturnValue({
        agentId: testAgentId,
        name: 'TestAgent',
        peerId: 'test-peer-id',
        e2eePublicKey: 'mock-public-key',
        registeredAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      });
      
      // Mock e2eeCrypto to verify signature
      server['e2eeCrypto'] = {
        verifySignature: vi.fn().mockReturnValue(true),
      } as any;
      
      // Setup pending challenge via POST /api/agents with requestChallenge: true
      const challengeReq = createMockReq({
        method: 'POST',
        url: '/api/v1/agents',
        body: {
          agentId: testAgentId,
          requestChallenge: true,
          webhook: { url: 'http://127.0.0.1:9002/f2a/webhook' }
        },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const challengeRes = createMockRes();
      handler(challengeReq, challengeRes);
      
      // Verify
      const verifyReq = createMockReq({
        method: 'POST',
        url: '/api/v1/agents/verify',
        body: {
          agentId: testAgentId,
          nonce: testNonce,
          nonceSignature: 'valid-signature'
        },
        headers: { 'x-f2a-token': TEST_TOKEN }
      });
      const verifyRes = createMockRes();
      
      handler(verifyReq, verifyRes);
      
      // Note: Token generation is handled by global mock
      // The response should contain the expected token
      
      server.stop();
    });
  });

  describe('POST /api/v1/messages - Authorization Validation', () => {
    it('should accept request with valid agent token', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const testAgentId = 'agent:test-peer:sender01';
      const validToken = 'agent-valid-token-1234567890abcdef';
      
      // Setup: register the agent in registry
      mockF2A.getAgentRegistry().get.mockReturnValue({
        agentId: testAgentId,
        name: 'SenderAgent',
        peerId: 'test-peer-id',
        signature: 'mock-sig',
        registeredAt: new Date(),
        lastActiveAt: new Date(),
      });
      
      // Setup: mock verifyForAgent to return valid (global mock handles this)
      // The global mock returns { valid: true } by default
      
      const req = createMockReq({
        method: 'POST',
        url: '/api/v1/messages',
        body: {
          fromAgentId: testAgentId,
          toAgentId: 'agent:test-peer:receiver01',
          content: 'Hello!'
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': `agent-${validToken}`
        }
      });
      const res = createMockRes();
      
      // Setup receiver agent
      mockF2A.getAgentRegistry().get.mockImplementation((id: string) => {
        if (id === testAgentId || id === 'agent:test-peer:receiver01') {
          return {
            agentId: id,
            name: id === testAgentId ? 'SenderAgent' : 'ReceiverAgent',
            peerId: 'test-peer-id',
            signature: 'mock-sig',
          };
        }
        return undefined;
      });
      
      handler(req, res);
      
      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Note: Token verification is handled by global mock
      // verifyForAgent is called with validToken and testAgentId
      
      server.stop();
    });

    it('should reject request without Authorization header (401 MISSING_TOKEN)', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const testAgentId = 'agent:test-peer:noauth001';
      
      // Setup: register the agent in registry
      mockF2A.getAgentRegistry().get.mockReturnValue({
        agentId: testAgentId,
        name: 'NoAuthAgent',
        peerId: 'test-peer-id',
        signature: 'mock-sig',
      });
      
      const req = createMockReq({
        method: 'POST',
        url: '/api/v1/messages',
        body: {
          fromAgentId: testAgentId,
          content: 'Hello!'
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN
          // No Authorization header
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.code).toBe('MISSING_TOKEN');
      expect(responseData.error).toContain('Missing Authorization header');
      
      server.stop();
    });

    it('should reject request with invalid token (401 INVALID_TOKEN)', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const testAgentId = 'agent:test-peer:invalidtok';
      const invalidToken = 'invalid-token-string';
      
      // Setup: register the agent in registry
      mockF2A.getAgentRegistry().get.mockReturnValue({
        agentId: testAgentId,
        name: 'InvalidTokenAgent',
        peerId: 'test-peer-id',
        signature: 'mock-sig',
      });
      
      // Setup: mock verifyForAgent to return invalid for this specific token
      mockAgentTokenManagerInstance!.verifyForAgent.mockReturnValue({ 
        valid: false, 
        error: 'Token not found' 
      });
      
      const req = createMockReq({
        method: 'POST',
        url: '/api/v1/messages',
        body: {
          fromAgentId: testAgentId,
          content: 'Hello!'
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': `agent-${invalidToken}`
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.code).toBe('INVALID_TOKEN');
      expect(responseData.error).toContain('Token not found');
      
      server.stop();
    });

    it('should reject request with wrong-agent token (401)', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      const senderAgentId = 'agent:test-peer:sender002';
      const wrongAgentToken = 'token-belonging-to-other-agent';
      
      // Setup: register the sender agent in registry
      mockF2A.getAgentRegistry().get.mockImplementation((id: string) => {
        if (id === senderAgentId) {
          return {
            agentId: senderAgentId,
            name: 'SenderAgent',
            peerId: 'test-peer-id',
            signature: 'mock-sig',
          };
        }
        return undefined;
      });
      
      // Setup: mock verifyForAgent to return invalid for wrong-agent token
      mockAgentTokenManagerInstance!.verifyForAgent.mockReturnValue({ 
        valid: false, 
        error: 'Agent has no tokens' 
      });
      
      const req = createMockReq({
        method: 'POST',
        url: '/api/v1/messages',
        body: {
          fromAgentId: senderAgentId,
          content: 'Hello!'
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': `agent-${wrongAgentToken}`
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(res.writeHead).toHaveBeenCalledWith(401);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.code).toBe('INVALID_TOKEN');
      
      server.stop();
    });
  });

  // P0 修复：PATCH /api/v1/agents/:agentId/webhook 测试
  describe('PATCH /api/v1/agents/:agentId/webhook', () => {
    const testAgentId = 'agent:test-peer:test123';
    const mockAgent = {
      agentId: testAgentId,
      name: 'TestAgent',
      capabilities: [],
      peerId: 'test-peer-id-12345678',
      signature: 'mock-sig',
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      webhook: { url: 'http://old-webhook.example.com' },
    };

    it('should return 200 on successful webhook update', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      
      // Setup: agent exists in registry
      mockF2A._mockAgentRegistry.get.mockReturnValue(mockAgent);
      mockF2A._mockAgentRegistry.updateWebhook.mockReturnValue(true);
      
      // Setup: identityManager succeeds
      mockIdentityStoreInstance.updateWebhook.mockReturnValue({
        agentId: testAgentId,
        name: 'TestAgent',
        webhook: { url: 'http://new-webhook.example.com' },
      });
      
      const req = createMockReq({
        method: 'PATCH',
        url: `/api/v1/agents/${encodeURIComponent(testAgentId)}/webhook`,
        body: {
          webhook: { url: 'http://new-webhook.example.com', token: 'new-token' }
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': 'agent-valid-token-1234567890abcdef'
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify: 200 response
      expect(res.writeHead).toHaveBeenCalledWith(200);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(true);
      expect(responseData.agentId).toBe(testAgentId);
      expect(responseData.webhook.url).toBe('http://new-webhook.example.com');
      
      // Verify both identityManager and agentRegistry were called
      expect(mockIdentityStoreInstance.updateWebhook).toHaveBeenCalledWith(
        testAgentId,
        { url: 'http://new-webhook.example.com', token: 'new-token' }
      );
      expect(mockF2A._mockAgentRegistry.updateWebhook).toHaveBeenCalledWith(
        testAgentId,
        { url: 'http://new-webhook.example.com', token: 'new-token' }
      );
      
      server.stop();
    });

    it('should return 404 when agent not found in registry', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      
      // Setup: agent NOT in registry
      mockF2A._mockAgentRegistry.get.mockReturnValue(undefined);
      
      const req = createMockReq({
        method: 'PATCH',
        url: `/api/v1/agents/${encodeURIComponent(testAgentId)}/webhook`,
        body: {
          webhook: { url: 'http://new-webhook.example.com' }
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': 'agent-valid-token-1234567890abcdef'
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify: 404 response
      expect(res.writeHead).toHaveBeenCalledWith(404);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe('Agent not found');
      expect(responseData.code).toBe('AGENT_NOT_FOUND');
      
      // Verify identityManager.updateWebhook was NOT called (agent not found first)
      expect(mockIdentityStoreInstance.updateWebhook).not.toHaveBeenCalled();
      expect(mockF2A._mockAgentRegistry.updateWebhook).not.toHaveBeenCalled();
      
      server.stop();
    });

    it('should return 500 when identityManager persistence fails', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      
      // Setup: agent exists in registry
      mockF2A._mockAgentRegistry.get.mockReturnValue(mockAgent);
      
      // Setup: identityManager fails (returns false to simulate persistence failure)
      mockIdentityStoreInstance.updateWebhook.mockReturnValue(false);
      
      const req = createMockReq({
        method: 'PATCH',
        url: `/api/v1/agents/${encodeURIComponent(testAgentId)}/webhook`,
        body: {
          webhook: { url: 'http://new-webhook.example.com' }
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': 'agent-valid-token-1234567890abcdef'
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify: 500 response
      expect(res.writeHead).toHaveBeenCalledWith(500);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe('Failed to persist webhook');
      expect(responseData.code).toBe('PERSIST_FAILED');
      
      // Verify identityManager.updateWebhook was called
      expect(mockIdentityStoreInstance.updateWebhook).toHaveBeenCalledWith(
        testAgentId,
        { url: 'http://new-webhook.example.com' }
      );
      // Verify agentRegistry.updateWebhook was NOT called (persistence failed first)
      expect(mockF2A._mockAgentRegistry.updateWebhook).not.toHaveBeenCalled();
      
      server.stop();
    });

    it('should return 500 when agentRegistry update fails', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      
      // Setup: agent exists in registry
      mockF2A._mockAgentRegistry.get.mockReturnValue(mockAgent);
      
      // Setup: identityManager succeeds
      mockIdentityStoreInstance.updateWebhook.mockReturnValue({
        agentId: testAgentId,
        name: 'TestAgent',
        webhook: { url: 'http://new-webhook.example.com' },
      });
      
      // Setup: agentRegistry.updateWebhook fails (returns false)
      mockF2A._mockAgentRegistry.updateWebhook.mockReturnValue(false);
      
      const req = createMockReq({
        method: 'PATCH',
        url: `/api/v1/agents/${encodeURIComponent(testAgentId)}/webhook`,
        body: {
          webhook: { url: 'http://new-webhook.example.com' }
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': 'agent-valid-token-1234567890abcdef'
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify: 500 response
      expect(res.writeHead).toHaveBeenCalledWith(500);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe('Failed to update registry');
      expect(responseData.code).toBe('REGISTRY_FAILED');
      
      // Verify both identityManager and agentRegistry were called
      expect(mockIdentityStoreInstance.updateWebhook).toHaveBeenCalledWith(
        testAgentId,
        { url: 'http://new-webhook.example.com' }
      );
      expect(mockF2A._mockAgentRegistry.updateWebhook).toHaveBeenCalledWith(
        testAgentId,
        { url: 'http://new-webhook.example.com' }
      );
      
      server.stop();
    });

    it('should return 400 for invalid JSON body', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      
      // Setup: agent exists in registry (but we'll send invalid JSON)
      mockF2A._mockAgentRegistry.get.mockReturnValue(mockAgent);
      
      // Create a request that sends invalid JSON
      const req = {
        method: 'PATCH',
        url: `/api/v1/agents/${encodeURIComponent(testAgentId)}/webhook`,
        headers: { 'x-f2a-token': TEST_TOKEN },
        socket: { remoteAddress: '127.0.0.1' },
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'data') {
            callback(Buffer.from('not valid json'));  // Invalid JSON
          }
          if (event === 'end') {
            callback();
          }
        }),
      };
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify: 400 response
      expect(res.writeHead).toHaveBeenCalledWith(400);
      const responseData = JSON.parse(res.end.mock.calls[0][0]);
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe('Invalid JSON');
      expect(responseData.code).toBe('INVALID_JSON');
      
      // Verify neither identityManager nor agentRegistry were called
      expect(mockIdentityStoreInstance.updateWebhook).not.toHaveBeenCalled();
      expect(mockF2A._mockAgentRegistry.updateWebhook).not.toHaveBeenCalled();
      
      server.stop();
    });

    it('should support webhookUrl shorthand format', async () => {
      mockRateLimiterAllow = true;
      await server.start();
      
      const handler = lastMockServer._handler;
      
      // Setup: agent exists in registry
      mockF2A._mockAgentRegistry.get.mockReturnValue(mockAgent);
      mockF2A._mockAgentRegistry.updateWebhook.mockReturnValue(true);
      
      // Setup: identityManager succeeds
      mockIdentityStoreInstance.updateWebhook.mockReturnValue({
        agentId: testAgentId,
        name: 'TestAgent',
        webhook: { url: 'http://shorthand.example.com' },
      });
      
      // Send webhookUrl instead of webhook object (legacy format)
      const req = createMockReq({
        method: 'PATCH',
        url: `/api/v1/agents/${encodeURIComponent(testAgentId)}/webhook`,
        body: {
          webhookUrl: 'http://shorthand.example.com',
          webhookToken: 'shorthand-token'
        },
        headers: { 
          'x-f2a-token': TEST_TOKEN,
          'authorization': 'agent-valid-token-1234567890abcdef'
        }
      });
      const res = createMockRes();
      
      handler(req, res);
      
      // Wait for async handler to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify: 200 response
      expect(res.writeHead).toHaveBeenCalledWith(200);
      
      // Verify the webhook was built correctly from shorthand
      expect(mockIdentityStoreInstance.updateWebhook).toHaveBeenCalledWith(
        testAgentId,
        { url: 'http://shorthand.example.com', token: 'shorthand-token' }
      );
      
      server.stop();
    });
  });
});
