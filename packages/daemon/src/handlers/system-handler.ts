/**
 * SystemHandler - 系统状态相关端点处理器
 * 
 * 从 control-server.ts 提取的系统相关端点处理逻辑
 * 
 * 端点:
 * - GET /health - 健康检查（无需认证）
 * - GET /status - 状态（需认证）
 * - GET /peers - 获取 peers（需认证）
 * - POST /register-capability - 注册能力（需认证）
 * - POST /agent/update - 更新 Agent 信息（需认证）
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Logger, RateLimiter } from '@f2a/network';
import type { F2A, TokenManager } from '@f2a/network';
import type { SystemHandlerDeps } from '../types/handlers.js';
import { AuthMiddleware } from '../middleware/auth.js';

/**
 * 注册能力请求体类型
 */
interface RegisterCapabilityBody {
  capability?: {
    name: string;
    description: string;
    tools: string[];
    parameters?: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      required?: boolean;
      description?: string;
    }>;
  };
}

/**
 * 更新 Agent 信息请求体类型
 */
interface AgentUpdateBody {
  displayName?: string;
  capabilities?: Array<{
    name: string;
    description: string;
    tools: string[];
  }>;
}

export class SystemHandler {
  private f2a: F2A;
  private tokenManager: TokenManager;
  private logger: Logger;
  private authMiddleware: AuthMiddleware;
  private authMiddlewareWithRateLimit: AuthMiddleware;
  private rateLimiter: RateLimiter;

  constructor(deps: SystemHandlerDeps & { tokenManager: TokenManager; rateLimiter?: RateLimiter }) {
    this.f2a = deps.f2a;
    this.tokenManager = deps.tokenManager;
    this.logger = deps.logger;
    
    // 速率限制器: 优先使用传入的，否则创建默认实例（与 control-server.ts 一致）
    // 每分钟最多 60 个请求
    this.rateLimiter = deps.rateLimiter || new RateLimiter({ maxRequests: 60, windowMs: 60000 });
    
    // 不带速率限制的认证中间件（用于 /register-capability 和 /agent/update）
    this.authMiddleware = new AuthMiddleware({
      tokenManager: deps.tokenManager,
      logger: deps.logger,
    });
    
    // 带速率限制的认证中间件（用于 /status 和 /peers）
    this.authMiddlewareWithRateLimit = new AuthMiddleware({
      tokenManager: deps.tokenManager,
      logger: deps.logger,
      rateLimiter: this.rateLimiter,
    });
  }

  /**
   * 健康检查（无需认证）
   * GET /health
   */
  handleHealth(res: ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, status: 'ok', peerId: this.f2a.peerId }));
  }

  /**
   * 状态（需认证）
   * GET /status
   */
  handleStatus(res: ServerResponse): void {
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      peerId: this.f2a.peerId,
      agentInfo: this.f2a.agentInfo
    }));
  }

  /**
   * 状态 - HTTP 端点版本（带认证和速率限制检查）
   * GET /status
   */
  handleStatusEndpoint(req: IncomingMessage, res: ServerResponse): void {
    // 认证检查（带速率限制）
    const authResult = this.authMiddlewareWithRateLimit.authenticateWithRateLimit(req, res);
    if (!authResult) {
      return; // 认证或速率限制失败，响应已发送
    }

    // 认证成功，返回状态
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      peerId: this.f2a.peerId,
      multiaddrs: this.f2a.agentInfo.multiaddrs || []
    }));
  }

  /**
   * Peers（需认证）
   * GET /peers
   */
  handlePeers(res: ServerResponse): void {
    const peers = this.f2a.getConnectedPeers();
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      peers
    }));
  }

  /**
   * Peers - HTTP 端点版本（带认证和速率限制检查）
   * GET /peers
   */
  handlePeersEndpoint(req: IncomingMessage, res: ServerResponse): void {
    // 认证检查（带速率限制）
    const authResult = this.authMiddlewareWithRateLimit.authenticateWithRateLimit(req, res);
    if (!authResult) {
      return; // 认证或速率限制失败，响应已发送
    }

    // 认证成功，返回所有已知的节点（包括已断开但已发现的）
    const peers = this.f2a.getAllPeers();
    res.writeHead(200);
    res.end(JSON.stringify(peers));
  }

  /**
   * 注册能力（需认证）
   * 处理 /register-capability 的命令
   */
  handleRegisterCapability(command: RegisterCapabilityBody, res: ServerResponse): void {
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

  /**
   * 注册能力 - HTTP 端点版本（带认证检查，无速率限制）
   * POST /register-capability
   */
  handleRegisterCapabilityEndpoint(req: IncomingMessage, res: ServerResponse): void {
    // 认证检查（无速率限制）
    const authResult = this.authMiddleware.authenticate(req, res);
    if (!authResult) {
      return; // 认证失败，响应已发送
    }

    // 读取请求体
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
  }

  /**
   * 更新 Agent 信息（需认证，无速率限制）
   * POST /agent/update
   */
  handleAgentUpdate(req: IncomingMessage, res: ServerResponse): void {
    // 认证检查（无速率限制）
    const authResult = this.authMiddleware.authenticate(req, res);
    if (!authResult) {
      return; // 认证失败，响应已发送
    }

    // 读取请求体
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const update: AgentUpdateBody = JSON.parse(body);
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
  }
}