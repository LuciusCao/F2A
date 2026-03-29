/**
 * F2A 验证边界测试
 * 测试 validateStructuredMessagePayload 的边界情况
 */

import { describe, it, expect } from 'vitest';
import { validateStructuredMessagePayload } from './validation.js';

describe('validateStructuredMessagePayload', () => {
  describe('content size limit', () => {
    it('should reject content exceeding 1MB (string)', () => {
      // 创建超过 1MB 的字符串
      const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
      
      const result = validateStructuredMessagePayload({
        topic: 'chat',
        content: largeContent
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('max');
      }
    });

    it('should accept content exactly at 1MB limit (string)', () => {
      const maxContent = 'x'.repeat(1024 * 1024); // exactly 1MB
      
      const result = validateStructuredMessagePayload({
        topic: 'chat',
        content: maxContent
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept content under 1MB (string)', () => {
      const smallContent = 'Hello, world!';
      
      const result = validateStructuredMessagePayload({
        topic: 'chat',
        content: smallContent
      });
      
      expect(result.success).toBe(true);
    });
  });

  describe('topic format validation', () => {
    it('should reject uppercase letters in topic (TASK_REQUEST)', () => {
      const result = validateStructuredMessagePayload({
        topic: 'TASK_REQUEST',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Invalid topic format');
      }
    });

    it('should reject mixed case in topic (task_request)', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task_request',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Invalid topic format');
      }
    });

    it('should reject topic with spaces', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task request',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Invalid topic format');
      }
    });

    it('should reject topic with underscore', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task_request_v2',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Invalid topic format');
      }
    });

    it('should reject topic with special characters', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task@request',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject topic starting with dot', () => {
      const result = validateStructuredMessagePayload({
        topic: '.task.request',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject topic ending with dot', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task.request.',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject topic with consecutive dots', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task..request',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject topic with consecutive hyphens', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task--request',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject topic with dot followed by hyphen', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task.-request',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
    });

    it('should reject empty topic segments', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task.',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
    });

    it('should accept valid lowercase topic with dots', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task.request',
        content: 'test'
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept valid lowercase topic with hyphens', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task-request',
        content: 'test'
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept valid topic with mixed dots and hyphens', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task.request-v2',
        content: 'test'
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept topic with only numbers', () => {
      const result = validateStructuredMessagePayload({
        topic: '12345',
        content: 'test'
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept topic with alphanumeric', () => {
      const result = validateStructuredMessagePayload({
        topic: 'a1b2c3',
        content: 'test'
      });
      
      expect(result.success).toBe(true);
    });
  });

  describe('topic length validation', () => {
    it('should reject topic exceeding 256 characters', () => {
      // 创建超过 256 字符的 topic
      const longTopic = 'a'.repeat(257);
      
      const result = validateStructuredMessagePayload({
        topic: longTopic,
        content: 'test'
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('max');
      }
    });

    it('should accept topic exactly at 256 characters', () => {
      const maxTopic = 'a'.repeat(256);
      
      const result = validateStructuredMessagePayload({
        topic: maxTopic,
        content: 'test'
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept topic under 256 characters', () => {
      const shortTopic = 'task.request';
      
      const result = validateStructuredMessagePayload({
        topic: shortTopic,
        content: 'test'
      });
      
      expect(result.success).toBe(true);
    });
  });

  describe('replyTo length validation', () => {
    it('should reject replyTo exceeding 128 characters', () => {
      const longReplyTo = 'a'.repeat(129);
      
      const result = validateStructuredMessagePayload({
        topic: 'chat',
        content: 'test',
        replyTo: longReplyTo
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('max');
      }
    });

    it('should accept replyTo exactly at 128 characters', () => {
      const maxReplyTo = 'a'.repeat(128);
      
      const result = validateStructuredMessagePayload({
        topic: 'chat',
        content: 'test',
        replyTo: maxReplyTo
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept replyTo under 128 characters', () => {
      const shortReplyTo = 'msg-123';
      
      const result = validateStructuredMessagePayload({
        topic: 'chat',
        content: 'test',
        replyTo: shortReplyTo
      });
      
      expect(result.success).toBe(true);
    });
  });

  describe('valid payloads', () => {
    it('should accept payload without topic', () => {
      const result = validateStructuredMessagePayload({
        content: 'test message'
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept payload with object content', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task.request',
        content: {
          taskId: 'uuid-123',
          taskType: 'code-generation',
          description: 'Write a function'
        }
      });
      
      expect(result.success).toBe(true);
    });

    it('should accept complete valid payload', () => {
      const result = validateStructuredMessagePayload({
        topic: 'task.response',
        content: {
          taskId: 'uuid-123',
          status: 'success',
          result: { code: 'function test() {}' }
        },
        replyTo: 'msg-456'
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.topic).toBe('task.response');
        expect(result.data.replyTo).toBe('msg-456');
      }
    });
  });
});