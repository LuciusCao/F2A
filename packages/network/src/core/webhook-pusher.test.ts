/**
 * WebhookPusher 测试
 * 测试 Agent 级 Webhook 转发服务
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebhookPusher } from './webhook-pusher.js';
import type { AgentRegistration } from './agent-registry.js';
import type { RoutableMessage } from './message-router.js';

// Mock WebhookService
vi.mock('./webhook.js', () => ({
  WebhookService: vi.fn().mockImplementation((config) => ({
    config,
    send: vi.fn(),
  })),
}));

// Import after mock
import { WebhookService } from './webhook.js';

// Mock Logger
class MockLogger {
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
  debug = vi.fn();
}

// Helper to create a RoutableMessage
function createRoutableMessage(overrides: Partial<RoutableMessage> = {}): RoutableMessage {
  return {
    messageId: 'test-message-id',
    fromAgentId: 'sender-agent',
    toAgentId: 'target-agent',
    content: 'test content',
    type: 'text',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    metadata: undefined,
    ...overrides,
  };
}

// Helper to create an AgentRegistration
function createAgentRegistration(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    agentId: 'target-agent',
    name: 'Test Agent',
    webhook: {
      url: 'https://example.com/webhook',
      token: 'test-token',
    },
    ...overrides,
  };
}

describe('WebhookPusher', () => {
  let pusher: WebhookPusher;
  let logger: MockLogger;
  let mockWebhookService: { config: any; send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new MockLogger();
    pusher = new WebhookPusher({ logger: logger as any });
    
    // Create a fresh mock instance for each test
    mockWebhookService = {
      config: {},
      send: vi.fn(),
    };
    vi.mocked(WebhookService).mockReturnValue(mockWebhookService as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('forwardToAgentWebhook', () => {
    it('should return error when agent has no webhook URL configured', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration({ webhook: undefined });

      const result = await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent has no webhook URL configured');
      expect(WebhookService).not.toHaveBeenCalled();
    });

    it('should successfully forward message to webhook', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: true });

      const result = await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockWebhookService.send).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should log warning and return error when webhook send fails', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: false, error: 'Connection refused' });

      const result = await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(logger.warn).toHaveBeenCalledWith('Webhook send failed', {
        agentId: targetAgent.agentId,
        error: 'Connection refused',
      });
    });

    it('should handle webhook send exception', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      const testError = new Error('Network timeout');
      mockWebhookService.send.mockRejectedValue(testError);

      const result = await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
      expect(logger.error).toHaveBeenCalledWith('Webhook send exception', {
        agentId: targetAgent.agentId,
        error: 'Network timeout',
      });
    });

    it('should handle non-Error exceptions', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockRejectedValue('String error');

      const result = await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });

    it('should create WebhookService with correct config', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration({
        webhook: {
          url: 'https://custom.example.com/hook',
          token: 'custom-token',
        },
      });
      mockWebhookService.send.mockResolvedValue({ success: true });

      await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(WebhookService).toHaveBeenCalledWith({
        url: 'https://custom.example.com/hook',
        token: 'custom-token',
        timeout: 5000,
        retries: 2,
        retryDelay: 500,
      });
    });

    it('should use agentId as token when webhook token is not provided', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration({
        webhook: {
          url: 'https://example.com/webhook',
          // No token provided
        },
      });
      mockWebhookService.send.mockResolvedValue({ success: true });

      await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(WebhookService).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'target-agent', // agentId is used as fallback token
        })
      );
    });

    it('should construct correct payload', async () => {
      const message = createRoutableMessage({
        messageId: 'msg-123',
        fromAgentId: 'sender',
        toAgentId: 'receiver',
        content: 'Hello World',
        type: 'notification',
        metadata: { priority: 'high' },
      });
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: true });

      await pusher.forwardToAgentWebhook(message, targetAgent);

      const sendCall = mockWebhookService.send.mock.calls[0][0];
      const payload = JSON.parse(sendCall.message);

      expect(payload).toEqual({
        messageId: 'msg-123',
        fromAgentId: 'sender',
        toAgentId: 'receiver',
        content: 'Hello World',
        type: 'notification',
        createdAt: '2024-01-01T00:00:00.000Z',
        metadata: { priority: 'high' },
      });
      expect(sendCall.name).toBe('Agent Test Agent');
      expect(sendCall.wakeMode).toBe('now');
      expect(sendCall.deliver).toBe(true);
    });

    it('should cache WebhookService for subsequent calls to same agent', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: true });

      // First call - should create new WebhookService
      await pusher.forwardToAgentWebhook(message, targetAgent);
      expect(WebhookService).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith('Webhook service created for Agent', {
        agentId: 'target-agent',
        webhookUrl: 'https://example.com/webhook',
      });

      // Clear mock counters but keep the instance
      vi.mocked(WebhookService).mockClear();

      // Second call - should use cached WebhookService
      await pusher.forwardToAgentWebhook(message, targetAgent);
      expect(WebhookService).not.toHaveBeenCalled(); // Should not create new instance
      expect(mockWebhookService.send).toHaveBeenCalledTimes(2);
    });

    it('should create separate WebhookService for different agents', async () => {
      const message1 = createRoutableMessage({ toAgentId: 'agent-1' });
      const agent1 = createAgentRegistration({
        agentId: 'agent-1',
        webhook: { url: 'https://agent1.example.com/webhook' },
      });
      const message2 = createRoutableMessage({ toAgentId: 'agent-2' });
      const agent2 = createAgentRegistration({
        agentId: 'agent-2',
        webhook: { url: 'https://agent2.example.com/webhook' },
      });
      mockWebhookService.send.mockResolvedValue({ success: true });

      await pusher.forwardToAgentWebhook(message1, agent1);
      await pusher.forwardToAgentWebhook(message2, agent2);

      expect(WebhookService).toHaveBeenCalledTimes(2);
      expect(WebhookService).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ url: 'https://agent1.example.com/webhook' })
      );
      expect(WebhookService).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ url: 'https://agent2.example.com/webhook' })
      );
    });

    it('should handle empty toAgentId', async () => {
      const message = createRoutableMessage({ toAgentId: undefined });
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: true });

      await pusher.forwardToAgentWebhook(message, targetAgent);

      const sendCall = mockWebhookService.send.mock.calls[0][0];
      const payload = JSON.parse(sendCall.message);
      expect(payload.toAgentId).toBe('');
    });
  });

  describe('clearWebhookCache', () => {
    it('should clear webhook cache when agent exists', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: true });

      // First, create a cached service
      await pusher.forwardToAgentWebhook(message, targetAgent);
      expect(WebhookService).toHaveBeenCalledTimes(1);

      // Clear the cache
      pusher.clearWebhookCache('target-agent');

      expect(logger.debug).toHaveBeenCalledWith('Webhook service cache cleared', {
        agentId: 'target-agent',
      });

      // Clear mock counters
      vi.mocked(WebhookService).mockClear();

      // Should create new service after cache clear
      await pusher.forwardToAgentWebhook(message, targetAgent);
      expect(WebhookService).toHaveBeenCalledTimes(1);
    });

    it('should not log when clearing non-existent cache', () => {
      pusher.clearWebhookCache('non-existent-agent');

      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe('clearAllWebhookCache', () => {
    it('should clear all webhook caches and log count', async () => {
      const message1 = createRoutableMessage({ toAgentId: 'agent-1' });
      const agent1 = createAgentRegistration({
        agentId: 'agent-1',
        webhook: { url: 'https://agent1.example.com/webhook' },
      });
      const message2 = createRoutableMessage({ toAgentId: 'agent-2' });
      const agent2 = createAgentRegistration({
        agentId: 'agent-2',
        webhook: { url: 'https://agent2.example.com/webhook' },
      });
      mockWebhookService.send.mockResolvedValue({ success: true });

      // Create cached services for two agents
      await pusher.forwardToAgentWebhook(message1, agent1);
      await pusher.forwardToAgentWebhook(message2, agent2);
      expect(WebhookService).toHaveBeenCalledTimes(2);

      // Clear all caches
      pusher.clearAllWebhookCache();

      expect(logger.debug).toHaveBeenCalledWith('All webhook service caches cleared', {
        count: 2,
      });

      // Clear mock counters
      vi.mocked(WebhookService).mockClear();

      // Should create new services after cache clear
      await pusher.forwardToAgentWebhook(message1, agent1);
      expect(WebhookService).toHaveBeenCalledTimes(1);
    });

    it('should not log when clearing empty cache', () => {
      // No cached services
      pusher.clearAllWebhookCache();

      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle retry logic from underlying WebhookService', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      
      // Simulate WebhookService's retry logic returning failure after retries
      mockWebhookService.send.mockResolvedValue({
        success: false,
        error: 'All retries failed',
      });

      const result = await pusher.forwardToAgentWebhook(message, targetAgent);

      // WebhookPusher just reports the failure from WebhookService
      expect(result.success).toBe(false);
      expect(result.error).toBe('All retries failed');
      expect(mockWebhookService.send).toHaveBeenCalledTimes(1); // WebhookPusher only calls once
    });

    it('should handle webhook send returning error without message', async () => {
      const message = createRoutableMessage();
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: false });

      const result = await pusher.forwardToAgentWebhook(message, targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should handle null metadata in message', async () => {
      const message = createRoutableMessage({ metadata: null });
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: true });

      await pusher.forwardToAgentWebhook(message, targetAgent);

      const sendCall = mockWebhookService.send.mock.calls[0][0];
      const payload = JSON.parse(sendCall.message);
      expect(payload.metadata).toBeNull();
    });

    it('should handle undefined metadata in message', async () => {
      const message = createRoutableMessage({ metadata: undefined });
      const targetAgent = createAgentRegistration();
      mockWebhookService.send.mockResolvedValue({ success: true });

      await pusher.forwardToAgentWebhook(message, targetAgent);

      const sendCall = mockWebhookService.send.mock.calls[0][0];
      const payload = JSON.parse(sendCall.message);
      expect(payload.metadata).toBeUndefined();
    });
  });
});