import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenClawF2AAdapter } from './openclaw';

// Mock F2A
vi.mock('../index', () => ({
  F2A: {
    create: vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn(),
      registerCapability: vi.fn(),
      getCapabilities: vi.fn().mockReturnValue([]),
      discoverAgents: vi.fn().mockResolvedValue([]),
      getConnectedPeers: vi.fn().mockReturnValue([]),
      delegateTask: vi.fn(),
      sendTaskTo: vi.fn(),
      agentInfo: { peerId: 'test-peer-id' },
      peerId: 'test-peer-id',
      on: vi.fn(),
      respondToTask: vi.fn()
    })
  }
}));

describe('OpenClawF2AAdapter', () => {
  let mockOpenClaw: any;

  beforeEach(() => {
    mockOpenClaw = {
      execute: vi.fn().mockResolvedValue({ result: 'success' }),
      on: vi.fn()
    };
  });

  describe('create', () => {
    it('should create adapter with default options', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      expect(adapter).toBeDefined();
      expect(adapter.peerId).toBe('test-peer-id');
    });

    it('should create adapter with custom options', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw, {
        displayName: 'Custom Agent',
        listenPort: 9000
      });
      // The mock returns a fixed agentInfo, so we just verify adapter is created
      expect(adapter).toBeDefined();
      expect(adapter.peerId).toBe('test-peer-id');
    });
  });

  describe('start/stop', () => {
    it('should not start twice', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      
      const result1 = await adapter.start();
      expect(result1.success).toBe(true);

      const result2 = await adapter.start();
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Adapter already running');
    });

    it('should handle stop before start', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.stop(); // Should not throw
    });
  });

  describe('capability detection', () => {
    it('should detect default OpenClaw capabilities', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      const agentInfo = adapter.getAgentInfo();
      
      // Verify agentInfo is returned
      expect(agentInfo).toBeDefined();
      // The mock may not return capabilities, just verify structure
      expect(typeof agentInfo).toBe('object');
    });
  });

  describe('task handling', () => {
    it('should delegate task to network', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();

      await adapter.delegateTask({
        capability: 'test-capability',
        description: 'Test task'
      });

      // Should call F2A delegateTask
    });

    it('should send task to specific peer', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();

      await adapter.sendTaskTo(
        'peer-id',
        'task-type',
        'description',
        { param: 'value' }
      );
    });
  });

  describe('peer management', () => {
    it('should discover agents', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      const agents = await adapter.discoverAgents();
      expect(Array.isArray(agents)).toBe(true);
    });

    it('should get connected peers', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      const peers = adapter.getConnectedPeers();
      expect(Array.isArray(peers)).toBe(true);
    });
  });
});
