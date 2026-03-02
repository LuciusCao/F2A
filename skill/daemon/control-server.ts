/**
 * HTTP 控制服务器
 * 接收 CLI 命令
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { ConnectionManager } from '../core/connection-manager';

export interface ControlServerOptions {
  port: number;
  token: string;
  connectionManager: ConnectionManager;
}

export class ControlServer {
  private server?: Server;
  private options: ControlServerOptions;

  constructor(options: ControlServerOptions) {
    this.options = options;
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

      this.server.listen(this.options.port, () => {
        console.log(`[ControlServer] Listening on port ${this.options.port}`);
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
  }

  /**
   * 处理请求
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-F2A-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // 验证 Token
    const token = req.headers['x-f2a-token'];
    if (token !== this.options.token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/control') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      this.handleControlRequest(body, res);
    });
  }

  /**
   * 处理控制请求
   */
  private handleControlRequest(body: string, res: ServerResponse): void {
    try {
      const { action, idOrIndex, reason } = JSON.parse(body);
      let result: { success: boolean; message?: string; pending?: unknown; error?: string };

      switch (action) {
        case 'list-pending':
          result = {
            success: true,
            pending: this.options.connectionManager.getPendingList()
          };
          break;

        case 'confirm':
          const confirmResult = this.options.connectionManager.confirm(idOrIndex);
          if (confirmResult.success) {
            result = {
              success: true,
              message: `已接受 ${confirmResult.data.agentId.slice(0, 16)}... 的连接`
            };
          } else {
            result = { success: false, error: confirmResult.error };
          }
          break;

        case 'reject':
          const rejectResult = this.options.connectionManager.reject(idOrIndex, reason);
          if (rejectResult.success) {
            result = {
              success: true,
              message: `已拒绝 ${rejectResult.data.agentId.slice(0, 16)}... 的连接`
            };
          } else {
            result = { success: false, error: rejectResult.error };
          }
          break;

        default:
          result = { success: false, error: 'Unknown action' };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
    }
  }
}