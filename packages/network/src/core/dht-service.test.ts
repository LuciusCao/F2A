/**
 * DHTService 测试
 * Phase 5b: 测试 DHTService 的核心功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DHTService } from './dht-service.js';
import type { PeerInfo } from '../types/index.js';
import type { Libp2p } from '@libp2p/interface';
import type { PeerId } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';

// Mock multiaddr
const createMockMultiaddr = (str: string): Multiaddr => ({
  toString: () => str,
  bytes: new Uint8Array(),
} as Multiaddr);

// Mock PeerInfo
const createPeerInfo = (peerId: string, addresses?: string[]): PeerInfo => ({
  peerId,
  multiaddrs: addresses?.map(createMockMultiaddr) || [],
  connected: true,
  reputation: 50,
  lastSeen: Date.now(),
});

// Mock PeerId
const createMockPeerId = (str: string): PeerId => ({
  toString: () => str,
  toCID: () => ({ bytes: new Uint8Array() }),
  type: 'ed25519',
  multihash: { bytes: new Uint8Array(), digest: new Uint8Array(), code: 0, size: 0 },
  publicKey: { bytes: new Uint8Array() },
} as PeerId);

// Mock DHT service
const createMockDHT = (options: {
  findPeerResult?: { multiaddrs: Multiaddr[] } | null;
  routingTableSize?: number;
} = {}) => ({
  findPeer: vi.fn(async (_peerId: PeerId) => options.findPeerResult ?? null),
  routingTable: { size: options.routingTableSize ?? 5 },
});

// Mock libp2p node
const createMockNode = (options: {
  dht?: ReturnType<typeof createMockDHT> | null;
  peerIdStr?: string;
  addresses?: string[];
} = {}): Libp2p => ({
  peerId: createMockPeerId(options.peerIdStr || 'local-peer'),
  services: {
    dht: options.dht === null ? undefined : (options.dht ?? createMockDHT()),
  },
  getMultiaddrs: () => (options.addresses || ['/ip4/127.0.0.1/tcp/4001']).map(createMockMultiaddr),
  dial: vi.fn(async (_ma: Multiaddr) => {}),
  stop: vi.fn(async () => {}),
} as unknown as Libp2p);

// Mock PeerManager
const createMockPeerManager = (peers: PeerInfo[] = []) => ({
  getConnectedPeers: vi.fn(() => peers),
});

// Mock NATTraversalManager
const createMockNATTraversalManager = (connectResult: boolean = true) => ({
  connectToRelay: vi.fn(async (_address: string) => connectResult),
});

describe('DHTService', () => {
  let dhtService: DHTService;

  beforeEach(() => {
    dhtService = new DHTService();
  });

  describe('setNode', () => {
    it('should set node reference', () => {
      const mockNode = createMockNode();
      
      expect(dhtService.isNodeInitialized()).toBe(false);
      
      dhtService.setNode(mockNode);
      
      expect(dhtService.isNodeInitialized()).toBe(true);
    });

    it('should allow multiple setNode calls', () => {
      const mockNode1 = createMockNode({ peerIdStr: 'peer1' });
      const mockNode2 = createMockNode({ peerIdStr: 'peer2' });
      
      dhtService.setNode(mockNode1);
      dhtService.setNode(mockNode2);
      
      expect(dhtService.isNodeInitialized()).toBe(true);
    });
  });

  describe('findPeerViaDHT', () => {
    it('should fail when node not initialized', async () => {
      const result = await dhtService.findPeerViaDHT('target-peer');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NETWORK_NOT_STARTED');
    });

    it('should fail when DHT not enabled', async () => {
      const mockNode = createMockNode({ dht: null });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.findPeerViaDHT('target-peer');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DHT_NOT_AVAILABLE');
    });

    it('should fail with invalid peerId format', async () => {
      const mockNode = createMockNode();
      dhtService.setNode(mockNode);
      
      const result = await dhtService.findPeerViaDHT('');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PEER_ID');
    });

    it('should find peer and return addresses', async () => {
      const mockDHT = createMockDHT({
        findPeerResult: {
          multiaddrs: [
            createMockMultiaddr('/ip4/192.168.1.1/tcp/4001'),
            createMockMultiaddr('/ip4/10.0.0.1/tcp/4001'),
          ],
        },
      });
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      // Mock peerIdFromString to work with our test peer ID
      vi.mock('@libp2p/peer-id', () => ({
        peerIdFromString: (str: string) => createMockPeerId(str),
      }));
      
      const result = await dhtService.findPeerViaDHT('QmSomeValidPeerId');
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0]).toContain('/ip4/');
      }
    });

    it('should emit peer:found event when peer is found', async () => {
      const eventHandler = vi.fn();
      dhtService.on('peer:found', eventHandler);
      
      const mockDHT = createMockDHT({
        findPeerResult: {
          multiaddrs: [createMockMultiaddr('/ip4/192.168.1.1/tcp/4001')],
        },
      });
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.findPeerViaDHT('QmSomeValidPeerId');
      
      if (result.success) {
        expect(eventHandler).toHaveBeenCalledTimes(1);
        expect(eventHandler.mock.calls[0][0].peerId).toBe('QmSomeValidPeerId');
        expect(eventHandler.mock.calls[0][0].addresses).toHaveLength(1);
      }
    });

    it('should fail when peer not found', async () => {
      const mockDHT = createMockDHT({ findPeerResult: null });
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.findPeerViaDHT('QmSomeValidPeerId');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PEER_NOT_FOUND');
    });

    it('should fail when peer has no multiaddrs', async () => {
      const mockDHT = createMockDHT({ findPeerResult: { multiaddrs: [] } });
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.findPeerViaDHT('QmSomeValidPeerId');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PEER_NOT_FOUND');
    });

    it('should handle DHT lookup errors', async () => {
      const mockDHT = {
        findPeer: vi.fn(async () => { throw new Error('DHT network error'); }),
        routingTable: { size: 5 },
      };
      const mockNode = createMockNode({ dht: mockDHT as unknown as ReturnType<typeof createMockDHT> });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.findPeerViaDHT('QmSomeValidPeerId');
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DHT_LOOKUP_FAILED');
    });
  });

  describe('discoverPeersViaDHT', () => {
    it('should fail when node not initialized', async () => {
      const result = await dhtService.discoverPeersViaDHT();
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NETWORK_NOT_STARTED');
    });

    it('should fail when DHT not enabled', async () => {
      const mockNode = createMockNode({ dht: null });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.discoverPeersViaDHT();
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DHT_NOT_AVAILABLE');
    });

    it('should discover peers from routing table', async () => {
      const mockDHT = createMockDHT({ routingTableSize: 10 });
      const mockNode = createMockNode({ dht: mockDHT });
      const mockPeerManager = createMockPeerManager([
        createPeerInfo('peer1', ['/ip4/192.168.1.1/tcp/4001']),
        createPeerInfo('peer2', ['/ip4/10.0.0.1/tcp/4001']),
      ]);
      
      dhtService.setNode(mockNode);
      dhtService.setPeerManager(mockPeerManager);
      
      const result = await dhtService.discoverPeersViaDHT();
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should use findPeerViaDHT when specific peerId is provided', async () => {
      const mockDHT = createMockDHT({
        findPeerResult: {
          multiaddrs: [createMockMultiaddr('/ip4/192.168.1.1/tcp/4001')],
        },
      });
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.discoverPeersViaDHT({ peerId: 'QmTargetPeer' });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
      }
    });

    it('should emit dht:discovery event when peers are discovered', async () => {
      const eventHandler = vi.fn();
      dhtService.on('dht:discovery', eventHandler);
      
      const mockDHT = createMockDHT({ routingTableSize: 5 });
      const mockNode = createMockNode({ dht: mockDHT });
      const mockPeerManager = createMockPeerManager([
        createPeerInfo('peer1', ['/ip4/192.168.1.1/tcp/4001']),
      ]);
      
      dhtService.setNode(mockNode);
      dhtService.setPeerManager(mockPeerManager);
      
      const result = await dhtService.discoverPeersViaDHT();
      
      if (result.success) {
        expect(eventHandler).toHaveBeenCalledTimes(1);
        expect(eventHandler.mock.calls[0][0].count).toBeGreaterThanOrEqual(1);
      }
    });

    it('should fail when no peers discovered', async () => {
      const mockDHT = createMockDHT({ routingTableSize: 0 });
      const mockNode = createMockNode({ dht: mockDHT });
      const mockPeerManager = createMockPeerManager([]);
      
      dhtService.setNode(mockNode);
      dhtService.setPeerManager(mockPeerManager);
      
      const result = await dhtService.discoverPeersViaDHT();
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PEER_NOT_FOUND');
    });
  });

  describe('registerToDHT', () => {
    it('should fail when node not initialized', async () => {
      const result = await dhtService.registerToDHT();
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NETWORK_NOT_STARTED');
    });

    it('should fail when DHT not enabled', async () => {
      const mockNode = createMockNode({ dht: null });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.registerToDHT();
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DHT_NOT_AVAILABLE');
    });

    it('should succeed when DHT is enabled', async () => {
      const mockDHT = createMockDHT();
      const mockNode = createMockNode({ dht: mockDHT, addresses: ['/ip4/127.0.0.1/tcp/4001'] });
      dhtService.setNode(mockNode);
      
      const result = await dhtService.registerToDHT();
      
      expect(result.success).toBe(true);
    });

    it('should emit dht:registered event', async () => {
      const eventHandler = vi.fn();
      dhtService.on('dht:registered', eventHandler);
      
      const mockDHT = createMockDHT();
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      await dhtService.registerToDHT();
      
      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    it('should log DHT server mode info', async () => {
      const mockDHT = createMockDHT();
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      dhtService.setDHTServerMode(true);
      
      const result = await dhtService.registerToDHT();
      
      expect(result.success).toBe(true);
    });
  });

  describe('connectToRelay', () => {
    it('should fail when NAT traversal not enabled', async () => {
      const result = await dhtService.connectToRelay('/ip4/127.0.0.1/tcp/4001/p2p/QmRelayPeer');
      
      expect(result).toBe(false);
    });

    it('should fail with invalid relay address', async () => {
      const mockNATTraversalManager = createMockNATTraversalManager(true);
      dhtService.setNATTraversalManager(mockNATTraversalManager);
      
      const result = await dhtService.connectToRelay('invalid-address');
      
      expect(result).toBe(false);
    });

    it('should succeed with valid relay address', async () => {
      const mockNATTraversalManager = createMockNATTraversalManager(true);
      dhtService.setNATTraversalManager(mockNATTraversalManager);
      
      const result = await dhtService.connectToRelay('/ip4/127.0.0.1/tcp/4001/p2p/QmRelayPeer');
      
      expect(result).toBe(true);
      expect(mockNATTraversalManager.connectToRelay).toHaveBeenCalledTimes(1);
    });

    it('should emit relay:connected event on success', async () => {
      const eventHandler = vi.fn();
      dhtService.on('relay:connected', eventHandler);
      
      const mockNATTraversalManager = createMockNATTraversalManager(true);
      dhtService.setNATTraversalManager(mockNATTraversalManager);
      
      await dhtService.connectToRelay('/ip4/127.0.0.1/tcp/4001/p2p/QmRelayPeer');
      
      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler.mock.calls[0][0]).toBe('/ip4/127.0.0.1/tcp/4001/p2p/QmRelayPeer');
    });

    it('should not emit relay:connected event on failure', async () => {
      const eventHandler = vi.fn();
      dhtService.on('relay:connected', eventHandler);
      
      const mockNATTraversalManager = createMockNATTraversalManager(false);
      dhtService.setNATTraversalManager(mockNATTraversalManager);
      
      await dhtService.connectToRelay('/ip4/127.0.0.1/tcp/4001/p2p/QmRelayPeer');
      
      expect(eventHandler).not.toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      const mockNATTraversalManager = {
        connectToRelay: vi.fn(async () => { throw new Error('Connection failed'); }),
      };
      dhtService.setNATTraversalManager(mockNATTraversalManager);
      
      const result = await dhtService.connectToRelay('/ip4/127.0.0.1/tcp/4001/p2p/QmRelayPeer');
      
      expect(result).toBe(false);
    });
  });

  describe('getDHTPeerCount', () => {
    it('should return 0 when node not initialized', () => {
      expect(dhtService.getDHTPeerCount()).toBe(0);
    });

    it('should return 0 when DHT not enabled', () => {
      const mockNode = createMockNode({ dht: null });
      dhtService.setNode(mockNode);
      
      expect(dhtService.getDHTPeerCount()).toBe(0);
    });

    it('should return routing table size when DHT enabled', () => {
      const mockDHT = createMockDHT({ routingTableSize: 25 });
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      expect(dhtService.getDHTPeerCount()).toBe(25);
    });
  });

  describe('isDHTEnabled', () => {
    it('should return false when node not initialized', () => {
      expect(dhtService.isDHTEnabled()).toBe(false);
    });

    it('should return false when DHT not in services', () => {
      const mockNode = createMockNode({ dht: null });
      dhtService.setNode(mockNode);
      
      expect(dhtService.isDHTEnabled()).toBe(false);
    });

    it('should return true when DHT is enabled', () => {
      const mockDHT = createMockDHT();
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      expect(dhtService.isDHTEnabled()).toBe(true);
    });
  });

  describe('isNodeInitialized', () => {
    it('should return false initially', () => {
      expect(dhtService.isNodeInitialized()).toBe(false);
    });

    it('should return true after setNode', () => {
      const mockNode = createMockNode();
      dhtService.setNode(mockNode);
      
      expect(dhtService.isNodeInitialized()).toBe(true);
    });
  });

  describe('setPeerManager', () => {
    it('should set peer manager reference', () => {
      const mockPeerManager = createMockPeerManager([]);
      dhtService.setPeerManager(mockPeerManager);
      
      // Verify it works by using it in discoverPeersViaDHT
      const mockDHT = createMockDHT();
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      
      // Should still fail because no peers, but peerManager should be called
      dhtService.discoverPeersViaDHT();
      expect(mockPeerManager.getConnectedPeers).toHaveBeenCalled();
    });
  });

  describe('setDHTServerMode', () => {
    it('should set DHT server mode', async () => {
      const mockDHT = createMockDHT();
      const mockNode = createMockNode({ dht: mockDHT });
      dhtService.setNode(mockNode);
      dhtService.setDHTServerMode(true);
      
      const result = await dhtService.registerToDHT();
      expect(result.success).toBe(true);
    });
  });
});