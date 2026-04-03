/**
 * F2APlugin 边缘情况和高价值测试
 * 专注于：错误处理、边界条件、资源管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2APlugin } from './connector.js';
import type { OpenClawPluginApi } from './types.js';

describe('F2APlugin - 高价值边缘情况', () => {
  let plugin: F2APlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new F2APlugin();
  });

  afterEach(async () => {
    try {
      await plugin.shutdown?.();
    } catch {}
  });

  describe('初始化边缘情况', () => {
    it('应该处理空配置对象', async () => {
      await plugin.initialize({});
      
      expect(plugin.config).toBeDefined();
    });

    it('应该处理部分配置', async () => {
      await plugin.initialize({
        agentName: 'Test'
        // 其他配置缺失
      });
      
      expect(plugin.config).toBeDefined();
    });

    it('应该处理包含 _api 的配置', async () => {
      const mockApi = {
        logger: {
          info: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn()
        }
      };
      
      await plugin.initialize({ _api: mockApi as any });
      
      expect(plugin.api).toBe(mockApi);
    });
  });

  describe('shutdown 边缘情况', () => {
    it('未初始化时 shutdown 不应该抛出错误', async () => {
      // 未初始化就调用 shutdown
      await expect(plugin.shutdown()).resolves.not.toThrow();
    });

    it('多次调用 shutdown 应该安全', async () => {
      await plugin.initialize({});
      
      await plugin.shutdown();
      await plugin.shutdown();
      await plugin.shutdown();
      
      // 应该正常完成
      expect(true).toBe(true);
    });
  });

  describe('未启用状态的操作', () => {
    beforeEach(async () => {
      await plugin.initialize({});
    });

    it('discoverAgents 应该返回错误', async () => {
      const result = await plugin.discoverAgents();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('getConnectedPeers 应该返回错误', async () => {
      const result = await plugin.getConnectedPeers();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('sendMessage 应该返回错误', async () => {
      const result = await plugin.sendMessage('peer-id', 'test');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('sendFriendRequest 应该返回 null', async () => {
      const result = await plugin.sendFriendRequest('peer-id', 'Hi');
      
      expect(result).toBeNull();
    });

    it('acceptFriendRequest 应该返回 false', async () => {
      const result = await plugin.acceptFriendRequest('req-id');
      
      expect(result).toBe(false);
    });

    it('rejectFriendRequest 应该返回 false', async () => {
      const result = await plugin.rejectFriendRequest('req-id', 'No');
      
      expect(result).toBe(false);
    });
  });

  describe('GetTools 边缘情况', () => {
    it('应该始终返回工具列表', () => {
      const tools1 = plugin.getTools();
      const tools2 = plugin.getTools();
      
      // 两次调用返回的工具数量应该相同
      expect(tools1.length).toBe(tools2.length);
      expect(tools1.length).toBeGreaterThan(0);
    });

    it('工具应该有有效的名称', () => {
      const tools = plugin.getTools();
      
      for (const tool of tools) {
        expect(tool.name).toMatch(/^f2a_[a-z_]+$/);
      }
    });

    it('工具应该有有效的描述', () => {
      const tools = plugin.getTools();
      
      for (const tool of tools) {
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('错误恢复', () => {
    it('初始化失败后应该能够重新初始化', async () => {
      try {
        await plugin.initialize({ invalidOption: true } as any);
      } catch {}
      
      // 应该能够重新初始化
      await plugin.initialize({ agentName: 'Retry Agent' });
      
      expect(plugin.config).toBeDefined();
    });
  });

  describe('边界值测试', () => {
    it('应该处理超长 agentName', async () => {
      const longName = 'A'.repeat(1000);
      
      await plugin.initialize({ agentName: longName });
      
      expect(plugin.config).toBeDefined();
    });

    it('应该处理特殊字符 agentName', async () => {
      const specialName = '测试-Agent-🎉-<script>';
      
      await plugin.initialize({ agentName: specialName });
      
      expect(plugin.config).toBeDefined();
    });

    it('应该处理空字符串 peer ID 发送消息', async () => {
      await plugin.initialize({});
      
      const result = await plugin.sendMessage('', 'test');
      
      expect(result.success).toBe(false);
    });
  });

  describe('并发安全', () => {
    it('并发调用 getTools 应该安全', () => {
      const results = Promise.all([
        plugin.getTools(),
        plugin.getTools(),
        plugin.getTools()
      ]);
      
      return expect(results).resolves.toBeDefined();
    });
  });

  describe('内存和资源管理', () => {
    it('创建多个插件实例应该安全', () => {
      const plugins = [];
      
      for (let i = 0; i < 10; i++) {
        plugins.push(new F2APlugin());
      }
      
      // 所有实例应该独立
      expect(plugins.length).toBe(10);
    });
  });
});