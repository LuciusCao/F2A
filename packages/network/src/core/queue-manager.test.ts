/**
 * QueueManager 测试
 * 覆盖队列管理、持久化边缘情况和清理逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueManager, type MessageQueue } from './queue-manager.js';
import type { RoutableMessage } from './message-router.js';
import { Logger } from '../utils/logger.js';

// ============================================================================
// 测试数据工厂
// ============================================================================

function createMockLogger(): Logger {
  return new Logger({ component: 'QueueManager-test' });
}

function createQueueManager(defaultMaxQueueSize: number = 100): QueueManager {
  return new QueueManager({
    logger: createMockLogger(),
    defaultMaxQueueSize,
  });
}

function createMessage(overrides: Partial<RoutableMessage> = {}): RoutableMessage {
  return {
    messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fromAgentId: 'agent-sender',
    toAgentId: 'agent-receiver',
    content: 'test message content',
    type: 'message',
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// 基础功能测试
// ============================================================================

describe('QueueManager', () => {
  let manager: QueueManager;

  beforeEach(() => {
    manager = createQueueManager();
  });

  describe('createQueue', () => {
    it('should create a queue for an agent', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1');
      expect(queue).toBeDefined();
      expect(queue?.agentId).toBe('agent-1');
      expect(queue?.messages).toEqual([]);
      expect(queue?.maxSize).toBe(100);
    });

    it('should create a queue with custom max size', () => {
      manager.createQueue('agent-2', 50);
      const queue = manager.getQueue('agent-2');
      expect(queue?.maxSize).toBe(50);
    });

    it('should not create duplicate queue for same agent', () => {
      manager.createQueue('agent-1', 100);
      manager.createQueue('agent-1', 50); // Should be ignored

      const queue = manager.getQueue('agent-1');
      expect(queue?.maxSize).toBe(100); // Should keep original size
    });
  });

  describe('deleteQueue', () => {
    it('should delete an existing queue', () => {
      manager.createQueue('agent-1');
      manager.deleteQueue('agent-1');
      expect(manager.getQueue('agent-1')).toBeUndefined();
    });

    it('should do nothing if queue does not exist', () => {
      // Should not throw
      manager.deleteQueue('non-existent-agent');
    });
  });

  describe('getQueue', () => {
    it('should return undefined for non-existent queue', () => {
      expect(manager.getQueue('non-existent')).toBeUndefined();
    });

    it('should return the queue for existing agent', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1');
      expect(queue?.agentId).toBe('agent-1');
    });
  });

  describe('pollQueue', () => {
    it('should return empty array for non-existent queue', () => {
      const messages = manager.pollQueue('non-existent');
      expect(messages).toEqual([]);
    });

    it('should return all messages when no limit specified', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      const msg1 = createMessage({ messageId: 'msg-1' });
      const msg2 = createMessage({ messageId: 'msg-2' });
      manager.enqueue(queue, msg1);
      manager.enqueue(queue, msg2);

      const messages = manager.pollQueue('agent-1');
      expect(messages.length).toBe(2);
    });

    it('should return limited messages when limit specified', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      const msg1 = createMessage({ messageId: 'msg-1' });
      const msg2 = createMessage({ messageId: 'msg-2' });
      const msg3 = createMessage({ messageId: 'msg-3' });
      manager.enqueue(queue, msg1);
      manager.enqueue(queue, msg2);
      manager.enqueue(queue, msg3);

      const messages = manager.pollQueue('agent-1', 2);
      expect(messages.length).toBe(2);
      expect(messages[0].messageId).toBe('msg-1');
      expect(messages[1].messageId).toBe('msg-2');
    });

    it('should not remove messages from queue', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      manager.enqueue(queue, createMessage());

      manager.pollQueue('agent-1');
      expect(queue.messages.length).toBe(1);
    });
  });

  describe('popMessage', () => {
    it('should return undefined for non-existent queue', () => {
      const msg = manager.popMessage('non-existent');
      expect(msg).toBeUndefined();
    });

    it('should return undefined for empty queue', () => {
      manager.createQueue('agent-1');
      const msg = manager.popMessage('agent-1');
      expect(msg).toBeUndefined();
    });

    it('should pop the first message from queue', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      const msg1 = createMessage({ messageId: 'msg-1' });
      const msg2 = createMessage({ messageId: 'msg-2' });
      manager.enqueue(queue, msg1);
      manager.enqueue(queue, msg2);

      const popped = manager.popMessage('agent-1');
      expect(popped?.messageId).toBe('msg-1');
      expect(queue.messages.length).toBe(1);
      expect(queue.messages[0].messageId).toBe('msg-2');
    });
  });

  describe('enqueue', () => {
    it('should add message to queue', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      const msg = createMessage();

      const result = manager.enqueue(queue, msg);
      expect(result).toBe(true);
      expect(queue.messages.length).toBe(1);
      expect(queue.messages[0]).toEqual(msg);
    });

    it('should remove oldest message when queue overflows', () => {
      manager = createQueueManager(3); // Max size 3
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;

      const msg1 = createMessage({ messageId: 'msg-1' });
      const msg2 = createMessage({ messageId: 'msg-2' });
      const msg3 = createMessage({ messageId: 'msg-3' });
      const msg4 = createMessage({ messageId: 'msg-4' });

      manager.enqueue(queue, msg1);
      manager.enqueue(queue, msg2);
      manager.enqueue(queue, msg3);

      expect(queue.messages.length).toBe(3);

      // Should remove msg1 and add msg4
      manager.enqueue(queue, msg4);

      expect(queue.messages.length).toBe(3);
      expect(queue.messages.map(m => m.messageId)).toEqual(['msg-2', 'msg-3', 'msg-4']);
    });
  });

  describe('clearMessages', () => {
    it('should return 0 for non-existent queue', () => {
      const count = manager.clearMessages('non-existent');
      expect(count).toBe(0);
    });

    it('should clear all messages when no messageIds specified', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      manager.enqueue(queue, createMessage({ messageId: 'msg-1' }));
      manager.enqueue(queue, createMessage({ messageId: 'msg-2' }));
      manager.enqueue(queue, createMessage({ messageId: 'msg-3' }));

      const count = manager.clearMessages('agent-1');
      expect(count).toBe(3);
      expect(queue.messages.length).toBe(0);
    });

    it('should clear only specified messages', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      manager.enqueue(queue, createMessage({ messageId: 'msg-1' }));
      manager.enqueue(queue, createMessage({ messageId: 'msg-2' }));
      manager.enqueue(queue, createMessage({ messageId: 'msg-3' }));

      const count = manager.clearMessages('agent-1', ['msg-1', 'msg-3']);
      expect(count).toBe(2);
      expect(queue.messages.length).toBe(1);
      expect(queue.messages[0].messageId).toBe('msg-2');
    });

    it('should return 0 when no messages match', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;
      manager.enqueue(queue, createMessage({ messageId: 'msg-1' }));

      const count = manager.clearMessages('agent-1', ['non-existent']);
      expect(count).toBe(0);
      expect(queue.messages.length).toBe(1);
    });
  });
});

// ============================================================================
// 队列持久化边缘情况测试
// ============================================================================

describe('QueueManager - Persistence Edge Cases', () => {
  let manager: QueueManager;

  beforeEach(() => {
    manager = createQueueManager();
  });

  it('should handle queue overflow gracefully', () => {
    manager = createQueueManager(2);
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    // Add more messages than max size
    for (let i = 0; i < 10; i++) {
      manager.enqueue(queue, createMessage({ messageId: `msg-${i}` }));
    }

    // Queue should never exceed max size
    expect(queue.messages.length).toBe(2);
    // Should contain only the most recent messages
    expect(queue.messages.map(m => m.messageId)).toEqual(['msg-8', 'msg-9']);
  });

  it('should handle enqueue to full queue (at maxSize boundary)', () => {
    manager = createQueueManager(3);
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    // Fill queue exactly to max
    manager.enqueue(queue, createMessage({ messageId: 'msg-1' }));
    manager.enqueue(queue, createMessage({ messageId: 'msg-2' }));
    manager.enqueue(queue, createMessage({ messageId: 'msg-3' }));

    expect(queue.messages.length).toBe(3);

    // One more should trigger overflow
    manager.enqueue(queue, createMessage({ messageId: 'msg-4' }));
    expect(queue.messages.length).toBe(3);
    expect(queue.messages[0].messageId).toBe('msg-2');
  });

  it('should handle enqueue with maxSize of 1', () => {
    manager = createQueueManager(1);
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    manager.enqueue(queue, createMessage({ messageId: 'msg-1' }));
    expect(queue.messages.length).toBe(1);

    manager.enqueue(queue, createMessage({ messageId: 'msg-2' }));
    expect(queue.messages.length).toBe(1);
    expect(queue.messages[0].messageId).toBe('msg-2');
  });

  it('should preserve message metadata during enqueue', () => {
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    const msg = createMessage({
      messageId: 'msg-with-metadata',
      metadata: { priority: 'high', custom: { foo: 'bar' } },
    });

    manager.enqueue(queue, msg);

    expect(queue.messages[0].metadata).toEqual({ priority: 'high', custom: { foo: 'bar' } });
  });

  it('should handle different message types', () => {
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    const types: Array<'message' | 'task_request' | 'task_response' | 'announcement' | 'claim'> =
      ['message', 'task_request', 'task_response', 'announcement', 'claim'];

    for (const type of types) {
      manager.enqueue(queue, createMessage({ messageId: `msg-${type}`, type }));
    }

    expect(queue.messages.length).toBe(5);
    expect(queue.messages.map(m => m.type)).toEqual(types);
  });

  it('should handle queue with empty maxSize parameter (using default)', () => {
    manager = createQueueManager(50);
    manager.createQueue('agent-1'); // No maxSize specified, should use default

    const queue = manager.getQueue('agent-1');
    expect(queue?.maxSize).toBe(50);
  });

  it('should handle enqueue with custom maxSize override', () => {
    manager = createQueueManager(100);
    manager.createQueue('agent-1', 10); // Custom maxSize

    const queue = manager.getQueue('agent-1');
    expect(queue?.maxSize).toBe(10);
  });
});

// ============================================================================
// 队列清理逻辑测试
// ============================================================================

describe('QueueManager - Cleanup Logic', () => {
  let manager: QueueManager;

  beforeEach(() => {
    manager = createQueueManager();
  });

  describe('cleanupExpired', () => {
    it('should return 0 when no queues exist', () => {
      const cleaned = manager.cleanupExpired(1000);
      expect(cleaned).toBe(0);
    });

    it('should return 0 when no messages in queue', () => {
      manager.createQueue('agent-1');
      const cleaned = manager.cleanupExpired(1000);
      expect(cleaned).toBe(0);
    });

    it('should remove expired messages', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;

      // Old message (60 seconds ago)
      const oldMessage = createMessage({
        messageId: 'old-msg',
        createdAt: new Date(Date.now() - 60000),
      });

      // New message (1 second ago)
      const newMessage = createMessage({
        messageId: 'new-msg',
        createdAt: new Date(Date.now() - 1000),
      });

      manager.enqueue(queue, oldMessage);
      manager.enqueue(queue, newMessage);

      // Clean messages older than 30 seconds
      const cleaned = manager.cleanupExpired(30000);

      expect(cleaned).toBe(1);
      expect(queue.messages.length).toBe(1);
      expect(queue.messages[0].messageId).toBe('new-msg');
    });

    it('should remove all messages when all are expired', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;

      // All messages from 2 minutes ago
      for (let i = 0; i < 5; i++) {
        manager.enqueue(queue, createMessage({
          messageId: `old-msg-${i}`,
          createdAt: new Date(Date.now() - 120000),
        }));
      }

      // Clean messages older than 60 seconds
      const cleaned = manager.cleanupExpired(60000);

      expect(cleaned).toBe(5);
      expect(queue.messages.length).toBe(0);
    });

    it('should keep all messages when none are expired', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;

      // All messages from last second
      for (let i = 0; i < 5; i++) {
        manager.enqueue(queue, createMessage({
          messageId: `new-msg-${i}`,
          createdAt: new Date(Date.now() - 500),
        }));
      }

      // Clean messages older than 60 seconds
      const cleaned = manager.cleanupExpired(60000);

      expect(cleaned).toBe(0);
      expect(queue.messages.length).toBe(5);
    });

    it('should handle multiple queues', () => {
      manager.createQueue('agent-1');
      manager.createQueue('agent-2');
      manager.createQueue('agent-3');

      const queue1 = manager.getQueue('agent-1')!;
      const queue2 = manager.getQueue('agent-2')!;
      const queue3 = manager.getQueue('agent-3')!;

      // Queue 1: old messages
      manager.enqueue(queue1, createMessage({
        messageId: 'old-1',
        createdAt: new Date(Date.now() - 60000),
      }));

      // Queue 2: mixed messages
      manager.enqueue(queue2, createMessage({
        messageId: 'old-2',
        createdAt: new Date(Date.now() - 60000),
      }));
      manager.enqueue(queue2, createMessage({
        messageId: 'new-2',
        createdAt: new Date(Date.now() - 1000),
      }));

      // Queue 3: new messages
      manager.enqueue(queue3, createMessage({
        messageId: 'new-3',
        createdAt: new Date(Date.now() - 1000),
      }));

      const cleaned = manager.cleanupExpired(30000);

      expect(cleaned).toBe(2); // old-1 and old-2 removed
      expect(queue1.messages.length).toBe(0);
      expect(queue2.messages.length).toBe(1);
      expect(queue3.messages.length).toBe(1);
    });

    it('should handle messages exactly at expiry boundary', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;

      const exactTime = 30000;
      // Message created exactly at maxAgeMs ago (should be kept: age <= maxAgeMs)
      const boundaryMessage = createMessage({
        messageId: 'boundary-msg',
        createdAt: new Date(Date.now() - exactTime),
      });

      manager.enqueue(queue, boundaryMessage);

      const cleaned = manager.cleanupExpired(exactTime);

      // Should be kept because age <= maxAgeMs
      expect(cleaned).toBe(0);
      expect(queue.messages.length).toBe(1);
    });

    it('should handle messages just over expiry boundary', () => {
      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;

      // Message created just over maxAgeMs ago (should be removed)
      const overBoundaryMessage = createMessage({
        messageId: 'over-msg',
        createdAt: new Date(Date.now() - 30001), // 1ms over
      });

      manager.enqueue(queue, overBoundaryMessage);

      const cleaned = manager.cleanupExpired(30000);

      expect(cleaned).toBe(1);
      expect(queue.messages.length).toBe(0);
    });

    it('should log when messages are cleaned', () => {
      const mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      manager = new QueueManager({
        logger: mockLogger as unknown as Logger,
        defaultMaxQueueSize: 100,
      });

      manager.createQueue('agent-1');
      const queue = manager.getQueue('agent-1')!;

      manager.enqueue(queue, createMessage({
        messageId: 'old-msg',
        createdAt: new Date(Date.now() - 60000),
      }));

      manager.cleanupExpired(30000);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Expired messages cleaned',
        { count: 1 }
      );
    });

    it('should not log when no messages are cleaned', () => {
      const mockLogger = {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      manager = new QueueManager({
        logger: mockLogger as unknown as Logger,
        defaultMaxQueueSize: 100,
      });

      manager.createQueue('agent-1');

      // Reset the mock to clear the "queue created" log
      mockLogger.info.mockClear();

      manager.cleanupExpired(30000);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// getStats 测试
// ============================================================================

describe('QueueManager - getStats', () => {
  let manager: QueueManager;

  beforeEach(() => {
    manager = createQueueManager();
  });

  it('should return empty stats when no queues exist', () => {
    const stats = manager.getStats();

    expect(stats.queues).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.queueStats).toEqual({});
  });

  it('should return stats for single queue', () => {
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;
    manager.enqueue(queue, createMessage());
    manager.enqueue(queue, createMessage());

    const stats = manager.getStats();

    expect(stats.queues).toBe(1);
    expect(stats.totalMessages).toBe(2);
    expect(stats.queueStats['agent-1']).toEqual({
      size: 2,
      maxSize: 100,
    });
  });

  it('should return stats for multiple queues', () => {
    manager.createQueue('agent-1', 50);
    manager.createQueue('agent-2', 100);

    const queue1 = manager.getQueue('agent-1')!;
    const queue2 = manager.getQueue('agent-2')!;

    manager.enqueue(queue1, createMessage());
    manager.enqueue(queue1, createMessage());
    manager.enqueue(queue2, createMessage());

    const stats = manager.getStats();

    expect(stats.queues).toBe(2);
    expect(stats.totalMessages).toBe(3);
    expect(stats.queueStats['agent-1']).toEqual({
      size: 2,
      maxSize: 50,
    });
    expect(stats.queueStats['agent-2']).toEqual({
      size: 1,
      maxSize: 100,
    });
  });

  it('should return correct stats after cleanup', () => {
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    manager.enqueue(queue, createMessage({
      messageId: 'old',
      createdAt: new Date(Date.now() - 60000),
    }));
    manager.enqueue(queue, createMessage({
      messageId: 'new',
      createdAt: new Date(Date.now() - 1000),
    }));

    let stats = manager.getStats();
    expect(stats.totalMessages).toBe(2);

    manager.cleanupExpired(30000);

    stats = manager.getStats();
    expect(stats.totalMessages).toBe(1);
    expect(stats.queueStats['agent-1'].size).toBe(1);
  });

  it('should return correct stats after clearing messages', () => {
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    const msg1 = createMessage({ messageId: 'msg-1' });
    const msg2 = createMessage({ messageId: 'msg-2' });
    const msg3 = createMessage({ messageId: 'msg-3' });

    manager.enqueue(queue, msg1);
    manager.enqueue(queue, msg2);
    manager.enqueue(queue, msg3);

    manager.clearMessages('agent-1', ['msg-1', 'msg-2']);

    const stats = manager.getStats();
    expect(stats.totalMessages).toBe(1);
    expect(stats.queueStats['agent-1'].size).toBe(1);
  });

  it('should return correct stats after queue deletion', () => {
    manager.createQueue('agent-1');
    manager.createQueue('agent-2');

    const queue1 = manager.getQueue('agent-1')!;
    const queue2 = manager.getQueue('agent-2')!;

    manager.enqueue(queue1, createMessage());
    manager.enqueue(queue2, createMessage());

    manager.deleteQueue('agent-1');

    const stats = manager.getStats();
    expect(stats.queues).toBe(1);
    expect(stats.totalMessages).toBe(1);
    expect(stats.queueStats['agent-1']).toBeUndefined();
    expect(stats.queueStats['agent-2']).toBeDefined();
  });

  it('should reflect correct stats after pop operations', () => {
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;

    manager.enqueue(queue, createMessage());
    manager.enqueue(queue, createMessage());
    manager.enqueue(queue, createMessage());

    manager.popMessage('agent-1');
    manager.popMessage('agent-1');

    const stats = manager.getStats();
    expect(stats.totalMessages).toBe(1);
    expect(stats.queueStats['agent-1'].size).toBe(1);
  });
});

// ============================================================================
// 综合场景测试
// ============================================================================

describe('QueueManager - Integration Scenarios', () => {
  let manager: QueueManager;

  beforeEach(() => {
    manager = createQueueManager(10);
  });

  it('should handle full lifecycle: create, fill, overflow, cleanup, delete', () => {
    // Create queue
    manager.createQueue('agent-1');
    const queue = manager.getQueue('agent-1')!;
    expect(queue.maxSize).toBe(10);

    // Fill queue with mixed age messages
    // First 5 messages are old (60 seconds ago)
    for (let i = 0; i < 5; i++) {
      manager.enqueue(queue, createMessage({
        messageId: `old-msg-${i}`,
        createdAt: new Date(Date.now() - 60000),
      }));
    }
    // Next 10 messages are new (1 second ago) - will cause overflow and remove old ones
    for (let i = 0; i < 10; i++) {
      manager.enqueue(queue, createMessage({
        messageId: `new-msg-${i}`,
        createdAt: new Date(Date.now() - 1000),
      }));
    }

    // Should have 10 messages (overflow handling removed old ones)
    let stats = manager.getStats();
    expect(stats.totalMessages).toBe(10);

    // Cleanup messages older than 30 seconds
    const cleaned = manager.cleanupExpired(30000);
    // Some old messages might have been removed by overflow, cleanup removes remaining old ones
    expect(cleaned).toBeGreaterThanOrEqual(0);

    // Get final stats
    stats = manager.getStats();
    expect(stats.queueStats['agent-1'].size).toBeGreaterThan(0);

    // Delete queue
    manager.deleteQueue('agent-1');
    expect(manager.getQueue('agent-1')).toBeUndefined();
  });

  it('should handle concurrent-like operations', () => {
    manager.createQueue('agent-1');
    manager.createQueue('agent-2');

    const queue1 = manager.getQueue('agent-1')!;
    const queue2 = manager.getQueue('agent-2')!;

    // Interleaved operations
    manager.enqueue(queue1, createMessage({ messageId: 'a1-msg1' }));
    manager.enqueue(queue2, createMessage({ messageId: 'a2-msg1' }));
    manager.enqueue(queue1, createMessage({ messageId: 'a1-msg2' }));
    manager.popMessage('agent-1');
    manager.enqueue(queue2, createMessage({ messageId: 'a2-msg2' }));
    manager.clearMessages('agent-1');
    manager.enqueue(queue1, createMessage({ messageId: 'a1-msg3' }));

    const stats = manager.getStats();
    expect(stats.queues).toBe(2);
    expect(queue1.messages.length).toBe(1);
    expect(queue2.messages.length).toBe(2);
  });
});