/**
 * HTTP 控制服务器
 * 接收 CLI 命令 - P2P 版本
 * 
 * Phase 1 扩展：支持 Agent 注册和消息路由
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { F2A } from '@f2a/network';
import { TokenManager } from '@f2a/network';
import { Logger } from '@f2a/network';
import { RateLimiter } from '@f2a/network';
import { getErrorMessage } from '@f2a/network';
import { AgentRegistry, AgentRegistration } from './agent-registry.js';
import { MessageRouter, RoutableMessage } from './message-router.js';
import type { AgentCapability } from '@f2a/network';

export interface ControlServerOptions {
  /** 端口，如果不传则使用构造函数传入的 port */
  port?: number;
  token?: string;
  /** 数据目录，用于存储 token 等文件 */
  dataDir?: string;
  /** 允许的 CORS 来源列表，默认为 ['http://localhost'] */
  allowedOrigins?: string[];
}

/** 默认允许的 CORS 来源 */
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost'];

/** P2-1 修复：最大请求体大小 (1MB) */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * P2 修复：生产环境 CORS 配置验证
 * 检查是否在生产环境使用了宽松的 CORS 配置
 * P2-4 修复：在严格模式下禁止 localhost
 */
function validateCorsConfig(allowedOrigins: string[]): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const isStrictMode = process.env.F2A_STRICT_CORS === 'true';
  
  if (isProduction || isStrictMode) {
    // 检查是否使用默认配置
    if (allowedOrigins.length === 1 && allowedOrigins[0] === 'http://localhost') {
      const logger = new Logger({ component: 'ControlServer' });
      if (isStrictMode) {
        // P2-4 修复：严格模式下禁止 localhost
        logger.error('CORS configuration error: localhost origin is not allowed in strict mode!');
        throw new Error('Localhost CORS origin is not allowed in strict mode (F2A_STRICT_CORS=true). Configure specific allowed origins.');
      }
      logger.error('CORS configuration warning: Using default localhost origin in production!');
      logger.error('Set F2A_ALLOWED_ORIGINS environment variable or pass allowedOrigins option.');
      logger.error('Example: F2A_ALLOWED_ORIGINS=https://your-domain.com,https://api.your-domain.com');
    }
    
    // 检查是否包含通配符或过于宽松的配置
    if (allowedOrigins.includes('*')) {
      const logger = new Logger({ component: 'ControlServer' });
      logger.error('CORS configuration error: Wildcard origin (*) is not allowed in production!');
      throw new Error('Wildcard CORS origin is not allowed in production. Configure specific allowed origins.');
    }
    
    // 检查是否包含 localhost
    if (allowedOrigins.some(o => o.includes('localhost') || o.includes('127.0.0.1'))) {
      const logger = new Logger({ component: 'ControlServer' });
      // P2-4 修复：严格模式下禁止 localhost
      if (isStrictMode) {
        logger.error('CORS configuration error: localhost/127.0.0.1 origins are not allowed in strict mode!');
        throw new Error('Localhost/127.0.0.1 CORS origins are not allowed in strict mode (F2A_STRICT_CORS=true). Configure specific allowed origins.');
      }
      logger.warn('CORS configuration warning: localhost/127.0.0.1 origins in production may be a security risk.');
    }
  }
}

export class ControlServer {
  private server?: Server;
  private f2a: F2A;
  private port: number;
  private tokenManager: TokenManager;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private allowedOrigins: string[];
  
  // Phase 1: Agent 注册表和消息路由器
  private agentRegistry: AgentRegistry;
  private messageRouter: MessageRouter;

