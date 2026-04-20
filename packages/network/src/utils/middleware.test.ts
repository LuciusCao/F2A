/**
 * Middleware 系统测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  MiddlewareManager, 
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
  createMessageSizeLimitMiddleware,
  createMessageTypeFilterMiddleware,
  createMessageLoggingMiddleware,
  createMessageTransformMiddleware
} from './middleware.js';
import { F2AMessage } from '../types/index.js';
import { Logger } from './logger.js';

// Mock Logger
vi.mock('./logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('MiddlewareManager', () => {
  let manager: MiddlewareManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MiddlewareManager();
  });

  // ========== 管理方法测试 ==========

  describe('use()', () => {
    it('should register middleware', () => {
      const middleware: Middleware = {
        name: 'test',
        process: (ctx) => ({ action: 'continue', context: ctx }),
      };

      manager.use(middleware);
      
      expect(manager.list()).toContain('test');
    });

    it('should register multiple middlewares', () => {
      manager.use({ name: 'm1', process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'm2', process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'm3', process: (ctx) => ({ action: 'continue', context: ctx }) });

      expect(manager.list()).toHaveLength(3);
      expect(manager.list()).toContain('m1');
      expect(manager.list()).toContain('m2');
      expect(manager.list()).toContain('m3');
    });

    it('should sort by priority', () => {
      manager.use({ name: 'low', priority: 100, process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'high', priority: 10, process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'medium', priority: 50, process: (ctx) => ({ action: 'continue', context: ctx }) });

      const list = manager.list();
      expect(list).toEqual(['high', 'medium', 'low']);
    });

    it('should handle middleware without priority (default 0)', () => {
      manager.use({ name: 'no-priority', process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'low', priority: 100, process: (ctx) => ({ action: 'continue', context: ctx }) });

      const list = manager.list();
      expect(list[0]).toBe('no-priority');
      expect(list[1]).toBe('low');
    });
  });

  describe('remove()', () => {
    it('should remove existing middleware', () => {
      manager.use({ name: 'test', process: (ctx) => ({ action: 'continue', context: ctx }) });
      
      const result = manager.remove('test');
      
      expect(result).toBe(true);
      expect(manager.list()).not.toContain('test');
    });

    it('should return false for non-existing middleware', () => {
      const result = manager.remove('non-existing');
      
      expect(result).toBe(false);
    });

    it('should remove correct middleware when multiple exist', () => {
      manager.use({ name: 'm1', process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'm2', process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'm3', process: (ctx) => ({ action: 'continue', context: ctx }) });

      manager.remove('m2');
      
      expect(manager.list()).toEqual(['m1', 'm3']);
    });
  });

  describe('list()', () => {
    it('should return empty array when no middlewares', () => {
      expect(manager.list()).toEqual([]);
    });

    it('should return all middleware names', () => {
      manager.use({ name: 'a', process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'b', process: (ctx) => ({ action: 'continue', context: ctx }) });

      expect(manager.list()).toHaveLength(2);
    });
  });

  describe('clear()', () => {
    it('should clear all middlewares', () => {
      manager.use({ name: 'm1', process: (ctx) => ({ action: 'continue', context: ctx }) });
      manager.use({ name: 'm2', process: (ctx) => ({ action: 'continue', context: ctx }) });

      manager.clear();
      
      expect(manager.list()).toEqual([]);
    });
  });

  // ========== 执行链测试 ==========

  describe('execute()', () => {
    const createContext = (): MiddlewareContext => ({
      message: {
        id: 'msg-1',
        type: 'MESSAGE',
        from: 'peer-1',
        to: 'peer-2',
        timestamp: Date.now(),
        payload: { content: 'test' },
      },
      peerId: 'peer-1',
      metadata: new Map(),
    });

    it('should return continue when no middlewares', async () => {
      const ctx = createContext();
      
      const result = await manager.execute(ctx);
      
      expect(result.action).toBe('continue');
      expect(result.context).toBe(ctx);
    });

    it('should execute single middleware that continues', async () => {
      const ctx = createContext();
      manager.use({
        name: 'test',
        process: (c) => ({ action: 'continue', context: c }),
      });

      const result = await manager.execute(ctx);
      
      expect(result.action).toBe('continue');
    });

    it('should execute multiple middlewares in order', async () => {
      const order: string[] = [];
      manager.use({
        name: 'm1',
        priority: 10,
        process: (c) => {
          order.push('m1');
          return { action: 'continue', context: c };
        },
      });
      manager.use({
        name: 'm2',
        priority: 20,
        process: (c) => {
          order.push('m2');
          return { action: 'continue', context: c };
        },
      });

      await manager.execute(createContext());
      
      expect(order).toEqual(['m1', 'm2']);
    });

    it('should stop chain when middleware drops', async () => {
      const order: string[] = [];
      manager.use({
        name: 'dropper',
        priority: 10,
        process: () => ({ action: 'drop', reason: 'test drop' }),
      });
      manager.use({
        name: 'never-reached',
        priority: 20,
        process: (c) => {
          order.push('never-reached');
          return { action: 'continue', context: c };
        },
      });

      const result = await manager.execute(createContext());
      
      expect(result.action).toBe('drop');
      expect(result.reason).toBe('test drop');
      expect(order).toEqual([]);
    });

    it('should modify context and pass to next middleware', async () => {
      const ctx = createContext();
      manager.use({
        name: 'modifier',
        priority: 10,
        process: (c) => ({
          action: 'modify',
          context: {
            ...c,
            message: { ...c.message, type: 'MODIFIED' },
          },
        }),
      });
      manager.use({
        name: 'checker',
        priority: 20,
        process: (c) => {
          expect(c.message.type).toBe('MODIFIED');
          return { action: 'continue', context: c };
        },
      });

      const result = await manager.execute(ctx);
      
      expect(result.action).toBe('continue');
      expect(result.context.message.type).toBe('MODIFIED');
    });

    it('should handle async middleware', async () => {
      manager.use({
        name: 'async',
        process: async (c) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { action: 'continue', context: c };
        },
      });

      const result = await manager.execute(createContext());
      
      expect(result.action).toBe('continue');
    });
  });

  // ========== 异常处理测试 ==========

  describe('error handling', () => {
    const createContext = (): MiddlewareContext => ({
      message: {
        id: 'msg-1',
        type: 'MESSAGE',
        from: 'peer-1',
        to: 'peer-2',
        timestamp: Date.now(),
        payload: {},
      },
      peerId: 'peer-1',
      metadata: new Map(),
    });

    it('should continue chain when optional middleware throws', async () => {
      const order: string[] = [];
      manager.use({
        name: 'thrower',
        type: 'optional',
        priority: 10,
        process: () => {
          throw new Error('test error');
        },
      });
      manager.use({
        name: 'after-throw',
        priority: 20,
        process: (c) => {
          order.push('after-throw');
          return { action: 'continue', context: c };
        },
      });

      const result = await manager.execute(createContext());
      
      expect(result.action).toBe('continue');
      expect(order).toContain('after-throw');
    });

    it('should drop when essential middleware throws', async () => {
      manager.use({
        name: 'essential-thrower',
        type: 'essential',
        process: () => {
          throw new Error('essential error');
        },
      });

      const result = await manager.execute(createContext());
      
      expect(result.action).toBe('drop');
      expect(result.reason).toContain('essential error');
    });

    it('should treat middleware without type as optional', async () => {
      manager.use({
        name: 'default-thrower',
        // no type specified
        process: () => {
          throw new Error('default error');
        },
      });
      manager.use({
        name: 'after',
        priority: 20,
        process: (c) => ({ action: 'continue', context: c }),
      });

      const result = await manager.execute(createContext());
      
      expect(result.action).toBe('continue');
    });
  });
});

// ========== 内置中间件测试 ==========

describe('createMessageSizeLimitMiddleware', () => {
  const createMessage = (size: number): F2AMessage => ({
    id: 'msg-1',
    type: 'MESSAGE',
    from: 'peer-1',
    to: 'peer-2',
    timestamp: Date.now(),
    payload: { content: 'x'.repeat(size) },
  });

  it('should continue when size is under limit', () => {
    const middleware = createMessageSizeLimitMiddleware(1000);
    const ctx: MiddlewareContext = {
      message: createMessage(100),
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('continue');
  });

  it('should drop when size exceeds limit', () => {
    const middleware = createMessageSizeLimitMiddleware(100);
    const ctx: MiddlewareContext = {
      message: createMessage(200),
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('drop');
    expect(result.reason).toContain('exceeds limit');
  });

  it('should handle message near limit', () => {
    const middleware = createMessageSizeLimitMiddleware(200);
    const ctx: MiddlewareContext = {
      message: createMessage(20), // Small enough with JSON overhead
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('continue');
  });

  it('should have correct priority', () => {
    const middleware = createMessageSizeLimitMiddleware(1000);
    
    expect(middleware.priority).toBe(100);
    expect(middleware.name).toBe('MessageSizeLimit');
  });
});

describe('createMessageTypeFilterMiddleware', () => {
  const createMessage = (type: string): F2AMessage => ({
    id: 'msg-1',
    type,
    from: 'peer-1',
    to: 'peer-2',
    timestamp: Date.now(),
    payload: {},
  });

  it('should continue for allowed types', () => {
    const middleware = createMessageTypeFilterMiddleware(['MESSAGE', 'DISCOVER']);
    const ctx: MiddlewareContext = {
      message: createMessage('MESSAGE'),
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('continue');
  });

  it('should drop for non-allowed types', () => {
    const middleware = createMessageTypeFilterMiddleware(['MESSAGE']);
    const ctx: MiddlewareContext = {
      message: createMessage('DISCOVER'),
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('drop');
    expect(result.reason).toContain('not allowed');
  });

  it('should handle empty allowed types (all blocked)', () => {
    const middleware = createMessageTypeFilterMiddleware([]);
    const ctx: MiddlewareContext = {
      message: createMessage('MESSAGE'),
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('drop');
  });

  it('should have correct priority', () => {
    const middleware = createMessageTypeFilterMiddleware(['MESSAGE']);
    
    expect(middleware.priority).toBe(90);
    expect(middleware.name).toBe('MessageTypeFilter');
  });
});

describe('createMessageLoggingMiddleware', () => {
  it('should always continue', () => {
    const middleware = createMessageLoggingMiddleware();
    const ctx: MiddlewareContext = {
      message: {
        id: 'msg-1',
        type: 'MESSAGE',
        from: 'peer-1',
        to: 'peer-2',
        timestamp: Date.now(),
        payload: {},
      },
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('continue');
  });

  it('should use provided logger', () => {
    const mockLogger = { debug: vi.fn() } as unknown as Logger;
    const middleware = createMessageLoggingMiddleware(mockLogger);
    const ctx: MiddlewareContext = {
      message: {
        id: 'msg-1',
        type: 'MESSAGE',
        from: 'peer-1',
        to: 'peer-2',
        timestamp: Date.now(),
        payload: {},
      },
      peerId: 'peer-1',
      metadata: new Map(),
    };

    middleware.process(ctx);
    
    expect(mockLogger.debug).toHaveBeenCalled();
  });

  it('should have correct priority', () => {
    const middleware = createMessageLoggingMiddleware();
    
    expect(middleware.priority).toBe(50);
    expect(middleware.name).toBe('MessageLogger');
  });
});

describe('createMessageTransformMiddleware', () => {
  it('should transform message', () => {
    const transform = (msg: F2AMessage): F2AMessage => ({
      ...msg,
      type: 'TRANSFORMED',
    });
    const middleware = createMessageTransformMiddleware(transform);
    const ctx: MiddlewareContext = {
      message: {
        id: 'msg-1',
        type: 'MESSAGE',
        from: 'peer-1',
        to: 'peer-2',
        timestamp: Date.now(),
        payload: {},
      },
      peerId: 'peer-1',
      metadata: new Map(),
    };

    const result = middleware.process(ctx);
    
    expect(result.action).toBe('modify');
    expect(result.context.message.type).toBe('TRANSFORMED');
  });

  it('should preserve other context fields', () => {
    const transform = (msg: F2AMessage) => msg;
    const middleware = createMessageTransformMiddleware(transform);
    const ctx: MiddlewareContext = {
      message: { id: 'msg-1', type: 'MESSAGE', from: 'peer-1', to: 'peer-2', timestamp: 1, payload: {} },
      peerId: 'peer-1',
      agentInfo: { agentId: 'agent-1', name: 'Test' },
      metadata: new Map([['key', 'value']]),
    };

    const result = middleware.process(ctx);
    
    expect(result.context.peerId).toBe('peer-1');
    expect(result.context.agentInfo?.agentId).toBe('agent-1');
    expect(result.context.metadata.get('key')).toBe('value');
  });

  it('should have correct priority', () => {
    const middleware = createMessageTransformMiddleware((msg) => msg);
    
    expect(middleware.priority).toBe(10);
    expect(middleware.name).toBe('MessageTransform');
  });
});