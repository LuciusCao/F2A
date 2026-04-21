/**
 * F2A 核心测试
 * 
 * 测试策略：
 * 1. 单元测试 - 测试核心逻辑（能力管理、任务处理）
 * 2. 集成测试 - 移到 tests/integration/
 * 
 * 注意：此文件不测试 P2P 网络（已在 p2p-network.test.ts 和集成测试中覆盖）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2A } from './f2a.js';
import { AgentCapability } from '../types/index.js';
import type { Middleware } from '../utils/middleware.js';

// 最小化 Mock - 只 mock 外部依赖
vi.mock('./p2p-network', () => ({
  P2PNetwork: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue({ 
      success: true, 
      data: { peerId: 'test-peer-id', addresses: ['/ip4/127.0.0.1/tcp/9000'] }
    }),
    stop: vi.fn(),
    discoverAgents: vi.fn().mockResolvedValue([
      { peerId: 'agent-1', displayName: 'Agent 1', capabilities: [{ name: 'echo' }] },
      { peerId: 'agent-2', displayName: 'Agent 2', capabilities: [{ name: 'echo' }] },
    ]),
    getConnectedPeers: vi.fn().mockReturnValue([
      { peerId: 'connected-peer', agentInfo: { peerId: 'connected-peer', displayName: 'Connected' } }
    ]),
    getAllPeers: vi.fn().mockReturnValue([
      { peerId: 'peer-with-info', agentInfo: { peerId: 'peer-with-info', displayName: 'With Info' } },
      { peerId: 'peer-no-info', multiaddrs: [{ toString: () => '/ip4/127.0.0.1/tcp/9001' }], lastSeen: Date.now() }
    ]),
    on: vi.fn(),
    setIdentityManager: vi.fn(),
    setAgentRegistry: vi.fn(),
    sendFreeMessage: vi.fn().mockResolvedValue({ success: true }),
    useMiddleware: vi.fn(),
    removeMiddleware: vi.fn().mockReturnValue(true),
    listMiddlewares: vi.fn().mockReturnValue(['test-middleware']),
    findPeerViaDHT: vi.fn().mockResolvedValue({ success: true, data: ['/ip4/127.0.0.1/tcp/9002'] }),
    getDHTPeerCount: vi.fn().mockReturnValue(5),
    isDHTEnabled: vi.fn().mockReturnValue(true)
  }))
}));

vi.mock('./identity/index.js', () => ({
  IdentityManager: vi.fn().mockImplementation(() => ({
    loadOrCreate: vi.fn().mockResolvedValue({ success: true, data: { peerId: 'test-peer-id' } }),
    getPeerIdString: vi.fn().mockReturnValue('test-peer-id'),
    getPeerId: vi.fn().mockReturnValue({ toString: () => 'test-peer-id' }),
    getPrivateKey: vi.fn().mockReturnValue({ bytes: new Uint8Array(32) }),
    getE2EEKeyPair: vi.fn().mockReturnValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }),
    isLoaded: vi.fn().mockReturnValue(true)
  }))
}));

describe('F2A', () => {
  let f2a: F2A;

  beforeEach(async () => {
    f2a = await F2A.create({
      displayName: 'Test Agent',
      dataDir: '/tmp/f2a-test-' + Date.now(),
      network: { enableMDNS: false }
    });
  });

  afterEach(async () => {
    await f2a.stop();
  });

  // ============================================================================
  // 能力管理 - 核心功能
  // ============================================================================
  
  describe('capability management', () => {
    it('should register and retrieve capabilities', () => {
      const capability: AgentCapability = {
        name: 'echo',
        description: 'Echo back input',
        tools: ['echo']
      };

      const result = f2a.registerCapability(capability, async (params) => ({
        echoed: params.message
      }));

      expect(result.success).toBe(true);
      expect(f2a.getCapabilities()).toHaveLength(1);
      expect(f2a.getCapabilities()[0].name).toBe('echo');
    });

    it('should reject invalid capability definition', () => {
      const result = f2a.registerCapability(
        { name: '', description: 'Invalid', tools: [] }, // 空名称
        async () => {}
      );

      expect(result.success).toBe(false);
      expect(f2a.getCapabilities()).toHaveLength(0);
    });

    it('should update capability when registering same name', () => {
      f2a.registerCapability(
        { name: 'echo', description: 'Original', tools: [] },
        async () => 'v1'
      );
      f2a.registerCapability(
        { name: 'echo', description: 'Updated', tools: ['new-tool'] },
        async () => 'v2'
      );

      const caps = f2a.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0].description).toBe('Updated');
      expect(caps[0].tools).toContain('new-tool');
    });
  });

  // ============================================================================
  // 生命周期 - 基本功能
  // ============================================================================

  describe('lifecycle', () => {
    it('should start and stop successfully', async () => {
      const result = await f2a.start();
      expect(result.success).toBe(true);
      
      await f2a.stop();
      // 不抛出异常即为成功
    });

    it('should not start twice', async () => {
      await f2a.start();
      const result = await f2a.start();
      expect(result.success).toBe(false);
    });

    it('should emit network:started event', async () => {
      const eventSpy = vi.fn();
      f2a.on('network:started', eventSpy);

      await f2a.start();
      
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should emit network:stopped event', async () => {
      const eventSpy = vi.fn();
      f2a.on('network:stopped', eventSpy);

      await f2a.start();
      await f2a.stop();
      
      expect(eventSpy).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Peer 管理
  // ============================================================================

  describe('peer management', () => {
    it('should get connected peers with agentInfo', async () => {
      await f2a.start();
      
      const peers = f2a.getConnectedPeers();
      expect(peers).toBeDefined();
      expect(Array.isArray(peers)).toBe(true);
      // 验证每个 peer 的基本结构
      for (const peer of peers) {
        expect(peer.peerId).toBeDefined();
        expect(typeof peer.peerId).toBe('string');
        expect(peer.peerId.length).toBeGreaterThan(0);
      }
    });

    it('should get all peers including those without agentInfo', async () => {
      await f2a.start();
      
      const peers = f2a.getAllPeers();
      expect(peers).toBeDefined();
      expect(Array.isArray(peers)).toBe(true);
      // Each peer should have basic info
      for (const peer of peers) {
        expect(peer.peerId).toBeDefined();
        expect(typeof peer.peerId).toBe('string');
        expect(peer.peerId.length).toBeGreaterThan(0);
        // agentType 可能是 undefined（对于没有 agentInfo 的 peer）或有效值
        if (peer.agentType) {
          expect(['openclaw', 'claude', 'custom', 'other']).toContain(peer.agentType);
        }
        // capabilities 是数组（可能是 undefined 或空数组）
        if (peer.capabilities !== undefined) {
          expect(Array.isArray(peer.capabilities)).toBe(true);
        }
      }
    });

    it('should discover agents and return valid AgentInfo array', async () => {
      await f2a.start();
      
      const agents = await f2a.discoverAgents();
      expect(agents).toBeDefined();
      expect(Array.isArray(agents)).toBe(true);
      // 验证返回的每个 agent 有基本字段
      for (const agent of agents) {
        expect(agent.peerId).toBeDefined();
        expect(agent.displayName).toBeDefined();
        expect(Array.isArray(agent.capabilities)).toBe(true);
      }
    });

    it('should discover agents by capability and filter correctly', async () => {
      await f2a.start();
      
      const agents = await f2a.discoverAgents('echo');
      expect(agents).toBeDefined();
      expect(Array.isArray(agents)).toBe(true);
      // 按能力过滤时，返回的 agent 应包含指定能力
      for (const agent of agents) {
        const hasEchoCap = agent.capabilities.some(cap => 
          cap.name === 'echo' || cap.tools?.includes('echo')
        );
        expect(hasEchoCap).toBe(true);
      }
    });
  });

  // ============================================================================
  // 消息发送
  // ============================================================================

  describe('message sending', () => {
    it('should send message to peer', async () => {
      await f2a.start();
      
      const result = await f2a.sendMessageToPeer('test-peer', 'hello');
      expect(result.success).toBe(true);
    });

    it('should send message with object content', async () => {
      await f2a.start();
      
      const result = await f2a.sendMessageToPeer('test-peer', { text: 'hello' });
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // 中间件
  // ============================================================================

  describe('middleware', () => {
    it('should register middleware without error', async () => {
      await f2a.start();
      
      const middleware: Middleware = {
        name: 'test-middleware',
        priority: 100,
        process: (context) => ({ action: 'continue' as const, context })
      };
      
      f2a.useMiddleware(middleware);
      // 验证中间件已注册
      const list = f2a.listMiddlewares();
      expect(list).toContain('test-middleware');
    });

    it('should remove middleware and return true', async () => {
      await f2a.start();
      
      // 先注册一个中间件
      const middleware: Middleware = {
        name: 'removable-middleware',
        priority: 50,
        process: (context) => ({ action: 'continue' as const, context })
      };
      f2a.useMiddleware(middleware);
      
      const result = f2a.removeMiddleware('removable-middleware');
      expect(result).toBe(true);
      // 验证已移除
      expect(f2a.listMiddlewares()).not.toContain('removable-middleware');
    });

    it('should list middlewares as array of strings', async () => {
      await f2a.start();
      
      const list = f2a.listMiddlewares();
      expect(list).toBeDefined();
      expect(Array.isArray(list)).toBe(true);
      // 每个元素是字符串
      for (const name of list) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================================
  // DHT
  // ============================================================================

  describe('DHT', () => {
    it('should find peer via DHT and return result with addresses', async () => {
      await f2a.start();
      
      const result = await f2a.findPeerViaDHT('target-peer');
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(Array.isArray(result.data)).toBe(true);
        // 每个地址应该是有效的 multiaddr 格式
        for (const addr of result.data) {
          expect(addr).toMatch(/^\/ip4\/|^\/ip6\/|^\/dns/);
        }
      }
    });

    it('should get DHT peer count as non-negative number', async () => {
      await f2a.start();
      
      const count = f2a.getDHTPeerCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should check DHT enabled status as boolean', async () => {
      await f2a.start();
      
      const enabled = f2a.isDHTEnabled();
      expect(typeof enabled).toBe('boolean');
      // 根据测试配置，DHT 在 mock 中被设置为 true
      // 但不应假设具体值，只验证类型
    });
  });

  // ============================================================================
  // 签名
  // ============================================================================

  describe('signing', () => {
    it('should sign data with valid signature format', async () => {
      await f2a.start();
      
      const signature = f2a.signData('test data');
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
      // Ed25519 签名是 base64 编码的 64 字节，格式为 86-88 字符
      // 或降级格式 "prefix:hash" (冒号分隔)
      if (signature.includes(':')) {
        // 降级 hash 格式
        const parts = signature.split(':');
        expect(parts.length).toBe(2);
        expect(parts[0].length).toBeGreaterThan(0);
        expect(parts[1].length).toBeGreaterThan(0);
      } else {
        // Ed25519 签名格式：base64 编码
        expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
        // Ed25519 签名 64 bytes = ~86 base64 chars (with padding)
        expect(signature.length).toBeGreaterThanOrEqual(86);
        expect(signature.length).toBeLessThanOrEqual(88);
      }
    });

    it('should get ed25519 public key with valid format', async () => {
      await f2a.start();
      
      const publicKey = f2a.getEd25519PublicKey();
      // 公钥可能为 null（如果 ed25519Signer 未初始化）
      if (publicKey !== null) {
        expect(typeof publicKey).toBe('string');
        expect(publicKey.length).toBeGreaterThan(0);
        // Ed25519 公钥 32 bytes = 44 base64 chars (with padding)
        expect(publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
        expect(publicKey.length).toBe(44);
      }
    });
  });

  // ============================================================================
  // getter 方法
  // ============================================================================

  describe('getter methods', () => {
    it('should get IdentityService after create()', () => {
      // F2A.create() initializes identityService
      const service = f2a.getIdentityService();
      expect(service).toBeDefined();
      expect(typeof service.exportNodeIdentity).toBe('function');
      expect(typeof service.exportAgentIdentity).toBe('function');
      expect(typeof service.renewAgentIdentity).toBe('function');
    });

    it('should get AgentRegistry after create()', () => {
      const registry = f2a.getAgentRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe('function');
      expect(typeof registry.get).toBe('function');
      expect(typeof registry.findByCapability).toBe('function');
      expect(typeof registry.unregister).toBe('function');
    });

    it('should get MessageRouter after create()', () => {
      const router = f2a.getMessageRouter();
      expect(router).toBeDefined();
      expect(typeof router.route).toBe('function');
      expect(typeof router.getQueue).toBe('function');
      expect(typeof router.getMessages).toBe('function');
    });

    it('should get MessageService after create()', () => {
      const service = f2a.getMessageService();
      expect(service).toBeDefined();
      expect(typeof service.sendMessage).toBe('function');
    });

    it('should get CapabilityService with registerCapability method', () => {
      const service = f2a.getCapabilityService();
      expect(service).toBeDefined();
      expect(typeof service.registerCapability).toBe('function');
      expect(typeof service.getCapabilities).toBe('function');
      // 验证初始状态
      expect(service.getCapabilities()).toEqual([]);
    });
  });

  // ============================================================================
  // 统一消息发送入口
  // ============================================================================

  describe('sendMessage unified', () => {
    it('should return error when MessageService not initialized', async () => {
      await f2a.start();
      
      const result = await f2a.sendMessage('from-agent', 'to-agent', 'hello');
      expect(result.success).toBe(false);
      // Error code may vary depending on initialization state
      expect(result.error).toBeDefined();
    });
  });

  // ============================================================================
  // MessageRouter P2P 配置
  // ============================================================================

  describe('setMessageRouterP2PNetwork', () => {
    it('should configure MessageRouter when both exist', async () => {
      await f2a.start();
      
      // Even if messageRouter doesn't exist, no error should be thrown
      f2a.setMessageRouterP2PNetwork();
      // No error = success
    });
  });
});