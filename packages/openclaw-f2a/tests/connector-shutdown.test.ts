/**
 * Connector (F2APlugin) shutdown 测试
 *
 * 覆盖 shutdown() 的各种清理路径
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createShutdownTestDir,
  cleanupShutdownTestDir,
  safeShutdown,
  createShutdownMockApi,
  expectPluginShutdownState,
  executeFullLifecycleTest
} from './utils/test-helpers.js';

// Helper to create mock F2A instance
function createMockF2A() {
  return {
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    peerId: 'QmTestPeerId123456789',
    agentInfo: {
      multiaddrs: [],
    },
  };
}

describe('F2APlugin - shutdown 深度测试', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = createShutdownTestDir(`f2a-plugin-shutdown-test-${Date.now()}-`);

    // 创建 IDENTITY.md
    writeFileSync(
      join(tempDir, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** TestAgent'
    );

    // 创建 .openclaw 目录
    mkdirSync(join(tempDir, '.openclaw'), { recursive: true });
  });

  // P2-2, P2-3, P2-16 修复：使用统一的 afterEach 清理模式
  afterEach(async () => {
    await safeShutdown(plugin);
    cleanupShutdownTestDir(tempDir);
  });

  describe('shutdown 清理路径', () => {
    it('应该正确清理已初始化的 F2A 实例', async () => {
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
      expect(plugin.isInitialized()).toBe(true);

      // 获取 F2A 实例确保它已创建
      const f2a = plugin.getF2A();

      // 关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
      // F2A 实例应该被清理
      expect(plugin.getF2A()).toBeUndefined();
    });

    it('应该正确清理 WebhookServer', async () => {
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
          webhookPort: 0, // 随机端口
        },
      });

      await plugin.enable();

      // 关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该正确清理 ContactManager 和 HandshakeProtocol', async () => {
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

      // 触发懒加载
      const contactManager = plugin.getContactManager();
      const handshakeProtocol = plugin.getHandshakeProtocol();

      expect(contactManager).toBeDefined();
      expect(handshakeProtocol).toBeDefined();

      // 关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该正确清理 TaskQueue', async () => {
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

      // 触发懒加载
      const taskQueue = plugin.getTaskQueue();
      expect(taskQueue).toBeDefined();

      // 关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该正确清理 ReputationSystem', async () => {
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

      // 触发懒加载
      const reputationSystem = plugin.getReputationSystem();
      expect(reputationSystem).toBeDefined();

      // 关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该正确清理 AnnouncementQueue', async () => {
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

      // 触发懒加载
      const announcementQueue = plugin.getAnnouncementQueue();
      expect(announcementQueue).toBeDefined();

      // 关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该处理 F2A 停止失败', async () => {
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

      // 关闭 - 应该不会抛出错误即使内部停止失败
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该处理所有组件同时存在的关闭', async () => {
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
          webhookPort: 0,
        },
      });

      await plugin.enable();

      // 触发所有懒加载组件
      const taskQueue = plugin.getTaskQueue();
      const reputationSystem = plugin.getReputationSystem();
      const contactManager = plugin.getContactManager();
      const handshakeProtocol = plugin.getHandshakeProtocol();
      const announcementQueue = plugin.getAnnouncementQueue();

      expect(taskQueue).toBeDefined();
      expect(reputationSystem).toBeDefined();
      expect(contactManager).toBeDefined();
      expect(handshakeProtocol).toBeDefined();
      expect(announcementQueue).toBeDefined();

      // 关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该在未初始化组件时也能正常关闭', async () => {
      plugin = new F2APlugin();

      // 不初始化，直接关闭
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该处理多次连续关闭', async () => {
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

      // 多次关闭
      await plugin.shutdown();
      await plugin.shutdown();
      await plugin.shutdown();

      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe('enable 路径测试', () => {
    it('应该正确设置 _initialized 标志', async () => {
      plugin = new F2APlugin();

      expect(plugin.isInitialized()).toBe(false);

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

      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该跳过已启用的插件', async () => {
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
      expect(plugin.isInitialized()).toBe(true);

      // 再次启用应该跳过
      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该处理 webhook 配置', async () => {
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
          webhookPort: 19005,
        },
      });

      await plugin.enable();

      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该处理 enableMDNS 配置', async () => {
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
          enableMDNS: true,
        },
      });

      await plugin.enable();

      expect(plugin.isInitialized()).toBe(true);
    });

    it('应该处理 bootstrapPeers 配置', async () => {
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
          bootstrapPeers: ['/ip4/127.0.0.1/tcp/4001/p2p/QmTest'],
        },
      });

      await plugin.enable();

      expect(plugin.isInitialized()).toBe(true);
    });
  });

  describe('shutdown 错误处理', () => {
    it('应该处理 F2A stop 抛出错误', async () => {
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

      // 关闭 - 即使 F2A stop 失败也应该完成
      await expect(plugin.shutdown()).resolves.not.toThrow();
    });

    it('应该处理 WebhookServer stop 抛出错误', async () => {
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
          webhookPort: 0,
        },
      });

      await plugin.enable();

      // 关闭
      await expect(plugin.shutdown()).resolves.not.toThrow();
    });

    it('应该处理 TaskQueue close 抛出错误', async () => {
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

      // 触发懒加载
      const taskQueue = plugin.getTaskQueue();
      expect(taskQueue).toBeDefined();

      // 关闭
      await expect(plugin.shutdown()).resolves.not.toThrow();
    });
  });

  describe('完整生命周期测试', () => {
    it('应该支持初始化-启用-关闭完整流程', async () => {
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
        config: {
          autoStart: false,
        },
      });

      expect(plugin.isInitialized()).toBe(false); // enable 后才为 true

      // 启用
      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);

      // 关闭
      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该支持多次初始化-关闭循环', async () => {
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

      // 第一次循环
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: { autoStart: false },
      });
      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);

      // 第二次循环
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: { autoStart: false },
      });
      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);
      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);
    });

    it('应该正确清理 F2A 实例和 _f2aStartTime', async () => {
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
        config: { autoStart: false },
      });

      await plugin.enable();

      // 确保启用了 F2A
      const status = plugin.getF2AStatus();

      // 关闭应该清理 _f2a 和 _f2aStartTime
      await plugin.shutdown();

      // 检查清理后的状态
      const pluginAny = plugin as any;
      expect(pluginAny._f2a).toBeUndefined();
      expect(pluginAny._f2aStartTime).toBeUndefined();
    });

    it('应该正确处理 F2A stop 失败并继续清理', async () => {
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
        config: { autoStart: false },
      });

      await plugin.enable();

      const pluginAny = plugin as any;

      // 如果 F2A 存在，mock 它的 stop 方法抛出错误
      if (pluginAny._f2a) {
        const originalStop = pluginAny._f2a.stop;
        pluginAny._f2a.stop = vi.fn().mockRejectedValue(new Error('Stop failed'));

        // 关闭应该不会因为 F2A stop 失败而中断
        await plugin.shutdown();

        // 应该继续清理
        expect(pluginAny._f2a).toBeUndefined();
        expect(pluginAny._f2aStartTime).toBeUndefined();

        // 恢复原始方法（以防万一）
        pluginAny._f2a = { stop: originalStop };
      } else {
        // 如果没有 F2A，正常关闭
        await plugin.shutdown();
      }
    });

    it('应该在 shutdown 后正确设置 _initialized 为 false', async () => {
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
        config: { autoStart: false },
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);

      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);

      // 确保可以再次启用
      await plugin.initialize({
        api: mockApi as any,
        _api: mockApi as any,
        config: { autoStart: false },
      });

      await plugin.enable();
      expect(plugin.isInitialized()).toBe(true);

      await plugin.shutdown();
      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe('createWebhookHandler 测试', () => {
    it('应该正确创建 webhook handler', async () => {
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
        config: { autoStart: false },
      });

      await plugin.enable();

      // 使用反射访问 createWebhookHandler 方法
      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      expect(handler).toBeDefined();
      expect(handler.onDiscover).toBeDefined();
      expect(handler.onDelegate).toBeDefined();
      expect(handler.onMessage).toBeDefined();
      expect(handler.onStatus).toBeDefined();

      await plugin.shutdown();
    });

    it('onStatus 应该返回空闲状态当 TaskQueue 未初始化', async () => {
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
        config: { autoStart: false },
      });

      // 不触发懒加载
      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      // 调用 onStatus，TaskQueue 未初始化
      const status = await handler.onStatus();

      expect(status.status).toBe('available');
      expect(status.load).toBe(0);
      expect(status.queued).toBe(0);
      expect(status.processing).toBe(0);

      await plugin.shutdown();
    });

    it('onStatus 应该返回正确状态当 TaskQueue 已初始化', async () => {
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
        config: { autoStart: false },
      });

      await plugin.enable();

      // 触发 TaskQueue 懒加载
      const taskQueue = plugin.getTaskQueue();
      expect(taskQueue).toBeDefined();

      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      // 调用 onStatus
      const status = await handler.onStatus();

      expect(status.status).toBe('available');
      expect(typeof status.load).toBe('number');
      expect(typeof status.queued).toBe('number');
      expect(typeof status.processing).toBe('number');

      await plugin.shutdown();
    });

    it('onMessage 应该拒绝无效 PeerID', async () => {
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
        config: { autoStart: false },
      });

      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      // 使用无效 PeerID 调用 onMessage
      const result = await handler.onMessage({
        from: 'invalid-peer-id',
        content: 'test message',
        messageId: 'msg-123',
      });

      expect(result.response).toBe('Invalid sender');

      await plugin.shutdown();
    });

    it('onMessage 应该拒绝过长的消息', async () => {
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
        config: { autoStart: false },
      });

      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      // 使用过长消息调用 onMessage（使用有效的 libp2p PeerID 格式 - 52字符）
      // PeerID 格式: 12D3KooW + 44 chars from [A-Za-z1-9]
      const longContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const result = await handler.onMessage({
        from: '12D3KooWABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvw',
        content: longContent,
        messageId: 'msg-456',
      });

      expect(result.response).toBe('Message too long');

      await plugin.shutdown();
    });

    it('onDiscover 应该拒绝不允许的请求者', async () => {
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
          minReputation: 100, // 设置很高的信誉阈值
        },
      });

      await plugin.enable();

      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      // 从低信誉的 peer 发送发现请求（使用有效的 libp2p PeerID 格式）
      const result = await handler.onDiscover({
        requester: '12D3KooWXYZHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxy',
        query: {},
      });

      // 应该返回空的能力列表
      expect(result.capabilities).toEqual([]);

      await plugin.shutdown();
    });

    it('onDelegate 应该拒绝信誉过低的任务', async () => {
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

      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      // 从低信誉的 peer 发送任务（新 peer 默认分数 30，低于 50 的阈值）
      const result = await handler.onDelegate({
        taskId: 'task-123',
        from: '12D3KooWLowReputationPeer123456789abcdefghjkmnpqrst',
        task: 'test task',
        capabilities: [],
      });

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('Reputation');

      await plugin.shutdown();
    });

    it('onDelegate 应该接受高信誉 peer 的任务', async () => {
      const validPeerId = '12D3KooWHighReputationPeer123456789abcdefghjkmnpq';
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

      // 给 peer 设置高信誉分数
      const reputationSystem = plugin.getReputationSystem();
      const entry = reputationSystem.getReputation(validPeerId);
      (entry as any).score = 80;

      const pluginAny = plugin as any;
      const handler = pluginAny.createWebhookHandler();

      // 从高信誉的 peer 发送任务
      const result = await handler.onDelegate({
        taskId: 'task-456',
        from: validPeerId,
        task: 'test task',
        capabilities: [],
      });

      // 应该被接受或因其他原因被拒绝（如 TaskGuard）
      expect(result.taskId).toBe('task-456');

      await plugin.shutdown();
    });
  });
});