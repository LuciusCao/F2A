/**
 * P2P 网络管理器
 * 基于 libp2p 实现 Agent 发现与通信
 */

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { kadDHT } from '@libp2p/kad-dht';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromKeys, peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import type { Libp2p } from '@libp2p/interface';

import {
  P2PNetworkConfig,
  AgentInfo,
  AgentCapability,
  F2AMessage,
  PeerInfo,
  PeerDiscoveredEvent,
  PeerConnectedEvent,
  PeerDisconnectedEvent,
  Result,
  TaskRequestPayload,
  TaskResponsePayload,
  DiscoverPayload,
  CapabilityQueryPayload,
  CapabilityResponsePayload,
  success,
  failureFromError,
  createError
} from '../types';
import { E2EECrypto } from './e2ee-crypto';

// F2A 协议标识
const F2A_PROTOCOL = '/f2a/1.0.0';

// 清理配置
const PEER_TABLE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟
const PEER_STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24小时
const PEER_TABLE_MAX_SIZE = 1000; // 最大peer数

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
  private pendingTasks: Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: string) => void;
    timeout: NodeJS.Timeout;
    resolved: boolean; // 标记是否已解决，防止超时后重复 resolve
  }> = new Map();
  private cleanupInterval?: NodeJS.Timeout;
  private discoveryInterval?: NodeJS.Timeout;
  private e2eeCrypto: E2EECrypto;
  private enableE2EE: boolean = true; // E2EE 开关

  constructor(agentInfo: AgentInfo, config: P2PNetworkConfig = {}) {
    super();
    this.agentInfo = agentInfo;
    this.e2eeCrypto = new E2EECrypto();
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
      const peerId = await peerIdFromKeys(privateKey.public.marshal(), privateKey.marshal());

      // 构建监听地址
      const listenAddresses = this.config.listenAddresses || [
        `/ip4/0.0.0.0/tcp/${this.config.listenPort}`
      ];

      // 创建 libp2p 节点 - 启用 noise 加密和 DHT
      const services: Record<string, any> = {};
      
      if (this.config.enableDHT !== false) {
        services.dht = kadDHT({
          clientMode: !this.config.dhtServerMode, // 默认客户端模式
        });
      }

      this.node = await createLibp2p({
        privateKey,
        addresses: {
          listen: listenAddresses
        },
        transports: [tcp()],
        connectionEncryption: [noise()],
        services
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

      // 初始化 E2EE 加密
      await this.e2eeCrypto.initialize();
      this.agentInfo.encryptionPublicKey = this.e2eeCrypto.getPublicKey() || undefined;
      console.log(`[P2P] E2EE encryption enabled, public key: ${this.agentInfo.encryptionPublicKey?.slice(0, 16)}...`);

      // 连接引导节点
      if (this.config.bootstrapPeers) {
        await this.connectToBootstrapPeers(this.config.bootstrapPeers);
      }

      // 启动定期发现广播
      this.startDiscoveryBroadcast();

      // 启动定期清理任务
      this.startCleanupTask();

      // 如果启用 DHT，等待 DHT 就绪
      if (this.config.enableDHT !== false && this.node.services.dht) {
        console.log('[P2P] DHT enabled, waiting for routing table...');
        // DHT 会自动开始发现
      }

      console.log(`[P2P] Started with peerId: ${peerId.toString().slice(0, 16)}...`);
      console.log(`[P2P] Listening on:`, addrs);
      console.log(`[P2P] Connection encryption: Noise protocol enabled`);

      return success({ peerId: peerId.toString(), addresses: addrs });
    } catch (error) {
      return failureFromError('NETWORK_NOT_STARTED', 'Failed to start P2P network', error as Error);
    }
  }

  /**
   * 停止 P2P 网络
   */
  async stop(): Promise<void> {
    // 停止清理任务
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // 停止发现广播定时器
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = undefined;
    }

    if (this.node) {
      // 清理待处理任务
      for (const [taskId, { timeout, resolve }] of this.pendingTasks) {
        clearTimeout(timeout);
        resolve({ success: false, error: 'Network stopped' });
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

    // 发送消息（启用 E2EE 加密）
    const sendResult = await this.sendMessage(peerId, message, true);
    if (!sendResult.success) {
      return sendResult;
    }

    // 等待响应
    return new Promise((resolve) => {
      const taskEntry = {
        resolve: (result: unknown) => {
          if (!taskEntry.resolved) {
            taskEntry.resolved = true;
            resolve(success(result));
          }
        },
        reject: (error: string) => {
          if (!taskEntry.resolved) {
            taskEntry.resolved = true;
            resolve({ success: false, error: createError('TASK_FAILED', error) } as Result<unknown>);
          }
        },
        timeout: setTimeout(() => {
          if (!taskEntry.resolved) {
            taskEntry.resolved = true;
            this.pendingTasks.delete(taskId);
            resolve(failureFromError('TIMEOUT', 'Task timeout'));
          }
        }, timeout),
        resolved: false
      };

      this.pendingTasks.set(taskId, taskEntry);
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

    // 任务响应也启用 E2EE 加密
    return this.sendMessage(peerId, message, true);
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
    const peers = this.node.getPeers();
    const results = await Promise.allSettled(
      peers.map(peer => this.sendMessage(peer.toString(), message))
    );

    // 记录发送失败的情况
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[P2P] Broadcast failed to ${failures.length}/${peers.length} peers`);
    }
  }

  /**
   * 向特定 Peer 发送消息
   * @param peerId 目标 Peer ID
   * @param message 消息内容
   * @param encrypt 是否启用 E2EE 加密（默认 false，发现类消息不需要加密）
   */
  private async sendMessage(peerId: string, message: F2AMessage, encrypt: boolean = false): Promise<Result<void>> {
    if (!this.node) {
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not started');
    }

    try {
      // 获取 PeerInfo
      const peerInfo = this.peerTable.get(peerId);
      if (!peerInfo || peerInfo.multiaddrs.length === 0) {
        return failureFromError('PEER_NOT_FOUND', `Peer ${peerId} not found`);
      }

      // 拨号连接（如果未连接）
      const peer = await this.node.dial(peerInfo.multiaddrs[0]);

      // 准备消息数据（根据是否启用 E2EE 加密）
      let data: Buffer;
      if (encrypt && this.enableE2EE && this.e2eeCrypto.canEncryptTo(peerId)) {
        // 加密消息内容
        const encrypted = this.e2eeCrypto.encrypt(peerId, JSON.stringify(message));
        if (encrypted) {
          data = Buffer.from(JSON.stringify({
            ...message,
            encrypted: true,
            payload: encrypted
          }));
        } else {
          // 加密失败，回退到明文
          console.warn(`[P2P] E2EE encryption failed for ${peerId.slice(0, 16)}..., falling back to plaintext`);
          data = Buffer.from(JSON.stringify(message));
        }
      } else {
        data = Buffer.from(JSON.stringify(message));
      }

      // 使用协议流发送消息
      const stream = await peer.newStream(F2A_PROTOCOL);
      await stream.sink([data]);
      await stream.close();

      return success(undefined);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return failureFromError('CONNECTION_FAILED', err.message, err);
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
          // Uint8ArrayList 需要转换为 Uint8Array
          const data = chunk instanceof Uint8Array ? chunk : (chunk as any).subarray();
          chunks.push(data);
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

    // 处理加密消息
    if ((message as any).encrypted && (message as any).payload) {
      const decrypted = this.e2eeCrypto.decrypt((message as any).payload);
      if (decrypted) {
        try {
          message = JSON.parse(decrypted);
        } catch (error) {
          console.error('[P2P] Failed to parse decrypted message:', error);
          return;
        }
      } else {
        console.error('[P2P] Failed to decrypt message from:', peerId.slice(0, 16));
        return;
      }
    }

    switch (message.type) {
      case 'DISCOVER': {
        const payload = message.payload as DiscoverPayload;
        await this.handleDiscover(payload.agentInfo, peerId);
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
  private async handleDiscover(agentInfo: AgentInfo, peerId: string): Promise<void> {
    // 检查是否需要清理以腾出空间
    if (this.peerTable.size >= PEER_TABLE_MAX_SIZE && !this.peerTable.has(peerId)) {
      this.cleanupStalePeers(true); // 强制清理
    }

    // 更新路由表
    const existing = this.peerTable.get(peerId);
    if (existing) {
      existing.agentInfo = agentInfo;
      existing.lastSeen = Date.now();
    } else {
      this.peerTable.set(peerId, {
        peerId,
        agentInfo,
        multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma)),
        connected: false,
        reputation: 50,
        lastSeen: Date.now()
      });
    }

    // 注册对等方的加密公钥
    if (agentInfo.encryptionPublicKey) {
      this.e2eeCrypto.registerPeerPublicKey(peerId, agentInfo.encryptionPublicKey);
      console.log(`[P2P] Registered encryption key for ${peerId.slice(0, 16)}...`);
    }

    // 发送发现响应
    const responseResult = await this.sendMessage(peerId, {
      id: randomUUID(),
      type: 'DISCOVER_RESP',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: { agentInfo: this.agentInfo } as DiscoverPayload
    });

    if (!responseResult.success) {
      console.warn(`[P2P] Failed to send discover response to ${peerId.slice(0, 16)}:`, responseResult.error);
    }

    this.emit('peer:discovered', {
      peerId,
      agentInfo,
      multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma))
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
    if (!pending) {
      console.warn(`[P2P] Received response for unknown task: ${payload.taskId}`);
      return;
    }

    // 使用原子操作避免竞态条件
    if (pending.resolved) {
      return;
    }
    pending.resolved = true;

    // 清理资源
    clearTimeout(pending.timeout);
    this.pendingTasks.delete(payload.taskId);

    // 处理结果
    if (payload.status === 'success') {
      pending.resolve(payload.result);
    } else {
      pending.reject(payload.error || 'Task failed');
    }
  }

  /**
   * 连接引导节点
   */
  private async connectToBootstrapPeers(peers: string[]): Promise<void> {
    if (!this.node) return;

    for (const addr of peers) {
      try {
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
    this.discoveryInterval = setInterval(() => {
      this.broadcastDiscovery();
    }, 30000);
  }

  /**
   * 启动定期清理任务
   */
  private startCleanupTask(): void {
    // 立即执行一次
    this.cleanupStalePeers();

    // 每 5 分钟清理一次
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePeers();
    }, PEER_TABLE_CLEANUP_INTERVAL);
  }

  /**
   * 清理过期的 Peer 记录
   */
  private cleanupStalePeers(force = false): void {
    const now = Date.now();
    const threshold = force ? 0 : PEER_STALE_THRESHOLD;
    let cleaned = 0;

    for (const [peerId, peer] of this.peerTable) {
      // 清理条件：长时间未活跃，或者未连接且超过一定时间
      const shouldClean = 
        now - peer.lastSeen > threshold ||
        (!peer.connected && now - peer.lastSeen > 60 * 60 * 1000); // 未连接超过1小时

      if (shouldClean) {
        this.peerTable.delete(peerId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[P2P] Cleaned up ${cleaned} stale peer(s), remaining: ${this.peerTable.size}`);
    }

    // 如果仍然超过最大容量，按最后活跃时间排序后删除最旧的
    if (this.peerTable.size > PEER_TABLE_MAX_SIZE) {
      const sorted = Array.from(this.peerTable.entries())
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      
      const toRemove = sorted.slice(0, this.peerTable.size - PEER_TABLE_MAX_SIZE);
      for (const [peerId] of toRemove) {
        this.peerTable.delete(peerId);
      }
      
      console.log(`[P2P] Removed ${toRemove.length} oldest peers to maintain limit`);
    }
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

  /**
   * 获取 E2EE 加密公钥
   */
  getEncryptionPublicKey(): string | null {
    return this.e2eeCrypto.getPublicKey();
  }

  /**
   * 获取已注册的加密对等方数量
   */
  getEncryptedPeerCount(): number {
    return this.e2eeCrypto.getRegisteredPeerCount();
  }

  /**
   * 通过 DHT 查找节点 (全局发现)
   */
  async findPeerViaDHT(peerId: string): Promise<Result<string[]>> {
    if (!this.node) {
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not started');
    }

    const dht = (this.node.services as any).dht;
    if (!dht) {
      return failureFromError('DHT_NOT_AVAILABLE', 'DHT service not enabled');
    }

    try {
      const peerIdObj = peerIdFromString(peerId);
      const peerInfo = await dht.findPeer(peerIdObj);
      
      if (peerInfo && peerInfo.multiaddrs.length > 0) {
        return success(peerInfo.multiaddrs.map((ma: any) => ma.toString()));
      }
      
      return failureFromError('PEER_NOT_FOUND', `Peer ${peerId} not found in DHT`);
    } catch (error) {
      return failureFromError('DHT_LOOKUP_FAILED', 'DHT lookup failed', error as Error);
    }
  }

  /**
   * 获取 DHT 路由表大小
   */
  getDHTPeerCount(): number {
    const dht = (this.node?.services as any)?.dht;
    return dht?.routingTable?.size || 0;
  }

  /**
   * 检查 DHT 是否启用
   */
  isDHTEnabled(): boolean {
    return !!(this.node?.services as any)?.dht;
  }
}
