/**
 * F2A 集成测试
 * 测试多组件协作场景（简化版本，不需要完整 F2A 环境）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from './connector.js';
import type { OpenClawPluginApi } from './types.js';

describe('F2A 集成测试', () => {
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
      },
      registerTool: vi.fn(),
      registerService: vi.fn()
    } as any;
  });

  afterEach(async () => {
    try {
      await plugin.shutdown?.();
    } catch {}
  });

  describe('插件完整生命周期', () => {
    it('应该完成初始化 -> 获取工具 -> 关闭的完整流程', async () => {
      // 1. 初始化
      await plugin.initialize({ _api: mockApi });
      expect(plugin.config).toBeDefined();

      // 2. 获取工具
      const tools = plugin.getTools();
      expect(tools.length).toBeGreaterThan(0);

      // 3. 关闭
      await plugin.shutdown();
      
      // 流程应该正常完成
      expect(true).toBe(true);
    });

    it('应该能够多次初始化和关闭', async () => {
      for (let i = 0; i < 3; i++) {
        const p = new F2APlugin();
        await p.initialize({ agentName: `Agent-${i}` });
        const tools = p.getTools();
        expect(tools.length).toBeGreaterThan(0);
        await p.shutdown();
      }
    });
  });

  describe('工具执行流程', () => {
    beforeEach(async () => {
      await plugin.initialize({ _api: mockApi });
    });

    it('discoverAgents 工具应该存在', () => {
      const tools = plugin.getTools();
      const discoverTool = tools.find(t => t.name === 'f2a_discover');
      
      expect(discoverTool).toBeDefined();
      expect(discoverTool?.description).toContain('Agent');
    });

    it('delegate 工具应该存在', () => {
      const tools = plugin.getTools();
      const delegateTool = tools.find(t => t.name === 'f2a_delegate');
      
      expect(delegateTool).toBeDefined();
    });

    it('status 工具应该存在', () => {
      const tools = plugin.getTools();
      const statusTool = tools.find(t => t.name === 'f2a_status');
      
      expect(statusTool).toBeDefined();
    });
  });

  describe('配置验证', () => {
    it('应该正确处理完整配置', async () => {
      const fullConfig = {
        agentName: 'Test Agent',
        autoStart: false,
        webhookPort: 9999,
        dataDir: '/tmp/test-data',
        maxQueuedTasks: 50,
        _api: mockApi
      };

      await plugin.initialize(fullConfig);
      
      expect(plugin.config).toBeDefined();
    });

    it('应该正确处理最小配置', async () => {
      await plugin.initialize({ _api: mockApi });
      
      expect(plugin.config).toBeDefined();
    });
  });

  describe('错误场景处理', () => {
    it('未初始化时调用操作应该优雅处理', async () => {
      // 未初始化
      const result = await plugin.discoverAgents();
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('初始化后未启用时调用操作应该优雅处理', async () => {
      await plugin.initialize({ _api: mockApi });
      
      const result = await plugin.getConnectedPeers();
      
      expect(result.success).toBe(false);
    });
  });

  describe('API 兼容性', () => {
    it('应该兼容 OpenClawPluginApi 接口', async () => {
      await plugin.initialize({ _api: mockApi });
      
      // 验证 API 引用保存正确
      expect(plugin.api).toBe(mockApi);
    });

    it('getTools 返回的工具应该符合 OpenClaw 工具格式', async () => {
      await plugin.initialize({ _api: mockApi });
      
      const tools = plugin.getTools();
      
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('parameters');
        expect(tool).toHaveProperty('handler');
        expect(typeof tool.handler).toBe('function');
      }
    });
  });
});