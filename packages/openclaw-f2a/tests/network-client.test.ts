import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2ANetworkClient } from '../src/network-client';
import { F2ANodeConfig } from '../src/types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('F2ANetworkClient', () => {
  let client: F2ANetworkClient;
  const mockConfig: F2ANodeConfig = {
    nodePath: './F2A',
    controlPort: 9001,
    controlToken: 'test-token',
    p2pPort: 9000,
    enableMDNS: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new F2ANetworkClient(mockConfig);
  });

  describe('HTTP request handling', () => {
    it('should include correct headers in requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      await client.getConnectedPeers();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9001/peers',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should handle HTTP errors correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await client.getConnectedPeers();

      expect(result.success).toBe(false);
      // 新的 Result 类型中 error 是 F2AError 对象
      if (!result.success) {
        expect(result.error.message).toContain('401');
        expect(result.error.code).toBe('CONNECTION_FAILED');
      }
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.getConnectedPeers();

      expect(result.success).toBe(false);
      // 新的 Result 类型中 error 是 F2AError 对象
      if (!result.success) {
        expect(result.error.message).toBe('Connection refused');
        expect(result.error.code).toBe('CONNECTION_FAILED');
      }
    });

    it('should handle JSON parsing errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); },
      });

      const result = await client.getConnectedPeers();

      expect(result.success).toBe(false);
    });
  });

  describe('discoverAgents', () => {
    it('should discover agents without capability filter', async () => {
      const mockAgents = [
        { peerId: 'peer-1', displayName: 'Agent 1', capabilities: [] },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAgents,
      });

      const result = await client.discoverAgents();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockAgents);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9001/discover',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ capability: undefined }),
        })
      );
    });

    it('should discover agents with capability filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });

      await client.discoverAgents('code-generation');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9001/discover',
        expect.objectContaining({
          body: JSON.stringify({ capability: 'code-generation' }),
        })
      );
    });
  });

  describe('delegateTask', () => {
    it('should send task delegation request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { result: 'done' } }),
      });

      const result = await client.delegateTask({
        peerId: 'peer-1',
        taskType: 'test-task',
        description: 'Test description',
        parameters: { key: 'value' },
        timeout: 30000,
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9001/delegate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('peer-1'),
        })
      );
    });
  });

  describe('sendTaskResponse', () => {
    it('should send task response with all fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.sendTaskResponse('peer-1', {
        taskId: 'task-123',
        status: 'success',
        result: { output: 'hello' },
        latency: 100,
      });

      expect(result.success).toBe(true);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toMatchObject({
        peerId: 'peer-1',
        taskId: 'task-123',
        status: 'success',
      });
    });
  });

  describe('registerWebhook', () => {
    it('should register webhook with default events', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.registerWebhook('http://localhost:9002/webhook');

      expect(result.success).toBe(true);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toEqual({
        url: 'http://localhost:9002/webhook',
        events: ['discover', 'delegate', 'status'],
      });
    });
  });

  describe('updateAgentInfo', () => {
    it('should update agent info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.updateAgentInfo({
        displayName: 'Test Agent',
        capabilities: [{ name: 'test', description: 'Test capability', tools: [] }],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('getPendingTasks', () => {
    it('should get pending tasks', async () => {
      const mockTasks = [{ taskId: 'task-1', description: 'Test' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTasks,
      });

      const result = await client.getPendingTasks();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockTasks);
    });
  });

  describe('confirmConnection', () => {
    it('should confirm connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.confirmConnection('peer-1');

      expect(result.success).toBe(true);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toEqual({ peerId: 'peer-1' });
    });
  });

  describe('rejectConnection', () => {
    it('should reject connection with reason', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.rejectConnection('peer-1', 'suspicious');

      expect(result.success).toBe(true);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toEqual({ peerId: 'peer-1', reason: 'suspicious' });
    });

    it('should reject connection without reason', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await client.rejectConnection('peer-1');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody).toEqual({ peerId: 'peer-1', reason: undefined });
    });
  });
});
