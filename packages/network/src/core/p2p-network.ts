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
import type { Libp2pInit } from 'libp2p';
import { multiaddr } from '@multiformats/multiaddr';
import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import type { Libp2p } from '@libp2p/interface';

import {
  P2PNetworkConfig,
  AgentInfo,
  F2AMessage,
  PeerInfo,
  PeerDiscoveredEvent,
  PeerConnectedEvent,
  PeerDisconnectedEvent,
  Result,
  StructuredMessagePayload,
  MESSAGE_TOPICS,
  success,
  failureFromError
} from '../types/index.js';
import { E2EECrypto } from './e2ee-crypto.js';
import { IdentityManager } from './identity/index.js';
import { AgentIdentityVerifier } from './identity/agent-identity-verifier.js';
import { NATTraversalManager, NATTraversalStatus } from './nat-traversal.js';
import { Logger } from '../utils/logger.js';
import { MiddlewareManager, Middleware } from '../utils/middleware.js';
import { RequestSigner, loadSignatureConfig, SignedMessage } from '../utils/signature.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { PeerManager } from './peer-manager.js';
import { DiscoveryService } from './discovery-service.js';
import { DHTService } from './dht-service.js';
import { MessageHandler } from './message-handler.js';
import { KeyExchangeService } from './key-exchange-service.js';
import { MessageSender } from './message-sender.js';
import { AgentDiscoverer } from './agent-discoverer.js';
import { EventHandlerSetupService } from './event-handler-setup.js';
import type { MessageHandlerDeps, KeyExchangeServiceDeps, MessageHandlerEvents } from '../types/p2p-handlers.js';

