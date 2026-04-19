/**
 * PeerManager 测试
 * Phase 2a+2b: 测试 PeerManager 的核心功能
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PeerManager } from './peer-manager.js';
import type { PeerInfo, AgentInfo } from '../types/index.js';
import { multiaddr } from '@multiformats/multiaddr';

describe('PeerManager', () => {
  let manager: PeerManager;

  beforeEach(() => {
    manager = new PeerManager();
  });

  describe('basic operations', () => {
    it('should get/list peers', async () => {
      await manager.upsert('peer1', { reputation: 100, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      expect(manager.get('peer1')?.reputation).toBe(100);
      expect(manager.list()).toHaveLength(1);
    });

    it('should return undefined for unknown peer', () => {
      expect(manager.get('unknown')).toBeUndefined();
    });

    it('should return empty list initially', () => {
      expect(manager.list()).toHaveLength(0);
    });

    it('should return correct size', async () => {
      expect(manager.size()).toBe(0);
      await manager.upsert('peer1', { reputation: 50, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      expect(manager.size()).toBe(1);
      await manager.upsert('peer2', { reputation: 60, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      expect(manager.size()).toBe(2);
    });
  });

  describe('connected peers', () => {
    it('should get connected peers', () => {
      manager.setConnected('peer1');
      expect(manager.isConnected('peer1')).toBe(true);
      expect(manager.getConnected()).toContain('peer1');
    });

    it('should return false for disconnected peer', () => {
      expect(manager.isConnected('peer1')).toBe(false);
    });

    it('should track multiple connected peers', () => {
      manager.setConnected('peer1');
      manager.setConnected('peer2');
      expect(manager.getConnected()).toHaveLength(2);
      expect(manager.getConnected()).toContain('peer1');
      expect(manager.getConnected()).toContain('peer2');
    });

    it('should set peer disconnected', () => {
      manager.setConnected('peer1');
      manager.setDisconnected('peer1');
      expect(manager.isConnected('peer1')).toBe(false);
      expect(manager.getConnected()).not.toContain('peer1');
    });
  });

  describe('trusted peers', () => {
    it('should manage trusted peers from constructor', () => {
      const trustedManager = new PeerManager(['trusted1', 'trusted2']);
      expect(trustedManager.isTrusted('trusted1')).toBe(true);
      expect(trustedManager.isTrusted('trusted2')).toBe(true);
      expect(trustedManager.isTrusted('unknown')).toBe(false);
    });

    it('should add trusted peers', () => {
      manager.addTrusted('peer1');
      expect(manager.isTrusted('peer1')).toBe(true);
    });

    it('should return false for untrusted peer', () => {
      expect(manager.isTrusted('peer1')).toBe(false);
    });
  });

  describe('delete operations', () => {
    it('should delete peers', async () => {
      await manager.upsert('peer1', { reputation: 50, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      const deleted = await manager.delete('peer1');
      expect(deleted).toBe(true);
      expect(manager.get('peer1')).toBeUndefined();
    });

    it('should return false when deleting non-existent peer', async () => {
      const deleted = await manager.delete('unknown');
      expect(deleted).toBe(false);
    });

    it('should remove from connected set when deleting', async () => {
      await manager.upsert('peer1', { reputation: 50, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      manager.setConnected('peer1');
      await manager.delete('peer1');
      expect(manager.isConnected('peer1')).toBe(false);
    });
  });

  describe('cleanup stale peers', () => {
    it('should cleanup stale peers', async () => {
      // Create stale peer, lastSeen 10 minutes ago
      const staleTime = Date.now() - 10 * 60 * 1000;
      await manager.upsert('peer1', { reputation: 50, connected: false, lastSeen: staleTime, multiaddrs: [] } as Partial<PeerInfo>);
      
      // Create fresh peer
      await manager.upsert('peer2', { reputation: 60, connected: false, lastSeen: Date.now(), multiaddrs: [] } as Partial<PeerInfo>);
      
      const result = await manager.cleanupStale({ staleThreshold: 5 * 60 * 1000 });
      expect(result.removed).toBe(1); // only peer1
      expect(manager.get('peer1')).toBeUndefined();
      expect(manager.get('peer2')).toBeDefined();
    });

    it('should preserve trusted peers during cleanup', async () => {
      manager.addTrusted('peer3');
      
      // Create stale trusted peer
      const staleTime = Date.now() - 10 * 60 * 1000;
      await manager.upsert('peer3', { reputation: 50, connected: false, lastSeen: staleTime, multiaddrs: [] } as Partial<PeerInfo>);
      
      // Create stale untrusted peer
      await manager.upsert('peer1', { reputation: 50, connected: false, lastSeen: staleTime, multiaddrs: [] } as Partial<PeerInfo>);
      
      const result = await manager.cleanupStale({ staleThreshold: 5 * 60 * 1000 });
      expect(result.removed).toBe(1); // only peer1
      expect(manager.get('peer3')).toBeDefined(); // trusted stays
    });

    it('should preserve connected peers during non-aggressive cleanup', async () => {
      const staleTime = Date.now() - 10 * 60 * 1000;
      
      // Create stale connected peer
      await manager.upsert('peer1', { reputation: 50, connected: true, lastSeen: staleTime, multiaddrs: [] } as Partial<PeerInfo>);
      manager.setConnected('peer1');
      
      // Create stale disconnected peer
      await manager.upsert('peer2', { reputation: 50, connected: false, lastSeen: staleTime, multiaddrs: [] } as Partial<PeerInfo>);
      
      const result = await manager.cleanupStale({ staleThreshold: 5 * 60 * 1000, disconnectedThreshold: 5 * 60 * 1000 });
      expect(result.removed).toBe(1); // only peer2
      expect(manager.get('peer1')).toBeDefined(); // connected stays
    });

    it('should cleanup connected peers in aggressive mode', async () => {
      const staleTime = Date.now() - 10 * 60 * 1000;
      // Create stale connected peer
      await manager.upsert('peer1', { reputation: 50, connected: true, lastSeen: staleTime, multiaddrs: [] } as Partial<PeerInfo>);
      manager.setConnected('peer1');
      
      const result = await manager.cleanupStale({ staleThreshold: 5 * 60 * 1000, aggressive: true });
      expect(result.removed).toBe(1); // aggressive removes connected too
      expect(manager.get('peer1')).toBeUndefined();
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent upsert on same peer', async () => {
      const promises = [
        manager.upsert('peer1', { reputation: 10, connected: false, multiaddrs: [] } as Partial<PeerInfo>),
        manager.upsert('peer1', { reputation: 20, connected: false, multiaddrs: [] } as Partial<PeerInfo>),
        manager.upsert('peer1', { reputation: 30, connected: false, multiaddrs: [] } as Partial<PeerInfo>),
      ];
      await Promise.all(promises);
      expect(manager.get('peer1')).toBeDefined();
      expect(manager.size()).toBe(1);
    });

    it('should handle concurrent upsert on different peers', async () => {
      const promises = [
        manager.upsert('peer1', { reputation: 10, connected: false, multiaddrs: [] } as Partial<PeerInfo>),
        manager.upsert('peer2', { reputation: 20, connected: false, multiaddrs: [] } as Partial<PeerInfo>),
        manager.upsert('peer3', { reputation: 30, connected: false, multiaddrs: [] } as Partial<PeerInfo>),
      ];
      await Promise.all(promises);
      expect(manager.size()).toBe(3);
    });
  });

  describe('events', () => {
    it('should emit peer:added event', async () => {
      let emitted = false;
      let emittedPeer: PeerInfo | undefined;
      manager.on('peer:added', (peer) => {
        emitted = true;
        emittedPeer = peer;
      });
      
      await manager.upsert('peer1', { reputation: 50, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      
      expect(emitted).toBe(true);
      expect(emittedPeer?.peerId).toBe('peer1');
    });

    it('should emit peer:updated event', async () => {
      await manager.upsert('peer1', { reputation: 50, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      
      let emitted = false;
      manager.on('peer:updated', () => {
        emitted = true;
      });
      
      await manager.upsert('peer1', { reputation: 60, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      
      expect(emitted).toBe(true);
    });

    it('should emit peer:removed event', async () => {
      await manager.upsert('peer1', { reputation: 50, connected: false, multiaddrs: [] } as Partial<PeerInfo>);
      
      let emitted = false;
      let emittedPeerId: string | undefined;
      manager.on('peer:removed', (peerId) => {
        emitted = true;
        emittedPeerId = peerId;
      });
      
      await manager.delete('peer1');
      
      expect(emitted).toBe(true);
      expect(emittedPeerId).toBe('peer1');
    });

    it('should emit peer:connected event', () => {
      let emitted = false;
      let emittedPeerId: string | undefined;
      manager.on('peer:connected', (peerId) => {
        emitted = true;
        emittedPeerId = peerId;
      });
      
      manager.setConnected('peer1');
      
      expect(emitted).toBe(true);
      expect(emittedPeerId).toBe('peer1');
    });

    it('should emit peer:disconnected event', () => {
      manager.setConnected('peer1');
      
      let emitted = false;
      let emittedPeerId: string | undefined;
      manager.on('peer:disconnected', (peerId) => {
        emitted = true;
        emittedPeerId = peerId;
      });
      
      manager.setDisconnected('peer1');
      
      expect(emitted).toBe(true);
      expect(emittedPeerId).toBe('peer1');
    });
  });

  describe('upsertFromAgentInfo', () => {
    it('should create peer from AgentInfo', async () => {
      const agentInfo: AgentInfo = {
        peerId: 'peer1',
        agentType: 'openclaw',
        version: '1.0.0',
        capabilities: [],
        protocolVersion: '1.0',
        lastSeen: Date.now(),
        multiaddrs: [],
      };
      
      await manager.upsertFromAgentInfo(agentInfo, 'peer1');
      
      const peer = manager.get('peer1');
      expect(peer).toBeDefined();
      expect(peer?.agentInfo).toEqual(agentInfo);
    });

    it('should update existing peer from AgentInfo', async () => {
      const agentInfo1: AgentInfo = {
        peerId: 'peer1',
        agentType: 'openclaw',
        version: '1.0.0',
        capabilities: [],
        protocolVersion: '1.0',
        lastSeen: Date.now(),
        multiaddrs: [],
      };
      
      await manager.upsertFromAgentInfo(agentInfo1, 'peer1');
      
      const agentInfo2: AgentInfo = {
        peerId: 'peer1',
        agentType: 'claude-code',
        version: '2.0.0',
        capabilities: [],
        protocolVersion: '2.0',
        lastSeen: Date.now(),
        multiaddrs: [],
      };
      
      await manager.upsertFromAgentInfo(agentInfo2, 'peer1');
      
      const peer = manager.get('peer1');
      expect(peer?.agentInfo?.version).toBe('2.0.0');
    });
  });

  describe('getConnectedPeers', () => {
    it('should return PeerInfo for connected peers', async () => {
      await manager.upsert('peer1', { reputation: 50, connected: true, multiaddrs: [] } as Partial<PeerInfo>);
      await manager.upsert('peer2', { reputation: 60, connected: true, multiaddrs: [] } as Partial<PeerInfo>);
      
      manager.setConnected('peer1');
      manager.setConnected('peer2');
      
      const connected = manager.getConnectedPeers();
      expect(connected).toHaveLength(2);
      expect(connected.map(p => p.reputation)).toContain(50);
      expect(connected.map(p => p.reputation)).toContain(60);
    });

    it('should skip peers not in table', () => {
      manager.setConnected('unknown');
      const connected = manager.getConnectedPeers();
      expect(connected).toHaveLength(0);
    });
  });
});