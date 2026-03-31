/**
 * Peer 表管理器
 * 负责 Peer 路由表的维护、清理和查询
 * 
 * 从 p2p-network.ts 提取，实现单一职责原则
 */

import { multiaddr } from '@multiformats/multiaddr';
import type { Multiaddr } from '@multiformats/multiaddr';
import type { PeerInfo, AgentInfo } from '../types/index.js';
import { AsyncLock } from './async-lock.js';
import { Logger } from './logger.js';

// 清理配置常量
export const PEER_TABLE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟
export const PEER_TABLE_STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24小时
export const PEER_TABLE_MAX_SIZE = 1000; // 最大peer数
export const PEER_TABLE_HIGH_WATERMARK = 0.9; // 高水位线（90%触发主动清理）
export const PEER_TABLE_AGGRESSIVE_CLEANUP_THRESHOLD = 0.8; // 激进清理后保留的目标比例

/**
 * Peer 表管理器配置
 */
export interface PeerTableConfig {
  /** 最大 Peer 数量 */
  maxSize?: number;
  /** 清理间隔（毫秒） */
  cleanupInterval?: number;
  /** 过期阈值（毫秒） */
  staleThreshold?: number;
  /** 信任的 Peer 白名单 */
  trustedPeers?: Set<string>;
  /** 日志器 */
  logger?: Logger;
}

/**
 * Peer 表管理器
 * 
 * 功能：
 * - 维护 Peer 路由表（Map<string, PeerInfo>）
 * - 提供原子操作（使用 AsyncLock 保护）
 * - 定期清理过期条目
 * - 维护已连接 Peer 索引（用于 O(1) 查询）
 */
export class PeerTableManager {
  /** Peer 路由表 */
  private peerTable: Map<string, PeerInfo> = new Map();
  
  /** 已连接 Peer 索引 */
  private connectedPeers: Set<string> = new Set();
  
  /** 信任的 Peer 白名单 */
  private trustedPeers: Set<string> = new Set();
  
  /** 并发访问锁 */
  private lock = new AsyncLock();
  
  /** 清理定时器 */
  private cleanupInterval?: NodeJS.Timeout;
  
  /** 配置 */
  private config: {
    maxSize: number;
    cleanupIntervalMs: number;
    staleThresholdMs: number;
  };
  
  /** 日志器 */
  private logger: Logger;

  constructor(config: PeerTableConfig = {}) {
    this.config = {
      maxSize: config.maxSize || PEER_TABLE_MAX_SIZE,
      cleanupIntervalMs: config.cleanupInterval || PEER_TABLE_CLEANUP_INTERVAL,
      staleThresholdMs: config.staleThreshold || PEER_TABLE_STALE_THRESHOLD,
    };
    
    this.logger = config.logger || new Logger({ component: 'PeerTable' });
    
    // 初始化信任白名单
    if (config.trustedPeers) {
      config.trustedPeers.forEach(peerId => this.trustedPeers.add(peerId));
    }
  }