const PEER_TABLE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟

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
  /** MessageHandler: P2P 消息处理器（Phase 2 拆分） */
  private messageHandler?: MessageHandler;
  /** KeyExchangeService: E2EE 密钥交换服务（Phase 2 拆分） */
  private keyExchangeService?: KeyExchangeService;
  /** MessageSender: P2P 消息发送器（Phase 2 拆分） */
  private messageSender?: MessageSender;
  /** AgentDiscoverer: Agent 发现服务（Phase 2 拆分） */
  private agentDiscoverer?: AgentDiscoverer;
  /** EventHandlerSetupService: libp2p 事件处理器设置（Phase 2 拆分） */
  private eventHandlerSetup?: EventHandlerSetupService;
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
    
    // 监听 DiscoveryService 事件，转发到 MessageSender
    this.discoveryService.on('broadcast', (message) => {
      // 广播消息到所有连接的 peers（使用 MessageSender）
      if (this.messageSender) {
        this.messageSender.broadcast(message).catch(err => {
          this.logger.warn('Discovery broadcast failed', { error: getErrorMessage(err) });
        });
      }
    });
    
    this.discoveryService.on('send', ({ peerId, message }) => {
      // 发送消息到特定 peer（使用 MessageSender）
      if (this.messageSender) {
        this.messageSender.send(peerId, message, false).catch(err => {
          this.logger.warn('Discovery send failed', { 
            peerId: peerId.slice(0, 16), 
            error: getErrorMessage(err) 
          });
        });
      }
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

      // Phase 2: 初始化 MessageHandler 和 KeyExchangeService
      // 创建 sendMessage 回调（绑定到 MessageSender）
      const sendMessageCallback = async (peerId: string, message: F2AMessage, encrypt?: boolean) => {
        if (!this.messageSender) {
          throw new Error('MessageSender not initialized');
        }
        const result = await this.messageSender.send(peerId, message, encrypt ?? false);
        if (!result.success) {
          throw new Error(result.error?.message || 'Send message failed');
        }
      };

      // 初始化 KeyExchangeService
      const keyExchangeDeps: KeyExchangeServiceDeps = {
        e2eeCrypto: this.e2eeCrypto,
        logger: this.logger,
        sendMessage: sendMessageCallback,
      };
      this.keyExchangeService = new KeyExchangeService(keyExchangeDeps, this.agentInfo);

      // 初始化 MessageHandler
      const messageHandlerDeps: MessageHandlerDeps = {
        e2eeCrypto: this.e2eeCrypto,
        peerManager: this.peerManager,
        logger: this.logger,
        middlewareManager: this.middlewareManager,
        agentRegistry: this.agentRegistry,
        agentIdentityVerifier: this.agentIdentityVerifier,
        sendMessage: sendMessageCallback,
        emitter: this as EventEmitter<MessageHandlerEvents>,
        agentInfo: this.agentInfo,
        decryptFailedRateLimiter: this.decryptFailedRateLimiter,
        discoverRateLimiter: this.discoverRateLimiter,
        pendingTasks: this.pendingTasks,
        enableAgentIdVerification: this.enableAgentIdVerification,
        onKeyExchange: async (message: F2AMessage, peerId: string) => {
          await this.keyExchangeService!.handleKeyExchange(message, peerId);
        },
      };
      this.messageHandler = new MessageHandler(messageHandlerDeps);

      this.logger.info('MessageHandler and KeyExchangeService initialized');

      // 初始化 MessageSender
      this.messageSender = new MessageSender({
        node: this.node,
        e2eeCrypto: this.e2eeCrypto,
        logger: this.logger,
        peerManager: this.peerManager,
        enableE2EE: this.enableE2EE,
      });

      // 初始化 AgentDiscoverer
      this.agentDiscoverer = new AgentDiscoverer({
        peerManager: this.peerManager,
        discoveryService: this.discoveryService,
        dhtService: this.dhtService,
        logger: this.logger,
        broadcast: async (message: F2AMessage) => {
          if (this.messageSender) {
            await this.messageSender.broadcast(message);
          }
        },
        agentInfo: this.agentInfo,
        waitForPeerDiscovered: async (capability: string | undefined, timeoutMs: number) => {
          const discoveredAgents: AgentInfo[] = [];
          const seenPeerIds = new Set<string>();
          await new Promise<void>(resolve => {
            const timeout = setTimeout(() => {
              this.off('peer:discovered', onPeerDiscovered);
              resolve();
            }, timeoutMs);
            const onPeerDiscovered = (event: { agentInfo: AgentInfo; peerId: string }) => {
              if (!capability || this.agentDiscoverer?.hasCapability(event.agentInfo, capability)) {
                if (!seenPeerIds.has(event.agentInfo.peerId)) {
                  discoveredAgents.push(event.agentInfo);
                  seenPeerIds.add(event.agentInfo.peerId);
                }
              }
              clearTimeout(timeout);
              this.off('peer:discovered', onPeerDiscovered);
              resolve();
            };
            this.on('peer:discovered', onPeerDiscovered);
          });
          return discoveredAgents;
        },
      });

      // 初始化 EventHandlerSetupService
      this.eventHandlerSetup = new EventHandlerSetupService({
        node: this.node,
        peerManager: this.peerManager,
        logger: this.logger,
        messageHandler: this.messageHandler,
        keyExchangeService: this.keyExchangeService,
        e2eeCrypto: this.e2eeCrypto,
        agentInfo: this.agentInfo,
        discoverRateLimiter: this.discoverRateLimiter,
        onPeerDiscovered: (event) => this.emit('peer:discovered', event),
        onPeerConnected: (event) => this.emit('peer:connected', { 
          peerId: event.peerId, 
          direction: event.direction as 'inbound' | 'outbound'
        }),
        onPeerDisconnected: (event) => this.emit('peer:disconnected', event),
        sendDiscoverMessage: async (peerId, multiaddrs) => {
          await this.agentDiscoverer!.initiateDiscovery(peerId, multiaddrs, this.node, async (pid, msg) => {
            if (this.messageSender) {
              await this.messageSender.send(pid, msg, false);
            }
          });
        },
        enableE2EE: this.enableE2EE,
      });
      this.eventHandlerSetup.setup();

      this.logger.info('MessageSender, AgentDiscoverer, and EventHandlerSetupService initialized');

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
        this.discoveryService.broadcastDiscovery();
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
      // Phase 2: 使用 EventHandlerSetupService 移除事件监听器
      if (this.eventHandlerSetup) {
        this.eventHandlerSetup.teardown();
      }

      // 清理待处理任务
      for (const [_taskId, { timeout, resolve }] of this.pendingTasks) {
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
    if (!this.agentDiscoverer) {
      this.logger.warn('AgentDiscoverer not initialized');
      return [];
    }
    return this.agentDiscoverer.discover(capability, options);
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
    if (!this.messageSender) {
      return failureFromError('NETWORK_NOT_STARTED', 'MessageSender not initialized');
    }
    const result = await this.messageSender.send(peerId, message, true);
    
    this.logger.debug('sendFreeMessage result', {
      success: result.success,
      error: result.success ? undefined : result.error
    });
    
    return result;
  }

  /**
   * 启动定期发现广播
   */
  private startDiscoveryBroadcast(): void {
    // 立即广播一次
    this.discoveryService.broadcastDiscovery();

    // 每 30 秒广播一次
    this.discoveryInterval = setInterval(() => {
      this.discoveryService.broadcastDiscovery();
    }, 30000);
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
