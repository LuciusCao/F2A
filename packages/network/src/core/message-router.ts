/**
 * Message Router
 * 处理 Daemon 内部 Agent 之间的消息路由
 */

import { Logger } from '../utils/logger.js';
import type { AgentRegistration } from './agent-registry.js';
import type { P2PNetwork } from './p2p-network.js';
import type { Result, StructuredMessagePayload, MESSAGE_TOPICS } from '../types/index.js';
import { success, failureFromError } from '../types/result.js';

/**
 * 路由消息类型
 */
export interface RoutableMessage {
  /** 消息 ID */
  messageId: string;
  /** 发送方 Agent ID */
  fromAgentId: string;
  /** 目标 Agent ID（可选，不指定则广播） */
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

/**
 * 消息队列（每个 Agent 独立）
 */
export interface MessageQueue {
  /** Agent ID */
  agentId: string;
  /** 消息列表 */
  messages: RoutableMessage[];
  /** 最大队列大小 */
  maxSize: number;
}

/**
 * 消息路由器
 * 管理 Agent 之间的消息路由和队列
 */
export class MessageRouter {
  private queues: Map<string, MessageQueue> = new Map();
  private agentRegistry: Map<string, AgentRegistration>;
  private p2pNetwork?: P2PNetwork;
  private logger: Logger;
  private defaultMaxQueueSize: number = 100;

  constructor(agentRegistry: Map<string, AgentRegistration>, p2pNetwork?: P2PNetwork, options?: {
    maxQueueSize?: number;
  }) {
    this.agentRegistry = agentRegistry;
    this.p2pNetwork = p2pNetwork;
    this.logger = new Logger({ component: 'MessageRouter' });
    this.defaultMaxQueueSize = options?.maxQueueSize || 100;
  }

