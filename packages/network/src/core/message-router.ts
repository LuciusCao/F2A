/**
 * Message Router
 * 处理 Daemon 内部 Agent 之间的消息路由
 *
 * RFC 004: Agent 级 Webhook 支持
 * - 支持 Agent 级 webhook URL,根据 message.toAgentId 路由到对应 webhook
 * - 优先级:本地回调 > Agent webhook > 消息队列
 *
 * RFC 005: 统一路由入口
 * - routeIncoming(): P2P 网络入站消息路由
 * - routeOutgoing(): Agent 出站消息路由
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '../utils/logger.js';
import type { AgentRegistration } from './agent-registry.js';
import type { P2PNetwork } from './p2p-network.js';
import type { Result, StructuredMessagePayload, MESSAGE_TOPICS } from '../types/index.js';
import { success, failureFromError } from '../types/result.js';
import { QueueManager, MessageQueue } from './queue-manager.js';
import { WebhookPusher, AgentWebhookPayload } from './webhook-pusher.js';

/**
 * MessageRouter 事件类型
 */
export interface MessageRouterEvents {
  'message:received': (message: RoutableMessage) => void;
  'message:sent': (message: RoutableMessage) => void;
  'message:dropped': (info: { reason: string; agentId?: string; fromPeerId?: string; error?: unknown }) => void;
}

/**
 * 路由消息类型
 */
export interface RoutableMessage {
  /** 消息 ID */
  messageId: string;
  /** 发送方 Agent ID */
  fromAgentId: string;
  /** 目标 Agent ID(可选,不指定则广播) */
  toAgentId?: string;
  /** 消息内容 */
  content: string;
  /** 消息元数据 */
  metadata?: Record<string, unknown>;
  /** 消息类型 */
  type: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  /** 创建时间 */
  createdAt: Date;
}

// 重导出类型（从提取的模块）
export { MessageQueue } from './queue-manager.js';
export { AgentWebhookPayload } from './webhook-pusher.js';

/**
 * 消息路由器
 * 管理 Agent 之间的消息路由和队列
 *
 * RFC 004: 路由优先级
 * 1. 本地回调 (onMessage) - 最快,直接推送
 * 2. Agent webhook URL - 远程 Agent 立即推送
 * 3. 消息队列 - HTTP 轮询方式
 *
 * RFC 005: 统一路由入口
 */
export class MessageRouter extends EventEmitter<MessageRouterEvents> {
  private queueManager: QueueManager;
  private webhookPusher: WebhookPusher;
  private agentRegistry: Map<string, AgentRegistration>;
  private p2pNetwork?: P2PNetwork;
  private logger: Logger;

  constructor(agentRegistry: Map<string, AgentRegistration>, p2pNetwork?: P2PNetwork, options?: {
    maxQueueSize?: number;
  }) {
    super();
    this.agentRegistry = agentRegistry;
    this.p2pNetwork = p2pNetwork;
    this.logger = new Logger({ component: 'MessageRouter' });
    const defaultMaxQueueSize = options?.maxQueueSize || 100;
    
    // 初始化 QueueManager
    this.queueManager = new QueueManager({
      logger: this.logger,
      defaultMaxQueueSize,
    });
    
    // 初始化 WebhookPusher
    this.webhookPusher = new WebhookPusher({
      logger: this.logger,
    });
  }

  /**
   * 为 Agent 创建消息队列
   */
  createQueue(agentId: string, maxSize?: number): void {
    this.queueManager.createQueue(agentId, maxSize);
  }

  /**
   * 删除 Agent 的消息队列
   */
  deleteQueue(agentId: string): void {
    this.queueManager.deleteQueue(agentId);
  }

  /**
   * 获取 Agent 的消息队列
   */
  getQueue(agentId: string): MessageQueue | undefined {
    return this.queueManager.getQueue(agentId);
  }

