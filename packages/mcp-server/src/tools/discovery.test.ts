import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListAgents, handleGetAgentStatus } from './discovery.js';
import * as httpClient from '../http-client.js';

describe('discovery tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleListAgents', () => {
    it('should return formatted agent list on success', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agents: [
          {
            agentId: 'agent:abc',
            name: 'Agent A',
            capabilities: [{ name: 'chat', version: '1.0' }],
            registeredAt: '2024-01-01T00:00:00.000Z',
            lastActiveAt: '2024-01-02T00:00:00.000Z',
            webhook: 'http://localhost:8080',
          },
        ],
      });

      const result = await handleListAgents({});
      expect(result).toContain('🌐 共 1 个 Agent');
      expect(result).toContain('Agent A (agent:abc)');
      expect(result).toContain('chat@1.0');
      expect(result).toContain('http://localhost:8080');
    });

    it('should filter agents by capability', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agents: [
          {
            agentId: 'agent:abc',
            name: 'Agent A',
            capabilities: [{ name: 'chat' }],
          },
          {
            agentId: 'agent:def',
            name: 'Agent B',
            capabilities: [{ name: 'search' }],
          },
        ],
      });

      const result = await handleListAgents({ capability: 'chat' });
      expect(result).toContain('Agent A (agent:abc)');
      expect(result).not.toContain('Agent B (agent:def)');
      expect(result).toContain('过滤条件: chat');
    });

    it('should return empty list message when no agents', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agents: [],
      });

      const result = await handleListAgents({});
      expect(result).toBe('📭 网络中暂无已注册的 Agent。');
    });

    it('should return empty filtered message when no matching capability', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agents: [
          {
            agentId: 'agent:abc',
            name: 'Agent A',
            capabilities: [{ name: 'chat' }],
          },
        ],
      });

      const result = await handleListAgents({ capability: 'search' });
      expect(result).toBe('📭 未找到具备「search」能力的 Agent。');
    });

    it('should handle failure response', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: false,
        error: 'Server down',
      });

      const result = await handleListAgents({});
      expect(result).toBe('❌ 获取 Agent 列表失败：Server down');
    });

    it('should handle agent with object webhook', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agents: [
          {
            agentId: 'agent:abc',
            name: 'Agent A',
            capabilities: [],
            webhook: { url: 'http://example.com' },
          },
        ],
      });

      const result = await handleListAgents({});
      expect(result).toContain('http://example.com');
    });

    it('should handle agent without optional fields', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agents: [
          {
            agentId: 'agent:abc',
          },
        ],
      });

      const result = await handleListAgents({});
      expect(result).toContain('unnamed (agent:abc)');
      expect(result).toContain('能力: none');
      expect(result).toContain('Webhook: none');
    });
  });

  describe('handleGetAgentStatus', () => {
    it('should return formatted agent details on success', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agent: {
          agentId: 'agent:abc',
          name: 'Agent A',
          capabilities: [{ name: 'chat' }],
          registeredAt: '2024-01-01T00:00:00.000Z',
          lastActiveAt: '2024-01-02T00:00:00.000Z',
          webhook: 'http://localhost:8080',
        },
        queue: { size: 3, maxSize: 100 },
      });

      const result = await handleGetAgentStatus({ agentId: 'agent:abc' });
      expect(result).toContain('📋 Agent 详情：Agent A (agent:abc)');
      expect(result).toContain('消息队列：3 / 100');
      expect(result).toContain('chat');
    });

    it('should handle agent not found', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agent: undefined,
        queue: undefined,
      });

      const result = await handleGetAgentStatus({ agentId: 'agent:missing' });
      expect(result).toBe('⚠️ 未找到 Agent「agent:missing」的详细信息。');
    });

    it('should handle failure response', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: false,
        error: 'Not found',
      });

      const result = await handleGetAgentStatus({ agentId: 'agent:abc' });
      expect(result).toBe('❌ 获取 Agent 状态失败：Not found');
    });

    it('should handle missing queue info', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        agent: {
          agentId: 'agent:abc',
          name: 'Agent A',
        },
      });

      const result = await handleGetAgentStatus({ agentId: 'agent:abc' });
      expect(result).toContain('消息队列：unknown / unknown');
    });
  });
});
