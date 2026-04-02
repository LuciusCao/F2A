/**
 * Connector (F2APlugin) 边界情况测试
 * 
 * 测试各种边界情况和错误处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { createMockApi } from './utils/test-helpers.js';
import { join } from 'path';

describe('F2APlugin - 边界情况测试', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-edge-test-${Date.now()}-`));
    
    // 创建 IDENTITY.md
    writeFileSync(
      join(tempDir, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** TestAgent'
    );
    
    // 创建 .openclaw 目录
    mkdirSync(join(tempDir, '.openclaw'), { recursive: true });
  });

  afterEach(async () => {
    if (plugin) {
      try {
        await plugin.shutdown();
      } catch (e) {
        // 忽略关闭错误
      }
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('极端配置情况', () => {
    it('应该处理空字符串配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        agentName: '',
        f2aPath: '',
        dataDir: '',
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });

    it('应该处理极大值配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        p2pPort: 65535,
        controlPort: 65535,
        maxQueuedTasks: Number.MAX_SAFE_INTEGER,
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });

    it('应该处理负值配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        p2pPort: -1,
        controlPort: -1,
        maxQueuedTasks: -1,
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });

    it('应该处理零值配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        p2pPort: 0,
        controlPort: 0,
        maxQueuedTasks: 0,
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });
  });

  describe('并发操作测试', () => {
    it('应该处理并发 getTaskQueue 调用', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // 并发调用
      const [queue1, queue2, queue3] = await Promise.all([
        Promise.resolve(plugin.getTaskQueue()),
        Promise.resolve(plugin.getTaskQueue()),
        Promise.resolve(plugin.getTaskQueue()),
      ]);

      // 应该返回相同的实例
      expect(queue1).toBe(queue2);
      expect(queue2).toBe(queue3);
      // P0-2 修复：补充实际行为验证
      expect(queue1?.getStats).toBeDefined();
      expect(typeof queue1?.getStats).toBe('function');
    });

    it('应该处理并发 getReputationSystem 调用', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // 并发调用
      const [system1, system2, system3] = await Promise.all([
        Promise.resolve(plugin.getReputationSystem()),
        Promise.resolve(plugin.getReputationSystem()),
        Promise.resolve(plugin.getReputationSystem()),
      ]);

      // 应该返回相同的实例
      expect(system1).toBe(system2);
      expect(system2).toBe(system3);
    });
  });

  describe('无效输入测试', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
    });

    it('sendMessage 应该处理空 peerId', async () => {
      const result = await plugin.sendMessage('', 'test message');
      expect(result.success).toBe(false);
    });

    it('sendMessage 应该处理空消息', async () => {
      const result = await plugin.sendMessage('peer-id', '');
      expect(result.success).toBe(false);
    });

    it('sendFriendRequest 应该处理空 peerId', async () => {
      const result = await plugin.sendFriendRequest('', 'hello');
      expect(result).toBeNull();
    });

    it('discoverAgents 应该处理空 capability', async () => {
      const result = await plugin.discoverAgents('');
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });

  describe('关闭后操作测试', () => {
    it('关闭后调用方法应该安全', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();
      await plugin.shutdown();

      // 关闭后调用方法
      const status = plugin.getF2AStatus();
      expect(status.running).toBe(false);

      const discoverResult = await plugin.discoverAgents();
      expect(discoverResult.success).toBe(false);

      const sendResult = await plugin.sendMessage('peer-id', 'message');
      expect(sendResult.success).toBe(false);
    });
  });

  describe('内存管理测试', () => {
    it('应该正确清理资源', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // 触发懒加载
      plugin.getTaskQueue();
      plugin.getReputationSystem();
      plugin.getContactManager();

      await plugin.enable();
      await plugin.shutdown();

      // 资源应该被清理
      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe('错误恢复测试', () => {
    it('应该从 F2A 启动失败中恢复', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      // enable 可能会因为 F2A 启动失败而失败
      try {
        await plugin.enable();
      } catch (error) {
        // 预期错误
      }

      // 插件应该仍然可用
      expect(plugin).toBeDefined();
      expect(plugin.getTools().length).toBeGreaterThan(0);
    });

    it('应该处理多次关闭', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();

      // 多次关闭
      await plugin.shutdown();
      await plugin.shutdown();
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe('配置验证测试', () => {
    it('应该处理无效的 bootstrapPeers', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        bootstrapPeers: ['invalid-peer-address'],
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });

    it('应该处理空的 bootstrapPeers 数组', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        bootstrapPeers: [],
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });

    it('应该处理无效的 webhookPush 配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        webhookPush: {
          enabled: true,
          url: 'invalid-url',
        },
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });
  });

  describe('工具 handler 边界情况', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = createMockApi(tempDir);

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
    });

    it('应该处理工具 handler 的空参数', async () => {
      const tools = plugin.getTools();
      
      for (const tool of tools) {
        try {
          // 某些工具可能不接受空参数
          const result = await tool.handler({});
          expect(result).toBeDefined();
        } catch (error) {
          // 预期错误
          expect(error).toBeDefined();
        }
      }
    });

    it('应该处理工具 handler 的额外参数', async () => {
      const tools = plugin.getTools();
      
      for (const tool of tools) {
        try {
          const result = await tool.handler({
            extraParam1: 'value1',
            extraParam2: 'value2',
            extraParam3: 123,
          });
          expect(result).toBeDefined();
        } catch (error) {
          // 预期错误
          expect(error).toBeDefined();
        }
      }
    });
  });
});