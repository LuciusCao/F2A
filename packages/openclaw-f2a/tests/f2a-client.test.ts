/**
 * F2A Client 测试
 * 测试重试逻辑、健康检查、消息收发
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2AClient, F2AClientConfig, DaemonResponse } from '../src/f2a-client.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('F2AClient', () => {
  let client: F2AClient;

  const defaultConfig: F2AClientConfig = {
    daemonUrl: 'http://localhost:7788',
    agentId: 'test-agent',
    agentName: 'Test Agent',
    capabilities: [
      { name: 'test-capability', description: 'Test capability', tools: [] },
    ],
    timeout: 5000,
    retries: 3,
    retryDelay: 100,
  };

  const createMockResponse = (
    success: boolean,
    data?: unknown,
    error?: string,
    code?: string
  ): DaemonResponse => ({
    success,
    data,
    error,
    code,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    client = new F2AClient(defaultConfig);
  });

  afterEach(async () => {
    await client.close();
  });

  describe('constructor', () => {
    it('应该使用默认配置初始化', () => {
      const minimalClient = new F2AClient({
        daemonUrl: '',
        agentId: 'agent-1',
        agentName: 'Agent',
      });

      const config = minimalClient.getConfig();
      expect(config.daemonUrl).toBe('http://localhost:7788');
      expect(config.timeout).toBe(30000);
      expect(config.retries).toBe(3);
      expect(config.retryDelay).toBe(1000);
    });

    it('应该使用自定义配置', () => {
      const config = client.getConfig();
      expect(config.daemonUrl).toBe('http://localhost:7788');
      expect(config.agentId).toBe('test-agent');
      expect(config.agentName).toBe('Test Agent');
      expect(config.timeout).toBe(5000);
      expect(config.retries).toBe(3);
    });

    it('应该存储能力列表', () => {
      const config = client.getConfig();
      expect(config.capabilities).toHaveLength(1);
      expect(config.capabilities[0].name).toBe('test-capability');
    });

    it('初始状态应未注册', () => {
      expect(client.isRegistered()).toBe(false);
    });
  });

  describe('checkHealth', () => {
    it('健康检查成功应返回 true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { status: 'ok' }),
      });

      const result = await client.checkHealth();

      expect(result).toBe(true);
    });

    it('健康检查失败应返回 false', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.checkHealth();

      expect(result).toBe(false);
    });

    it('Daemon 返回错误应返回 false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(false),
      });

      const result = await client.checkHealth();

      expect(result).toBe(false);
    });

    it('HTTP 错误应返回 false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const result = await client.checkHealth();

      expect(result).toBe(false);
    });
  });

  describe('registerAgent', () => {
    it('注册成功应返回成功响应', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, {
          agentId: 'test-agent',
          name: 'Test Agent',
        }),
      });

      const result = await client.registerAgent();

      expect(result.success).toBe(true);
      expect(client.isRegistered()).toBe(true);
    });

    it('注册失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.registerAgent();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
      expect(client.isRegistered()).toBe(false);
    });

    it('应该发送正确的注册请求', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      await client.registerAgent();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7788/api/agents',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.agentId).toBe('test-agent');
      expect(body.name).toBe('Test Agent');
      expect(body.capabilities).toHaveLength(1);
    });

    it('Daemon 返回错误应正确处理', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(false, undefined, 'Agent already registered'),
      });

      const result = await client.registerAgent();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent already registered');
    });
  });

  describe('unregisterAgent', () => {
    it('注销成功应返回成功响应', async () => {
      // 先注册
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });
      await client.registerAgent();

      // 再注销
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      const result = await client.unregisterAgent();

      expect(result.success).toBe(true);
      expect(client.isRegistered()).toBe(false);
    });

    it('未注册时注销应返回成功', async () => {
      const result = await client.unregisterAgent();

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('注销失败应返回错误响应', async () => {
      // 先注册
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });
      await client.registerAgent();

      // 注销失败
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.unregisterAgent();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });

    it('应该发送正确的注销请求', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });
      await client.registerAgent();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      await client.unregisterAgent();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7788/api/agents/test-agent',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('sendMessage', () => {
    it('发送成功应返回消息 ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { messageId: 'msg-123' }),
      });

      const result = await client.sendMessage('receiver-agent', 'Hello');

      expect(result.success).toBe(true);
      expect(result.data?.messageId).toBe('msg-123');
    });

    it('发送失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.sendMessage('receiver-agent', 'Hello');

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });

    it('应该发送正确的消息请求', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { messageId: 'msg-123' }),
      });

      await client.sendMessage('receiver', 'Test message', { priority: 'high' }, 'task_request');

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.fromAgentId).toBe('test-agent');
      expect(body.toAgentId).toBe('receiver');
      expect(body.content).toBe('Test message');
      expect(body.metadata).toEqual({ priority: 'high' });
      expect(body.type).toBe('task_request');
    });

    it('应该支持不同消息类型', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockResponse(true, { messageId: 'msg-1' }),
      });

      const types = ['message', 'task_request', 'task_response', 'announcement', 'claim'] as const;

      for (const type of types) {
        const result = await client.sendMessage('receiver', 'Test', undefined, type);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('broadcastMessage', () => {
    it('广播成功应返回广播数量', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { messageId: 'msg-123', broadcasted: 5 }),
      });

      const result = await client.broadcastMessage('Hello everyone');

      expect(result.success).toBe(true);
      expect(result.data?.broadcasted).toBe(5);
    });

    it('广播失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.broadcastMessage('Hello');

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });

    it('应该发送正确的广播请求', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { messageId: 'msg-1', broadcasted: 3 }),
      });

      await client.broadcastMessage('Broadcast message', { topic: 'test' });

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.fromAgentId).toBe('test-agent');
      expect(body.toAgentId).toBeUndefined(); // 广播无目标
      expect(body.content).toBe('Broadcast message');
      expect(body.type).toBe('announcement');
    });
  });

  describe('getMessages', () => {
    it('获取成功应返回消息列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, {
          messages: [
            { messageId: 'msg-1', content: 'Hello' },
            { messageId: 'msg-2', content: 'World' },
          ],
          count: 2,
        }),
      });

      const result = await client.getMessages();

      expect(result.success).toBe(true);
      expect(result.data?.count).toBe(2);
      expect(result.data?.messages).toHaveLength(2);
    });

    it('应该支持限制数量', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, {
          messages: [{ messageId: 'msg-1' }],
          count: 1,
        }),
      });

      const result = await client.getMessages(10);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything()
      );
    });

    it('获取失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getMessages();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });
  });

  describe('clearMessages', () => {
    it('清除成功应返回清除数量', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { cleared: 5 }),
      });

      const result = await client.clearMessages();

      expect(result.success).toBe(true);
      expect(result.data?.cleared).toBe(5);
    });

    it('清除指定消息应发送消息 ID 列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { cleared: 2 }),
      });

      await client.clearMessages(['msg-1', 'msg-2']);

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.messageIds).toEqual(['msg-1', 'msg-2']);
    });

    it('清除失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.clearMessages();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });
  });

  describe('getAgents', () => {
    it('获取成功应返回 Agent 列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, {
          agents: [
            { agentId: 'agent-1', name: 'Agent 1' },
            { agentId: 'agent-2', name: 'Agent 2' },
          ],
          stats: { total: 2, capabilities: {} },
        }),
      });

      const result = await client.getAgents();

      expect(result.success).toBe(true);
      expect(result.data?.agents).toHaveLength(2);
      expect(result.data?.stats.total).toBe(2);
    });

    it('获取失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getAgents();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });
  });

  describe('discoverAgentsByCapability', () => {
    it('发现成功应返回匹配 Agent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, {
          agents: [
            { agentId: 'agent-1', capabilities: [{ name: 'code-generation' }] },
            { agentId: 'agent-2', capabilities: [{ name: 'data-analysis' }] },
            { agentId: 'agent-3', capabilities: [{ name: 'code-generation' }] },
          ],
          stats: { total: 3, capabilities: {} },
        }),
      });

      const result = await client.discoverAgentsByCapability('code-generation');

      expect(result.success).toBe(true);
      expect(result.data?.agents).toHaveLength(2);
    });

    it('无匹配 Agent 应返回空列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, {
          agents: [{ agentId: 'agent-1', capabilities: [{ name: 'other' }] }],
          stats: { total: 1, capabilities: {} },
        }),
      });

      const result = await client.discoverAgentsByCapability('code-generation');

      expect(result.success).toBe(true);
      expect(result.data?.agents).toHaveLength(0);
    });

    it('发现失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.discoverAgentsByCapability('code-generation');

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });
  });

  describe('getDaemonStatus', () => {
    it('获取成功应返回 Daemon 状态', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, {
          peerId: 'peer-123',
          agentInfo: { displayName: 'Daemon' },
        }),
      });

      const result = await client.getDaemonStatus();

      expect(result.success).toBe(true);
      expect(result.data?.peerId).toBe('peer-123');
    });

    it('获取失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getDaemonStatus();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });
  });

  describe('getPeers', () => {
    it('获取成功应返回 Peers 列表', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, [
          { peerId: 'peer-1', displayName: 'Peer 1' },
          { peerId: 'peer-2', displayName: 'Peer 2' },
        ]),
      });

      const result = await client.getPeers();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('获取失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getPeers();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });
  });

  describe('getConnectedPeers', () => {
    it('应返回已连接的 Peers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, [
          { peerId: 'peer-1', displayName: 'Peer 1', connected: true },
          { peerId: 'peer-2', displayName: 'Peer 2', connected: false },
          { peerId: 'peer-3', displayName: 'Peer 3', connected: true },
        ]),
      });

      const result = await client.getConnectedPeers();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data?.every(p => p.connected === true)).toBe(true);
    });

    it('所有 Peers 未连接时应返回空数组', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, [
          { peerId: 'peer-1', displayName: 'Peer 1', connected: false },
          { peerId: 'peer-2', displayName: 'Peer 2', connected: false },
        ]),
      });

      const result = await client.getConnectedPeers();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('获取失败应返回错误响应', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getConnectedPeers();

      expect(result.success).toBe(false);
      expect(result.code).toBe('REQUEST_FAILED');
    });
  });

  describe('重试逻辑', () => {
    it('网络错误应触发重试', async () => {
      // 第一次失败，第二次成功
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      const result = await client.checkHealth();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toBe(true);
    });

    it('达到最大重试次数应返回错误', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.registerAgent();

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(false);
    });

    it('应该有重试延迟', async () => {
      const delays: number[] = [];
      const originalSleep = client['sleep'];
      client['sleep'] = (ms: number) => {
        delays.push(ms);
        return originalSleep(ms);
      };

      mockFetch.mockRejectedValueOnce(new Error('Error 1'));
      mockFetch.mockRejectedValueOnce(new Error('Error 2'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      await client.checkHealth();

      expect(delays).toHaveLength(2);
      expect(delays[0]).toBe(100); // retryDelay
    });

    it('成功响应不应重试', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      await client.checkHealth();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('超时处理', () => {
    it('超时应触发重试', async () => {
      // 模拟 AbortError
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      const result = await client.checkHealth();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toBe(true);
    });

    it('应该使用自定义超时', async () => {
      const customClient = new F2AClient({
        ...defaultConfig,
        timeout: 1000,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      await customClient.checkHealth();

      // 验证超时设置
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();

      await customClient.close();
    });
  });

  describe('close', () => {
    it('关闭未注册客户端应成功', async () => {
      await client.close();

      expect(client.isRegistered()).toBe(false);
    });

    it('关闭已注册客户端应注销', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });
      await client.registerAgent();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });

      await client.close();

      expect(client.isRegistered()).toBe(false);
    });

    it('多次关闭应成功', async () => {
      await client.close();
      await client.close();
      await client.close();
    });

    it('注销失败时关闭仍应完成', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true),
      });
      await client.registerAgent();

      mockFetch.mockRejectedValueOnce(new Error('Unregister failed'));

      await client.close();

      // 失败后注册状态可能保持（取决于实现）
      // 检查关闭完成即可
    });
  });

  describe('getConfig', () => {
    it('应该返回完整配置', () => {
      const config = client.getConfig();

      expect(config.daemonUrl).toBe('http://localhost:7788');
      expect(config.agentId).toBe('test-agent');
      expect(config.agentName).toBe('Test Agent');
      expect(config.capabilities).toHaveLength(1);
      expect(config.timeout).toBe(5000);
      expect(config.retries).toBe(3);
      expect(config.retryDelay).toBe(100);
    });

    it('应该返回配置副本', () => {
      const config1 = client.getConfig();
      const config2 = client.getConfig();

      expect(config1).toEqual(config2);
    });
  });

  describe('边界情况', () => {
    it('应该处理空响应', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, null),
      });

      const result = await client.getDaemonStatus();

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('应该处理无效 JSON 响应', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Not JSON',
      });

      const result = await client.checkHealth();

      expect(result).toBe(false);
    });

    it('应该处理 HTTP 错误响应', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ success: false, error: 'Not found' }),
      });

      const result = await client.getAgents();

      expect(result.success).toBe(false);
    });

    it('应该处理大消息内容', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockResponse(true, { messageId: 'msg-1' }),
      });

      const largeContent = 'A'.repeat(10000);
      const result = await client.sendMessage('receiver', largeContent);

      expect(result.success).toBe(true);
    });

    it('应该处理空能力列表', () => {
      const emptyClient = new F2AClient({
        daemonUrl: 'http://localhost',
        agentId: 'agent',
        agentName: 'Agent',
        capabilities: [],
      });

      const config = emptyClient.getConfig();
      expect(config.capabilities).toHaveLength(0);
    });

    it('应该处理并发请求', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createMockResponse(true, { messageId: 'msg-1' }),
      });

      const operations = Array.from({ length: 10 }, (_, i) =>
        client.sendMessage(`receiver-${i}`, `Message ${i}`)
      );

      const results = await Promise.all(operations);

      expect(results.every(r => r.success)).toBe(true);
    });
  });
});