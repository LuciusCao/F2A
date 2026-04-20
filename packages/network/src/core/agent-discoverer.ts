/**
 * AgentDiscoverer - Agent 发现服务
 * 
 * 从 P2PNetwork 中提取的 Agent 发现逻辑
 * 使用依赖注入模式，便于测试和维护
 */

import { randomUUID } from 'crypto';
import type { Multiaddr } from '@multiformats/multiaddr';
import type { AgentInfo, F2AMessage, DiscoverPayload, StructuredMessagePayload } from '../types/index.js';
import { MESSAGE_TOPICS } from '../types/index.js';
import type { AgentDiscovererDeps } from '../types/p2p-handlers.js';
import { getErrorMessage } from '../utils/error-utils.js';

/**
 * AgentDiscoverer
 * 
 * 处理 Agent 发现逻辑
 */
export class AgentDiscoverer {
  private deps: AgentDiscovererDeps;

  constructor(deps: AgentDiscovererDeps) {
    this.deps = deps;
  }

  /**
   * 发现网络中的 Agent（按能力过滤）
   * @param capability 可选的能力过滤
   * @param options 发现选项
   */
  async discover(capability?: string, options?: {
    timeoutMs?: number;
    waitForFirstResponse?: boolean;
  }): Promise<AgentInfo[]> {
    const timeoutMs = options?.timeoutMs ?? 10000;  // 默认 10s 超时
    const waitForFirst = options?.waitForFirstResponse ?? false;

    // 使用锁保护创建快照，防止并发修改
    const agents: AgentInfo[] = [];
    const seenPeerIds = new Set<string>();
    
    try {
      for (const peer of this.deps.peerManager.getPeerTable().values()) {
        if (peer.agentInfo) {
          if (!capability || this.hasCapability(peer.agentInfo, capability)) {
            agents.push(peer.agentInfo);
            seenPeerIds.add(peer.agentInfo.peerId);
          }
        }
      }
    } finally {
      // Lock no longer needed - PeerManager handles locking internally
    }

    // 如果已经有足够的 agents 且不需要等待响应，直接返回
    if (agents.length > 0 && !waitForFirst) {
      return agents;
    }

    // 广播能力查询以发现更多节点（使用 MESSAGE 协议）
    await this.deps.broadcast({
      id: randomUUID(),
      type: 'MESSAGE',
      from: this.deps.agentInfo.peerId,
      timestamp: Date.now(),
      payload: {
        topic: MESSAGE_TOPICS.CAPABILITY_QUERY,
        content: { capabilityName: capability }
      } as StructuredMessagePayload
    });

    // 使用 Promise.race 等待首个响应或超时
    if (waitForFirst) {
      const discoveredAgents = await this.deps.waitForPeerDiscovered(capability, timeoutMs);
      for (const agent of discoveredAgents) {
        if (!seenPeerIds.has(agent.peerId)) {
          agents.push(agent);
          seenPeerIds.add(agent.peerId);
        }
      }
    } else {
      // 等待响应（可配置超时）
      await new Promise(resolve => setTimeout(resolve, timeoutMs));
    }

    // 再次收集
    try {
      for (const peer of this.deps.peerManager.getPeerTable().values()) {
        if (peer.agentInfo && !seenPeerIds.has(peer.agentInfo.peerId)) {
          if (!capability || this.hasCapability(peer.agentInfo, capability)) {
            agents.push(peer.agentInfo);
            seenPeerIds.add(peer.agentInfo.peerId);
          }
        }
      }
    } finally {
      // Lock no longer needed
    }

    return agents;
  }

  /**
   * mDNS 发现后的连接和 DISCOVER 发送逻辑
   * @param peerId 发现的 Peer ID
   * @param multiaddrs 发现的 multiaddr 列表
   * @param node libp2p 节点（需要传入用于 dial）
   * @param sendMessage 发送消息的回调
   */
  async initiateDiscovery(
    peerId: string, 
    multiaddrs: Multiaddr[],
    node: { dial: (addr: Multiaddr) => Promise<any> } | null,
    sendMessage: (peerId: string, message: F2AMessage) => Promise<void>
  ): Promise<void> {
    try {
      if (!node || multiaddrs.length === 0) {
        return;
      }

      // 尝试连接到发现的节点
      await node.dial(multiaddrs[0]);
      this.deps.logger.info('Initiating connection to mDNS peer for discovery', {
        peerId: peerId.slice(0, 16)
      });

      // 【关键修复】等待 peer:connect 事件处理完成
      let retries = 0;
      const maxRetries = 10;
      while (!this.deps.peerManager.getConnectedPeersSet().has(peerId) && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      
      if (!this.deps.peerManager.getConnectedPeersSet().has(peerId)) {
        this.deps.logger.warn('Connection established but peer:connect event not received', {
          peerId: peerId.slice(0, 16),
          waitMs: retries * 100
        });
      }

      // 发送 DISCOVER 消息获取真实 AgentInfo
      const discoverMessage: F2AMessage = {
        id: randomUUID(),
        type: 'DISCOVER',
        from: this.deps.agentInfo.peerId,
        timestamp: Date.now(),
        payload: { agentInfo: this.deps.agentInfo } as DiscoverPayload
      };

      await sendMessage(peerId, discoverMessage);
      this.deps.logger.info('Sent DISCOVER to mDNS peer', {
        peerId: peerId.slice(0, 16)
      });
    } catch (connectError) {
      // 连接失败不应阻止发现流程，记录警告即可
      this.deps.logger.warn('Failed to connect/send DISCOVER to mDNS peer', {
        peerId: peerId.slice(0, 16),
        error: getErrorMessage(connectError)
      });
    }
  }

  /**
   * 检查 Agent 是否有特定能力
   */
  hasCapability(agentInfo: AgentInfo, capabilityName: string): boolean {
    return agentInfo.capabilities.some(c => c.name === capabilityName);
  }

  /**
   * 通过 DHT 发现节点（全局发现）
   */
  async discoverViaDHT(options?: {
    peerId?: string;
    timeout?: number;
  }): Promise<{ success: boolean; data?: string[]; error?: { message: string } }> {
    return this.deps.dhtService.discoverPeersViaDHT(options);
  }

  /**
   * 通过 DHT 查找特定节点
   */
  async findPeerViaDHT(peerId: string): Promise<{ success: boolean; data?: string[]; error?: { message: string } }> {
    return this.deps.dhtService.findPeerViaDHT(peerId);
  }
}