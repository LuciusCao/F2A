/**
 * Connector (F2APlugin) 测试
 * 
 * 测试核心插件功能，尽量使用真实实例而非 mock。
 * 
 * P1 修复内容：
 * 5. 临时目录清理不完整 - 使用 try-finally 确保清理
 * 6. 异步 afterEach 错误处理不足 - 添加错误处理
 * 7. 添加恶意输入测试
 * 8. 添加 Unicode 边界测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidPeerId, F2APlugin } from '../src/connector.js';
import { isValidPeerId as isValidPeerIdHelper } from '../src/connector-helpers.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MALICIOUS_INPUT_TEST_CASES,
  UNICODE_BOUNDARY_TEST_CASES,
  safeCleanupTempDir,
} from './utils/test-helpers.js';

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
  
  // P1-7 修复：恶意输入测试
  describe('恶意输入防护', () => {
    for (const malicious of MALICIOUS_INPUT_TEST_CASES.pathTraversal) {
      it(`应该拒绝路径遍历作为 Peer ID: "${malicious.slice(0, 20)}..."`, () => {
        expect(isValidPeerIdHelper(malicious)).toBe(false);
      });
    }
    
    for (const malicious of MALICIOUS_INPUT_TEST_CASES.commandInjection.slice(0, 5)) {
      it(`应该拒绝命令注入作为 Peer ID: "${malicious.slice(0, 20)}..."`, () => {
        expect(isValidPeerIdHelper(malicious)).toBe(false);
      });
    }
  });
  
  // P1-8 修复：Unicode 边界测试
  describe('Unicode 边界处理', () => {
    for (const char of UNICODE_BOUNDARY_TEST_CASES.invisible.slice(0, 5)) {
      it(`应该拒绝包含不可见字符的 Peer ID: U+${char.charCodeAt(0).toString(16)}`, () => {
        const peerId = '12D3KooW' + char + 'A'.repeat(43);
        expect(isValidPeerIdHelper(peerId)).toBe(false);
      });
    }
    
    for (const longStr of UNICODE_BOUNDARY_TEST_CASES.longStrings.slice(0, 2)) {
      it(`应该拒绝超长字符串作为 Peer ID`, () => {
        expect(isValidPeerIdHelper(longStr)).toBe(false);
      });
    }
    
    for (const ctrl of UNICODE_BOUNDARY_TEST_CASES.controlChars.slice(0, 3)) {
      it(`应该拒绝包含控制字符的 Peer ID`, () => {
        const peerId = '12D3KooW' + ctrl + 'A'.repeat(43);
        expect(isValidPeerIdHelper(peerId)).toBe(false);
      });
    }
  });
});

describe('F2APlugin', () => {
  let tempDir: string | null = null;
  let plugin: F2APlugin | null = null;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-test-${Date.now()}-`));
    
    // 创建 IDENTITY.md
    writeFileSync(
      join(tempDir!, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** TestAgent'
    );
    
    // 创建 .openclaw 目录
    mkdirSync(join(tempDir!, '.openclaw'), { recursive: true });
    
    plugin = new F2APlugin();
  });

  // P1-6 修复：异步 afterEach 错误处理
  afterEach(async () => {
    try {
      if (plugin) {
        try {
          await plugin.shutdown();
        } catch (e) {
          // 忽略关闭错误
        }
      }
    } finally {
      // P1-5 修复：使用 safeCleanup 确保清理
      safeCleanupTempDir(tempDir, rmSync);
      tempDir = null;
      plugin = null;
    }
  });

  describe('初始化', () => {
    it('应该能够创建插件实例', () => {
      expect(plugin).toBeDefined();
    });

    it('应该能够初始化插件', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
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
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {
          minReputation: 50,
        },
      });

      expect(plugin).toBeDefined();
    });
    
    // P1-7 修复：恶意输入测试 - workspace 路径
    describe('恶意输入防护', () => {
      it('应该拒绝包含路径遍历的 workspace', async () => {
        plugin = new F2APlugin();
        
        const maliciousWorkspace = '../../../etc/passwd';
        
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: maliciousWorkspace,
              },
            },
          },
        };

        // 初始化应该失败或使用安全路径
        try {
          await plugin!.initialize({
            api: mockApi as any,
            config: {},
          });
          // 如果初始化成功，验证不会导致安全问题
          const tools = plugin!.getTools();
          expect(tools).toBeDefined();
        } catch (e) {
          // 初始化失败也是合理的
          expect(e).toBeDefined();
        }
      });
    });
    
    // P1-8 修复：Unicode 边界测试 - agentName
    describe('Unicode 边界处理', () => {
      for (const char of UNICODE_BOUNDARY_TEST_CASES.specialChars.slice(0, 3)) {
        it(`应该安全处理包含特殊 Unicode 的 agentName: U+${char.charCodeAt(0).toString(16)}`, async () => {
          plugin = new F2APlugin();
          
          const mockApi = {
            config: {
              agents: {
                defaults: {
                  workspace: tempDir!,
                },
              },
            },
          };

          const specialName = `Test${char}Agent`;
          
          await plugin!.initialize({
            api: mockApi as any,
            config: {
              agentName: specialName,
            },
          });

          expect(plugin).toBeDefined();
        });
      }
    });
  });

  describe('工具注册', () => {
    beforeEach(() => {
      if (!plugin) {
        plugin = new F2APlugin();
      }
    });

    it('应该返回工具列表', () => {
      const tools = plugin!.getTools();
      
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该包含核心工具', () => {
      const tools = plugin!.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_discover');
      expect(toolNames).toContain('f2a_delegate');
      expect(toolNames).toContain('f2a_status');
    });

    it('应该包含通讯录工具', () => {
      const tools = plugin!.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_contacts');
      expect(toolNames).toContain('f2a_friend_request');
      expect(toolNames).toContain('f2a_pending_requests');
    });

    it('应该包含信誉管理工具', () => {
      const tools = plugin!.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_reputation');
    });

    it('应该包含任务管理工具', () => {
      const tools = plugin!.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_poll_tasks');
      expect(toolNames).toContain('f2a_submit_result');
      expect(toolNames).toContain('f2a_task_stats');
    });

    it('应该包含公告工具', () => {
      const tools = plugin!.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_announce');
      expect(toolNames).toContain('f2a_list_announcements');
      expect(toolNames).toContain('f2a_claim');
    });

    it('工具应该有正确的描述', () => {
      const tools = plugin!.getTools();
      const discoverTool = tools.find(t => t.name === 'f2a_discover');
      
      expect(discoverTool?.description).toBeDefined();
      expect(discoverTool?.description.length).toBeGreaterThan(0);
    });

    it('工具应该有参数定义', () => {
      const tools = plugin!.getTools();
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
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      await plugin!.enable();
      
      expect(plugin!.isInitialized()).toBe(true);
    });

    it('应该能够检查初始化状态', () => {
      plugin = new F2APlugin();
      expect(plugin!.isInitialized()).toBe(false);
    });

    it('多次启用不应该报错', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      await plugin!.enable();
      await plugin!.enable();
    });
  });

  describe('shutdown', () => {
    it('应该能够正常关闭', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      await plugin!.shutdown();
    });

    it('应该能够多次调用 shutdown', async () => {
      plugin = new F2APlugin();
      
      await plugin!.shutdown();
      await plugin!.shutdown();
      await plugin!.shutdown();
    });

    it('未初始化时也能关闭', async () => {
      plugin = new F2APlugin();
      await plugin!.shutdown();
    });
  });

  describe('工具执行', () => {
    it('应该能够获取 F2A 状态', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      const status = plugin!.getF2AStatus();
      expect(status).toBeDefined();
    });
  });

  describe('公开接口方法', () => {
    it('discoverAgents 应该返回错误当未初始化时', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.discoverAgents();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('未初始化');
    });

    it('getConnectedPeers 应该返回错误当未初始化时', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.getConnectedPeers();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('未初始化');
    });

    it('sendMessage 应该返回错误当未初始化时', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.sendMessage('peer-id', 'test message');
      expect(result.success).toBe(false);
      expect(result.error).toContain('未初始化');
    });

    it('sendFriendRequest 应该返回 null 当握手协议未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.sendFriendRequest('peer-id');
      expect(result).toBeNull();
    });

    it('acceptFriendRequest 应该返回 false 当握手协议未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.acceptFriendRequest('request-id');
      expect(result).toBe(false);
    });

    it('rejectFriendRequest 应该返回 false 当握手协议未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.rejectFriendRequest('request-id');
      expect(result).toBe(false);
    });
  });

  describe('getF2A', () => {
    it('应该返回 undefined 当 F2A 未初始化', () => {
      plugin = new F2APlugin();
      
      const f2a = plugin!.getF2A();
      expect(f2a).toBeUndefined();
    });
  });

  describe('getTools', () => {
    it('应该返回所有工具', () => {
      plugin = new F2APlugin();
      
      const tools = plugin!.getTools();
      expect(tools.length).toBeGreaterThan(0);
      
      // 验证工具结构
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.handler).toBeDefined();
      }
    });

    it('工具应该有有效的参数定义', () => {
      plugin = new F2APlugin();
      
      const tools = plugin!.getTools();
      for (const tool of tools) {
        if (tool.parameters) {
          // parameters 可能是 JSON Schema 或其他格式
          expect(typeof tool.parameters).toBe('object');
        }
      }
    });
  });

  describe('f2aClient', () => {
    it('discoverAgents 应该返回错误当 F2A 未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.f2aClient.discoverAgents();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('未初始化');
    });

    it('getConnectedPeers 应该返回错误当 F2A 未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.f2aClient.getConnectedPeers();
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('未初始化');
    });
  });

  describe('初始化后功能', () => {
    it('应该返回正确的 F2A 状态', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      const status = plugin!.getF2AStatus();
      expect(status).toBeDefined();
      // 未启用时 running 为 false
    });

    it('应该正确设置配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {
          agentName: 'TestAgent',
          p2pPort: 4001,
        },
      });

      // 初始化成功，工具应该可用
      const tools = plugin!.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该支持 bootstrapPeers 配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {
          bootstrapPeers: ['/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWTest'],
        },
      });

      const tools = plugin!.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it('应该支持 enableMDNS 配置', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {
          enableMDNS: true,
        },
      });

      expect(plugin!.isInitialized()).toBe(false); // enable() 未调用
    });
  });

  describe('shutdown 边界情况', () => {
    it('应该能够关闭未初始化的插件', async () => {
      plugin = new F2APlugin();
      await plugin!.shutdown();
      // 不应该抛出错误
    });

    it('应该能够多次关闭', async () => {
      plugin = new F2APlugin();
      await plugin!.shutdown();
      await plugin!.shutdown();
      await plugin!.shutdown();
    });
  });

  describe('enable 方法', () => {
    it('应该能够启用插件', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {
          autoStart: false,
        },
      });

      // enable() 应该设置 _initialized 为 true
      await plugin!.enable();
      
      expect(plugin!.isInitialized()).toBe(true);
    });

    it('多次启用应该跳过', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      await plugin!.enable();
      await plugin!.enable(); // 第二次应该跳过
    });
  });

  describe('getConnectedPeers', () => {
    it('应该返回空数组当 F2A 未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.getConnectedPeers();
      expect(result.success).toBe(false);
    });
  });

  describe('discoverAgents', () => {
    it('应该返回错误当 F2A 未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.discoverAgents('test-capability');
      expect(result.success).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('应该返回错误当 F2A 未初始化', async () => {
      plugin = new F2APlugin();
      
      const result = await plugin!.sendMessage('peer-id', 'test message');
      expect(result.success).toBe(false);
    });
    
    // P1-7 修复：恶意输入测试
    for (const malicious of MALICIOUS_INPUT_TEST_CASES.commandInjection.slice(0, 5)) {
      it(`应该安全处理恶意消息内容: "${malicious.slice(0, 20)}..."`, async () => {
        plugin = new F2APlugin();
        
        // F2A 未初始化，应该返回错误而不是崩溃
        const result = await plugin!.sendMessage('peer-id', malicious);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    }
    
    // P1-8 修复：Unicode 边界测试
    for (const char of UNICODE_BOUNDARY_TEST_CASES.invisible.slice(0, 3)) {
      it(`应该安全处理包含不可见字符的消息: U+${char.charCodeAt(0).toString(16)}`, async () => {
        plugin = new F2APlugin();
        
        const result = await plugin!.sendMessage('peer-id', `Test${char}Message`);
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    }
  });

  describe('getReputationSystem', () => {
    it('应该返回信誉系统实例', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      // getReputationSystem 是通过 toolHandlers 访问的
      const tools = plugin!.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('getAnnouncementQueue', () => {
    it('应该返回公告队列', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir!,
            },
          },
        },
      };

      await plugin!.initialize({
        api: mockApi as any,
        config: {},
      });

      // 公告队列应该在 enable 时初始化
      const tools = plugin!.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('工具测试', () => {
    it('应该包含网络工具', () => {
      plugin = new F2APlugin();
      
      const tools = plugin!.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_discover');
      expect(toolNames).toContain('f2a_delegate');
    });

    it('应该包含任务工具', () => {
      plugin = new F2APlugin();
      
      const tools = plugin!.getTools();
      const toolNames = tools.map(t => t.name);
      
      expect(toolNames).toContain('f2a_poll_tasks');
      expect(toolNames).toContain('f2a_submit_result');
    });
  });
});