  /**
   * 路由消息到特定 Agent(同步版本,不包含 webhook 转发)
   *
   * 如果目标 Agent 有本地回调(onMessage),直接调用回调
   * 否则放入消息队列(等待 HTTP 轮询)
   *
   * 注意:此版本不处理 Agent 级 webhook,请使用 routeAsync() 进行完整路由
   */
  route(message: RoutableMessage): boolean {
    const { toAgentId, fromAgentId } = message;

    // 验证发送方存在
    if (!this.agentRegistry.has(fromAgentId)) {
      this.logger.warn('Sender agent not registered', { fromAgentId });
      return false;
    }

    // 如果指定了目标 Agent,路由到该 Agent
    if (toAgentId) {
      const targetAgent = this.agentRegistry.get(toAgentId);
      if (!targetAgent) {
        this.logger.warn('Target agent not registered', { toAgentId });
        return false;
      }

      // 如果目标 Agent 有本地回调,直接调用(无需队列)
      if (targetAgent.onMessage) {
        try {
          targetAgent.onMessage({
            messageId: message.messageId,
            fromAgentId: message.fromAgentId,
            toAgentId: message.toAgentId || '',
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
          });
          this.logger.debug('Message delivered via local callback', {
            messageId: message.messageId,
            toAgentId,
            fromAgentId,
          });
          return true;
        } catch (err) {
          this.logger.error('Local callback error', {
            toAgentId,
            error: err instanceof Error ? err.message : String(err),
          });
          // 回调失败,降级到队列
        }
      }

      // 无回调或回调失败,放入队列
      const queue = this.queueManager.getQueue(toAgentId);
      if (!queue) {
        this.logger.warn('Target agent queue not found', { toAgentId });
        return false;
      }

      this.queueManager.enqueue(queue, message);
      this.logger.debug('Message routed to queue', {
        messageId: message.messageId,
        toAgentId,
        fromAgentId,
      });
      return true;
    }

    // 如果未指定目标 Agent,广播给所有 Agent(除了发送方)
    return this.broadcast(message);
  }

  /**
   * RFC 004: 路由消息到特定 Agent(异步版本,包含 webhook 转发)
   *
   * 路由优先级:
   * 1. 本地回调 (onMessage) - 最快,直接推送
   * 2. Agent webhook URL - 远程 Agent 立即推送
   * 3. 消息队列 - HTTP 轮询方式
   *
   * @param message 要路由的消息
   * @returns Promise<boolean> 路由是否成功
   */
  async routeAsync(message: RoutableMessage): Promise<boolean> {
    const { toAgentId, fromAgentId } = message;

    // 验证发送方存在
    if (!this.agentRegistry.has(fromAgentId)) {
      this.logger.warn('Sender agent not registered', { fromAgentId });
      return false;
    }

    // 如果指定了目标 Agent,路由到该 Agent
    if (toAgentId) {
      const targetAgent = this.agentRegistry.get(toAgentId);
      if (!targetAgent) {
        this.logger.warn('Target agent not registered', { toAgentId });
        return false;
      }

      // 优先级 1: 如果目标 Agent 有本地回调,直接调用
      if (targetAgent.onMessage) {
        try {
          targetAgent.onMessage({
            messageId: message.messageId,
            fromAgentId: message.fromAgentId,
            toAgentId: message.toAgentId || '',
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
          });
          this.logger.debug('Message delivered via local callback', {
            messageId: message.messageId,
            toAgentId,
            fromAgentId,
          });
          return true;
        } catch (err) {
          this.logger.error('Local callback error', {
            toAgentId,
            error: err instanceof Error ? err.message : String(err),
          });
          // 回调失败,继续尝试 webhook 或队列
        }
      }

      // 优先级 2: RFC 004 - Agent 级 Webhook 转发
      if (targetAgent.webhook?.url) {
        const webhookResult = await this.webhookPusher.forwardToAgentWebhook(message, targetAgent);
        if (webhookResult.success) {
          this.logger.info('Message forwarded to Agent webhook', {
            messageId: message.messageId,
            toAgentId,
            webhookUrl: targetAgent.webhook.url,
          });
          return true;
        }
        // Webhook 失败,降级到队列
        this.logger.warn('Agent webhook forwarding failed, falling back to queue', {
          toAgentId,
          error: webhookResult.error,
        });
      } else {
        this.logger.debug('Agent has no webhook configured', { toAgentId });
      }

      // 优先级 3: 无回调或 webhook 失败,放入队列
      const queue = this.queueManager.getQueue(toAgentId);
      if (!queue) {
        this.logger.warn('Target agent queue not found', { toAgentId });
        return false;
      }

      this.queueManager.enqueue(queue, message);
      this.logger.debug('Message routed to queue', {
        messageId: message.messageId,
        toAgentId,
        fromAgentId,
      });
      return true;
    }

    // 如果未指定目标 Agent,广播给所有 Agent(除了发送方)
    return this.broadcastAsync(message);
  }

