/**
 * F2A 认证中间件
 * 从 control-server.ts 提取的可复用认证逻辑
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { TokenManager, Logger, RateLimiter } from '@f2a/network';

/**
 * 认证结果
 */
export interface AuthResult {
  /** 提取的 token */
  token: string;
  /** 客户端 IP 地址 */
  clientIp: string;
}

/**
 * AuthMiddleware 依赖项
 */
export interface AuthMiddlewareDeps {
  /** Token 管理器 */
  tokenManager: TokenManager;
  /** 日志记录器 */
  logger: Logger;
  /** 可选的速率限制器 */
  rateLimiter?: RateLimiter;
}

/**
 * 认证中间件
 * 提供统一的认证逻辑，支持 X-F2A-Token 和 Authorization: Bearer 两种认证方式
 */
export class AuthMiddleware {
  constructor(private deps: AuthMiddlewareDeps) {}

  /**
   * 从 Authorization header 提取 Bearer token
   * @param authHeader Authorization header 值
   * @returns Bearer token 或 undefined
   */
  extractBearerToken(authHeader: string | undefined): string | undefined {
    if (!authHeader) return undefined;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : undefined;
  }

  /**
   * 从请求中提取客户端 IP 地址
   * @param req HTTP 请求
   * @returns 客户端 IP 地址
   */
  extractClientIp(req: IncomingMessage): string {
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * 从请求中提取 token
   * 支持 X-F2A-Token header 和 Authorization: Bearer 两种方式
   * @param req HTTP 请求
   * @returns token 或 undefined
   */
  extractToken(req: IncomingMessage): string | undefined {
    return (
      (req.headers['x-f2a-token'] as string | undefined) ||
      this.extractBearerToken(req.headers.authorization)
    );
  }

  /**
   * 验证请求，返回认证结果或发送错误响应
   * @param req HTTP 请求
   * @param res HTTP 响应
   * @returns 认证成功返回 AuthResult，失败返回 null（已发送响应）
   */
  authenticate(req: IncomingMessage, res: ServerResponse): AuthResult | null {
    const clientIp = this.extractClientIp(req);
    const token = this.extractToken(req);

    if (!this.deps.tokenManager.verifyToken(token)) {
      this.deps.logger.warn('Unauthorized request', { clientIp });
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
        })
      );
      return null;
    }

    return { token: token!, clientIp };
  }

  /**
   * 高阶函数：包装需要认证的 handler
   * 自动处理认证失败响应
   * @param handler 需要认证的处理函数
   * @returns 包装后的处理函数
   */
  withAuth<T>(
    handler: (req: IncomingMessage, res: ServerResponse, auth: AuthResult) => T
  ): (req: IncomingMessage, res: ServerResponse) => T | null {
    return (req: IncomingMessage, res: ServerResponse): T | null => {
      const auth = this.authenticate(req, res);
      if (!auth) {
        return null; // 认证失败，响应已发送
      }
      return handler(req, res, auth);
    };
  }

  /**
   * 速率限制检查
   * @param req HTTP 请求
   * @param res HTTP 响应
   * @returns true 表示允许请求，false 表示超出限制（已发送响应）
   */
  checkRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.deps.rateLimiter) {
      return true; // 没有配置速率限制器，默认允许
    }

    const clientIp = this.extractClientIp(req);
    if (!this.deps.rateLimiter.allowRequest(clientIp)) {
      this.deps.logger.warn('Rate limit exceeded', { clientIp });
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
        })
      );
      return false;
    }

    return true;
  }

  /**
   * 组合认证和速率限制检查
   * 按顺序执行：先检查速率限制，再进行认证
   * @param req HTTP 请求
   * @param res HTTP 响应
   * @returns 认证成功返回 AuthResult，失败返回 null（已发送响应）
   */
  authenticateWithRateLimit(
    req: IncomingMessage,
    res: ServerResponse
  ): AuthResult | null {
    // 先检查速率限制
    if (!this.checkRateLimit(req, res)) {
      return null;
    }

    // 再进行认证
    return this.authenticate(req, res);
  }

  /**
   * 高阶函数：包装需要认证和速率限制的 handler
   * 自动处理速率限制和认证失败响应
   * @param handler 需要认证的处理函数
   * @returns 包装后的处理函数
   */
  withAuthAndRateLimit<T>(
    handler: (req: IncomingMessage, res: ServerResponse, auth: AuthResult) => T
  ): (req: IncomingMessage, res: ServerResponse) => T | null {
    return (req: IncomingMessage, res: ServerResponse): T | null => {
      const auth = this.authenticateWithRateLimit(req, res);
      if (!auth) {
        return null; // 认证或速率限制失败，响应已发送
      }
      return handler(req, res, auth);
    };
  }
}