import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter, createRateLimitMiddleware, RateLimitConfig } from './rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;
  const config: RateLimitConfig = {
    maxRequests: 5,
    windowMs: 1000, // 1 秒
  };

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter(config);
  });

  afterEach(() => {
    limiter.stop();
    vi.useRealTimers();
  });

  describe('基本功能', () => {
    it('应该允许首次请求', () => {
      const result = limiter.allowRequest('test-key');
      expect(result).toBe(true);
    });

    it('应该在达到限制时拒绝请求', () => {
      // 允许 5 次请求
      for (let i = 0; i < 5; i++) {
        expect(limiter.allowRequest('test-key')).toBe(true);
      }
      // 第 6 次应该被拒绝
      expect(limiter.allowRequest('test-key')).toBe(false);
    });

    it('应该独立计算不同的 key', () => {
      // key1 允许 5 次
      for (let i = 0; i < 5; i++) {
        expect(limiter.allowRequest('key1')).toBe(true);
      }
      // key2 也应该允许 5 次
      for (let i = 0; i < 5; i++) {
        expect(limiter.allowRequest('key2')).toBe(true);
      }
      // 两个 key 都应该被限制
      expect(limiter.allowRequest('key1')).toBe(false);
      expect(limiter.allowRequest('key2')).toBe(false);
    });
  });

  describe('令牌补充', () => {
    it('应该在时间窗口后补充令牌', () => {
      // 消耗所有令牌
      for (let i = 0; i < 5; i++) {
        limiter.allowRequest('test-key');
      }
      expect(limiter.allowRequest('test-key')).toBe(false);

      // 前进 1 秒
      vi.advanceTimersByTime(1000);

      // 应该重新允许请求
      expect(limiter.allowRequest('test-key')).toBe(true);
    });

    it('应该正确计算部分补充的令牌', () => {
      // 消耗所有令牌
      for (let i = 0; i < 5; i++) {
        limiter.allowRequest('test-key');
      }
      expect(limiter.allowRequest('test-key')).toBe(false);

      // 前进 500ms（半窗口）
      vi.advanceTimersByTime(500);

      // 应该补充约 2-3 个令牌
      expect(limiter.allowRequest('test-key')).toBe(true);
    });
  });

  describe('突发容量', () => {
    it('应该允许突发流量', () => {
      // 创建一个允许突发的限制器
      const burstLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 1000,
        burstMultiplier: 2,
      });

      // 保存令牌（不消耗）
      burstLimiter.allowRequest('test-key');
      vi.advanceTimersByTime(2000); // 2 秒后

      // 应该有更多令牌可用（突发容量）
      const remaining = burstLimiter.getRemainingTokens('test-key');
      expect(remaining).toBeGreaterThan(5);

      burstLimiter.stop();
    });
  });

  describe('getRemainingTokens', () => {
    it('应该返回初始令牌数', () => {
      const remaining = limiter.getRemainingTokens('new-key');
      expect(remaining).toBe(5);
    });

    it('应该返回正确的剩余令牌数', () => {
      limiter.allowRequest('test-key');
      limiter.allowRequest('test-key');
      const remaining = limiter.getRemainingTokens('test-key');
      expect(remaining).toBe(3);
    });
  });

  describe('reset', () => {
    it('应该重置指定 key', () => {
      for (let i = 0; i < 5; i++) {
        limiter.allowRequest('test-key');
      }
      expect(limiter.allowRequest('test-key')).toBe(false);

      limiter.reset('test-key');

      expect(limiter.allowRequest('test-key')).toBe(true);
    });

    it('应该重置所有 key', () => {
      for (let i = 0; i < 5; i++) {
        limiter.allowRequest('key1');
        limiter.allowRequest('key2');
      }
      expect(limiter.allowRequest('key1')).toBe(false);
      expect(limiter.allowRequest('key2')).toBe(false);

      limiter.reset();

      expect(limiter.allowRequest('key1')).toBe(true);
      expect(limiter.allowRequest('key2')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('应该清理过期条目', () => {
      limiter.allowRequest('old-key');
      
      // 前进超过 2 个窗口时间
      vi.advanceTimersByTime(2500);
      
      limiter.cleanup();
      
      // old-key 应该被清理，重新开始计数
      expect(limiter.allowRequest('old-key')).toBe(true);
    });
  });

  describe('资源管理', () => {
    it('应该能够停止', () => {
      limiter.stop();
      expect(limiter.isDisposed()).toBe(true);
    });

    it('应该可以多次调用 stop', () => {
      limiter.stop();
      limiter.stop();
      limiter.stop();
      expect(limiter.isDisposed()).toBe(true);
    });

    it('应该支持 dispose 模式', () => {
      const disposableLimiter = new RateLimiter(config);
      expect(disposableLimiter.isDisposed()).toBe(false);
      disposableLimiter.stop();
      expect(disposableLimiter.isDisposed()).toBe(true);
    });
  });
});

describe('createRateLimitMiddleware', () => {
  it('应该创建中间件函数', () => {
    const middleware = createRateLimitMiddleware({
      maxRequests: 5,
      windowMs: 1000,
    });
    expect(typeof middleware).toBe('function');
    expect(typeof middleware.stop).toBe('function');
  });

  it('应该允许正常请求', () => {
    const middleware = createRateLimitMiddleware({
      maxRequests: 5,
      windowMs: 1000,
    });

    const req = { socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.writeHead).not.toHaveBeenCalled();

    middleware.stop();
  });

  it('应该拒绝超限请求', () => {
    const middleware = createRateLimitMiddleware({
      maxRequests: 2,
      windowMs: 1000,
    });

    const req = { socket: { remoteAddress: '127.0.0.1' } };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    // 发送 2 次请求
    middleware(req, res, next);
    middleware(req, res, next);

    // 第 3 次应该被拒绝
    middleware(req, res, next);

    expect(res.writeHead).toHaveBeenCalledWith(429, { 'Content-Type': 'application/json' });
    expect(res.end).toHaveBeenCalled();

    middleware.stop();
  });

  it('应该处理没有 remoteAddress 的请求', () => {
    const middleware = createRateLimitMiddleware({
      maxRequests: 5,
      windowMs: 1000,
    });

    const req = { socket: {} };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();

    middleware.stop();
  });
});