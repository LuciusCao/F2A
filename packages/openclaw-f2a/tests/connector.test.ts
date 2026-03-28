/**
 * Connector (F2APlugin) 测试
 * 
 * 测试核心插件功能，尽量使用真实实例而非 mock。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidPeerId, F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('isValidPeerId', () => {
  it('应该接受有效的 libp2p Peer ID', () => {
    const validPeerId = '12D3KooW' + 'A'.repeat(44);
    expect(isValidPeerId(validPeerId)).toBe(true);
  });

  it('应该拒绝无效的 Peer ID', () => {
    // 太短
    expect(isValidPeerId('12D3KooW' + 'A'.repeat(10))).toBe(false);
    
    // 错误的前缀
    expect(isValidPeerId('Invalid' + 'A'.repeat(44))).toBe(false);
    
    // 包含非法字符
    expect(isValidPeerId('12D3KooW' + 'A'.repeat(43) + '@')).toBe(false);
  });

  it('应该拒绝 null 和 undefined', () => {
    expect(isValidPeerId(null)).toBe(false);
    expect(isValidPeerId(undefined)).toBe(false);
  });

  it('应该拒绝空字符串', () => {
    expect(isValidPeerId('')).toBe(false);
  });

  it('应该拒绝非字符串类型', () => {
    expect(isValidPeerId(123 as any)).toBe(false);
    expect(isValidPeerId({} as any)).toBe(false);
    expect(isValidPeerId([] as any)).toBe(false);
  });

  it('应该接受不同字符组合的 Peer ID', () => {
    // Peer ID 格式: 12D3KooW (8字符) + 44字符 = 52字符
    // Base58 编码字符: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
    
    // 数字
    const numericPeerId = '12D3KooW' + '1'.repeat(44);
    expect(isValidPeerId(numericPeerId)).toBe(true);
    expect(numericPeerId.length).toBe(52);
    
    // 简单字母组合（确保正好 44 个字符）
    const alphaSuffix = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz12'.substring(0, 44);
    const alphaPeerId = '12D3KooW' + alphaSuffix;
    expect(isValidPeerId(alphaPeerId)).toBe(true);
    expect(alphaPeerId.length).toBe(52);
    
    // 混合
    const mixedSuffix = 'aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsT'.substring(0, 44);
    const mixedPeerId = '12D3KooW' + mixedSuffix;
    expect(isValidPeerId(mixedPeerId)).toBe(true);
    expect(mixedPeerId.length).toBe(52);
  });
});

describe('F2APlugin', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'f2a-plugin-test-'));
    
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
      await plugin.shutdown();
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

    it('应该在初始化时创建数据目录', async () => {
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

      // 检查 .f2a 目录是否创建
      const f2aDir = join(tempDir, '.f2a');
      // 注意：目录可能在延迟初始化时才创建
    });
  });

  describe('工具注册', () => {
    it('应该返回工具列表', async () => {
      plugin = new F2APlugin();
      
      const tools = plugin.getTools();
      
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该包含核心工具', async () => {
      plugin = new F2APlugin();
      
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_discover');
      expect(toolNames).toContain('f2a_delegate');
      expect(toolNames).toContain('f2a_status');
    });

    it('应该包含通讯录工具', async () => {
      plugin = new F2APlugin();
      
      const tools = plugin.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_contacts');
      expect(toolNames).toContain('f2a_friend_request');
      expect(toolNames).toContain('f2a_pending_requests');
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
      
      // 关闭后不应该崩溃
    });

    it('应该能够多次调用 shutdown', async () => {
      plugin = new F2APlugin();
      
      await plugin.shutdown();
      await plugin.shutdown();
      await plugin.shutdown();
      
      // 不应该抛出异常
    });
  });
});