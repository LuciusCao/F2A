import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P2PNetwork } from './p2p-network';
import { AgentInfo } from '../types';

// Mock libp2p modules
vi.mock('libp2p', () => ({
  createLibp2p: vi.fn()
}));

vi.mock('@libp2p/tcp', () => ({
  tcp: vi.fn()
}));

vi.mock('@libp2p/crypto/keys', () => ({
  generateKeyPair: vi.fn()
}));

vi.mock('@libp2p/peer-id', () => ({
  peerIdFromKeys: vi.fn()
}));

vi.mock('@multiformats/multiaddr', () => ({
  multiaddr: vi.fn((addr: string) => ({ toString: () => addr }))
}));

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

  describe('start/stop', () => {
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

      // Access private method through any cast for testing
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

  describe('events', () => {
    it('should emit error event', async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        network.on('error', (error) => {
          resolve(error);
        });
      });

      // Simulate error
      (network as any).emit('error', new Error('Test error'));
      
      const error = await errorPromise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
    });
  });
});
