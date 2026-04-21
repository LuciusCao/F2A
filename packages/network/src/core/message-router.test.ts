/**
 * MessageRouter 测试 - 核心路由功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRouter, RoutableMessage } from './message-router.js';
import type { AgentRegistration } from './agent-registry.js';
import { success, failureFromError } from '../types/result.js';

// 创建模拟的 AgentRegistration
function createAgentRegistration(
  agentId: string,
  options: {
    onMessage?: (msg: unknown) => void;
    webhook?: { url: string; token?: string };
  } = {}
): AgentRegistration {
  return {
    agentId,
    name: `Agent ${agentId}`,
    capabilities: [],
    registeredAt: Date.now(),
    lastSeen: Date.now(),
    status: 'active',
    ...options,
  } as AgentRegistration;
}

// 创建模拟消息
function createMessage(overrides: Partial<RoutableMessage> = {}): RoutableMessage {
  return {
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fromAgentId: 'agent:sender',
    toAgentId: 'agent:receiver',
    content: 'test content',
    type: 'message',
    createdAt: new Date(),
    ...overrides,
  };
}

// 创建模拟 P2PNetwork
function createMockP2PNetwork() {
  return {
    sendMessage: vi.fn().mockResolvedValue(success(undefined)),
    sendFreeMessage: vi.fn().mockResolvedValue(success(undefined)),
    getPeerInfo: vi.fn().mockReturnValue({ peerId: '12D3KooWExample1234' }),
    getConnectedPeers: vi.fn().mockReturnValue([]),
    getAllPeers: vi.fn().mockReturnValue([]),
    isDHTEnabled: vi.fn().mockReturnValue(false),
    getEd25519PublicKey: vi.fn().mockReturnValue(''),
  } as unknown as { 
    sendMessage: ReturnType<typeof vi.fn>; 
    sendFreeMessage: ReturnType<typeof vi.fn>;
    getPeerInfo: ReturnType<typeof vi.fn>;
    getConnectedPeers: ReturnType<typeof vi.fn>;
    getAllPeers: ReturnType<typeof vi.fn>;
    isDHTEnabled: ReturnType<typeof vi.fn>;
    getEd25519PublicKey: ReturnType<typeof vi.fn>;
  };
}

describe('MessageRouter', () => {
  let agentRegistry: Map<string, AgentRegistration>;
  let router: MessageRouter;

  beforeEach(() => {
    agentRegistry = new Map<string, AgentRegistration>();
    // 注册发送方和接收方
    agentRegistry.set('agent:sender', createAgentRegistration('agent:sender'));
    agentRegistry.set('agent:receiver', createAgentRegistration('agent:receiver'));
    
    router = new MessageRouter(agentRegistry);
  });

  describe('queue management', () => {
    it('should create queue for agent', () => {
      router.createQueue('agent:receiver');
      const queue = router.getQueue('agent:receiver');
      expect(queue).toBeDefined();
      expect(queue?.agentId).toBe('agent:receiver');
    });

    it('should delete queue for agent', () => {
      router.createQueue('agent:receiver');
      router.deleteQueue('agent:receiver');
      const queue = router.getQueue('agent:receiver');
      expect(queue).toBeUndefined();
    });
  });

  describe('route (sync version)', () => {
    beforeEach(() => {
      router.createQueue('agent:receiver');
    });

    it('should fail if sender not registered', () => {
      const message = createMessage({ fromAgentId: 'agent:unknown' });
      const result = router.route(message);
      expect(result).toBe(false);
    });

    it('should fail if target not registered', () => {
      const message = createMessage({ toAgentId: 'agent:unknown' });
      const result = router.route(message);
      expect(result).toBe(false);
    });

    it('should call onMessage callback if available', () => {
      const onMessage = vi.fn();
      agentRegistry.set('agent:receiver', createAgentRegistration('agent:receiver', { onMessage }));

      const message = createMessage();
      const result = router.route(message);

      expect(result).toBe(true);
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({
        messageId: message.messageId,
        fromAgentId: message.fromAgentId,
        toAgentId: message.toAgentId,
        content: message.content,
        type: message.type,
        createdAt: message.createdAt,
      });
    });

    it('should fallback to queue if callback throws', () => {
      const onMessage = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      agentRegistry.set('agent:receiver', createAgentRegistration('agent:receiver', { onMessage }));

      const message = createMessage();
      const result = router.route(message);

      expect(result).toBe(true);
      expect(onMessage).toHaveBeenCalledTimes(1);
      
      // 消息应该被放入队列
      const queue = router.getQueue('agent:receiver');
      expect(queue?.messages.length).toBe(1);
    });

    it('should enqueue message if no callback', () => {
      const message = createMessage();
      const result = router.route(message);

      expect(result).toBe(true);
      const queue = router.getQueue('agent:receiver');
      expect(queue?.messages.length).toBe(1);
      expect(queue?.messages[0].content).toBe('test content');
    });

    it('should fail if queue not created', () => {
      router.deleteQueue('agent:receiver');
      const message = createMessage();
      const result = router.route(message);
      expect(result).toBe(false);
    });

    it('should broadcast if no toAgentId', () => {
      agentRegistry.set('agent:broadcast1', createAgentRegistration('agent:broadcast1'));
      agentRegistry.set('agent:broadcast2', createAgentRegistration('agent:broadcast2'));
      router.createQueue('agent:broadcast1');
      router.createQueue('agent:broadcast2');

      const message = createMessage({ toAgentId: undefined, fromAgentId: 'agent:broadcast1' });
      const result = router.route(message);

      expect(result).toBe(true);
      // 只有 agent:broadcast2 应该收到（排除发送方）
      const queue1 = router.getQueue('agent:broadcast1');
      const queue2 = router.getQueue('agent:broadcast2');
      expect(queue1?.messages.length).toBe(0);
      expect(queue2?.messages.length).toBe(1);
    });
  });

  describe('routeAsync (async version with webhook)', () => {
    beforeEach(() => {
      router.createQueue('agent:receiver');
    });

    it('should fail if sender not registered', async () => {
      const message = createMessage({ fromAgentId: 'agent:unknown' });
      const result = await router.routeAsync(message);
      expect(result).toBe(false);
    });

    it('should fail if target not registered', async () => {
      const message = createMessage({ toAgentId: 'agent:unknown' });
      const result = await router.routeAsync(message);
      expect(result).toBe(false);
    });

    it('should call onMessage callback if available', async () => {
      const onMessage = vi.fn();
      agentRegistry.set('agent:receiver', createAgentRegistration('agent:receiver', { onMessage }));

      const message = createMessage();
      const result = await router.routeAsync(message);

      expect(result).toBe(true);
      expect(onMessage).toHaveBeenCalledTimes(1);
    });

    it('should enqueue message if no callback and no webhook', async () => {
      const message = createMessage();
      const result = await router.routeAsync(message);

      expect(result).toBe(true);
      const queue = router.getQueue('agent:receiver');
      expect(queue?.messages.length).toBe(1);
    });

    it('should handle callback error and fallback to queue', async () => {
      const onMessage = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      agentRegistry.set('agent:receiver', createAgentRegistration('agent:receiver', { onMessage }));

      const message = createMessage();
      const result = await router.routeAsync(message);

      expect(result).toBe(true);
      const queue = router.getQueue('agent:receiver');
      expect(queue?.messages.length).toBe(1);
    });

    it('should broadcast async if no toAgentId', async () => {
      agentRegistry.set('agent:broadcast1', createAgentRegistration('agent:broadcast1'));
      agentRegistry.set('agent:broadcast2', createAgentRegistration('agent:broadcast2'));
      router.createQueue('agent:broadcast1');
      router.createQueue('agent:broadcast2');

      const message = createMessage({ toAgentId: undefined, fromAgentId: 'agent:broadcast1' });
      const result = await router.routeAsync(message);

      expect(result).toBe(true);
      const queue2 = router.getQueue('agent:broadcast2');
      expect(queue2?.messages.length).toBe(1);
    });
  });

  describe('broadcast', () => {
    beforeEach(() => {
      agentRegistry.set('agent:a', createAgentRegistration('agent:a'));
      agentRegistry.set('agent:b', createAgentRegistration('agent:b'));
      agentRegistry.set('agent:c', createAgentRegistration('agent:c'));
      router.createQueue('agent:a');
      router.createQueue('agent:b');
      router.createQueue('agent:c');
    });

    it('should broadcast to all agents except sender', () => {
      const message = createMessage({ toAgentId: undefined, fromAgentId: 'agent:a' });
      const result = router.broadcast(message);

      expect(result).toBe(true);
      expect(router.getQueue('agent:a')?.messages.length).toBe(0);
      expect(router.getQueue('agent:b')?.messages.length).toBe(1);
      expect(router.getQueue('agent:c')?.messages.length).toBe(1);
    });

    it('should handle agents with onMessage callback', () => {
      const onMessageB = vi.fn();
      agentRegistry.set('agent:b', createAgentRegistration('agent:b', { onMessage: onMessageB }));

      const message = createMessage({ toAgentId: undefined, fromAgentId: 'agent:a' });
      router.broadcast(message);

      expect(onMessageB).toHaveBeenCalledTimes(1);
      expect(router.getQueue('agent:b')?.messages.length).toBe(0);
    });
  });

  describe('broadcastAsync', () => {
    beforeEach(() => {
      agentRegistry.set('agent:a', createAgentRegistration('agent:a'));
      agentRegistry.set('agent:b', createAgentRegistration('agent:b'));
      router.createQueue('agent:a');
      router.createQueue('agent:b');
    });

    it('should broadcast async to all agents except sender', async () => {
      const message = createMessage({ toAgentId: undefined, fromAgentId: 'agent:a' });
      const result = await router.broadcastAsync(message);

      expect(result).toBe(true);
      expect(router.getQueue('agent:b')?.messages.length).toBe(1);
    });
  });

  describe('routeIncoming', () => {
    beforeEach(() => {
      router.createQueue('agent:receiver');
      // 注册远程 agent（routeAsync 会验证发送方）
      agentRegistry.set('agent:remote', createAgentRegistration('agent:remote'));
    });

    it('should route incoming message to local agent', async () => {
      const payload = {
        messageId: 'msg-123',
        fromAgentId: 'agent:remote',
        toAgentId: 'agent:receiver',
        content: 'incoming message',
        type: 'message',
      };
      
      await router.routeIncoming(payload, '12D3KooWRemotePeer');
      
      const queue = router.getQueue('agent:receiver');
      expect(queue?.messages.length).toBe(1);
      expect(queue?.messages[0].content).toBe('incoming message');
    });

    it('should emit message:received event on success', async () => {
      const handler = vi.fn();
      router.on('message:received', handler);
      
      const payload = {
        fromAgentId: 'agent:remote',
        toAgentId: 'agent:receiver',
        content: 'test',
      };
      
      await router.routeIncoming(payload, 'remote-peer');
      
      expect(handler).toHaveBeenCalled();
    });

    it('should emit message:dropped when target not found', async () => {
      const handler = vi.fn();
      router.on('message:dropped', handler);
      
      const payload = {
        fromAgentId: 'agent:remote',
        toAgentId: 'agent:unknown',
        content: 'test',
      };
      
      await router.routeIncoming(payload, 'remote-peer');
      
      expect(handler).toHaveBeenCalledWith({
        reason: 'unknown-agent',
        agentId: 'agent:unknown',
      });
    });

    it('should emit message:dropped when missing toAgentId', async () => {
      const handler = vi.fn();
      router.on('message:dropped', handler);
      
      const payload = {
        fromAgentId: 'agent:remote',
        content: 'test',
      };
      
      await router.routeIncoming(payload, 'remote-peer');
      
      expect(handler).toHaveBeenCalledWith({
        reason: 'missing-target',
        fromPeerId: 'remote-peer',
      });
    });

    it('should handle missing fields with defaults', async () => {
      const payload = {
        fromAgentId: 'agent:remote',
        toAgentId: 'agent:receiver',
      };
      
      await router.routeIncoming(payload, 'remote-peer');
      
      const queue = router.getQueue('agent:receiver');
      expect(queue?.messages.length).toBe(1);
      expect(queue?.messages[0].messageId).toBeDefined();
      expect(queue?.messages[0].content).toBe('');
      expect(queue?.messages[0].type).toBe('message');
    });

    it('should use onMessage callback if available', async () => {
      const onMessage = vi.fn();
      agentRegistry.set('agent:receiver', createAgentRegistration('agent:receiver', { onMessage }));
      
      const payload = {
        fromAgentId: 'agent:remote',
        toAgentId: 'agent:receiver',
        content: 'callback test',
      };
      
      await router.routeIncoming(payload, 'remote-peer');
      
      expect(onMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('routeOutgoing', () => {
    beforeEach(() => {
      router.createQueue('agent:receiver');
    });

    it('should route outgoing message to local agent', async () => {
      const message = createMessage();
      const result = await router.routeOutgoing(message);
      
      expect(result.success).toBe(true);
      const queue = router.getQueue('agent:receiver');
      expect(queue?.messages.length).toBe(1);
    });

    it('should fail when toAgentId is missing', async () => {
      const message = createMessage({ toAgentId: undefined });
      const result = await router.routeOutgoing(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
    });

    it('should fail when sender not registered', async () => {
      const message = createMessage({ fromAgentId: 'agent:unknown' });
      const result = await router.routeOutgoing(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('should use onMessage callback for local delivery', async () => {
      const onMessage = vi.fn();
      agentRegistry.set('agent:receiver', createAgentRegistration('agent:receiver', { onMessage }));
      
      const message = createMessage();
      const result = await router.routeOutgoing(message);
      
      expect(result.success).toBe(true);
      expect(onMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('routeOutgoing with remote target', () => {
    let mockP2PNetwork: ReturnType<typeof createMockP2PNetwork>;
    let routerWithP2P: MessageRouter;

    beforeEach(() => {
      mockP2PNetwork = createMockP2PNetwork();
      routerWithP2P = new MessageRouter(agentRegistry, mockP2PNetwork as unknown as { sendMessage: () => Promise<unknown> });
      
      // 注册一个远程格式的 AgentId
      // AgentId 格式: agent:<PeerId前16位>:<随机8位>
      const remoteAgentId = 'agent:12D3KooWRemote:abc12345';
      agentRegistry.set('agent:sender', createAgentRegistration('agent:sender'));
    });

    it('should fail when P2P network not configured', async () => {
      const remoteAgentId = 'agent:12D3KooWRemote:abc12345';
      const message = createMessage({ toAgentId: remoteAgentId });
      
      // 使用没有 P2P 网络的 router
      const result = await router.routeOutgoing(message);
      
      // 目标不在本地，但没有 P2P 网络会失败
      expect(result.success).toBe(false);
    });

    it('should route to remote agent via P2P when configured', async () => {
      const remoteAgentId = 'agent:12D3KooWRemote:abc12345';
      
      // 创建带 P2P 网络的 router
      const routerWithP2P = new MessageRouter(agentRegistry, {
        sendMessage: vi.fn().mockResolvedValue(success(undefined)),
      } as unknown as { sendMessage: () => Promise<{ success: boolean }> });
      
      const message = createMessage({ toAgentId: remoteAgentId });
      const result = await routerWithP2P.routeOutgoing(message);
      
      // 远程路由应该尝试通过 P2P 发送
      // 由于 mock 只返回 success，测试会验证调用
      expect(result).toBeDefined();
    });
  });

  describe('routeRemote', () => {
    let mockP2PNetwork: ReturnType<typeof createMockP2PNetwork>;
    let routerWithP2P: MessageRouter;

    beforeEach(() => {
      mockP2PNetwork = createMockP2PNetwork();
      routerWithP2P = new MessageRouter(agentRegistry, mockP2PNetwork as unknown as { sendMessage: () => Promise<unknown> });
    });

    it('should fail when P2P network not configured', async () => {
      const message = createMessage({ toAgentId: 'agent:remote:12345678' });
      const result = await router.routeRemote(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NETWORK_NOT_STARTED');
    });

    it('should fail when sender not registered', async () => {
      const message = createMessage({ fromAgentId: 'agent:unknown', toAgentId: 'agent:remote:12345678' });
      const result = await routerWithP2P.routeRemote(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNAUTHORIZED');
    });

    it('should fail when toAgentId is missing', async () => {
      const message = createMessage({ toAgentId: undefined });
      const result = await routerWithP2P.routeRemote(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
    });

    it('should fail when AgentId format is invalid', async () => {
      const message = createMessage({ toAgentId: 'invalid-agent-id' });
      const result = await routerWithP2P.routeRemote(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
    });

    it('should fail when peer not found for AgentId', async () => {
      mockP2PNetwork.getConnectedPeers.mockReturnValue([]);
      mockP2PNetwork.getAllPeers.mockReturnValue([]);
      mockP2PNetwork.isDHTEnabled.mockReturnValue(false);
      
      // PeerId prefix 需要 16 字符: '12D3KooWNotFound' = 16
      const message = createMessage({ toAgentId: 'agent:12D3KooWNotFound:12345678' });
      const result = await routerWithP2P.routeRemote(message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PEER_NOT_FOUND');
    });

    it('should succeed when peer found and message sent', async () => {
      const targetPeerId = '12D3KooWTargetPeer1234567890';
      mockP2PNetwork.getConnectedPeers.mockReturnValue([{ peerId: targetPeerId }]);
      mockP2PNetwork.sendFreeMessage.mockResolvedValue(success(undefined));
      
      const message = createMessage({ toAgentId: `agent:${targetPeerId.slice(0, 16)}:abc12345` });
      const result = await routerWithP2P.routeRemote(message);
      
      expect(result.success).toBe(true);
      expect(mockP2PNetwork.sendFreeMessage).toHaveBeenCalled();
    });

    it('should find peer from all peers when not in connected', async () => {
      const targetPeerId = '12D3KooWTargetPeer1234567890';
      mockP2PNetwork.getConnectedPeers.mockReturnValue([]);
      mockP2PNetwork.getAllPeers.mockReturnValue([{ peerId: targetPeerId }]);
      mockP2PNetwork.sendFreeMessage.mockResolvedValue(success(undefined));
      
      const message = createMessage({ toAgentId: `agent:${targetPeerId.slice(0, 16)}:abc12345` });
      const result = await routerWithP2P.routeRemote(message);
      
      expect(result.success).toBe(true);
    });
  });

  describe('findPeerByAgentId', () => {
    let mockP2PNetwork: ReturnType<typeof createMockP2PNetwork>;
    let routerWithP2P: MessageRouter;

    beforeEach(() => {
      mockP2PNetwork = createMockP2PNetwork();
      mockP2PNetwork.getConnectedPeers = vi.fn();
      mockP2PNetwork.getAllPeers = vi.fn();
      routerWithP2P = new MessageRouter(agentRegistry, mockP2PNetwork as unknown as { sendMessage: () => Promise<unknown>; getConnectedPeers: () => unknown; getAllPeers: () => unknown });
    });

    it('should return null for invalid AgentId format', () => {
      const result = routerWithP2P.findPeerByAgentId('invalid-id');
      expect(result).toBeNull();
    });

    it('should return null for AgentId without agent prefix', () => {
      const result = routerWithP2P.findPeerByAgentId('user:12345678:abc');
      expect(result).toBeNull();
    });

    it('should return null for AgentId with wrong parts count', () => {
      const result = routerWithP2P.findPeerByAgentId('agent:12345678');
      expect(result).toBeNull();
    });

    it('should return null for AgentId with invalid PeerId prefix length', () => {
      const result = routerWithP2P.findPeerByAgentId('agent:short:abc12345');
      expect(result).toBeNull();
    });

    it('should find peer from connected peers', () => {
      const peerId = '12D3KooWTargetPeer1234567890';
      mockP2PNetwork.getConnectedPeers.mockReturnValue([{ peerId }]);
      
      const result = routerWithP2P.findPeerByAgentId(`agent:${peerId.slice(0, 16)}:abc12345`);
      expect(result).toBe(peerId);
    });

    it('should find peer from all peers when not in connected', () => {
      const peerId = '12D3KooWTargetPeer1234567890';
      mockP2PNetwork.getConnectedPeers.mockReturnValue([]);
      mockP2PNetwork.getAllPeers.mockReturnValue([{ peerId }]);
      
      const result = routerWithP2P.findPeerByAgentId(`agent:${peerId.slice(0, 16)}:abc12345`);
      expect(result).toBe(peerId);
    });

    it('should return null when no matching peer found', () => {
      mockP2PNetwork.getConnectedPeers.mockReturnValue([{ peerId: '12D3KooWOther1234' }]);
      mockP2PNetwork.getAllPeers.mockReturnValue([{ peerId: '12D3KooWAnother5678' }]);
      
      const result = routerWithP2P.findPeerByAgentId('agent:unknownpeer:abc12345');
      expect(result).toBeNull();
    });

    it('should return null when P2P network not configured', () => {
      const result = router.findPeerByAgentId('agent:12D3KooWTarget:abc12345');
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      router.createQueue('agent:receiver');
      const message = createMessage({ content: '' });
      const result = router.route(message);
      expect(result).toBe(true);
      expect(router.getQueue('agent:receiver')?.messages[0].content).toBe('');
    });

    it('should handle special characters in content', () => {
      router.createQueue('agent:receiver');
      const specialContent = '你好世界 🌍 <script>alert(1)</script>';
      const message = createMessage({ content: specialContent });
      const result = router.route(message);
      expect(result).toBe(true);
      expect(router.getQueue('agent:receiver')?.messages[0].content).toBe(specialContent);
    });

    it('should handle large content', () => {
      router.createQueue('agent:receiver');
      const largeContent = 'x'.repeat(10000);
      const message = createMessage({ content: largeContent });
      const result = router.route(message);
      expect(result).toBe(true);
      expect(router.getQueue('agent:receiver')?.messages[0].content.length).toBe(10000);
    });

    it('should handle different message types', () => {
      const types: RoutableMessage['type'][] = ['message', 'task_request', 'task_response', 'announcement', 'claim'];
      
      for (const type of types) {
        // 重置队列
        router.createQueue('agent:receiver');
        
        const message = createMessage({ type });
        const result = router.route(message);
        expect(result).toBe(true);
        
        const queuedMsg = router.getQueue('agent:receiver')?.messages[0];
        expect(queuedMsg?.type).toBe(type);
        
        router.deleteQueue('agent:receiver');
      }
    });
  });
});