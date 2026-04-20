/**
 * 速率限制中间件
 * 基于 Token Bucket 算法实现，支持突发流量
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Logger } from './logger.js';

export interface RateLimitConfig {
  /** 最大请求数 */
  maxRequests: number;
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 是否跳过成功请求 */
  skipSuccessfulRequests?: boolean;
  /** 突发容量倍数（默认 1.5，允许短暂的请求爆发） */
  burstMultiplier?: number;
}

export interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

/**
 * 速率限制器
 * 实现 Disposable 接口，确保资源正确释放
 */
export class RateLimiter implements Disposable {
  private config: Required<RateLimitConfig>;
  private burstCapacity: number;
  private store: Map<string, RateLimitEntry> = new Map();
  private logger: Logger;
  private cleanupTimer?: NodeJS.Timeout;
  private disposed: boolean = false;

  constructor(config: RateLimitConfig) {
    this.config = {
      skipSuccessfulRequests: false,
      burstMultiplier: 1.5,
      ...config
    };
    // 计算突发容量
    this.burstCapacity = Math.floor(this.config.maxRequests * this.config.burstMultiplier);
    this.logger = new Logger({ component: 'RateLimiter' });
    // 自动启动清理定时器
    this.cleanupTimer = setInterval(() => this.cleanup(), config.windowMs);
    
    // 注册析构回调，确保即使 stop() 未调用也能清理资源
    if (typeof Symbol.dispose !== 'undefined') {
      // 支持 using 语法的自动清理
    }
  }

  /**
   * 实现 Disposable 接口
   * 确保资源被正确释放
   */
  [Symbol.dispose](): void {
    this.stop();
  }

  /**
   * 检查是否已释放
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * 停止速率限制器，清理资源
   * 幂等操作，可多次调用
   */
  stop(): void {
    if (this.disposed) {
      return; // 幂等：已释放则跳过
    }
    
    this.disposed = true;
    
    // 清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    // 清空存储，防止内存泄漏
    this.store.clear();
    
    this.logger.info('Rate limiter stopped and resources cleaned up');
  }

  /**
   * 检查是否允许请求
   * @param key 标识符（如 IP 地址、Peer ID）
   * @returns 是否允许请求
   */
  allowRequest(key: string): boolean {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry) {
      // 首次请求，初始化令牌桶
      // 初始令牌数为 maxRequests - 1（本次请求消耗 1 个）
      this.store.set(key, {
        tokens: this.config.maxRequests - 1,
        lastRefill: now
      });
      return true;
    }

    // 计算需要补充的令牌数
    const timePassed = now - entry.lastRefill;
    const tokensToAdd = Math.floor(
      (timePassed / this.config.windowMs) * this.config.maxRequests
    );

    if (tokensToAdd > 0) {
      // 令牌补充后不能超过突发容量
      entry.tokens = Math.min(
        this.burstCapacity,
        entry.tokens + tokensToAdd
      );
      entry.lastRefill = now;
    }

    // 检查是否有可用令牌
    if (entry.tokens > 0) {
      entry.tokens--;
      return true;
    }

    this.logger.warn('Rate limit exceeded', { 
      key, 
      remaining: entry.tokens,
      maxRequests: this.config.maxRequests,
      burstCapacity: this.burstCapacity
    });
    return false;
  }

  /**
   * 获取剩余令牌数
   */
  getRemainingTokens(key: string): number {
    const entry = this.store.get(key);
    if (!entry) return this.config.maxRequests;

    const now = Date.now();
    const timePassed = now - entry.lastRefill;
    const tokensToAdd = Math.floor(
      (timePassed / this.config.windowMs) * this.config.maxRequests
    );

    return Math.min(this.burstCapacity, entry.tokens + tokensToAdd);
  }

  /**
   * 重置限制
   */
  reset(key?: string): void {
    if (key) {
      this.store.delete(key);
    } else {
      this.store.clear();
    }
  }

  /**
   * 清理过期的条目
   */
  cleanup(): void {
    const now = Date.now();
    const maxAge = this.config.windowMs * 2;

    for (const [key, entry] of this.store) {
      if (now - entry.lastRefill > maxAge) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * 创建速率限制中间件（用于 HTTP 服务器）
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const limiter = new RateLimiter(config);

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const key = req.socket?.remoteAddress || 'unknown';

    if (!limiter.allowRequest(key)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED'
      }));
      return;
    }

    next();
  };

  // 提供 stop 方法清理资源
  middleware.stop = () => {
    limiter.stop();
  };

  return middleware;
}
