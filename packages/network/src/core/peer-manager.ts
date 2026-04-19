/**
 * PeerManager - Peer 状态管理器
 * 
 * 负责：
 * - Peer 表状态维护 (peerTable, connectedPeers, trustedPeers)
 * - Peer 增删改查操作
 * - Peer 清理/过期处理
 * - Peer 信任白名单管理
 * 
 * Phase 2a+2b: 从 P2PNetwork 中提取为独立类
 */

import { EventEmitter } from 'eventemitter3';
import { AsyncLock } from '../utils/async-lock.js';
import { Logger } from '../utils/logger.js';
import type { PeerInfo, AgentInfo } from '../types/index.js';

export interface PeerManagerEvents {
  'peer:added': (peerInfo: PeerInfo) => void;
  'peer:updated': (peerInfo: PeerInfo) => void;
  'peer:removed': (peerId: string) => void;
  'peer:connected': (peerId: string) => void;
  'peer:disconnected': (peerId: string) => void;
}

export class PeerManager extends EventEmitter<PeerManagerEvents> {
  private peerTable: Map<string, PeerInfo> = new Map();
  private connectedPeers: Set<string> = new Set();
  private trustedPeers: Set<string> = new Set();
  private lock = new AsyncLock();
  private logger: Logger;

  constructor(trustedPeers?: string[]) {
    super();
    this.logger = new Logger({ component: 'PeerManager' });
    if (trustedPeers) {
      trustedPeers.forEach(p => this.trustedPeers.add(p));
    }
  }

  // 同步查询方法（不需要锁）
  get(peerId: string): PeerInfo | undefined {
    return this.peerTable.get(peerId);
  }

  list(): PeerInfo[] {
    return Array.from(this.peerTable.values());
  }

  getConnected(): string[] {
    return Array.from(this.connectedPeers);
  }

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

  isConnected(peerId: string): boolean {
    return this.connectedPeers.has(peerId);
  }

  isTrusted(peerId: string): boolean {
    return this.trustedPeers.has(peerId);
  }

  addTrusted(peerId: string): void {
    this.trustedPeers.add(peerId);
  }

  size(): number {
    return this.peerTable.size;
  }

  // 异步修改方法（需要锁）
  async upsert(peerId: string, info: Partial<PeerInfo>): Promise<void> {
    await this.lock.acquire();
    try {
      const existing = this.peerTable.get(peerId);
      // 如果 info 中没有显式设置 lastSeen，则使用当前时间
      const lastSeen = info.lastSeen ?? Date.now();
      const updated = { ...existing, ...info, peerId, lastSeen } as PeerInfo;
      this.peerTable.set(peerId, updated);
      this.emit(existing ? 'peer:updated' : 'peer:added', updated);
    } finally {
      this.lock.release();
    }
  }

  async upsertFromAgentInfo(agentInfo: AgentInfo, peerId: string): Promise<void> {
    await this.upsert(peerId, {
      agentInfo,
      lastSeen: Date.now(),
    });
  }

  async delete(peerId: string): Promise<boolean> {
    await this.lock.acquire();
    try {
      const existed = this.peerTable.delete(peerId);
      this.connectedPeers.delete(peerId);
      if (existed) {
        this.emit('peer:removed', peerId);
      }
      return existed;
    } finally {
      this.lock.release();
    }
  }

  setConnected(peerId: string): void {
    this.connectedPeers.add(peerId);
    this.emit('peer:connected', peerId);
  }

  setDisconnected(peerId: string): void {
    this.connectedPeers.delete(peerId);
    this.emit('peer:disconnected', peerId);
  }

