/**
 * MessageService 测试
 * Phase 1b: 测试 MessageService 的核心功能
 * 
 * 测试覆盖:
 * - 正常路径: sendMessage 本地/远程路由、字符串/对象内容处理
 * - 错误路径: MessageRouter/AgentRegistry 未初始化
 * - 边界情况: 对象内容 JSON 序列化
 * - 状态验证: handleFreeMessage 事件发出
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';
import { MessageService, SendMessageOptions } from './message-service.js';
import type { P2PNetwork } from './p2p-network.js';
import type { MessageRouter, RoutableMessage } from './message-router.js';
import type { AgentRegistry, AgentRegistration } from './agent-registry.js';
import type { F2AEvents, Result } from '../types/index.js';
import { success } from '../types/result.js';

// Mock P2PNetwork
class MockP2PNetwork {
  private connectedPeers: Map<string, { peerId: string }> = new Map();
  
  getConnectedPeers(): { peerId: string }[] {
    return Array.from(this.connectedPeers.values());
  }
  
  getAllPeers(): { peerId: string }[] {
    return Array.from(this.connectedPeers.values());
  }
  
  async sendFreeMessage(peerId: string, content: unknown, topic?: string): Promise<Result<void>> {
    return success(undefined);
  }
  
  isDHTEnabled(): boolean {
    return false;
  }
  
  getEd25519PublicKey(): string | null {
    return 'mock-ed25519-public-key-base64';
  }
  
  addPeer(peerId: string): void {
    this.connectedPeers.set(peerId, { peerId });
  }
}

// Mock MessageRouter
class MockMessageRouter {
  private agentRegistry: Map<string, AgentRegistration>;
  private routedMessages: RoutableMessage[] = [];
  private remoteRoutedMessages: RoutableMessage[] = [];
  private routeReturnValue: boolean = true;
  private routeRemoteReturnValue: Result<void> = success(undefined);
  private p2pNetwork?: MockP2PNetwork;
  
  constructor(agentRegistry: Map<string, AgentRegistration>, p2pNetwork?: MockP2PNetwork) {
    this.agentRegistry = agentRegistry;
    this.p2pNetwork = p2pNetwork;
  }
  
  // 同步路由方法
  route(message: RoutableMessage): boolean {
    // 验证发送方存在
    if (!this.agentRegistry.has(message.fromAgentId)) {
      return false;
    }
    
    // 验证目标 Agent 存在
    if (message.toAgentId && !this.agentRegistry.has(message.toAgentId)) {
      return false;
    }
    
    this.routedMessages.push(message);
    return this.routeReturnValue;
  }
  
  // 远程路由方法
  async routeRemote(message: RoutableMessage): Promise<Result<void>> {
    this.remoteRoutedMessages.push(message);
    return this.routeRemoteReturnValue;
  }
  
  // 测试辅助方法
  getRoutedMessages(): RoutableMessage[] {
    return this.routedMessages;
  }
  
  getRemoteRoutedMessages(): RoutableMessage[] {
    return this.remoteRoutedMessages;
  }
  
  setRouteReturnValue(value: boolean): void {
    this.routeReturnValue = value;
  }
  
  setRouteRemoteReturnValue(value: Result<void>): void {
    this.routeRemoteReturnValue = value;
  }
  
  createQueue(agentId: string): void {}
  deleteQueue(agentId: string): void {}
  setP2PNetwork(p2pNetwork: MockP2PNetwork): void {
    this.p2pNetwork = p2pNetwork;
  }
}

// Mock AgentRegistry
class MockAgentRegistry {
  private agents: Map<string, AgentRegistration> = new Map();
  
  register(agentId: string, registration: AgentRegistration): void {
    this.agents.set(agentId, registration);
  }
  
  get(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }
  
  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }
  
  list(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }
  
  getAgentsMap(): Map<string, AgentRegistration> {
    return this.agents;
  }
}

// Helper to create agent registration
function createAgentRegistration(
  agentId: string,
  name: string = 'Test Agent',
  onMessage?: (message: unknown) => void
): AgentRegistration {
  return {
    agentId,
    name,
    capabilities: [{ name: 'test', description: 'Test capability', tools: ['test-tool'] }],
    peerId: 'test-peer-id',
    signature: 'test-signature',
    registeredAt: new Date(),
    lastActiveAt: new Date(),
    onMessage,
  };
}

describe('MessageService', () => {
  let messageService: MessageService;
  let p2pNetwork: MockP2PNetwork;
  let messageRouter: MockMessageRouter;
  let agentRegistry: MockAgentRegistry;
  let eventEmitter: EventEmitter<F2AEvents>;
  let agentsMap: Map<string, AgentRegistration>;
  let lastRoutedMessage: RoutableMessage | null = null;

  beforeEach(() => {
    p2pNetwork = new MockP2PNetwork();
    agentsMap = new Map<string, AgentRegistration>();
    agentRegistry = new MockAgentRegistry();
    messageRouter = new MockMessageRouter(agentsMap, p2pNetwork);
    eventEmitter = new EventEmitter<F2AEvents>();
    
    // Create MessageService with all dependencies
    messageService = new MessageService(
      {
        p2pNetwork: p2pNetwork as unknown as P2PNetwork,
        messageRouter: messageRouter as unknown as MessageRouter,
        agentRegistry: agentRegistry as unknown as AgentRegistry,
      },
      eventEmitter
    );
    
    // Track routed messages
    lastRoutedMessage = null;
    const originalRoute = messageRouter.route.bind(messageRouter);
    messageRouter.route = (message: RoutableMessage) => {
      lastRoutedMessage = message;
      return originalRoute(message);
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendMessage', () => {
    // 正常路径 1: 本地路由 - 目标 Agent 在本地
    it('should send message locally when target agent is local', async () => {
      // Setup: 注册发送方和目标 Agent
      const fromAgentId = 'agent:local1234:abcd';
      const toAgentId = 'agent:target1234:efgh';
      
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId, 'Sender Agent'));
      agentRegistry.register(toAgentId, createAgentRegistration(toAgentId, 'Target Agent'));
      
      // Ensure MessageRouter's agentRegistry also has these agents
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      agentsMap.set(toAgentId, agentRegistry.get(toAgentId)!);
      
      // Execute: 发送消息
      const result = await messageService.sendMessage(
        fromAgentId,
        toAgentId,
        'hello world'
      );
      
      // Verify: 检查发送成功
      expect(result.success).toBe(true);
      
      // Verify: 检查消息结构 - messageId 格式、fromAgentId、toAgentId
      expect(lastRoutedMessage).not.toBeNull();
      expect(lastRoutedMessage!.messageId).toMatch(/^msg-/);
      expect(lastRoutedMessage!.fromAgentId).toBe(fromAgentId);
      expect(lastRoutedMessage!.toAgentId).toBe(toAgentId);
      
      // Verify: 本地路由被调用，远程路由未被调用
      expect(messageRouter.getRoutedMessages().length).toBe(1);
      expect(messageRouter.getRemoteRoutedMessages().length).toBe(0);
    });

    // 正常路径 2: 远程路由 - 目标 Agent 不在本地
    it('should send message remotely when target agent is not local', async () => {
      // Setup: 注册发送方 Agent（本地），目标 Agent 不在本地注册表
      const fromAgentId = 'agent:local1234:abcd';
      const remoteToAgentId = 'agent:remote1234:xyz1'; // 远程 Agent ID
      
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId, 'Sender Agent'));
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      
      // 目标 Agent 不在本地注册表（只有发送方）
      // 添加一个远程 peer
      p2pNetwork.addPeer('remote123400000000'); // PeerId 前缀匹配
      
      // Execute: 发送消息
      const result = await messageService.sendMessage(
        fromAgentId,
        remoteToAgentId,
        'remote message'
      );
      
      // Verify: 检查发送成功（假设 routeRemote 成功）
      expect(result.success).toBe(true);
      
      // Verify: 远程路由被调用
      expect(messageRouter.getRemoteRoutedMessages().length).toBe(1);
      expect(messageRouter.getRoutedMessages().length).toBe(0); // 本地路由未调用
    });

    // 正常路径 3: 字符串内容处理
    it('should handle string content', async () => {
      const fromAgentId = 'agent:local1234:abcd';
      const toAgentId = 'agent:target1234:efgh';
      const stringContent = 'hello world string';
      
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId));
      agentRegistry.register(toAgentId, createAgentRegistration(toAgentId));
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      agentsMap.set(toAgentId, agentRegistry.get(toAgentId)!);
      
      const result = await messageService.sendMessage(
        fromAgentId,
        toAgentId,
        stringContent
      );
      
      expect(result.success).toBe(true);
      expect(lastRoutedMessage).not.toBeNull();
      expect(lastRoutedMessage!.content).toBe(stringContent);
      expect(typeof lastRoutedMessage!.content).toBe('string');
    });

    // 边界情况: 对象内容转 JSON
    it('should handle object content by stringify', async () => {
      const fromAgentId = 'agent:local1234:abcd';
      const toAgentId = 'agent:target1234:efgh';
      const objectContent = { key: 'value', number: 42, nested: { deep: true } };
      const expectedJson = JSON.stringify(objectContent);
      
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId));
      agentRegistry.register(toAgentId, createAgentRegistration(toAgentId));
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      agentsMap.set(toAgentId, agentRegistry.get(toAgentId)!);
      
      const result = await messageService.sendMessage(
        fromAgentId,
        toAgentId,
        objectContent
      );
      
      expect(result.success).toBe(true);
      expect(lastRoutedMessage).not.toBeNull();
      expect(lastRoutedMessage!.content).toBe(expectedJson);
      
      // Verify: 可以解析回原始对象
      const parsedContent = JSON.parse(lastRoutedMessage!.content);
      expect(parsedContent).toEqual(objectContent);
    });

    // 错误路径 1: MessageRouter 未初始化
    it('should return error when MessageRouter not initialized', async () => {
      // Setup: 创建没有 MessageRouter 的 MessageService
      const serviceWithoutRouter = new MessageService(
        {
          p2pNetwork: p2pNetwork as unknown as P2PNetwork,
          // messageRouter 未提供
          agentRegistry: agentRegistry as unknown as AgentRegistry,
        },
        eventEmitter
      );
      
      const result = await serviceWithoutRouter.sendMessage(
        'agent:local1234:abcd',
        'agent:target1234:efgh',
        'test message'
      );
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.message).toContain('MessageRouter not initialized');
    });

    // 错误路径 2: AgentRegistry 未初始化
    it('should return error when AgentRegistry not initialized', async () => {
      // Setup: 创建没有 AgentRegistry 的 MessageService
      const serviceWithoutRegistry = new MessageService(
        {
          p2pNetwork: p2pNetwork as unknown as P2PNetwork,
          messageRouter: messageRouter as unknown as MessageRouter,
          // agentRegistry 未提供
        },
        eventEmitter
      );
      
      const result = await serviceWithoutRegistry.sendMessage(
        'agent:local1234:abcd',
        'agent:target1234:efgh',
        'test message'
      );
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
      expect(result.error?.message).toContain('AgentRegistry not initialized');
    });

    // 附加测试: 验证 messageId 的 UUID 格式
    it('should generate unique messageId with msg- prefix', async () => {
      const fromAgentId = 'agent:local1234:abcd';
      const toAgentId = 'agent:target1234:efgh';
      
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId));
      agentRegistry.register(toAgentId, createAgentRegistration(toAgentId));
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      agentsMap.set(toAgentId, agentRegistry.get(toAgentId)!);
      
      // 发送多条消息，验证每条消息有唯一的 ID
      const results = await Promise.all([
        messageService.sendMessage(fromAgentId, toAgentId, 'msg1'),
        messageService.sendMessage(fromAgentId, toAgentId, 'msg2'),
        messageService.sendMessage(fromAgentId, toAgentId, 'msg3'),
      ]);
      
      const messageIds = results.map((r, i) => {
        expect(r.success).toBe(true);
        return messageRouter.getRoutedMessages()[i]?.messageId;
      });
      
      // 所有 messageId 格式正确
      messageIds.forEach(id => {
        expect(id).toMatch(/^msg-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      });
      
      // 所有 messageId 唯一
      const uniqueIds = new Set(messageIds);
      expect(uniqueIds.size).toBe(messageIds.length);
    });

    // 附加测试: 验证 metadata 和 type 传递
    it('should pass metadata and type options correctly', async () => {
      const fromAgentId = 'agent:local1234:abcd';
      const toAgentId = 'agent:target1234:efgh';
      const options: SendMessageOptions = {
        type: 'task_request',
        metadata: { priority: 'high', taskId: 'task-123' },
      };
      
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId));
      agentRegistry.register(toAgentId, createAgentRegistration(toAgentId));
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      agentsMap.set(toAgentId, agentRegistry.get(toAgentId)!);
      
      const result = await messageService.sendMessage(
        fromAgentId,
        toAgentId,
        'task content',
        options
      );
      
      expect(result.success).toBe(true);
      expect(lastRoutedMessage).not.toBeNull();
      expect(lastRoutedMessage!.type).toBe('task_request');
      expect(lastRoutedMessage!.metadata).toEqual({ priority: 'high', taskId: 'task-123' });
    });
  });

  describe('handleFreeMessage', () => {
    // 状态验证: 检查事件是否被发出
    it('should emit message:received event', async () => {
      const fromPeerId = 'remote-peer-id-12345678';
      const messageId = 'msg-test-123';
      const content = 'free message content';
      const topic = 'chat';
      
      // 监听事件
      let eventEmitted = false;
      let emittedEventData: unknown = null;
      
      eventEmitter.on('peer:message', (event) => {
        eventEmitted = true;
        emittedEventData = event;
      });
      
      // Execute: 处理自由消息
      await messageService.handleFreeMessage(fromPeerId, messageId, content, topic);
      
      // Verify: 事件被发出
      expect(eventEmitted).toBe(true);
      
      // Verify: 事件数据正确
      expect(emittedEventData).not.toBeNull();
      const eventData = emittedEventData as { messageId: string; from: string; content: string; topic: string };
      expect(eventData.messageId).toBe(messageId);
      expect(eventData.from).toBe(fromPeerId);
      expect(eventData.content).toBe(content);
      expect(eventData.topic).toBe(topic);
    });

    // 状态验证: 检查对象内容的事件
    it('should emit peer:message event with object content', async () => {
      const fromPeerId = 'remote-peer-id-12345678';
      const messageId = 'msg-test-456';
      const objectContent = { action: 'query', data: { items: [1, 2, 3] } };
      
      let eventEmitted = false;
      let emittedContent: unknown = null;
      
      eventEmitter.on('peer:message', (event) => {
        eventEmitted = true;
        emittedContent = event.content;
      });
      
      await messageService.handleFreeMessage(fromPeerId, messageId, objectContent);
      
      expect(eventEmitted).toBe(true);
      expect(emittedContent).toEqual(objectContent);
    });

    // 边界情况: 没有 topic 参数
    it('should handle free message without topic', async () => {
      const fromPeerId = 'remote-peer-id-12345678';
      const messageId = 'msg-test-789';
      const content = 'message without topic';
      
      let eventEmitted = false;
      let emittedTopic: string | undefined;
      
      eventEmitter.on('peer:message', (event) => {
        eventEmitted = true;
        emittedTopic = event.topic;
      });
      
      await messageService.handleFreeMessage(fromPeerId, messageId, content);
      
      expect(eventEmitted).toBe(true);
      expect(emittedTopic).toBeUndefined();
    });
  });

  describe('setMessageRouter', () => {
    it('should set MessageRouter after construction', async () => {
      // Setup: 创建没有 MessageRouter 的服务
      const serviceWithoutRouter = new MessageService(
        {
          p2pNetwork: p2pNetwork as unknown as P2PNetwork,
          agentRegistry: agentRegistry as unknown as AgentRegistry,
        },
        eventEmitter
      );
      
      // 先尝试发送，应该失败
      const resultBefore = await serviceWithoutRouter.sendMessage(
        'agent:local:abcd',
        'agent:target:efgh',
        'test'
      );
      expect(resultBefore.success).toBe(false);
      
      // 设置 MessageRouter
      serviceWithoutRouter.setMessageRouter(messageRouter as unknown as MessageRouter);
      
      // Setup agents for routing
      const fromAgentId = 'agent:local1234:abcd';
      const toAgentId = 'agent:target1234:efgh';
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId));
      agentRegistry.register(toAgentId, createAgentRegistration(toAgentId));
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      agentsMap.set(toAgentId, agentRegistry.get(toAgentId)!);
      
      // 再次发送，应该成功
      const resultAfter = await serviceWithoutRouter.sendMessage(
        fromAgentId,
        toAgentId,
        'test after router set'
      );
      expect(resultAfter.success).toBe(true);
    });
  });

  describe('setAgentRegistry', () => {
    it('should set AgentRegistry after construction', async () => {
      // Setup: 创建没有 AgentRegistry 的服务
      const serviceWithoutRegistry = new MessageService(
        {
          p2pNetwork: p2pNetwork as unknown as P2PNetwork,
          messageRouter: messageRouter as unknown as MessageRouter,
        },
        eventEmitter
      );
      
      // 先尝试发送，应该失败
      const resultBefore = await serviceWithoutRegistry.sendMessage(
        'agent:local:abcd',
        'agent:target:efgh',
        'test'
      );
      expect(resultBefore.success).toBe(false);
      expect(resultBefore.error?.message).toContain('AgentRegistry not initialized');
      
      // 设置 AgentRegistry
      serviceWithoutRegistry.setAgentRegistry(agentRegistry as unknown as AgentRegistry);
      
      // Setup agents for routing
      const fromAgentId = 'agent:local1234:abcd';
      const toAgentId = 'agent:target1234:efgh';
      agentRegistry.register(fromAgentId, createAgentRegistration(fromAgentId));
      agentRegistry.register(toAgentId, createAgentRegistration(toAgentId));
      agentsMap.set(fromAgentId, agentRegistry.get(fromAgentId)!);
      agentsMap.set(toAgentId, agentRegistry.get(toAgentId)!);
      
      // 再次发送，应该成功
      const resultAfter = await serviceWithoutRegistry.sendMessage(
        fromAgentId,
        toAgentId,
        'test after registry set'
      );
      expect(resultAfter.success).toBe(true);
    });
  });
});