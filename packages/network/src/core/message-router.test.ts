/**
 * MessageRouter 测试 - QueueManager 路由支持
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QueueManager } from './queue-manager.js';
import { Logger } from '../utils/logger.js';
import type { RoutableMessage } from './message-router.js';

function createMockLogger(): Logger {
  return new Logger({ component: 'QueueManager-test' });
}

function createMessage(overrides: Partial<RoutableMessage> = {}): RoutableMessage {
  return {
    messageId: `msg-${Date.now()}`,
    fromAgentId: 'agent:sender',
    toAgentId: 'agent:receiver',
    content: 'test content',
    type: 'message',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('QueueManager - Message Routing Support', () => {
  let queueManager: QueueManager;

  beforeEach(() => {
    queueManager = new QueueManager({
      logger: createMockLogger(),
      defaultMaxQueueSize: 100
    });
  });

  describe('queue creation for routing', () => {
    it('should create queue for new agent', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      expect(queue).toBeDefined();
      expect(queue?.agentId).toBe('agent:receiver');
      expect(queue?.messages).toEqual([]);
      expect(queue?.maxSize).toBe(100);
    });

    it('should create queue with custom max size', () => {
      queueManager.createQueue('agent:receiver', 50);
      const queue = queueManager.getQueue('agent:receiver');
      expect(queue?.maxSize).toBe(50);
    });

    it('should not duplicate existing queue', () => {
      queueManager.createQueue('agent:receiver');
      queueManager.createQueue('agent:receiver');
      
      // 检查只有一个队列
      const stats = queueManager.getStats();
      expect(stats.queues).toBe(1);
    });
  });

  describe('message enqueue and dequeue', () => {
    it('should enqueue message to queue', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      expect(queue).toBeDefined();
      
      queueManager.enqueue(queue!, createMessage({ content: 'test message' }));
      
      expect(queue?.messages.length).toBe(1);
      expect(queue?.messages[0].content).toBe('test message');
    });

    it('should handle multiple messages', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-1' }));
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-2' }));
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-3' }));
      
      expect(queue?.messages.length).toBe(3);
      expect(queue?.messages[0].messageId).toBe('msg-1');
      expect(queue?.messages[2].messageId).toBe('msg-3');
    });

    it('should pop message from queue', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-1' }));
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-2' }));
      
      const popped = queueManager.popMessage('agent:receiver');
      expect(popped?.messageId).toBe('msg-1');
      
      const queueAfter = queueManager.getQueue('agent:receiver');
      expect(queueAfter?.messages.length).toBe(1);
      expect(queueAfter?.messages[0].messageId).toBe('msg-2');
    });

    it('should poll all messages without removing', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      
      queueManager.enqueue(queue!, createMessage());
      queueManager.enqueue(queue!, createMessage());
      
      const messages = queueManager.pollQueue('agent:receiver');
      expect(messages.length).toBe(2);
      
      // pollQueue 不移除消息
      const queueAfter = queueManager.getQueue('agent:receiver');
      expect(queueAfter?.messages.length).toBe(2);
    });
  });

  describe('queue statistics', () => {
    it('should return correct stats', () => {
      queueManager.createQueue('agent:a');
      queueManager.createQueue('agent:b');
      
      const queueA = queueManager.getQueue('agent:a');
      const queueB = queueManager.getQueue('agent:b');
      
      queueManager.enqueue(queueA!, createMessage());
      queueManager.enqueue(queueA!, createMessage());
      queueManager.enqueue(queueB!, createMessage());
      
      const stats = queueManager.getStats();
      expect(stats.queues).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.queueStats['agent:a'].size).toBe(2);
      expect(stats.queueStats['agent:b'].size).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      
      queueManager.enqueue(queue!, createMessage({ content: '' }));
      
      expect(queue?.messages[0].content).toBe('');
    });

    it('should handle large content', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      
      const largeContent = 'x'.repeat(10000);
      queueManager.enqueue(queue!, createMessage({ content: largeContent }));
      
      expect(queue?.messages[0].content.length).toBe(10000);
    });

    it('should handle special characters', () => {
      queueManager.createQueue('agent:receiver');
      const queue = queueManager.getQueue('agent:receiver');
      
      const specialContent = '你好世界 🌍 <script>alert(1)</script>';
      queueManager.enqueue(queue!, createMessage({ content: specialContent }));
      
      expect(queue?.messages[0].content).toBe(specialContent);
    });

    it('should handle queue overflow', () => {
      queueManager.createQueue('agent:receiver', 3);
      const queue = queueManager.getQueue('agent:receiver');
      
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-1' }));
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-2' }));
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-3' }));
      queueManager.enqueue(queue!, createMessage({ messageId: 'msg-4' })); // overflow
      
      expect(queue?.messages.length).toBe(3);
      expect(queue?.messages[0].messageId).toBe('msg-2'); // oldest removed
      expect(queue?.messages[2].messageId).toBe('msg-4'); // newest added
    });
  });
});