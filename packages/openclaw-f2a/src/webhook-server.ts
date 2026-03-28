/**
 * Webhook Server
 * 接收 F2A Node 的事件通知
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { 
  WebhookEvent, 
  DiscoverWebhookPayload, 
  DelegateWebhookPayload,
  AgentCapability,
  TaskResponse 
} from './types.js';

// P1-8 修复：统一使用 logger.ts 的 Logger 接口
import type { Logger } from './logger.js';

/** 默认请求体大小限制 (64KB) - 元数据交换足够，防止 DoS */
const DEFAULT_MAX_BODY_SIZE = 64 * 1024;

/** 默认允许的 CORS 来源 */
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost'];

/**
 * P2 修复：生产环境 CORS 配置验证
 */
function validateCorsConfig(allowedOrigins: string[], logger: Logger): void {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // 检查是否使用默认配置
    if (allowedOrigins.length === 1 && allowedOrigins[0] === 'http://localhost') {
      logger.error('[F2A:Webhook] CORS configuration warning: Using default localhost origin in production!');
      logger.error('[F2A:Webhook] Set F2A_WEBHOOK_ALLOWED_ORIGINS environment variable or pass allowedOrigins option.');
    }
    
    // 检查是否包含通配符
    if (allowedOrigins.includes('*')) {
      logger.error('[F2A:Webhook] CORS configuration error: Wildcard origin (*) is not allowed in production!');
      throw new Error('Wildcard CORS origin is not allowed in production. Configure specific allowed origins.');
    }
  }
}

export interface WebhookHandler {
  onDiscover(payload: DiscoverWebhookPayload): Promise<{
    capabilities: AgentCapability[];
    reputation?: number;
  }>;
  
  onDelegate(payload: DelegateWebhookPayload): Promise<{
    accepted: boolean;
    taskId: string;
    reason?: string;
  }>;
  
  onStatus(): Promise<{
    status: 'available' | 'busy' | 'offline';
    load?: number;
  }>;
  
  onMessage?(payload: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }): Promise<{
    response?: string;
  }>;
}

export class WebhookServer {
  private port: number;
  private handler: WebhookHandler;
  private server?: ReturnType<typeof createServer>;
  private maxBodySize: number;
  /** 允许的 CORS 来源列表 */
  private allowedOrigins: string[];
  /** 日志记录器 */
  private logger: Logger;

  constructor(port: number, handler: WebhookHandler, options?: { 
    maxBodySize?: number;
    allowedOrigins?: string[];
    logger?: Logger;
  }) {
    this.port = port;
    this.handler = handler;
    this.maxBodySize = options?.maxBodySize || DEFAULT_MAX_BODY_SIZE;
    // P2 修复：支持从环境变量读取 CORS 配置
    const envOrigins = process.env.F2A_WEBHOOK_ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
    this.allowedOrigins = options?.allowedOrigins ?? envOrigins ?? DEFAULT_ALLOWED_ORIGINS;
    // 使用传入的 logger 或默认的 console
    this.logger = options?.logger || console;
    
    // P2 修复：生产环境强制验证 CORS 配置
    validateCorsConfig(this.allowedOrigins, this.logger);
  }

  /**
   * 启动 Webhook 服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleRequest.bind(this));
      
      this.server.listen(this.port, () => {
        this.logger.info('[F2A:Webhook] 服务器启动在端口 %d', this.port);
        // 允许进程在只有这个服务器时退出（用于 CLI 命令如 gateway status）
        this.server?.unref();
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 停止 Webhook 服务器
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server?.close(() => {
          this.logger.info('[F2A:Webhook] 服务器已停止');
          resolve();
        });
      });
    }
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 设置 CORS - 使用配置的允许来源
    const origin = req.headers.origin;
    // 当 allowedOrigins 为空数组时，使用默认值 'http://localhost'
    // 当 origin 不在允许列表中时，使用第一个允许的来源或默认值
    const defaultOrigin = 'http://localhost';
    let allowOrigin: string;
    
    if (this.allowedOrigins.length === 0) {
      // 没有配置允许来源，使用默认值
      allowOrigin = defaultOrigin;
    } else if (origin && this.allowedOrigins.includes(origin)) {
      // origin 在允许列表中
      allowOrigin = origin;
    } else {
      // origin 不在允许列表中，使用第一个允许的来源
      allowOrigin = this.allowedOrigins[0];
    }
    
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const body = await this.parseBody(req);
      const event = body as WebhookEvent;

      this.logger.info('[F2A:Webhook] 收到事件: %s', event.type);

      let result: unknown;

      switch (event.type) {
        case 'discover':
          result = await this.handler.onDiscover(event.payload as DiscoverWebhookPayload);
          break;

        case 'delegate':
          result = await this.handler.onDelegate(event.payload as DelegateWebhookPayload);
          break;

        case 'status':
          result = await this.handler.onStatus();
          break;

        case 'message' as any:
          // 处理 P2P 消息（Agent 对话）
          if (this.handler.onMessage) {
            result = await this.handler.onMessage(event.payload as { 
              from: string; 
              content: string; 
              metadata?: Record<string, unknown>; 
              messageId: string 
            });
          } else {
            result = { response: 'Message handler not configured' };
          }
          break;

        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown event type: ${event.type}` }));
          return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      this.logger.error('[F2A:Webhook] 处理错误: %s', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Internal error' 
      }));
    }
  }

  /**
   * 解析请求体
   * 带大小限制，防止 DoS 攻击
   * 
   * P1-6 修复：添加 rejected 标志防止 end 事件执行
   */
  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      // P1-6 修复：添加 rejected 标志，防止请求体超限后 end 事件仍执行
      let rejected = false;
      
      req.on('data', (chunk) => {
        // P1-6 修复：如果已 rejected，不再处理数据
        if (rejected) {
          return;
        }
        
        size += chunk.length;
        
        // 检查请求体大小
        if (size > this.maxBodySize) {
          rejected = true;
          req.destroy();
          reject(new Error(`Request body too large: ${size} bytes (max: ${this.maxBodySize})`));
          return;
        }
        
        body += chunk.toString();
      });
      
      req.on('end', () => {
        // P1-6 修复：检查 rejected 标志，避免超限后仍解析 body
        if (rejected) {
          return;
        }
        
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      
      req.on('error', (err) => {
        // P1-6 修复：设置 rejected 标志
        rejected = true;
        reject(err);
      });
    });
  }

  getUrl(): string {
    return `http://localhost:${this.port}/webhook`;
  }
}