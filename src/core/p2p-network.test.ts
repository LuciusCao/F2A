import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P2PNetwork } from './p2p-network';
import { AgentInfo } from '../types';

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
});
