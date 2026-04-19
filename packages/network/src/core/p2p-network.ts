/**
 * P2P 网络管理器
 * 基于 libp2p 实现 Agent 发现与通信
 * 
 * Phase 2: NAT 穿透支持
 * - AutoNAT: 自动检测公网可达性
 * - Circuit Relay: 中继服务
 * - DCUtR: 打洞技术
 */

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { yamux } from '@chainsafe/libp2p-yamux';
import { autoNAT } from '@libp2p/autonat';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { dcutr } from '@libp2p/dcutr';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
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
  StructuredMessagePayload,
  MESSAGE_TOPICS,
  DiscoverPayload,
  success,
  failureFromError,
  createError
} from '../types/index.js';
import { E2EECrypto, EncryptedMessage } from './e2ee-crypto.js';
import { IdentityManager } from './identity/index.js';
import { AgentIdentityVerifier } from './identity/agent-identity-verifier.js';
import { NATTraversalManager, NATTraversalStatus } from './nat-traversal.js';
import { Logger } from '../utils/logger.js';
import { validateF2AMessage, validateStructuredMessagePayload } from '../utils/validation.js';
import { MiddlewareManager, Middleware } from '../utils/middleware.js';
import { RequestSigner, loadSignatureConfig, SignedMessage } from '../utils/signature.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { isEncryptedMessage, EncryptedF2AMessage } from '../common/type-guards.js';
import { PeerManager } from './peer-manager.js';
import { DiscoveryService } from './discovery-service.js';
import { DHTService } from './dht-service.js';

// DHT 服务类型定义 (保留用于 libp2p services 类型检查)
interface DHTServiceApi {
  findPeer(peerId: PeerId): Promise<{ multiaddrs: Multiaddr[] } | null>;
  routingTable?: { size: number };
}

