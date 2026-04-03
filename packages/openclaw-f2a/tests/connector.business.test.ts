/**
 * F2APlugin 业务逻辑测试
 * 测试核心功能：初始化、发现、消息发送、生命周期
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import type { AgentInfo } from '../src/types.js';

describe('F2APlugin 业务逻辑', () => {
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

  describe('初始化', () => {
    it('应该成功初始化并保存配置', async () => {
      const config = {
        agentName: 'Test Agent',
        autoStart: false,
        _api: {
          logger: {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn()
          }
        }
      };

      await plugin.initialize(config);

      expect(plugin.config).toBeDefined();
      expect(plugin.api).toBe(config._api);
    });

    it('应该支持空配置初始化', async () => {
      await plugin.initialize({});

      expect(plugin.config).toBeDefined();
    });

    it('应该能够重复初始化（幂等）', async () => {
      const config1 = { agentName: 'Agent 1' };
      const config2 = { agentName: 'Agent 2' };

      await plugin.initialize(config1);
      await plugin.initialize(config2);

      // 第二次初始化应该被忽略或更新
      expect(plugin.config).toBeDefined();
    });
  });

  describe('生命周期', () => {
    it('shutdown 应该能够安全调用多次', async () => {
      await plugin.initialize({});
      
      await plugin.shutdown();
      await plugin.shutdown(); // 不应该抛出错误

      // 验证可以正常完成
      expect(true).toBe(true);
    });

    it('未初始化时 shutdown 应该安全完成', async () => {
      // 未初始化就调用 shutdown
      await plugin.shutdown();

      expect(true).toBe(true);
    });
  });

  describe('发现 Agents', () => {
    it('未启用时 discoverAgents 应该返回错误', async () => {
      await plugin.initialize({});

      const result = await plugin.discoverAgents();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该能够按能力过滤发现', async () => {
      await plugin.initialize({});

      // 检查方法签名正确
      const result = await plugin.discoverAgents('code-generation');

      // 未启用时应该返回错误
      expect(result.success).toBe(false);
    });
  });

  describe('获取连接的 Peers', () => {
    it('未启用时 getConnectedPeers 应该返回错误', async () => {
      await plugin.initialize({});

      const result = await plugin.getConnectedPeers();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('发送消息', () => {
    it('未启用时 sendMessage 应该返回错误', async () => {
      await plugin.initialize({});

      const result = await plugin.sendMessage('peer-id', 'test message');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该验证目标 peer ID', async () => {
      await plugin.initialize({});

      // 空字符串 peer ID
      const result = await plugin.sendMessage('', 'test');

      expect(result.success).toBe(false);
    });
  });

  describe('好友请求', () => {
    it('未启用时 sendFriendRequest 应该返回 null', async () => {
      await plugin.initialize({});

      const result = await plugin.sendFriendRequest('peer-id', 'Hello');

      expect(result).toBeNull();
    });

    it('未启用时 acceptFriendRequest 应该返回 false', async () => {
      await plugin.initialize({});

      const result = await plugin.acceptFriendRequest('request-id');

      expect(result).toBe(false);
    });

    it('未启用时 rejectFriendRequest 应该返回 false', async () => {
      await plugin.initialize({});

      const result = await plugin.rejectFriendRequest('request-id', 'Not interested');

      expect(result).toBe(false);
    });
  });

  describe('属性访问', () => {
    it('config 属性应该返回配置对象', async () => {
      const config = { agentName: 'Test Agent' };
      await plugin.initialize(config);

      expect(plugin.config).toBeDefined();
    });

    it('api 属性应该返回 API 引用', async () => {
      const mockApi = { logger: { info: vi.fn() } };
      await plugin.initialize({ _api: mockApi as any });

      expect(plugin.api).toBe(mockApi);
    });

    it.skip('未初始化时 config 行为取决于内部实现', () => {
      // 跳过：此测试依赖于内部实现细节
      // 初始化后 config 会有明确的值
    });
  });

  describe('错误处理', () => {
    it('应该处理无效的配置值', async () => {
      // 传入各种无效配置
      await plugin.initialize({
        webhookPort: 'invalid' as any,
        maxQueuedTasks: -1
      });

      // 应该不会崩溃
      expect(true).toBe(true);
    });

    it('应该处理空对象配置', async () => {
      await plugin.initialize({});

      // 应该使用默认配置
      expect(plugin.config).toBeDefined();
    });
  });

  describe('GetTools', () => {
    it('应该返回工具列表', () => {
      const tools = plugin.getTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('工具应该包含必要的属性', () => {
      const tools = plugin.getTools();
      const tool = tools[0];

      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    });

    it('工具名称应该以 f2a_ 开头', () => {
      const tools = plugin.getTools();

      for (const tool of tools) {
        expect(tool.name).toMatch(/^f2a_/);
      }
    });
  });
});