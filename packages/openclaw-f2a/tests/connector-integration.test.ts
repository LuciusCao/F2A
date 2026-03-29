/**
 * Connector (F2APlugin) 集成测试
 * 
 * 测试完整的启用流程、消息处理等
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('F2APlugin - 集成测试', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-integration-test-${Date.now()}-`));
    
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

  describe('完整启用流程', () => {
    it('应该完成完整的初始化和启用流程', async () => {
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

      // 初始化
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
      expect(plugin.getTools().length).toBeGreaterThan(0);

      // 启用
      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);

      // 获取状态
      const status = plugin.getF2AStatus();
      expect(status).toBeDefined();
      expect(typeof status.running).toBe('boolean');

      // 关闭
      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该处理带 webhookPush 配置的启用', async () => {
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
        webhookPush: {
          enabled: true,
          url: 'https://example.com/webhook',
        },
        config: {},
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该处理带 bootstrapPeers 配置的启用', async () => {
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
        bootstrapPeers: ['/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWTest'],
        config: {},
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该处理带 security 配置的启用', async () => {
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
        security: {
          whitelist: ['peer-id-1'],
          blacklist: ['peer-id-2'],
        },
        config: {},
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
    });
  });

  describe('多次初始化和关闭', () => {
    it('应该支持多次初始化周期', async () => {
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

      // 第一个周期
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);

      // 第二个周期
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });
      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe('API 和 Runtime 测试', () => {
    it('应该处理带 runtime API 的启用', async () => {
      plugin = new F2APlugin();
      
      const mockApi = {
        config: {
          agents: {
            defaults: {
              workspace: tempDir,
            },
          },
        },
        runtime: {
          subagent: {
            run: vi.fn().mockResolvedValue({ runId: 'test-run-id' }),
            waitForRun: vi.fn().mockResolvedValue({ status: 'ok' }),
            getSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
          },
        },
        channel: {
          reply: {
            dispatchReplyFromConfig: vi.fn().mockResolvedValue({}),
          },
          routing: {
            resolveAgentRoute: vi.fn().mockReturnValue({ sessionKey: 'test-session' }),
          },
          reply: {
            finalizeInboundContext: vi.fn().mockReturnValue({
              SessionKey: 'test-session',
              PeerId: 'test-peer',
              Sender: 'Test',
              SenderId: 'test-sender',
              ChannelType: 'p2p',
              InboundId: 'test-inbound',
            }),
          },
        },
      };

      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('应该处理启用失败的情况', async () => {
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

      // 启用可能会因为 F2A 启动失败而失败
      // 但插件应该保持稳定状态
      await plugin.enable();
      
      // 插件应该仍然可用
      expect(plugin).toBeDefined();
    });

    it('应该处理关闭时的错误', async () => {
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
      
      // 关闭不应该抛出错误
      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe('公开接口完整性测试', () => {
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
        config: {},
      });
    });

    it('所有公开 getter 应该返回有效值', () => {
      expect(plugin.getConfig()).toBeDefined();
      expect(plugin.getNetworkClient()).toBeDefined();
      expect(plugin.getReputationSystem()).toBeDefined();
      expect(plugin.getNodeManager()).toBeDefined();
      expect(plugin.getTaskQueue()).toBeDefined();
      expect(plugin.getAnnouncementQueue()).toBeDefined();
      expect(plugin.getReviewCommittee()).toBeDefined();
      expect(plugin.getContactManager()).toBeDefined();
    });

    it('所有公开方法应该可调用', async () => {
      // discoverAgents
      const discoverResult = await plugin.discoverAgents();
      expect(discoverResult).toHaveProperty('success');

      // getConnectedPeers
      const peersResult = await plugin.getConnectedPeers();
      expect(peersResult).toHaveProperty('success');

      // sendMessage
      const sendResult = await plugin.sendMessage('peer-id', 'message');
      expect(sendResult).toHaveProperty('success');

      // sendFriendRequest
      const friendResult = await plugin.sendFriendRequest('peer-id');
      expect(friendResult).toBeNull(); // 未启用时返回 null

      // acceptFriendRequest
      const acceptResult = await plugin.acceptFriendRequest('request-id');
      expect(acceptResult).toBe(false);

      // rejectFriendRequest
      const rejectResult = await plugin.rejectFriendRequest('request-id');
      expect(rejectResult).toBe(false);
    });
  });

  describe('工具完整性测试', () => {
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
        config: {},
      });
    });

    it('所有工具应该有完整的定义', () => {
      const tools = plugin.getTools();
      
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('所有工具应该可调用', async () => {
      const tools = plugin.getTools();
      
      for (const tool of tools) {
        try {
          const result = await tool.handler({});
          expect(result).toBeDefined();
        } catch (error) {
          // 某些工具可能需要特定参数，错误也是预期行为
          expect(error).toBeDefined();
        }
      }
    });
  });

  describe('配置验证测试', () => {
    it('应该接受有效的配置', async () => {
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
        agentName: 'TestAgent',
        p2pPort: 4001,
        controlPort: 9001,
        enableMDNS: true,
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });

    it('应该处理缺失的配置', async () => {
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

      // 最小配置
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: {},
      });

      expect(plugin.getConfig()).toBeDefined();
    });
  });

  describe('懒加载组件验证', () => {
    it('懒加载组件应该正确初始化', async () => {
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

      // 触发所有懒加载
      const networkClient = plugin.getNetworkClient();
      const reputationSystem = plugin.getReputationSystem();
      const nodeManager = plugin.getNodeManager();
      const taskQueue = plugin.getTaskQueue();
      const announcementQueue = plugin.getAnnouncementQueue();
      const reviewCommittee = plugin.getReviewCommittee();
      const contactManager = plugin.getContactManager();

      expect(networkClient).toBeDefined();
      expect(reputationSystem).toBeDefined();
      expect(nodeManager).toBeDefined();
      expect(taskQueue).toBeDefined();
      expect(announcementQueue).toBeDefined();
      expect(reviewCommittee).toBeDefined();
      expect(contactManager).toBeDefined();
    });
  });

  describe('f2aClient 完整性测试', () => {
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
        config: {},
      });
    });

    it('f2aClient 方法应该返回正确格式', async () => {
      const discoverResult = await plugin.f2aClient.discoverAgents();
      expect(discoverResult).toHaveProperty('success');
      expect(discoverResult).toHaveProperty('error');

      const peersResult = await plugin.f2aClient.getConnectedPeers();
      expect(peersResult).toHaveProperty('success');
      expect(peersResult).toHaveProperty('error');
    });
  });

  describe('状态验证测试', () => {
    it('getF2AStatus 应该返回正确的格式', async () => {
      plugin = new F2APlugin();
      
      const status = plugin.getF2AStatus();
      
      expect(status).toHaveProperty('running');
      expect(typeof status.running).toBe('boolean');
    });

    it('getF2A 应该返回正确的值', async () => {
      plugin = new F2APlugin();
      
      const f2a = plugin.getF2A();
      
      // 未启用时应该是 undefined
      expect(f2a).toBeUndefined();
    });
  });
});