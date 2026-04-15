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
import { AgentCapability, TaskDelegateOptions } from '../types/index.js';

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
    getConnectedPeers: vi.fn().mockReturnValue([]),
    getAllPeers: vi.fn().mockReturnValue([]),
    sendTaskRequest: vi.fn().mockResolvedValue({ success: true, data: { result: 'ok' } }),
    sendTaskResponse: vi.fn().mockResolvedValue({ success: true }),
    sendFreeMessage: vi.fn().mockResolvedValue({ success: true }),
    on: vi.fn(),
    setIdentityManager: vi.fn(),
    useMiddleware: vi.fn(),
    removeMiddleware: vi.fn().mockReturnValue(true),
    listMiddlewares: vi.fn().mockReturnValue([]),
    findPeerViaDHT: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getDHTPeerCount: vi.fn().mockReturnValue(0),
    isDHTEnabled: vi.fn().mockReturnValue(false)
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
  // 任务处理 - 核心功能
  // ============================================================================

  describe('task handling', () => {
    it('should execute registered handler and return result', async () => {
      const handler = vi.fn().mockResolvedValue({ echoed: 'hello' });
      f2a.registerCapability(
        { name: 'echo', description: 'Echo', tools: [] },
        handler
      );

      const sendResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'echo',
        'Test task',
        { message: 'hello' },
        'caller-peer'
      );

      expect(handler).toHaveBeenCalledWith({ message: 'hello' });
      expect(sendResponseSpy).toHaveBeenCalledWith(
        'caller-peer',
        'task-123',
        'success',
        { echoed: 'hello' }
      );
    });

    it('should reject unsupported capability', async () => {
      const sendResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'unknown-cap',
        'Test task',
        {},
        'caller-peer'
      );

      expect(sendResponseSpy).toHaveBeenCalledWith(
        'caller-peer',
        'task-123',
        'rejected',
        undefined,
        expect.stringContaining('not supported')
      );
    });

    it('should handle handler errors gracefully', async () => {
      f2a.registerCapability(
        { name: 'failing-cap', description: 'Fails', tools: [] },
        async () => { throw new Error('Handler failed'); }
      );

      const sendResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'failing-cap',
        'Test task',
        {},
        'caller-peer'
      );

      expect(sendResponseSpy).toHaveBeenCalledWith(
        'caller-peer',
        'task-123',
        'error',
        undefined,
        'Handler failed'
      );
    });

    it('should not auto-respond when no handler (manual mode)', async () => {
      // 注册能力但不提供 handler - 等待手动响应
      (f2a as any).registeredCapabilities.set('manual-cap', {
        name: 'manual-cap',
        description: 'Manual',
        tools: []
        // 没有 handler
      });

      const sendResponseSpy = vi.fn();
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'manual-cap',
        'Test task',
        {},
        'caller-peer'
      );

      expect(sendResponseSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 任务委托 - 核心功能
  // ============================================================================

  describe('task delegation', () => {
    it('should fail when no agents have the capability', async () => {
      // discoverAgents 返回空数组
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue([]);

      const result = await f2a.delegateTask({
        capability: 'non-existent',
        description: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error?.message || result.error).toContain('No agent found');
    });

    it('should delegate to discovered agents', async () => {
      const mockAgents = [
        { peerId: 'agent-1', displayName: 'Agent 1' },
        { peerId: 'agent-2', displayName: 'Agent 2' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValueOnce({ success: true, data: { result: 'ok' } });

      const result = await f2a.delegateTask({
        capability: 'echo',
        description: 'Test',
        parameters: { message: 'hello' }
      });

      expect(result.success).toBe(true);
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0].status).toBe('success');
    });

    it('should try next agent on failure', async () => {
      const mockAgents = [
        { peerId: 'agent-1' },
        { peerId: 'agent-2' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValueOnce({ success: false, error: { message: 'Failed' } })
        .mockResolvedValueOnce({ success: true, data: { result: 'ok' } });

      const result = await f2a.delegateTask({
        capability: 'echo',
        description: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.data.results).toHaveLength(2);
      expect(result.data.results[1].status).toBe('success');
    });

    it('should delegate in parallel when requested', async () => {
      const mockAgents = [
        { peerId: 'agent-1' },
        { peerId: 'agent-2' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValue({ success: true, data: { result: 'ok' } });

      const result = await f2a.delegateTask({
        capability: 'echo',
        description: 'Test',
        parallel: true,
        minResponses: 2
      });

      expect(result.success).toBe(true);
      expect(result.data.results).toHaveLength(2);
    });
  });

  // ============================================================================
  // 智能调度 - 核心功能（使用真实 CapabilityManager）
  // ============================================================================

  describe('smart scheduling', () => {
    it('should use CapabilityManager for scheduling when available', async () => {
      // CapabilityManager 已在 F2A.create() 中创建
      // 测试它是否被正确使用
      
      const mockAgents = [
        { peerId: 'low-score-agent', displayName: 'Low Score' },
        { peerId: 'high-score-agent', displayName: 'High Score' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValue({ success: true, data: {} });

      // 验证 CapabilityManager 存在
      expect(f2a['capabilityManager']).toBeDefined();

      await f2a.delegateTask({
        capability: 'echo',
        description: 'Test'
      });

      // 验证 sendTaskRequest 被调用（智能调度会尝试最佳节点）
      expect((f2a as any).p2pNetwork.sendTaskRequest).toHaveBeenCalled();
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
  // 事件处理
  // ============================================================================

  describe('events', () => {
    // ⚠️ 跳过：handleTaskRequest 方法不再发出 'task:request' 事件
    it.skip('should emit task:request event on incoming task', async () => {
      const eventSpy = vi.fn();
      f2a.on('task:request', eventSpy);

      f2a.registerCapability(
        { name: 'echo', description: 'Echo', tools: [] },
        async () => 'result'
      );

      await (f2a as any).handleTaskRequest(
        'task-123',
        'echo',
        'Test task',
        {},
        'caller-peer'
      );

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          taskType: 'echo'
        })
      );
    });
  });

  // ============================================================================
  // sendMessageToPeer - Agent 协议层消息发送
  // ============================================================================

  describe('sendMessageToPeer', () => {
    it('should send message to remote peer via P2PNetwork', async () => {
      const sendFreeMessageSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendFreeMessage = sendFreeMessageSpy;

      const result = await f2a.sendMessageToPeer('remote-peer-id', 'Hello world');

      expect(result.success).toBe(true);
      expect(sendFreeMessageSpy).toHaveBeenCalledWith(
        'remote-peer-id',
        'Hello world',
        undefined
      );
    });

    it('should send message with topic', async () => {
      const sendFreeMessageSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendFreeMessage = sendFreeMessageSpy;

      const result = await f2a.sendMessageToPeer('remote-peer-id', 'Hello', 'chat');

      expect(result.success).toBe(true);
      expect(sendFreeMessageSpy).toHaveBeenCalledWith(
        'remote-peer-id',
        'Hello',
        'chat'
      );
    });

    it('should send structured content', async () => {
      const sendFreeMessageSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendFreeMessage = sendFreeMessageSpy;

      const structuredContent = { text: 'Hello', metadata: { priority: 'high' } };      const result = await f2a.sendMessageToPeer('remote-peer-id', structuredContent);

      expect(result.success).toBe(true);
      expect(sendFreeMessageSpy).toHaveBeenCalledWith(
        'remote-peer-id',
        structuredContent,
        undefined
      );
    });

    it('should return failure when P2PNetwork fails', async () => {
      const sendFreeMessageSpy = vi.fn().mockResolvedValue({
        success: false,
        error: { message: 'Connection failed' }
      });
      (f2a as any).p2pNetwork.sendFreeMessage = sendFreeMessageSpy;

      const result = await f2a.sendMessageToPeer('remote-peer-id', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error?.message || result.error).toContain('Connection failed');
    });

    it('should handle peer not connected', async () => {
      const sendFreeMessageSpy = vi.fn().mockResolvedValue({
        success: false,
        error: { message: 'Peer not connected' }
      });
      (f2a as any).p2pNetwork.sendFreeMessage = sendFreeMessageSpy;

      const result = await f2a.sendMessageToPeer('unknown-peer', 'Hello');

      expect(result.success).toBe(false);
    });
  });

  // ============================================================================
  // P2P 事件转发 - bindEvents 测试
  // ============================================================================

  describe('P2P event forwarding', () => {
    it('should forward peer:discovered event from P2PNetwork', async () => {
      const eventSpy = vi.fn();
      f2a.on('peer:discovered', eventSpy);

      // 触发 P2P 网络的 peer:discovered 事件
      const discoveredEvent = {
        peerId: 'discovered-peer-id',
        displayName: 'Discovered Agent',
        capabilities: [{ name: 'echo' }],
        lastSeen: Date.now()
      };      // 模拟 P2P 网络发出事件
      // 在 bindEvents 中，f2a 注册了监听器来转发事件      // 通过调用 mock 的 on 方法注册的监听器
      const onCalls = (f2a as any).p2pNetwork.on.mock.calls;
      const discoveredListener = onCalls.find(
        (call: any[]) => call[0] === 'peer:discovered'
      );      
      if (discoveredListener) {
        discoveredListener[1](discoveredEvent);
      }

      expect(eventSpy).toHaveBeenCalledWith(discoveredEvent);
    });

    it('should forward peer:connected event from P2PNetwork', async () => {
      const eventSpy = vi.fn();
      f2a.on('peer:connected', eventSpy);

      const connectedEvent = {
        peerId: 'connected-peer-id',
        agentInfo: {
          peerId: 'connected-peer-id',
          displayName: 'Connected Agent',
          capabilities: []
        }
      };      const onCalls = (f2a as any).p2pNetwork.on.mock.calls;
      const connectedListener = onCalls.find(
        (call: any[]) => call[0] === 'peer:connected'
      );      
      if (connectedListener) {
        connectedListener[1](connectedEvent);
      }

      expect(eventSpy).toHaveBeenCalledWith(connectedEvent);
    });

    it('should forward peer:disconnected event from P2PNetwork', async () => {
      const eventSpy = vi.fn();
      f2a.on('peer:disconnected', eventSpy);

      const disconnectedEvent = {
        peerId: 'disconnected-peer-id'
      };      const onCalls = (f2a as any).p2pNetwork.on.mock.calls;
      const disconnectedListener = onCalls.find(
        (call: any[]) => call[0] === 'peer:disconnected'
      );      
      if (disconnectedListener) {
        disconnectedListener[1](disconnectedEvent);
      }

      expect(eventSpy).toHaveBeenCalledWith(disconnectedEvent);
    });

    it('should forward error event from P2PNetwork', async () => {
      const eventSpy = vi.fn();
      f2a.on('error', eventSpy);

      const errorObj = new Error('P2P network error');
      const onCalls = (f2a as any).p2pNetwork.on.mock.calls;
      const errorListener = onCalls.find(
        (call: any[]) => call[0] === 'error'
      );      
      if (errorListener) {
        errorListener[1](errorObj);
      }

      expect(eventSpy).toHaveBeenCalledWith(errorObj);
    });

    it('should handle message:received with task.request topic', async () => {
      // 注册能力以便处理任务请求
      f2a.registerCapability(
        { name: 'echo', description: 'Echo', tools: [] },
        async (params) => ({ echoed: params.message })
      );

      const sendResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      const taskMessage = {
        id: 'msg-123',
        type: 'MESSAGE',
        from: 'sender-peer-id',
        to: 'test-peer-id',
        timestamp: Date.now(),
        payload: {
          topic: 'task.request',
          content: {
            taskId: 'task-456',
            taskType: 'echo',
            description: 'Test task',
            parameters: { message: 'hello' }
          }
        }
      };      const onCalls = (f2a as any).p2pNetwork.on.mock.calls;
      const messageListener = onCalls.find(
        (call: any[]) => call[0] === 'message:received'
      );      
      if (messageListener) {
        await messageListener[1](taskMessage, 'sender-peer-id');
      }

      expect(sendResponseSpy).toHaveBeenCalledWith(
        'sender-peer-id',
        'task-456',
        'success',
        { echoed: 'hello' }
      );
    });

    it('should emit peer:message for non-task messages', async () => {
      const eventSpy = vi.fn();
      f2a.on('peer:message', eventSpy);

      const chatMessage = {
        id: 'msg-chat',
        type: 'MESSAGE',
        from: 'sender-peer-id',
        to: 'test-peer-id',
        timestamp: Date.now(),
        payload: {
          topic: 'chat',
          content: 'Hello there!'
        }
      };      const onCalls = (f2a as any).p2pNetwork.on.mock.calls;
      const messageListener = onCalls.find(
        (call: any[]) => call[0] === 'message:received'
      );      
      if (messageListener) {
        await messageListener[1](chatMessage, 'sender-peer-id');
      }

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: 'msg-chat',
          from: 'sender-peer-id',
          content: 'Hello there!',
          topic: 'chat'
        })
      );
    });
  });
});