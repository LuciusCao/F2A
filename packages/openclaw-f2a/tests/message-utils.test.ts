/**
 * message-utils 测试
 * 
 * 测试从 connector.ts 提取的消息处理辅助函数。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeMessageHash,
  isEchoMessageByMetadata,
  isEchoMessageByContent,
  cleanupMessageHashCache,
  isDuplicateMessage,
  MESSAGE_HASH_THRESHOLD,
  MAX_MESSAGE_HASH_CACHE_SIZE,
  MESSAGE_HASH_TTL_MS,
} from '../src/connector-helpers.js';

describe('message-utils', () => {
  describe('常量', () => {
    it('MESSAGE_HASH_THRESHOLD 应该是 100', () => {
      expect(MESSAGE_HASH_THRESHOLD).toBe(100);
    });

    it('MAX_MESSAGE_HASH_CACHE_SIZE 应该是 10000', () => {
      expect(MAX_MESSAGE_HASH_CACHE_SIZE).toBe(10000);
    });

    it('MESSAGE_HASH_TTL_MS 应该是 5 分钟', () => {
      expect(MESSAGE_HASH_TTL_MS).toBe(5 * 60 * 1000);
    });
  });

  describe('computeMessageHash', () => {
    it('应该生成 SHA256 哈希', () => {
      const from = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const content = '测试消息内容';
      const hash = computeMessageHash(from, content);

      // 验证哈希格式：msg-{32位hex}-{长度}
      expect(hash).toMatch(/^msg-[a-f0-9]{32}-\d+$/);
    });

    it('相同输入应该生成相同哈希', () => {
      const from = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const content = '相同内容';
      
      const hash1 = computeMessageHash(from, content);
      const hash2 = computeMessageHash(from, content);
      
      expect(hash1).toBe(hash2);
    });

    it('不同输入应该生成不同哈希', () => {
      const from = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      
      const hash1 = computeMessageHash(from, '内容1');
      const hash2 = computeMessageHash(from, '内容2');
      
      expect(hash1).not.toBe(hash2);
    });

    it('不同 from 应该生成不同哈希', () => {
      const content = '相同内容';
      
      const hash1 = computeMessageHash('peer1', content);
      const hash2 = computeMessageHash('peer2', content);
      
      expect(hash1).not.toBe(hash2);
    });

    it('哈希长度部分应该等于输入数据长度', () => {
      const from = 'test-peer';
      const content = 'hello';
      const hash = computeMessageHash(from, content);
      
      // 计算实际数据长度
      const expectedLength = `${from}:${content}`.length;
      // 验证哈希格式：msg-{32位hex}-{长度}
      expect(hash).toBe(`msg-03e92f42810859c435afbc4e48873d87-${expectedLength}`);
    });

    it('空内容应该也能生成哈希', () => {
      const hash = computeMessageHash('peer', '');
      expect(hash).toMatch(/^msg-[a-f0-9]{32}-\d+$/);
    });

    it('长内容应该也能生成哈希', () => {
      const longContent = 'A'.repeat(10000);
      const hash = computeMessageHash('peer', longContent);
      expect(hash).toMatch(/^msg-[a-f0-9]{32}-\d+$/);
    });
  });

  describe('isEchoMessageByMetadata', () => {
    it('应该检测 reply 类型的消息', () => {
      const metadata = { type: 'reply', replyTo: 'msg-123' };
      expect(isEchoMessageByMetadata(metadata)).toBe(true);
    });

    it('应该检测 _f2a_skip_echo 标记', () => {
      const metadata = { _f2a_skip_echo: true };
      expect(isEchoMessageByMetadata(metadata)).toBe(true);
    });

    it('应该检测 x-openclaw-skip 标记', () => {
      const metadata = { 'x-openclaw-skip': true };
      expect(isEchoMessageByMetadata(metadata)).toBe(true);
    });

    it('普通 metadata 应该返回 false', () => {
      const metadata = { type: 'normal', from: 'peer-123' };
      expect(isEchoMessageByMetadata(metadata)).toBe(false);
    });

    it('空 metadata 应该返回 false', () => {
      expect(isEchoMessageByMetadata(undefined)).toBe(false);
      expect(isEchoMessageByMetadata(null as any)).toBe(false);
      expect(isEchoMessageByMetadata({})).toBe(false);
    });

    it('只有 type 而没有 replyTo 应该返回 false', () => {
      const metadata = { type: 'reply' };
      expect(isEchoMessageByMetadata(metadata)).toBe(false);
    });

    it('_f2a_skip_echo 为 false 应该返回 false', () => {
      const metadata = { _f2a_skip_echo: false };
      expect(isEchoMessageByMetadata(metadata)).toBe(false);
    });
  });

  describe('isEchoMessageByContent', () => {
    it('应该检测 [[F2A:REPLY: 标记', () => {
      const content = '[[F2A:REPLY:some-data]]';
      expect(isEchoMessageByContent(content)).toBe(true);
    });

    it('应该检测 [[reply_to_current]] 标记', () => {
      const content = '这是回复 [[reply_to_current]]';
      expect(isEchoMessageByContent(content)).toBe(true);
    });

    it('应该检测 NO_REPLY: 开头', () => {
      const content = 'NO_REPLY: 这是回复';
      expect(isEchoMessageByContent(content)).toBe(true);
    });

    it('应该检测 [NO_REPLY] 开头', () => {
      const content = '[NO_REPLY] 这是回复';
      expect(isEchoMessageByContent(content)).toBe(true);
    });

    it('普通内容应该返回 false', () => {
      expect(isEchoMessageByContent('普通消息')).toBe(false);
      expect(isEchoMessageByContent('Hello World')).toBe(false);
    });

    it('空内容应该返回 false', () => {
      expect(isEchoMessageByContent(undefined)).toBe(false);
      expect(isEchoMessageByContent(null as any)).toBe(false);
      expect(isEchoMessageByContent('')).toBe(false);
    });

    it('NO_REPLY 不在开头应该返回 false', () => {
      const content = '消息内容 NO_REPLY: 部分';
      expect(isEchoMessageByContent(content)).toBe(false);
    });

    it('[NO_REPLY] 不在开头应该返回 false', () => {
      const content = '消息 [NO_REPLY] 部分';
      expect(isEchoMessageByContent(content)).toBe(false);
    });
  });

  describe('cleanupMessageHashCache', () => {
    let cache: Map<string, number>;

    beforeEach(() => {
      cache = new Map();
    });

    it('应该删除过期的条目', () => {
      const now = Date.now();
      const ttl = 1000; // 1秒
      
      // 添加一个过期条目
      cache.set('hash1', now - ttl - 100);
      // 添加一个未过期条目
      cache.set('hash2', now - ttl / 2);
      
      cleanupMessageHashCache(cache, now, ttl);
      
      expect(cache.has('hash1')).toBe(false);
      expect(cache.has('hash2')).toBe(true);
    });

    it('空缓存应该不报错', () => {
      cleanupMessageHashCache(new Map(), Date.now());
    });

    it('应该使用默认 TTL', () => {
      const now = Date.now();
      cache.set('hash1', now - MESSAGE_HASH_TTL_MS - 100);
      cache.set('hash2', now - MESSAGE_HASH_TTL_MS / 2);
      
      cleanupMessageHashCache(cache, now);
      
      expect(cache.has('hash1')).toBe(false);
      expect(cache.has('hash2')).toBe(true);
    });

    it('应该保留所有未过期条目', () => {
      const now = Date.now();
      const ttl = 1000;
      
      for (let i = 0; i < 100; i++) {
        cache.set(`hash${i}`, now - ttl / 2);
      }
      
      cleanupMessageHashCache(cache, now, ttl);
      
      expect(cache.size).toBe(100);
    });
  });

  describe('isDuplicateMessage', () => {
    let cache: Map<string, number>;

    beforeEach(() => {
      cache = new Map();
    });

    it('新消息应该返回 false', () => {
      const now = Date.now();
      expect(isDuplicateMessage(cache, 'new-hash', now)).toBe(false);
    });

    it('在 TTL 内的重复消息应该返回 true', () => {
      const now = Date.now();
      const ttl = 1000;
      
      cache.set('existing-hash', now - ttl / 2);
      
      expect(isDuplicateMessage(cache, 'existing-hash', now, ttl)).toBe(true);
    });

    it('超过 TTL 的重复消息应该返回 false', () => {
      const now = Date.now();
      const ttl = 1000;
      
      cache.set('old-hash', now - ttl - 100);
      
      expect(isDuplicateMessage(cache, 'old-hash', now, ttl)).toBe(false);
    });

    it('应该使用默认 TTL', () => {
      const now = Date.now();
      
      // 在默认 TTL 内
      cache.set('hash1', now - MESSAGE_HASH_TTL_MS / 2);
      expect(isDuplicateMessage(cache, 'hash1', now)).toBe(true);
      
      // 超过默认 TTL
      cache.set('hash2', now - MESSAGE_HASH_TTL_MS - 100);
      expect(isDuplicateMessage(cache, 'hash2', now)).toBe(false);
    });

    it('空缓存应该返回 false', () => {
      expect(isDuplicateMessage(new Map(), 'any-hash', Date.now())).toBe(false);
    });
  });

  describe('组合测试：消息去重流程', () => {
    it('完整去重流程应该正确工作', () => {
      const cache = new Map<string, number>();
      const from = '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const content = 'A'.repeat(150); // 超过阈值
      
      // 第一次消息
      const hash = computeMessageHash(from, content);
      const now1 = Date.now();
      
      expect(isDuplicateMessage(cache, hash, now1)).toBe(false);
      cache.set(hash, now1);
      
      // 同样内容的消息在 TTL 内（重复）
      const now2 = now1 + 100;
      expect(isDuplicateMessage(cache, hash, now2)).toBe(true);
      
      // 清理缓存
      const now3 = now1 + MESSAGE_HASH_TTL_MS + 100;
      cleanupMessageHashCache(cache, now3);
      
      // 清理后不再是重复
      expect(cache.has(hash)).toBe(false);
      expect(isDuplicateMessage(cache, hash, now3)).toBe(false);
    });
  });
});