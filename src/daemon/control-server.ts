/**
 * HTTP 控制服务器
 * 接收 CLI 命令 - P2P 版本
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { F2A } from '../core/f2a.js';
import { TokenManager } from '../core/token-manager.js';
import { Logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';

export interface ControlServerOptions {
  port: number;
  token?: string;
}

export class ControlServer {
  private server?: Server;
  private f2a: F2A;
  private port: number;
  private tokenManager: TokenManager;
  private logger: Logger;
  private rateLimiter: RateLimiter;

  constructor(f2a: F2A, port: number, tokenManager?: TokenManager) {
    this.f2a = f2a;
    this.port = port;
    this.tokenManager = tokenManager || new TokenManager();
    this.logger = new Logger({ component: 'ControlServer' });
    // 速率限制: 每分钟最多 60 个请求
    this.rateLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60000 });
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
   * 从 Authorization header 提取 Bearer token
   */
  private extractBearerToken(authHeader: string | undefined): string | undefined {
    if (!authHeader) return undefined;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : undefined;
  }

  /**
   * 处理请求
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-F2A-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // 健康检查端点 (不需要认证)
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', peerId: this.f2a.peerId }));
      return;
    }

    // GET /status - 获取状态 (需要认证)
    if (req.method === 'GET' && req.url === '/status') {
      const clientIp = req.socket.remoteAddress || 'unknown';
      if (!this.rateLimiter.allowRequest(clientIp)) {
        res.writeHead(429);
        res.end(JSON.stringify({ success: false, error: 'Too many requests' }));
        return;
      }
      // 支持 X-F2A-Token 或 Authorization: Bearer xxx
      const token = req.headers['x-f2a-token'] as string | undefined 
        || this.extractBearerToken(req.headers.authorization);
      if (!this.tokenManager.verifyToken(token)) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        peerId: this.f2a.peerId,
        multiaddrs: this.f2a.agentInfo.multiaddrs || []
      }));
      return;
    }

    // GET /peers - 获取已知的 Peers (需要认证)
    if (req.method === 'GET' && req.url === '/peers') {
      const clientIp = req.socket.remoteAddress || 'unknown';
      if (!this.rateLimiter.allowRequest(clientIp)) {
        res.writeHead(429);
        res.end(JSON.stringify({ success: false, error: 'Too many requests' }));
        return;
      }
      // 支持 X-F2A-Token 或 Authorization: Bearer xxx
      const token = req.headers['x-f2a-token'] as string | undefined 
        || this.extractBearerToken(req.headers.authorization);
      if (!this.tokenManager.verifyToken(token)) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
        return;
      }
      // 返回所有已知的节点（包括已断开但已发现的）
      const peers = this.f2a.getAllPeers();
      res.writeHead(200);
      res.end(JSON.stringify(peers));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }
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
      this.logger.warn('Unauthorized request', { clientIp });
      res.writeHead(401);
      res.end(JSON.stringify({
        success: false,
        error: 'Unauthorized: Invalid or missing token',
        code: 'UNAUTHORIZED'
      }));
      return;
    }

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
          res.end(JSON.stringify({ success: false, error: 'Unknown action' }));
      }
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
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
        error: String(error)
      }));
    }
  }
}
