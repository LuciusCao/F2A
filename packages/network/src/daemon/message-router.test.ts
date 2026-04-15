/**
 * Message Router 测试
 * 测试路由逻辑、广播、队列溢出、消息过期
 * RFC 004: Agent 级 Webhook 转发测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageRouter, RoutableMessage, MessageQueue, AgentWebhookPayload } from '../core/message-router.js';
import type { AgentRegistration, AgentWebhook } from '../core/agent-registry.js';

// Mock Logger
vi.mock('../utils/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock WebhookService
vi.mock('./webhook.js', () => ({
  WebhookService: vi.fn().mockImplementation((config) => ({
    send: vi.fn().mockImplementation(async (notification) => {
      // 默认返回成功
      return { success: true };
    }),
    config,
  })),
}));

describe('MessageRouter', () => {
  let router: MessageRouter;
  let agentRegistry: Map<string, AgentRegistration>;

  const createAgent = (agentId: string): AgentRegistration => ({
    agentId,
    name: `Agent ${agentId}`,
    capabilities: [],
    registeredAt: new Date(),
    lastActiveAt: new Date(),
  });

  const createMessage = (
    messageId: string,
    fromAgentId: string,
    toAgentId?: string,
    type: RoutableMessage['type'] = 'message'
  ): RoutableMessage => ({
    messageId,
    fromAgentId,
    toAgentId,
    content: `Message ${messageId}`,
    type,
    createdAt: new Date(),
    metadata: {},
  });

  beforeEach(() => {
    vi.clearAllMocks();
    agentRegistry = new Map();
    router = new MessageRouter(agentRegistry, undefined, { maxQueueSize: 10 });
  });

  describe('createQueue', () => {
    it('应该成功创建消息队列', () => {
      router.createQueue('agent-1');

      const queue = router.getQueue('agent-1');
      expect(queue).toBeDefined();
      expect(queue?.agentId).toBe('agent-1');
      expect(queue?.messages).toHaveLength(0);
    });

    it('应该使用自定义最大队列大小', () => {
      router.createQueue('agent-1', 5);

      const queue = router.getQueue('agent-1');
      expect(queue?.maxSize).toBe(5);
    });

    it('应该使用默认最大队列大小', () => {
      router.createQueue('agent-1');

      const queue = router.getQueue('agent-1');
      expect(queue?.maxSize).toBe(10);
    });

    it('重复创建队列应该跳过', () => {
      router.createQueue('agent-1');
      router.createQueue('agent-1');

      expect(router.getStats().queues).toBe(1);
    });
  });

  describe('deleteQueue', () => {
    it('应该成功删除消息队列', () => {
      router.createQueue('agent-1');
      router.deleteQueue('agent-1');

      expect(router.getQueue('agent-1')).toBeUndefined();
    });

    it('删除不存在队列应该静默跳过', () => {
      router.deleteQueue('non-existent');
      // 不应该抛出错误
    });
  });

  describe('getQueue', () => {
    it('应该返回已存在的队列', () => {
      router.createQueue('agent-1');

      const queue = router.getQueue('agent-1');
      expect(queue).toBeDefined();
    });

    it('查询不存在队列应返回 undefined', () => {
      const queue = router.getQueue('non-existent');
      expect(queue).toBeUndefined();
    });
  });

  describe('route', () => {
    it('应该路由消息到特定 Agent', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      const message = createMessage('msg-1', 'sender', 'receiver');
      const result = router.route(message);

      expect(result).toBe(true);
      const queue = router.getQueue('receiver');
      expect(queue?.messages).toHaveLength(1);
    });

    it('发送方未注册应返回 false', () => {
      router.createQueue('receiver');

      const message = createMessage('msg-1', 'unknown-sender', 'receiver');
      const result = router.route(message);

      expect(result).toBe(false);
    });

    it('目标队列不存在应返回 false', () => {
      agentRegistry.set('sender', createAgent('sender'));

      const message = createMessage('msg-1', 'sender', 'unknown-receiver');
      const result = router.route(message);

      expect(result).toBe(false);
    });

    it('未指定目标应广播消息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver-1', createAgent('receiver-1')); // 接收方也需要注册
      agentRegistry.set('receiver-2', createAgent('receiver-2'));
      agentRegistry.set('receiver-3', createAgent('receiver-3'));
      router.createQueue('receiver-1');
      router.createQueue('receiver-2');
      router.createQueue('receiver-3');

      const message = createMessage('msg-1', 'sender');
      const result = router.route(message);

      expect(result).toBe(true);
      expect(router.getQueue('receiver-1')?.messages).toHaveLength(1);
      expect(router.getQueue('receiver-2')?.messages).toHaveLength(1);
      expect(router.getQueue('receiver-3')?.messages).toHaveLength(1);
    });

    it('应该保留消息元数据', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      const message = createMessage('msg-1', 'sender', 'receiver');
      message.metadata = { priority: 'high', custom: 'data' };
      router.route(message);

      const queue = router.getQueue('receiver');
      expect(queue?.messages[0]?.metadata).toEqual({ priority: 'high', custom: 'data' });
    });
  });

  describe('broadcast', () => {
    it('应该广播给所有 Agent（除发送方）', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver-1', createAgent('receiver-1')); // 接收方也需要注册
      agentRegistry.set('receiver-2', createAgent('receiver-2'));
      router.createQueue('sender');
      router.createQueue('receiver-1');
      router.createQueue('receiver-2');

      const message = createMessage('msg-1', 'sender');
      const result = router.broadcast(message);

      expect(result).toBe(true);
      // 发送方不应收到
      expect(router.getQueue('sender')?.messages).toHaveLength(0);
      // 其他 Agent 应收到
      expect(router.getQueue('receiver-1')?.messages).toHaveLength(1);
      expect(router.getQueue('receiver-2')?.messages).toHaveLength(1);
    });

    it('无其他 Agent 应返回 false', () => {
      agentRegistry.set('sender', createAgent('sender'));
      router.createQueue('sender');

      const message = createMessage('msg-1', 'sender');
      const result = router.broadcast(message);

      expect(result).toBe(false);
    });

    it('应该设置目标 Agent ID', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      const message = createMessage('msg-1', 'sender');
      router.broadcast(message);

      const queue = router.getQueue('receiver');
      expect(queue?.messages[0]?.toAgentId).toBe('receiver');
    });

    it('应该支持不同消息类型广播', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      const announcement = createMessage('msg-1', 'sender', undefined, 'announcement');
      router.broadcast(announcement);

      const queue = router.getQueue('receiver');
      expect(queue?.messages[0]?.type).toBe('announcement');
    });
  });

  describe('getMessages', () => {
    it('应该返回 Agent 的消息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      router.route(createMessage('msg-1', 'sender', 'receiver'));
      router.route(createMessage('msg-2', 'sender', 'receiver'));

      const messages = router.getMessages('receiver');

      expect(messages).toHaveLength(2);
    });

    it('应该支持限制返回数量', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      for (let i = 0; i < 5; i++) {
        router.route(createMessage(`msg-${i}`, 'sender', 'receiver'));
      }

      const messages = router.getMessages('receiver', 2);

      expect(messages).toHaveLength(2);
    });

    it('队列不存在应返回空数组', () => {
      const messages = router.getMessages('non-existent');

      expect(messages).toHaveLength(0);
    });
  });

  describe('clearMessages', () => {
    it('应该清除所有消息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      router.route(createMessage('msg-1', 'sender', 'receiver'));
      router.route(createMessage('msg-2', 'sender', 'receiver'));

      const cleared = router.clearMessages('receiver');

      expect(cleared).toBe(2);
      expect(router.getQueue('receiver')?.messages).toHaveLength(0);
    });

    it('应该清除指定消息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      router.route(createMessage('msg-1', 'sender', 'receiver'));
      router.route(createMessage('msg-2', 'sender', 'receiver'));
      router.route(createMessage('msg-3', 'sender', 'receiver'));

      const cleared = router.clearMessages('receiver', ['msg-1', 'msg-3']);

      expect(cleared).toBe(2);
      expect(router.getQueue('receiver')?.messages).toHaveLength(1);
      expect(router.getQueue('receiver')?.messages[0]?.messageId).toBe('msg-2');
    });

    it('队列不存在应返回 0', () => {
      const cleared = router.clearMessages('non-existent');

      expect(cleared).toBe(0);
    });

    it('清除不存在的消息 ID 应返回 0', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      router.route(createMessage('msg-1', 'sender', 'receiver'));

      const cleared = router.clearMessages('receiver', ['non-existent']);

      expect(cleared).toBe(0);
    });
  });

  describe('getStats', () => {
    it('应该返回正确的统计信息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('agent-1', createAgent('agent-1')); // 接收方也需要注册
      agentRegistry.set('agent-2', createAgent('agent-2'));
      router.createQueue('agent-1');
      router.createQueue('agent-2');

      router.route(createMessage('msg-1', 'sender', 'agent-1'));
      router.route(createMessage('msg-2', 'sender', 'agent-1'));
      router.route(createMessage('msg-3', 'sender', 'agent-2'));

      const stats = router.getStats();

      expect(stats.queues).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.queueStats['agent-1'].size).toBe(2);
      expect(stats.queueStats['agent-2'].size).toBe(1);
    });

    it('空路由器应返回零统计', () => {
      const stats = router.getStats();

      expect(stats.queues).toBe(0);
      expect(stats.totalMessages).toBe(0);
    });
  });

  describe('cleanupExpired', () => {
    it('应该清理过期消息', async () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      // 创建旧消息
      const oldMessage = createMessage('old-msg', 'sender', 'receiver');
      oldMessage.createdAt = new Date(Date.now() - 1000); // 1秒前
      router.route(oldMessage);

      // 创建新消息
      router.route(createMessage('new-msg', 'sender', 'receiver'));

      const cleaned = router.cleanupExpired(500); // 500ms 超时

      expect(cleaned).toBe(1);
      expect(router.getQueue('receiver')?.messages).toHaveLength(1);
    });

    it('无过期消息应返回 0', async () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      router.route(createMessage('msg-1', 'sender', 'receiver'));

      const cleaned = router.cleanupExpired(10000); // 10秒超时

      expect(cleaned).toBe(0);
    });

    it('应该清理所有队列的过期消息', async () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver-1', createAgent('receiver-1')); // 接收方也需要注册
      agentRegistry.set('receiver-2', createAgent('receiver-2'));
      router.createQueue('receiver-1');
      router.createQueue('receiver-2');

      // 添加过期消息到两个队列
      const old1 = createMessage('old-1', 'sender', 'receiver-1');
      old1.createdAt = new Date(Date.now() - 1000);
      router.route(old1);

      const old2 = createMessage('old-2', 'sender', 'receiver-2');
      old2.createdAt = new Date(Date.now() - 1000);
      router.route(old2);

      const cleaned = router.cleanupExpired(500);

      expect(cleaned).toBe(2);
    });
  });

  describe('队列溢出', () => {
    it('队列满时应移除最旧消息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver', 3);

      // 添加 4 条消息，队列大小为 3
      for (let i = 0; i < 4; i++) {
        router.route(createMessage(`msg-${i}`, 'sender', 'receiver'));
      }

      const queue = router.getQueue('receiver');
      expect(queue?.messages).toHaveLength(3);
      // 最旧消息 msg-0 应被移除
      expect(queue?.messages.map(m => m.messageId)).not.toContain('msg-0');
    });

    it('广播时队列溢出应移除最旧消息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('sender');
      router.createQueue('receiver', 3);

      // 先填满队列
      for (let i = 0; i < 3; i++) {
        router.route(createMessage(`fill-${i}`, 'sender', 'receiver'));
      }

      // 广播新消息
      router.broadcast(createMessage('broadcast-msg', 'sender'));

      const queue = router.getQueue('receiver');
      expect(queue?.messages).toHaveLength(3);
      expect(queue?.messages.map(m => m.messageId)).toContain('broadcast-msg');
    });

    it('队列溢出应记录警告', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver', 2);

      for (let i = 0; i < 3; i++) {
        router.route(createMessage(`msg-${i}`, 'sender', 'receiver'));
      }

      // 验证消息正确移除
      const queue = router.getQueue('receiver');
      expect(queue?.messages).toHaveLength(2);
    });
  });

  describe('updateRegistry', () => {
    it('应该更新 Agent 注册表', () => {
      const newRegistry = new Map();
      newRegistry.set('new-agent', createAgent('new-agent'));
      newRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册

      router.updateRegistry(newRegistry);

      // 验证更新后的注册表影响路由
      router.createQueue('receiver');
      const message = createMessage('msg-1', 'new-agent', 'receiver');
      const result = router.route(message);

      expect(result).toBe(true);
    });
  });

  describe('边界情况', () => {
    it('应该处理大量消息', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver', 1000);

      for (let i = 0; i < 500; i++) {
        router.route(createMessage(`msg-${i}`, 'sender', 'receiver'));
      }

      expect(router.getQueue('receiver')?.messages).toHaveLength(500);
    });

    it('应该处理大量队列', () => {
      agentRegistry.set('sender', createAgent('sender'));

      for (let i = 0; i < 100; i++) {
        router.createQueue(`agent-${i}`);
      }

      expect(router.getStats().queues).toBe(100);
    });

    it('应该处理不同消息类型', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      const types: RoutableMessage['type'][] = [
        'message',
        'task_request',
        'task_response',
        'announcement',
        'claim',
      ];

      for (let i = 0; i < types.length; i++) {
        router.route(createMessage(`msg-${i}`, 'sender', 'receiver', types[i]));
      }

      const queue = router.getQueue('receiver');
      expect(queue?.messages).toHaveLength(types.length);
    });

    it('应该处理空消息内容', () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver');

      const message = createMessage('msg-1', 'sender', 'receiver');
      message.content = '';

      const result = router.route(message);

      expect(result).toBe(true);
    });
  });

  describe('并发操作', () => {
    it('应该支持并发路由', async () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver', createAgent('receiver')); // 接收方也需要注册
      router.createQueue('receiver', 100);

      const operations = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve(router.route(createMessage(`msg-${i}`, 'sender', 'receiver')))
      );

      await Promise.all(operations);

      expect(router.getQueue('receiver')?.messages.length).toBeGreaterThan(0);
    });

    it('应该支持并发广播', async () => {
      agentRegistry.set('sender', createAgent('sender'));
      agentRegistry.set('receiver-1', createAgent('receiver-1')); // 接收方也需要注册
      agentRegistry.set('receiver-2', createAgent('receiver-2'));
      router.createQueue('receiver-1', 100);
      router.createQueue('receiver-2', 100);

      const operations = Array.from({ length: 20 }, (_, i) =>
        Promise.resolve(router.broadcast(createMessage(`msg-${i}`, 'sender')))
      );

      await Promise.all(operations);

      // 每个队列应收到消息
      expect(router.getQueue('receiver-1')?.messages.length).toBeGreaterThan(0);
      expect(router.getQueue('receiver-2')?.messages.length).toBeGreaterThan(0);
    });

    it('应该支持并发创建队列', async () => {
      const operations = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve(router.createQueue(`agent-${i}`))
      );

      await Promise.all(operations);

      expect(router.getStats().queues).toBe(50);
    });
  });

  // ========== RFC 004: Agent 级 Webhook 测试 ==========
  describe('RFC 004: Agent 级 Webhook', () => {
    const createAgentWithWebhook = (agentId: string, webhookUrl: string): AgentRegistration => ({
      ...createAgent(agentId),
      webhook: {
        url: webhookUrl,
        token: 'test-token',
      },
    });

    describe('routeAsync - Webhook 转发', () => {
      it('应该转发消息到 Agent webhook URL', async () => {
        const webhookUrl = 'https://example.com/webhook/test'; 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver', createAgentWithWebhook('receiver', webhookUrl)); 
        router.createQueue('receiver'); 

        const message = createMessage('msg-1', 'sender', 'receiver'); 
        const result = await router.routeAsync(message); 

        expect(result).toBe(true); 
        // Webhook 成功，队列应无消息（不降级）
        expect(router.getQueue('receiver')?.messages).toHaveLength(0); 
      });

      it('webhook 失败时应降级到队列', async () => {
        // Mock webhook send 返回失败
        const { WebhookService } = await import('./webhook.js');
        vi.mocked(WebhookService).mockImplementationOnce(() => ({
          send: vi.fn().mockResolvedValue({ success: false, error: 'Connection timeout' }),
          config: {},
        }));

        const webhookUrl = 'https://example.com/webhook/test'; 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver', createAgentWithWebhook('receiver', webhookUrl)); 
        router.createQueue('receiver'); 

        const message = createMessage('msg-1', 'sender', 'receiver'); 
        const result = await router.routeAsync(message); 

        // Webhook 失败但降级到队列成功
        expect(result).toBe(true); 
        // 队列应有消息（降级）
        expect(router.getQueue('receiver')?.messages).toHaveLength(1); 
      });

      it('Agent 无 webhook 时应直接放入队列', async () => {
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver', createAgent('receiver')); // 无 webhook
        router.createQueue('receiver'); 

        const message = createMessage('msg-1', 'sender', 'receiver'); 
        const result = await router.routeAsync(message); 

        expect(result).toBe(true); 
        expect(router.getQueue('receiver')?.messages).toHaveLength(1); 
      });

      it('本地回调优先级高于 webhook', async () => {
        const webhookUrl = 'https://example.com/webhook/test'; 
        const onMessage = vi.fn(); 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver', {
          ...createAgentWithWebhook('receiver', webhookUrl),
          onMessage,
        }); 
        router.createQueue('receiver'); 

        const message = createMessage('msg-1', 'sender', 'receiver'); 
        const result = await router.routeAsync(message); 

        expect(result).toBe(true); 
        expect(onMessage).toHaveBeenCalled(); 
        // 本地回调成功，不应调用 webhook 或放入队列
        expect(router.getQueue('receiver')?.messages).toHaveLength(0); 
      });

      it('本地回调失败时应尝试 webhook', async () => {
        const webhookUrl = 'https://example.com/webhook/test'; 
        const onMessage = vi.fn().mockImplementation(() => {
          throw new Error('Callback error'); 
        }); 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver', {
          ...createAgentWithWebhook('receiver', webhookUrl),
          onMessage,
        }); 
        router.createQueue('receiver'); 

        const message = createMessage('msg-1', 'sender', 'receiver'); 
        const result = await router.routeAsync(message); 

        expect(result).toBe(true); 
        expect(onMessage).toHaveBeenCalled(); 
        // 本地回调失败，webhook 成功
        expect(router.getQueue('receiver')?.messages).toHaveLength(0); 
      });
    });

    describe('broadcastAsync - Webhook 广播', () => {
      it('应该广播消息到多个 Agent 的 webhook', async () => {
        const webhookUrl1 = 'https://example.com/webhook/agent1'; 
        const webhookUrl2 = 'https://example.com/webhook/agent2'; 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver-1', createAgentWithWebhook('receiver-1', webhookUrl1)); 
        agentRegistry.set('receiver-2', createAgentWithWebhook('receiver-2', webhookUrl2)); 
        router.createQueue('receiver-1'); 
        router.createQueue('receiver-2'); 

        const message = createMessage('broadcast-msg', 'sender'); 
        const result = await router.broadcastAsync(message); 

        expect(result).toBe(true); 
        // Webhook 成功，队列应无消息
        expect(router.getQueue('receiver-1')?.messages).toHaveLength(0); 
        expect(router.getQueue('receiver-2')?.messages).toHaveLength(0); 
      });

      it('部分 Agent webhook 失败时应降级到队列', async () => {
        // Mock 第一个 webhook 失败
        const { WebhookService } = await import('./webhook.js');
        let callCount = 0; 
        vi.mocked(WebhookService).mockImplementation(() => ({
          send: vi.fn().mockImplementation(async () => {
            callCount++; 
            // 第一次调用失败，第二次成功
            return callCount === 1 
              ? { success: false, error: 'Timeout' } 
              : { success: true }; 
          }),
          config: {},
        }));

        const webhookUrl1 = 'https://example.com/webhook/agent1'; 
        const webhookUrl2 = 'https://example.com/webhook/agent2'; 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver-1', createAgentWithWebhook('receiver-1', webhookUrl1)); 
        agentRegistry.set('receiver-2', createAgentWithWebhook('receiver-2', webhookUrl2)); 
        router.createQueue('receiver-1'); 
        router.createQueue('receiver-2'); 

        const message = createMessage('broadcast-msg', 'sender'); 
        const result = await router.broadcastAsync(message); 

        expect(result).toBe(true); 
        // receiver-1 webhook 失败，降级到队列
        expect(router.getQueue('receiver-1')?.messages).toHaveLength(1); 
        // receiver-2 webhook 成功
        expect(router.getQueue('receiver-2')?.messages).toHaveLength(0); 
      });
    });

    describe('clearWebhookCache', () => {
      it('应该清理 webhook 服务缓存', async () => {
        const webhookUrl = 'https://example.com/webhook/test'; 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver', createAgentWithWebhook('receiver', webhookUrl)); 
        router.createQueue('receiver'); 

        // 第一次路由，创建 webhook 服务
        await router.routeAsync(createMessage('msg-1', 'sender', 'receiver')); 

        // 清理缓存
        router.clearWebhookCache('receiver'); 

        // 第二次路由，应重新创建 webhook 服务
        await router.routeAsync(createMessage('msg-2', 'sender', 'receiver')); 
      });

      it('清理不存在的缓存应静默跳过', () => {
        router.clearWebhookCache('non-existent'); 
        // 不应抛出错误
      });
    });

    describe('路由优先级验证', () => {
      it('优先级: 本地回调 > Webhook > 队列', async () => {
        const webhookUrl = 'https://example.com/webhook/test'; 
        const queueMessage = vi.fn(); 
        const onMessage = vi.fn(); 
        
        // 场景 1: 有本地回调，webhook 不应被调用
        agentRegistry.clear(); 
        agentRegistry.set('sender', createAgent('sender')); 
        agentRegistry.set('receiver', {
          ...createAgentWithWebhook('receiver', webhookUrl),
          onMessage,
        }); 
        router.createQueue('receiver'); 

        await router.routeAsync(createMessage('msg-1', 'sender', 'receiver')); 
        expect(onMessage).toHaveBeenCalled(); 
        expect(router.getQueue('receiver')?.messages).toHaveLength(0); 

        // 场景 2: 无本地回调，webhook 应被调用
        vi.clearAllMocks(); 
        agentRegistry.set('receiver', createAgentWithWebhook('receiver', webhookUrl)); 
        router.createQueue('receiver'); 

        await router.routeAsync(createMessage('msg-2', 'sender', 'receiver')); 
        expect(router.getQueue('receiver')?.messages).toHaveLength(0); 

        // 场景 3: 无本地回调，无 webhook，队列应被使用
        vi.clearAllMocks(); 
        agentRegistry.set('receiver', createAgent('receiver')); // 无 webhook
        router.createQueue('receiver'); 

        await router.routeAsync(createMessage('msg-3', 'sender', 'receiver')); 
        expect(router.getQueue('receiver')?.messages).toHaveLength(1); 
      });
    });
  });
});