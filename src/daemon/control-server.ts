/**
 * HTTP 控制服务器
 * 接收 CLI 命令 - P2P 版本
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { F2A } from '../core/f2a';

export interface ControlServerOptions {
  port: number;
  token: string;
}

export class ControlServer {
  private server?: Server;
  private f2a: F2A;
  private port: number;

  constructor(f2a: F2A, port: number) {
    this.f2a = f2a;
    this.port = port;
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
        console.log(`[ControlServer] Listening on port ${this.port}`);
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
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
