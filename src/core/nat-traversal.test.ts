/**
 * NAT 穿透管理器测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NATTraversalManager, NATType, ConnectionStrategy } from './nat-traversal.js';
import type { Libp2p } from '@libp2p/interface';
import { multiaddr } from '@multiformats/multiaddr';

// Mock libp2p
const createMockLibp2p = (): any => ({
  getMultiaddrs: vi.fn(() => []),
  dial: vi.fn(),
  hangUp: vi.fn(),
  services: {}
});

describe('NATTraversalManager', () => {
  let manager: NATTraversalManager;
  let mockLibp2p: any;

  beforeEach(() => {
    mockLibp2p = createMockLibp2p();
    manager = new NATTraversalManager(mockLibp2p as Libp2p);
  });

  afterEach(async () => {
    await manager.destroy();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const status = manager.getStatus();
      expect(status.natType).toBe(NATType.UNKNOWN);
      expect(status.isPubliclyReachable).toBe(false);
      expect(status.usingRelay).toBe(false);
    });

    it('should accept custom config', () => {
      const customManager = new NATTraversalManager(mockLibp2p as Libp2p, {
        enableAutoNAT: false,
        relayServers: ['relay.example.com:4001']
      });
      
      // Config is internal, but we can verify initialization doesn't throw
      expect(customManager).toBeDefined();
    });
  });

  describe('NAT type detection', () => {
    it('should detect public address when available', async () => {
      // Mock public address
      mockLibp2p.getMultiaddrs.mockReturnValue([
        multiaddr('/ip4/8.8.8.8/tcp/4001')
      ]);

      const status = await manager.detectNATType();
      
      expect(status.isPubliclyReachable).toBe(true);
      expect(status.natType).toBe(NATType.PUBLIC);
      expect(status.publicAddresses.length).toBeGreaterThan(0);
    });

    it('should detect NAT when only private addresses', async () => {
      // Mock private address
      mockLibp2p.getMultiaddrs.mockReturnValue([
        multiaddr('/ip4/192.168.1.100/tcp/4001')
      ]);

      const status = await manager.detectNATType();
      
      expect(status.isPubliclyReachable).toBe(false);
    });
  });

  describe('relay connection', () => {
    it('should connect to relay server', async () => {
      mockLibp2p.dial.mockResolvedValue(undefined);

      const result = await manager.connectToRelay('/ip4/1.2.3.4/tcp/4001/p2p/QmRelay');
      
      expect(result).toBe(true);
      expect(manager.getStatus().usingRelay).toBe(true);
    });

    it('should handle relay connection failure', async () => {
      mockLibp2p.dial.mockRejectedValue(new Error('Connection failed'));

      const result = await manager.connectToRelay('/ip4/1.2.3.4/tcp/4001/p2p/QmRelay');
      
      expect(result).toBe(false);
      expect(manager.getStatus().usingRelay).toBe(false);
    });

    it('should disconnect from relay', async () => {
      mockLibp2p.dial.mockResolvedValue(undefined);
      mockLibp2p.hangUp.mockResolvedValue(undefined);

      await manager.connectToRelay('/ip4/1.2.3.4/tcp/4001/p2p/QmRelay');
      await manager.disconnectFromRelay();
      
      expect(manager.getStatus().usingRelay).toBe(false);
      expect(manager.getStatus().relayAddress).toBeUndefined();
    });
  });

  describe('connection strategy', () => {
    it('should recommend DIRECT when publicly reachable', async () => {
      mockLibp2p.getMultiaddrs.mockReturnValue([
        multiaddr('/ip4/8.8.8.8/tcp/4001')
      ]);

      await manager.detectNATType();
      const strategy = manager.getRecommendedStrategy();
      
      expect(strategy).toBe(ConnectionStrategy.DIRECT);
    });

    it('should recommend RELAY_FALLBACK when behind NAT', async () => {
      mockLibp2p.getMultiaddrs.mockReturnValue([
        multiaddr('/ip4/192.168.1.100/tcp/4001')
      ]);

      await manager.detectNATType();
      const strategy = manager.getRecommendedStrategy();
      
      expect(strategy).toBe(ConnectionStrategy.RELAY_FALLBACK);
    });
  });

  describe('events', () => {
    it('should emit nat:detected event', async () => {
      const handler = vi.fn();
      manager.on('nat:detected', handler);

      mockLibp2p.getMultiaddrs.mockReturnValue([
        multiaddr('/ip4/192.168.1.100/tcp/4001')
      ]);

      await manager.detectNATType();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should emit relay:connected event', async () => {
      const handler = vi.fn();
      manager.on('relay:connected', handler);

      mockLibp2p.dial.mockResolvedValue(undefined);

      await manager.connectToRelay('/ip4/1.2.3.4/tcp/4001/p2p/QmRelay');
      
      expect(handler).toHaveBeenCalledWith('/ip4/1.2.3.4/tcp/4001/p2p/QmRelay');
    });
  });

  describe('isPublicAddress', () => {
    it('should identify localhost as private', async () => {
      const localMockLibp2p = createMockLibp2p();
      const localManager = new NATTraversalManager(localMockLibp2p as Libp2p);
      
      localMockLibp2p.getMultiaddrs.mockReturnValue([multiaddr('/ip4/127.0.0.1/tcp/4001')]);
      await localManager.initialize();
      const status = localManager.getStatus();
      expect(status.isPubliclyReachable).toBe(false);
      
      await localManager.destroy();
    });

    it('should identify 192.168.x.x as private', async () => {
      const localMockLibp2p = createMockLibp2p();
      const localManager = new NATTraversalManager(localMockLibp2p as Libp2p);
      
      localMockLibp2p.getMultiaddrs.mockReturnValue([multiaddr('/ip4/192.168.1.1/tcp/4001')]);
      await localManager.initialize();
      const status = localManager.getStatus();
      expect(status.isPubliclyReachable).toBe(false);
      
      await localManager.destroy();
    });

    it('should identify public address', async () => {
      const localMockLibp2p = createMockLibp2p();
      const localManager = new NATTraversalManager(localMockLibp2p as Libp2p);
      
      localMockLibp2p.getMultiaddrs.mockReturnValue([multiaddr('/ip4/8.8.8.8/tcp/4001')]);
      await localManager.initialize();
      const status = localManager.getStatus();
      expect(status.isPubliclyReachable).toBe(true);
      
      await localManager.destroy();
    });
  });
});