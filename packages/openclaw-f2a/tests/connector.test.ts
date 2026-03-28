/**
 * Connector (F2APlugin) 测试
 * 
 * 测试核心插件功能，尽量使用真实实例而非 mock。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidPeerId, F2APlugin } from '../src/connector.js';
import { isValidPeerId as isValidPeerIdHelper } from '../src/connector-helpers.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('isValidPeerId', () => {
  it('应该接受有效的 libp2p Peer ID', () => {
    const validPeerId = '12D3KooW' + 'A'.repeat(44);
    expect(isValidPeerIdHelper(validPeerId)).toBe(true);
  });

  it('应该拒绝无效的 Peer ID', () => {
    // 太短
    expect(isValidPeerIdHelper('12D3KooW' + 'A'.repeat(10))).toBe(false);
    
    // 错误的前缀
    expect(isValidPeerIdHelper('Invalid' + 'A'.repeat(44))).toBe(false);
    
    // 包含非法字符
    expect(isValidPeerIdHelper('12D3KooW' + 'A'.repeat(43) + '@')).toBe(false);
  });

  it('应该拒绝 null 和 undefined', () => {
    expect(isValidPeerIdHelper(null)).toBe(false);
    expect(isValidPeerIdHelper(undefined)).toBe(false);
  });

  it('应该拒绝空字符串', () => {
    expect(isValidPeerIdHelper('')).toBe(false);
  });

  it('应该拒绝非字符串类型', () => {
    expect(isValidPeerIdHelper(123 as any)).toBe(false);
    expect(isValidPeerIdHelper({} as any)).toBe(false);
    expect(isValidPeerIdHelper([] as any)).toBe(false);
  });

  it('应该接受不同字符组合的 Peer ID', () => {
    // Peer ID 格式: 12D3KooW (8字符) + 44字符 = 52字符
    // Base58 编码字符: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
    
    // 数字
    const numericPeerId = '12D3KooW' + '1'.repeat(44);
    expect(isValidPeerIdHelper(numericPeerId)).toBe(true);
    expect(numericPeerId.length).toBe(52);
    
    // 简单字母组合（确保正好 44 个字符）
    const alphaSuffix = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz12'.substring(0, 44);
    const alphaPeerId = '12D3KooW' + alphaSuffix;
    expect(isValidPeerIdHelper(alphaPeerId)).toBe(true);
    expect(alphaPeerId.length).toBe(52);
    
    // 混合
    const mixedSuffix = 'aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsT'.substring(0, 44);
    const mixedPeerId = '12D3KooW' + mixedSuffix;
    expect(isValidPeerIdHelper(mixedPeerId)).toBe(true);
    expect(mixedPeerId.length).toBe(52);
  });
});

describe('F2APlugin', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-test-${Date.now()}-`));
    
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

  describe('初始化', () => {
    it('应该能够创建插件实例', () => {
      plugin = new F2APlugin();
      expect(plugin).toBeDefined();
    });

    it('应该能够初始化插件', async () => {
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
        config: {},
      });

      expect(plugin).toBeDefined();
    });

    it('应该能够使用自定义配置初始化', async () => {
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
        config: {
          minReputation: 50,
        },
      });

      expect(plugin).toBeDefined();
    });
  });

  describe('工具注册', () => {
    beforeEach(() => {
      plugin = new F2APlugin();
    });

    it('应该返回工具列表', () => {
      const tools = plugin.getTools();
      
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该包含核心工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_discover');
      expect(toolNames).toContain('f2a_delegate');
      expect(toolNames).toContain('f2a_status');
    });

    it('应该包含通讯录工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_contacts');
      expect(toolNames).toContain('f2a_friend_request');
      expect(toolNames).toContain('f2a_pending_requests');
    });

    it('应该包含信誉管理工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_reputation');
    });

    it('应该包含任务管理工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_poll_tasks');
      expect(toolNames).toContain('f2a_submit_result');
      expect(toolNames).toContain('f2a_task_stats');
    });

    it('应该包含公告工具', () => {
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_announce');
      expect(toolNames).toContain('f2a_list_announcements');
      expect(toolNames).toContain('f2a_claim');
    });

    it('工具应该有正确的描述', () => {
      const tools = plugin.getTools();
      const discoverTool = tools.find(t => t.name === 'f2a_discover');
      
      expect(discoverTool?.description).toBeDefined();
      expect(discoverTool?.description.length).toBeGreaterThan(0);
    });

    it('工具应该有参数定义', () => {
      const tools = plugin.getTools();
      const delegateTool = tools.find(t => t.name === 'f2a_delegate');
      
      expect(delegateTool?.parameters).toBeDefined();
    });
  });

  describe('启用和禁用', () => {
    it('应该能够启用插件', async () => {
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
        config: {},
      });

      await plugin.enable();
      
      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该能够检查初始化状态', () => {
      plugin = new F2APlugin();
      expect(plugin.isInitialized()).toBe(false);
    });

    it('多次启用不应该报错', async () => {
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
        config: {},
      });

      await plugin.enable();
      await plugin.enable();
    });
  });

  describe('shutdown', () => {
    it('应该能够正常关闭', async () => {
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
        config: {},
      });

      await plugin.shutdown();
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

  describe('工具执行', () => {
    it('应该能够获取 F2A 状态', async () => {
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
        config: {},
      });

      const status = plugin.getF2AStatus();
      expect(status).toBeDefined();
    });
  });
});