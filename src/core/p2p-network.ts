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
import { Logger } from '../utils/logger';
import { validateF2AMessage, validateTaskRequestPayload, validateTaskResponsePayload } from '../utils/validation';
import { MiddlewareManager, Middleware } from '../utils/middleware';
import { RequestSigner, loadSignatureConfig, SignedMessage } from '../utils/signature';

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

/** 发现选项 */
export interface DiscoverOptions {
  /** 发现超时毫秒（默认 2000） */
  timeoutMs?: number;
  /** 是否等待首个响应即返回（默认 false） */
  waitForFirstResponse?: boolean;
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
    resolved: boolean;
  }> = new Map();
  private cleanupInterval?: NodeJS.Timeout;
  private discoveryInterval?: NodeJS.Timeout;
  private e2eeCrypto: E2EECrypto;
  private enableE2EE: boolean = true;
  private logger: Logger;
  private middlewareManager: MiddlewareManager;

  constructor(agentInfo: AgentInfo, config: P2PNetworkConfig = {}) {
    super();
    this.agentInfo = agentInfo;
    this.e2eeCrypto = new E2EECrypto();
    this.middlewareManager = new MiddlewareManager();
    this.config = {
      listenPort: 0,
      enableMDNS: true,
      enableDHT: false,
      ...config
    };
    this.logger = new Logger({ component: 'P2P' });
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
      this.logger.info('E2EE encryption enabled', {
        publicKey: this.agentInfo.encryptionPublicKey?.slice(0, 16)
      });

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
        this.logger.info('DHT enabled, waiting for routing table');
      }

      this.logger.info('Started', { peerId: peerId.toString().slice(0, 16) });
      this.logger.info('Listening', { addresses: addrs });
      this.logger.info('Connection encryption enabled', { protocol: 'Noise' });

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
      this.logger.info('Stopped');
    }
  }

  /**
   * 发现网络中的 Agent（按能力过滤）
   * @param capability 可选的能力过滤
   * @param options 发现选项
   */
  async discoverAgents(capability?: string, options?: DiscoverOptions): Promise<AgentInfo[]> {
    const timeoutMs = options?.timeoutMs ?? 2000;
    const waitForFirst = options?.waitForFirstResponse ?? false;

    const agents: AgentInfo[] = [];
    
    for (const peer of this.peerTable.values()) {
      if (peer.agentInfo) {
        if (!capability || this.hasCapability(peer.agentInfo, capability)) {
          agents.push(peer.agentInfo);
        }
      }
    }

    // 如果已经有足够的 agents 且不需要等待响应，直接返回
    if (agents.length > 0 && !waitForFirst) {
      return agents;
    }

    // 广播能力查询以发现更多节点
    await this.broadcast({
      id: randomUUID(),
      type: 'CAPABILITY_QUERY',
      from: this.agentInfo.peerId,
      timestamp: Date.now(),
      payload: { capabilityName: capability } as CapabilityQueryPayload
    });

    // 使用 Promise.race 等待首个响应或超时
    if (waitForFirst) {
      const initialCount = agents.length;
      
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          this.off('peer:discovered', onPeerDiscovered);
          resolve();
        }, timeoutMs);

        const onPeerDiscovered = (event: PeerDiscoveredEvent) => {
          if (!capability || this.hasCapability(event.agentInfo, capability)) {
            // 检查是否是新发现的 agent
            if (!agents.find(a => a.peerId === event.agentInfo.peerId)) {
              agents.push(event.agentInfo);
            }
          }
          clearTimeout(timeout);
          this.off('peer:discovered', onPeerDiscovered);
          resolve();
        };

        this.on('peer:discovered', onPeerDiscovered);
      });
    } else {
      // 等待响应（可配置超时）
      await new Promise(resolve => setTimeout(resolve, timeoutMs));
    }

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
      this.logger.warn('Broadcast failed to some peers', {
        failed: failures.length,
        total: peers.length
      });
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
      if (encrypt && this.enableE2EE) {
        // 检查是否有共享密钥
        if (!this.e2eeCrypto.canEncryptTo(peerId)) {
          return failureFromError(
            'ENCRYPTION_NOT_READY',
            'No shared secret with peer. Wait for key exchange to complete.'
          );
        }

        // 加密消息内容
        const encrypted = this.e2eeCrypto.encrypt(peerId, JSON.stringify(message));
        if (!encrypted) {
          return failureFromError(
            'ENCRYPTION_FAILED',
            'Failed to encrypt message. Cannot proceed in secure mode.'
          );
        }

        data = Buffer.from(JSON.stringify({
          ...message,
          encrypted: true,
          payload: encrypted
        }));
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
      this.logger.info('Peer connected', { peerId: peerId.slice(0, 16) });

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
      this.logger.info('Peer disconnected', { peerId: peerId.slice(0, 16) });

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
        this.logger.error('Error handling message', { error });
      }
    });
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 验证消息格式
    const validation = validateF2AMessage(message);
    if (!validation.success) {
      this.logger.warn('Invalid message format', {
        errors: validation.error.errors,
        peerId: peerId.slice(0, 16)
      });
      return;
    }

    this.logger.info('Received message', { type: message.type, peerId: peerId.slice(0, 16) });

    // 更新最后活跃时间
    const peerInfo = this.peerTable.get(peerId);
    if (peerInfo) {
      peerInfo.lastSeen = Date.now();
    }

    // 处理加密消息
    if ((message as any).encrypted && (message as any).payload) {
      const encryptedPayload = (message as any).payload;
      const decrypted = this.e2eeCrypto.decrypt(encryptedPayload);
      if (decrypted) {
        try {
          message = JSON.parse(decrypted);
          
          // 安全验证：验证解密后的消息发送方身份
          // 检查加密消息中的 senderPublicKey 是否与 peerId 绑定
          if (encryptedPayload.senderPublicKey) {
            const senderPublicKey = encryptedPayload.senderPublicKey;
            // 验证发送方公钥是否已注册且属于该 peerId
            const registeredKey = this.e2eeCrypto.getPeerPublicKey(peerId);
            if (registeredKey && registeredKey !== senderPublicKey) {
              this.logger.error('Sender identity verification failed: public key mismatch', {
                peerId: peerId.slice(0, 16),
                claimedKey: senderPublicKey.slice(0, 16),
                registeredKey: registeredKey.slice(0, 16)
              });
              return;
            }
            // 如果发送方声称的身份与消息来源不匹配，拒绝处理
            if (message.from && message.from !== peerId) {
              this.logger.error('Sender identity verification failed: from field mismatch', {
                claimedFrom: message.from?.slice(0, 16),
                actualPeerId: peerId.slice(0, 16)
              });
              return;
            }
          }
        } catch (error) {
          this.logger.error('Failed to parse decrypted message', { error });
          return;
        }
      } else {
        // 解密失败，通知发送方
        this.logger.error('Failed to decrypt message', { peerId: peerId.slice(0, 16) });
        
        // 发送解密失败响应
        const originalMessageId = message.id;
        const decryptFailResponse: F2AMessage = {
          id: randomUUID(),
          type: 'DECRYPT_FAILED',
          from: this.agentInfo.peerId,
          to: peerId,
          timestamp: Date.now(),
          payload: {
            originalMessageId,
            error: 'DECRYPTION_FAILED',
            message: 'Unable to decrypt message. Key exchange may be incomplete or keys mismatched.'
          }
        };
        
        // 尝试发送响应（不加密，因为加密通道可能有问题）
        try {
          await this.sendMessage(peerId, decryptFailResponse, false);
        } catch (sendError) {
          this.logger.error('Failed to send decrypt failure response', { 
            peerId: peerId.slice(0, 16),
            error: sendError 
          });
        }
        
        return;
      }
    }

    // 执行中间件链
    const middlewareResult = await this.middlewareManager.execute({
      message,
      peerId,
      agentInfo: peerInfo?.agentInfo,
      metadata: new Map()
    });

    if (middlewareResult.action === 'drop') {
      this.logger.info('Message dropped by middleware', {
        reason: middlewareResult.reason,
        peerId: peerId.slice(0, 16)
      });
      return;
    }

    // 使用可能被中间件修改后的消息
    message = middlewareResult.context.message;

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
        const payloadValidation = validateTaskResponsePayload(message.payload);
        if (!payloadValidation.success) {
          this.logger.warn('Invalid task response payload', {
            errors: payloadValidation.error.errors
          });
          break;
        }
        const payload = message.payload as TaskResponsePayload;
        this.handleTaskResponse(payload);
        break;
      }

      case 'DECRYPT_FAILED': {
        // 处理解密失败通知
        const { originalMessageId, error, message: errorMsg } = message.payload as {
          originalMessageId: string;
          error: string;
          message: string;
        };
        
        this.logger.error('Received decrypt failure notification', {
          peerId: peerId.slice(0, 16),
          originalMessageId,
          error,
          message: errorMsg
        });
        
        // 尝试重新注册公钥以重新建立加密通道
        const peerInfo = this.peerTable.get(peerId);
        if (peerInfo?.agentInfo?.encryptionPublicKey) {
          this.e2eeCrypto.registerPeerPublicKey(peerId, peerInfo.agentInfo.encryptionPublicKey);
          this.logger.info('Re-registered encryption key after decrypt failure', {
            peerId: peerId.slice(0, 16)
          });
        }
        
        // 发出事件通知上层应用
        this.emit('error', new Error(`Decrypt failed for message ${originalMessageId}: ${errorMsg}`));
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
    // 安全验证：确保 agentInfo.peerId 与发送方一致，防止伪造
    if (agentInfo.peerId !== peerId) {
      this.logger.warn('Discovery message rejected: peerId mismatch', {
        claimedPeerId: agentInfo.peerId?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16)
      });
      return;
    }

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
      this.logger.info('Registered encryption key', { peerId: peerId.slice(0, 16) });
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
      this.logger.warn('Failed to send discover response', {
        peerId: peerId.slice(0, 16),
        error: responseResult.error
      });
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
      this.logger.warn('Received response for unknown task', { taskId: payload.taskId });
      return;
    }

    // 使用原子操作避免竞态条件：先删除 Map 条目，再检查 resolved 标志
    // 这确保即使多个响应并发到达，也只有一个能成功获取到 pending 条目
    this.pendingTasks.delete(payload.taskId);
    
    if (pending.resolved) {
      this.logger.warn('Task already resolved, ignoring duplicate response', { taskId: payload.taskId });
      return;
    }
    pending.resolved = true;

    // 清理资源
    clearTimeout(pending.timeout);

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
        this.logger.info('Connected to bootstrap', { addr });
      } catch (error) {
        this.logger.warn('Failed to connect to bootstrap', { addr });
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
      this.logger.info('Cleaned up stale peers', { cleaned, remaining: this.peerTable.size });
    }

    // 如果仍然超过最大容量，按最后活跃时间排序后删除最旧的
    if (this.peerTable.size > PEER_TABLE_MAX_SIZE) {
      const sorted = Array.from(this.peerTable.entries())
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);

      const toRemove = sorted.slice(0, this.peerTable.size - PEER_TABLE_MAX_SIZE);
      for (const [peerId] of toRemove) {
        this.peerTable.delete(peerId);
      }

      this.logger.info('Removed oldest peers to maintain limit', { removed: toRemove.length });
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

  /**
   * 注册中间件
   * @param middleware 中间件实例
   */
  useMiddleware(middleware: Middleware): void {
    this.middlewareManager.use(middleware);
  }

  /**
   * 移除中间件
   * @param name 中间件名称
   * @returns 是否成功移除
   */
  removeMiddleware(name: string): boolean {
    return this.middlewareManager.remove(name);
  }

  /**
   * 获取已注册的中间件列表
   * @returns 中间件名称列表
   */
  listMiddlewares(): string[] {
    return this.middlewareManager.list();
  }
}