  /**
   * 路由远程消息给其他节点的 Agent
   *
   * 通过 P2P 网络发送消息给远程节点上的 Agent
   * AgentId 格式: agent:<PeerId前16位>:<随机8位>
   *
   * @param message 路由消息
   * @returns Result<void> 发送结果
   */
  async routeRemote(message: RoutableMessage): Promise<Result<void>> {
    const { toAgentId, fromAgentId } = message;

    // 验证 P2P 网络已配置
    if (!this.p2pNetwork) {
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not configured for remote routing');
    }

    // 验证发送方 Agent 存在
    if (!this.agentRegistry.has(fromAgentId)) {
      this.logger.warn('Sender agent not registered for remote routing', { fromAgentId });
      return failureFromError('UNAUTHORIZED', `Sender agent not registered: ${fromAgentId}`);
    }

    // 验证目标 Agent ID
    if (!toAgentId) {
      return failureFromError('INVALID_PARAMS', 'Target AgentId required for remote routing');
    }

    // 解析 AgentId 提取 PeerId 前缀
    // 格式: agent:<PeerId前16位>:<随机8位>
    const agentIdParts = toAgentId.split(':');
    if (agentIdParts.length !== 3 || agentIdParts[0] !== 'agent') {
      return failureFromError('INVALID_PARAMS', `Invalid AgentId format: ${toAgentId}`);
    }

    const peerIdPrefix = agentIdParts[1];
    if (peerIdPrefix.length !== 16) {
      return failureFromError('INVALID_PARAMS', `Invalid PeerId prefix in AgentId: ${peerIdPrefix}`);
    }

    // 查找对应的 PeerId(通过 prefix 匹配)
    const targetPeerId = await this.findPeerIdByPrefix(peerIdPrefix);
    if (!targetPeerId) {
      this.logger.warn('Target peer not found by AgentId prefix', { peerIdPrefix, toAgentId });
      return failureFromError('PEER_NOT_FOUND', `Peer not found for AgentId: ${toAgentId}`);
    }

    // RFC 003: 获取发送方 Agent 的签名和 Ed25519 公钥
    const senderAgent = this.agentRegistry.get(fromAgentId);
    const fromSignature = senderAgent?.signature;
    const fromEd25519PublicKey = this.p2pNetwork?.getEd25519PublicKey();

    // 构造 P2P 消息载荷
    // topic: 'agent.message' 用于 Agent 间通信
    // RFC 003: 携带签名和公钥，供远程验证
    const payload: StructuredMessagePayload = {
      topic: 'agent.message',
      content: {
        messageId: message.messageId,
        fromAgentId,
        toAgentId,
        content: message.content,
        type: message.type,
        metadata: message.metadata,
        createdAt: message.createdAt.toISOString(),
        // RFC 003: 添加签名和公钥字段
        fromSignature: fromSignature || '',
        fromEd25519PublicKey: fromEd25519PublicKey || '',
      },
    };

    // 调用 P2P 网络发送消息
    this.logger.debug('Sending remote message via P2P', {
      messageId: message.messageId,
      toAgentId,
      targetPeerId: targetPeerId.slice(0, 16),
      fromAgentId,
    });

    const result = await this.p2pNetwork.sendFreeMessage(targetPeerId, payload.content, 'agent.message');

    if (result.success) {
      this.logger.info('Remote message sent successfully', {
        messageId: message.messageId,
        toAgentId,
        targetPeerId: targetPeerId.slice(0, 16),
      });
      return success(undefined);
    } else {
      this.logger.error('Failed to send remote message', {
        messageId: message.messageId,
        toAgentId,
        error: result.error,
      });
      return result;
    }
  }

