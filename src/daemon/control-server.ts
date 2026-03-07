/**
 * HTTP 控制服务器
 * 接收 CLI 命令 - P2P 版本
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { F2A } from '../core/f2a';
import { TokenManager } from '../core/token-manager';
import { Logger } from '../utils/logger';
import { RateLimiter } from '../utils/rate-limiter';

export interface ControlServerOptions {
  port: number;
  token?: string;
  /** 允许的 CORS 来源列表，默认为 ['http://localhost'] */
  allowedOrigins?: string[];
}

/** 默认允许的 CORS 来源 */
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost'];

export class ControlServer {
  private server?: Server;
  private f2a: F2A;
  private port: number;
  private tokenManager: TokenManager;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private allowedOrigins: string[];

  constructor(f2a: F2A, port: number, tokenManager?: TokenManager, options?: ControlServerOptions) {
    this.f2a = f2a;
    this.port = port;
    this.tokenManager = tokenManager || new TokenManager();
    this.logger = new Logger({ component: 'ControlServer' });
    // 速率限制: 每分钟最多 60 个请求
    this.rateLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60000 });
    // CORS 配置：优先使用传入的 allowedOrigins，否则使用默认值
    this.allowedOrigins = options?.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  }

  /**
   * 启动控制服务器
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);

      this.server.listen(this.port, () => {
        this.logger.info('Listening', { port: this.port });
        resolve();
      });
    });
  }

  /**
   * 停止控制服务器
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    // 清理速率限制器资源
    this.rateLimiter.stop();
    this.logger.info('Stopped');
  }

  /**
   * 处理请求
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // 设置 CORS - 使用配置的允许来源
    const origin = req.headers.origin;
    const allowOrigin = origin && this.allowedOrigins.includes(origin) 
      ? origin 
      : this.allowedOrigins[0];
    
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-F2A-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED'
      }));
      return;
    }

    // 速率限制检查
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (!this.rateLimiter.allowRequest(clientIp)) {
      this.logger.warn('Rate limit exceeded', { clientIp });
      res.writeHead(429);
      res.end(JSON.stringify({
        success: false,
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED'
      }));
      return;
    }

    // 验证 Token
    const token = req.headers['x-f2a-token'] as string | undefined;
    
    if (!this.tokenManager.verifyToken(token)) {
      // 记录失败的验证尝试
      this.tokenManager.logTokenUsage({
        ip: clientIp,
        action: 'auth',
        success: false
      });
      
      this.logger.warn('Unauthorized request', { clientIp });
      res.writeHead(401);
      res.end(JSON.stringify({
        success: false,
        error: 'Unauthorized: Invalid or missing token',
        code: 'UNAUTHORIZED'
      }));
      return;
    }
    
    // 记录成功的验证
    this.tokenManager.logTokenUsage({
      ip: clientIp,
      action: 'auth',
      success: true
    });

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      this.processCommand(body, res);
    });
  }

  /**
   * 处理命令
   */
  private processCommand(body: string, res: ServerResponse): void {
    try {
      const command = JSON.parse(body);
      
      switch (command.action) {
        case 'status':
          this.handleStatus(res);
          break;
        case 'peers':
          this.handlePeers(res);
          break;
        case 'discover':
          this.handleDiscover(command.capability, res);
          break;
        default:
          res.writeHead(400);
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Unknown action',
            code: 'UNKNOWN_ACTION'
          }));
      }
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Invalid JSON',
        code: 'INVALID_JSON'
      }));
    }
  }

  /**
   * 获取状态
   */
  private handleStatus(res: ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      peerId: this.f2a.peerId,
      agentInfo: this.f2a.agentInfo
    }));
  }

  /**
   * 获取已连接的 Peers
   */
  private handlePeers(res: ServerResponse): void {
    const peers = this.f2a.getConnectedPeers();
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      peers
    }));
  }

  /**
   * 发现 Agents
   */
  private async handleDiscover(capability: string | undefined, res: ServerResponse): Promise<void> {
    try {
      const agents = await this.f2a.discoverAgents(capability);
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        agents
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'DISCOVER_FAILED'
      }));
    }
  }
}
