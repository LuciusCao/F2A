/**
 * 速率限制中间件
 * 基于 Token Bucket 算法实现
 */

import { Logger } from './logger.js';

export interface RateLimitConfig {
  /** 最大请求数 */
  maxRequests: number;
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 是否跳过成功请求 */
  skipSuccessfulRequests?: boolean;
}

export interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

/**
 * 速率限制器
 */
export class RateLimiter {
  private config: Required<RateLimitConfig>;
  private store: Map<string, RateLimitEntry> = new Map();
  private logger: Logger;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: RateLimitConfig) {
    this.config = {
      skipSuccessfulRequests: false,
      ...config
    };
    this.logger = new Logger({ component: 'RateLimiter' });
    // 自动启动清理定时器
    this.cleanupTimer = setInterval(() => this.cleanup(), config.windowMs);
  }

  /**
   * 停止速率限制器，清理资源
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.store.clear();
    this.logger.info('Rate limiter stopped');
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
      entry.tokens = Math.min(
        this.config.maxRequests,
        entry.tokens + tokensToAdd
      );
      entry.lastRefill = now;
    }

    // 检查是否有可用令牌
    if (entry.tokens > 0) {
      entry.tokens--;
      return true;
    }

    this.logger.warn('Rate limit exceeded', { key });
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

    return Math.min(this.config.maxRequests, entry.tokens + tokensToAdd);
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

  const middleware = (req: any, res: any, next: () => void) => {
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
