/**
 * MessageService - 消息服务
 * 
 * 从 f2a.ts 提取的消息发送和处理逻辑
 * 
 * 职责:
 * - sendMessage: 统一消息发送入口,支持 Agent 间通信
 * - handleFreeMessage: 处理收到的自由消息
 */

import { randomUUID } from 'crypto';
import type { EventEmitter } from 'eventemitter3';
import type { P2PNetwork } from './p2p-network.js';
import type { AgentRegistry } from './agent-registry.js';
import type { MessageRouter, RoutableMessage } from './message-router.js';
import { Logger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';
import type { Result, F2AEvents, LogLevel } from '../types/index.js';
import { success, failureFromError } from '../types/result.js';

/**
 * sendMessage 选项
 */
export interface SendMessageOptions {
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
}

/**
 * MessageService 配置
 */
export interface MessageServiceConfig {
  /** P2P 网络实例 */
  p2pNetwork: P2PNetwork;
  /** 消息路由器 */
  messageRouter?: MessageRouter;
  /** Agent 注册表 */
  agentRegistry?: AgentRegistry;
  /** 消息处理器 URL (可选) */
  messageHandlerUrl?: string;
  /** 日志级别 */
  logLevel?: LogLevel;
}

/**
 * 消息服务
 * 
 * 处理 Agent 间消息的发送和接收
 */
export class MessageService {
  private p2pNetwork: P2PNetwork;
  private messageRouter?: MessageRouter;
  private agentRegistry?: AgentRegistry;
  private logger: Logger;
  private eventEmitter: EventEmitter<F2AEvents>;
  private messageHandlerUrl?: string;

  constructor(config: MessageServiceConfig, eventEmitter: EventEmitter<F2AEvents>) {
    this.p2pNetwork = config.p2pNetwork;
    this.messageRouter = config.messageRouter;
    this.agentRegistry = config.agentRegistry;
    this.messageHandlerUrl = config.messageHandlerUrl;
    this.eventEmitter = eventEmitter;
    
    this.logger = new Logger({
      level: config.logLevel || 'INFO',
      component: 'MessageService',
      enableConsole: true,
    });
  }

  /**
   * 设置 MessageRouter 引用
   */
  setMessageRouter(messageRouter: MessageRouter): void {
    this.messageRouter = messageRouter;
    this.logger.info('MessageRouter configured');
  }

  /**
   * 设置 AgentRegistry 引用
   */
  setAgentRegistry(agentRegistry: AgentRegistry): void {
    this.agentRegistry = agentRegistry;
    this.logger.info('AgentRegistry configured');
  }

  /**
   * 设置消息处理器 URL
   */
  setMessageHandlerUrl(url: string): void {
    this.messageHandlerUrl = url;
    this.logger.info('Message handler URL configured', { url });
  }

  /**
   * 统一消息发送入口
   *
   * 支持 Agent 间通信,自动判断本地路由或远程 P2P 发送
   *
   * @param fromAgentId 发送方 Agent ID
   * @param toAgentId 目标 Agent ID
   * @param content 消息内容
   * @param options 可选配置
   * @returns Result<void> 发送结果
   */
  async sendMessage(
    fromAgentId: string,
    toAgentId: string,
    content: string | Record<string, unknown>,
    options?: SendMessageOptions
  ): Promise<Result<void>> {
    // 验证 MessageRouter 已初始化
    if (!this.messageRouter) {
      return failureFromError('INTERNAL_ERROR', 'MessageRouter not initialized');
    }

    // 构造路由消息
    const messageId = `msg-${randomUUID()}`;
    const message: RoutableMessage = {
      messageId,
      fromAgentId,
      toAgentId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      metadata: options?.metadata,
      type: options?.type || 'message',
      createdAt: new Date(),
    };

    this.logger.info('Sending message', {
      messageId,
      fromAgentId,
      toAgentId,
      type: message.type,
    });

    // 判断目标 Agent 是否本地
    if (!this.agentRegistry) {
      return failureFromError('INTERNAL_ERROR', 'AgentRegistry not initialized');
    }

    const targetAgent = this.agentRegistry.get(toAgentId);

    if (targetAgent) {
      // 目标 Agent 在本地,使用本地路由
      const routed = this.messageRouter.route(message);
      if (routed) {
        this.logger.info('Message routed locally', { messageId, toAgentId });
        return success(undefined);
      } else {
        return failureFromError('TASK_FAILED', 'Local message routing failed');
      }
    }

    // 目标 Agent 不在本地,尝试远程路由
    if (!this.messageRouter) {
      return failureFromError('NETWORK_NOT_STARTED', 'MessageRouter not configured for remote routing');
    }

    const result = await this.messageRouter.routeRemote(message);

    if (result.success) {
      this.logger.info('Message sent remotely', { messageId, toAgentId });
    } else {
      this.logger.error('Failed to send message remotely', {
        messageId,
        toAgentId,
        error: result.error,
      });
    }

    return result;
  }

  /**
   * 处理收到的自由消息(MESSAGE + topic='chat' 或其他)
   * 如果配置了 messageHandlerUrl,调用该 URL 并发送响应
   */
  async handleFreeMessage(
    fromPeerId: string,
    messageId: string,
    content: string | Record<string, unknown>,
    topic?: string
  ): Promise<void> {
    this.logger.info('Received free message', {
      from: fromPeerId.slice(0, 16),
      topic,
      contentLength: typeof content === 'string' ? content.length : 'object'
    });

    // 发出事件供上层监听
    this.eventEmitter.emit('peer:message', {
      messageId,
      from: fromPeerId,
      content,
      topic
    });

    // 如果配置了 messageHandlerUrl,调用它
    const handlerUrl = this.messageHandlerUrl;
    if (handlerUrl) {
      try {
        const response = await fetch(handlerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromPeerId,
            content,
            topic,
            messageId
          })
        });

        if (response.ok) {
          const result = await response.json() as { response?: string; reply?: string };
          const replyContent = result.response || result.reply;

          if (replyContent) {
            // 发送响应回发送者
            await this.p2pNetwork.sendFreeMessage(fromPeerId, replyContent, topic);
            this.logger.info('Sent message response', {
              to: fromPeerId.slice(0, 16),
              content: replyContent.slice(0, 50)
            });
          }
        } else {
          this.logger.warn('Message handler returned error', {
            status: response.status,
            url: handlerUrl
          });
        }
      } catch (error) {
        this.logger.error('Failed to call message handler', {
          error: getErrorMessage(error),
          url: handlerUrl
        });
      }
    }
  }
}