  /**
   * 通过 PeerId 前缀查找完整的 PeerId
   *
   * 从 P2P 网络的 peer 表中查找匹配前缀的 Peer
   *
   * @param prefix PeerId 前缀(16 位)
   * @returns 完整 PeerId 或 null
   */
  private async findPeerIdByPrefix(prefix: string): Promise<string | null> {
    if (!this.p2pNetwork) {
      return null;
    }

    // 获取所有已连接的 Peers
    const connectedPeers = this.p2pNetwork.getConnectedPeers();
    for (const peer of connectedPeers) {
      if (peer.peerId.startsWith(prefix)) {
        return peer.peerId;
      }
    }

    // 如果未找到,尝试从所有已知 Peers 查找
    const allPeers = this.p2pNetwork.getAllPeers();
    for (const peer of allPeers) {
      if (peer.peerId.startsWith(prefix)) {
        return peer.peerId;
      }
    }

    // 尝试通过 DHT 查找(如果启用)
    if (this.p2pNetwork.isDHTEnabled()) {
      // 构造可能的 PeerId(需要完整 PeerId 才能查询 DHT)
      // 这里只能返回 null,因为 DHT 需要完整的 PeerId
      this.logger.debug('DHT lookup not possible with prefix only', { prefix });
    }

    return null;
  }

  /**
   * 设置 P2P 网络引用
   * 用于后续配置 P2P 网络
   */
  setP2PNetwork(p2pNetwork: P2PNetwork): void {
    this.p2pNetwork = p2pNetwork;
    this.logger.info('P2P network configured for remote routing');
  }

