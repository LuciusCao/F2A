/**
 * P2P 网络管理器
 * 基于 libp2p 实现 Agent 发现与通信
 */

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { peerIdFromString } from '@libp2p/peer-id';
import type { PeerId } from '@libp2p/interface';
import type { PrivateKey } from '@libp2p/interface';
import type { Libp2pInit } from 'libp2p';
import { multiaddr } from '@multiformats/multiaddr';
import type { Multiaddr } from '@multiformats/multiaddr';
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
} from '../types/index.js';
import { E2EECrypto, EncryptedMessage } from './e2ee-crypto.js';
import { IdentityManager } from './identity/index.js';
import { Logger } from '../utils/logger.js';
import { validateF2AMessage, validateTaskRequestPayload, validateTaskResponsePayload } from '../utils/validation.js';
import { MiddlewareManager, Middleware } from '../utils/middleware.js';
import { RequestSigner, loadSignatureConfig, SignedMessage } from '../utils/signature.js';
import { RateLimiter } from '../utils/rate-limiter.js';

// DHT 服务类型定义
interface DHTService {
  findPeer(peerId: PeerId): Promise<{ multiaddrs: Multiaddr[] } | null>;
  routingTable?: { size: number };
}

interface Libp2pServices {
  dht?: DHTService;
}

// 加密消息类型定义
interface EncryptedF2AMessage extends F2AMessage {
  encrypted: true;
  payload: EncryptedMessage;
}

// 类型守卫：检查是否为加密消息
function isEncryptedMessage(msg: F2AMessage): msg is EncryptedF2AMessage {
  return 'encrypted' in msg && msg.encrypted === true && 'payload' in msg;
}

// 加密消息处理结果
interface DecryptResult {
  action: 'continue' | 'return';
  message: F2AMessage;
}

// F2A 协议标识
const F2A_PROTOCOL = '/f2a/1.0.0';

// 清理配置
const PEER_TABLE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟
const PEER_STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24小时
const PEER_TABLE_MAX_SIZE = 1000; // 最大peer数
const PEER_TABLE_HIGH_WATERMARK = 0.9; // 高水位线（90%触发主动清理）
const PEER_TABLE_AGGRESSIVE_CLEANUP_THRESHOLD = 0.8; // 激进清理后保留的目标比例（80%）

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

/**
 * 简单的异步锁实现，用于保护关键资源的并发访问
 * 
 * P1 修复：添加超时机制，防止死锁
 */
class AsyncLock {
  private locked = false;
  private queue: Array<() => void> = [];
  /** 默认锁超时时间（毫秒） - P2-1 修复：从 30000ms 改为 10000ms */
  private static readonly DEFAULT_TIMEOUT_MS = 10000;

