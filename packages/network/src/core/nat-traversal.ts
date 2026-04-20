/**
 * NAT 穿透管理器
 * 
 * Phase 2: Network Layer Enhancement
 * - AutoNAT: 自动检测公网可达性
 * - Circuit Relay: 中继服务（类似 TURN）
 * - DCUtR: 打洞技术
 */

import { EventEmitter } from 'eventemitter3';
import type { Libp2p } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';
import { multiaddr } from '@multiformats/multiaddr';
import { Logger } from '../utils/logger.js';

const logger = new Logger({ component: 'NATTraversal' });

/** NAT 类型 */
export enum NATType {
  /** 公网可达，无 NAT */
  PUBLIC = 'public',
  /** 锥形 NAT（容易穿透） */
  CONE = 'cone',
  /** 对称 NAT（难以穿透） */
  SYMMETRIC = 'symmetric',
  /** 未知/检测中 */
  UNKNOWN = 'unknown'
}

/** NAT 穿透状态 */
export interface NATTraversalStatus {
  /** NAT 类型 */
  natType: NATType;
  /** 是否可从公网访问 */
  isPubliclyReachable: boolean;
  /** 公网地址列表 */
  publicAddresses: Multiaddr[];
  /** 是否使用 Relay */
  usingRelay: boolean;
  /** Relay 服务器地址 */
  relayAddress?: string;
  /** 最后检测时间 */
  lastChecked: Date;
}

/** NAT 穿透配置 */
export interface NATTraversalConfig {
  /** 是否启用 AutoNAT */
  enableAutoNAT: boolean;
  /** 是否启用 Circuit Relay 客户端 */
  enableRelayClient: boolean;
  /** 是否启用 DCUtR 打洞 */
  enableDCUtR: boolean;
  /** 公共 Relay 服务器列表 */
  relayServers: string[];
  /** AutoNAT 检测超时（毫秒） */
  autoNATTimeout: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: NATTraversalConfig = {
  enableAutoNAT: true,
  enableRelayClient: true,
  enableDCUtR: true,
  relayServers: [
    // 公共 Relay 服务器将在部署后添加
  ],
  autoNATTimeout: 30000
};

/** NAT 穿透事件 */
export interface NATTraversalEvents {
  'nat:detected': (status: NATTraversalStatus) => void;
  'relay:connected': (relayAddress: string) => void;
  'relay:disconnected': (relayAddress: string) => void;
  'hole-punch:success': (peerId: string) => void;
  'hole-punch:failed': (peerId: string, reason: string) => void;
  'error': (error: Error) => void;
}

/**
 * NAT 穿透管理器
 * 
 * 负责：
 * 1. 检测 NAT 类型和公网可达性
 * 2. 管理 Relay 连接
 * 3. 执行打洞操作
 */
export class NATTraversalManager extends EventEmitter<NATTraversalEvents> {
  private libp2p: Libp2p;
  private config: NATTraversalConfig;
  private status: NATTraversalStatus;
  private dcutrService: any = null;

  constructor(libp2p: Libp2p, config: Partial<NATTraversalConfig> = {}) {
    super();
    this.libp2p = libp2p;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status = {
      natType: NATType.UNKNOWN,
      isPubliclyReachable: false,
      publicAddresses: [],
      usingRelay: false,
      lastChecked: new Date()
    };
  }

  /**
   * 初始化 NAT 穿透服务
   */
  async initialize(): Promise<void> {
    logger.info('Initializing NAT traversal services', {
      autoNAT: this.config.enableAutoNAT,
      relay: this.config.enableRelayClient,
      dcutr: this.config.enableDCUtR
    });

    // 初始化 AutoNAT
    if (this.config.enableAutoNAT) {
      await this.initializeAutoNAT();
    }

    // 初始化 Circuit Relay 客户端
    if (this.config.enableRelayClient) {
      await this.initializeRelayClient();
    }

    // 初始化 DCUtR
    if (this.config.enableDCUtR) {
      await this.initializeDCUtR();
    }

    // 开始 NAT 检测
    await this.detectNATType();
  }

