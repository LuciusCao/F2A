/**
 * P2P 网络管理器
 * 基于 libp2p 实现 Agent 发现与通信
 */

import { createLibp2p, Libp2pOptions } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import type { Libp2p } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';

import {
  P2PNetworkConfig,
  AgentInfo,
  AgentCapability,
  F2AMessage,
  F2AMessageType,
  PeerInfo,
  PeerDiscoveredEvent,
  PeerConnectedEvent,
  PeerDisconnectedEvent,
  Result,
  TaskRequestPayload,
  TaskResponsePayload,
  DiscoverPayload,
  CapabilityQueryPayload,
  CapabilityResponsePayload
} from '../types';

// F2A 协议标识
const F2A_PROTOCOL = '/f2a/1.0.0';
const F2A_BROADCAST_TOPIC = 'f2a:broadcast';

export interface P2PNetworkEvents {
  'peer:discovered': (event: PeerDiscoveredEvent) => void;
  'peer:connected': (event: PeerConnectedEvent) => void;
  'peer:disconnected': (event: PeerDisconnectedEvent) => void;
  'message:received': (message: F2AMessage, peerId: string) => void;
  'error': (error: Error) => void;
}

export class P2PNetwork extends EventEmitter<P2PNetworkEvents> {
  private node: Libp2p | null = null;
  private config: P2PNetworkConfig;
  private peerTable: Map<string, PeerInfo> = new Map();
  private agentInfo: AgentInfo;
  private pendingTasks: Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }> = new Map();

  constructor(agentInfo: AgentInfo, config: P2PNetworkConfig = {}) {
    super();
    this.agentInfo = agentInfo;
    this.config = {
      listenPort: 0, // 随机端口
      enableMDNS: true,
      enableDHT: false,
      ...config
    };
  }

  /**
   * 启动 P2P 网络
   */
  async start(): Promise<Result<{ peerId: string; addresses: string[] }>> {
    try {
      // 生成或加载密钥对
      const privateKey = await generateKeyPair('Ed25519');
      const peerId = peerIdFromPrivateKey(privateKey);

      // 构建监听地址
      const listenAddresses = this.config.listenAddresses || [
        `/ip4/0.0.0.0/tcp/${this.config.listenPort}`
      ];

      // 创建 libp2p 节点
      this.node = await createLibp2p({
        privateKey,
        addresses: {
          listen: listenAddresses
        },
        transports: [tcp()],
        connectionEncryption: [], // 使用明文，应用层加密
        services: {}
      });

      // 设置事件监听
      this.setupEventHandlers();

      // 启动节点
      await this.node.start();

      // 获取实际监听地址
      const addrs = this.node.getMultiaddrs().map(ma => ma.toString());
      
      // 更新 agentInfo
      this.agentInfo.peerId = peerId.toString();
      this.agentInfo.multiaddrs = addrs;

      // 连接引导节点
      if (this.config.bootstrapPeers) {
        await this.connectToBootstrapPeers(this.config.bootstrapPeers);
      }

      // 启动定期发现广播
      this.startDiscoveryBroadcast();

      console.log(`[P2P] Started with peerId: ${peerId.toString().slice(0, 16)}...`);
      console.log(`[P2P] Listening on:`, addrs);

      return {
        success: true,
        data: { peerId: peerId.toString(), addresses: addrs }
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { success: false, error: err.message };
    }
  }

  /**
   * 停止 P2P 网络
   */
  async stop(): Promise<void> {
    if (this.node) {
      // 清理待处理任务
      for (const [taskId, { timeout }] of this.pendingTasks) {
        clearTimeout(timeout);
      }
      this.pendingTasks.clear();

      await this.node.stop();
      this.node = null;
      console.log('[P2P] Stopped');
    }
  }

  /**
   * 发现网络中的 Agent（按能力过滤）
   */
  async discoverAgents(capability?: string): Promise<AgentInfo[]> {
    const agents: AgentInfo[] = [];
    
    for (const peer of this.peerTable.values()) {
      if (peer.agentInfo) {
        if (!capability || this.hasCapability(peer.agentInfo, capability)) {
          agents.push(peer.agentInfo);
        }
      }
    }

    // 广播能力查询以发现更多节点
    await this.broadcast({
      id: randomUUID(),
      type: 'CAPABILITY_QUERY',
      from: this.agentInfo.peerId,
      timestamp: Date.now(),
      payload: { capabilityName: capability } as CapabilityQueryPayload
    });

    // 等待响应（简化版，实际应该使用 Promise + timeout）
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 再次收集
    for (const peer of this.peerTable.values()) {
      if (peer.agentInfo && !agents.find(a => a.peerId === peer.agentInfo!.peerId)) {
        if (!capability || this.hasCapability(peer.agentInfo, capability)) {
          agents.push(peer.agentInfo);
        }
      }
    }

    return agents;
  }

  /**
   * 向特定 Peer 发送任务请求
   */
  async sendTaskRequest(
    peerId: string,
    taskType: string,
    description: string,
    parameters?: Record<string, unknown>,
    timeout: number = 30000
  ): Promise<Result<unknown>> {
    const taskId = randomUUID();
    
    const message: F2AMessage = {
      id: taskId,
      type: 'TASK_REQUEST',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: {
        taskId,
        taskType,
        description,
        parameters,
        timeout: Math.floor(timeout / 1000)
      } as TaskRequestPayload
    };

    // 发送消息
    const sendResult = await this.sendMessage(peerId, message);
    if (!sendResult.success) {
      return sendResult;
    }

    // 等待响应
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        resolve({ success: false, error: 'Task timeout' });
      }, timeout);

      this.pendingTasks.set(taskId, {
        resolve: (result: unknown) => {
          clearTimeout(timeoutId);
          this.pendingTasks.delete(taskId);
          resolve({ success: true, data: result });
        },
        reject: (error: string) => {
          clearTimeout(timeoutId);
          this.pendingTasks.delete(taskId);
          resolve({ success: false, error });
        },
        timeout: timeoutId
      });
    });
  }

  /**
   * 发送任务响应
   */
  async sendTaskResponse(
    peerId: string,
    taskId: string,
    status: 'success' | 'error' | 'rejected' | 'delegated',
    result?: unknown,
    error?: string
  ): Promise<Result<void>> {
    const message: F2AMessage = {
      id: randomUUID(),
      type: 'TASK_RESPONSE',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: {
        taskId,
        status,
        result,
        error
      } as TaskResponsePayload
    };

    return this.sendMessage(peerId, message);
  }

  /**
   * 广播发现消息
   */
  private async broadcastDiscovery(): Promise<void> {
    const message: F2AMessage = {
      id: randomUUID(),
      type: 'DISCOVER',
      from: this.agentInfo.peerId,
      timestamp: Date.now(),
      payload: { agentInfo: this.agentInfo } as DiscoverPayload
    };

    await this.broadcast(message);
  }

  /**
   * 广播消息到全网
   */
  private async broadcast(message: F2AMessage): Promise<void> {
    if (!this.node) return;

    // 向所有已连接的对等节点发送
    for (const peer of this.node.getPeers()) {
      try {
        await this.sendMessage(peer.toString(), message);
      } catch {
        // 忽略发送失败
      }
    }
  }

  /**
   * 向特定 Peer 发送消息
   */
  private async sendMessage(peerId: string, message: F2AMessage): Promise<Result<void>> {
    if (!this.node) {
      return { success: false, error: 'P2P network not started' };
    }

    try {
      // 获取 PeerInfo
      const peerInfo = this.peerTable.get(peerId);
      if (!peerInfo || peerInfo.multiaddrs.length === 0) {
        return { success: false, error: `Peer ${peerId} not found` };
      }

      // 拨号连接（如果未连接）
      const peer = await this.node.dial(peerInfo.multiaddrs[0]);
      
      // 使用协议流发送消息
      const stream = await peer.newStream(F2A_PROTOCOL);
      const data = Buffer.from(JSON.stringify(message));
      await stream.sink([data]);
      await stream.close();

      return { success: true, data: undefined };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return { success: false, error: err.message };
    }
  }

  /**
   * 设置 libp2p 事件处理
   */
  private setupEventHandlers(): void {
    if (!this.node) return;

    // 新连接
    this.node.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString();
      console.log(`[P2P] Peer connected: ${peerId.slice(0, 16)}...`);
      
      this.emit('peer:connected', {
        peerId,
        direction: 'inbound'
      });

      // 更新路由表
      const existing = this.peerTable.get(peerId);
      if (existing) {
        existing.connected = true;
        existing.connectedAt = Date.now();
      }
    });

    // 断开连接
    this.node.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString();
      console.log(`[P2P] Peer disconnected: ${peerId.slice(0, 16)}...`);
      
      this.emit('peer:disconnected', { peerId });

      // 更新路由表
      const existing = this.peerTable.get(peerId);
      if (existing) {
        existing.connected = false;
      }
    });

    // 处理传入的协议流
    this.node.handle(F2A_PROTOCOL, async ({ stream, connection }) => {
      try {
        // 读取数据
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream.source) {
          chunks.push(chunk);
        }
        
        const data = Buffer.concat(chunks);
        const message: F2AMessage = JSON.parse(data.toString());
        const peerId = connection.remotePeer.toString();

        // 处理消息
        await this.handleMessage(message, peerId);
      } catch (error) {
        console.error('[P2P] Error handling message:', error);
      }
    });
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(message: F2AMessage, peerId: string): Promise<void> {
    console.log(`[P2P] Received ${message.type} from ${peerId.slice(0, 16)}...`);

    // 更新最后活跃时间
    const peerInfo = this.peerTable.get(peerId);
    if (peerInfo) {
      peerInfo.lastSeen = Date.now();
    }

    switch (message.type) {
      case 'DISCOVER': {
        const payload = message.payload as DiscoverPayload;
        this.handleDiscover(payload.agentInfo, peerId);
        break;
      }

      case 'CAPABILITY_QUERY': {
        const payload = message.payload as CapabilityQueryPayload;
        await this.handleCapabilityQuery(payload, peerId);
        break;
      }

      case 'TASK_RESPONSE': {
        const payload = message.payload as TaskResponsePayload;
        this.handleTaskResponse(payload);
        break;
      }
    }

    // 转发给上层处理
    this.emit('message:received', message, peerId);
  }

  /**
   * 处理发现消息
   */
  private handleDiscover(agentInfo: AgentInfo, peerId: string): void {
    // 更新路由表
    const existing = this.peerTable.get(peerId);
    if (existing) {
      existing.agentInfo = agentInfo;
      existing.lastSeen = Date.now();
    } else {
      this.peerTable.set(peerId, {
        peerId,
        agentInfo,
        multiaddrs: agentInfo.multiaddrs.map(ma => new (require('@multiformats/multiaddr').Multiaddr)(ma)),
        connected: false,
        reputation: 50, // 初始信誉分
        lastSeen: Date.now()
      });
    }

    // 发送发现响应
    this.sendMessage(peerId, {
      id: randomUUID(),
      type: 'DISCOVER_RESP',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: { agentInfo: this.agentInfo } as DiscoverPayload
    });

    this.emit('peer:discovered', {
      peerId,
      agentInfo,
      multiaddrs: agentInfo.multiaddrs.map(ma => new (require('@multiformats/multiaddr').Multiaddr)(ma))
    });
  }

  /**
   * 处理能力查询
   */
  private async handleCapabilityQuery(
    query: CapabilityQueryPayload,
    peerId: string
  ): Promise<void> {
    // 检查是否匹配
    const matches = !query.capabilityName || 
      this.hasCapability(this.agentInfo, query.capabilityName);

    if (matches) {
      // 发送能力响应
      await this.sendMessage(peerId, {
        id: randomUUID(),
        type: 'CAPABILITY_RESPONSE',
        from: this.agentInfo.peerId,
        to: peerId,
        timestamp: Date.now(),
        payload: { agentInfo: this.agentInfo } as CapabilityResponsePayload
      });
    }
  }

  /**
   * 处理任务响应
   */
  private handleTaskResponse(payload: TaskResponsePayload): void {
    const pending = this.pendingTasks.get(payload.taskId);
    if (pending) {
      if (payload.status === 'success') {
        pending.resolve(payload.result);
      } else {
        pending.reject(payload.error || 'Task failed');
      }
    }
  }

  /**
   * 连接引导节点
   */
  private async connectToBootstrapPeers(peers: string[]): Promise<void> {
    if (!this.node) return;

    for (const addr of peers) {
      try {
        const { multiaddr } = await import('@multiformats/multiaddr');
        const ma = multiaddr(addr);
        await this.node.dial(ma);
        console.log(`[P2P] Connected to bootstrap: ${addr}`);
      } catch (error) {
        console.warn(`[P2P] Failed to connect to bootstrap: ${addr}`);
      }
    }
  }

  /**
   * 启动定期发现广播
   */
  private startDiscoveryBroadcast(): void {
    // 立即广播一次
    this.broadcastDiscovery();

    // 每 30 秒广播一次
    setInterval(() => {
      this.broadcastDiscovery();
    }, 30000);
  }

  /**
   * 检查 Agent 是否有特定能力
   */
  private hasCapability(agentInfo: AgentInfo, capabilityName: string): boolean {
    return agentInfo.capabilities.some(c => c.name === capabilityName);
  }

  /**
   * 获取已连接的 Peers
   */
  getConnectedPeers(): PeerInfo[] {
    return Array.from(this.peerTable.values()).filter(p => p.connected);
  }

  /**
   * 获取所有已知的 Peers
   */
  getAllPeers(): PeerInfo[] {
    return Array.from(this.peerTable.values());
  }

  /**
   * 获取节点 ID
   */
  getPeerId(): string | null {
    return this.agentInfo.peerId;
  }
}
