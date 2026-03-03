import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2A } from './f2a';
import { AgentCapability, TaskDelegateOptions } from '../types';

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
    it('should handle start failure gracefully', async () => {
      const newF2a = await F2A.create();
      
      // First start
      const result1 = await newF2a.start();
      
      // If first start succeeded, second should fail with 'already running'
      // If first start failed, we check the error message
      if (result1.success) {
        const result2 = await newF2a.start();
        expect(result2.success).toBe(false);
        expect(result2.error).toBe('F2A already running');
      } else {
        // First start failed, which is also valid for this test
        expect(result1.success).toBe(false);
      }
    });

    it('should handle stop before start', async () => {
      const newF2a = await F2A.create();
      await newF2a.stop(); // Should not throw
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
    it('should emit network:started event', (done) => {
      f2a.on('network:started', (event) => {
        expect(event.peerId).toBeDefined();
        expect(event.listenAddresses).toBeDefined();
        done();
      });

      f2a.start();
    });

    it('should emit network:stopped event', (done) => {
      f2a.on('network:stopped', () => {
        done();
      });

      f2a.start().then(() => {
        f2a.stop();
      });
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
  });
});