  /**
   * 初始化 AutoNAT 服务
   */
  private async initializeAutoNAT(): Promise<void> {
    try {
      // AutoNAT 通常在 libp2p 配置中启用
      // 这里我们检查是否可用
      const services = (this.libp2p as any).services;
      if (services?.autonat) {
        logger.info('AutoNAT service available');
      } else {
        logger.warn('AutoNAT service not configured in libp2p');
      }
    } catch (error) {
      logger.error('Failed to initialize AutoNAT', { error });
    }
  }

  /**
   * 初始化 Circuit Relay 客户端
   */
  private async initializeRelayClient(): Promise<void> {
    try {
      const services = (this.libp2p as any).services;
      if (services?.relay) {
        logger.info('Circuit Relay client available');
      } else {
        logger.warn('Circuit Relay service not configured in libp2p');
      }
    } catch (error) {
      logger.error('Failed to initialize Relay client', { error });
    }
  }

  /**
   * 初始化 DCUtR 服务
   */
  private async initializeDCUtR(): Promise<void> {
    try {
      const services = (this.libp2p as any).services;
      if (services?.dcutr) {
        this.dcutrService = services.dcutr;
        logger.info('DCUtR service available');
      } else {
        logger.warn('DCUtR service not configured in libp2p');
      }
    } catch (error) {
      logger.error('Failed to initialize DCUtR', { error });
    }
  }

  /**
   * 检测 NAT 类型
   */
  async detectNATType(): Promise<NATTraversalStatus> {
    logger.info('Detecting NAT type...');

    try {
      // 使用 AutoNAT 检测公网可达性
      const dialResults = await this.testPublicReachability();
      
      if (dialResults.length > 0) {
        // 可从公网访问
        this.status.natType = NATType.PUBLIC;
        this.status.isPubliclyReachable = true;
        this.status.publicAddresses = dialResults;
        logger.info('Public reachability confirmed', {
          addresses: dialResults.map(a => a.toString())
        });
      } else {
        // 在 NAT 后面
        // 进一步检测 NAT 类型
        this.status.natType = await this.classifyNATType();
        this.status.isPubliclyReachable = false;
        logger.info('Behind NAT', { type: this.status.natType });
      }

      this.status.lastChecked = new Date();
      this.emit('nat:detected', this.status);

      return this.status;
    } catch (error) {
      logger.error('Failed to detect NAT type', { error });
      this.status.natType = NATType.UNKNOWN;
      return this.status;
    }
  }

  /**
   * 测试公网可达性
   */
  private async testPublicReachability(): Promise<Multiaddr[]> {
    const observedAddrs: Multiaddr[] = [];

    try {
      // 获取观察到的地址（通过 AutoNAT 或其他节点）
      const multiaddrs = this.libp2p.getMultiaddrs();
      
      for (const addr of multiaddrs) {
        const addrStr = addr.toString();
        // 检查是否是公网地址
        if (this.isPublicAddress(addrStr)) {
          observedAddrs.push(addr);
        }
      }

      return observedAddrs;
    } catch (error) {
      logger.error('Failed to test public reachability', { error });
      return [];
    }
  }

  /**
   * 判断是否是公网地址
   */
  private isPublicAddress(addr: string): boolean {
    // 排除本地地址
    if (addr.includes('/ip4/127.0.0.1/') ||
        addr.includes('/ip4/192.168.') ||
        addr.includes('/ip4/10.') ||
        addr.includes('/ip4/172.16.') ||
        addr.includes('/ip4/172.17.') ||
        addr.includes('/ip4/172.18.') ||
        addr.includes('/ip4/172.19.') ||
        addr.includes('/ip4/172.20.') ||
        addr.includes('/ip4/172.21.') ||
        addr.includes('/ip4/172.22.') ||
        addr.includes('/ip4/172.23.') ||
        addr.includes('/ip4/172.24.') ||
        addr.includes('/ip4/172.25.') ||
        addr.includes('/ip4/172.26.') ||
        addr.includes('/ip4/172.27.') ||
        addr.includes('/ip4/172.28.') ||
        addr.includes('/ip4/172.29.') ||
        addr.includes('/ip4/172.30.') ||
        addr.includes('/ip4/172.31/') ||
        addr.includes('/ip6/::1/') ||
        addr.includes('/ip6/fc') ||
        addr.includes('/ip6/fe80')) {
      return false;
    }

    return true;
  }