  /**
   * 获取锁
   * @param timeoutMs 超时时间（毫秒），默认 10 秒
   * @throws Error 如果超时未能获取锁
   */
  async acquire(timeoutMs: number = AsyncLock.DEFAULT_TIMEOUT_MS): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // 从队列中移除此等待者
        const index = this.queue.indexOf(onAcquire);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error(`AsyncLock acquire timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onAcquire = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      this.queue.push(onAcquire);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // 保持 locked = true，直接传递给下一个等待者
      next();
    } else {
      this.locked = false;
    }
  }

  /**
   * 检查锁是否被持有
   */
  isLocked(): boolean {
    return this.locked;
  }
}

export class P2PNetwork extends EventEmitter<P2PNetworkEvents> {
  private node: Libp2p | null = null;
  private config: P2PNetworkConfig;
  private peerTable: Map<string, PeerInfo> = new Map();
  /** P2.4 修复：已连接 Peer 索引，用于 O(1) 查询 */
  private connectedPeers: Set<string> = new Set();
  /** P1 修复：信任的 Peer 白名单，不会被清理 */
  private trustedPeers: Set<string> = new Set();
  /** 用于保护 peerTable 并发访问的锁 */
  private peerTableLock = new AsyncLock();
  /** P2-4 修复：DISCOVER 消息速率限制器（每个 peer） */
  private discoverRateLimiter = new RateLimiter({
    maxRequests: 10, // 每个 peer 每分钟最多 10 次 DISCOVER 消息
    windowMs: 60 * 1000,
    burstMultiplier: 1.2 // 允许轻微突发
  });
  /** P1 修复：保存事件监听器引用，用于 stop() 中移除 */
  private boundEventHandlers: {
    peerDiscovery: ((evt: CustomEvent<{ id: PeerId; multiaddrs: Multiaddr[] }>) => Promise<void>) | undefined;
    peerConnect: ((evt: CustomEvent<PeerId>) => Promise<void>) | undefined;
    peerDisconnect: ((evt: CustomEvent<PeerId>) => Promise<void>) | undefined;
  } = {
    peerDiscovery: undefined,
    peerConnect: undefined,
    peerDisconnect: undefined
  };
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
  private identityManager?: IdentityManager;
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
    
    // 初始化信任的 Peer 白名单
    if (this.config.trustedPeers) {
      this.config.trustedPeers.forEach(peerId => this.trustedPeers.add(peerId));
    }
    // 引导节点自动加入白名单
    if (this.config.bootstrapPeers) {
      this.config.bootstrapPeers.forEach(addr => {
        // 从 multiaddr 提取 peer ID
        try {
          const ma = multiaddr(addr);
          const peerId = ma.getPeerId();
          if (peerId) this.trustedPeers.add(peerId);
        } catch { /* ignore invalid addresses */ }
      });
    }
  }

  /**
   * 设置 IdentityManager（用于持久化身份）
   * 必须在 start() 之前调用
   */
  setIdentityManager(identityManager: IdentityManager): void {
    this.identityManager = identityManager;
  }

  /**
   * 启动 P2P 网络
   */
  async start(): Promise<Result<{ peerId: string; addresses: string[] }>> {
    try {
      // 构建监听地址
      const listenAddresses = this.config.listenAddresses || [
        `/ip4/0.0.0.0/tcp/${this.config.listenPort}`
      ];

      // 创建 libp2p 节点 - 启用 noise 加密
      const services: Record<string, any> = {};
      
      // 只有显式启用 DHT 时才添加
      if (this.config.enableDHT === true) {
        services.dht = kadDHT({
          clientMode: !this.config.dhtServerMode, // 默认客户端模式
        });
      }

      // Medium 修复：使用 libp2p 提供的类型定义
      const libp2pOptions: Libp2pInit = {
        addresses: {
          listen: listenAddresses
        },
        transports: [tcp()],
        connectionEncryption: [noise()],
        services
      };

      // mDNS 本地发现（默认启用）
      if (this.config.enableMDNS !== false) {
        // P1 修复：@libp2p/mdns 的类型定义与 libp2p 的 PeerDiscovery 类型不完全兼容。
        // mdns() 返回的是 @libp2p/mdns 的组件，其事件类型与 libp2p 内部类型定义存在差异。
        // 这是 libp2p 生态系统中已知的问题，参考: https://github.com/libp2p/js-libp2p/issues/XXX
        // 使用 `as any` 绕过 TypeScript 类型检查，运行时行为正确。
        // 当类型定义修复后，应移除此类型断言。
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        libp2pOptions.peerDiscovery = [
          mdns() as any
        ];
      }

      // 如果提供了 IdentityManager，使用持久化的私钥
      if (this.identityManager?.isLoaded()) {
        const privateKey = this.identityManager.getPrivateKey();
        if (privateKey) {
          libp2pOptions.privateKey = privateKey;
          this.logger.info('Using persisted identity', {
            peerId: this.identityManager.getPeerIdString()?.slice(0, 16)
          });
        }
      }

      this.node = await createLibp2p(libp2pOptions);

      // 设置事件监听
      this.setupEventHandlers();

      // 启动节点
      await this.node.start();

      // 获取实际监听地址
      const addrs = this.node.getMultiaddrs().map(ma => ma.toString());
      
      // 从节点获取 peer ID
      const peerId = this.node.peerId;
      
      // 更新 agentInfo
      this.agentInfo.peerId = peerId.toString();
      this.agentInfo.multiaddrs = addrs;

      // 初始化 E2EE 加密 - 使用持久化的密钥对或生成新的
      if (this.identityManager?.isLoaded()) {
        const e2eeKeyPair = this.identityManager.getE2EEKeyPair();
        if (e2eeKeyPair) {
          this.e2eeCrypto.initializeWithKeyPair(e2eeKeyPair.privateKey, e2eeKeyPair.publicKey);
          this.logger.info('Using persisted E2EE key pair');
        }
      } else {
        await this.e2eeCrypto.initialize();
      }
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

      // 延迟 2 秒后广播发现消息，等待连接稳定
      setTimeout(() => {
        this.broadcastDiscovery();
      }, 2000);

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

    // P2-4 修复：停止 DISCOVER 消息速率限制器
    this.discoverRateLimiter.stop();

    // P1-1 修复：停止 E2EE 加密模块，清理定时器资源
    if (this.e2eeCrypto && typeof this.e2eeCrypto.stop === 'function') {
      this.e2eeCrypto.stop();
    }

    if (this.node) {
      // P1 修复：移除事件监听器，防止内存泄漏
      // 检查 removeEventListener 是否存在（兼容测试 mock）
      if (typeof this.node.removeEventListener === 'function') {
        if (this.boundEventHandlers.peerDiscovery) {
          this.node.removeEventListener('peer:discovery', this.boundEventHandlers.peerDiscovery);
        }
        if (this.boundEventHandlers.peerConnect) {
          this.node.removeEventListener('peer:connect', this.boundEventHandlers.peerConnect);
        }
        if (this.boundEventHandlers.peerDisconnect) {
          this.node.removeEventListener('peer:disconnect', this.boundEventHandlers.peerDisconnect);
        }
      }

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

    // 使用锁保护创建快照，防止并发修改
    const agents: AgentInfo[] = [];
    const seenPeerIds = new Set<string>();
    
    await this.peerTableLock.acquire();
    try {
      for (const peer of this.peerTable.values()) {
        if (peer.agentInfo) {
          if (!capability || this.hasCapability(peer.agentInfo, capability)) {
            agents.push(peer.agentInfo);
            seenPeerIds.add(peer.agentInfo.peerId);
          }
        }
      }
    } finally {
      this.peerTableLock.release();
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
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          this.off('peer:discovered', onPeerDiscovered);
          resolve();
        }, timeoutMs);

        const onPeerDiscovered = (event: PeerDiscoveredEvent) => {
          if (!capability || this.hasCapability(event.agentInfo, capability)) {
            // 使用 Set 原子检查，防止重复添加
            if (!seenPeerIds.has(event.agentInfo.peerId)) {
              agents.push(event.agentInfo);
              seenPeerIds.add(event.agentInfo.peerId);
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

    // 再次收集 - 使用锁保护创建快照
    await this.peerTableLock.acquire();
    try {
      for (const peer of this.peerTable.values()) {
        if (peer.agentInfo && !seenPeerIds.has(peer.agentInfo.peerId)) {
          if (!capability || this.hasCapability(peer.agentInfo, capability)) {
            agents.push(peer.agentInfo);
            seenPeerIds.add(peer.agentInfo.peerId);
          }
        }
      }
    } finally {
      this.peerTableLock.release();
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
            // 从 Map 中移除，确保不会重复处理
            this.pendingTasks.delete(taskId);
            resolve(success(result));
          }
        },
        reject: (error: string) => {
          if (!taskEntry.resolved) {
            taskEntry.resolved = true;
            // 从 Map 中移除，确保不会重复处理
            this.pendingTasks.delete(taskId);
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
    const failures = results.filter(r =>
      r.status === 'rejected' ||
      (r.status === 'fulfilled' && !r.value.success)
    );
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
      // 检查是否已连接
      const connections = this.node.getConnections();
      const existingConn = connections.find(c => c.remotePeer.toString() === peerId);
      
      let peer;
      if (existingConn) {
        // 已连接，直接使用现有连接
        peer = existingConn;
      } else {
        // 未连接，需要 dial
        const peerInfo = this.peerTable.get(peerId);
        if (!peerInfo || peerInfo.multiaddrs.length === 0) {
          return failureFromError('PEER_NOT_FOUND', `Peer ${peerId} not found`);
        }
        peer = await this.node.dial(peerInfo.multiaddrs[0]);
      }

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

    // P1 修复：创建绑定的监听器并保存引用，用于 stop() 中移除
    this.boundEventHandlers.peerDiscovery = async (evt) => {
      // P1 修复：async 处理器包裹在 try-catch 中，记录错误日志
      try {
        const peerId = evt.detail.id.toString();
        const multiaddrs = evt.detail.multiaddrs.map(ma => ma.toString());
        
        this.logger.info('mDNS peer discovered', { 
          peerId: peerId.slice(0, 16),
          multiaddrs: multiaddrs.length 
        });

        // 更新路由表
        const now = Date.now();
        await this.upsertPeer(
          peerId,
          () => ({
            peerId,
            multiaddrs: evt.detail.multiaddrs,
            connected: false,
            // P2 修复：mDNS 发现的节点信誉初始化为 25，表示"未验证"状态
            reputation: 25,
            lastSeen: now
          }),
          (peer) => ({
            ...peer,
            multiaddrs: evt.detail.multiaddrs,
            lastSeen: now
          })
        );

        // 触发发现事件
        // P2 修复：mDNS 发现的 AgentInfo 使用占位符标记为"待验证"
        const pendingAgentInfo: AgentInfo = {
          peerId,
          multiaddrs,
          capabilities: [],
          // P2 修复：使用占位符标记为待验证
          displayName: `[Pending] ${peerId.slice(0, 8)}`,
          agentType: 'custom' as const,
          version: '0.0.0-pending',
          protocolVersion: '1.0.0',
          lastSeen: now
        };

        this.emit('peer:discovered', {
          peerId,
          agentInfo: pendingAgentInfo,
          multiaddrs: evt.detail.multiaddrs
        });

        // P1 修复：mDNS 发现后尝试连接并发送 DISCOVER 消息获取真实 AgentInfo
        // 建议-2 修复：提取为独立方法，减少嵌套深度
        await this.initiateDiscovery(peerId, evt.detail.multiaddrs);
      } catch (error) {
        this.logger.error('Error in peer:discovery handler', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    // 新连接
    this.boundEventHandlers.peerConnect = async (evt) => {
      // P1 修复：async 处理器包裹在 try-catch 中
      try {
        const peerId = evt.detail.toString();
        this.logger.info('Peer connected', { peerId: peerId.slice(0, 16) });

        this.emit('peer:connected', {
          peerId,
          direction: 'inbound'
        });

        // 从连接获取远程 multiaddr
        let multiaddrs: Multiaddr[] = [];
        try {
          if (this.node) {
            const connections = this.node.getConnections();
            const conn = connections.find(c => c.remotePeer.toString() === peerId);
            if (conn && conn.remoteAddr) {
              multiaddrs = [conn.remoteAddr];
            }
          }
        } catch {
          // 无法获取 multiaddrs，使用空数组
        }

        // P2.4 修复：使用原子操作更新路由表和连接索引
        const now = Date.now();
        await this.upsertPeer(
          peerId,
          () => ({
            peerId,
            multiaddrs,
            connected: true,
            reputation: 50,
            connectedAt: now,
            lastSeen: now
          }),
          (peer) => ({
            ...peer,
            connected: true,
            connectedAt: now,
            lastSeen: now,
            ...(multiaddrs.length > 0 ? { multiaddrs } : {})
          })
        );
        
        // P2.4 修复：维护连接索引
        this.connectedPeers.add(peerId);
      } catch (error) {
        this.logger.error('Error in peer:connect handler', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    // 断开连接
    this.boundEventHandlers.peerDisconnect = async (evt) => {
      // P1 修复：async 处理器包裹在 try-catch 中
      try {
        const peerId = evt.detail.toString();
        this.logger.info('Peer disconnected', { peerId: peerId.slice(0, 16) });

        this.emit('peer:disconnected', { peerId });

        // P2.4 修复：从连接索引中移除
        this.connectedPeers.delete(peerId);

        // P1-2 修复：清理对等方的加密资源
        this.e2eeCrypto.unregisterPeer(peerId);

        // 使用原子操作更新路由表
        const updated = await this.updatePeer(peerId, (peer) => ({
          ...peer,
          connected: false,
          lastSeen: Date.now()
        }));

        if (!updated) {
          // Peer 不在路由表中，记录警告但不创建条目（已断开）
          this.logger.warn('Peer disconnected but not in routing table', { peerId: peerId.slice(0, 16) });
        }
      } catch (error) {
        this.logger.error('Error in peer:disconnect handler', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    // 注册事件监听器
    this.node.addEventListener('peer:discovery', this.boundEventHandlers.peerDiscovery);
    this.node.addEventListener('peer:connect', this.boundEventHandlers.peerConnect);
    this.node.addEventListener('peer:disconnect', this.boundEventHandlers.peerDisconnect);

    // 处理传入的协议流
    this.node.handle(F2A_PROTOCOL, async ({ stream, connection }) => {
      try {
        // 读取数据
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream.source) {
          // chunk 可能是 Uint8Array 或 Uint8ArrayList（来自旧版本库）
          // 统一转换为 Uint8Array
          const data = chunk instanceof Uint8Array 
            ? chunk 
            : new Uint8Array((chunk as { subarray(): Uint8Array }).subarray());
          chunks.push(data);
        }
        
        const data = Buffer.concat(chunks);
        
        // 安全解析 JSON，捕获解析错误
        let message: F2AMessage;
        try {
          message = JSON.parse(data.toString());
        } catch (parseError) {
          this.logger.error('Failed to parse message JSON', {
            error: parseError instanceof Error ? parseError.message : String(parseError),
            dataSize: data.length,
            peerId: connection.remotePeer.toString().slice(0, 16)
          });
          return;
        }
        
        const peerId = connection.remotePeer.toString();

        // 处理消息
        await this.handleMessage(message, peerId);
      } catch (error) {
        this.logger.error('Error handling message', { error });
      }
    });
  }

  /**
   * 建议-2 修复：提取 mDNS 发现后的连接和 DISCOVER 发送逻辑
   * 减少嵌套深度，提高可读性
   * @param peerId 发现的 Peer ID
   * @param multiaddrs 发现的 multiaddr 列表
   */
  private async initiateDiscovery(peerId: string, multiaddrs: Multiaddr[]): Promise<void> {
    try {
      if (!this.node || multiaddrs.length === 0) {
        return;
      }

      // 尝试连接到发现的节点
      await this.node.dial(multiaddrs[0]);
      this.logger.info('Initiating connection to mDNS peer for discovery', {
        peerId: peerId.slice(0, 16)
      });

      // 发送 DISCOVER 消息获取真实 AgentInfo
      // 低-1 修复：有意不检查返回值 - 发现消息发送失败不影响主流程，
      // 后续的定期发现广播会重试，不会造成功能缺失
      const discoverMessage: F2AMessage = {
        id: randomUUID(),
        type: 'DISCOVER',
        from: this.agentInfo.peerId,
        timestamp: Date.now(),
        payload: { agentInfo: this.agentInfo } as DiscoverPayload
      };

      await this.sendMessage(peerId, discoverMessage, false);
      this.logger.info('Sent DISCOVER to mDNS peer', {
        peerId: peerId.slice(0, 16)
      });
    } catch (connectError) {
      // 连接失败不应阻止发现流程，记录警告即可
      this.logger.warn('Failed to connect/send DISCOVER to mDNS peer', {
        peerId: peerId.slice(0, 16),
        error: connectError instanceof Error ? connectError.message : String(connectError)
      });
    }
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
    const decryptResult = await this.handleEncryptedMessage(message, peerId);
    if (decryptResult.action === 'return') {
      return;
    }
    message = decryptResult.message;

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

// 根据消息类型分发处理
    await this.dispatchMessage(message, peerId);

    // 转发给上层处理
    this.emit('message:received', message, peerId);
  }

  /**
   * 处理加密消息
   * @returns 处理结果，包含是否继续处理和解密后的消息
   */
  private async handleEncryptedMessage(message: F2AMessage, peerId: string): Promise<DecryptResult> {
    if (!isEncryptedMessage(message)) {
      return { action: 'continue', message };
    }

    const encryptedPayload = message.payload;
    const decrypted = this.e2eeCrypto.decrypt(encryptedPayload);
    
    if (decrypted) {
      try {
        const decryptedMessage = JSON.parse(decrypted);
        
        // 安全验证：验证解密后的消息发送方身份
        if (encryptedPayload.senderPublicKey) {
          const verificationResult = this.verifySenderIdentity(
            decryptedMessage, 
            peerId, 
            encryptedPayload.senderPublicKey
          );
          if (!verificationResult.valid) {
            return { action: 'return', message };
          }
        }
        
        return { action: 'continue', message: decryptedMessage };
      } catch (error) {
        this.logger.error('Failed to parse decrypted message', { error });
        return { action: 'return', message };
      }
    }

    // 解密失败，通知发送方
    await this.sendDecryptFailureResponse(message.id, peerId);
    return { action: 'return', message };
  }

  /**
   * 验证发送方身份
   */
  private verifySenderIdentity(
    message: F2AMessage, 
    peerId: string, 
    senderPublicKey: string
  ): { valid: boolean } {
    // 验证发送方公钥是否已注册且属于该 peerId
    const registeredKey = this.e2eeCrypto.getPeerPublicKey(peerId);
    if (registeredKey && registeredKey !== senderPublicKey) {
      this.logger.error('Sender identity verification failed: public key mismatch', {
        peerId: peerId.slice(0, 16),
        claimedKey: senderPublicKey.slice(0, 16),
        registeredKey: registeredKey.slice(0, 16)
      });
      return { valid: false };
    }
    
    // 如果发送方声称的身份与消息来源不匹配，拒绝处理
    if (message.from && message.from !== peerId) {
      this.logger.error('Sender identity verification failed: from field mismatch', {
        claimedFrom: message.from?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16)
      });
      return { valid: false };
    }
    
    return { valid: true };
  }

  /**
   * 发送解密失败响应
   */
  private async sendDecryptFailureResponse(originalMessageId: string, peerId: string): Promise<void> {
    this.logger.error('Failed to decrypt message', { peerId: peerId.slice(0, 16) });
    
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
    
    try {
      await this.sendMessage(peerId, decryptFailResponse, false);
    } catch (sendError) {
      this.logger.error('Failed to send decrypt failure response', { 
        peerId: peerId.slice(0, 16),
        error: sendError 
      });
    }
  }

  /**
   * 根据消息类型分发处理
   */
  private async dispatchMessage(message: F2AMessage, peerId: string): Promise<void> {
    switch (message.type) {
      case 'DISCOVER':
        await this.handleDiscoverMessage(message, peerId, true);
        break;

      case 'DISCOVER_RESP':
        await this.handleDiscoverMessage(message, peerId, false);
        break;

      case 'CAPABILITY_QUERY':
        await this.handleCapabilityQueryMessage(message, peerId);
        break;

      case 'CAPABILITY_RESPONSE':
        await this.handleCapabilityResponseMessage(message, peerId);
        break;

      case 'TASK_RESPONSE':
        await this.handleTaskResponseMessage(message);
        break;

      case 'DECRYPT_FAILED':
        await this.handleDecryptFailedMessage(message, peerId);
        break;
    }
  }

  /**
   * 处理发现消息
   * P2-4 修复：添加速率限制，防止恶意节点大量发送 DISCOVER 消息
   */
  private async handleDiscoverMessage(message: F2AMessage, peerId: string, shouldRespond: boolean): Promise<void> {
    // P2-4 修复：检查 DISCOVER 消息速率限制
    if (!this.discoverRateLimiter.allowRequest(peerId)) {
      this.logger.warn('DISCOVER message rate limit exceeded, ignoring', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    
    const payload = message.payload as DiscoverPayload;
    await this.handleDiscover(payload.agentInfo, peerId, shouldRespond);
  }

  /**
   * 处理能力响应消息
   */
  private async handleCapabilityResponseMessage(message: F2AMessage, peerId: string): Promise<void> {
    const payload = message.payload as CapabilityResponsePayload;
    // P2-5 修复：upsertPeerFromAgentInfo 现在是 async，需要 await
    await this.upsertPeerFromAgentInfo(payload.agentInfo, peerId);
  }

  /**
   * 处理能力查询消息
   */
  private async handleCapabilityQueryMessage(message: F2AMessage, peerId: string): Promise<void> {
    const payload = message.payload as CapabilityQueryPayload;
    await this.handleCapabilityQuery(payload, peerId);
  }

  /**
   * 处理任务响应消息
   */
  private async handleTaskResponseMessage(message: F2AMessage): Promise<void> {
    const payloadValidation = validateTaskResponsePayload(message.payload);
    if (!payloadValidation.success) {
      this.logger.warn('Invalid task response payload', {
        errors: payloadValidation.error.errors
      });
      return;
    }
    const payload = message.payload as TaskResponsePayload;
    this.handleTaskResponse(payload);
  }

  /**
   * 处理解密失败通知消息
   */
  private async handleDecryptFailedMessage(message: F2AMessage, peerId: string): Promise<void> {
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
  }

  /**
   * 处理发现消息
   */
/**
   * 处理发现消息
   */
  private async handleDiscover(agentInfo: AgentInfo, peerId: string, shouldRespond: boolean): Promise<void> {
    // 安全验证：确保 agentInfo.peerId 与发送方一致，防止伪造
    if (agentInfo.peerId !== peerId) {
      this.logger.warn('Discovery message rejected: peerId mismatch', {
        claimedPeerId: agentInfo.peerId?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16)
      });
      return;
    }

    // P1 修复：记录是否需要清理，在锁外执行
    let needsAggressiveCleanup = false;

    // 使用锁保护容量检查和创建操作的原子性
    await this.peerTableLock.acquire();
    try {
      // 检查是否需要清理以腾出空间
      if (!this.peerTable.has(peerId)) {
        // 新 peer，需要检查容量
        const highWatermark = Math.floor(PEER_TABLE_MAX_SIZE * PEER_TABLE_HIGH_WATERMARK);
        if (this.peerTable.size >= highWatermark) {
          // P1 修复：不在锁内执行耗时清理，仅标记需要清理
          needsAggressiveCleanup = true;
        }
        
        if (this.peerTable.size >= PEER_TABLE_MAX_SIZE) {
          // 清理后仍无空间，拒绝新 peer
          this.logger.warn('Peer table full, rejecting new peer', {
            peerId: peerId.slice(0, 16),
            currentSize: this.peerTable.size,
            maxSize: PEER_TABLE_MAX_SIZE
          });
          return;
        }
      }

      // 更新路由表
      const now = Date.now();
      const existing = this.peerTable.get(peerId);
      if (existing) {
        this.peerTable.set(peerId, {
          ...existing,
          agentInfo,
          lastSeen: now,
          multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma))
        });
      } else {
        this.peerTable.set(peerId, {
          peerId,
          agentInfo,
          multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma)),
          connected: false,
          reputation: 50,
          lastSeen: now
        });
      }
    } finally {
      this.peerTableLock.release();
    }

    // P1 修复：在锁外异步执行清理，避免阻塞并发操作
    if (needsAggressiveCleanup) {
      // 使用 setImmediate 异步执行，不阻塞当前操作
      setImmediate(() => {
        this.cleanupStalePeers(true).catch(err => {
          this.logger.error('Background cleanup failed', { error: err });
        });
      });
    }

    // 注册对等方的加密公钥
    if (agentInfo.encryptionPublicKey) {
      this.e2eeCrypto.registerPeerPublicKey(peerId, agentInfo.encryptionPublicKey);
      this.logger.info('Registered encryption key', { peerId: peerId.slice(0, 16) });
    }

    // 仅对 DISCOVER 请求响应，避免发现响应循环
    if (shouldRespond) {
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
    }

    this.emit('peer:discovered', {
      peerId,
      agentInfo,
      multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma))
    });
  }

  /**
   * 将发现到的 Agent 信息更新到 Peer 表
   * P2-5 修复：改为 async/await 模式，确保锁正确等待
   */
  private async upsertPeerFromAgentInfo(agentInfo: AgentInfo, peerId: string): Promise<void> {
    // P2-5 修复：使用 async/await 确保锁正确等待
    await this.peerTableLock.acquire();
    try {
      // 检查是否需要清理以腾出空间
      if (this.peerTable.size >= PEER_TABLE_MAX_SIZE && !this.peerTable.has(peerId)) {
        this.cleanupStalePeersLocked(true);
      }

      const existing = this.peerTable.get(peerId);
      if (existing) {
        existing.agentInfo = agentInfo;
        existing.lastSeen = Date.now();
        existing.multiaddrs = agentInfo.multiaddrs.map(ma => multiaddr(ma));
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
    } finally {
      this.peerTableLock.release();
    }

    // 注册对等方的加密公钥
    if (agentInfo.encryptionPublicKey) {
      this.e2eeCrypto.registerPeerPublicKey(peerId, agentInfo.encryptionPublicKey);
      this.logger.info('Registered encryption key', { peerId: peerId.slice(0, 16) });
    }
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

    // P1 修复：使用原子操作避免竞态条件
    // 先检查 resolved 标志，再决定是否处理
    // 这确保即使多个响应并发到达，也只有一个能成功处理
    if (pending.resolved) {
      this.logger.warn('Task already resolved, ignoring duplicate response', { taskId: payload.taskId });
      return;
    }
    
    // 标记为已处理，防止并发响应重复处理
    pending.resolved = true;

    // 从 Map 中移除
    this.pendingTasks.delete(payload.taskId);

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
   * 支持指纹验证，防止中间人攻击
   */
  private async connectToBootstrapPeers(peers: string[]): Promise<void> {
    if (!this.node) return;

    for (const addr of peers) {
      try {
        const ma = multiaddr(addr);
        
        // 连接引导节点
        const conn = await this.node.dial(ma);
        const remotePeerId = conn.remotePeer.toString();
        
        // 指纹验证
        const expectedFingerprint = this.config.bootstrapPeerFingerprints?.[addr] 
          || this.config.bootstrapPeerFingerprints?.[remotePeerId];
        
        if (expectedFingerprint && remotePeerId !== expectedFingerprint) {
          // 指纹不匹配，记录错误并断开连接
          this.logger.error('Bootstrap peer fingerprint mismatch', {
            addr,
            expected: expectedFingerprint,
            actual: remotePeerId
          });
          
          // 断开连接
          try {
            await this.node.hangUp(ma);
          } catch (hangUpError) {
            this.logger.warn('Failed to hang up after fingerprint mismatch', {
              addr,
              error: hangUpError instanceof Error ? hangUpError.message : String(hangUpError)
            });
          }
          continue;
        }
        
        if (!expectedFingerprint) {
          // 未配置指纹，记录警告但不阻止连接
          this.logger.warn('Bootstrap peer connected without fingerprint verification', {
            addr,
            peerId: remotePeerId
          });
        } else {
          // 指纹验证成功
          this.logger.info('Bootstrap peer verified', { 
            addr, 
            peerId: remotePeerId 
          });
        }
      } catch (error) {
        this.logger.warn('Failed to connect to bootstrap', { 
          addr,
          error: error instanceof Error ? error.message : String(error)
        });
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
   * 清理过期的 Peer 记录（带锁保护）
   * @param aggressive 是否使用激进清理策略（清理更多条目）
   */
  private async cleanupStalePeers(aggressive = false): Promise<void> {
    await this.peerTableLock.acquire();
    try {
      this.cleanupStalePeersLocked(aggressive);
    } finally {
      this.peerTableLock.release();
    }
  }

  /**
   * 清理过期的 Peer 记录（内部方法，调用前必须持有锁）
   * @param aggressive 是否使用激进清理策略（清理更多条目）
   */
  private cleanupStalePeersLocked(aggressive = false): void {
    const now = Date.now();
    const threshold = aggressive ? 0 : PEER_STALE_THRESHOLD;
    let cleaned = 0;
    let skippedTrusted = 0;

    // 辅助函数：检查 peer 是否在白名单中
    const isTrusted = (peerId: string): boolean => this.trustedPeers.has(peerId);

    // 激进清理：清理更多类型的条目
    if (aggressive) {
      // 1. 清理所有未连接且超过 1 小时的 peer（跳过白名单）
      for (const [peerId, peer] of this.peerTable) {
        if (isTrusted(peerId)) {
          skippedTrusted++;
          continue;
        }
        if (!peer.connected && now - peer.lastSeen > 60 * 60 * 1000) {
          this.peerTable.delete(peerId);
          cleaned++;
        }
      }
      
      // 2. 如果仍然超过高水位线，按最后活跃时间排序后删除最旧的（跳过白名单）
      const highWatermark = Math.floor(PEER_TABLE_MAX_SIZE * PEER_TABLE_HIGH_WATERMARK);
      if (this.peerTable.size > highWatermark) {
        const targetSize = Math.floor(PEER_TABLE_MAX_SIZE * PEER_TABLE_AGGRESSIVE_CLEANUP_THRESHOLD);
        const sorted = Array.from(this.peerTable.entries())
          .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
        
        // 优先删除未连接的 peer（跳过白名单）
        const toRemove = sorted
          .filter(([peerId, peer]) => !isTrusted(peerId) && !peer.connected)
          .slice(0, this.peerTable.size - targetSize);
        
        for (const [peerId] of toRemove) {
          this.peerTable.delete(peerId);
          cleaned++;
        }
      }
    } else {
      // 常规清理：清理过期条目（跳过白名单）
      for (const [peerId, peer] of this.peerTable) {
        // 跳过白名单中的 peer
        if (isTrusted(peerId)) {
          skippedTrusted++;
          continue;
        }
        
        // 清理条件：长时间未活跃，或者未连接且超过一定时间
        const shouldClean = 
          now - peer.lastSeen > threshold ||
          (!peer.connected && now - peer.lastSeen > 60 * 60 * 1000); // 未连接超过 1 小时

        if (shouldClean) {
          this.peerTable.delete(peerId);
          cleaned++;
        }
      }
    }

    // 如果仍然超过最大容量，按最后活跃时间排序后删除最旧的（跳过白名单）
    if (this.peerTable.size > PEER_TABLE_MAX_SIZE) {
      const sorted = Array.from(this.peerTable.entries())
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);

      // 优先删除未连接的 peer（跳过白名单）
      const disconnected = sorted.filter(([peerId, _]) => !isTrusted(peerId) && !this.connectedPeers.has(peerId));
      const toRemove = disconnected.length > 0 
        ? disconnected.slice(0, this.peerTable.size - PEER_TABLE_MAX_SIZE)
        : sorted.filter(([peerId, _]) => !isTrusted(peerId)).slice(0, this.peerTable.size - PEER_TABLE_MAX_SIZE);
      
      for (const [peerId] of toRemove) {
        this.peerTable.delete(peerId);
        cleaned++;
      }

      this.logger.info('Removed oldest peers to maintain limit', { removed: toRemove.length });
    }

    if (cleaned > 0 || skippedTrusted > 0) {
      this.logger.info('Cleaned up stale peers', { 
        cleaned, 
        skippedTrusted,
        remaining: this.peerTable.size, 
        aggressive,
        trustedCount: this.trustedPeers.size 
      });
    }
  }

  /**
   * 原子操作：获取 peer 信息
   */
  private getPeer(peerId: string): PeerInfo | undefined {
    return this.peerTable.get(peerId);
  }

  /**
   * 原子操作：设置 peer 信息
   */
  private setPeer(peerId: string, info: PeerInfo): void {
    this.peerTable.set(peerId, info);
  }

  /**
   * 原子操作：更新 peer 信息（线程安全）
   * @param peerId Peer ID
   * @param updater 更新函数，接收当前值，返回新值
   * @returns 更新后的 peer 信息，如果 peer 不存在则返回 undefined
   */
  private async updatePeer(
    peerId: string,
    updater: (peer: PeerInfo) => PeerInfo
  ): Promise<PeerInfo | undefined> {
    await this.peerTableLock.acquire();
    try {
      const peer = this.peerTable.get(peerId);
      if (!peer) return undefined;
      const updated = updater(peer);
      this.peerTable.set(peerId, updated);
      return updated;
    } finally {
      this.peerTableLock.release();
    }
  }

  /**
   * 原子操作：安全地更新或创建 peer
   * @param peerId Peer ID
   * @param creator 创建新 peer 的函数（如果不存在）
   * @param updater 更新函数（如果存在）
   */
  private async upsertPeer(
    peerId: string,
    creator: () => PeerInfo,
    updater: (peer: PeerInfo) => PeerInfo
  ): Promise<PeerInfo> {
    await this.peerTableLock.acquire();
    try {
      const existing = this.peerTable.get(peerId);
      if (existing) {
        const updated = updater(existing);
        this.peerTable.set(peerId, updated);
        return updated;
      } else {
        const created = creator();
        this.peerTable.set(peerId, created);
        return created;
      }
    } finally {
      this.peerTableLock.release();
    }
  }

  /**
   * 原子操作：删除 peer
   */
  private async deletePeer(peerId: string): Promise<boolean> {
    await this.peerTableLock.acquire();
    try {
      return this.peerTable.delete(peerId);
    } finally {
      this.peerTableLock.release();
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
   * P2.4 修复：使用 connectedPeers Set 索引，O(1) 查询复杂度
   */
  getConnectedPeers(): PeerInfo[] {
    const result: PeerInfo[] = [];
    for (const peerId of this.connectedPeers) {
      const peer = this.peerTable.get(peerId);
      if (peer) {
        result.push(peer);
      }
    }
    return result;
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

    const dht = (this.node.services as Libp2pServices).dht;
    if (!dht) {
      return failureFromError('DHT_NOT_AVAILABLE', 'DHT service not enabled');
    }

    try {
      const peerIdObj = peerIdFromString(peerId);
      const peerInfo = await dht.findPeer(peerIdObj);
      
      if (peerInfo && peerInfo.multiaddrs.length > 0) {
        return success(peerInfo.multiaddrs.map(ma => ma.toString()));
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
    const dht = (this.node?.services as Libp2pServices)?.dht;
    return dht?.routingTable?.size || 0;
  }

  /**
   * 检查 DHT 是否启用
   */
  isDHTEnabled(): boolean {
    return !!(this.node?.services as Libp2pServices)?.dht;
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
