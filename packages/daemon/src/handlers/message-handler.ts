/**
 * MessageHandler - 消息操作端点处理器
 *
 * 从 control-server.ts 提取的消息相关端点处理逻辑
 *
 * 端点:
 * - POST /api/messages - 发送消息（需 agent token 认证）
 * - GET /api/messages/:agentId - 获取消息队列
 * - DELETE /api/messages/:agentId - 清除消息
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { Logger, getErrorMessage } from '@f2a/network';
import type { MessageRouter, RoutableMessage, AgentRegistry, F2A } from '@f2a/network';
import type { MessageHandlerDeps } from '../types/handlers.js';
import type { AgentTokenManager } from '../agent-token-manager.js';

/**
 * 发送消息请求体类型
 */
interface SendMessageBody {
  fromAgentId?: string;
  toAgentId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
}

/**
 * 清除消息请求体类型
 */
interface ClearMessagesBody {
  messageIds?: string[];
}

export class MessageHandler {
  private messageRouter: MessageRouter;
  private agentRegistry: AgentRegistry;
  private f2a: F2A;
  private logger: Logger;
  private agentTokenManager: AgentTokenManager;

  constructor(deps: MessageHandlerDeps) {
    this.messageRouter = deps.messageRouter;
    this.agentRegistry = deps.agentRegistry;
    this.f2a = deps.f2a;
    this.logger = deps.logger;
    this.agentTokenManager = deps.agentTokenManager;
  }

  /**
   * 发送消息（跨进程/跨节点发送）
   * POST /api/messages
   *
   * 注意：这是 async 方法，因为涉及跨进程/跨节点发送
   */
  async handleSendMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const data: SendMessageBody = JSON.parse(body);

          if (!data.fromAgentId || !data.content) {
            res.writeHead(400);
            res.end(JSON.stringify({
              success: false,
              error: 'Missing required fields: fromAgentId, content',
              code: 'INVALID_REQUEST',
            }));
            return;
          }

          // === RFC 007: Token 验证 ===
          // 从 Authorization header 获取 agent token
          const authHeader = req.headers['authorization'] as string;
          const agentToken = authHeader?.startsWith('agent-')
            ? authHeader.slice(6)  // 去掉 'agent-' 前缀
            : undefined;

          if (!agentToken) {
            this.logger.warn('SendMessage request missing Authorization header', {
              fromAgentIdPrefix: data.fromAgentId?.slice(0, 16),
            });
            res.writeHead(401);
            res.end(JSON.stringify({
              success: false,
              error: 'Missing Authorization header. Expected format: Authorization: agent-{token}',
              code: 'MISSING_TOKEN',
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

          // 使用全局 AgentTokenManager 验证 token 属于 fromAgentId
          try {
            const verifyResult = this.agentTokenManager.verifyForAgent(agentToken, data.fromAgentId);

            if (!verifyResult.valid) {
              this.logger.warn('Token verification failed', {
                agentId: data.fromAgentId?.slice(0, 16),
                error: verifyResult.error,
              });
              res.writeHead(401);
              res.end(JSON.stringify({
                success: false,
                error: verifyResult.error || 'Token verification failed',
                code: 'INVALID_TOKEN',
              }));
              return;
            }

            this.logger.debug('Token verified for sendMessage', {
              agentIdPrefix: data.fromAgentId.slice(0, 16),
            });
          } catch (tokenError) {
            this.logger.error('Token manager initialization failed', {
              agentId: data.fromAgentId?.slice(0, 16),
              error: getErrorMessage(tokenError),
            });
            res.writeHead(500);
            res.end(JSON.stringify({
              success: false,
              error: 'Token verification system error',
              code: 'TOKEN_SYSTEM_ERROR',
            }));
            return;
          }

          // === Token 验证完成 ===

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

            const routed = await this.messageRouter.routeAsync(message);
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
            const broadcasted = await this.messageRouter.broadcastAsync(message);
            res.writeHead(200);
            res.end(JSON.stringify({
              success: true,
              messageId: message.messageId,
              broadcasted,
            }));
          }
        } catch (error) {
          // 处理 JSON 解析错误和其他同步错误
          if (!res.headersSent) {
            res.writeHead(400);
            res.end(JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : 'Invalid request',
              code: 'INVALID_REQUEST',
            }));
          }
        }
      })().catch(error => {
        // 捕获 async 操作中的未处理异常（如 routeAsync/broadcastAsync 失败）
        this.logger.error('Failed to process message request', { error: getErrorMessage(error) });
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({
            success: false,
            error: 'Internal server error',
            code: 'INTERNAL_ERROR',
          }));
        }
      });
    });
  }

  /**
   * 获取 Agent 的消息队列
   * GET /api/messages/:agentId
   */
  handleGetMessages(agentId: string, req: IncomingMessage, res: ServerResponse): void {
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
   * DELETE /api/messages/:agentId
   */
  handleClearMessages(agentId: string, req: IncomingMessage, res: ServerResponse): void {
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
        const data: ClearMessagesBody = body ? JSON.parse(body) : {};
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
}