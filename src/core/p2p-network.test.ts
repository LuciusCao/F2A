import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P2PNetwork } from './p2p-network.js';
import { AgentInfo } from '../types/index.js';

describe('P2PNetwork', () => {
  let network: P2PNetwork;
  let mockAgentInfo: AgentInfo;

  beforeEach(() => {
    mockAgentInfo = {
      peerId: '',
      displayName: 'Test Agent',
      agentType: 'openclaw',
      version: '1.0.0',
      capabilities: [],
      protocolVersion: 'f2a/1.0',
      lastSeen: Date.now(),
      multiaddrs: []
    };
    network = new P2PNetwork(mockAgentInfo);
  });

  afterEach(async () => {
    await network.stop();
  });

  describe('initialization', () => {
    it('should initialize with correct default config', () => {
      expect(network).toBeDefined();
      expect(network.getPeerId()).toBe('');
    });

    it('should handle multiple stop calls gracefully', async () => {
      await network.stop();
      await network.stop(); // Should not throw
      expect(network.getPeerId()).toBe('');
    });
  });

  describe('peer management', () => {
    it('should return empty array when no peers connected', () => {
      const peers = network.getConnectedPeers();
      expect(peers).toEqual([]);
    });

    it('should return empty array for all peers initially', () => {
      const peers = network.getAllPeers();
      expect(peers).toEqual([]);
    });
  });

  describe('capability checking', () => {
    it('should correctly identify agent capabilities', () => {
      const agentWithCaps: AgentInfo = {
        ...mockAgentInfo,
        capabilities: [
          { name: 'file-operation', description: 'File ops', tools: ['read'] }
        ]
      };

      const hasCap = (network as any).hasCapability(agentWithCaps, 'file-operation');
      expect(hasCap).toBe(true);
    });

    it('should return false for missing capabilities', () => {
      const agentWithCaps: AgentInfo = {
        ...mockAgentInfo,
        capabilities: []
      };

      const hasCap = (network as any).hasCapability(agentWithCaps, 'file-operation');
      expect(hasCap).toBe(false);
    });
  });

  describe('DHT features', () => {
    it('should return false for isDHTEnabled when not started', () => {
      expect(network.isDHTEnabled()).toBe(false);
    });

    it('should return 0 for getDHTPeerCount when not started', () => {
      expect(network.getDHTPeerCount()).toBe(0);
    });

    it('should return error when findPeerViaDHT called before start', async () => {
      const result = await network.findPeerViaDHT('test-peer-id');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NETWORK_NOT_STARTED');
    });
  });

  describe('E2EE features', () => {
    it('should return null for getEncryptionPublicKey when not started', () => {
      expect(network.getEncryptionPublicKey()).toBeNull();
    });

    it('should return 0 for getEncryptedPeerCount when not started', () => {
      expect(network.getEncryptedPeerCount()).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit error event', async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        network.on('error', (error) => {
          resolve(error);
        });
      });

      (network as any).emit('error', new Error('Test error'));
      
      const error = await errorPromise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
    });
  });

  describe('message handling', () => {
    it('should process DISCOVER_RESP and upsert peer', async () => {
      const agentInfo: AgentInfo = {
        ...mockAgentInfo,
        peerId: 'peer-remote',
        multiaddrs: ['/ip4/127.0.0.1/tcp/9002']
      };

      await (network as any).handleMessage(
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'DISCOVER_RESP',
          from: 'peer-remote',
          timestamp: Date.now(),
          payload: { agentInfo }
        },
        'peer-remote'
      );

      const peers = network.getAllPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].agentInfo?.peerId).toBe('peer-remote');
      expect(peers[0].multiaddrs[0].toString()).toContain('/tcp/9002');
    });

    it('should process CAPABILITY_RESPONSE and upsert peer', async () => {
      const agentInfo: AgentInfo = {
        ...mockAgentInfo,
        peerId: 'peer-cap',
        capabilities: [{ name: 'code-gen', description: 'Code Gen', tools: ['generate'] }],
        multiaddrs: ['/ip4/127.0.0.1/tcp/9003']
      };

      await (network as any).handleMessage(
        {
          id: '00000000-0000-4000-8000-000000000002',
          type: 'CAPABILITY_RESPONSE',
          from: 'peer-cap',
          timestamp: Date.now(),
          payload: { agentInfo }
        },
        'peer-cap'
      );

      const peers = network.getAllPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].agentInfo?.capabilities[0].name).toBe('code-gen');
    });
  });

  describe('broadcast', () => {
    it('should count fulfilled failures in broadcast warning', async () => {
      const warnSpy = vi.spyOn((network as any).logger, 'warn');

      (network as any).node = {
        getPeers: vi.fn().mockReturnValue([
          { toString: () => 'peer-a' },
          { toString: () => 'peer-b' }
        ]),
        stop: vi.fn().mockResolvedValue(undefined)
      };

      const sendSpy = vi.spyOn(network as any, 'sendMessage')
        .mockResolvedValueOnce({ success: true, data: undefined })
        .mockResolvedValueOnce({ success: false, error: { code: 'PEER_NOT_FOUND', message: 'Peer not found' } });

      await (network as any).broadcast({
        id: 'msg-broadcast',
        type: 'DISCOVER',
        from: 'self',
        timestamp: Date.now(),
        payload: { agentInfo: mockAgentInfo }
      });

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith('Broadcast failed to some peers', {
        failed: 1,
        total: 2
      });
    });
  });
});
