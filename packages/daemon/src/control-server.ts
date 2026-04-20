/**
 * HTTP 控制服务器
 * 接收 CLI 命令 - P2P 版本
 * 
 * Phase 1 扩展：支持 Agent 注册和消息路由
 * RFC008 扩展：支持 Challenge-Response 认证
 * 
 * P0-3 Refactoring: 简化为路由分发
 * - 所有端点处理逻辑已提取到 Handler 类
 * - 本文件只负责路由分发和基础设施管理
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { F2A } from '@f2a/network';
import { TokenManager } from '@f2a/network';
import { Logger } from '@f2a/network';
import { RateLimiter } from '@f2a/network';
import { getErrorMessage } from '@f2a/network';
import { E2EECrypto } from '@f2a/network';
import { AgentRegistry, MessageRouter } from '@f2a/network';
import { AgentIdentityStore } from './agent-identity-store.js';
import { AgentTokenManager } from './agent-token-manager.js';
import { AgentHandler } from './handlers/agent-handler.js';
import { MessageHandler } from './handlers/message-handler.js';
import { SystemHandler } from './handlers/system-handler.js';
import { P2PHandler, SendCommand } from './handlers/p2p-handler.js';
import { ChallengeHandler } from './challenge-handler.js';

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
  private identityStore: AgentIdentityStore;
  // Phase 7: E2EECrypto 用于签名验证
  private e2eeCrypto!: E2EECrypto;
  private dataDir: string;
  // Phase 1: 全局 AgentTokenManager（纯内存版本）
  private agentTokenManager: AgentTokenManager;
  
  // Handlers
  private agentHandler: AgentHandler;
  private messageHandler: MessageHandler;
  private systemHandler: SystemHandler;
  private p2pHandler: P2PHandler;
  // RFC008: Challenge-Response 认证处理器
  private challengeHandler: ChallengeHandler;

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
    this.identityStore = new AgentIdentityStore(this.dataDir);
    this.identityStore.loadAll();

    // Phase 1: 初始化全局 AgentTokenManager（纯内存版本）
    this.agentTokenManager = new AgentTokenManager();

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

    // 初始化 Handlers（依赖注入）
    this.agentHandler = new AgentHandler({
      agentRegistry: this.agentRegistry,
      identityStore: this.identityStore,
      agentTokenManager: this.agentTokenManager,
      e2eeCrypto: this.e2eeCrypto,
      messageRouter: this.messageRouter,
      logger: this.logger,
    });

    this.messageHandler = new MessageHandler({
      messageRouter: this.messageRouter,
      agentRegistry: this.agentRegistry,
      f2a: this.f2a,
      agentTokenManager: this.agentTokenManager,
      logger: this.logger,
    });

    this.systemHandler = new SystemHandler({
      f2a: this.f2a,
      tokenManager: this.tokenManager,
      logger: this.logger,
      rateLimiter: this.rateLimiter,
    });

    this.p2pHandler = new P2PHandler({
      f2a: this.f2a,
      logger: this.logger,
    });

    // RFC008: 初始化 ChallengeHandler
    this.challengeHandler = new ChallengeHandler({
      agentRegistry: this.agentRegistry,
      identityStore: this.identityStore,
      agentTokenManager: this.agentTokenManager,
      messageRouter: this.messageRouter,
      logger: this.logger,
    });

    // RFC 004 Phase 6: 启动时恢复所有持久化的 Agent 身份到运行时注册表
    // 注意：这是 daemon 特有的功能，从 agents/*.json 恢复到 AgentRegistry
    for (const identity of this.identityStore.list()) {
      try {
        this.agentRegistry.restore(identity);
        // 同时为恢复的 Agent 创建消息队列（与 POST /api/agents 保持一致）
        this.messageRouter.createQueue(identity.agentId);
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
        // P2-2: 启动 challenge 清理任务
        this.agentHandler.startCleanupTask();
        resolve();
      });
    });
  }

  /**
   * 停止控制服务器
   */
  stop(): void {
    // P2-2: 停止 challenge 清理任务
    this.agentHandler.stopCleanupTask();
    
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
   * 处理请求 - 路由分发
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // 设置 CORS - 使用配置的允许来源
    const origin = req.headers.origin;
    const allowOrigin = origin && this.allowedOrigins.includes(origin) 
      ? origin 
      : this.allowedOrigins[0];
    
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-F2A-Token, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // ========== 健康检查端点（无需认证）==========
    if (req.method === 'GET' && req.url === '/health') {
      this.systemHandler.handleHealth(res);
      return;
    }

    // ========== API 版本控制检查 ==========
    // 旧路径提示 - 向后兼容
    if (req.url?.startsWith('/api/agents') || req.url?.startsWith('/api/messages')) {
      if (!req.url?.startsWith('/api/v1/')) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'API version required. Please use /api/v1/ prefix',
          code: 'API_VERSION_REQUIRED',
          hint: `Try: ${req.url.replace('/api/', '/api/v1/')}`
        }));
        return;
      }
    }

    // ========== Agent 注册接口 ==========
    
    // GET /api/v1/agents - 列出所有注册的 Agent（无需认证）
    if (req.method === 'GET' && req.url === '/api/v1/agents') {
      this.agentHandler.handleListAgents(res);
      return;
    }
    
    // POST /api/v1/agents - 注册 Agent（无需认证，但有 webhook 验证）
    if (req.method === 'POST' && req.url === '/api/v1/agents') {
      this.agentHandler.handleRegisterAgent(req, res);
      return;
    }
    
    // DELETE /api/v1/agents/:agentId - 注销 Agent（需认证）
    const deleteAgentMatch = req.url?.match(/^\/api\/v1\/agents\/([^\/]+)$/);
    if (req.method === 'DELETE' && deleteAgentMatch) {
      this.agentHandler.handleUnregisterAgent(decodeURIComponent(deleteAgentMatch[1]), req, res);
      return;
    }
    
    // GET /api/v1/agents/:agentId - 获取 Agent 信息（无需认证）
    const getAgentMatch = req.url?.match(/^\/api\/v1\/agents\/([^\/]+)$/);
    if (req.method === 'GET' && getAgentMatch) {
      this.agentHandler.handleGetAgent(decodeURIComponent(getAgentMatch[1]), res);
      return;
    }
    
    // PATCH /api/v1/agents/:agentId/webhook - 更新 Agent webhook（需认证）
    const webhookMatch = req.url?.match(/^\/api\/v1\/agents\/([^\/]+)\/webhook$/);
    if (req.method === 'PATCH' && webhookMatch) {
      this.agentHandler.handleUpdateWebhook(decodeURIComponent(webhookMatch[1]), req, res);
      return;
    }
    
    // POST /api/v1/agents/verify - Challenge-Response 验证（无需认证）
    if (req.method === 'POST' && req.url === '/api/v1/agents/verify') {
      this.agentHandler.handleVerifyAgent(req, res);
      return;
    }
    
    // ========== RFC008 Challenge-Response 接口 ==========
    
    // POST /api/v1/challenge - 生成 Challenge（无需认证）
    if (req.method === 'POST' && req.url === '/api/v1/challenge') {
      this.challengeHandler.handleChallengeRequest(req, res);
      return;
    }
    
    // POST /api/v1/challenge/verify - 验证 Challenge 响应并获取 Token（无需认证）
    if (req.method === 'POST' && req.url === '/api/v1/challenge/verify') {
      this.challengeHandler.handleChallengeResponse(req, res);
      return;
    }
    
    // ========== 消息接口 ==========
    
    // POST /api/v1/messages - 发送消息（需 agent token 认证）
    if (req.method === 'POST' && req.url === '/api/v1/messages') {
      this.messageHandler.handleSendMessage(req, res);
      return;
    }
    
    // GET /api/v1/messages/:agentId - 获取 Agent 的消息队列
    const getMessagesMatch = req.url?.match(/^\/api\/v1\/messages\/([^\/]+)$/);
    if (req.method === 'GET' && getMessagesMatch) {
      this.messageHandler.handleGetMessages(decodeURIComponent(getMessagesMatch[1]), req, res);
      return;
    }
    
    // DELETE /api/v1/messages/:agentId - 清除消息
    const clearMessagesMatch = req.url?.match(/^\/api\/v1\/messages\/([^\/]+)$/);
    if (req.method === 'DELETE' && clearMessagesMatch) {
      this.messageHandler.handleClearMessages(decodeURIComponent(clearMessagesMatch[1]), req, res);
      return;
    }

    // ========== 系统状态接口（需认证）==========
    
    // GET /status - 获取状态
    if (req.method === 'GET' && req.url === '/status') {
      this.systemHandler.handleStatusEndpoint(req, res);
      return;
    }

    // GET /peers - 获取已知的 Peers
    if (req.method === 'GET' && req.url === '/peers') {
      this.systemHandler.handlePeersEndpoint(req, res);
      return;
    }

    // POST /register-capability - 注册能力
    if (req.method === 'POST' && req.url === '/register-capability') {
      this.systemHandler.handleRegisterCapabilityEndpoint(req, res);
      return;
    }

    // POST /agent/update - 更新 Agent 信息
    if (req.method === 'POST' && req.url === '/agent/update') {
      this.systemHandler.handleAgentUpdate(req, res);
      return;
    }

    // ========== POST /control 命令处理（需认证）==========
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
   * 处理命令 - POST /control 路由
   * P2-4 修复：改为 async 方法，确保异步操作正确处理
   */
  private async processCommand(body: string, res: ServerResponse): Promise<void> {
    try {
      const command = JSON.parse(body);
      
      switch (command.action) {
        case 'status':
          this.systemHandler.handleStatus(res);
          break;
        case 'peers':
          this.systemHandler.handlePeers(res);
          break;
        case 'discover':
          await this.p2pHandler.handleDiscover(command.capability, res);
          break;
        case 'send':
          await this.p2pHandler.handleSend(command as SendCommand, res);
          break;
        case 'register-capability':
          this.systemHandler.handleRegisterCapability(command, res);
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
}