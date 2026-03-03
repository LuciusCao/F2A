import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenClawF2AAdapter } from './openclaw';
import { F2A } from '../index';
import { TaskRequestEvent } from '../types';

// Mock F2A
vi.mock('../index', () => ({
  F2A: {
    create: vi.fn().mockResolvedValue({
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn(),
      registerCapability: vi.fn(),
      getCapabilities: vi.fn().mockReturnValue([
        { name: 'file-operation', description: 'File ops', tools: ['read'] }
      ]),
      discoverAgents: vi.fn().mockResolvedValue([]),
      getConnectedPeers: vi.fn().mockReturnValue([]),
      delegateTask: vi.fn().mockResolvedValue({ success: true }),
      sendTaskTo: vi.fn().mockResolvedValue({ success: true }),
      agentInfo: { 
        peerId: 'test-peer-id',
        capabilities: [{ name: 'file-operation', description: 'File ops', tools: ['read'] }]
      },
      peerId: 'test-peer-id',
      on: vi.fn(),
      respondToTask: vi.fn().mockResolvedValue({ success: true })
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
    vi.clearAllMocks();
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
      expect(adapter).toBeDefined();
    });

    it('should create adapter with bootstrap peers', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw, {
        bootstrapPeers: ['/ip4/127.0.0.1/tcp/9001/p2p/test']
      });
      expect(adapter).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should start successfully', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      const result = await adapter.start();
      expect(result.success).toBe(true);
    });

    it('should not start twice', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();
      
      const result = await adapter.start();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Adapter already running');
    });

    it('should stop gracefully', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();
      await adapter.stop();
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
      
      expect(agentInfo).toBeDefined();
      expect(typeof agentInfo).toBe('object');
    });
  });

  describe('task handling', () => {
    it('should delegate task to network', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();

      const result = await adapter.delegateTask({
        capability: 'test-capability',
        description: 'Test task'
      });

      expect(result).toBeDefined();
    });

    it('should send task to specific peer', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();

      const result = await adapter.sendTaskTo(
        'peer-id',
        'task-type',
        'description',
        { param: 'value' }
      );

      expect(result).toBeDefined();
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

  describe('registerCapability', () => {
    it('should register new capability', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      
      adapter.registerCapability(
        { name: 'new-cap', description: 'New capability', tools: [] },
        async () => 'result'
      );
    });
  });

  describe('handleTaskRequest', () => {
    it('should handle task request successfully', async () => {
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();

      const event: TaskRequestEvent = {
        taskId: 'task-id',
        from: 'peer-id',
        taskType: 'file-operation',
        description: 'Read file',
        parameters: { path: '/test.txt' }
      };

      // Access private method
      await (adapter as any).handleTaskRequest(event);

      expect(mockOpenClaw.execute).toHaveBeenCalled();
    });

    it('should handle task execution error', async () => {
      mockOpenClaw.execute.mockRejectedValueOnce(new Error('Execution failed'));
      
      const adapter = await OpenClawF2AAdapter.create(mockOpenClaw);
      await adapter.start();

      const event: TaskRequestEvent = {
        taskId: 'task-id',
        from: 'peer-id',
        taskType: 'file-operation',
        description: 'Read file'
      };

      await (adapter as any).handleTaskRequest(event);
    });
  });
});
