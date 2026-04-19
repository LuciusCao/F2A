/**
 * DHTService - DHT 和 Relay 服务
 * 
 * 负责：
 * - DHT 节点发现
 * - DHT 注册
 * - Relay 连接
 * - DHT 路由表管理
 * 
 * Phase 5a+5b: 从 P2PNetwork 中提取为独立类
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '../utils/logger.js';
import type { Libp2p } from '@libp2p/interface';
import type { PeerId } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import type { Multiaddr } from '@multiformats/multiaddr';
import type { Result, PeerInfo } from '../types/index.js';
import { success, failureFromError } from '../types/index.js';

export interface DHTServiceEvents {
  /** 找到 Peer 时触发 */
  'peer:found': (data: { peerId: string; addresses: string[] }) => void;
  /** DHT 注册完成时触发 */
  'dht:registered': () => void;
  /** 连接到 Relay 时触发 */
  'relay:connected': (relayAddress: string) => void;
  /** DHT 发现完成时触发 */
  'dht:discovery': (data: { count: number; addresses: string[] }) => void;
}

// DHT 服务类型定义
interface DHTServiceApi {
  findPeer(peerId: PeerId): Promise<{ multiaddrs: Multiaddr[] } | null>;
  routingTable?: { size: number };
}

interface Libp2pServices {
  dht?: DHTServiceApi;
}

/** DHT 发现选项 */
export interface DHTDiscoverOptions {
  /** 查找特定 Peer ID（可选） */
  peerId?: string;
  /** 超时时间（毫秒，默认 10000） */
  timeout?: number;
}

/**
 * DHTService 类
 * 管理 DHT 相关的逻辑，包括节点发现、注册和 Relay 连接
 */
export class DHTService extends EventEmitter<DHTServiceEvents> {
  private node: Libp2p | null = null;
  private logger: Logger;
  private peerManager: { getConnectedPeers(): PeerInfo[] } | null = null;
  private natTraversalManager: { connectToRelay(address: string): Promise<boolean> } | null = null;
  private dhtServerMode: boolean = false;

  constructor() {
    super();
    this.logger = new Logger({ component: 'DHTService' });
  }

  /**
   * 设置 libp2p node 引用
   * 在 P2PNetwork start() 后调用
   */
  setNode(node: Libp2p): void {
    this.node = node;
  }

  /**
   * 设置 PeerManager 引用
   * 用于获取连接的 Peers 信息
   */
  setPeerManager(peerManager: { getConnectedPeers(): PeerInfo[] }): void {
    this.peerManager = peerManager;
  }

  /**
   * 设置 NATTraversalManager 引用
   * 用于 Relay 连接
   */
  setNATTraversalManager(natTraversalManager: { connectToRelay(address: string): Promise<boolean> }): void {
    this.natTraversalManager = natTraversalManager;
  }

  /**
   * 设置 DHT Server 模式
   */
  setDHTServerMode(mode: boolean): void {
    this.dhtServerMode = mode;
  }

