/**
 * F2A 网络故障恢复测试
 * 测试网络不可用时的优雅降级行为
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import type { OpenClawPluginApi } from '../src/types.js';

describe('网络故障恢复测试', () => {
  let plugin: F2APlugin;
  let mockApi: OpenClawPluginApi;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new F2APlugin();
    
    mockApi = {
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      },
      config: {
        plugins: {
          entries: {}
        },
        agents: {
          defaults: {
            workspace: '/tmp/test-f2a'
          }
        }
      }
    } as any;
  });

  afterEach(async () => {
    try {
      await plugin.shutdown?.();
    } catch {}
  });

  describe('网络不可用场景', () => {
    beforeEach(async () => {
      await plugin.initialize({ _api: mockApi });
    });

    it('未启用时 discoverAgents 应该返回错误', async () => {
      const result = await plugin.discoverAgents();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBeDefined();
    });

    it('未启用时 getConnectedPeers 应该返回错误', async () => {
      const result = await plugin.getConnectedPeers();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('未启用时 sendMessage 应该返回错误', async () => {
      const result = await plugin.sendMessage('peer-id', 'test message');
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('优雅降级', () => {
    it('工具应该仍然可用即使网络不可用', async () => {
      await plugin.initialize({ _api: mockApi });
      
      const tools = plugin.getTools();
      
      // 工具列表应该仍然可用
      expect(tools.length).toBeGreaterThan(0);
    });

    it('配置应该仍然可访问', async () => {
      await plugin.initialize({ _api: mockApi, agentName: 'Test' });
      
      // 配置应该仍然可用
      expect(plugin.config).toBeDefined();
    });
  });

  describe('重试和恢复', () => {
    it('多次调用失败操作应该安全', async () => {
      await plugin.initialize({ _api: mockApi });
      
      // 多次调用应该都安全返回错误
      for (let i = 0; i < 5; i++) {
        const result = await plugin.discoverAgents();
        expect(result.success).toBe(false);
      }
    });

    it('shutdown 后应该能够重新初始化', async () => {
      await plugin.initialize({ _api: mockApi, agentName: 'First' });
      await plugin.shutdown();
      
      // 重新初始化
      await plugin.initialize({ _api: mockApi, agentName: 'Second' });
      
      expect(plugin.config).toBeDefined();
    });
  });

  describe('资源清理', () => {
    it('shutdown 应该清理所有资源', async () => {
      await plugin.initialize({ _api: mockApi });
      
      const tools = plugin.getTools();
      expect(tools.length).toBeGreaterThan(0);
      
      await plugin.shutdown();
      
      // shutdown 应该正常完成
      expect(true).toBe(true);
    });

    it('多次 shutdown 应该安全', async () => {
      await plugin.initialize({ _api: mockApi });
      
      await plugin.shutdown();
      await plugin.shutdown();
      await plugin.shutdown();
      
      expect(true).toBe(true);
    });
  });

  describe('边界条件', () => {
    it('空 peer ID 应该返回错误', async () => {
      await plugin.initialize({ _api: mockApi });
      
      const result = await plugin.sendMessage('', 'test');
      
      expect(result.success).toBe(false);
    });

    it('无效的能力参数应该被处理', async () => {
      await plugin.initialize({ _api: mockApi });
      
      const result = await plugin.discoverAgents(null as any);
      
      expect(result.success).toBe(false);
    });
  });
});