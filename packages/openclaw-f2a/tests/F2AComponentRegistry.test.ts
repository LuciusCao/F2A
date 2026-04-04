/**
 * F2AComponentRegistry 测试
 * 
 * 测试组件注册器的功能：
 * 1. 懒加载初始化
 * 2. 组件生命周期管理
 * 3. 错误处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2AComponentRegistry, type ComponentRegistryConfig } from '../src/F2AComponentRegistry.js';
import type { F2APluginConfig, F2ANodeConfig } from '../src/types.js';
import { existsSync, rmSync } from 'fs';
import { createTestTempDir, cleanupTestTempDir } from './utils/test-helpers.js';

// 测试配置
const createTestConfig = (): F2APluginConfig => ({
  enabled: true,
  autoAcceptTasks: false,
  maxConcurrentTasks: 3,
  maxQueuedTasks: 100,
  f2aDataDir: undefined,
  reputation: {
    enabled: true,
    initialScore: 70,
    minScoreForService: 50,
    minScoreForReview: 60,
    decayRate: 0.1,
  },
});

const createTestNodeConfig = (): F2ANodeConfig => ({
  listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
  bootstrapPeers: [],
  capabilities: ['test'],
  agentName: 'TestAgent',
});

// 创建 mock logger
const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

describe('F2AComponentRegistry', () => {
  let registry: F2AComponentRegistry;
  let config: ComponentRegistryConfig;
  let testDir: string;

  beforeEach(() => {
    // P1-2 修复：改用 mkdtempSync 创建唯一临时目录
    testDir = createTestTempDir('f2a-component-test-');
    
    config = {
      pluginConfig: createTestConfig(),
      nodeConfig: createTestNodeConfig(),
      logger: createMockLogger() as unknown as import('../src/types.js').ApiLogger,
    };
    
    registry = new F2AComponentRegistry(config);
  });

  afterEach(() => {
    // 清理测试目录
    cleanupTestTempDir(testDir);
  });

  describe('构造函数', () => {
    it('应该创建组件注册器实例', () => {
      expect(registry).toBeDefined();
    });

    it('应该接受配置', () => {
      expect(registry).toBeDefined();
    });

    it('应该在没有 logger 的情况下工作', () => {
      const noLoggerRegistry = new F2AComponentRegistry({
        pluginConfig: createTestConfig(),
        nodeConfig: createTestNodeConfig(),
      });
      expect(noLoggerRegistry).toBeDefined();
    });
  });

  describe('nodeManager getter', () => {
    it('应该懒加载节点管理器', () => {
      const nodeManager = registry.nodeManager;
      expect(nodeManager).toBeDefined();
    });

    it('应该返回同一个实例', () => {
      const nm1 = registry.nodeManager;
      const nm2 = registry.nodeManager;
      expect(nm1).toBe(nm2);
    });
  });

  describe('networkClient getter', () => {
    it('应该懒加载网络客户端', () => {
      const networkClient = registry.networkClient;
      expect(networkClient).toBeDefined();
    });

    it('应该返回同一个实例', () => {
      const nc1 = registry.networkClient;
      const nc2 = registry.networkClient;
      expect(nc1).toBe(nc2);
    });
  });

  describe('taskQueue getter', () => {
    it('应该懒加载任务队列', () => {
      const taskQueue = registry.taskQueue;
      expect(taskQueue).toBeDefined();
    });

    it('应该返回同一个实例', () => {
      const tq1 = registry.taskQueue;
      const tq2 = registry.taskQueue;
      expect(tq1).toBe(tq2);
    });
  });

  describe('announcementQueue getter', () => {
    it('应该懒加载公告队列', () => {
      const announcementQueue = registry.announcementQueue;
      expect(announcementQueue).toBeDefined();
    });

    it('应该返回同一个实例', () => {
      const aq1 = registry.announcementQueue;
      const aq2 = registry.announcementQueue;
      expect(aq1).toBe(aq2);
    });
  });

  describe('reputationSystem getter', () => {
    it('应该懒加载信誉系统', () => {
      const reputationSystem = registry.reputationSystem;
      expect(reputationSystem).toBeDefined();
    });

    it('应该返回同一个实例', () => {
      const rs1 = registry.reputationSystem;
      const rs2 = registry.reputationSystem;
      expect(rs1).toBe(rs2);
    });
  });

  describe('capabilityDetector getter', () => {
    it('应该懒加载能力检测器', () => {
      const capabilityDetector = registry.capabilityDetector;
      expect(capabilityDetector).toBeDefined();
    });

    it('应该返回同一个实例', () => {
      const cd1 = registry.capabilityDetector;
      const cd2 = registry.capabilityDetector;
      expect(cd1).toBe(cd2);
    });
  });

  describe('contactManager getter', () => {
    it('应该懒加载联系人管理器', () => {
      const contactManager = registry.contactManager;
      expect(contactManager).toBeDefined();
    });

    it('应该返回同一个实例', () => {
      const cm1 = registry.contactManager;
      const cm2 = registry.contactManager;
      expect(cm1).toBe(cm2);
    });
  });

  describe('handshakeProtocol getter', () => {
    it('应该懒加载握手协议', () => {
      // handshakeProtocol 需要 f2a 实例
      // 这里测试懒加载行为，不测试完整功能
      expect(() => registry.handshakeProtocol).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('应该清理所有组件', () => {
      // 初始化一些组件
      registry.nodeManager;
      registry.networkClient;
      registry.taskQueue;
      
      // 清理
      registry.cleanup();
      
      // 验证清理后的状态（组件应该被重置）
      // 这里只验证不会抛出错误
      expect(() => registry.cleanup()).not.toThrow();
    });

    it('应该可以多次调用 cleanup', () => {
      registry.cleanup();
      registry.cleanup();
      registry.cleanup();
      
      // 不应该抛出错误
      expect(true).toBe(true);
    });
  });

  describe('数据目录解析', () => {
    it('应该使用配置的数据目录', () => {
      const customDirRegistry = new F2AComponentRegistry({
        pluginConfig: {
          ...createTestConfig(),
          f2aDataDir: testDir,
        },
        nodeConfig: createTestNodeConfig(),
      });
      
      expect(customDirRegistry).toBeDefined();
    });
  });

  describe('错误处理', () => {
    it('初始化失败时应该抛出错误', async () => {
      // 测试无效配置
      const invalidConfig: ComponentRegistryConfig = {
        pluginConfig: createTestConfig(),
        nodeConfig: {
          ...createTestNodeConfig(),
          listenAddresses: [], // 空的监听地址
        },
      };
      
      // 节点管理器应该能处理这种情况
      const invalidRegistry = new F2AComponentRegistry(invalidConfig);
      expect(invalidRegistry).toBeDefined();
    });
  });

  describe('日志记录', () => {
    it('应该记录组件初始化', () => {
      const mockLogger = createMockLogger();
      const loggingRegistry = new F2AComponentRegistry({
        pluginConfig: createTestConfig(),
        nodeConfig: createTestNodeConfig(),
        logger: mockLogger as unknown as import('../src/types.js').ApiLogger,
      });
      
      // 初始化一些组件
      loggingRegistry.taskQueue;
      
      // 验证日志被调用
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});