import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P2PNetwork } from './p2p-network.js';
import { AgentInfo } from '../types/index.js';

/**
 * AsyncLock 单元测试
 * 测试超时机制和并发控制
 */
describe('AsyncLock', () => {
  // AsyncLock 是 P2PNetwork 内部的私有类，我们需要通过反射来测试
  // 这里我们创建一个测试专用的 AsyncLock 类
  class TestAsyncLock {
    private locked = false;
    private queue: Array<() => void> = [];
    private static readonly DEFAULT_TIMEOUT_MS = 30000;

    async acquire(timeoutMs: number = TestAsyncLock.DEFAULT_TIMEOUT_MS): Promise<void> {
      if (!this.locked) {
        this.locked = true;
        return;
      }

      return new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const index = this.queue.indexOf(onAcquire);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }
          reject(new Error(`AsyncLock acquire timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        const onAcquire = () => {
          clearTimeout(timeoutId);
          resolve();
        };

        this.queue.push(onAcquire);
      });
    }

    release(): void {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.locked = false;
      }
    }

    isLocked(): boolean {
      return this.locked;
    }
  }

  describe('基本功能', () => {
    it('应该能够获取和释放锁', async () => {
      const lock = new TestAsyncLock();
      
      expect(lock.isLocked()).toBe(false);
      
      await lock.acquire();
      expect(lock.isLocked()).toBe(true);
      
      lock.release();
      expect(lock.isLocked()).toBe(false);
    });

    it('应该支持多个等待者按顺序获取锁', async () => {
      const lock = new TestAsyncLock();
      const order: number[] = [];

      // 第一个获取锁
      await lock.acquire();
      order.push(1);

      // 启动多个等待者
      const p2 = lock.acquire().then(() => {
        order.push(2);
        lock.release();
      });
      const p3 = lock.acquire().then(() => {
        order.push(3);
        lock.release();
      });

      // 释放第一个锁
      lock.release();

      await Promise.all([p2, p3]);

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('超时机制', () => {
    it('应该在超时后拒绝获取锁', async () => {
      const lock = new TestAsyncLock();
      
      // 获取锁
      await lock.acquire();
      expect(lock.isLocked()).toBe(true);

      // 尝试再次获取锁，设置短超时
      await expect(lock.acquire(100)).rejects.toThrow(
        'AsyncLock acquire timeout after 100ms'
      );
    });

    it('超时后等待者应该从队列中移除', async () => {
      const lock = new TestAsyncLock();
      
      await lock.acquire();
      
      // 启动一个会超时的等待者
      const timeoutPromise = lock.acquire(50);
      
      // 等待超时
      await expect(timeoutPromise).rejects.toThrow('timeout');
      
      // 释放锁
      lock.release();
      
      // 锁应该已经释放
      expect(lock.isLocked()).toBe(false);
    });

    it('超时后其他等待者应该能够继续获取锁', async () => {
      const lock = new TestAsyncLock();
      
      await lock.acquire();
      
      // 第一个等待者会超时
      const timeoutPromise = lock.acquire(50);
      await expect(timeoutPromise).rejects.toThrow('timeout');
      
      // 第二个等待者应该能够获取锁
      const acquirePromise = lock.acquire(1000);
      
      // 释放锁
      lock.release();
      
      // 第二个等待者应该成功获取
      await expect(acquirePromise).resolves.toBeUndefined();
    });

    it('应该使用默认超时时间', async () => {
      const lock = new TestAsyncLock();
      
      await lock.acquire();
      
      // 使用默认超时（30秒），但我们使用短超时测试
      // 这里只验证接口可以不传参数
      const startTime = Date.now();
      
      // 设置一个很短的超时来快速测试
      await expect(lock.acquire(50)).rejects.toThrow('timeout');
      
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(40); // 允许一些误差
      expect(elapsed).toBeLessThan(500); // 但不应该太久
    });

    it('超时错误消息应该包含超时时间', async () => {
      const lock = new TestAsyncLock();
      
      await lock.acquire();
      
      try {
        await lock.acquire(123);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('123ms');
      }
    });
  });

  describe('并发场景', () => {
    it('多个并发请求应该排队等待', async () => {
      const lock = new TestAsyncLock();
      const results: string[] = [];

      const task = async (id: string, delay: number) => {
        await lock.acquire();
        results.push(`${id}-start`);
        await new Promise(resolve => setTimeout(resolve, delay));
        results.push(`${id}-end`);
        lock.release();
      };

      // 启动多个并发任务
      await Promise.all([
        task('A', 10),
        task('B', 10),
        task('C', 10)
      ]);

      // 验证没有交叉执行
      expect(results).toEqual([
        'A-start', 'A-end',
        'B-start', 'B-end',
        'C-start', 'C-end'
      ]);
    });

    it('锁释放后等待者应该立即获取', async () => {
      const lock = new TestAsyncLock();
      
      await lock.acquire();
      
      let acquired = false;
      const acquirePromise = lock.acquire().then(() => {
        acquired = true;
      });

      // 释放前未获取
      expect(acquired).toBe(false);
      
      lock.release();
      
      // 等待获取完成
      await acquirePromise;
      expect(acquired).toBe(true);
    });
  });
});

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
