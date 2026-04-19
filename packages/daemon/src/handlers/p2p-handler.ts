/**
 * P2PHandler - P2P 网络操作端点
 * 
 * 从 control-server.ts 提取的 P2P 相关命令处理逻辑
 * 包括：
 * - discover: 发现具有特定能力的节点
 * - delegate: 委托任务给其他节点
 * - send: 发送消息给其他节点
 */

import type { ServerResponse } from 'http';
import { Logger, getErrorMessage } from '@f2a/network';
import type { F2A } from '@f2a/network';
import type { P2PHandlerDeps } from '../types/handlers.js';

/**
 * Send 命令参数
 */
export interface SendCommand {
  peerId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

/**
 * P2P 网络操作 Handler
 */
export class P2PHandler {
  private f2a: F2A;
  private logger: Logger;

  constructor(deps: P2PHandlerDeps) {
    this.f2a = deps.f2a;
    this.logger = deps.logger;
  }

  /**
   * 发现具有特定能力的节点
   */
  async handleDiscover(capability: string | undefined, res: ServerResponse): Promise<void> {
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
        error: getErrorMessage(error),
        code: 'DISCOVER_FAILED'
      }));
    }
  }

  /**
   * 发送消息给其他节点
   */
  async handleSend(command: SendCommand, res: ServerResponse): Promise<void> {
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

      this.logger.info('[P2PHandler] Sending message', { 
        peerId: command.peerId.slice(0, 16), 
        contentLength: command.content.length 
      });

      const result = await this.f2a.sendMessageToPeer(command.peerId, command.content);
      
      this.logger.info('[P2PHandler] Message send result', { 
        success: result.success, 
        error: result.success ? undefined : result.error 
      });

      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (error) {
      this.logger.error('Message send failed', { error: getErrorMessage(error) });
      res.writeHead(500);
      res.end(JSON.stringify({
        success: false,
        error: getErrorMessage(error),
        code: 'SEND_FAILED'
      }));
    }
  }
}