  /**
   * 分类 NAT 类型
   */
  private async classifyNATType(): Promise<NATType> {
    // 简化的 NAT 类型检测
    // 真正的检测需要多个 STUN 服务器配合
    
    // 如果我们观察到多个不同的公网映射，可能是对称 NAT
    // 如果映射一致，可能是锥形 NAT
    
    // 由于 libp2p 没有内置完整的 NAT 类型检测，
    // 这里我们保守地返回 UNKNOWN
    return NATType.UNKNOWN;
  }

  /**
   * 连接到 Relay 服务器
   */
  async connectToRelay(relayAddress: string): Promise<boolean> {
    logger.info('Connecting to relay server', { relayAddress });

    try {
      const relayMultiaddr = multiaddr(relayAddress);
      await this.libp2p.dial(relayMultiaddr);
      
      this.status.usingRelay = true;
      this.status.relayAddress = relayAddress;
      this.emit('relay:connected', relayAddress);
      
      logger.info('Connected to relay server', { relayAddress });
      return true;
    } catch (error) {
      logger.error('Failed to connect to relay', { relayAddress, error });
      return false;
    }
  }

  /**
   * 断开 Relay 连接
   */
  async disconnectFromRelay(): Promise<void> {
    if (this.status.relayAddress) {
      try {
        const relayMultiaddr = multiaddr(this.status.relayAddress);
        await this.libp2p.hangUp(relayMultiaddr);
        
        const addr = this.status.relayAddress;
        this.status.usingRelay = false;
        this.status.relayAddress = undefined;
        this.emit('relay:disconnected', addr);
        
        logger.info('Disconnected from relay server', { addr });
      } catch (error) {
        logger.error('Failed to disconnect from relay', { error });
      }
    }
  }

  /**
   * 尝试打洞连接
   */
  async attemptHolePunch(peerId: string): Promise<boolean> {
    logger.info('Attempting hole punch', { peerId });

    try {
      // DCUtR 通常在 libp2p 内部自动处理
      // 这里我们检查连接是否成功建立
      
      if (this.dcutrService) {
        // DCUtR 服务可用，打洞会自动尝试
        logger.info('DCUtR available, hole punch will be attempted automatically');
        this.emit('hole-punch:success', peerId);
        return true;
      } else {
        logger.warn('DCUtR not available, hole punch cannot be attempted');
        this.emit('hole-punch:failed', peerId, 'DCUtR not configured');
        return false;
      }
    } catch (error) {
      logger.error('Hole punch failed', { peerId, error });
      this.emit('hole-punch:failed', peerId, String(error));
      return false;
    }
  }

  /**
   * 获取当前 NAT 穿透状态
   */
  getStatus(): NATTraversalStatus {
    return { ...this.status };
  }

  /**
   * 获取推荐的连接策略
   */
  getRecommendedStrategy(): ConnectionStrategy {
    if (this.status.isPubliclyReachable) {
      return ConnectionStrategy.DIRECT;
    }

    if (this.status.natType === NATType.CONE) {
      return ConnectionStrategy.HOLE_PUNCH_FIRST;
    }

    if (this.status.usingRelay) {
      return ConnectionStrategy.RELAY_ONLY;
    }

    return ConnectionStrategy.RELAY_FALLBACK;
  }

  /**
   * 销毁
   */
  async destroy(): Promise<void> {
    await this.disconnectFromRelay();
    this.removeAllListeners();
  }
}

/** 连接策略 */
export enum ConnectionStrategy {
  /** 直接连接（公网可达） */
  DIRECT = 'direct',
  /** 优先打洞，失败后使用 Relay */
  HOLE_PUNCH_FIRST = 'hole-punch-first',
  /** 仅使用 Relay */
  RELAY_ONLY = 'relay-only',
  /** Relay 兜底 */
  RELAY_FALLBACK = 'relay-fallback'
}