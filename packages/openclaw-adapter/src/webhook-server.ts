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
}

export class WebhookServer {
  private port: number;
  private handler: WebhookHandler;
  private server?: ReturnType<typeof createServer>;

  constructor(port: number, handler: WebhookHandler) {
    this.port = port;
    this.handler = handler;
  }

  /**
   * 启动 Webhook 服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.handleRequest.bind(this));
      
      this.server.listen(this.port, () => {
        console.log(`[F2A Webhook] 服务器启动在端口 ${this.port}`);
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
          console.log('[F2A Webhook] 服务器已停止');
          resolve();
        });
      });
    }
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
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

      console.log(`[F2A Webhook] 收到事件: ${event.type}`);

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

        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown event type: ${event.type}` }));
          return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      console.error('[F2A Webhook] 处理错误:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Internal error' 
      }));
    }
  }

  /**
   * 解析请求体
   */
  private parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      
      req.on('error', reject);
    });
  }

  getUrl(): string {
    return `http://localhost:${this.port}/webhook`;
  }
}