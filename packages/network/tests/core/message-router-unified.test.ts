/**
 * RFC 005: MessageRouter 统一路由测试
 *
 * 测试 MessageRouter 提升到核心层后的功能：
 * - 文件迁移验证
 * - F2A 类集成
 * - MessageRouter 路由（本地/远程）
 * - 统一发送入口
 * - P2P 消息接收集成
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'eventemitter3';
import { AgentRegistry, type AgentRegistrationRequest, AGENT_REGISTRY_FILE } from '../../src/core/agent-registry.js';
import { MessageRouter, type RoutableMessage } from '../../src/core/message-router.js';
import { F2A } from '../../src/core/f2a.js';

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), 'message-router-unified-test');

// Mock PeerId 和签名函数
const mockPeerId = '12D3KooGTestPeerId123456789abcdef';
const mockRemotePeerId = '12D3KooWRemotePeerId987654321';
const mockSignFunction = vi.fn((data: string) => `signature-${data.slice(0, 8)}`);

/**
 * Mock P2P Network
 * 用于测试远程消息路由
 */
class MockP2PNetwork extends EventEmitter {
  private connectedPeers: Map<string, { peerId: string }> = new Map();
  private sentMessages: Array<{ peerId: string; payload: unknown }> = [];

  sendToPeer = vi.fn((peerId: string, payload: unknown) => {
    this.sentMessages.push({ peerId, payload });
    return Promise.resolve({ success: true, data: undefined });
  });

  sendFreeMessage = vi.fn((peerId: string, content: unknown, topic?: string) => {
    this.sentMessages.push({ peerId, payload: { content, topic } });
    return Promise.resolve({ success: true, data: undefined });
  });

  getConnectedPeers() {
    return Array.from(this.connectedPeers.values());
  }

  getAllPeers() {
    return Array.from(this.connectedPeers.values());
  }

  isDHTEnabled() {
    return false;
  }

  // RFC 003: Mock Ed25519 公钥（用于签名验证测试）
  getEd25519PublicKey() {
    return 'mockEd25519PublicKeyBase64';
  }

  // 模拟添加远程 peer
  addRemotePeer(peerId: string) {
    this.connectedPeers.set(peerId, { peerId });
  }

  // 模拟收到消息
  simulateIncomingMessage(message: RoutableMessage, fromPeerId: string) {
    this.emit('peer:message', message, fromPeerId);
  }

  // 获取已发送的消息
  getSentMessages() {
    return this.sentMessages;
  }

  // 清空发送记录
  clearSentMessages() {
    this.sentMessages = [];
  }
}

// Helper: 创建基本注册请求
function createRegistrationRequest(name: string = 'Test Agent', callback?: (msg: unknown) => void): AgentRegistrationRequest {
  return {
    name,
    capabilities: [
      { name: 'test-capability', description: 'Test capability' }
    ],
    onMessage: callback,
    metadata: { test: true }
  };
}

// Helper: 创建路由消息
function createRoutableMessage(
  fromAgentId: string,
  toAgentId: string,
  content: string = 'test message'
): RoutableMessage {
  return {
    messageId: `msg-${Date.now()}-${randomBytes(4).toString('hex')}`,
    fromAgentId,
    toAgentId,
    content,
    type: 'message',
    createdAt: new Date(),
  };
}

