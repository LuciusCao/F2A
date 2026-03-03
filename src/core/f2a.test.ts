import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2A } from './f2a';
import { AgentCapability, TaskDelegateOptions } from '../types';

// Mock P2PNetwork
vi.mock('./p2p-network', () => ({
  P2PNetwork: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue({ 
      success: true, 
      data: { peerId: 'test-peer-id', addresses: ['/ip4/127.0.0.1/tcp/9000'] }
    }),
    stop: vi.fn(),
    discoverAgents: vi.fn().mockResolvedValue([]),
    getConnectedPeers: vi.fn().mockReturnValue([]),
    sendTaskRequest: vi.fn(),
    sendTaskResponse: vi.fn().mockResolvedValue({ success: true }),
    on: vi.fn(),
    getPeerId: vi.fn().mockReturnValue('test-peer-id')
  }))
}));

describe('F2A', () => {
  let f2a: F2A;

  beforeEach(async () => {
    f2a = await F2A.create({
      displayName: 'Test Agent',
      agentType: 'openclaw',
      network: {
        listenPort: 0,
        enableMDNS: false
      }
    });
  });

  afterEach(async () => {
    await f2a.stop();
  });

  describe('create', () => {
    it('should create F2A instance with default options', async () => {
      const instance = await F2A.create();
      expect(instance).toBeDefined();
      expect(instance.agentInfo.agentType).toBe('openclaw');
      await instance.stop();
    });

    it('should create F2A instance with custom options', async () => {
      const instance = await F2A.create({
        displayName: 'Custom Agent',
        agentType: 'custom'
      });
      expect(instance.agentInfo.displayName).toBe('Custom Agent');
      expect(instance.agentInfo.agentType).toBe('custom');
      await instance.stop();
    });
  });

  describe('start/stop', () => {
    it('should start successfully', async () => {
      const result = await f2a.start();
      expect(result.success).toBe(true);
    });

    it('should not start twice', async () => {
      await f2a.start();
      const result = await f2a.start();
      expect(result.success).toBe(false);
      expect(result.error).toBe('F2A already running');
    });

    it('should handle stop before start', async () => {
      const newF2a = await F2A.create();
      await newF2a.stop(); // Should not throw
    });

    it('should handle multiple stop calls', async () => {
      await f2a.start();
      await f2a.stop();
      await f2a.stop(); // Should not throw
    });
  });

  describe('capability management', () => {
    it('should register capability', () => {
      const capability: AgentCapability = {
        name: 'test-capability',
        description: 'Test capability',
        tools: ['tool1', 'tool2']
      };

      f2a.registerCapability(capability, async () => 'result');
      
      const capabilities = f2a.getCapabilities();
      expect(capabilities).toHaveLength(1);
      expect(capabilities[0].name).toBe('test-capability');
    });

    it('should register multiple capabilities', () => {
      f2a.registerCapability(
        { name: 'cap1', description: 'Cap 1', tools: [] },
        async () => 'result1'
      );
      f2a.registerCapability(
        { name: 'cap2', description: 'Cap 2', tools: [] },
        async () => 'result2'
      );

      const capabilities = f2a.getCapabilities();
      expect(capabilities).toHaveLength(2);
    });

    it('should update capability when registering same name', () => {
      f2a.registerCapability(
        { name: 'same-cap', description: 'Original', tools: [] },
        async () => 'original'
      );
      f2a.registerCapability(
        { name: 'same-cap', description: 'Updated', tools: ['new-tool'] },
        async () => 'updated'
      );

      const capabilities = f2a.getCapabilities();
      expect(capabilities).toHaveLength(1);
      expect(capabilities[0].description).toBe('Updated');
    });
  });

  describe('events', () => {
    it('should emit network:started event', async () => {
      const eventPromise = new Promise((resolve) => {
        f2a.on('network:started', (event) => {
          resolve(event);
        });
      });

      await f2a.start();
      const event = await eventPromise;
      expect(event).toBeDefined();
    });

    it('should emit network:stopped event', async () => {
      await f2a.start();
      
      const eventPromise = new Promise((resolve) => {
        f2a.on('network:stopped', () => {
          resolve(true);
        });
      });

      await f2a.stop();
      await eventPromise;
    });
  });

  describe('peer management', () => {
    it('should return empty peers when not started', () => {
      const peers = f2a.getConnectedPeers();
      expect(peers).toEqual([]);
    });
  });

  describe('task delegation', () => {
    it('should fail delegation when no agents found', async () => {
      const options: TaskDelegateOptions = {
        capability: 'non-existent-capability',
        description: 'Test task'
      };

      const result = await f2a.delegateTask(options);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No agent found');
    });

    it('should delegate task with parallel option', async () => {
      const options: TaskDelegateOptions = {
        capability: 'test-cap',
        description: 'Test task',
        parallel: true,
        minResponses: 1
      };

      const result = await f2a.delegateTask(options);
      expect(result.success).toBe(false); // No agents found
    });
  });

  describe('sendTaskTo', () => {
    it('should send task to specific peer', async () => {
      await f2a.start();
      // Mock returns undefined, just verify it doesn't throw
      await f2a.sendTaskTo(
        'peer-id',
        'task-type',
        'description',
        { param: 'value' }
      );
    });
  });

  describe('respondToTask', () => {
    it('should respond to task successfully', async () => {
      await f2a.start();
      const result = await f2a.respondToTask(
        'peer-id',
        'task-id',
        'success',
        { data: 'result' }
      );
      expect(result.success).toBe(true);
    });

    it('should respond to task with error', async () => {
      await f2a.start();
      const result = await f2a.respondToTask(
        'peer-id',
        'task-id',
        'error',
        undefined,
        'Error message'
      );
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should emit error event', async () => {
      const errorPromise = new Promise<Error>((resolve) => {
        f2a.on('error', (error) => {
          resolve(error);
        });
      });

      // Emit error through f2a directly
      (f2a as any).emit('error', new Error('Test error'));
      
      const error = await errorPromise;
      expect(error.message).toBe('Test error');
    });
  });
});
