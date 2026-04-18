/**
 * HTTP 控制服务器
 * 接收 CLI 命令 - P2P 版本
 * 
 * Phase 1 扩展：支持 Agent 注册和消息路由
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { randomUUID, randomBytes } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { F2A } from '@f2a/network';
import { TokenManager } from '@f2a/network';
import { Logger } from '@f2a/network';
import { RateLimiter } from '@f2a/network';
import { getErrorMessage } from '@f2a/network';
import { E2EECrypto } from '@f2a/network';
import { AgentRegistry, AgentRegistration } from '@f2a/network';
import { MessageRouter, RoutableMessage } from '@f2a/network';
import { AgentIdentityManager, AgentIdentity } from './agent-identity-manager.js';
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
  // Phase 6: Agent Identity Manager
  private identityManager: AgentIdentityManager;
  // Phase 7: Challenge-Response 验证
  private pendingChallenges: Map<string, { nonce: string; webhook: any; timestamp: number }> = new Map();
  // E2EECrypto 用于签名验证（在 verifyChallenge 中使用）
  // 使用 ! 断言，因为它在构造函数中被初始化
  private e2eeCrypto!: E2EECrypto;
  private dataDir: string;

  constructor(f2a: F2A, port: number, tokenManager?: TokenManager, options?: ControlServerOptions) {
    this.f2a = f2a;
    this.port = port;
    // 使用传入的 dataDir 创建 TokenManager
    this.dataDir = options?.dataDir || join(homedir(), '.f2a');
    this.tokenManager = tokenManager || new TokenManager(this.dataDir);
    this.logger = new Logger({ component: 'ControlServer' });
    // 速率限制: 每分钟最多 60 个请求
    this.rateLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60000 });
    // CORS 配置：优先使用传入的 allowedOrigins，否则使用默认值
    // 支持从环境变量 F2A_ALLOWED_ORIGINS 读取（逗号分隔）
    const envOrigins = process.env.F2A_ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
    this.allowedOrigins = options?.allowedOrigins ?? envOrigins ?? DEFAULT_ALLOWED_ORIGINS;
    
    // P2 修复：生产环境强制验证 CORS 配置
    validateCorsConfig(this.allowedOrigins);
    
    // P0 修复：使用 F2A 已初始化的 AgentRegistry 和 MessageRouter
    // 避免创建独立实例导致数据不一致
    this.agentRegistry = f2a.getAgentRegistry();
    this.messageRouter = f2a.getMessageRouter();
    
    // Phase 6: 初始化 Identity Manager（daemon 特有的 Agent 身份持久化）
    this.identityManager = new AgentIdentityManager(this.dataDir);
    this.identityManager.loadAll();

    // RFC 004 Phase 6: 启动时恢复所有持久化的 Agent 身份到运行时注册表
    // 注意：这是 daemon 特有的功能，从 agents/*.json 恢复到 AgentRegistry
    for (const identity of this.identityManager.list()) {
      try {
        this.agentRegistry.restore(identity);
        this.logger.info('Agent restored on startup', {
          agentId: identity.agentId,
          name: identity.name,
        });
      } catch (err) {
        this.logger.warn('Failed to restore agent on startup', {
          agentId: identity.agentId,
          error: getErrorMessage(err),
        });
      }
    }

    // Phase 7: 初始化 E2EECrypto（用于 Challenge-Response 签名验证）
    this.e2eeCrypto = new E2EECrypto();
    // 尝试从 node-identity.json 加载 E2EE 密钥
    const nodeIdentityPath = join(this.dataDir, 'node-identity.json');
    try {
      if (existsSync(nodeIdentityPath)) {
        const nodeIdentity = JSON.parse(readFileSync(nodeIdentityPath, 'utf-8'));
        if (nodeIdentity.e2eeKeyPair?.publicKey && nodeIdentity.e2eeKeyPair?.privateKey) {
          const publicKey = Buffer.from(nodeIdentity.e2eeKeyPair.publicKey, 'base64');
          const privateKey = Buffer.from(nodeIdentity.e2eeKeyPair.privateKey, 'base64');
          this.e2eeCrypto.initializeWithKeyPair(privateKey, publicKey);
          this.logger.info('E2EECrypto initialized from node-identity.json');
        }
      } else {
        // node-identity.json 不存在，异步初始化
        this.e2eeCrypto.initialize().catch(err => {
          this.logger.warn('E2EECrypto initialization failed', { error: getErrorMessage(err) });
        });
      }
    } catch (err) {
      this.logger.warn('Failed to load node-identity.json for E2EECrypto', { error: getErrorMessage(err) });
    }
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
      res.end(JSON.stringify({ success: true, status: 'ok', peerId: this.f2a.peerId }));
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
      this.handleUnregisterAgent(decodeURIComponent(deleteAgentMatch[1]), res);
      return;
    }
    
    // GET /api/agents/:agentId - 获取 Agent 信息
    const getAgentMatch = req.url?.match(/^\/api\/agents\/([^\/]+)$/);
    if (req.method === 'GET' && getAgentMatch) {
      this.handleGetAgent(decodeURIComponent(getAgentMatch[1]), res);
      return;
    }
    
    // PATCH /api/agents/:agentId/webhook - 更新 Agent webhook（RFC 004）
    const webhookMatch = req.url?.match(/^\/api\/agents\/([^\/]+)\/webhook$/);
    if (req.method === 'PATCH' && webhookMatch) {
      this.handleUpdateWebhook(decodeURIComponent(webhookMatch[1]), req, res);
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
      this.handleGetMessages(decodeURIComponent(getMessagesMatch[1]), req, res);
      return;
    }
    
    // DELETE /api/messages/:agentId - 清除消息
    const clearMessagesMatch = req.url?.match(/^\/api\/messages\/([^\/]+)$/);
    if (req.method === 'DELETE' && clearMessagesMatch) {
      this.handleClearMessages(decodeURIComponent(clearMessagesMatch[1]), req, res);
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
        webhook: a.webhook,
      })),
      stats: this.agentRegistry.getStats(),
    }));
  }

  /**
   * 注册 Agent（RFC 003: AgentId 由节点签发）
   * Phase 6: 支持恢复已有身份
   * 
   * - 如果提供了 agentId 且存在对应 identity 文件，恢复身份
   * - 否则注册新 Agent（节点签发 AgentId）
   */
  private handleRegisterAgent(req: IncomingMessage, res: ServerResponse): void {
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        // 🔑 Phase 7: Challenge-Response - 如果请求挑战
        if (data.requestChallenge) {
          const nonce = this.generateNonce();  // 随机 nonce
          
          this.pendingChallenges.set(data.agentId, {
            nonce,
            webhook: data.webhook,
            timestamp: Date.now()
          });
          
          this.logger.info('Challenge requested for agent', {
            agentId: data.agentId?.slice(0, 16),
            noncePrefix: nonce.slice(0, 8)
          });
          
          res.writeHead(200);
          res.end(JSON.stringify({
            challenge: true,
            nonce,
            expiresIn: 60  // 60 秒有效期
          }));
          return;
        }
        
        // 🔑 Phase 6: 如果提供了已有 agentId，尝试恢复身份
        if (data.agentId) {
          const existingIdentity = this.identityManager.get(data.agentId);
          
          if (existingIdentity) {
            // 恢复身份：更新 webhook
            if (data.webhook) {
              this.identityManager.updateWebhook(data.agentId, data.webhook);
            }
            
            // 同步到 AgentRegistry
            const restored = this.agentRegistry.restore(existingIdentity);
            
            // 创建消息队列
            this.messageRouter.createQueue(data.agentId);
            
            this.logger.info('Agent identity restored', {
              agentId: existingIdentity.agentId,
              name: existingIdentity.name,
              peerId: existingIdentity.peerId,
            });
            
            res.writeHead(200);
            res.end(JSON.stringify({
              success: true,
              restored: true,
              agent: restored,
            }));
            return;
          }
        }
        
        // RFC 003: 新注册必须提供 name
        if (!data.name) {
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Missing required field: name',
            code: 'INVALID_REQUEST',
          }));
          return;
        }

        // 转换 capabilities 格式
        const capabilities = (data.capabilities || []).map((cap: string | { name: string; version?: string }) => {
          if (typeof cap === 'string') {
            return { name: cap, version: '1.0.0' };
          }
          return cap;
        });

        // 注册新 Agent（节点签发 AgentId）
        const registration = this.agentRegistry.register({
          name: data.name,
          capabilities,
          webhook: data.webhook,
          metadata: data.metadata,
        });

        // 🔑 Phase 6: 保存 identity 文件
        const identity: AgentIdentity = {
          agentId: registration.agentId,
          name: registration.name,
          peerId: registration.peerId,
          signature: registration.signature,
          // e2eePublicKey: TODO - 需要从 F2A 获取
          webhook: registration.webhook,
          capabilities: registration.capabilities,
          metadata: registration.metadata,
          createdAt: registration.registeredAt.toISOString(),
          lastActiveAt: new Date().toISOString(),
        };        this.identityManager.save(identity);

        // 创建消息队列
        this.messageRouter.createQueue(registration.agentId);

        this.logger.info('Agent registered via API (node-issued)', {
          agentId: registration.agentId,
          name: registration.name,
          peerId: registration.peerId,
        });

        res.writeHead(201);
        res.end(JSON.stringify({
          success: true,
          restored: false,
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

      // RFC 004 Phase 6: 删除持久化身份文件
      this.identityManager.delete(agentId);

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
        webhook: agent.webhook,
        metadata: agent.metadata,
      },
      queue: queue ? {
        size: queue.messages.length,
        maxSize: queue.maxSize,
      } : null,
    }));
  }

  /**
   * 更新 Agent webhook（RFC 004: Agent 级 Webhook）
   */
  private handleUpdateWebhook(agentId: string, req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
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

        // RFC 004: 构建 webhook 对象
        const webhook = data.webhook || (data.webhookUrl ? { url: data.webhookUrl, token: data.webhookToken } : undefined);
        const updated = this.agentRegistry.updateWebhook(agentId, webhook);
        if (updated) {
          this.logger.info('Agent webhook updated via API', { agentId, webhookUrl: webhook?.url });
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            agentId,
            webhook,
          }));
        } else {
          res.writeHead(500);
          res.end(JSON.stringify({
            success: false,
            error: 'Failed to update webhook',
            code: 'UPDATE_FAILED',
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
   * 
   * P1-1 修复：MessageRouter 现在直接引用 AgentRegistry，不再需要同步
   * 保留方法作为空操作，兼容旧调用
   */
  private syncAgentRegistryToRouter(): void {
    // MessageRouter 直接引用 AgentRegistry，无需同步
  }

  // ========== Phase 7: Challenge-Response 辅助方法 ==========

  /**
   * 生成随机 nonce
   * @returns 32 位随机十六进制字符串
   */
  private generateNonce(): string {
    return randomBytes(16).toString('hex');  // 32 位随机字符串
  }

  /**
   * 生成 session token
   * @returns 随机 session token
   */
  private generateSessionToken(): string {
    return randomBytes(32).toString('hex');  // 64 位随机字符串
  }

  /**
   * Phase 7: 验证 Challenge-Response
   * POST /api/agents/verify
   */
  private handleVerifyAgent(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        // 1️⃣ 检查 nonce 是否存在
        const pending = this.pendingChallenges.get(data.agentId);
        if (!pending || pending.nonce !== data.nonce) {
          this.logger.warn('Invalid nonce for agent verification', {
            agentId: data.agentId?.slice(0, 16),
            hasPending: !!pending
          });
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Invalid nonce' }));
          return;
        }
        
        // 2️⃣ 检查 nonce 是否过期（60秒有效期）
        if (Date.now() - pending.timestamp > 60000) {
          this.pendingChallenges.delete(data.agentId);
          this.logger.warn('Nonce expired for agent verification', {
            agentId: data.agentId?.slice(0, 16),
            elapsedMs: Date.now() - pending.timestamp
          });
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Nonce expired' }));
          return;
        }
        
        // 3️⃣ 加载 identity 文件
        const identity = this.identityManager.get(data.agentId);
        if (!identity) {
          this.logger.warn('Identity not found for agent verification', {
            agentId: data.agentId?.slice(0, 16)
          });
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: 'Identity not found' }));
          return;
        }
        
        // 🔑 4️⃣ 验证 nonce 签名
        if (!identity.e2eePublicKey) {
          this.logger.error('Identity missing e2eePublicKey, cannot verify signature', {
            agentId: data.agentId?.slice(0, 16)
          });
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Identity missing e2eePublicKey' }));
          return;
        }
        
        const isValid = this.e2eeCrypto.verifySignature(
          data.nonce,
          data.nonceSignature,
          identity.e2eePublicKey
        );
        
        if (!isValid) {
          this.logger.error('Signature verification failed - agent identity mismatch', {
            agentId: data.agentId?.slice(0, 16),
            noncePrefix: data.nonce?.slice(0, 8)
          });
          res.writeHead(401);
          res.end(JSON.stringify({ 
            success: false, 
            error: 'Signature verification failed - not the same agent' 
          }));
          return;
        }
        
        // ✅ 5️⃣ 验证通过：生成新 session token
        const sessionToken = this.generateSessionToken();
        
        // 6️⃣ 更新 identity
        identity.webhook = pending.webhook;
        identity.lastActiveAt = new Date().toISOString();
        this.identityManager.save(identity);
        
        // 7️⃣ 清理 pending challenge
        this.pendingChallenges.delete(data.agentId);
        
        // 8️⃣ 同步到 AgentRegistry
        const restored = this.agentRegistry.restore(identity);
        this.messageRouter.createQueue(data.agentId);
        
        this.logger.info('Agent identity verified successfully', {
          agentId: identity.agentId?.slice(0, 16),
          name: identity.name,
          sessionTokenPrefix: sessionToken.slice(0, 8)
        });
        
        // 9️⃣ 返回新 token
        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          verified: true,
          sessionToken,
          agent: restored
        }));
      } catch (error) {
        this.logger.error('Error in agent verification', {
          error: error instanceof Error ? error.message : String(error)
        });
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON',
          code: 'INVALID_JSON'
        }));
      }
    });
  }
}