interface Libp2pServices {
  dht?: DHTServiceApi;
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
  // RFC 003: 签名验证失败事件
  'security:invalid-signature': (event: { agentId: string; peerId: string; error?: string }) => void;
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
  /** PeerManager: 管理 Peer 状态（peerTable, connectedPeers, trustedPeers） */
  private peerManager: PeerManager;
  /** DiscoveryService: 管理 Agent 发现 */
  private discoveryService: DiscoveryService;
  /** DHTService: 管理 DHT 发现、注册和 Relay 连接 */
  private dhtService: DHTService;
  /** P2-4 修复：DISCOVER 消息速率限制器（每个 peer） */
  private discoverRateLimiter = new RateLimiter({
    maxRequests: 10, // 每个 peer 每分钟最多 10 次 DISCOVER 消息
    windowMs: 60 * 1000,
    burstMultiplier: 1.2 // 允许轻微突发
  });
  /** P0-2 修复：DECRYPT_FAILED 消息速率限制器（每个 peer） */
  private decryptFailedRateLimiter = new RateLimiter({
    maxRequests: 5, // 每个 peer 每分钟最多 5 次 DECRYPT_FAILED 消息
    windowMs: 60 * 1000,
    burstMultiplier: 1.0 // 不允许突发，严格限制
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
  private natTraversalManager?: NATTraversalManager;
  private logger: Logger;
  private middlewareManager: MiddlewareManager;
  
  // RFC 003: AgentIdentityVerifier - 跨节点签名验证
  private agentIdentityVerifier?: import('./identity/agent-identity-verifier.js').AgentIdentityVerifier;
  
  // RFC 003: AgentRegistry 引用 - 用于获取签名
  private agentRegistry?: import('./agent-registry.js').AgentRegistry;
  
  // RFC 003: 是否启用 AgentId 签名验证
  private enableAgentIdVerification: boolean = true;

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
    
    // 初始化 PeerManager（管理 peer 状态）
    this.peerManager = new PeerManager(this.config.trustedPeers);
    
    // 初始化 DiscoveryService（管理 Agent 发现）
    this.discoveryService = new DiscoveryService({
      peerManager: this.peerManager,
      agentInfo: this.agentInfo,
    });
    
    // 初始化 DHTService（管理 DHT 发现、注册和 Relay 连接）
    this.dhtService = new DHTService();
    
    // 监听 DiscoveryService 事件，转发到实际发送逻辑
    this.discoveryService.on('broadcast', (message) => {
      // 广播消息到所有连接的 peers
      this.broadcast(message).catch(err => {
        this.logger.warn('Discovery broadcast failed', { error: getErrorMessage(err) });
      });
    });
    
    this.discoveryService.on('send', ({ peerId, message }) => {
      // 发送消息到特定 peer
      this.sendMessage(peerId, message, false).catch(err => {
        this.logger.warn('Discovery send failed', { 
          peerId: peerId.slice(0, 16), 
          error: getErrorMessage(err) 
        });
      });
    });
    
    // 引导节点自动加入白名单
    if (this.config.bootstrapPeers) {
      this.config.bootstrapPeers.forEach(addr => {
        // 从 multiaddr 提取 peer ID
        try {
          const ma = multiaddr(addr);
          const components = ma.getComponents();
          const p2pComponent = components.find(c => c.name === 'p2p');
          if (p2pComponent?.value) this.peerManager.addTrusted(p2pComponent.value);
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
   * RFC 003: 设置 AgentRegistry（用于获取签名）
   * 必须在 start() 之前或之后调用
   */
  setAgentRegistry(agentRegistry: import('./agent-registry.js').AgentRegistry): void {
    this.agentRegistry = agentRegistry;
    
    // 初始化 AgentIdentityVerifier（同步创建）
    this.agentIdentityVerifier = new AgentIdentityVerifier(
      this.e2eeCrypto,
      this.peerManager.getPeerTable(),
      this.peerManager.getConnectedPeersSet()
    );
    
    this.logger.info('AgentRegistry and AgentIdentityVerifier configured', {
      peerId: this.agentInfo.peerId?.slice(0, 16) || 'not-set'
    });
  }
  
  /**
   * RFC 003: 启用/禁用 AgentId 签名验证
   */
  setEnableAgentIdVerification(enable: boolean): void {
    this.enableAgentIdVerification = enable;
    this.logger.info('AgentId verification mode changed', { enabled: enable });
  }
  
  /**
   * RFC 003: 更新 AgentIdentityVerifier 的 Peer 表引用
   */
  updateVerifierPeerReferences(): void {
    if (this.agentIdentityVerifier) {
      this.agentIdentityVerifier.updatePeerReferences(
        this.peerManager.getPeerTable(),
        this.peerManager.getConnectedPeersSet()
      );
    }
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

      // 创建 libp2p 节点 - 启用 noise 加密和 NAT 穿透
      const services: Record<string, any> = {};
      
      // Identify 服务 - libp2p 核心协议，用于协议协商和地址交换
      // 必须添加，否则连接无法正常建立
      services.identify = identify();
      
      // Ping 服务 - ConnectionMonitor 需要此服务进行心跳检测
      // libp2p v2.x 已兼容 @libp2p/ping@3.x
      services.ping = ping();
      
      // 只有显式启用 DHT 时才添加
      if (this.config.enableDHT === true) {
        services.dht = kadDHT({
          clientMode: !this.config.dhtServerMode, // 默认客户端模式
        });
        this.logger.info('DHT service configured', {
          serverMode: this.config.dhtServerMode || false
        });
      }

      // Phase 2: NAT 穿透服务
      // 启用后可以检测公网可达性和支持 Relay 连接
      if (this.config.enableNATTraversal) {
        // AutoNAT - 自动检测公网可达性
        services.autonat = autoNAT();
        
        // DCUtR - 打洞技术（允许两个 NAT 后的节点建立直接连接）
        services.dcutr = dcutr();
        
        this.logger.info('NAT traversal services enabled', {
          autonat: true,
          dcutr: true
        });
      }

      // Circuit Relay 服务端模式（可选，用于提供 Relay 服务给其他节点）
      // ⚠️ 安全注意：启用 Relay 服务端会允许任何节点通过本节点中继流量。
      // 这可能带来以下风险：
      // 1. 资源消耗：中继流量会消耗带宽和 CPU
      // 2. 滥用风险：恶意节点可能利用 Relay 隐藏身份或进行 DDoS
      // 建议仅在受信任环境中启用，或配置访问控制策略。
      // TODO: 添加访问控制列表 (ACL) 或基于信誉的 Relay 权限控制
      if (this.config.enableRelayServer) {
        services.relay = circuitRelayServer();
        this.logger.info('Circuit Relay server mode enabled (WARNING: no access control)');
      }

      // 构建传输层
      // 使用 any[] 绕过 libp2p transport 类型不兼容问题
      // tcp() 和 circuitRelayTransport() 的 Components 类型不同
      const transports: any[] = [tcp()];
      
      // Phase 2: Circuit Relay Transport（允许通过 Relay 连接）
      if (this.config.enableNATTraversal) {
        transports.push(circuitRelayTransport());
      }

      // Medium 修复：使用 libp2p 提供的类型定义
      const libp2pOptions: Libp2pInit = {
        addresses: {
          listen: listenAddresses
        },
        transports,
        connectionEncrypters: [noise()] as any,
        streamMuxers: [yamux()] as any,
        // Identify 服务必需的 nodeInfo 配置
        nodeInfo: {
          name: 'F2A',
          version: this.agentInfo.version || '0.3.2',
          userAgent: `F2A/${this.agentInfo.version || '0.3.2'}`
        } as any,
        // libp2p v2.x 已兼容 @libp2p/ping@2.x，可以启用 ConnectionMonitor
        services,
        // P2P 连接保持配置 - 防止连接在 stream 关闭后被立即关闭
        connectionManager: {
          minConnections: 0,
          maxConnections: 100,
          autoDial: true,
          autoDialPriority: ['private', 'public'] as any,
          autoDialPeerRetryThreshold: 300000, // 5 分钟
          maxPeerAddrsToDial: 10,
          // 保持连接活跃，不因为没有活跃 stream 而关闭
          maxIncomingPendingConnections: 10,
        } as any,
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
          libp2pOptions.privateKey = privateKey as any;
          this.logger.info('Using persisted identity', {
            peerId: this.identityManager.getPeerIdString()?.slice(0, 16)
          });
        }
      }

      this.node = await createLibp2p(libp2pOptions);

      // 获取实际监听地址（节点创建后即可获取）
      const addrs = this.node.getMultiaddrs().map(ma => ma.toString());
      
      // 从节点获取 peer ID
      const peerId = this.node.peerId;
      
      // 更新 agentInfo（在启动前设置）
      this.agentInfo.peerId = peerId.toString();
      this.agentInfo.multiaddrs = addrs;

      // 【关键修复】初始化 E2EE 加密必须在 node.start() 之前
      // 否则 peer:discovery 事件可能在 encryptionPublicKey 设置前触发
      // 导致 DISCOVER 消息不包含加密公钥
      if (this.identityManager?.isLoaded()) {
        const e2eeKeyPair = this.identityManager.getE2EEKeyPair();
        if (e2eeKeyPair) {
          this.e2eeCrypto.initializeWithKeyPair(e2eeKeyPair.privateKey, e2eeKeyPair.publicKey);
          this.logger.info('Using persisted E2EE key pair');
        }
      } else {
        // Phase 1 修复：即使 identityManager 未加载，也要初始化 E2EE
        this.logger.info('IdentityManager not loaded, initializing E2EE without persisted keys');
        await this.e2eeCrypto.initialize();
      }
      this.agentInfo.encryptionPublicKey = this.e2eeCrypto.getPublicKey() || undefined;
      this.logger.info('E2EE encryption enabled', {
        publicKey: this.agentInfo.encryptionPublicKey?.slice(0, 16)
      });

      // 设置事件监听（E2EE 初始化后）
      this.setupEventHandlers();

      // 启动节点
      await this.node.start();

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

      // Phase 2: 初始化 NAT 穿透管理器
      if (this.config.enableNATTraversal && this.node) {
        this.natTraversalManager = new NATTraversalManager(this.node);
        await this.natTraversalManager.initialize();
        this.logger.info('NAT traversal manager initialized');
      }

      // Phase 5: 配置 DHTService
      if (this.node) {
        this.dhtService.setNode(this.node);
        this.dhtService.setPeerManager(this.peerManager);
        this.dhtService.setDHTServerMode(this.config.dhtServerMode || false);
        
        if (this.natTraversalManager) {
          this.dhtService.setNATTraversalManager(this.natTraversalManager);
        }
        
        this.logger.info('DHTService configured');
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
    // P0-2 修复：停止 DECRYPT_FAILED 消息速率限制器
    this.decryptFailedRateLimiter.stop();
    
    // Phase 4: 停止 DiscoveryService
    this.discoveryService.stop();

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

    // Phase 2: 清理 NAT 穿透管理器
    if (this.natTraversalManager) {
      await this.natTraversalManager.destroy();
      this.natTraversalManager = undefined;
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
    
    // No longer needed - PeerManager handles locking internally
    // Old code used peerTableLock for atomic operations
    try {
      for (const peer of this.peerManager.getPeerTable().values()) {
        if (peer.agentInfo) {
          if (!capability || this.hasCapability(peer.agentInfo, capability)) {
            agents.push(peer.agentInfo);
            seenPeerIds.add(peer.agentInfo.peerId);
          }
        }
      }
    } finally {
      // Lock no longer needed
    }

    // 如果已经有足够的 agents 且不需要等待响应，直接返回
    if (agents.length > 0 && !waitForFirst) {
      return agents;
    }

    // 广播能力查询以发现更多节点（使用 MESSAGE 协议）
    await this.broadcast({
      id: randomUUID(),
      type: 'MESSAGE',
      from: this.agentInfo.peerId,
      timestamp: Date.now(),
      payload: {
        topic: MESSAGE_TOPICS.CAPABILITY_QUERY,
        content: { capabilityName: capability }
      } as StructuredMessagePayload
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
    // No longer needed - PeerManager handles locking internally
    // Old code used peerTableLock for atomic operations
    try {
      for (const peer of this.peerManager.getPeerTable().values()) {
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
   * 发送自由消息给特定 Peer（Agent 协议层）
   * Agent 之间的自然语言通信，无需预定义协议
   */
  async sendFreeMessage(
    peerId: string,
    content: string | Record<string, unknown>,
    topic?: string
  ): Promise<Result<void>> {
    this.logger.debug('sendFreeMessage called', {
      peerId: peerId.slice(0, 16),
      contentLength: typeof content === 'string' ? content.length : 'object'
    });

    // RFC 003: 构造消息 payload
    let payload: StructuredMessagePayload | import('../types/index.js').AgentMessagePayload;
    
    // 如果有 AgentRegistry，携带签名
    if (this.agentRegistry) {
      const myAgent = this.agentRegistry.get(this.agentInfo.agentId || '');
      if (myAgent) {
        // 构造 AgentMessagePayload（带签名）
        payload = {
          topic: topic || MESSAGE_TOPICS.FREE_CHAT,
          content,
          fromAgentId: myAgent.agentId,
          fromSignature: myAgent.signature,
          fromPeerId: this.agentInfo.peerId,
          timestamp: Date.now(),
          messageId: randomUUID()
        };
        
        this.logger.debug('[P2P] Sending message with AgentId signature', {
          agentId: myAgent.agentId,
          peerId: peerId.slice(0, 16)
        });
      } else {
        // Agent 不存在，使用普通 payload
        payload = {
          topic: topic || MESSAGE_TOPICS.FREE_CHAT,
          content
        };
        this.logger.warn('[P2P] Agent not found in registry, sending without signature', {
          agentId: this.agentInfo.agentId
        });
      }
    } else {
      // 无 AgentRegistry，使用普通 payload
      payload = {
        topic: topic || MESSAGE_TOPICS.FREE_CHAT,
        content
      }; 
    }

    const message: F2AMessage = {
      id: randomUUID(),
      type: 'MESSAGE',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload
    };

    // 发送消息（启用 E2EE 加密）
    const result = await this.sendMessage(peerId, message, true);
    
    this.logger.debug('sendFreeMessage result', {
      success: result.success,
      error: result.success ? undefined : result.error
    });
    
    return result;
  }

  /**
   * 广播发现消息
   * Phase 4: 使用 DiscoveryService 进行广播
   */
  private async broadcastDiscovery(): Promise<void> {
    // DiscoveryService 会发出 'broadcast' 事件，在构造函数中已订阅
    this.discoveryService.broadcastDiscovery();
  }

  /**
   * 广播消息到全网
   */
  private async broadcast(message: F2AMessage): Promise<void> {
    if (!this.node) return;

    // 【关键修复】使用 connectedPeers 而非 node.getPeers()
    // 问题：node.getPeers() 返回路由表中的所有 peer，包括已断开的
    // 解决：只向真正已连接的 peer 发送消息
    const connectedPeerIds = Array.from(this.peerManager.getConnectedPeersSet());
    
    if (connectedPeerIds.length === 0) {
      this.logger.debug('No connected peers to broadcast to');
      return;
    }
    
    const results = await Promise.allSettled(
      connectedPeerIds.map(peerId => this.sendMessage(peerId, message))
    );

    // 记录发送失败的情况（包含详细错误信息）
    const failures: Array<{ peerId: string; error: string }> = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failures.push({
          peerId: connectedPeerIds[index].toString().slice(0, 16),
          error: result.reason?.message || String(result.reason)
        });
      } else if (!result.value.success) {
        failures.push({
          peerId: connectedPeerIds[index].toString().slice(0, 16),
          error: result.value.error?.message || 'Unknown error'
        });
      }
    });

    if (failures.length > 0) {
      this.logger.warn('Broadcast failed to some peers', {
        failed: failures.length,
        total: connectedPeerIds.length,
        details: failures
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
      // 【关键修复】优先使用 connectedPeers 索引判断连接状态
      // 背景：libp2p getConnections() 可能返回已关闭的连接
      // 原因：peer:disconnect 事件在某些情况下不会触发（网络中断、重启残留）
      // 解决：维护自己的连接索引，并在失败时清除
      const isConnected = this.peerManager.getConnectedPeersSet().has(peerId);
      
      let connection;
      if (isConnected) {
        // 连接索引显示已连接，获取连接对象
        const connections = this.node.getConnections();
        connection = connections.find(c => c.remotePeer.toString() === peerId);
        
        if (!connection) {
          // 【防御性代码】索引有记录但 libp2p 没有 = 状态不一致
          // 清除索引，触发重新连接
          this.logger.warn('Connection index inconsistent, clearing', {
            peerId: peerId.slice(0, 16)
          });
          this.peerManager.getConnectedPeersSet().delete(peerId);
        }
      }
      
      if (!connection) {
        // 未连接，需要 dial
        const peerInfo = this.peerManager.getPeerTable().get(peerId);
        if (!peerInfo || peerInfo.multiaddrs.length === 0) {
          return failureFromError('PEER_NOT_FOUND', `Peer ${peerId} not found`);
        }
        
        // 【关键修复】选择合适的 multiaddr（过滤掉 localhost）
        // 问题：peerTable 中的 multiaddrs 可能包含 127.0.0.1，导致 dial 到自己
        // 解决：优先选择非 localhost 地址，除非只有 localhost 可选
        const localhostPatterns = [/127\.0\.0\.1/, /0\.0\.0\.0/, /::1/, /localhost/];
        const isLocalhost = (addr: string) => localhostPatterns.some(p => p.test(addr));
        
        const nonLocalhostAddrs = peerInfo.multiaddrs.filter(
          (addr: any) => !isLocalhost(addr.toString())
        );
        
        // 优先使用非 localhost 地址，如果没有则使用 localhost（本地测试场景）
        const targetAddr = nonLocalhostAddrs.length > 0 
          ? nonLocalhostAddrs[0] 
          : peerInfo.multiaddrs[0];
        
        this.logger.debug('Dialing peer', {
          peerId: peerId.slice(0, 16),
          targetAddr: targetAddr.toString().slice(0, 50),
          totalAddrs: peerInfo.multiaddrs.length,
          nonLocalhostAddrs: nonLocalhostAddrs.length
        });
        
        connection = await this.node.dial(targetAddr);
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

      // 使用协议流发送消息 (libp2p v3 Stream API)
      let stream;
      try {
        stream = await connection.newStream(F2A_PROTOCOL);
      } catch (newStreamError) {
        // newStream 失败可能是连接已关闭，尝试重新 dial
        this.logger.warn('Failed to create stream, reconnecting', {
          peerId: peerId.slice(0, 16),
          error: getErrorMessage(newStreamError)
        });
        
        // 清除连接索引
        this.peerManager.getConnectedPeersSet().delete(peerId);
        
        const peerInfo = this.peerManager.getPeerTable().get(peerId);
        if (peerInfo && peerInfo.multiaddrs.length > 0) {
          try {
            // 【关键修复】选择合适的 multiaddr（过滤掉 localhost）
            const localhostPatterns = [/127\.0\.0\.1/, /0\.0\.0\.0/, /::1/, /localhost/];
            const isLocalhost = (addr: string) => localhostPatterns.some(p => p.test(addr));
            const nonLocalhostAddrs = peerInfo.multiaddrs.filter(
              (addr: any) => !isLocalhost(addr.toString())
            );
            const targetAddr = nonLocalhostAddrs.length > 0 
              ? nonLocalhostAddrs[0] 
              : peerInfo.multiaddrs[0];
            
            connection = await this.node.dial(targetAddr);
            stream = await connection.newStream(F2A_PROTOCOL);
          } catch (dialError) {
            return failureFromError('CONNECTION_FAILED', `Failed to reconnect: ${getErrorMessage(dialError)}`);
          }
        } else {
          return failureFromError('CONNECTION_FAILED', getErrorMessage(newStreamError));
        }
      }
      
      try {
        await stream.send(data);
        // 【关键修复】发送后关闭写入端，让接收方知道数据发送完毕
        // 问题：send() 后不关闭写入端，接收方的 for await (chunk of stream) 会一直等待
        // 解决：sendCloseWrite() 告诉接收方"我发送完了"，但保持读取端打开
        // 类型断言：libp2p stream 实际有此方法，但类型定义缺失
        await (stream as any).sendCloseWrite?.();
      } catch (streamError) {
        // 发送失败，清除连接索引
        this.peerManager.getConnectedPeersSet().delete(peerId);
        // 发送失败时确保 stream 被关闭
        try { await stream.close(); } catch {}
        throw streamError;
      }

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

        // 更新路由表（使用 PeerManager）
        const now = Date.now();
        await this.peerManager.upsert(peerId, {
          multiaddrs: evt.detail.multiaddrs,
          connected: false,
          reputation: 25, // mDNS 发现的节点信誉初始化为 25，表示"未验证"状态
          lastSeen: now
        });

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
          error: getErrorMessage(error)
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

        // P2.4 修复：使用 PeerManager 更新路由表和连接索引
        const now = Date.now();
        await this.peerManager.upsert(peerId, {
          multiaddrs,
          connected: true,
          connectedAt: now,
          lastSeen: now
        });
        
        // P2.4 修复：维护连接索引
        this.peerManager.getConnectedPeersSet().add(peerId);
        
        // Phase 1 修复：连接建立后自动交换公钥
        if (this.enableE2EE && this.e2eeCrypto && this.agentInfo.encryptionPublicKey) {
          try {
            await this.sendPublicKey(peerId);
            this.logger.info('Public key sent', { peerId: peerId.slice(0, 16) });
          } catch (err) {
            this.logger.warn('Failed to send public key', { 
              peerId: peerId.slice(0, 16),
              error: getErrorMessage(err)
            });
          }
        }
      } catch (error) {
        this.logger.error('Error in peer:connect handler', {
          error: getErrorMessage(error)
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
        this.peerManager.getConnectedPeersSet().delete(peerId);

        // P1-2 修复：清理对等方的加密资源
        this.e2eeCrypto.unregisterPeer(peerId);

        // 使用 PeerManager 更新路由表（如果存在）
        const peer = this.peerManager.get(peerId);
        if (peer) {
          await this.peerManager.upsert(peerId, {
            connected: false,
            lastSeen: Date.now()
          });
        } else {
          // Peer 不在路由表中，记录警告但不创建条目（已断开）
          this.logger.warn('Peer disconnected but not in routing table', { peerId: peerId.slice(0, 16) });
        }
      } catch (error) {
        this.logger.error('Error in peer:disconnect handler', {
          error: getErrorMessage(error)
        });
      }
    };

    // 注册事件监听器
    this.node.addEventListener('peer:discovery', this.boundEventHandlers.peerDiscovery);
    this.node.addEventListener('peer:connect', this.boundEventHandlers.peerConnect);
    this.node.addEventListener('peer:disconnect', this.boundEventHandlers.peerDisconnect);

    // 处理传入的协议流 (libp2p v3 Stream API)
    this.node.handle(F2A_PROTOCOL, async (stream, connection) => {
      try {
        // 读取数据 - 使用异步迭代器
        const chunks: Uint8Array[] = [];
        for await (const chunk of stream) {
          // chunk 可能是 Uint8Array 或 Uint8ArrayList
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

      // 【关键修复】等待 peer:connect 事件处理完成
      // dial() 只是发起连接，peer:connect 事件是异步触发的
      // sendMessage 会检查 connectedPeers，需要等待事件处理器更新
      let retries = 0;
      const maxRetries = 10;
      while (!this.peerManager.getConnectedPeersSet().has(peerId) && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      
      if (!this.peerManager.getConnectedPeersSet().has(peerId)) {
        this.logger.warn('Connection established but peer:connect event not received', {
          peerId: peerId.slice(0, 16),
          waitMs: retries * 100
        });
      }

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
        error: getErrorMessage(connectError)
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
    const peerInfo = this.peerManager.getPeerTable().get(peerId);
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
   * 网络层消息直接处理，Agent 协议层消息转发给上层
   */
  private async dispatchMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 网络层消息处理
    switch (message.type) {
      case 'DISCOVER':
        await this.handleDiscoverMessage(message, peerId, true);
        break;

      case 'DISCOVER_RESP':
        await this.handleDiscoverMessage(message, peerId, false);
        break;

      case 'DECRYPT_FAILED':
        await this.handleDecryptFailedMessage(message, peerId);
        break;

      case 'KEY_EXCHANGE':  // Phase 1: 处理公钥交换
        await this.handleKeyExchange(message, peerId);
        break;

      case 'PING':
      case 'PONG':
        // 心跳消息由 libp2p 自动处理
        break;

      // Agent 协议层消息：MESSAGE 类型，根据 topic 分发
      case 'MESSAGE':
        await this.handleAgentMessage(message, peerId);
        break;
    }
  }

  /**
   * 处理 Agent 协议层消息（MESSAGE）
   * 根据 topic 区分不同类型的消息
   */
  private async handleAgentMessage(message: F2AMessage, peerId: string): Promise<void> {
    // P0 修复：验证 MESSAGE payload 格式
    const validation = validateStructuredMessagePayload(message.payload);
    if (!validation.success) {
      this.logger.warn('Invalid MESSAGE payload format', {
        errors: validation.error.errors,
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    const payload = validation.data;
    const topic = payload.topic;

    // RFC 003: AgentId 签名验证
    // 如果 payload 中包含 AgentId 信息，验证签名
    if (this.enableAgentIdVerification && this.agentIdentityVerifier) {
      // 检查 payload 是否为 AgentMessagePayload 类型
      const agentPayload = payload as any;
      if (agentPayload.fromAgentId && agentPayload.fromSignature) {
        // RFC 003 P0-1 修复: 传递 Ed25519 公钥作为第3个参数，peerId 作为第4个参数
        const verifyResult = await this.agentIdentityVerifier.verifyRemoteAgentId(
          agentPayload.fromAgentId,
          agentPayload.fromSignature,
          agentPayload.fromEd25519PublicKey, // Ed25519 公钥 (Base64)
          peerId // 发送方 PeerId (用于交叉验证)
        );
        
        if (!verifyResult.valid) {
          this.logger.warn('[P2P] Invalid AgentId signature, message rejected', {
            fromAgentId: agentPayload.fromAgentId,
            peerId: peerId.slice(0, 16),
            error: verifyResult.error
          });
          
          // 发送安全事件
          this.emit('security:invalid-signature', {
            agentId: agentPayload.fromAgentId,
            peerId,
            error: verifyResult.error
          });
          
          return; // 拒绝处理消息
        }
        
        this.logger.info('[P2P] AgentId signature verified', {
          fromAgentId: agentPayload.fromAgentId,
          matchedPeerId: verifyResult.matchedPeerId?.slice(0, 16)
        });
      }
    }

    this.logger.info('Received MESSAGE', {
      from: peerId.slice(0, 16),
      topic,
      contentLength: typeof payload.content === 'string' ? payload.content.length : 'object'
    });

    // 根据 topic 处理不同类型的消息
    if (topic === MESSAGE_TOPICS.CAPABILITY_QUERY) {
      await this.handleCapabilityQuery(payload, peerId);
    } else if (topic === MESSAGE_TOPICS.CAPABILITY_RESPONSE) {
      await this.handleCapabilityResponse(payload, peerId);
    } else if (topic === MESSAGE_TOPICS.TASK_RESPONSE) {
      this.handleTaskResponse(payload);
    } else {
      // 其他消息（包括 task.request 和自由对话）转发给上层
      this.emit('message:received', message, peerId);
    }
  }

  /**
   * 处理能力查询（MESSAGE + topic='capability.query'）
   */
  private async handleCapabilityQuery(
    payload: StructuredMessagePayload,
    peerId: string
  ): Promise<void> {
    const content = payload.content as { capabilityName?: string; toolName?: string };
    const matches = !content.capabilityName || 
      this.hasCapability(this.agentInfo, content.capabilityName);

    if (matches) {
      // 发送能力响应
      await this.sendMessage(peerId, {
        id: randomUUID(),
        type: 'MESSAGE',
        from: this.agentInfo.peerId,
        to: peerId,
        timestamp: Date.now(),
        payload: {
          topic: MESSAGE_TOPICS.CAPABILITY_RESPONSE,
          content: { agentInfo: this.agentInfo }
        } as StructuredMessagePayload
      });
    }
  }

  /**
   * 处理能力响应（MESSAGE + topic='capability.response'）
   */
  private async handleCapabilityResponse(
    payload: StructuredMessagePayload,
    peerId: string
  ): Promise<void> {
    const content = payload.content as { agentInfo: AgentInfo };
    await this.upsertPeerFromAgentInfo(content.agentInfo, peerId);
  }

  /**
   * 处理任务响应（MESSAGE + topic='task.response'）
   * P0-1 修复：使用原子删除操作避免竞态条件
   */
  private handleTaskResponse(payload: StructuredMessagePayload): void {
    const content = payload.content as {
      taskId: string;
      status: 'success' | 'error' | 'rejected' | 'delegated';
      result?: unknown;
      error?: string;
    };
    
    // P0-1 修复：先检查 resolved 标志
    const pending = this.pendingTasks.get(content.taskId);
    if (!pending) {
      this.logger.warn('Received response for unknown task', { taskId: content.taskId });
      return;
    }
    
    if (pending.resolved) {
      this.logger.warn('Task already resolved, ignoring duplicate response', { taskId: content.taskId });
      return;
    }
    
    pending.resolved = true;
    this.pendingTasks.delete(content.taskId);
    clearTimeout(pending.timeout);

    if (content.status === 'success') {
      pending.resolve(content.result);
    } else {
      pending.reject(content.error || 'Task failed');
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

  // ============================================================================
  // Phase 1: 公钥交换
  // ============================================================================

  /**
   * 发送公钥给指定 Peer
   */
  private async sendPublicKey(peerId: string): Promise<void> {
    if (!this.agentInfo.encryptionPublicKey) {
      this.logger.warn('No public key available, skipping key exchange');
      return;
    }

    const keyExchangeMessage: F2AMessage = {
      id: randomUUID(),
      type: 'KEY_EXCHANGE',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: {
        publicKey: this.agentInfo.encryptionPublicKey
      }
    };

    await this.sendMessage(peerId, keyExchangeMessage, false);
  }

  /**
   * 处理公钥交换消息
   */
  private async handleKeyExchange(message: F2AMessage, peerId: string): Promise<void> {
    const { publicKey } = message.payload as { publicKey?: string };
    
    if (!publicKey) {
      this.logger.warn('Received KEY_EXCHANGE without public key', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }

    // 注册对方公钥
    this.e2eeCrypto.registerPeerPublicKey(peerId, publicKey);
    this.logger.info('Peer public key registered', {
      peerId: peerId.slice(0, 16),
      publicKey: publicKey.slice(0, 16)
    });

    // 如果还没有发送过公钥，回复自己的公钥
    if (!this.e2eeCrypto.canEncryptTo(peerId)) {
      await this.sendPublicKey(peerId);
    }
  }

  /**
   * 处理解密失败通知消息（网络层协议）
   * P0-2 修复：添加速率限制，防止攻击者触发大量解密失败
   */
  private async handleDecryptFailedMessage(message: F2AMessage, peerId: string): Promise<void> {
    // P0-2 修复：检查 DECRYPT_FAILED 消息速率限制
    if (!this.decryptFailedRateLimiter.allowRequest(peerId)) {
      this.logger.warn('DECRYPT_FAILED message rate limit exceeded, ignoring', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    
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
    const peerInfo = this.peerManager.getPeerTable().get(peerId);
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
    // No longer needed - PeerManager handles locking internally
    // Old code used peerTableLock for atomic operations
    try {
      // 检查是否需要清理以腾出空间
      if (!this.peerManager.getPeerTable().has(peerId)) {
        // 新 peer，需要检查容量
        const highWatermark = Math.floor(PEER_TABLE_MAX_SIZE * PEER_TABLE_HIGH_WATERMARK);
        if (this.peerManager.getPeerTable().size >= highWatermark) {
          // P1 修复：不在锁内执行耗时清理，仅标记需要清理
          needsAggressiveCleanup = true;
        }
        
        if (this.peerManager.getPeerTable().size >= PEER_TABLE_MAX_SIZE) {
          // 清理后仍无空间，拒绝新 peer
          this.logger.warn('Peer table full, rejecting new peer', {
            peerId: peerId.slice(0, 16),
            currentSize: this.peerManager.getPeerTable().size,
            maxSize: PEER_TABLE_MAX_SIZE
          });
          return;
        }
      }

      // 更新路由表
      const now = Date.now();
      const existing = this.peerManager.getPeerTable().get(peerId);
      if (existing) {
        this.peerManager.getPeerTable().set(peerId, {
          ...existing,
          agentInfo,
          lastSeen: now,
          multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma))
        });
      } else {
        this.peerManager.getPeerTable().set(peerId, {
          peerId,
          agentInfo,
          multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma)),
          connected: false,
          reputation: 50,
          lastSeen: now
        });
      }
    } finally {
      // Lock no longer needed
    }

    // P1 修复：在锁外异步执行清理，避免阻塞并发操作
    if (needsAggressiveCleanup) {
      // 使用 setImmediate 异步执行，不阻塞当前操作
      setImmediate(() => {
        this.peerManager.cleanupStale({ aggressive: true }).catch(err => {
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
      this.logger.info('Sending DISCOVER_RESP', { peerId: peerId.slice(0, 16) });
      
      try {
        const responseResult = await this.sendMessage(peerId, {
          id: randomUUID(),
          type: 'DISCOVER_RESP',
          from: this.agentInfo.peerId,
          to: peerId,
          timestamp: Date.now(),
          payload: { agentInfo: this.agentInfo } as DiscoverPayload
        }, false); // DISCOVER_RESP 不需要加密

        if (!responseResult.success) {
          this.logger.warn('Failed to send discover response', {
            peerId: peerId.slice(0, 16),
            error: responseResult.error
          });
        } else {
          this.logger.info('Sent DISCOVER_RESP successfully', { peerId: peerId.slice(0, 16) });
        }
      } catch (err) {
        this.logger.error('Exception sending DISCOVER_RESP', {
          peerId: peerId.slice(0, 16),
          error: err instanceof Error ? err.message : String(err)
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
    // No longer needed - PeerManager handles locking internally
    // Old code used peerTableLock for atomic operations
    try {
      // 检查是否需要清理以腾出空间
      if (this.peerManager.size() >= PEER_TABLE_MAX_SIZE && !this.peerManager.get(peerId)) {
        this.peerManager.cleanupStale({ aggressive: true }).catch(err => {
          this.logger.error('Cleanup failed', { error: err });
        });
      }

      await this.peerManager.upsert(peerId, {
        agentInfo,
        multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma)),
        connected: false,
        reputation: 50,
        lastSeen: Date.now()
      });
    } finally {
      // Lock no longer needed
    }

    // 注册对等方的加密公钥
    if (agentInfo.encryptionPublicKey) {
      this.e2eeCrypto.registerPeerPublicKey(peerId, agentInfo.encryptionPublicKey);
      this.logger.info('Registered encryption key', { peerId: peerId.slice(0, 16) });
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
              error: getErrorMessage(hangUpError)
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
          error: getErrorMessage(error)
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
    // 立即执行一次（委托给 PeerManager）
    this.peerManager.cleanupStale().catch(err => {
      this.logger.error('Cleanup failed', { error: getErrorMessage(err) });
    });

    // 每 5 分钟清理一次
    this.cleanupInterval = setInterval(() => {
      this.peerManager.cleanupStale().then(result => {
        if (result.removed > 0) {
          this.logger.info('Cleaned up stale peers', result);
        }
      }).catch(err => {
        this.logger.error('Cleanup failed', { error: getErrorMessage(err) });
      });
    }, PEER_TABLE_CLEANUP_INTERVAL);
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
    for (const peerId of this.peerManager.getConnectedPeersSet()) {
      const peer = this.peerManager.getPeerTable().get(peerId);
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
    return Array.from(this.peerManager.getPeerTable().values());
  }

  /**
   * 获取节点 ID
   */
  getPeerId(): string | null {
    return this.agentInfo.peerId;
  }

  /**
   * RFC 003: 获取 Ed25519 公钥（用于签名验证）
   * 返回 Base64 编码的 Ed25519 公钥
   */
  getEd25519PublicKey(): string | null {
    const peerId = this.identityManager?.getPeerId();
    if (peerId?.publicKey) {
      return Buffer.from(peerId.publicKey.raw).toString('base64');
    }
    return null;
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
   * Phase 5: 委托给 DHTService
   */
  async findPeerViaDHT(peerId: string): Promise<Result<string[]>> {
    return this.dhtService.findPeerViaDHT(peerId);
  }

  /**
   * 获取 DHT 路由表大小
   * Phase 5: 委托给 DHTService
   */
  getDHTPeerCount(): number {
    return this.dhtService.getDHTPeerCount();
  }

  /**
   * 检查 DHT 是否启用
   * Phase 5: 委托给 DHTService
   */
  isDHTEnabled(): boolean {
    return this.dhtService.isDHTEnabled();
  }

  /**
   * 通过 DHT 发现节点（全局发现）
   * 
   * DHT 提供两种发现模式：
   * 1. 查找特定节点（需要知道 Peer ID）
   * 2. 发现随机节点（构建路由表）
   * 
   * Phase 5: 委托给 DHTService
   * 
   * @param options 发现选项
   * @returns 发现的节点地址列表
   */
  async discoverPeersViaDHT(options?: {
    /** 查找特定 Peer ID（可选） */
    peerId?: string;
    /** 超时时间（毫秒，默认 10000） */
    timeout?: number;
  }): Promise<Result<string[]>> {
    return this.dhtService.discoverPeersViaDHT(options);
  }

  /**
   * 向 DHT 注册自己（使其他节点能找到自己）
   * 
   * 注意：只有公网可达的节点才能作为 DHT 服务器
   * NAT 后的节点只能作为客户端
   * 
   * Phase 5: 委托给 DHTService
   */
  async registerToDHT(): Promise<Result<void>> {
    return this.dhtService.registerToDHT();
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

  /**
   * 获取当前配置
   * @returns P2P 网络配置
   */
  getConfig(): P2PNetworkConfig {
    // 返回深拷贝，防止调用者修改内部配置
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * 获取 NAT 穿透状态
   * @returns NAT 穿透状态，如果未启用则返回 undefined
   */
  getNATTraversalStatus(): NATTraversalStatus | undefined {
    return this.natTraversalManager?.getStatus();
  }

  /**
   * 连接到 Relay 服务器
   * Phase 5: 委托给 DHTService
   * @param relayAddress Relay 服务器地址（multiaddr 格式）
   * @returns 是否连接成功
   */
  async connectToRelay(relayAddress: string): Promise<boolean> {
    return this.dhtService.connectToRelay(relayAddress);
  }
}
