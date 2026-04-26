/**
 * MessageStore 测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageStore, MessageRecord, createMessageRecord } from './message-store.js';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

// 测试目录
const TEST_DIR = join(process.cwd(), 'test-tmp-message-store');

// 辅助函数：生成测试消息记录
function generateTestMessage(
  from: string = 'peer-from',
  to: string = 'peer-to',
  type: string = 'TASK_REQUEST'
): MessageRecord {
  return {
    id: `msg-${randomUUID()}`,
    from,
    to,
    type,
    timestamp: Date.now(),
    summary: `Test message of type ${type}`,
    payload: JSON.stringify({ test: true, timestamp: Date.now() })
  };
}

describe('MessageStore', () => {
  let store: MessageStore;
  let testDbPath: string;

  beforeEach(async () => {
    // 创建测试目录
    await mkdir(TEST_DIR, { recursive: true });
    testDbPath = join(TEST_DIR, `messages-${randomUUID()}.db`);
    
    store = new MessageStore({
      dbPath: testDbPath,
      retentionDays: 7,
      maxRecords: 100,
      logLevel: 'DEBUG'
    });
  });

  afterEach(async () => {
    // 关闭数据库连接
    store.close();
    
    // 清理测试目录
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('构造函数', () => {
    it('应该成功创建 MessageStore 实例', () => {
      expect(store).toBeDefined();
      const stats = store.getStats();
      expect(stats.count).toBe(0);
    });

    it('应该使用默认配置', () => {
      // 使用测试目录避免 CI 环境问题
      const testDefaultStore = new MessageStore({
        dbPath: join(TEST_DIR, 'default-messages.db')
      });
      expect(testDefaultStore).toBeDefined();
      const stats = testDefaultStore.getStats();
      expect(stats.count).toBe(0);
      testDefaultStore.close();
    });

    it('应该正确初始化数据库表', async () => {
      // 添加一条消息验证表结构
      const message = generateTestMessage();
      await store.add(message);
      
      const messages = await store.getRecent(1);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(message.id);
    });
  });

  describe('add', () => {
    it('应该成功添加消息记录', async () => {
      const message = generateTestMessage();
      await store.add(message);
      
      const stats = store.getStats();
      expect(stats.count).toBe(1);
    });

    it('应该添加多条消息记录', async () => {
      for (let i = 0; i < 10; i++) {
        const message = generateTestMessage(`peer-${i}`, `peer-${i + 1}`);
        await store.add(message);
      }
      
      const stats = store.getStats();
      expect(stats.count).toBe(10);
    });

    it('应该正确存储消息的所有字段', async () => {
      const message: MessageRecord = {
        id: 'msg-test-id',
        from: 'peer-from-test',
        to: 'peer-to-test',
        type: 'DISCOVER',
        timestamp: 1234567890,
        summary: 'Test summary',
        payload: JSON.stringify({ key: 'value' })
      };
      
      await store.add(message);
      
      const messages = await store.getRecent(1);
      expect(messages[0]).toEqual(message);
    });

    it('应该处理空 to 字段', async () => {
      const message = generateTestMessage('peer-from', '', 'DISCOVER');
      await store.add(message);
      
      const messages = await store.getRecent(1);
      expect(messages[0].to).toBe('');
    });

    it('应该处理无 payload 的消息', async () => {
      const message: MessageRecord = {
        id: 'msg-no-payload',
        from: 'peer-from',
        to: 'peer-to',
        type: 'PING',
        timestamp: Date.now(),
        summary: 'Ping message'
      };
      
      await store.add(message);
      
      const messages = await store.getRecent(1);
      expect(messages[0].payload).toBeNull();
    });
  });

  describe('getRecent', () => {
    it('应该获取最近的消息记录', async () => {
      // 添加多条消息
      for (let i = 0; i < 20; i++) {
        await store.add(generateTestMessage(`peer-${i}`, `peer-${i + 1}`));
      }
      
      const messages = await store.getRecent(10);
      expect(messages).toHaveLength(10);
    });

    it('应该按时间倒序返回', async () => {
      const timestamps: number[] = [];
      for (let i = 0; i < 5; i++) {
        const ts = Date.now() - i * 1000;
        timestamps.push(ts);
        await store.add({
          id: `msg-${i}`,
          from: 'peer',
          to: 'peer',
          type: 'TASK_REQUEST',
          timestamp: ts
        });
      }
      
      const messages = await store.getRecent(5);
      expect(messages.map(m => m.timestamp)).toEqual(timestamps);
    });

    it('应该使用默认 limit', async () => {
      for (let i = 0; i < 150; i++) {
        await store.add(generateTestMessage());
      }
      
      const messages = await store.getRecent(); // 默认 100
      expect(messages).toHaveLength(100);
    });

    it('应该处理空数据库', async () => {
      const messages = await store.getRecent(10);
      expect(messages).toEqual([]);
    });
  });

  describe('getByAgent', () => {
    it('应该获取与特定 Agent 相关的消息', async () => {
      // 添加不同 peer 的消息
      await store.add(generateTestMessage('peer-a', 'peer-b'));
      await store.add(generateTestMessage('peer-b', 'peer-a'));
      await store.add(generateTestMessage('peer-c', 'peer-d'));
      
      const messages = await store.getByAgent('peer-a', 10);
      expect(messages).toHaveLength(2);
    });

    it('应该只返回发送或接收的消息', async () => {
      await store.add(generateTestMessage('peer-a', 'peer-b'));
      await store.add(generateTestMessage('peer-c', 'peer-d'));
      
      const messages = await store.getByAgent('peer-b', 10);
      expect(messages).toHaveLength(1);
      expect(messages[0].to).toBe('peer-b');
    });

    it('应该支持 limit 参数', async () => {
      for (let i = 0; i < 20; i++) {
        await store.add(generateTestMessage('peer-a', `peer-${i}`));
      }
      
      const messages = await store.getByAgent('peer-a', 5);
      expect(messages).toHaveLength(5);
    });

    it('应该按时间倒序返回', async () => {
      for (let i = 0; i < 5; i++) {
        await store.add({
          id: `msg-${i}`,
          from: 'peer-a',
          to: 'peer-b',
          type: 'TASK_REQUEST',
          timestamp: Date.now() - i * 1000
        });
      }
      
      const messages = await store.getByAgent('peer-a', 5);
      expect(messages[0].timestamp).toBeGreaterThan(messages[4].timestamp);
    });
  });

  describe('conversation queries', () => {
    it('应该保存并按 conversationId 查询消息', async () => {
      await store.add(createMessageRecord(
        'msg-1',
        'agent:alice',
        'agent:bob',
        'message',
        Date.now(),
        'hello',
        { content: 'hello' },
        {
          conversationId: 'conv-1',
          replyToMessageId: undefined,
          direction: 'outbound',
          agentId: 'agent:alice',
          peerAgentId: 'agent:bob',
          metadata: { noReply: false }
        }
      ));

      const messages = await store.getByConversation('agent:alice', 'conv-1');

      expect(messages).toHaveLength(1);
      expect(messages[0].conversationId).toBe('conv-1');
      expect(messages[0].agentId).toBe('agent:alice');
      expect(messages[0].peerAgentId).toBe('agent:bob');
      expect(messages[0].metadata).toBe(JSON.stringify({ noReply: false }));
    });

    it('应该返回 Agent 的会话摘要列表', async () => {
      await store.add(createMessageRecord(
        'msg-1',
        'agent:alice',
        'agent:bob',
        'message',
        1000,
        'first',
        { content: 'first' },
        {
          conversationId: 'conv-1',
          direction: 'outbound',
          agentId: 'agent:alice',
          peerAgentId: 'agent:bob'
        }
      ));
      await store.add(createMessageRecord(
        'msg-2',
        'agent:bob',
        'agent:alice',
        'message',
        2000,
        'second',
        { content: 'second' },
        {
          conversationId: 'conv-1',
          direction: 'inbound',
          agentId: 'agent:alice',
          peerAgentId: 'agent:bob'
        }
      ));

      const conversations = await store.listConversations('agent:alice');

      expect(conversations).toEqual([
        {
          conversationId: 'conv-1',
          peerAgentId: 'agent:bob',
          lastMessageAt: 2000,
          messageCount: 2,
          lastSummary: 'second'
        }
      ]);
    });

    it('时间戳相同时会话摘要不应因 JOIN 产生重复行', async () => {
      await store.add(createMessageRecord(
        'msg-1',
        'agent:alice',
        'agent:bob',
        'message',
        1000,
        'first',
        { content: 'first' },
        {
          conversationId: 'conv-1',
          direction: 'outbound',
          agentId: 'agent:alice',
          peerAgentId: 'agent:bob'
        }
      ));
      await store.add(createMessageRecord(
        'msg-2',
        'agent:bob',
        'agent:alice',
        'message',
        1000,
        'second',
        { content: 'second' },
        {
          conversationId: 'conv-1',
          direction: 'inbound',
          agentId: 'agent:alice',
          peerAgentId: 'agent:bob'
        }
      ));

      const conversations = await store.listConversations('agent:alice');

      expect(conversations).toEqual([
        {
          conversationId: 'conv-1',
          peerAgentId: 'agent:bob',
          lastMessageAt: 1000,
          messageCount: 2,
          lastSummary: 'second'
        }
      ]);
    });
  });

  describe('clear', () => {
    it('应该清空所有消息记录', async () => {
      for (let i = 0; i < 10; i++) {
        await store.add(generateTestMessage());
      }
      
      expect(store.getStats().count).toBe(10);
      
      await store.clear();
      
      expect(store.getStats().count).toBe(0);
    });

    it('清空后应该可以重新添加消息', async () => {
      await store.add(generateTestMessage());
      await store.clear();
      
      const message = generateTestMessage('new-peer', 'new-peer');
      await store.add(message);
      
      const messages = await store.getRecent(1);
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe('new-peer');
    });
  });

  describe('cleanup', () => {
    it('应该在超过上限时自动清理', async () => {
      const smallStore = new MessageStore({
        dbPath: join(TEST_DIR, 'small.db'),
        maxRecords: 10,
        retentionDays: 1
      });
      
      // 添加超过上限的记录
      for (let i = 0; i < 20; i++) {
        await smallStore.add({
          id: `msg-${i}`,
          from: 'peer',
          to: 'peer',
          type: 'TASK_REQUEST',
          timestamp: Date.now() + i // 确保时间递增
        });
      }
      
      const stats = smallStore.getStats();
      expect(stats.count).toBeLessThanOrEqual(10);
      
      smallStore.close();
    });

    it('应该删除过期的记录', async () => {
      const storeWithRetention = new MessageStore({
        dbPath: join(TEST_DIR, 'retention.db'),
        maxRecords: 1000,
        retentionDays: 1
      });
      
      // 添加过期记录（2天前）
      const oldTimestamp = Date.now() - 2 * 24 * 60 * 60 * 1000;
      await storeWithRetention.add({
        id: 'msg-old',
        from: 'peer',
        to: 'peer',
        type: 'TASK_REQUEST',
        timestamp: oldTimestamp
      });
      
      // 添加新记录
      await storeWithRetention.add({
        id: 'msg-new',
        from: 'peer',
        to: 'peer',
        type: 'TASK_REQUEST',
        timestamp: Date.now()
      });
      
      // 触发清理（通过添加更多消息）
      for (let i = 0; i < 900; i++) {
        await storeWithRetention.add({
          id: `msg-${randomUUID()}`,
          from: 'peer',
          to: 'peer',
          type: 'TASK_REQUEST',
          timestamp: Date.now()
        });
      }
      
      const messages = await storeWithRetention.getRecent(1000);
      const oldMessageExists = messages.some(m => m.id === 'msg-old');
      const newMessageExists = messages.some(m => m.id === 'msg-new');
      
      expect(oldMessageExists).toBe(false); // 过期记录应被删除
      expect(newMessageExists).toBe(true); // 新记录应保留
      
      storeWithRetention.close();
    });

    it('应该保留最新的记录', async () => {
      const storeLimited = new MessageStore({
        dbPath: join(TEST_DIR, 'limited.db'),
        maxRecords: 5,
        retentionDays: 30
      });
      
      // 添加 10 条消息，时间递增
      for (let i = 0; i < 10; i++) {
        await storeLimited.add({
          id: `msg-${i}`,
          from: 'peer',
          to: 'peer',
          type: 'TASK_REQUEST',
          timestamp: Date.now() + i * 1000
        });
      }
      
      const messages = await storeLimited.getRecent(10);
      // 应保留最新的 5 条
      expect(messages.length).toBeLessThanOrEqual(5);
      expect(messages[0].timestamp).toBeGreaterThan(messages[messages.length - 1].timestamp);
      
      storeLimited.close();
    });
  });

  describe('getStats', () => {
    it('应该返回正确的统计信息', async () => {
      const stats = store.getStats();
      expect(stats.count).toBe(0);
      expect(stats.oldestTimestamp).toBeUndefined();
      expect(stats.newestTimestamp).toBeUndefined();
    });

    it('应该返回有数据时的统计信息', async () => {
      const now = Date.now();
      await store.add({
        id: 'msg-1',
        from: 'peer',
        to: 'peer',
        type: 'TASK_REQUEST',
        timestamp: now - 1000
      });
      await store.add({
        id: 'msg-2',
        from: 'peer',
        to: 'peer',
        type: 'TASK_REQUEST',
        timestamp: now
      });
      
      const stats = store.getStats();
      expect(stats.count).toBe(2);
      expect(stats.oldestTimestamp).toBe(now - 1000);
      expect(stats.newestTimestamp).toBe(now);
    });
  });

  describe('close', () => {
    it('应该正确关闭数据库', () => {
      const tempStore = new MessageStore({
        dbPath: join(TEST_DIR, 'temp.db')
      });
      
      tempStore.close();
      
      // better-sqlite3 的 close() 在已关闭后调用是安全的（不会抛异常）
      // 所以我们只需要验证第一次 close 正常执行
      expect(() => tempStore.close()).not.toThrow();
    });
  });

  describe('createMessageRecord', () => {
    it('应该创建完整的消息记录', () => {
      const record = createMessageRecord(
        'msg-id',
        'peer-from',
        'peer-to',
        'TASK_REQUEST',
        Date.now(),
        'Test message',
        { key: 'value' }
      );
      
      expect(record.id).toBe('msg-id');
      expect(record.from).toBe('peer-from');
      expect(record.to).toBe('peer-to');
      expect(record.type).toBe('TASK_REQUEST');
      expect(record.summary).toBe('Test message');
      expect(record.payload).toBe(JSON.stringify({ key: 'value' }));
    });

    it('应该处理无 payload 的情况', () => {
      const record = createMessageRecord(
        'msg-id',
        'peer-from',
        'peer-to',
        'PING',
        Date.now()
      );
      
      expect(record.payload).toBeUndefined();
    });
  });

  describe('并发写入', () => {
    it('应该支持并发添加消息', async () => {
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < 50; i++) {
        promises.push(store.add(generateTestMessage(`peer-${i}`, `peer-${i + 1}`)));
      }
      
      await Promise.all(promises);
      
      const stats = store.getStats();
      expect(stats.count).toBe(50);
    });
  });
});