  /**
   * 广播消息给所有 Agent
   *
   * 本地 Agent(有 onMessage 回调)直接调用回调
   * 远程 Agent 放入队列
   */
  broadcast(message: RoutableMessage): boolean {
    const { fromAgentId } = message;
    let delivered = 0;

    for (const [agentId, agent] of this.agentRegistry.entries()) {
      // 不发送给自己
      if (agentId === fromAgentId) {
        continue;
      }

      // 如果目标 Agent 有本地回调,直接调用
      if (agent.onMessage) {
        try {
          agent.onMessage({
            messageId: message.messageId,
            fromAgentId: message.fromAgentId,
            toAgentId: agentId,
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
          });
          delivered++;
        } catch (err) {
          this.logger.error('Broadcast callback error', {
            agentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        // 无回调,放入队列
        const queue = this.queueManager.getQueue(agentId);
        if (!queue) {
          continue;
        }

        this.queueManager.enqueue(queue, {
          ...message,
          toAgentId: agentId,
        });
        delivered++;
      }
    }

    this.logger.debug('Message broadcasted', {
      messageId: message.messageId,
      fromAgentId,
      deliveredCount: delivered,
    });

    return delivered > 0;
  }

  /**
   * RFC 004: 异步广播消息给所有 Agent(包含 webhook 转发)
   *
   * 路由优先级:
   * 1. 本地回调 (onMessage) - 最快,直接推送
   * 2. Agent webhook URL - 远程 Agent 立即推送
   * 3. 消息队列 - HTTP 轮询方式
   *
   * @param message 要广播的消息
   * @returns Promise<boolean> 是否成功投递给至少一个 Agent
   */
  async broadcastAsync(message: RoutableMessage): Promise<boolean> {
    const { fromAgentId } = message;
    let delivered = 0;

    for (const [agentId, agent] of this.agentRegistry.entries()) {
      // 不发送给自己
      if (agentId === fromAgentId) {
        continue;
      }

      // 优先级 1: 如果目标 Agent 有本地回调,直接调用
      if (agent.onMessage) {
        try {
          agent.onMessage({
            messageId: message.messageId,
            fromAgentId: message.fromAgentId,
            toAgentId: agentId,
            content: message.content,
            type: message.type,
            createdAt: message.createdAt,
          });
          delivered++;
        } catch (err) {
          this.logger.error('Broadcast callback error', {
            agentId,
            error: err instanceof Error ? err.message : String(err),
          });
          // 继续尝试 webhook 或队列
        }
        continue; // 本地回调成功/失败后跳过 webhook
      }

      // 优先级 2: RFC 004 - Agent webhook 转发
      if (agent.webhook?.url) {
        const broadcastMessage = { ...message, toAgentId: agentId };
        const webhookResult = await this.webhookPusher.forwardToAgentWebhook(broadcastMessage, agent);
        if (webhookResult.success) {
          delivered++;
          this.logger.debug('Message broadcast to Agent via webhook', {
            messageId: message.messageId,
            toAgentId: agentId,
          });
          continue; // Webhook 成功,跳过队列
        }
        // Webhook 失败,降级到队列
        this.logger.warn('Broadcast webhook failed, falling back to queue', {
          toAgentId: agentId,
          error: webhookResult.error,
        });
      }

      // 优先级 3: 无回调或 webhook 失败,放入队列
      const queue = this.queueManager.getQueue(agentId);
      if (!queue) {
        continue;
      }

      this.queueManager.enqueue(queue, {
        ...message,
        toAgentId: agentId,
      });
      delivered++;
    }

    this.logger.debug('Message async broadcasted', {
      messageId: message.messageId,
      fromAgentId,
      deliveredCount: delivered,
    });

    return delivered > 0;
  }

  /**
   * 获取 Agent 的待处理消息
   */
  getMessages(agentId: string, limit?: number): RoutableMessage[] {
    return this.queueManager.pollQueue(agentId, limit);
  }

  /**
   * 清除 Agent 的消息(确认已处理)
   */
  clearMessages(agentId: string, messageIds?: string[]): number {
    return this.queueManager.clearMessages(agentId, messageIds);
  }

  /**
   * 获取路由统计信息
   */
  getStats(): {
    queues: number;
    totalMessages: number;
    queueStats: Record<string, { size: number; maxSize: number }>;
  } {
    return this.queueManager.getStats();
  }

  /**
   * 清理过期的消息(超过指定时间)
   */
  cleanupExpired(maxAgeMs: number): number {
    return this.queueManager.cleanupExpired(maxAgeMs);
  }

  /**
   * RFC 004: 清理 Agent webhook 服务缓存
   * 当 Agent 注销或 webhook 配置变更时调用
   *
   * @param agentId Agent ID
   */
  clearWebhookCache(agentId: string): void {
    this.webhookPusher.clearWebhookCache(agentId);
  }

  /**
   * 更新 Agent 注册表
   * 公开方法,允许外部更新注册表引用
   */
  updateRegistry(registry: Map<string, AgentRegistration>): void {
    this.agentRegistry = registry;
    this.logger.info('Agent registry updated', { count: registry.size });
  }

  // ========================================================================
  // RFC 005: 统一路由入口
  // ========================================================================

  /**
   * RFC 005: 路由入站消息
   *
   * 处理从 P2P 网络收到的消息,路由到本地 Agent
   * 路由优先级:
   * 1. 本地回调 (onMessage) - 最快,直接推送
   * 2. Agent webhook URL - 远程 Agent 立即推送
   * 3. 消息队列 - HTTP 轮询方式
   *
   * @param payload P2P 消息载荷
   * @param fromPeerId 发送方 PeerId
   * @returns Promise<void> 路由结果
   */
  async routeIncoming(payload: unknown, fromPeerId: string): Promise<void> {
    this.logger.debug('Routing incoming message', {
      fromPeerId: fromPeerId.slice(0, 16),
      payloadType: typeof payload,
    });

    // 解析消息
    const message = payload as {
      messageId?: string;
      fromAgentId?: string;
      toAgentId?: string;
      content?: string;
      type?: string;
      createdAt?: string;
      metadata?: Record<string, unknown>;
    };

    // 验证必要字段
    if (!message.toAgentId) {
      this.logger.warn('Incoming message missing toAgentId, dropping', {
        fromPeerId: fromPeerId.slice(0, 16),
      });
      this.emit('message:dropped', {
        reason: 'missing-target',
        fromPeerId,
      });
      return;
    }

    // 构造 RoutableMessage
    const routableMessage: RoutableMessage = {
      messageId: message.messageId || `msg-${Date.now()}`,
      fromAgentId: message.fromAgentId || '',
      toAgentId: message.toAgentId,
      content: message.content || '',
      metadata: message.metadata,
      type: (message.type as RoutableMessage['type']) || 'message',
      createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
    };

    // 检查目标 Agent 是否本地
    const targetAgent = this.agentRegistry.get(message.toAgentId);

    if (targetAgent) {
      // 目标 Agent 在本地
      // 使用 routeAsync 进行完整路由(包含 webhook)
      const routed = await this.routeAsync(routableMessage);
      if (routed) {
        this.logger.info('Incoming message routed to local Agent', {
          messageId: routableMessage.messageId,
          toAgentId: message.toAgentId,
        });
        this.emit('message:received', routableMessage);
      } else {
        this.logger.warn('Incoming message routing failed', {
          messageId: routableMessage.messageId,
          toAgentId: message.toAgentId,
        });
        this.emit('message:dropped', {
          reason: 'routing-failed',
          agentId: message.toAgentId,
        });
      }
    } else {
      // 目标 Agent 不在本地
      this.logger.warn('Incoming message target Agent not found locally', {
        messageId: routableMessage.messageId,
        toAgentId: message.toAgentId,
      });
      this.emit('message:dropped', {
        reason: 'unknown-agent',
        agentId: message.toAgentId,
      });
    }
  }

  /**
   * RFC 005: 路由出站消息
   *
   * 处理本地 Agent 发送的消息,判断目标是否本地或远程
   * - 本地 Agent: 直接调用 routeAsync
   * - 远程 Agent: 通过 P2P 网络发送
   *
   * @param message 路由消息
   * @returns Promise<Result<void>> 路由结果
   */
  async routeOutgoing(message: RoutableMessage): Promise<Result<void>> {
    this.logger.debug('Routing outgoing message', {
      messageId: message.messageId,
      fromAgentId: message.fromAgentId,
      toAgentId: message.toAgentId,
    });

    // 验证目标 Agent ID
    if (!message.toAgentId) {
      this.logger.warn('Outgoing message missing toAgentId');
      return failureFromError('INVALID_PARAMS', 'Target AgentId required for routing');
    }

    // 验证发送方 Agent 存在
    if (!this.agentRegistry.has(message.fromAgentId)) {
      this.logger.warn('Sender agent not registered', { fromAgentId: message.fromAgentId });
      return failureFromError('UNAUTHORIZED', `Sender agent not registered: ${message.fromAgentId}`);
    }

    // 检查目标 Agent 是否本地
    const targetAgent = this.agentRegistry.get(message.toAgentId);

    if (targetAgent) {
      // 目标 Agent 在本地
      const routed = await this.routeAsync(message);
      if (routed) {
        this.logger.info('Outgoing message routed locally', {
          messageId: message.messageId,
          toAgentId: message.toAgentId,
        });
        this.emit('message:sent', message);
        return success(undefined);
      } else {
        this.logger.warn('Local routing failed', {
          messageId: message.messageId,
          toAgentId: message.toAgentId,
        });
        return failureFromError('TASK_FAILED', 'Local message routing failed');
      }
    }

    // 目标 Agent 不在本地,尝试远程路由
    if (!this.p2pNetwork) {
      this.logger.warn('P2P network not configured for remote routing');
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not configured for remote routing');
    }

    const result = await this.routeRemote(message);

    if (result.success) {
      this.logger.info('Outgoing message sent remotely', {
        messageId: message.messageId,
        toAgentId: message.toAgentId,
      });
      this.emit('message:sent', message);
    } else {
      this.logger.error('Remote routing failed', {
        messageId: message.messageId,
        toAgentId: message.toAgentId,
        error: result.error,
      });
      this.emit('message:dropped', {
        reason: 'remote-failed',
        agentId: message.toAgentId,
        error: result.error,
      });
    }

    return result;
  }

  /**
   * RFC 005: 通过 PeerId 前缀查找 Peer
   *
   * 从 AgentId 中提取 PeerId 前缀并查找对应的 Peer
   * AgentId 格式: agent:<PeerId前16位>:<随机8位>
   *
   * @param agentId Agent ID
   * @returns PeerId 或 null
   */
  findPeerByAgentId(agentId: string): string | null {
    const parts = agentId.split(':');
    if (parts.length !== 3 || parts[0] !== 'agent') {
      this.logger.warn('Invalid AgentId format', { agentId });
      return null;
    }

    const peerIdPrefix = parts[1];
    if (peerIdPrefix.length !== 16) {
      this.logger.warn('Invalid PeerId prefix in AgentId', { agentId, prefix: peerIdPrefix });
      return null;
    }

    // 如果 P2P 网络可用,查找匹配的 Peer
    if (this.p2pNetwork) {
      const connectedPeers = this.p2pNetwork.getConnectedPeers();
      for (const peer of connectedPeers) {
        if (peer.peerId.startsWith(peerIdPrefix)) {
          return peer.peerId;
        }
      }

      // 尝试从所有已知 Peers 查找
      const allPeers = this.p2pNetwork.getAllPeers();
      for (const peer of allPeers) {
        if (peer.peerId.startsWith(peerIdPrefix)) {
          return peer.peerId;
        }
      }
    }

    return null;
  }
}