  /**
   * 通过 DHT 查找特定 Peer
   * 
   * @param peerIdStr 要查找的 Peer ID
   * @param timeout 超时时间（毫秒）
   * @returns 查找结果，包含 Peer 的多地址列表
   */
  async findPeerViaDHT(peerIdStr: string, timeout: number = 10000): Promise<Result<string[]>> {
    if (!this.node) {
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not started');
    }

    try {
      // P1-1 修复：验证 peerId 格式
      if (!peerIdStr || typeof peerIdStr !== 'string') {
        return failureFromError('INVALID_PEER_ID', 'Invalid peer ID format');
      }

      const dht = (this.node.services as Libp2pServices).dht;
      if (!dht) {
        return failureFromError('DHT_NOT_AVAILABLE', 'DHT service not enabled');
      }

      this.logger.info('Finding peer via DHT', { peerId: peerIdStr.slice(0, 16) });

      let peerIdObj: PeerId;
      try {
        peerIdObj = peerIdFromString(peerIdStr);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err.message?.includes('invalid')) {
          return failureFromError('INVALID_PEER_ID', 'Invalid peer ID format', err);
        }
        throw error;
      }

      // P0-1 修复：使用 Promise.race 实现超时，并正确清理定时器
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('DHT lookup timeout')), timeout);
      });

      try {
        const peerInfo = await Promise.race([
          dht.findPeer(peerIdObj),
          timeoutPromise
        ]);

        if (!peerInfo || peerInfo.multiaddrs.length === 0) {
          return failureFromError('PEER_NOT_FOUND', `Peer ${peerIdStr.slice(0, 16)} not found in DHT`);
        }

        const addresses = peerInfo.multiaddrs.map(ma => ma.toString());
        this.emit('peer:found', { peerId: peerIdStr, addresses });
        
        return success(addresses);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (error) {
      this.logger.error('DHT find peer failed', { peerId: peerIdStr.slice(0, 16), error });
      return failureFromError('DHT_LOOKUP_FAILED', 'DHT lookup failed', error as Error);
    }
  }

  /**
   * 通过 DHT 发现节点（全局发现）
   * 
   * DHT 提供两种发现模式：
   * 1. 查找特定节点（需要知道 Peer ID）
   * 2. 发现随机节点（构建路由表）
   * 
   * @param options 发现选项
   * @returns 发现的节点地址列表
   */
  async discoverPeersViaDHT(options?: DHTDiscoverOptions): Promise<Result<string[]>> {
    if (!this.node) {
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not started');
    }

    const dht = (this.node.services as Libp2pServices).dht;
    if (!dht) {
      return failureFromError('DHT_NOT_AVAILABLE', 'DHT service not enabled');
    }

    const timeout = options?.timeout ?? 10000;

    try {
      const discoveredAddresses: string[] = [];

      if (options?.peerId) {
        // 查找特定节点
        const result = await this.findPeerViaDHT(options.peerId, timeout);
        if (result.success) {
          discoveredAddresses.push(...result.data);
        }
      } else {
        // 发现随机节点（通过路由表）
        this.logger.info('Discovering peers via DHT routing table');
        
        // 获取路由表中的节点
        const routingTableSize = dht.routingTable?.size || 0;
        this.logger.info('DHT routing table size', { size: routingTableSize });

        // libp2p DHT 会自动维护路由表
        // 我们可以通过连接到已知的节点来触发更多发现
        if (this.peerManager) {
          const knownPeers = this.peerManager.getConnectedPeers();
          this.logger.info('Known peers for DHT discovery', { count: knownPeers.length });
          
          // 返回当前已知的节点
          for (const peer of knownPeers) {
            if (peer.multiaddrs && Array.isArray(peer.multiaddrs)) {
              discoveredAddresses.push(...peer.multiaddrs.map(ma => ma.toString()));
            }
          }
        }
      }

      if (discoveredAddresses.length === 0) {
        return failureFromError('PEER_NOT_FOUND', 'No peers discovered via DHT');
      }

      this.emit('dht:discovery', { count: discoveredAddresses.length, addresses: discoveredAddresses });
      
      this.logger.info('DHT discovery complete', { 
        count: discoveredAddresses.length 
      });

      return success(discoveredAddresses);
    } catch (error) {
      this.logger.error('DHT discovery failed', { error });
      return failureFromError('DHT_LOOKUP_FAILED', 'DHT discovery failed', error as Error);
    }
  }

  /**
   * 向 DHT 注册自己（使其他节点能找到自己）
   * 
   * 注意：只有公网可达的节点才能作为 DHT 服务器
   * NAT 后的节点只能作为客户端
   */
  async registerToDHT(): Promise<Result<void>> {
    if (!this.node) {
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not started');
    }

    const dht = (this.node.services as Libp2pServices).dht;
    if (!dht) {
      return failureFromError('DHT_NOT_AVAILABLE', 'DHT service not enabled');
    }

    try {
      // DHT 会自动注册，这里主要是检查和日志
      const peerId = this.node.peerId.toString();
      const addresses = this.node.getMultiaddrs().map(ma => ma.toString());
      
      this.logger.info('DHT registration info', {
        peerId: peerId.slice(0, 16),
        addresses: addresses.length,
        isServer: this.dhtServerMode
      });

      this.emit('dht:registered');
      this.logger.info('Registered to DHT');
      
      return success(undefined);
    } catch (error) {
      this.logger.error('DHT registration failed', { error });
      return failureFromError('INTERNAL_ERROR', 'DHT registration failed', error as Error);
    }
  }

  /**
   * 连接到 Relay 服务器
   * @param relayAddress Relay 服务器地址（multiaddr 格式）
   * @returns 是否连接成功
   */
  async connectToRelay(relayAddress: string): Promise<boolean> {
    if (!this.natTraversalManager) {
      this.logger.warn('NAT traversal not enabled, cannot connect to relay');
      return false;
    }

    // 验证地址格式
    try {
      multiaddr(relayAddress); // 验证格式，无效则抛出异常
    } catch (error) {
      this.logger.error('Invalid relay address format', { relayAddress, error });
      return false;
    }

    try {
      const result = await this.natTraversalManager.connectToRelay(relayAddress);
      
      if (result) {
        this.emit('relay:connected', relayAddress);
        this.logger.info('Connected to relay', { relayAddress });
      }
      
      return result;
    } catch (error) {
      this.logger.error('Relay connection failed', { relayAddress, error });
      return false;
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
   * 检查 node 是否已初始化
   */
  isNodeInitialized(): boolean {
    return this.node !== null;
  }
}

export default DHTService;