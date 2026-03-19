import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2A } from './f2a.js';
import { AgentCapability, TaskDelegateOptions } from '../types/index.js';

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
    useMiddleware: vi.fn(),
    removeMiddleware: vi.fn().mockReturnValue(true),
    listMiddlewares: vi.fn().mockReturnValue(['test-middleware']),
    findPeerViaDHT: vi.fn().mockResolvedValue({ success: false, error: { code: 'DHT_NOT_AVAILABLE', message: 'DHT not enabled' } }),
    getDHTPeerCount: vi.fn().mockReturnValue(0),
    isDHTEnabled: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    getPeerId: vi.fn().mockReturnValue('test-peer-id'),
    setIdentityManager: vi.fn()
  }))
}));

// Mock IdentityManager
vi.mock('./identity/index.js', () => ({
  IdentityManager: vi.fn().mockImplementation(() => ({
    loadOrCreate: vi.fn().mockResolvedValue({ 
      success: true, 
      data: { 
        peerId: 'test-peer-id',
        privateKey: 'dGVzdC1wcml2YXRlLWtleQ==',
        e2eeKeyPair: { 
          publicKey: 'dGVzdC1wdWJsaWM=', 
          privateKey: 'dGVzdC1wcml2YXRl' 
        },
        createdAt: new Date()
      }
    }),
    getPeerIdString: vi.fn().mockReturnValue('test-peer-id'),
    getPrivateKey: vi.fn().mockReturnValue({ bytes: new Uint8Array(32) }),
    isLoaded: vi.fn().mockReturnValue(true)
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
      expect(result.error?.message || result.error).toContain('already running');
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
      expect(result.error?.message || result.error).toContain('No agent found');
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

  describe('middleware and DHT facade', () => {
    it('should proxy middleware methods to p2p network', () => {
      const middleware = {
        name: 'test-middleware',
        priority: 10,
        process: vi.fn().mockResolvedValue({ action: 'continue' })
      };

      f2a.useMiddleware(middleware as any);
      expect(f2a.listMiddlewares()).toEqual(['test-middleware']);
      expect(f2a.removeMiddleware('test-middleware')).toBe(true);
    });

    it('should proxy dht methods to p2p network', async () => {
      const lookup = await f2a.findPeerViaDHT('peer-id');
      expect(lookup.success).toBe(false);
      expect(lookup.error?.code).toBe('DHT_NOT_AVAILABLE');
      expect(f2a.getDHTPeerCount()).toBe(0);
      expect(f2a.isDHTEnabled()).toBe(false);
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

  describe('handleTaskRequest', () => {
    it('应该拒绝不支持的 capability 任务', async () => {
      const sendTaskResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendTaskResponseSpy;

      await (f2a as any).handleTaskRequest(
        {
          taskId: 'test-task-id',
          taskType: 'unsupported-capability',
          parameters: {}
        },
        'test-peer-id'
      );

      expect(sendTaskResponseSpy).toHaveBeenCalledWith(
        'test-peer-id',
        'test-task-id',
        'rejected',
        undefined,
        expect.stringContaining('Capability not supported')
      );
    });

    it('应该成功执行有 handler 的任务', async () => {
      const mockHandler = vi.fn().mockResolvedValue({ result: 'success' });
      f2a.registerCapability(
        { name: 'test-cap', description: 'Test', tools: [] },
        mockHandler
      );

      const sendTaskResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendTaskResponseSpy;

      await (f2a as any).handleTaskRequest(
        {
          taskId: 'test-task-id',
          taskType: 'test-cap',
          parameters: { param: 'value' }
        },
        'test-peer-id'
      );

      expect(mockHandler).toHaveBeenCalledWith({ param: 'value' });
      expect(sendTaskResponseSpy).toHaveBeenCalledWith(
        'test-peer-id',
        'test-task-id',
        'success',
        { result: 'success' }
      );
    });

    it('应该处理任务执行失败的情况', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Task failed'));
      f2a.registerCapability(
        { name: 'test-cap', description: 'Test', tools: [] },
        mockHandler
      );

      const sendTaskResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendTaskResponseSpy;

      await (f2a as any).handleTaskRequest(
        {
          taskId: 'test-task-id',
          taskType: 'test-cap',
          parameters: {}
        },
        'test-peer-id'
      );

      expect(sendTaskResponseSpy).toHaveBeenCalledWith(
        'test-peer-id',
        'test-task-id',
        'error',
        undefined,
        'Task failed'
      );
    });

    it('应该处理非 Error 类型的异常', async () => {
      const mockHandler = vi.fn().mockRejectedValue('String error');
      f2a.registerCapability(
        { name: 'test-cap', description: 'Test', tools: [] },
        mockHandler
      );

      const sendTaskResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendTaskResponseSpy;

      await (f2a as any).handleTaskRequest(
        {
          taskId: 'test-task-id',
          taskType: 'test-cap',
          parameters: {}
        },
        'test-peer-id'
      );

      expect(sendTaskResponseSpy).toHaveBeenCalledWith(
        'test-peer-id',
        'test-task-id',
        'error',
        undefined,
        'String error'
      );
    });

    it('应该在没有 handler 时不自动响应', async () => {
      f2a.registerCapability(
        { name: 'test-cap', description: 'Test', tools: [] },
        // 不提供 handler
        undefined as any
      );

      const sendTaskResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendTaskResponseSpy;

      await (f2a as any).handleTaskRequest(
        {
          taskId: 'test-task-id',
          taskType: 'test-cap',
          parameters: {}
        },
        'test-peer-id'
      );

      // 不应该调用 sendTaskResponse，等待手动响应
      expect(sendTaskResponseSpy).not.toHaveBeenCalled();
    });
  });

  describe('task:request event', () => {
    it('应该在收到任务请求时触发 task:request 事件', async () => {
      const eventPromise = new Promise((resolve) => {
        f2a.on('task:request', (event) => {
          resolve(event);
        });
      });

      f2a.registerCapability(
        { name: 'test-cap', description: 'Test', tools: [] },
        async () => 'result'
      );

      (f2a as any).handleTaskRequest(
        {
          taskId: 'test-task-id',
          taskType: 'test-cap',
          parameters: {}
        },
        'test-peer-id'
      );

      const event = await eventPromise;
      expect(event).toBeDefined();
      expect((event as any).taskId).toBe('test-task-id');
    });
  });
});
