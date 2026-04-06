/**
 * Connector (F2APlugin) 更多测试
 * 
 * 覆盖 enable、shutdown 等核心流程
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('F2APlugin - enable/shutdown 流程', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-enable-test-${Date.now()}-`));
    
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

  describe('enable 方法', () => {
    it('应该能够启用插件（无 autoStart）', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false, // 不自动启动 F2A
        },
      });

      // enable 应该设置 _initialized 为 true
      await plugin.enable();
      
      expect(plugin.isInitialized()).toBe(true);
    });

    it('多次启用应该跳过', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false,
        },
      });

      await plugin.enable();
      await plugin.enable(); // 第二次应该跳过
      
      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该支持 webhook 配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false,
          webhook: {
            port: 19004,
          },
        },
      });

      await plugin.enable();
      
      expect(plugin.isInitialized()).toBe(true);
    });
  });

  describe('shutdown 方法', () => {
    it('应该正确关闭所有资源', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false,
        },
      });

      await plugin.enable();
      
      // 关闭
      await plugin.shutdown();
      
      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该能够多次调用 shutdown', async () => {
      plugin = new F2APlugin();
      
      await plugin.shutdown();
      await plugin.shutdown();
      await plugin.shutdown();
    });

    it('未初始化时也能关闭', async () => {
      plugin = new F2APlugin();
      await plugin.shutdown();
    });
  });

  describe('f2aClient 接口', () => {
    it('discoverAgents 应该返回错误当未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin.f2aClient.discoverAgents();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('未初始化');
    });

    it('getConnectedPeers 应该返回错误当未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin.f2aClient.getConnectedPeers();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('未初始化');
    });
  });

  describe('getF2A 状态', () => {
    it('应该返回 undefined 当 F2A 未初始化', () => {
      plugin = new F2APlugin();
      
      const f2a = plugin.getF2A();
      expect(f2a).toBeUndefined();
    });
  });

  describe('getReputationSystem', () => {
    it('应该返回信誉系统实例（初始化后）', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();

      // getReputationSystem 是通过 toolHandlers 访问的
      const tools = plugin.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('工具测试', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false,
        },
      });

      await plugin.enable();
    });

    it('应该包含所有网络工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_discover');
      expect(toolNames).toContain('f2a_send');
      expect(toolNames).toContain('f2a_broadcast');
      expect(toolNames).toContain('f2a_status');
    });

    it('应该包含所有任务工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_poll_tasks');
      expect(toolNames).toContain('f2a_submit_result');
      expect(toolNames).toContain('f2a_task_stats');
    });

    it('应该包含所有公告工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_announce');
      expect(toolNames).toContain('f2a_list_announcements');
      expect(toolNames).toContain('f2a_claim');
      expect(toolNames).toContain('f2a_manage_claims');
      expect(toolNames).toContain('f2a_my_claims');
    });

    it('应该包含所有信誉工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_reputation');
    });

    it('应该包含所有通讯录工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_contacts');
      expect(toolNames).toContain('f2a_contact_groups');
      expect(toolNames).toContain('f2a_friend_request');
      expect(toolNames).toContain('f2a_pending_requests');
      expect(toolNames).toContain('f2a_contacts_export');
      expect(toolNames).toContain('f2a_contacts_import');
    });

    it('应该包含所有评审工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_estimate_task');
      expect(toolNames).toContain('f2a_review_task');
      expect(toolNames).toContain('f2a_get_reviews');
      expect(toolNames).toContain('f2a_get_capabilities');
    });
  });

  describe('配置测试', () => {
    it('应该支持 minReputation 配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false,
          minReputation: 50,
        },
      });

      const tools = plugin.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该支持 p2pPort 配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false,
          p2pPort: 4001,
        },
      });

      const tools = plugin.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该支持 bootstrapPeers 配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {
          autoStart: false,
          bootstrapPeers: ['/ip4/1.2.3.4/tcp/4001'],
        },
      });

      const tools = plugin.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });
});