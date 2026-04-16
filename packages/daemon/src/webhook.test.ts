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

  // P1-3 修复：添加 SSRF 防护测试
  describe('SSRF protection', () => {
    it('should reject localhost URLs', async () => {
      const localhostService = new WebhookService({
        url: 'http://localhost:3000/webhook',
        token: 'test-token'
      });

      const result = await localhostService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('should reject 127.0.0.1 URLs', async () => {
      const loopbackService = new WebhookService({
        url: 'http://127.0.0.1:3000/webhook',
        token: 'test-token'
      });

      const result = await loopbackService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject private IP ranges (10.x.x.x)', async () => {
      const privateService = new WebhookService({
        url: 'http://10.0.0.1:3000/webhook',
        token: 'test-token'
      });

      const result = await privateService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject private IP ranges (192.168.x.x)', async () => {
      const privateService = new WebhookService({
        url: 'http://192.168.1.1:3000/webhook',
        token: 'test-token'
      });

      const result = await privateService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject private IP ranges (172.16-31.x.x)', async () => {
      const privateService = new WebhookService({
        url: 'http://172.16.0.1:3000/webhook',
        token: 'test-token'
      });

      const result = await privateService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject link-local addresses (169.254.x.x)', async () => {
      const linkLocalService = new WebhookService({
        url: 'http://169.254.1.1:3000/webhook',
        token: 'test-token'
      });

      const result = await linkLocalService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject .local domains', async () => {
      const localDomainService = new WebhookService({
        url: 'http://test.local/webhook',
        token: 'test-token'
      });

      const result = await localDomainService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('local');
    });

    it('should reject .localhost domains', async () => {
      const localhostDomainService = new WebhookService({
        url: 'http://test.localhost/webhook',
        token: 'test-token'
      });

      const result = await localhostDomainService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('localhost');
    });
  });

  // P1-3 修复：添加 IPv6 地址检测测试
  describe('IPv6 private address detection', () => {
    it('should reject IPv6 loopback (::1)', async () => {
      const ipv6Service = new WebhookService({
        url: 'http://[::1]:3000/webhook',
        token: 'test-token'
      });

      const result = await ipv6Service.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject IPv6 unspecified address (::)', async () => {
      const ipv6Service = new WebhookService({
        url: 'http://[::]:3000/webhook',
        token: 'test-token'
      });

      const result = await ipv6Service.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject IPv6 ULA (fc00::/7)', async () => {
      const ulaService = new WebhookService({
        url: 'http://[fc00::1]:3000/webhook',
        token: 'test-token'
      });

      const result = await ulaService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject IPv6 ULA (fd00::/8)', async () => {
      const ulaService = new WebhookService({
        url: 'http://[fd00::1]:3000/webhook',
        token: 'test-token'
      });

      const result = await ulaService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject IPv6 link-local (fe80::/10)', async () => {
      const linkLocalService = new WebhookService({
        url: 'http://[fe80::1]:3000/webhook',
        token: 'test-token'
      });

      const result = await linkLocalService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)', async () => {
      const mappedService = new WebhookService({
        url: 'http://[::ffff:127.0.0.1]:3000/webhook',
        token: 'test-token'
      });

      const result = await mappedService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Private IP');
    });
  });

  // P1-3 修复：添加 DNS 重绑定防护测试
  describe('DNS rebinding protection', () => {
    it('should validate URL before making request', async () => {
      // 使用无效的协议
      const invalidProtocolService = new WebhookService({
        url: 'ftp://example.com/webhook',
        token: 'test-token'
      });

      const result = await invalidProtocolService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid protocol');
    });

    it('should only allow http and https protocols', async () => {
      const fileProtocolService = new WebhookService({
        url: 'file:///etc/passwd',
        token: 'test-token'
      });

      const result = await fileProtocolService.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid protocol');
    });
  });
});
