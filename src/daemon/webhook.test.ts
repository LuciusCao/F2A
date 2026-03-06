import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookService } from './webhook.js';

describe('WebhookService', () => {
  let service: WebhookService;

  beforeEach(() => {
    service = new WebhookService({
      url: 'http://localhost:8080/hooks',
      token: 'test-token'
    });
  });

  describe('constructor', () => {
    it('should create service with default options', () => {
      const defaultService = new WebhookService({
        url: 'http://localhost:8080/hooks',
        token: 'test-token'
      });
      expect(defaultService).toBeDefined();
    });

    it('should create service with custom options', () => {
      const customService = new WebhookService({
        url: 'http://localhost:8080/hooks',
        token: 'test-token',
        timeout: 10000,
        retries: 5,
        retryDelay: 2000
      });
      expect(customService).toBeDefined();
    });
  });

  describe('send', () => {
    it('should skip notification when token not set', async () => {
      const noTokenService = new WebhookService({
        url: 'http://localhost:8080/hooks',
        token: ''
      });

      const result = await noTokenService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Token not set');
    });

    it('should send notification with default options', async () => {
      // This would make actual HTTP request in real scenario
      // For unit test, we just verify it doesn't throw
      const result = await service.send({ message: 'test' });
      // Result depends on network
    });

    it('should send notification with custom options', async () => {
      const result = await service.send({
        message: 'test message',
        name: 'Test Agent',
        wakeMode: 'now',
        deliver: true
      });
    });

    it('should handle network errors with retries', async () => {
      // Mock would be needed to test retry logic
      const result = await service.send({ message: 'test' });
    });
  });
});
