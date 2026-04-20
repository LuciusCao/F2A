/**
 * DiscoveryService - Agent 发现服务
 * 
 * 负责：
 * - Agent 发现广播
 * - 发现响应处理
 * - Discovery 消息速率限制
 * 
 * Phase 4a+4b: 从 P2PNetwork 中提取为独立类
 */

import { EventEmitter } from 'eventemitter3';
import { PeerManager } from './peer-manager.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { Logger } from '../utils/logger.js';
import type { AgentInfo, F2AMessage, DiscoverPayload } from '../types/index.js';
import { randomUUID } from 'crypto';

export interface DiscoveryServiceEvents {
  /** 广播消息事件 */
  'broadcast': (message: F2AMessage) => void;
  /** 发送给特定 Peer 的消息事件 */
  'send': (data: { peerId: string; message: F2AMessage }) => void;
  /** 发现结果事件 */
  'discover:result': (agents: AgentInfo[]) => void;
}

/** 发现选项 */
export interface DiscoverOptions {
  /** 发现超时毫秒（默认 30000） */
  timeoutMs?: number;
  /** 是否等待首个响应即返回（默认 false） */
  waitForFirstResponse?: boolean;
}

/**
 * DiscoveryService 类
 * 管理 Agent 发现相关的逻辑
 */
export class DiscoveryService extends EventEmitter<DiscoveryServiceEvents> {
  private peerManager: PeerManager;
  private rateLimiter: RateLimiter;
  private logger: Logger;
  private agentInfo: AgentInfo;
  
  /** 待处理的发现请求 */
  private pendingDiscoveries: Map<string, {
    resolve: (agents: AgentInfo[]) => void;
    agents: AgentInfo[];
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(options: {
    peerManager: PeerManager;
    agentInfo: AgentInfo;
  }) {
    super();
    this.peerManager = options.peerManager;
    this.agentInfo = options.agentInfo;
    this.rateLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60 * 1000 });
    this.logger = new Logger({ component: 'DiscoveryService' });
  }

  /**
   * 停止服务，清理资源
   */
  stop(): void {
    // 清理所有待处理的发现请求
    for (const [_id, pending] of this.pendingDiscoveries) {
      clearTimeout(pending.timeout);
      pending.resolve([]);
    }
    this.pendingDiscoveries.clear();
    
    // 停止速率限制器
    this.rateLimiter.stop();
    
    this.logger.info('DiscoveryService stopped');
  }

  /**
   * 发现网络中的 Agent（按能力过滤）
   * @param capability 可选的能力过滤
   * @param options 发现选项
   */
  async discoverAgents(capability?: string, options?: DiscoverOptions): Promise<AgentInfo[]> {
    const timeoutMs = options?.timeoutMs || 30000;
    const waitForFirst = options?.waitForFirstResponse || false;

    // 先从已知 peers 收集
    const agents: AgentInfo[] = [];
    const seenPeerIds = new Set<string>();
    
    for (const peer of this.peerManager.list()) {
      if (peer.agentInfo) {
        if (!capability || this.hasCapability(peer.agentInfo, capability)) {
          agents.push(peer.agentInfo);
          seenPeerIds.add(peer.agentInfo.peerId);
        }
      }
    }

    // 如果已经有足够的 agents 且不需要等待响应，直接返回
    if (agents.length > 0 && !waitForFirst) {
      return agents;
    }

    // 发送广播
    const message = this.createDiscoverMessage(capability);
    this.emit('broadcast', message);

    // 等待响应
    return new Promise<AgentInfo[]>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingDiscoveries.delete(message.id);
        resolve(this.collectAgents(capability));
      }, timeoutMs);

      this.pendingDiscoveries.set(message.id, {
        resolve: (collectedAgents) => {
          clearTimeout(timeout);
          this.pendingDiscoveries.delete(message.id);
          resolve(collectedAgents);
        },
        agents,
        timeout,
      });
    });
  }

  /**
   * 创建发现消息
   */
  private createDiscoverMessage(_capability?: string): F2AMessage {
    return {
      id: randomUUID(),
      type: 'DISCOVER',
      from: this.agentInfo.peerId,
      timestamp: Date.now(),
      payload: { 
        agentInfo: this.agentInfo,
      } as DiscoverPayload,
    };
  }

  /**
   * 向特定 Peer 发起发现请求
   * 用于 mDNS 发现后的主动发现
   */
  async initiateDiscovery(peerId: string): Promise<void> {
    // 检查速率限制
    if (!this.rateLimiter.allowRequest(peerId)) {
      this.logger.warn('Discovery rate limited', { peerId: peerId.slice(0, 16) });
      return;
    }

    this.emit('send', {
      peerId,
      message: this.createDiscoverMessage(),
    });
    
    this.logger.info('Initiating discovery', { peerId: peerId.slice(0, 16) });
  }

  /**
   * 处理发现响应
   * 当收到 DISCOVER 或 DISCOVER_RESP 消息时调用
   */
  async handleDiscoverResponse(agentInfo: AgentInfo, peerId: string, messageId?: string): Promise<void> {
    // 安全验证：确保 agentInfo.peerId 与发送方一致
    if (agentInfo.peerId !== peerId) {
      this.logger.warn('Discovery message rejected: peerId mismatch', {
        claimedPeerId: agentInfo.peerId?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16),
      });
      return;
    }

    // 更新 PeerManager
    await this.peerManager.upsertFromAgentInfo(agentInfo, peerId);

    // 如果有 pending discovery，收集结果
    if (messageId && this.pendingDiscoveries.has(messageId)) {
      const pending = this.pendingDiscoveries.get(messageId)!;
      pending.agents.push(agentInfo);
      
      // 注意：这里不立即 resolve，等待超时后收集所有响应
      // 如果需要 waitForFirst，应该在创建 Promise 时处理
    }
  }

  /**
   * 从 PeerManager 收集符合条件的 Agents
   */
  private collectAgents(capability?: string): AgentInfo[] {
    const peers = this.peerManager.list();
    return peers
      .filter(p => p.agentInfo)
      .filter(p => !capability || this.hasCapability(p.agentInfo!, capability))
      .map(p => p.agentInfo!);
  }

  /**
   * 检查 Agent 是否有特定能力
   */
  private hasCapability(agentInfo: AgentInfo, capabilityName: string): boolean {
    return agentInfo.capabilities?.some(c => c.name === capabilityName) || false;
  }

  /**
   * 广播发现消息
   * 主动发送 DISCOVER 消息到所有连接的 Peers
   */
  broadcastDiscovery(): void {
    const message = this.createDiscoverMessage();
    this.emit('broadcast', message);
    this.logger.info('Discovery broadcast sent');
  }

  /**
   * 获取速率限制器状态
   */
  getRateLimiterStatus(): { isDisposed: boolean } {
    return {
      isDisposed: this.rateLimiter.isDisposed(),
    };
  }
}