  /**
   * 启动定期清理任务
   */
  startCleanupTask(): void {
    // 立即执行一次
    this.cleanupStalePeers(false);

    // 定期清理
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePeers(false);
    }, this.config.cleanupIntervalMs);
  }

  /**
   * 停止清理任务
   */
  stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * 添加信任的 Peer
   */
  addTrustedPeer(peerId: string): void {
    this.trustedPeers.add(peerId);
  }

  /**
   * 检查是否为信任的 Peer
   */
  isTrusted(peerId: string): boolean {
    return this.trustedPeers.has(peerId);
  }

  /**
   * 获取锁
   */
  async acquireLock(timeoutMs?: number): Promise<void> {
    await this.lock.acquire(timeoutMs);
  }

  /**
   * 释放锁
   */
  releaseLock(): void {
    this.lock.release();
  }

  // ========== 原子操作 ==========

  /**
   * 原子操作：获取 peer 信息
   */
  getPeer(peerId: string): PeerInfo | undefined {
    return this.peerTable.get(peerId);
  }

  /**
   * 原子操作：设置 peer 信息
   */
  setPeer(peerId: string, info: PeerInfo): void {
    this.peerTable.set(peerId, info);
  }

  /**
   * 原子操作：检查 peer 是否存在
   */
  hasPeer(peerId: string): boolean {
    return this.peerTable.has(peerId);
  }

  /**
   * 原子操作：获取表大小
   */
  getSize(): number {
    return this.peerTable.size;
  }

  /**
   * 原子操作：更新 peer 信息（线程安全）
   * @param peerId Peer ID
   * @param updater 更新函数，接收当前值，返回新值
   * @returns 更新后的 peer 信息，如果 peer 不存在则返回 undefined
   */
  async updatePeer(
    peerId: string,
    updater: (peer: PeerInfo) => PeerInfo
  ): Promise<PeerInfo | undefined> {
    await this.lock.acquire();
    try {
      const peer = this.peerTable.get(peerId);
      if (!peer) return undefined;
      const updated = updater(peer);
      this.peerTable.set(peerId, updated);
      return updated;
    } finally {
      this.lock.release();
    }
  }

  /**
   * 原子操作：安全地更新或创建 peer
   * @param peerId Peer ID
   * @param creator 创建新 peer 的函数（如果不存在）
   * @param updater 更新函数（如果存在）
   */
  async upsertPeer(
    peerId: string,
    creator: () => PeerInfo,
    updater: (peer: PeerInfo) => PeerInfo
  ): Promise<PeerInfo> {
    await this.lock.acquire();
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
      this.lock.release();
    }
  }

  /**
   * 原子操作：删除 peer
   */
  async deletePeer(peerId: string): Promise<boolean> {
    await this.lock.acquire();
    try {
      return this.peerTable.delete(peerId);
    } finally {
      this.lock.release();
    }
  }

  // ========== 连接索引管理 ==========

  /**
   * 标记 Peer 为已连接
   */
  markConnected(peerId: string): void {
    this.connectedPeers.add(peerId);
  }

  /**
   * 标记 Peer 为已断开
   */
  markDisconnected(peerId: string): void {
    this.connectedPeers.delete(peerId);
  }

  /**
   * 检查 Peer 是否已连接
   */
  isConnected(peerId: string): boolean {
    return this.connectedPeers.has(peerId);
  }

  /**
   * 获取已连接的 Peers（O(1) 查询）
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
   * 获取已连接 Peer 数量
   */
  getConnectedCount(): number {
    return this.connectedPeers.size;
  }

  // ========== AgentInfo 更新 ==========

  /**
   * 从 AgentInfo 更新 Peer 表
   * P2-5 修复：async/await 模式
   */
  async upsertPeerFromAgentInfo(agentInfo: AgentInfo, peerId: string): Promise<void> {
    await this.lock.acquire();
    try {
      // 检查是否需要清理以腾出空间
      if (this.peerTable.size >= this.config.maxSize && !this.peerTable.has(peerId)) {
        this.cleanupStalePeersLocked(true);
      }

      const existing = this.peerTable.get(peerId);
      const now = Date.now();
      
      if (existing) {
        existing.agentInfo = agentInfo;
        existing.lastSeen = now;
        existing.multiaddrs = agentInfo.multiaddrs.map(ma => multiaddr(ma));
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
      this.lock.release();
    }
  }

  // ========== 清理逻辑 ==========

  /**
   * 清理过期的 Peer 记录（带锁保护）
   * @param aggressive 是否使用激进清理策略
   */
  async cleanupStalePeers(aggressive = false): Promise<void> {
    await this.lock.acquire();
    try {
      this.cleanupStalePeersLocked(aggressive);
    } finally {
      this.lock.release();
    }
  }

  /**
   * 清理过期的 Peer 记录（内部方法，调用前必须持有锁）
   * @param aggressive 是否使用激进清理策略
   */
  cleanupStalePeersLocked(aggressive = false): void {
    const now = Date.now();
    const threshold = aggressive ? 0 : this.config.staleThresholdMs;
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
      
      // 2. 如果仍然超过高水位线，按最后活跃时间排序后删除最旧的
      const highWatermark = Math.floor(this.config.maxSize * PEER_TABLE_HIGH_WATERMARK);
      if (this.peerTable.size > highWatermark) {
        const targetSize = Math.floor(this.config.maxSize * PEER_TABLE_AGGRESSIVE_CLEANUP_THRESHOLD);
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
        if (isTrusted(peerId)) {
          skippedTrusted++;
          continue;
        }
        
        const shouldClean = 
          now - peer.lastSeen > threshold ||
          (!peer.connected && now - peer.lastSeen > 60 * 60 * 1000);

        if (shouldClean) {
          this.peerTable.delete(peerId);
          cleaned++;
        }
      }
    }

    // 如果仍然超过最大容量，删除最旧的
    if (this.peerTable.size > this.config.maxSize) {
      const sorted = Array.from(this.peerTable.entries())
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen);

      const disconnected = sorted.filter(([peerId, _]) => !isTrusted(peerId) && !this.connectedPeers.has(peerId));
      const toRemove = disconnected.length > 0 
        ? disconnected.slice(0, this.peerTable.size - this.config.maxSize)
        : sorted.filter(([peerId, _]) => !isTrusted(peerId)).slice(0, this.peerTable.size - this.config.maxSize);
      
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

  // ========== 查询方法 ==========

  /**
   * 获取所有已知的 Peers
   */
  getAllPeers(): PeerInfo[] {
    return Array.from(this.peerTable.values());
  }

  /**
   * 获取 Peer 表快照（用于安全遍历）
   */
  async getSnapshot(): Promise<Map<string, PeerInfo>> {
    await this.lock.acquire();
    try {
      // 返回拷贝，避免并发修改
      return new Map(this.peerTable);
    } finally {
      this.lock.release();
    }
  }

  /**
   * 检查是否达到高水位线
   */
  isAtHighWatermark(): boolean {
    const highWatermark = Math.floor(this.config.maxSize * PEER_TABLE_HIGH_WATERMARK);
    return this.peerTable.size >= highWatermark;
  }

  /**
   * 检查是否已满
   */
  isFull(): boolean {
    return this.peerTable.size >= this.config.maxSize;
  }

  /**
   * 获取配置
   */
  getConfig(): { maxSize: number; cleanupIntervalMs: number; staleThresholdMs: number } {
    return { ...this.config };
  }
}

export default PeerTableManager;