  /**
   * 为 Agent 创建消息队列
   */
  createQueue(agentId: string, maxSize?: number): void {
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, {
        agentId,
        messages: [],
        maxSize: maxSize || this.defaultMaxQueueSize,
      });
      this.logger.info('Message queue created', { agentId });
    }
  }

  /**
   * 删除 Agent 的消息队列
   */
  deleteQueue(agentId: string): void {
    if (this.queues.has(agentId)) {
      this.queues.delete(agentId);
      this.logger.info('Message queue deleted', { agentId });
    }
  }

  /**
   * 获取 Agent 的消息队列
   */
  getQueue(agentId: string): MessageQueue | undefined {
    return this.queues.get(agentId);
  }

  /**
   * 路由消息到特定 Agent
   * 
   * 如果目标 Agent 有本地回调（onMessage），直接调用回调
   * 否则放入消息队列（等待 HTTP 轮询）
   */
  route(message: RoutableMessage): boolean {
    const { toAgentId, fromAgentId } = message;

    // 验证发送方存在
    if (!this.agentRegistry.has(fromAgentId)) {
      this.logger.warn('Sender agent not registered', { fromAgentId });
      return false;
    }

    // 如果指定了目标 Agent，路由到该 Agent
    if (toAgentId) {
      const targetAgent = this.agentRegistry.get(toAgentId);
      if (!targetAgent) {
        this.logger.warn('Target agent not registered', { toAgentId });
        return false;
      }

      // 如果目标 Agent 有本地回调，直接调用（无需队列）
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
          // 回调失败，降级到队列
        }
      }

      // 无回调或回调失败，放入队列
      const queue = this.queues.get(toAgentId);
      if (!queue) {
        this.logger.warn('Target agent queue not found', { toAgentId });
        return false;
      }

      // 检查队列大小，防止溢出
      if (queue.messages.length >= queue.maxSize) {
        queue.messages.shift();
        this.logger.warn('Queue overflow, removed oldest message', { toAgentId });
      }

      queue.messages.push(message);
      this.logger.debug('Message routed to queue', {
        messageId: message.messageId,
        toAgentId,
        fromAgentId,
      });
      return true;
    }

    // 如果未指定目标 Agent，广播给所有 Agent（除了发送方）
    return this.broadcast(message);
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

    // 查找对应的 PeerId（通过 prefix 匹配）
    const targetPeerId = await this.findPeerIdByPrefix(peerIdPrefix);
    if (!targetPeerId) {
      this.logger.warn('Target peer not found by AgentId prefix', { peerIdPrefix, toAgentId });
      return failureFromError('PEER_NOT_FOUND', `Peer not found for AgentId: ${toAgentId}`);
    }

    // 构造 P2P 消息载荷
    // topic: 'agent.message' 用于 Agent 间通信
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
   * @param prefix PeerId 前缀（16 位）
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

    // 如果未找到，尝试从所有已知 Peers 查找
    const allPeers = this.p2pNetwork.getAllPeers();
    for (const peer of allPeers) {
      if (peer.peerId.startsWith(prefix)) {
        return peer.peerId;
      }
    }

    // 尝试通过 DHT 查找（如果启用）
    if (this.p2pNetwork.isDHTEnabled()) {
      // 构造可能的 PeerId（需要完整 PeerId 才能查询 DHT）
      // 这里只能返回 null，因为 DHT 需要完整的 PeerId
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
   * 本地 Agent（有 onMessage 回调）直接调用回调
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

      // 如果目标 Agent 有本地回调，直接调用
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
        // 无回调，放入队列
        const queue = this.queues.get(agentId);
        if (!queue) {
          continue;
        }

        if (queue.messages.length >= queue.maxSize) {
          queue.messages.shift();
          this.logger.warn('Queue overflow during broadcast', { agentId });
        }

        queue.messages.push({
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
   * 获取 Agent 的待处理消息
   */
  getMessages(agentId: string, limit?: number): RoutableMessage[] {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return [];
    }

    const messages = queue.messages.slice(0, limit || queue.messages.length);
    return messages;
  }

  /**
   * 清除 Agent 的消息（确认已处理）
   */
  clearMessages(agentId: string, messageIds?: string[]): number {
    const queue = this.queues.get(agentId);
    if (!queue) {
      return 0;
    }

    if (!messageIds) {
      // 清除所有消息
      const count = queue.messages.length;
      queue.messages = [];
      return count;
    }

    // 清除指定的消息
    const originalCount = queue.messages.length;
    queue.messages = queue.messages.filter(
      msg => !messageIds.includes(msg.messageId)
    );
    return originalCount - queue.messages.length;
  }

  /**
   * 获取路由统计信息
   */
  getStats(): {
    queues: number;
    totalMessages: number;
    queueStats: Record<string, { size: number; maxSize: number }>;
  } {
    const queueStats: Record<string, { size: number; maxSize: number }> = {};
    let totalMessages = 0;

    for (const [agentId, queue] of this.queues.entries()) {
      queueStats[agentId] = {
        size: queue.messages.length,
        maxSize: queue.maxSize,
      };
      totalMessages += queue.messages.length;
    }

    return {
      queues: this.queues.size,
      totalMessages,
      queueStats,
    };
  }

  /**
   * 清理过期的消息（超过指定时间）
   */
  cleanupExpired(maxAgeMs: number): number {
    const now = Date.now();
    let cleaned = 0;

    for (const queue of this.queues.values()) {
      const originalCount = queue.messages.length;
      queue.messages = queue.messages.filter(msg => {
        const age = now - msg.createdAt.getTime();
        return age <= maxAgeMs;
      });
      cleaned += originalCount - queue.messages.length;
    }

    if (cleaned > 0) {
      this.logger.info('Expired messages cleaned', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * 更新 Agent 注册表
   * 公开方法，允许外部更新注册表引用
   */
  updateRegistry(registry: Map<string, AgentRegistration>): void {
    this.agentRegistry = registry;
    this.logger.info('Agent registry updated', { count: registry.size });
  }
}