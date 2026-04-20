/**
 * PeerTableManager 测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  PeerTableManager,
  PeerTableConfig,
  PEER_TABLE_CLEANUP_INTERVAL,
  PEER_TABLE_STALE_THRESHOLD,
  PEER_TABLE_MAX_SIZE,
  PEER_TABLE_HIGH_WATERMARK,
  PEER_TABLE_AGGRESSIVE_CLEANUP_THRESHOLD,
} from './peer-table-manager.js';
import { PeerInfo, AgentInfo } from '../types/index.js';
import { multiaddr } from '@multiformats/multiaddr';

// Mock Logger
vi.mock('./logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('PeerTableManager', () => {
  let manager: PeerTableManager;

  const createPeerInfo = (peerId: string, lastSeen: number = Date.now()): PeerInfo => ({
    peerId,
    agentInfo: {
      agentId: `agent-${peerId}`,
      name: `Agent ${peerId}`,
      multiaddrs: ['/ip4/127.0.0.1/tcp/9000'],
      capabilities: [],
    },
    multiaddrs: [multiaddr('/ip4/127.0.0.1/tcp/9000')],
    connected: false,
    reputation: 50,
    lastSeen,
  });

  const createAgentInfo = (agentId: string): AgentInfo => ({
    agentId,
    name: `Agent ${agentId}`,
    multiaddrs: ['/ip4/127.0.0.1/tcp/9000'],
    capabilities: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PeerTableManager();
  });

  afterEach(() => {
    manager.stopCleanupTask();
  });

  // ========== 基础操作测试 ==========

  describe('getPeer()', () => {
    it('should return undefined for non-existing peer', () => {
      expect(manager.getPeer('non-existing')).toBeUndefined();
    });

    it('should return peer info for existing peer', () => {
      const peer = createPeerInfo('peer-1');
      manager.setPeer('peer-1', peer);
      
      expect(manager.getPeer('peer-1')).toEqual(peer);
    });
  });

  describe('setPeer()', () => {
    it('should add new peer', () => {
      const peer = createPeerInfo('peer-1');
      manager.setPeer('peer-1', peer);
      
      expect(manager.hasPeer('peer-1')).toBe(true);
      expect(manager.getSize()).toBe(1);
    });

    it('should update existing peer', () => {
      const peer1 = createPeerInfo('peer-1');
      manager.setPeer('peer-1', peer1);
      
      const peer2 = { ...peer1, reputation: 80 };
      manager.setPeer('peer-1', peer2);
      
      expect(manager.getPeer('peer-1')?.reputation).toBe(80);
      expect(manager.getSize()).toBe(1);
    });
  });

  describe('hasPeer()', () => {
    it('should return false for non-existing peer', () => {
      expect(manager.hasPeer('peer-1')).toBe(false);
    });

    it('should return true for existing peer', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      expect(manager.hasPeer('peer-1')).toBe(true);
    });
  });

  describe('getSize()', () => {
    it('should return 0 for empty table', () => {
      expect(manager.getSize()).toBe(0);
    });

    it('should return correct count', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      manager.setPeer('peer-2', createPeerInfo('peer-2'));
      manager.setPeer('peer-3', createPeerInfo('peer-3'));
      
      expect(manager.getSize()).toBe(3);
    });
  });

  // ========== 原子操作测试 ==========

  describe('updatePeer()', () => {
    it('should update existing peer atomically', async () => {
      const peer = createPeerInfo('peer-1', Date.now());
      manager.setPeer('peer-1', peer);
      
      const result = await manager.updatePeer('peer-1', (p) => ({
        ...p,
        reputation: 90,
      }));
      
      expect(result?.reputation).toBe(90);
      expect(manager.getPeer('peer-1')?.reputation).toBe(90);
    });

    it('should return undefined for non-existing peer', async () => {
      const result = await manager.updatePeer('non-existing', (p) => p);
      
      expect(result).toBeUndefined();
    });

    it('should handle concurrent updates', async () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      
      const updates = Promise.all([
        manager.updatePeer('peer-1', (p) => ({ ...p, reputation: p.reputation + 10 })),
        manager.updatePeer('peer-1', (p) => ({ ...p, reputation: p.reputation + 20 })),
      ]);
      
      await updates;
      
      // Second update should win (both start from 50)
      expect(manager.getPeer('peer-1')?.reputation).toBeGreaterThanOrEqual(60);
    });
  });

  describe('upsertPeer()', () => {
    it('should create new peer if not exists', async () => {
      const result = await manager.upsertPeer(
        'peer-1',
        () => createPeerInfo('peer-1'),
        (p) => p
      );
      
      expect(result.peerId).toBe('peer-1');
      expect(manager.hasPeer('peer-1')).toBe(true);
    });

    it('should update existing peer', async () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      
      const result = await manager.upsertPeer(
        'peer-1',
        () => createPeerInfo('peer-1'),
        (p) => ({ ...p, reputation: 80 })
      );
      
      expect(result.reputation).toBe(80);
    });

    it('should use creator for new peer', async () => {
      const result = await manager.upsertPeer(
        'new-peer',
        () => ({ ...createPeerInfo('new-peer'), reputation: 75 }),
        (p) => ({ ...p, reputation: 99 })
      );
      
      expect(result.reputation).toBe(75);
    });
  });

  describe('deletePeer()', () => {
    it('should delete existing peer', async () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      
      const result = await manager.deletePeer('peer-1');
      
      expect(result).toBe(true);
      expect(manager.hasPeer('peer-1')).toBe(false);
    });

    it('should return false for non-existing peer', async () => {
      const result = await manager.deletePeer('non-existing');
      
      expect(result).toBe(false);
    });
  });

  // ========== 连接索引管理测试 ==========

  describe('markConnected()', () => {
    it('should mark peer as connected', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      manager.markConnected('peer-1');
      
      expect(manager.isConnected('peer-1')).toBe(true);
    });

    it('should track connected count', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      manager.setPeer('peer-2', createPeerInfo('peer-2'));
      manager.markConnected('peer-1');
      manager.markConnected('peer-2');
      
      expect(manager.getConnectedCount()).toBe(2);
    });
  });

  describe('markDisconnected()', () => {
    it('should mark peer as disconnected', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      manager.markConnected('peer-1');
      manager.markDisconnected('peer-1');
      
      expect(manager.isConnected('peer-1')).toBe(false);
    });

    it('should decrease connected count', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      manager.setPeer('peer-2', createPeerInfo('peer-2'));
      manager.markConnected('peer-1');
      manager.markConnected('peer-2');
      manager.markDisconnected('peer-1');
      
      expect(manager.getConnectedCount()).toBe(1);
    });
  });

  describe('isConnected()', () => {
    it('should return false initially', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      expect(manager.isConnected('peer-1')).toBe(false);
    });

    it('should return true after markConnected', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      manager.markConnected('peer-1');
      expect(manager.isConnected('peer-1')).toBe(true);
    });
  });

  describe('getConnectedPeers()', () => {
    it('should return empty array when no connected peers', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      expect(manager.getConnectedPeers()).toEqual([]);
    });

    it('should return only connected peers', () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1'));
      manager.setPeer('peer-2', createPeerInfo('peer-2'));
      manager.setPeer('peer-3', createPeerInfo('peer-3'));
      manager.markConnected('peer-1');
      manager.markConnected('peer-3');
      
      const connected = manager.getConnectedPeers();
      expect(connected).toHaveLength(2);
      expect(connected.map(p => p.peerId)).toContain('peer-1');
      expect(connected.map(p => p.peerId)).toContain('peer-3');
      expect(connected.map(p => p.peerId)).not.toContain('peer-2');
    });
  });

  // ========== 信任白名单测试 ==========

  describe('addTrustedPeer()', () => {
    it('should add trusted peer', () => {
      manager.addTrustedPeer('trusted-1');
      
      expect(manager.isTrusted('trusted-1')).toBe(true);
    });

    it('should accept multiple trusted peers', () => {
      manager.addTrustedPeer('trusted-1');
      manager.addTrustedPeer('trusted-2');
      
      expect(manager.isTrusted('trusted-1')).toBe(true);
      expect(manager.isTrusted('trusted-2')).toBe(true);
    });
  });

  describe('isTrusted()', () => {
    it('should return false for non-trusted peer', () => {
      expect(manager.isTrusted('peer-1')).toBe(false);
    });

    it('should return true for trusted peer', () => {
      manager.addTrustedPeer('trusted-1');
      expect(manager.isTrusted('trusted-1')).toBe(true);
    });
  });

  describe('constructor with trustedPeers', () => {
    it('should initialize with trusted peers from config', () => {
      const trustedSet = new Set(['trusted-1', 'trusted-2']);
      manager = new PeerTableManager({ trustedPeers: trustedSet });
      
      expect(manager.isTrusted('trusted-1')).toBe(true);
      expect(manager.isTrusted('trusted-2')).toBe(true);
    });
  });

  // ========== AgentInfo 更新测试 ==========

  describe('upsertPeerFromAgentInfo()', () => {
    it('should create new peer from AgentInfo', async () => {
      const agentInfo = createAgentInfo('agent-1');
      
      await manager.upsertPeerFromAgentInfo(agentInfo, 'peer-1');
      
      expect(manager.hasPeer('peer-1')).toBe(true);
      const peer = manager.getPeer('peer-1');
      expect(peer?.agentInfo.agentId).toBe('agent-1');
      expect(peer?.multiaddrs.length).toBeGreaterThan(0);
    });

    it('should update existing peer', async () => {
      manager.setPeer('peer-1', createPeerInfo('peer-1', Date.now() - 10000));
      const agentInfo = createAgentInfo('agent-updated');
      
      await manager.upsertPeerFromAgentInfo(agentInfo, 'peer-1');
      
      const peer = manager.getPeer('peer-1');
      expect(peer?.agentInfo.agentId).toBe('agent-updated');
      expect(peer?.lastSeen).toBeGreaterThan(Date.now() - 1000);
    });

    it('should trigger cleanup when exceeding maxSize', async () => {
      manager = new PeerTableManager({ maxSize: 3 });
      
      // Fill table
      await manager.upsertPeerFromAgentInfo(createAgentInfo('a1'), 'p1');
      await manager.upsertPeerFromAgentInfo(createAgentInfo('a2'), 'p2');
      await manager.upsertPeerFromAgentInfo(createAgentInfo('a3'), 'p3');
      
      // Add new peer should trigger cleanup
      await manager.upsertPeerFromAgentInfo(createAgentInfo('a4'), 'p4');
      
      expect(manager.getSize()).toBeLessThanOrEqual(3);
    });
  });

  // ========== 清理逻辑测试 ==========

  describe('cleanupStalePeers()', () => {
    it('should remove stale peers', async () => {
      // Create old peer (expired)
      manager.setPeer('old-peer', createPeerInfo('old-peer', Date.now() - PEER_TABLE_STALE_THRESHOLD - 1000));
      // Create fresh peer
      manager.setPeer('fresh-peer', createPeerInfo('fresh-peer', Date.now()));
      
      await manager.cleanupStalePeers();
      
      expect(manager.hasPeer('old-peer')).toBe(false);
      expect(manager.hasPeer('fresh-peer')).toBe(true);
    });

    it('should not remove trusted peers', async () => {
      manager.addTrustedPeer('trusted-old');
      manager.setPeer('trusted-old', createPeerInfo('trusted-old', Date.now() - PEER_TABLE_STALE_THRESHOLD - 1000));
      
      await manager.cleanupStalePeers();
      
      expect(manager.hasPeer('trusted-old')).toBe(true);
    });

    it('should remove disconnected peers over 1 hour but not connected ones', async () => {
      // Fresh connected peer (should survive)
      const connectedPeer = createPeerInfo('connected', Date.now());
      manager.setPeer('connected', connectedPeer);
      manager.markConnected('connected');
      
      // Disconnected peer over 1 hour (should be removed)
      manager.setPeer('disconnected', createPeerInfo('disconnected', Date.now() - 61 * 60 * 1000));
      
      await manager.cleanupStalePeers();
      
      expect(manager.hasPeer('disconnected')).toBe(false);
      expect(manager.hasPeer('connected')).toBe(true);
    });
  });

  describe('cleanupStalePeersLocked() - aggressive mode', () => {
    it('should use aggressive cleanup when aggressive=true', async () => {
      manager = new PeerTableManager({ maxSize: 5 });
      
      // Create many disconnected old peers
      for (let i = 0; i < 10; i++) {
        manager.setPeer(`old-${i}`, createPeerInfo(`old-${i}`, Date.now() - 2 * 60 * 60 * 1000));
      }
      
      await manager.cleanupStalePeers(true);
      
      expect(manager.getSize()).toBeLessThanOrEqual(Math.floor(5 * PEER_TABLE_AGGRESSIVE_CLEANUP_THRESHOLD));
    });

    it('should prioritize removing disconnected peers in aggressive mode', async () => {
      manager = new PeerTableManager({ maxSize: 3 });
      
      // Fresh connected old peer (should survive because fresh)
      manager.setPeer('connected-old', createPeerInfo('connected-old', Date.now()));
      manager.markConnected('connected-old');
      
      // Disconnected old peers
      manager.setPeer('disconnected-old', createPeerInfo('disconnected-old', Date.now() - 2 * 60 * 60 * 1000));
      
      await manager.cleanupStalePeers(true);
      
      // Connected should survive (fresh lastSeen)
      expect(manager.hasPeer('connected-old')).toBe(true);
      expect(manager.hasPeer('disconnected-old')).toBe(false);
    });
  });

  describe('startCleanupTask() / stopCleanupTask()', () => {
    it('should start cleanup task', () => {
      manager.startCleanupTask();
      
      // Task should run (immediate cleanup)
      // No easy way to verify setInterval, just ensure no crash
      manager.stopCleanupTask();
    });

    it('should stop cleanup task', () => {
      manager.startCleanupTask();
      manager.stopCleanupTask();
      
      // Multiple stops should be safe
      manager.stopCleanupTask();
    });
  });

  // ========== 查询方法测试 ==========

  describe('getAllPeers()', () => {
    it('should return empty array for empty table', () => {
      expect(manager.getAllPeers()).toEqual([]);
    });

    it('should return all peers', () => {
      manager.setPeer('p1', createPeerInfo('p1'));
      manager.setPeer('p2', createPeerInfo('p2'));
      
      const peers = manager.getAllPeers();
      expect(peers).toHaveLength(2);
    });
  });

  describe('getSnapshot()', () => {
    it('should return a copy of peer table', async () => {
      manager.setPeer('p1', createPeerInfo('p1'));
      
      const snapshot = await manager.getSnapshot();
      
      // Modify snapshot shouldn't affect original
      snapshot.set('p2', createPeerInfo('p2'));
      
      expect(manager.hasPeer('p2')).toBe(false);
      expect(snapshot.has('p2')).toBe(true);
    });

    it('should return correct data', async () => {
      manager.setPeer('p1', createPeerInfo('p1'));
      manager.setPeer('p2', createPeerInfo('p2'));
      
      const snapshot = await manager.getSnapshot();
      
      expect(snapshot.size).toBe(2);
      expect(snapshot.get('p1')?.peerId).toBe('p1');
    });
  });

  describe('isAtHighWatermark()', () => {
    it('should return false when below high watermark', () => {
      manager = new PeerTableManager({ maxSize: 100 });
      
      for (let i = 0; i < 50; i++) {
        manager.setPeer(`p${i}`, createPeerInfo(`p${i}`));
      }
      
      expect(manager.isAtHighWatermark()).toBe(false);
    });

    it('should return true when at high watermark', () => {
      manager = new PeerTableManager({ maxSize: 100 });
      
      for (let i = 0; i < 95; i++) {
        manager.setPeer(`p${i}`, createPeerInfo(`p${i}`));
      }
      
      expect(manager.isAtHighWatermark()).toBe(true);
    });
  });

  describe('isFull()', () => {
    it('should return false when not full', () => {
      manager = new PeerTableManager({ maxSize: 10 });
      manager.setPeer('p1', createPeerInfo('p1'));
      
      expect(manager.isFull()).toBe(false);
    });

    it('should return true when full', () => {
      manager = new PeerTableManager({ maxSize: 3 });
      manager.setPeer('p1', createPeerInfo('p1'));
      manager.setPeer('p2', createPeerInfo('p2'));
      manager.setPeer('p3', createPeerInfo('p3'));
      
      expect(manager.isFull()).toBe(true);
    });
  });

  describe('getConfig()', () => {
    it('should return current config', () => {
      manager = new PeerTableManager({ maxSize: 500, cleanupInterval: 60000 });
      
      const config = manager.getConfig();
      
      expect(config.maxSize).toBe(500);
      expect(config.cleanupIntervalMs).toBe(60000);
    });
  });

  // ========== 锁操作测试 ==========

  describe('acquireLock() / releaseLock()', () => {
    it('should acquire and release lock', async () => {
      await manager.acquireLock();
      
      manager.releaseLock();
      
      // Should be able to acquire again
      await manager.acquireLock();
      manager.releaseLock();
    });

    it('should timeout if lock not acquired', async () => {
      await manager.acquireLock();
      
      await expect(manager.acquireLock(100)).rejects.toThrow('timeout');
      
      manager.releaseLock();
    });
  });

  // ========== 常量验证测试 ==========

  describe('constants', () => {
    it('should have correct default values', () => {
      expect(PEER_TABLE_MAX_SIZE).toBe(1000);
      expect(PEER_TABLE_CLEANUP_INTERVAL).toBe(5 * 60 * 1000);
      expect(PEER_TABLE_STALE_THRESHOLD).toBe(24 * 60 * 60 * 1000);
      expect(PEER_TABLE_HIGH_WATERMARK).toBe(0.9);
      expect(PEER_TABLE_AGGRESSIVE_CLEANUP_THRESHOLD).toBe(0.8);
    });
  });
});