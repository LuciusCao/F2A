import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handlePollMessages,
  handleSendMessage,
  handleClearMessages,
} from './messaging.js';
import * as httpClient from '../http-client.js';
import * as identity from '../identity.js';

describe('messaging tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('handlePollMessages', () => {
    it('should return formatted message list on success', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        messages: [
          {
            messageId: 'msg-1',
            fromAgentId: 'agent:a',
            toAgentId: 'agent:b',
            content: 'Hello',
            type: 'message',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      const result = await handlePollMessages({ agentId: 'agent:b' });
      expect(result).toContain('📨 共 1 条消息（Agent: agent:b）');
      expect(result).toContain('agent:a → agent:b');
      expect(result).toContain('Hello');
      expect(result).toContain('[msg-1]');
    });

    it('should return empty queue message when no messages', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        messages: [],
      });

      const result = await handlePollMessages({ agentId: 'agent:b' });
      expect(result).toBe('📭 该 Agent 暂无消息。');
    });

    it('should handle failure response', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: false,
        error: 'Server error',
      });

      const result = await handlePollMessages({ agentId: 'agent:b' });
      expect(result).toBe('❌ 拉取消息失败：Server error');
    });

    it('should use default limit of 50', async () => {
      const sendRequestSpy = vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        messages: [],
      });

      await handlePollMessages({ agentId: 'agent:b' });
      expect(sendRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/api/v1/messages/agent%3Ab?limit=50'
      );
    });

    it('should use custom limit when provided', async () => {
      const sendRequestSpy = vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        messages: [],
      });

      await handlePollMessages({ agentId: 'agent:b', limit: 10 });
      expect(sendRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/api/v1/messages/agent%3Ab?limit=10'
      );
    });
  });

  describe('handleSendMessage', () => {
    it('should send message successfully', async () => {
      vi.spyOn(identity, 'getAgentToken').mockReturnValue('token-123');
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        messageId: 'msg-99',
      });

      const result = await handleSendMessage({
        fromAgentId: 'agent:a',
        toAgentId: 'agent:b',
        content: 'Test message',
      });

      expect(result).toContain('✅ 消息发送成功');
      expect(result).toContain('msg-99');
    });

    it('should return error when token is missing', async () => {
      vi.spyOn(identity, 'getAgentToken').mockReturnValue(null);

      const result = await handleSendMessage({
        fromAgentId: 'agent:a',
        toAgentId: 'agent:b',
        content: 'Test message',
      });

      expect(result).toContain('❌ 无法获取 Agent');
      expect(result).toContain('token');
    });

    it('should return error when send fails', async () => {
      vi.spyOn(identity, 'getAgentToken').mockReturnValue('token-123');
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: false,
        error: 'Network error',
      });

      const result = await handleSendMessage({
        fromAgentId: 'agent:a',
        toAgentId: 'agent:b',
        content: 'Test message',
      });

      expect(result).toBe('❌ 发送消息失败：Network error');
    });

    it('should use default type message', async () => {
      vi.spyOn(identity, 'getAgentToken').mockReturnValue('token-123');
      const sendRequestSpy = vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        messageId: 'msg-1',
      });

      await handleSendMessage({
        fromAgentId: 'agent:a',
        toAgentId: 'agent:b',
        content: 'Test',
      });

      expect(sendRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/api/v1/messages',
        {
          fromAgentId: 'agent:a',
          toAgentId: 'agent:b',
          content: 'Test',
          type: 'message',
        },
        { Authorization: 'agent-token-123' }
      );
    });

    it('should use custom type when provided', async () => {
      vi.spyOn(identity, 'getAgentToken').mockReturnValue('token-123');
      const sendRequestSpy = vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        messageId: 'msg-1',
      });

      await handleSendMessage({
        fromAgentId: 'agent:a',
        toAgentId: 'agent:b',
        content: 'Test',
        type: 'task_request',
      });

      expect(sendRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/api/v1/messages',
        expect.objectContaining({ type: 'task_request' }),
        { Authorization: 'agent-token-123' }
      );
    });
  });

  describe('handleClearMessages', () => {
    it('should clear all messages successfully', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        cleared: 5,
      });

      const result = await handleClearMessages({ agentId: 'agent:a' });
      expect(result).toBe('✅ 已清除 5 条消息（Agent: agent:a）。');
    });

    it('should clear specific messages by ids', async () => {
      const sendRequestSpy = vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        cleared: 2,
      });

      const result = await handleClearMessages({
        agentId: 'agent:a',
        messageIds: ['msg-1', 'msg-2'],
      });

      expect(result).toBe('✅ 已清除 2 条消息（Agent: agent:a）。');
      expect(sendRequestSpy).toHaveBeenCalledWith(
        'DELETE',
        '/api/v1/messages/agent%3Aa',
        { messageIds: ['msg-1', 'msg-2'] }
      );
    });

    it('should not send body when messageIds is empty', async () => {
      const sendRequestSpy = vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: true,
        cleared: 0,
      });

      await handleClearMessages({ agentId: 'agent:a', messageIds: [] });
      expect(sendRequestSpy).toHaveBeenCalledWith(
        'DELETE',
        '/api/v1/messages/agent%3Aa',
        undefined
      );
    });

    it('should handle failure response', async () => {
      vi.spyOn(httpClient, 'sendRequest').mockResolvedValue({
        success: false,
        error: 'Clear failed',
      });

      const result = await handleClearMessages({ agentId: 'agent:a' });
      expect(result).toBe('❌ 清除消息失败：Clear failed');
    });
  });
});
