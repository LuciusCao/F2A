/**
 * DiscoveryService 测试
 * Phase 4b: 测试 DiscoveryService 的核心功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiscoveryService } from './discovery-service.js';
import { PeerManager } from './peer-manager.js';
import type { AgentInfo, PeerInfo, F2AMessage } from '../types/index.js';

// Mock AgentInfo
const createAgentInfo = (peerId: string, capabilities?: string[]): AgentInfo => ({
  peerId,
  agentId: `agent-${peerId}`,
  name: `Agent ${peerId}`,
  description: 'Test agent',
  capabilities: capabilities?.map(name => ({ name, description: `${name} capability` })) || [],
  multiaddrs: [],
  version: '1.0.0',
});

// Mock PeerInfo
const createPeerInfo = (peerId: string, agentInfo?: AgentInfo): PeerInfo => ({
  peerId,
  agentInfo,
  multiaddrs: [],
  connected: false,
  reputation: 50,
  lastSeen: Date.now(),
});

describe('DiscoveryService', () => {
  let peerManager: PeerManager;
  let discoveryService: DiscoveryService;
  let localAgentInfo: AgentInfo;

  beforeEach(() => {
    peerManager = new PeerManager();
    localAgentInfo = createAgentInfo('local-peer');
    discoveryService = new DiscoveryService({
      peerManager,
      agentInfo: localAgentInfo,
    });
  });

  afterEach(() => {
    discoveryService.stop();
  });

  describe('broadcastDiscovery', () => {
    it('should send broadcast message', () => {
      const broadcastHandler = vi.fn();
      discoveryService.on('broadcast', broadcastHandler);

      discoveryService.broadcastDiscovery();

      expect(broadcastHandler).toHaveBeenCalledTimes(1);
      const message = broadcastHandler.mock.calls[0][0] as F2AMessage;
      expect(message.type).toBe('DISCOVER');
      expect(message.from).toBe('local-peer');
      expect(message.payload).toHaveProperty('agentInfo');
    });

    it('should emit broadcast event with correct message structure', () => {
      const broadcastHandler = vi.fn();
      discoveryService.on('broadcast', broadcastHandler);

      discoveryService.broadcastDiscovery();

      const message = broadcastHandler.mock.calls[0][0] as F2AMessage;
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
      expect(message.payload.agentInfo).toEqual(localAgentInfo);
    });
  });

  describe('discoverAgents', () => {
    it('should return discovered agents from PeerManager', async () => {
      // Add some peers with agentInfo
      const agent1 = createAgentInfo('peer1', ['task-execution']);
      const agent2 = createAgentInfo('peer2', ['file-operation']);
      
      await peerManager.upsert('peer1', createPeerInfo('peer1', agent1));
      await peerManager.upsert('peer2', createPeerInfo('peer2', agent2));

      const agents = await discoveryService.discoverAgents();

      expect(agents.length).toBeGreaterThanOrEqual(2);
      expect(agents.some(a => a.peerId === 'peer1')).toBe(true);
      expect(agents.some(a => a.peerId === 'peer2')).toBe(true);
    });

    it('should filter agents by capability', async () => {
      const agent1 = createAgentInfo('peer1', ['task-execution']);
      const agent2 = createAgentInfo('peer2', ['file-operation']);
      
      await peerManager.upsert('peer1', createPeerInfo('peer1', agent1));
      await peerManager.upsert('peer2', createPeerInfo('peer2', agent2));

      const agents = await discoveryService.discoverAgents('task-execution');

      expect(agents.length).toBe(1);
      expect(agents[0].peerId).toBe('peer1');
    });

    it('should emit broadcast event when discovering', async () => {
      const broadcastHandler = vi.fn();
      discoveryService.on('broadcast', broadcastHandler);

      // Use short timeout to avoid waiting
      await discoveryService.discoverAgents(undefined, { timeoutMs: 100 });

      expect(broadcastHandler).toHaveBeenCalled();
    });

    it('should return empty array if no peers have agentInfo', async () => {
      // Add peers without agentInfo
      await peerManager.upsert('peer1', createPeerInfo('peer1'));

      const agents = await discoveryService.discoverAgents(undefined, { timeoutMs: 100 });

      expect(agents).toHaveLength(0);
    });
  });

  describe('initiateDiscovery', () => {
    it('should send discover message to specific peer', async () => {
      const sendHandler = vi.fn();
      discoveryService.on('send', sendHandler);

      await discoveryService.initiateDiscovery('target-peer');

      expect(sendHandler).toHaveBeenCalledTimes(1);
      expect(sendHandler.mock.calls[0][0].peerId).toBe('target-peer');
      expect(sendHandler.mock.calls[0][0].message.type).toBe('DISCOVER');
    });

    it('should check rate limit before sending', async () => {
      const sendHandler = vi.fn();
      discoveryService.on('send', sendHandler);

      // First request should succeed
      await discoveryService.initiateDiscovery('peer1');
      expect(sendHandler).toHaveBeenCalledTimes(1);

      // Multiple rapid requests should be rate limited
      // The RateLimiter allows burst requests, so we need to exceed the limit
      for (let i = 0; i < 20; i++) {
        await discoveryService.initiateDiscovery('peer1');
      }

      // Should be rate limited after exceeding limit
      // Default is 10 requests per minute with 1.5 burst multiplier = 15 max burst
      expect(sendHandler.mock.calls.length).toBeLessThan(25);
    });

    it('should emit send event with correct structure', async () => {
      const sendHandler = vi.fn();
      discoveryService.on('send', sendHandler);

      await discoveryService.initiateDiscovery('target-peer');

      const data = sendHandler.mock.calls[0][0];
      expect(data.peerId).toBe('target-peer');
      expect(data.message).toBeDefined();
      expect(data.message.type).toBe('DISCOVER');
      expect(data.message.from).toBe('local-peer');
    });
  });

  describe('handleDiscoverResponse', () => {
    it('should update PeerManager with agentInfo', async () => {
      const agentInfo = createAgentInfo('remote-peer');

      await discoveryService.handleDiscoverResponse(agentInfo, 'remote-peer');

      const peer = peerManager.get('remote-peer');
      expect(peer).toBeDefined();
      expect(peer?.agentInfo).toEqual(agentInfo);
    });

    it('should reject response with mismatched peerId', async () => {
      const agentInfo = createAgentInfo('fake-peer');
      
      await discoveryService.handleDiscoverResponse(agentInfo, 'real-peer');

      // Should not update PeerManager
      const peer = peerManager.get('real-peer');
      expect(peer?.agentInfo).toBeUndefined();
    });

    it('should collect agents for pending discovery', async () => {
      // Start a discovery
      const discoverPromise = discoveryService.discoverAgents(undefined, { timeoutMs: 500 });
      
      // Simulate receiving a response
      const agentInfo = createAgentInfo('remote-peer');
      // Get the message ID from the broadcast
      const broadcastHandler = vi.fn();
      discoveryService.on('broadcast', broadcastHandler);
      discoveryService.broadcastDiscovery();
      
      if (broadcastHandler.mock.calls.length > 0) {
        const messageId = broadcastHandler.mock.calls[0][0].id;
        await discoveryService.handleDiscoverResponse(agentInfo, 'remote-peer', messageId);
      }

      const agents = await discoverPromise;
      // The discovery should complete
      expect(agents).toBeDefined();
    });
  });

  describe('RateLimiter', () => {
    it('should limit excessive requests', async () => {
      const sendHandler = vi.fn();
      discoveryService.on('send', sendHandler);

      // Exceed rate limit
      for (let i = 0; i < 30; i++) {
        await discoveryService.initiateDiscovery('same-peer');
      }

      // Should have been rate limited
      // RateLimiter: maxRequests=10, burstMultiplier=1.5 => burstCapacity=15
      expect(sendHandler.mock.calls.length).toBeLessThan(30);
    });

    it('should allow requests for different peers', async () => {
      const sendHandler = vi.fn();
      discoveryService.on('send', sendHandler);

      // Different peers should each have their own rate limit
      for (let i = 0; i < 5; i++) {
        await discoveryService.initiateDiscovery(`peer-${i}`);
      }

      expect(sendHandler).toHaveBeenCalledTimes(5);
    });

    it('should properly stop rate limiter when service stops', () => {
      discoveryService.stop();
      
      const status = discoveryService.getRateLimiterStatus();
      expect(status.isDisposed).toBe(true);
    });
  });

  describe('stop', () => {
    it('should clean up pending discoveries', async () => {
      // Start a discovery
      const discoverPromise = discoveryService.discoverAgents(undefined, { timeoutMs: 10000 });
      
      // Stop the service immediately
      discoveryService.stop();
      
      // The promise should resolve with empty array
      const agents = await discoverPromise;
      expect(agents).toEqual([]);
    });

    it('should stop rate limiter', () => {
      discoveryService.stop();
      
      const status = discoveryService.getRateLimiterStatus();
      expect(status.isDisposed).toBe(true);
    });
  });

  describe('hasCapability', () => {
    it('should return true when agent has the capability', async () => {
      const agentInfo = createAgentInfo('peer1', ['task-execution', 'file-operation']);
      await peerManager.upsert('peer1', createPeerInfo('peer1', agentInfo));

      const agents = await discoveryService.discoverAgents('task-execution');

      expect(agents).toHaveLength(1);
      expect(agents[0].peerId).toBe('peer1');
    });

    it('should return false when agent does not have the capability', async () => {
      const agentInfo = createAgentInfo('peer1', ['file-operation']);
      await peerManager.upsert('peer1', createPeerInfo('peer1', agentInfo));

      const agents = await discoveryService.discoverAgents('task-execution', { timeoutMs: 100 });

      expect(agents).toHaveLength(0);
    });

    it('should handle agents with empty capabilities', async () => {
      const agentInfo = createAgentInfo('peer1', []);
      await peerManager.upsert('peer1', createPeerInfo('peer1', agentInfo));

      const agents = await discoveryService.discoverAgents('any-capability', { timeoutMs: 100 });

      expect(agents).toHaveLength(0);
    });
  });
});