  constructor(f2a: F2A, port: number, tokenManager?: TokenManager, options?: ControlServerOptions) {
    this.f2a = f2a;
    this.port = port;
    // 使用传入的 dataDir 创建 TokenManager
    this.tokenManager = tokenManager || new TokenManager(options?.dataDir);
    this.logger = new Logger({ component: 'ControlServer' });
    // 速率限制: 每分钟最多 60 个请求
    this.rateLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60000 });
    // CORS 配置：优先使用传入的 allowedOrigins，否则使用默认值
    // 支持从环境变量 F2A_ALLOWED_ORIGINS 读取（逗号分隔）
    const envOrigins = process.env.F2A_ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
    this.allowedOrigins = options?.allowedOrigins ?? envOrigins ?? DEFAULT_ALLOWED_ORIGINS;
    
    // P2 修复：生产环境强制验证 CORS 配置
    validateCorsConfig(this.allowedOrigins);
    
    // Phase 1: 初始化 Agent 注册表和消息路由器
    this.agentRegistry = new AgentRegistry();
    this.messageRouter = new MessageRouter(
      // 使用 getter 来访问注册表，因为 Map 是引用类型
      new Map<string, AgentRegistration>()
    );
  }
  
  /**
   * 获取 Agent 注册表（供外部访问）
   */
  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }
  
  /**
   * 获取消息路由器（供外部访问）
   */
  getMessageRouter(): MessageRouter {
    return this.messageRouter;
  }

  /**
   * 启动控制服务器
   */
  start(): Promise<void> {
    // 确保 token 已生成（便于 CLI 连接）
    this.tokenManager.getToken();
    
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
// 设置 CORS - 使用配置的允许来源
    const origin = req.headers.origin;
    const allowOrigin = origin && this.allowedOrigins.includes(origin) 
      ? origin 
      : this.allowedOrigins[0];
    
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-F2A-Token, Authorization');

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

    // ========== Phase 1: Agent 注册接口 ==========
    
    // GET /api/agents - 列出所有注册的 Agent
    if (req.method === 'GET' && req.url === '/api/agents') {
      this.handleListAgents(res);
      return;
    }
    
    // POST /api/agents - 注册 Agent
    if (req.method === 'POST' && req.url === '/api/agents') {
      this.handleRegisterAgent(req, res);
      return;
    }
    
    // DELETE /api/agents/:agentId - 注销 Agent
    const deleteAgentMatch = req.url?.match(/^\/api\/agents\/([^\/]+)$/);
    if (req.method === 'DELETE' && deleteAgentMatch) {
      this.handleUnregisterAgent(deleteAgentMatch[1], res);
      return;
    }
    
    // GET /api/agents/:agentId - 获取 Agent 信息
    const getAgentMatch = req.url?.match(/^\/api\/agents\/([^\/]+)$/);
    if (req.method === 'GET' && getAgentMatch) {
      this.handleGetAgent(getAgentMatch[1], res);
      return;
    }
    
    // ========== Phase 1: 消息接口 ==========
    
    // POST /api/messages - 发送消息
    if (req.method === 'POST' && req.url === '/api/messages') {
      this.handleSendMessage(req, res);
      return;
    }
    
    // GET /api/messages/:agentId - 获取 Agent 的消息队列
    const getMessagesMatch = req.url?.match(/^\/api\/messages\/([^\/]+)$/);
    if (req.method === 'GET' && getMessagesMatch) {
      this.handleGetMessages(getMessagesMatch[1], req, res);
      return;
    }
    
    // DELETE /api/messages/:agentId - 清除消息
    const clearMessagesMatch = req.url?.match(/^\/api\/messages\/([^\/]+)$/);
    if (req.method === 'DELETE' && clearMessagesMatch) {
      this.handleClearMessages(clearMessagesMatch[1], req, res);
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

    // POST /register-capability - 注册能力 (需要认证)
    if (req.method === 'POST' && req.url === '/register-capability') {
      const clientIp = req.socket.remoteAddress || 'unknown';
      const token = req.headers['x-f2a-token'] as string | undefined 
        || this.extractBearerToken(req.headers.authorization);
      if (!this.tokenManager.verifyToken(token)) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
        return;
      }
      
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const command = JSON.parse(body);
          this.handleRegisterCapability(command, res);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // POST /agent/update - 更新 Agent 信息 (需要认证)
    if (req.method === 'POST' && req.url === '/agent/update') {
      const clientIp = req.socket.remoteAddress || 'unknown';
      const token = req.headers['x-f2a-token'] as string | undefined 
        || this.extractBearerToken(req.headers.authorization);
      if (!this.tokenManager.verifyToken(token)) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
        return;
      }
      
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const update = JSON.parse(body);
          // 更新 agentInfo
          if (update.displayName) {
            this.f2a.agentInfo.displayName = update.displayName;
          }
          if (update.capabilities) {
            // 注册每个能力
            for (const cap of update.capabilities) {
              this.f2a.registerCapability(cap, async () => ({ ok: true }));
            }
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }));
        }
      });
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

    // P2-1 修复：添加请求体大小限制
    let body = '';
    let bodySize = 0;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        this.logger.warn('Request body too large', { 
          clientIp, 
          bodySize, 
          maxSize: MAX_BODY_SIZE 
        });
        res.writeHead(413);
        res.end(JSON.stringify({
          success: false,
          error: 'Request body too large',
          code: 'PAYLOAD_TOO_LARGE'
        }));
        req.destroy(); // 终止接收数据
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      // P2-4 修复：processCommand 现在是 async，需要处理 Promise
      this.processCommand(body, res).catch(error => {
        this.logger.error('Error processing command', { error: getErrorMessage(error) });
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({
            success: false,
            error: 'Internal server error',
            code: 'INTERNAL_ERROR'
          }));
        }
      });
    });
  }

  /**
   * 处理命令
   * P2-4 修复：改为 async 方法，确保异步操作正确处理
   */
  private async processCommand(body: string, res: ServerResponse): Promise<void> {
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
          // P2-4 修复：添加 await，确保异步操作完成
          await this.handleDiscover(command.capability, res);
          break;
        case 'delegate':
          this.handleDelegate(command, res);
          break;
        case 'send':
          this.handleSend(command, res);
          break;
        case 'register-capability':
          this.handleRegisterCapability(command, res);
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

  /**
   * 委托任务给指定 Peer
   */
  private async handleDelegate(command: { peerId?: string; taskType?: string; description?: string; parameters?: Record<string, unknown> }, res: ServerResponse): Promise<void> {
    try {
      if (!command.peerId || !command.taskType) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Missing required fields: peerId, taskType',
          code: 'INVALID_REQUEST'
        }));
        return;
      }

      const result = await this.f2a.sendTaskTo(
        command.peerId,
        command.taskType,
        command.description || '',
        command.parameters
      );

      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'DELEGATE_FAILED'
      }));
    }
  }

  /**
   * 发送自由消息给指定 Peer
   */
  private async handleSend(command: { peerId?: string; content?: string; metadata?: Record<string, unknown> }, res: ServerResponse): Promise<void> {
    try {
      if (!command.peerId || !command.content) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Missing required fields: peerId, content',
          code: 'INVALID_REQUEST'
        }));
        return;
      }

      this.logger.info('[ControlServer] Sending message', { 
        peerId: command.peerId.slice(0, 16), 
        contentLength: command.content.length 
      });

      const result = await this.f2a.sendMessageToPeer(command.peerId, command.content);
      
      this.logger.info('[ControlServer] Message send result', { 
        success: result.success, 
        error: result.success ? undefined : result.error 
      });

      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      this.logger.error('Message send failed', { error: error instanceof Error ? error.message : String(error) });
      res.writeHead(500);
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'SEND_FAILED'
      }));
    }
  }

  /**
   * 注册能力
   */
  private handleRegisterCapability(command: { capability?: { name: string; description: string; tools: string[]; parameters?: Record<string, { type: 'string' | 'number' | 'boolean' | 'object' | 'array'; required?: boolean; description?: string }> } }, res: ServerResponse): void {
    try {
      if (!command.capability || !command.capability.name) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Missing required field: capability.name',
          code: 'INVALID_REQUEST'
        }));
        return;
      }

      this.f2a.registerCapability(command.capability, async () => {
        return { registered: true };
      });

      this.logger.info('Capability registered', { name: command.capability.name });

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        capability: command.capability.name
      }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'REGISTER_CAPABILITY_FAILED'
      }));
    }
  }

  // ========== Phase 1: Agent 注册接口处理器 ==========

  /**
   * 列出所有注册的 Agent
   */
  private handleListAgents(res: ServerResponse): void {
    const agents = this.agentRegistry.list();
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agents: agents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        capabilities: a.capabilities,
        registeredAt: a.registeredAt,
        lastActiveAt: a.lastActiveAt,
        webhookUrl: a.webhookUrl,
      })),
      stats: this.agentRegistry.getStats(),
    }));
  }

  /**
   * 注册 Agent
   */
  private handleRegisterAgent(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        if (!data.agentId || !data.name) {
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Missing required fields: agentId, name',
            code: 'INVALID_REQUEST',
          }));
          return;
        }

        // 检查是否已存在
        const existing = this.agentRegistry.get(data.agentId);
        if (existing) {
          // 更新最后活跃时间
          this.agentRegistry.updateLastActive(data.agentId);
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            agent: existing,
            message: 'Agent already registered, updated lastActiveAt',
          }));
          return;
        }

        // 注册新 Agent
        const registration = this.agentRegistry.register({
          agentId: data.agentId,
          name: data.name,
          capabilities: data.capabilities || [],
          webhookUrl: data.webhookUrl,
          metadata: data.metadata,
        });

        // 创建消息队列
        this.messageRouter.createQueue(data.agentId);

        // 同步注册表到消息路由器
        this.syncAgentRegistryToRouter();

        this.logger.info('Agent registered via API', {
          agentId: data.agentId,
          name: data.name,
        });

        res.writeHead(201);
        res.end(JSON.stringify({
          success: true,
          agent: registration,
        }));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON',
          code: 'INVALID_JSON',
        }));
      }
    });
  }

  /**
   * 注销 Agent
   */
  private handleUnregisterAgent(agentId: string, res: ServerResponse): void {
    const removed = this.agentRegistry.unregister(agentId);
    
    if (removed) {
      // 删除消息队列
      this.messageRouter.deleteQueue(agentId);
      
      // 同步注册表到消息路由器
      this.syncAgentRegistryToRouter();
      
      this.logger.info('Agent unregistered via API', { agentId });
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        message: 'Agent unregistered',
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({
        success: false,
        error: 'Agent not found',
        code: 'AGENT_NOT_FOUND',
      }));
    }
  }

  /**
   * 获取 Agent 信息
   */
  private handleGetAgent(agentId: string, res: ServerResponse): void {
    const agent = this.agentRegistry.get(agentId);
    
    if (!agent) {
      res.writeHead(404);
      res.end(JSON.stringify({
        success: false,
        error: 'Agent not found',
        code: 'AGENT_NOT_FOUND',
      }));
      return;
    }

    // 获取消息队列统计
    const queue = this.messageRouter.getQueue(agentId);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agent: {
        agentId: agent.agentId,
        name: agent.name,
        capabilities: agent.capabilities,
        registeredAt: agent.registeredAt,
        lastActiveAt: agent.lastActiveAt,
        webhookUrl: agent.webhookUrl,
        metadata: agent.metadata,
      },
      queue: queue ? {
        size: queue.messages.length,
        maxSize: queue.maxSize,
      } : null,
    }));
  }

  // ========== Phase 1: 消息接口处理器 ==========

  /**
   * 发送消息
   */
  private handleSendMessage(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        if (!data.fromAgentId || !data.content) {
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Missing required fields: fromAgentId, content',
            code: 'INVALID_REQUEST',
          }));
          return;
        }

        // 验证发送方已注册
        if (!this.agentRegistry.get(data.fromAgentId)) {
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Sender agent not registered',
            code: 'AGENT_NOT_REGISTERED',
          }));
          return;
        }

        // 创建消息
        const message: RoutableMessage = {
          messageId: randomUUID(),
          fromAgentId: data.fromAgentId,
          toAgentId: data.toAgentId,
          content: data.content,
          metadata: data.metadata,
          type: data.type || 'message',
          createdAt: new Date(),
        };

        // 路由消息
        if (data.toAgentId) {
          // 验证接收方已注册
          if (!this.agentRegistry.get(data.toAgentId)) {
            res.writeHead(400);
            res.end(JSON.stringify({
              success: false,
              error: 'Target agent not registered',
              code: 'AGENT_NOT_REGISTERED',
            }));
            return;
          }

          const routed = this.messageRouter.route(message);
          if (routed) {
            this.logger.debug('Message routed', {
              messageId: message.messageId,
              fromAgentId: data.fromAgentId,
              toAgentId: data.toAgentId,
            });
            res.writeHead(200);
            res.end(JSON.stringify({
              success: true,
              messageId: message.messageId,
            }));
          } else {
            res.writeHead(500);
            res.end(JSON.stringify({
              success: false,
              error: 'Failed to route message',
              code: 'ROUTE_FAILED',
            }));
          }
        } else {
          // 广播消息
          const broadcasted = this.messageRouter.broadcast(message);
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            messageId: message.messageId,
            broadcasted,
          }));
        }
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON',
          code: 'INVALID_JSON',
        }));
      }
    });
  }

  /**
   * 获取 Agent 的消息队列
   */
  private handleGetMessages(agentId: string, req: IncomingMessage, res: ServerResponse): void {
    // 验证 Agent 已注册
    if (!this.agentRegistry.get(agentId)) {
      res.writeHead(404);
      res.end(JSON.stringify({
        success: false,
        error: 'Agent not found',
        code: 'AGENT_NOT_FOUND',
      }));
      return;
    }

    // 更新活跃时间
    this.agentRegistry.updateLastActive(agentId);

    // 解析查询参数
    const url = new URL(req.url || '', `http://localhost`);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    // 获取消息
    const messages = this.messageRouter.getMessages(agentId, limit);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agentId,
      messages,
      count: messages.length,
    }));
  }

  /**
   * 清除消息
   */
  private handleClearMessages(agentId: string, req: IncomingMessage, res: ServerResponse): void {
    // 验证 Agent 已注册
    if (!this.agentRegistry.get(agentId)) {
      res.writeHead(404);
      res.end(JSON.stringify({
        success: false,
        error: 'Agent not found',
        code: 'AGENT_NOT_FOUND',
      }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const cleared = this.messageRouter.clearMessages(agentId, data.messageIds);
        
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          cleared,
        }));
      } catch {
        // 如果没有 body，清除所有消息
        const cleared = this.messageRouter.clearMessages(agentId);
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          cleared,
        }));
      }
    });
  }

  // ========== 辅助方法 ==========

  /**
   * 同步 Agent 注册表到消息路由器
   * 消息路由器需要知道哪些 Agent 已注册
   */
  private syncAgentRegistryToRouter(): void {
    // 获取所有注册的 Agent
    const agents = this.agentRegistry.list();
    
    // 使用公开方法更新路由器的注册表
    this.messageRouter.updateRegistry(new Map(
      agents.map(a => [a.agentId, a])
    ));
  }
}
