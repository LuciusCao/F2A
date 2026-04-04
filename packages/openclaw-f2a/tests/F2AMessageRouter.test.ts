/**
 * F2AMessageRouter 测试
 * 
 * 测试消息路由器的功能：
 * 1. 回声消息检测
 * 2. 消息去重
 * 3. 缓存管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  F2AMessageRouter, 
  DEFAULT_ROUTER_CONFIG,
  type F2AMessageEvent,
  type MessageRouterConfig,
} from '../src/F2AMessageRouter.js';
import { generateValidPeerId } from './utils/test-helpers.js';

// 创建 mock F2A
const createMockF2A = (peerId: string = generateValidPeerId('Router')) => ({
  peerId,  // 直接属性，不是方法
  getConnectedPeers: vi.fn(() => []),
  sendMessage: vi.fn(),
});

// 创建 mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe('F2AMessageRouter', () => {
  let router: F2AMessageRouter;
  let mockF2A: ReturnType<typeof createMockF2A>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockF2A = createMockF2A();
    mockLogger = createMockLogger();
    router = new F2AMessageRouter({
      f2a: mockF2A as unknown as import('../src/types.js').F2APublicInterface,
      logger: mockLogger as unknown as import('../src/types.js').ApiLogger,
    });
  });

  afterEach(() => {
    router.clearCache();
  });

  describe('构造函数', () => {
    it('应该使用默认配置', () => {
      const defaultRouter = new F2AMessageRouter({});
      expect(defaultRouter).toBeDefined();
    });

    it('应该接受自定义配置', () => {
      const customConfig: MessageRouterConfig = {
        maxCacheSize: 5000,
        cacheTtlMs: 60000,
        hashThreshold: 50,
      };
      const customRouter = new F2AMessageRouter({}, customConfig);
      expect(customRouter).toBeDefined();
    });

    it('应该在没有 F2A 的情况下工作', () => {
      const noF2ARouter = new F2AMessageRouter({});
      expect(noF2ARouter).toBeDefined();
    });
  });

  describe('isEchoMessage', () => {
    it('应该检测 metadata 中的 reply 类型消息', () => {
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: 'test message',
        messageId: 'msg-1',
        metadata: { type: 'reply', replyTo: 'msg-0' },
      };
      
      expect(router.isEchoMessage(event)).toBe(true);
    });

    it('应该检测 metadata 中的跳过标记', () => {
      const event1: F2AMessageEvent = {
        from: 'peer-1',
        content: 'test message',
        messageId: 'msg-2',
        metadata: { _f2a_skip_echo: true },
      };
      
      expect(router.isEchoMessage(event1)).toBe(true);
      
      const event2: F2AMessageEvent = {
        from: 'peer-1',
        content: 'test message',
        messageId: 'msg-3',
        metadata: { 'x-openclaw-skip': true },
      };
      
      expect(router.isEchoMessage(event2)).toBe(true);
    });

    it('应该检测内容中的回复标记', () => {
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: '[[F2A:REPLY:msg-1]] test message',
        messageId: 'msg-4',
      };
      
      expect(router.isEchoMessage(event)).toBe(true);
    });

    it('应该检测内容中的 NO_REPLY 标记', () => {
      const event1: F2AMessageEvent = {
        from: 'peer-1',
        content: 'NO_REPLY: ignore this',
        messageId: 'msg-5',
      };
      
      expect(router.isEchoMessage(event1)).toBe(true);
      
      const event2: F2AMessageEvent = {
        from: 'peer-1',
        content: '[NO_REPLY] ignore this too',
        messageId: 'msg-6',
      };
      
      expect(router.isEchoMessage(event2)).toBe(true);
    });

    it('应该检测来自自己的消息', () => {
      const myPeerId = generateValidPeerId('Self');
      const selfRouter = new F2AMessageRouter({
        f2a: { peerId: myPeerId } as any,
      });
      
      const event: F2AMessageEvent = {
        from: myPeerId,
        content: 'test message',
        messageId: 'msg-7',
      };
      
      expect(selfRouter.isEchoMessage(event)).toBe(true);
    });

    it('应该通过正常消息', () => {
      const event: F2AMessageEvent = {
        from: generateValidPeerId('Other'),
        content: 'normal message',
        messageId: 'msg-8',
      };
      
      expect(router.isEchoMessage(event)).toBe(false);
    });

    it('应该在没有 F2A 时无法检测自身消息', () => {
      const noF2ARouter = new F2AMessageRouter({});
      
      const event: F2AMessageEvent = {
        from: generateValidPeerId('Unknown'),
        content: 'test message',
        messageId: 'msg-9',
      };
      
      // 没有 F2A，无法检测是否来自自己
      expect(noF2ARouter.isEchoMessage(event)).toBe(false);
    });
  });

  describe('消息去重（长消息哈希）', () => {
    it('应该对长消息进行哈希去重', () => {
      // 使用超过 hashThreshold (默认 100) 的长消息
      const longContent = 'x'.repeat(200);
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: longContent,
        messageId: 'msg-1',
      };
      
      // 第一次不应该被标记为 echo
      expect(router.isEchoMessage(event)).toBe(false);
      
      // 第二次应该被标记为重复
      expect(router.isEchoMessage(event)).toBe(true);
    });

    it('短消息不应该被哈希去重', () => {
      const shortContent = 'short';
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: shortContent,
        messageId: 'msg-1',
      };
      
      // 短消息多次处理都不会被标记为重复
      expect(router.isEchoMessage(event)).toBe(false);
      expect(router.isEchoMessage(event)).toBe(false);
      expect(router.isEchoMessage(event)).toBe(false);
    });
  });

  describe('缓存管理', () => {
    it('应该返回正确的缓存统计', () => {
      const stats = router.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.maxAge).toBe(0);
      
      // 添加长消息
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: 'x'.repeat(200),
        messageId: 'msg-1',
      };
      router.isEchoMessage(event);
      
      const newStats = router.getCacheStats();
      expect(newStats.size).toBe(1);
    });

    it('应该清空缓存', () => {
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: 'x'.repeat(200),
        messageId: 'msg-1',
      };
      router.isEchoMessage(event);
      
      expect(router.getCacheStats().size).toBe(1);
      
      router.clearCache();
      
      expect(router.getCacheStats().size).toBe(0);
    });
  });

  describe('运行时更新', () => {
    it('应该更新 F2A 实例', () => {
      const newPeerId = generateValidPeerId('Updated');
      const newF2A = createMockF2A(newPeerId);
      
      router.updateF2A(newF2A as unknown as import('../src/types.js').F2APublicInterface);
      
      // 更新后应该使用新的 peerId
      const event: F2AMessageEvent = {
        from: newPeerId,
        content: 'test',
        messageId: 'msg-1',
      };
      
      expect(router.isEchoMessage(event)).toBe(true);
    });

    it('应该更新 Logger', () => {
      const newLogger = createMockLogger();
      
      router.updateLogger(newLogger as unknown as import('../src/types.js').ApiLogger);
      
      // 验证更新后仍能正常工作
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: 'test',
        messageId: 'msg-1',
      };
      
      expect(router.isEchoMessage(event)).toBe(false);
    });
  });

  describe('边缘情况', () => {
    it('应该处理空内容', () => {
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: '',
        messageId: 'msg-1',
      };
      
      expect(router.isEchoMessage(event)).toBe(false);
    });

    it('应该处理长消息', () => {
      const longContent = 'x'.repeat(1000);
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: longContent,
        messageId: 'msg-1',
      };
      
      expect(router.isEchoMessage(event)).toBe(false);
    });

    it('应该处理特殊字符', () => {
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: '{"json": "data", "special": "字符"}',
        messageId: 'msg-1',
      };
      
      expect(router.isEchoMessage(event)).toBe(false);
    });

    it('应该处理无 metadata 的消息', () => {
      const event: F2AMessageEvent = {
        from: 'peer-1',
        content: 'test',
        messageId: 'msg-1',
      };
      
      expect(router.isEchoMessage(event)).toBe(false);
    });
  });
});