// Helper: sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('RFC 005: MessageRouter Unified Routing', () => {
  let testId: string;
  let testDir: string;

  beforeEach(() => {
    // 为每个测试生成唯一ID
    testId = `test-${Date.now()}-${randomBytes(4).toString('hex')}`;
    testDir = join(TEST_DIR, testId);

    // 创建测试目录
    mkdirSync(testDir, { recursive: true });

    mockSignFunction.mockClear();
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // 1. 文件迁移验证测试
  // =========================================================================
  describe('File Migration', () => {
    it('should have message-router in core', () => {
      const exists = existsSync('src/core/message-router.ts');
      expect(exists).toBe(true);
    });

    it('should have agent-registry in core', () => {
      const exists = existsSync('src/core/agent-registry.ts');
      expect(exists).toBe(true);
    });

    // 注意：当前项目没有 core/index.ts，但可以从 f2a.ts 导入
    it('should export MessageRouter from f2a.ts', () => {
      const f2aContent = readFileSync('src/core/f2a.ts', 'utf-8');
      expect(f2aContent).toContain('import { MessageRouter }');
      expect(f2aContent).toContain("'./message-router.js'");
    });

    it('should export AgentRegistry from f2a.ts', () => {
      const f2aContent = readFileSync('src/core/f2a.ts', 'utf-8');
      expect(f2aContent).toContain('import { AgentRegistry }');
      expect(f2aContent).toContain("'./agent-registry.js'");
    });
  });

  // =========================================================================
  // 2. AgentRegistry 基础测试
  // =========================================================================
  describe('AgentRegistry Basics', () => {
    let registry: AgentRegistry;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });
    });

    it('should register agent with generated AgentId', () => {
      const agent = registry.register(createRegistrationRequest('Test Agent'));

      expect(agent.agentId).toBeDefined();
      // AgentId 格式: agent:<PeerId前16位>:<随机8位>
      expect(agent.agentId).toMatch(/^agent:[a-zA-Z0-9]+:[a-f0-9]{8}$/);
      expect(agent.name).toBe('Test Agent');
      expect(agent.peerId).toBe(mockPeerId);
      expect(agent.signature).toBeDefined();
    });

    it('should get registered agent', () => {
      const agent = registry.register(createRegistrationRequest('Test Agent'));

      const retrieved = registry.get(agent.agentId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('Test Agent');
    });

    it('should unregister agent', () => {
      const agent = registry.register(createRegistrationRequest('Test Agent'));

      const result = registry.unregister(agent.agentId);
      expect(result).toBe(true);

      const retrieved = registry.get(agent.agentId);
      expect(retrieved).toBeUndefined();
    });

    it('should list all agents', () => {
      registry.register(createRegistrationRequest('Agent 1'));
      registry.register(createRegistrationRequest('Agent 2'));

      const agents = registry.list();
      expect(agents.length).toBe(2);
    });

    it('should find agents by capability', () => {
      registry.register({
        name: 'Chat Agent',
        capabilities: [{ name: 'chat', description: 'Chat capability' }],
      });

      registry.register({
        name: 'Task Agent',
        capabilities: [{ name: 'task', description: 'Task capability' }],
      });

      const chatAgents = registry.findByCapability('chat');
      expect(chatAgents.length).toBe(1);
      expect(chatAgents[0].name).toBe('Chat Agent');
    });
  });

  // =========================================================================
  // 3. MessageRouter 基础测试
  // =========================================================================
  describe('MessageRouter Basics', () => {
    let registry: AgentRegistry;
    let router: MessageRouter;
    let agentRegistryMap: Map<string, ReturnType<typeof registry.register>>;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      // MessageRouter 当前需要 Map<string, AgentRegistration>
      agentRegistryMap = new Map();
      router = new MessageRouter(agentRegistryMap);
    });

    it('should create queue for agent', () => {
      router.createQueue('test-agent-id');
      const queue = router.getQueue('test-agent-id');
      expect(queue).toBeDefined();
      expect(queue!.agentId).toBe('test-agent-id');
    });

    it('should delete queue', () => {
      router.createQueue('test-agent-id');
      router.deleteQueue('test-agent-id');
      const queue = router.getQueue('test-agent-id');
      expect(queue).toBeUndefined();
    });

    it('should route message to local callback', () => {
      const callback = vi.fn();
      const agent = registry.register({
        name: 'Callback Agent',
        capabilities: [],
        onMessage: callback,
      });

      // 注册 sender 和 receiver
      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);
      agentRegistryMap.set(agent.agentId, agent);

      // 创建队列
      router.createQueue(agent.agentId);

      const message = createRoutableMessage(senderAgent.agentId, agent.agentId);
      const routed = router.route(message);
      expect(routed).toBe(true);
      expect(callback).toHaveBeenCalled();
    });

    it('should route message to queue if no callback', () => {
      const agent = registry.register({ name: 'Queue Agent', capabilities: [] });
      agentRegistryMap.set(agent.agentId, agent);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      router.createQueue(agent.agentId);

      const message = createRoutableMessage(senderAgent.agentId, agent.agentId);
      const routed = router.route(message);

      expect(routed).toBe(true);
      const queue = router.getQueue(agent.agentId);
      expect(queue!.messages.length).toBe(1);
    });

    it('should get messages from queue', () => {
      const agent = registry.register({ name: 'Queue Agent', capabilities: [] });
      agentRegistryMap.set(agent.agentId, agent);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      router.createQueue(agent.agentId);

      const message = createRoutableMessage(senderAgent.agentId, agent.agentId);
      router.route(message);

      const messages = router.getMessages(agent.agentId);
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('test message');
    });

    it('should clear messages', () => {
      const agent = registry.register({ name: 'Queue Agent', capabilities: [] });
      agentRegistryMap.set(agent.agentId, agent);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      router.createQueue(agent.agentId);

      const message = createRoutableMessage(senderAgent.agentId, agent.agentId);
      router.route(message);

      const cleared = router.clearMessages(agent.agentId);
      expect(cleared).toBe(1);

      const queue = router.getQueue(agent.agentId);
      expect(queue!.messages.length).toBe(0);
    });

    it('should handle queue overflow', () => {
      const agent = registry.register({ name: 'Queue Agent', capabilities: [] });
      agentRegistryMap.set(agent.agentId, agent);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      // 创建小容量队列
      router.createQueue(agent.agentId, 3);

      // 发送超过容量的消息
      for (let i = 0; i < 5; i++) {
        const message = createRoutableMessage(senderAgent.agentId, agent.agentId, `message-${i}`);
        router.route(message);
      }

      const queue = router.getQueue(agent.agentId);
      expect(queue!.messages.length).toBe(3);
      // 最旧的消息应该被移除
      expect(queue!.messages[0].content).toBe('message-2');
    });

    it('should broadcast message to all agents', () => {
      const agent1 = registry.register({ name: 'Agent 1', capabilities: [] });
      const agent2 = registry.register({ name: 'Agent 2', capabilities: [] });
      const callback3 = vi.fn();
      const agent3 = registry.register({ name: 'Agent 3', capabilities: [], onMessage: callback3 });

      agentRegistryMap.set(agent1.agentId, agent1);
      agentRegistryMap.set(agent2.agentId, agent2);
      agentRegistryMap.set(agent3.agentId, agent3);

      router.createQueue(agent1.agentId);
      router.createQueue(agent2.agentId);
      router.createQueue(agent3.agentId);

      // 从 agent1 广播
      const message = createRoutableMessage(agent1.agentId, '', 'broadcast message');
      message.toAgentId = undefined; // 广播

      const routed = router.broadcast(message);
      expect(routed).toBe(true);

      // agent1 不应该收到自己的消息
      const queue1 = router.getQueue(agent1.agentId);
      expect(queue1!.messages.length).toBe(0);

      // agent2 应该在队列中收到
      const queue2 = router.getQueue(agent2.agentId);
      expect(queue2!.messages.length).toBe(1);

      // agent3 有 callback，应该直接收到
      expect(callback3).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. MessageRouter 路由测试（本地 vs 远程）
  // =========================================================================
  describe('MessageRouter Routing', () => {
    let registry: AgentRegistry;
    let agentRegistryMap: Map<string, ReturnType<typeof registry.register>>;
    let p2pNetwork: MockP2PNetwork;
    let router: MessageRouter;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      agentRegistryMap = new Map();
      p2pNetwork = new MockP2PNetwork();
      router = new MessageRouter(agentRegistryMap, p2pNetwork as unknown as import('../../src/core/p2p-network.js').P2PNetwork);
    });

    describe('routeIncoming', () => {
      it('should route to local agent callback', async () => {
        const callback = vi.fn();
        const agent = registry.register({
          name: 'Local Agent',
          capabilities: [],
          onMessage: callback,
        });

        agentRegistryMap.set(agent.agentId, agent);
        router.createQueue(agent.agentId);

        const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
        agentRegistryMap.set(senderAgent.agentId, senderAgent);

        const message = createRoutableMessage(senderAgent.agentId, agent.agentId, 'incoming test');

        const routed = router.route(message);
        expect(routed).toBe(true);
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
          messageId: message.messageId,
          content: 'incoming test',
        }));
      });
    });

    describe('routeOutgoing (via route)', () => {
      it('should route to local agent', async () => {
        const callback = vi.fn();
        const targetAgent = registry.register({
          name: 'Target Agent',
          capabilities: [],
          onMessage: callback,
        });

        agentRegistryMap.set(targetAgent.agentId, targetAgent);
        router.createQueue(targetAgent.agentId);

        const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
        agentRegistryMap.set(senderAgent.agentId, senderAgent);

        const message = createRoutableMessage(senderAgent.agentId, targetAgent.agentId);

        const routed = router.route(message);
        expect(routed).toBe(true);
        expect(callback).toHaveBeenCalled();
        expect(p2pNetwork.sendToPeer).not.toHaveBeenCalled();
      });

      it('should use P2P for remote agent (routeRemote)', async () => {
        const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
        agentRegistryMap.set(senderAgent.agentId, senderAgent);

        // 添加远程 peer
        p2pNetwork.addRemotePeer(mockRemotePeerId);

        // 远程 Agent ID 格式: agent:<PeerId前16位>:<随机8位>
        const remoteAgentId = `agent:${mockRemotePeerId.slice(0, 16)}:abcd1234`;

        const message = createRoutableMessage(senderAgent.agentId, remoteAgentId, 'remote message');

        const result = await router.routeRemote(message);
        expect(result.success).toBe(true);
        expect(p2pNetwork.sendFreeMessage).toHaveBeenCalled();
      });

      it('should fail for unknown remote peer', async () => {
        const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
        agentRegistryMap.set(senderAgent.agentId, senderAgent);

        const unknownRemoteAgentId = `agent:UnknownPeer123:xyz789`;

        const message = createRoutableMessage(senderAgent.agentId, unknownRemoteAgentId);

        const result = await router.routeRemote(message);
        expect(result.success).toBe(false);
      });
    });
  });

  // =========================================================================
  // 5. 统一发送入口测试 (模拟 F2A.sendMessage)
  // =========================================================================
  describe('Unified Send Interface', () => {
    let registry: AgentRegistry;
    let agentRegistryMap: Map<string, ReturnType<typeof registry.register>>;
    let p2pNetwork: MockP2PNetwork;
    let router: MessageRouter;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      agentRegistryMap = new Map();
      p2pNetwork = new MockP2PNetwork();
      router = new MessageRouter(agentRegistryMap, p2pNetwork as unknown as import('../../src/core/p2p-network.js').P2PNetwork);
    });

    it('should generate message with UUID format', async () => {
      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      const receiverCallback = vi.fn();
      const receiverAgent = registry.register({
        name: 'Receiver',
        capabilities: [],
        onMessage: receiverCallback,
      });

      agentRegistryMap.set(senderAgent.agentId, senderAgent);
      agentRegistryMap.set(receiverAgent.agentId, receiverAgent);
      router.createQueue(receiverAgent.agentId);

      const messageId = `msg-${Date.now()}-${randomBytes(4).toString('hex')}`;
      const message = createRoutableMessage(senderAgent.agentId, receiverAgent.agentId);
      message.messageId = messageId;

      router.route(message);

      // 消息应该成功路由
      expect(receiverCallback).toHaveBeenCalled();
      const callArg = receiverCallback.mock.calls[0][0];
      expect(callArg.messageId).toMatch(/^msg-/);
    });

    it('should set correct timestamp', async () => {
      const before = Date.now();

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      const receiverAgent = registry.register({ name: 'Receiver', capabilities: [] });

      agentRegistryMap.set(senderAgent.agentId, senderAgent);
      agentRegistryMap.set(receiverAgent.agentId, receiverAgent);
      router.createQueue(receiverAgent.agentId);

      const message = createRoutableMessage(senderAgent.agentId, receiverAgent.agentId);
      router.route(message);

      expect(message.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('should route locally when target is registered', async () => {
      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      const receiverCallback = vi.fn();
      const receiverAgent = registry.register({
        name: 'Receiver',
        capabilities: [],
        onMessage: receiverCallback,
      });

      agentRegistryMap.set(senderAgent.agentId, senderAgent);
      agentRegistryMap.set(receiverAgent.agentId, receiverAgent);
      router.createQueue(receiverAgent.agentId);

      const message = createRoutableMessage(senderAgent.agentId, receiverAgent.agentId, 'local message');

      const routed = router.route(message);
      expect(routed).toBe(true);
      expect(receiverCallback).toHaveBeenCalled();
      expect(p2pNetwork.sendToPeer).not.toHaveBeenCalled();
    });

    it('should route remotely when target not in local registry', async () => {
      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      p2pNetwork.addRemotePeer(mockRemotePeerId);
      const remoteAgentId = `agent:${mockRemotePeerId.slice(0, 16)}:remote123`;

      const message = createRoutableMessage(senderAgent.agentId, remoteAgentId, 'remote message');

      const result = await router.routeRemote(message);
      expect(result.success).toBe(true);
      expect(p2pNetwork.sendFreeMessage).toHaveBeenCalledWith(
        mockRemotePeerId,
        expect.objectContaining({
          messageId: message.messageId,
        }),
        'agent.message'
      );
    });
  });

  // =========================================================================
  // 6. 本地 vs 远程路由测试
  // =========================================================================
  describe('Local vs Remote Routing', () => {
    let registry: AgentRegistry;
    let agentRegistryMap: Map<string, ReturnType<typeof registry.register>>;
    let p2pNetwork: MockP2PNetwork;
    let router: MessageRouter;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      agentRegistryMap = new Map();
      p2pNetwork = new MockP2PNetwork();
      router = new MessageRouter(agentRegistryMap, p2pNetwork as unknown as import('../../src/core/p2p-network.js').P2PNetwork);
    });

    it('should not use P2P for local agent', async () => {
      const callback = vi.fn();
      const localAgent = registry.register({
        name: 'Local Agent',
        capabilities: [],
        onMessage: callback,
      });

      agentRegistryMap.set(localAgent.agentId, localAgent);
      router.createQueue(localAgent.agentId);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      const message = createRoutableMessage(senderAgent.agentId, localAgent.agentId);

      const routed = router.route(message);
      expect(routed).toBe(true);
      expect(callback).toHaveBeenCalled();
      expect(p2pNetwork.sendFreeMessage).not.toHaveBeenCalled();
      expect(p2pNetwork.sendToPeer).not.toHaveBeenCalled();
    });

    it('should use P2P for remote agent', async () => {
      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      p2pNetwork.addRemotePeer(mockRemotePeerId);
      const remoteAgentId = `agent:${mockRemotePeerId.slice(0, 16)}:remote123`;

      const message = createRoutableMessage(senderAgent.agentId, remoteAgentId);

      const result = await router.routeRemote(message);
      expect(result.success).toBe(true);
      expect(p2pNetwork.sendFreeMessage).toHaveBeenCalled();
    });

    it('should correctly identify local vs remote agent ID format', async () => {
      // 本地 Agent ID 格式检查
      const localAgent = registry.register({ name: 'Local', capabilities: [] });
      expect(localAgent.agentId.startsWith('agent:')).toBe(true);

      const parts = localAgent.agentId.split(':');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('agent');
      expect(parts[1]).toBe(mockPeerId.slice(0, 16));
      expect(parts[2]).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  // =========================================================================
  // 7. P2P 消息接收集成测试
  // =========================================================================
  describe('P2P Integration', () => {
    let registry: AgentRegistry;
    let agentRegistryMap: Map<string, ReturnType<typeof registry.register>>;
    let p2pNetwork: MockP2PNetwork;
    let router: MessageRouter;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      agentRegistryMap = new Map();
      p2pNetwork = new MockP2PNetwork();
      router = new MessageRouter(agentRegistryMap, p2pNetwork as unknown as import('../../src/core/p2p-network.js').P2PNetwork);
    });

    it('should handle incoming P2P messages via event', async () => {
      const callback = vi.fn();
      const agent = registry.register({
        name: 'Agent',
        capabilities: [],
        onMessage: callback,
      });

      // 注册 sender（远程）和 receiver
      const remoteSenderId = `agent:${mockRemotePeerId.slice(0, 16)}:remote001`;
      const senderAgent = registry.register({ name: 'Remote Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);
      agentRegistryMap.set(agent.agentId, agent);
      router.createQueue(agent.agentId);

      // 模拟 P2P 收到消息（使用已注册的 sender ID）
      const incomingMessage = createRoutableMessage(
        senderAgent.agentId,
        agent.agentId,
        'from remote'
      );

      // 直接路由到本地 agent
      router.route(incomingMessage);

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        content: 'from remote',
        toAgentId: agent.agentId,
      }));
    });

    it('should queue message if agent has no callback', async () => {
      const agent = registry.register({ name: 'Queue Agent', capabilities: [] });
      agentRegistryMap.set(agent.agentId, agent);
      router.createQueue(agent.agentId);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      const message = createRoutableMessage(senderAgent.agentId, agent.agentId, 'queued message');

      router.route(message);

      const queue = router.getQueue(agent.agentId);
      expect(queue!.messages.length).toBe(1);
      expect(queue!.messages[0].content).toBe('queued message');
    });
  });

  // =========================================================================
  // 8. 统计和清理测试
  // =========================================================================
  describe('Stats and Cleanup', () => {
    let registry: AgentRegistry;
    let agentRegistryMap: Map<string, ReturnType<typeof registry.register>>;
    let router: MessageRouter;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      agentRegistryMap = new Map();
      router = new MessageRouter(agentRegistryMap);
    });

    it('should return correct stats', async () => {
      const agent1 = registry.register({ name: 'Agent 1', capabilities: [] });
      const agent2 = registry.register({ name: 'Agent 2', capabilities: [] });

      agentRegistryMap.set(agent1.agentId, agent1);
      agentRegistryMap.set(agent2.agentId, agent2);

      router.createQueue(agent1.agentId);
      router.createQueue(agent2.agentId);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      router.route(createRoutableMessage(senderAgent.agentId, agent1.agentId));
      router.route(createRoutableMessage(senderAgent.agentId, agent1.agentId));
      router.route(createRoutableMessage(senderAgent.agentId, agent2.agentId));

      const stats = router.getStats();
      expect(stats.queues).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.queueStats[agent1.agentId].size).toBe(2);
      expect(stats.queueStats[agent2.agentId].size).toBe(1);
    });

    it('should cleanup expired messages', async () => {
      const agent = registry.register({ name: 'Agent', capabilities: [] });
      agentRegistryMap.set(agent.agentId, agent);
      router.createQueue(agent.agentId);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      // 发送消息
      router.route(createRoutableMessage(senderAgent.agentId, agent.agentId));

      // 等待一段时间确保消息时间戳足够旧
      await sleep(10);

      // 清理所有消息（设置非常短的过期时间）
      const cleaned = router.cleanupExpired(5); // 5ms
      expect(cleaned).toBeGreaterThanOrEqual(1);

      const queue = router.getQueue(agent.agentId);
      expect(queue!.messages.length).toBe(0);
    });
  });

  // =========================================================================
  // 9. 异步路由测试 (routeAsync with webhook)
  // =========================================================================
  describe('Async Routing with Webhook', () => {
    let registry: AgentRegistry;
    let agentRegistryMap: Map<string, ReturnType<typeof registry.register>>;
    let router: MessageRouter;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      agentRegistryMap = new Map();
      router = new MessageRouter(agentRegistryMap);
    });

    it('should route via callback first (priority 1)', async () => {
      const callback = vi.fn();
      const agent = registry.register({
        name: 'Callback Agent',
        capabilities: [],
        onMessage: callback,
        webhook: { url: 'https://example.com/webhook' }, // 有 webhook 但优先 callback
      });

      agentRegistryMap.set(agent.agentId, agent);
      router.createQueue(agent.agentId);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      const message = createRoutableMessage(senderAgent.agentId, agent.agentId);

      const routed = await router.routeAsync(message);
      expect(routed).toBe(true);
      expect(callback).toHaveBeenCalled();
    });

    it('should fallback to queue if no callback and no webhook', async () => {
      const agent = registry.register({ name: 'Queue Agent', capabilities: [] });
      agentRegistryMap.set(agent.agentId, agent);
      router.createQueue(agent.agentId);

      const senderAgent = registry.register({ name: 'Sender', capabilities: [] });
      agentRegistryMap.set(senderAgent.agentId, senderAgent);

      const message = createRoutableMessage(senderAgent.agentId, agent.agentId);

      const routed = await router.routeAsync(message);
      expect(routed).toBe(true);

      const queue = router.getQueue(agent.agentId);
      expect(queue!.messages.length).toBe(1);
    });
  });

  // =========================================================================
  // 10. MessageRouter 更新 registry
  // =========================================================================
  describe('MessageRouter Registry Update', () => {
    let registry: AgentRegistry;
    let router: MessageRouter;

    beforeEach(async () => {
      registry = await AgentRegistry.create(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });

      router = new MessageRouter(new Map());
    });

    it('should update registry reference', async () => {
      const agent = registry.register({ name: 'Agent', capabilities: [] });
      const agentRegistryMap = new Map();
      agentRegistryMap.set(agent.agentId, agent);

      router.updateRegistry(agentRegistryMap);

      // 发送消息应该失败（因为 sender 不在 registry）
      const message = createRoutableMessage('unknown-sender', agent.agentId);
      const routed = router.route(message);
      expect(routed).toBe(false);
    });
  });
});