  /**
   * 清理过期的 Peer 记录
   * @param options 清理选项
   * @returns 清理的 Peer 数量及相关统计
   */
  async cleanupStale(options?: {
    /** 过期阈值（毫秒，默认 24小时） */
    staleThreshold?: number;
    /** 未连接 Peer 过期阈值（毫秒，默认 1小时） */
    disconnectedThreshold?: number;
    /** 是否使用激进清理（清理更多条目） */
    aggressive?: boolean;
    /** 最大 Peer 数 */
    maxSize?: number;
    /** 高水位线比例（默认 0.9） */
    highWatermark?: number;
    /** 激进清理目标比例（默认 0.8） */
    aggressiveTarget?: number;
  }): Promise<{ removed: number; skippedTrusted: number; remaining: number }> {
    const staleThreshold = options?.staleThreshold ?? 24 * 60 * 60 * 1000;
    const disconnectedThreshold = options?.disconnectedThreshold ?? 60 * 60 * 1000;
    const aggressive = options?.aggressive ?? false;
    const maxSize = options?.maxSize ?? 1000;
    const highWatermark = options?.highWatermark ?? 0.9;
    const aggressiveTarget = options?.aggressiveTarget ?? 0.8;

    await this.lock.acquire();
    try {
      const now = Date.now();
      let removed = 0;
      let skippedTrusted = 0;

      // 激进清理：清理更多类型的条目（包括连接的 stale peers）
      if (aggressive) {
        // 1. 清理所有超过阈值的 peer（跳过白名单，包括连接的 stale peers）
        for (const [peerId, peer] of this.peerTable) {
          if (this.trustedPeers.has(peerId)) {
            skippedTrusted++;
            continue;
          }
          // 激进模式下，连接的 stale peers 也清理（使用 staleThreshold）
          if (now - peer.lastSeen > staleThreshold) {
            this.peerTable.delete(peerId);
            this.connectedPeers.delete(peerId);
            this.emit('peer:removed', peerId);
            removed++;
          }
        }
        
        // 2. 如果仍然超过高水位线，按最后活跃时间排序后删除最旧的
        const highWatermarkSize = Math.floor(maxSize * highWatermark);
        if (this.peerTable.size > highWatermarkSize) {
          const targetSize = Math.floor(maxSize * aggressiveTarget);
          const sorted = Array.from(this.peerTable.entries())
            .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
          
          // 优先删除未连接的 peer（跳过白名单）
          const toRemove = sorted
            .filter(([peerId, peer]) => !this.trustedPeers.has(peerId) && !peer.connected)
            .slice(0, this.peerTable.size - targetSize);
          
          for (const [peerId] of toRemove) {
            this.peerTable.delete(peerId);
            this.connectedPeers.delete(peerId);
            this.emit('peer:removed', peerId);
            removed++;
          }
        }
      } else {
        // 常规清理：清理过期条目（跳过白名单，保留连接的 peers）
        for (const [peerId, peer] of this.peerTable) {
          if (this.trustedPeers.has(peerId)) {
            skippedTrusted++;
            continue;
          }
          
          // 非激进模式下，连接的 peers 不清理
          if (peer.connected) continue;
          
          // 清理条件：未连接且超过阈值
          const shouldClean = 
            now - peer.lastSeen > staleThreshold ||
            now - peer.lastSeen > disconnectedThreshold;

          if (shouldClean) {
            this.peerTable.delete(peerId);
            this.connectedPeers.delete(peerId);
            this.emit('peer:removed', peerId);
            removed++;
          }
        }
      }

      // 如果仍然超过最大容量，按最后活跃时间排序后删除最旧的
      if (this.peerTable.size > maxSize) {
        const sorted = Array.from(this.peerTable.entries())
          .sort((a, b) => a[1].lastSeen - b[1].lastSeen);

        // 优先删除未连接的 peer（跳过白名单）
        const disconnected = sorted.filter(([peerId, _]) => 
          !this.trustedPeers.has(peerId) && !this.connectedPeers.has(peerId));
        const toRemove = disconnected.length > 0 
          ? disconnected.slice(0, this.peerTable.size - maxSize)
          : sorted.filter(([peerId, _]) => !this.trustedPeers.has(peerId))
            .slice(0, this.peerTable.size - maxSize);
        
        for (const [peerId] of toRemove) {
          this.peerTable.delete(peerId);
          this.connectedPeers.delete(peerId);
          this.emit('peer:removed', peerId);
          removed++;
        }
      }

      return { 
        removed, 
        skippedTrusted, 
        remaining: this.peerTable.size 
      };
    } finally {
      this.lock.release();
    }
  }

  /**
   * 简化版清理（用于快速清理）
   * @param maxAgeMs 过期阈值
   * @param aggressive 是否清理连接的 peers
   */
  async cleanupStaleSimple(maxAgeMs: number = 5 * 60 * 1000, aggressive = false): Promise<number> {
    await this.lock.acquire();
    try {
      const now = Date.now();
      let removed = 0;
      for (const [peerId, info] of this.peerTable) {
        if (this.trustedPeers.has(peerId)) continue;
        if (this.connectedPeers.has(peerId) && !aggressive) continue;
        
        if (now - info.lastSeen > maxAgeMs) {
          this.peerTable.delete(peerId);
          this.connectedPeers.delete(peerId);
          this.emit('peer:removed', peerId);
          removed++;
        }
      }
      return removed;
    } finally {
      this.lock.release();
    }
  }

  /**
   * 获取 Peer 表引用（用于 AgentIdentityVerifier 等需要直接访问的场景）
   * 注意：直接访问可能不安全，应优先使用 PeerManager 的方法
   */
  getPeerTable(): Map<string, PeerInfo> {
    return this.peerTable;
  }

  /**
   * 获取已连接 Peers Set 引用
   */
  getConnectedPeersSet(): Set<string> {
    return this.connectedPeers;
  }

  /**
   * 获取信任 Peers Set 引用
   */
  getTrustedPeersSet(): Set<string> {
    return this.trustedPeers;
  }
}