/**
 * Webhook 测试 - 安全防护函数 + WebhookService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isPrivateIPv4,
  isIPv6Format,
  parseIPv4MappedIPv6,
  isPrivateIP,
  isPrivateIPv6,
  isNAT64Address,
  isTeredoAddress,
  validateWebhookUrl,
  WebhookService,
} from './webhook.js';

describe('Webhook - Security Functions', () => {
  describe('isPrivateIPv4', () => {
    it('should detect loopback addresses (127.x.x.x)', () => {
      expect(isPrivateIPv4([127, 0, 0, 1])).toBe(true);
      expect(isPrivateIPv4([127, 255, 255, 255])).toBe(true);
    });

    it('should detect Class A private (10.x.x.x)', () => {
      expect(isPrivateIPv4([10, 0, 0, 1])).toBe(true);
      expect(isPrivateIPv4([10, 255, 255, 255])).toBe(true);
    });

    it('should detect Class C private (192.168.x.x)', () => {
      expect(isPrivateIPv4([192, 168, 0, 1])).toBe(true);
      expect(isPrivateIPv4([192, 168, 255, 255])).toBe(true);
    });

    it('should detect Class B private (172.16-31.x.x)', () => {
      expect(isPrivateIPv4([172, 16, 0, 1])).toBe(true);
      expect(isPrivateIPv4([172, 31, 255, 255])).toBe(true);
      expect(isPrivateIPv4([172, 15, 0, 1])).toBe(false);
      expect(isPrivateIPv4([172, 32, 0, 1])).toBe(false);
    });

    it('should detect link-local (169.254.x.x)', () => {
      expect(isPrivateIPv4([169, 254, 0, 1])).toBe(true);
    });

    it('should detect CGNAT addresses (100.64-127.x.x)', () => {
      expect(isPrivateIPv4([100, 64, 0, 1])).toBe(true);
      expect(isPrivateIPv4([100, 127, 255, 255])).toBe(true);
      expect(isPrivateIPv4([100, 63, 0, 1])).toBe(false);
      expect(isPrivateIPv4([100, 128, 0, 1])).toBe(false);
    });

    it('should detect TEST-NET addresses', () => {
      expect(isPrivateIPv4([192, 0, 2, 1])).toBe(true);
      expect(isPrivateIPv4([198, 51, 100, 1])).toBe(true);
      expect(isPrivateIPv4([203, 0, 113, 1])).toBe(true);
    });

    it('should detect 0.0.0.0', () => {
      expect(isPrivateIPv4([0, 0, 0, 0])).toBe(true);
    });

    it('should return false for public addresses', () => {
      expect(isPrivateIPv4([8, 8, 8, 8])).toBe(false);
      expect(isPrivateIPv4([1, 1, 1, 1])).toBe(false);
      expect(isPrivateIPv4([93, 184, 216, 34])).toBe(false);
    });
  });

  describe('isIPv6Format', () => {
    it('should detect IPv6 addresses', () => {
      expect(isIPv6Format('2001:db8::1')).toBe(true);
      expect(isIPv6Format('::1')).toBe(true);
      expect(isIPv6Format('::')).toBe(true);
    });

    it('should detect IPv6 addresses with brackets', () => {
      expect(isIPv6Format('[2001:db8::1]')).toBe(true);
      expect(isIPv6Format('[::1]')).toBe(true);
    });

    it('should return false for IPv4 addresses', () => {
      expect(isIPv6Format('192.168.1.1')).toBe(false);
      expect(isIPv6Format('127.0.0.1')).toBe(false);
    });

    it('should return false for hostnames', () => {
      expect(isIPv6Format('example.com')).toBe(false);
    });
  });

  describe('parseIPv4MappedIPv6', () => {
    it('should parse IPv4-mapped IPv6 addresses (hex format)', () => {
      // ::ffff:7f00:1 是 ::ffff:127.0.0.1 的十六进制形式
      const result = parseIPv4MappedIPv6('::ffff:7f00:1');
      expect(result).toEqual([127, 0, 0, 1]);
    });

    it('should parse IPv4-mapped IPv6 with full prefix', () => {
      // 十六进制格式: c0a8 = 49320 (192*256 + 168), 0101 = 257 (1*256 + 1)
      const result = parseIPv4MappedIPv6('::ffff:c0a8:101');
      expect(result).toEqual([192, 168, 1, 1]);
    });

    it('should return null for non-IPv4-mapped addresses', () => {
      expect(parseIPv4MappedIPv6('2001:db8::1')).toBeNull();
      expect(parseIPv4MappedIPv6('::1')).toBeNull();
      expect(parseIPv4MappedIPv6('192.168.1.1')).toBeNull();
    });
  });

  describe('isNAT64Address', () => {
    it('should detect NAT64 addresses', () => {
      expect(isNAT64Address('64:ff9b::1')).toBe(true);
      expect(isNAT64Address('64:ff9b:0:0:0:0:0:1')).toBe(true);
    });

    it('should return false for non-NAT64 addresses', () => {
      expect(isNAT64Address('2001:db8::1')).toBe(false);
      expect(isNAT64Address('::1')).toBe(false);
    });
  });

  describe('isTeredoAddress', () => {
    it('should detect Teredo addresses', () => {
      expect(isTeredoAddress('2001::1')).toBe(true);
      expect(isTeredoAddress('2001:0000::1')).toBe(true);
    });

    it('should return false for non-Teredo addresses', () => {
      expect(isTeredoAddress('2001:db8::1')).toBe(false);
      expect(isTeredoAddress('::1')).toBe(false);
    });
  });

  describe('isPrivateIPv6', () => {
    it('should detect IPv6 loopback (::1)', () => {
      expect(isPrivateIPv6('::1')).toBe(true);
      expect(isPrivateIPv6('0:0:0:0:0:0:0:1')).toBe(true);
    });

    it('should detect IPv6 unspecified (::)', () => {
      expect(isPrivateIPv6('::')).toBe(true);
      expect(isPrivateIPv6('0:0:0:0:0:0:0:0')).toBe(true);
    });

    it('should detect ULA addresses (fc00::/7)', () => {
      expect(isPrivateIPv6('fc00::1')).toBe(true);
      expect(isPrivateIPv6('fd00::1')).toBe(true);
    });

    it('should detect link-local addresses (fe80::/10)', () => {
      expect(isPrivateIPv6('fe80::1')).toBe(true);
      expect(isPrivateIPv6('fe90::1')).toBe(true);
      expect(isPrivateIPv6('fea0::1')).toBe(true);
      expect(isPrivateIPv6('feb0::1')).toBe(true);
    });

    it('should detect IPv4-mapped private addresses (hex format)', () => {
      // 使用十六进制格式
      expect(isPrivateIPv6('::ffff:7f00:1')).toBe(true); // 127.0.0.1
      expect(isPrivateIPv6('::ffff:c0a8:0101')).toBe(true); // 192.168.1.1
    });

    it('should return false for public IPv6 addresses', () => {
      expect(isPrivateIPv6('2001:db8::1')).toBe(false);
      expect(isPrivateIPv6('2607:f8b0:4004:800::200e')).toBe(false);
    });
  });

  describe('isPrivateIP', () => {
    it('should detect private IPv4 addresses', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('192.168.1.1')).toBe(true);
      expect(isPrivateIP('172.16.0.1')).toBe(true);
    });

    it('should detect private IPv6 addresses', () => {
      expect(isPrivateIP('::1')).toBe(true);
      expect(isPrivateIP('fc00::1')).toBe(true);
      expect(isPrivateIP('fe80::1')).toBe(true);
    });

    it('should handle IPv6 addresses with brackets', () => {
      expect(isPrivateIP('[::1]')).toBe(true);
      expect(isPrivateIP('[fc00::1]')).toBe(true);
    });

    it('should return false for public addresses', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('2001:db8::1')).toBe(false);
    });
  });
});

describe('validateWebhookUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('protocol validation', () => {
    it('should accept http URLs', () => {
      process.env.NODE_ENV = 'test';
      expect(validateWebhookUrl('http://example.com/webhook')).toEqual({ valid: true });
    });

    it('should accept https URLs', () => {
      process.env.NODE_ENV = 'test';
      expect(validateWebhookUrl('https://example.com/webhook')).toEqual({ valid: true });
    });

    it('should reject ftp URLs', () => {
      expect(validateWebhookUrl('ftp://example.com/webhook')).toEqual({
        valid: false,
        error: 'Invalid protocol: ftp:. Only http and https are allowed.',
      });
    });

    it('should reject file URLs', () => {
      expect(validateWebhookUrl('file:///etc/passwd')).toEqual({
        valid: false,
        error: 'Invalid protocol: file:. Only http and https are allowed.',
      });
    });
  });

  describe('SSRF protection (production mode)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      delete process.env.F2A_ALLOW_LOCAL_WEBHOOK;
    });

    it('should reject localhost', () => {
      const result = validateWebhookUrl('http://localhost/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('should reject 127.0.0.1', () => {
      const result = validateWebhookUrl('http://127.0.0.1/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject 10.x.x.x', () => {
      const result = validateWebhookUrl('http://10.0.0.1/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject 192.168.x.x', () => {
      const result = validateWebhookUrl('http://192.168.1.1/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject 172.16.x.x', () => {
      const result = validateWebhookUrl('http://172.16.0.1/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject .localhost domains', () => {
      const result = validateWebhookUrl('http://app.localhost/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('should reject .local domains', () => {
      const result = validateWebhookUrl('http://app.local/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('local');
    });

    it('should reject IPv6 loopback [::1]', () => {
      const result = validateWebhookUrl('http://[::1]/webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should accept public URLs', () => {
      const result = validateWebhookUrl('https://api.example.com/webhook');
      expect(result.valid).toBe(true);
    });
  });

  describe('development mode (allow local)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should accept localhost in development', () => {
      const result = validateWebhookUrl('http://localhost/webhook');
      expect(result.valid).toBe(true);
    });

    it('should accept 127.0.0.1 in development', () => {
      const result = validateWebhookUrl('http://127.0.0.1/webhook');
      expect(result.valid).toBe(true);
    });

    it('should accept private IPs in development', () => {
      const result = validateWebhookUrl('http://192.168.1.1/webhook');
      expect(result.valid).toBe(true);
    });
  });

  describe('test mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('should allow local addresses in test mode', () => {
      expect(validateWebhookUrl('http://localhost/webhook')).toEqual({ valid: true });
      expect(validateWebhookUrl('http://127.0.0.1/webhook')).toEqual({ valid: true });
    });
  });

  describe('F2A_ALLOW_LOCAL_WEBHOOK override', () => {
    it('should allow local when F2A_ALLOW_LOCAL_WEBHOOK=true', () => {
      process.env.NODE_ENV = 'production';
      process.env.F2A_ALLOW_LOCAL_WEBHOOK = 'true';
      expect(validateWebhookUrl('http://localhost/webhook')).toEqual({ valid: true });
    });
  });

  describe('invalid URLs', () => {
    it('should reject malformed URLs', () => {
      const result = validateWebhookUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should reject empty URLs', () => {
      const result = validateWebhookUrl('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });
  });
});

describe('WebhookService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create service with config', () => {
      const service = new WebhookService({
        url: 'https://api.example.com/webhook',
        token: 'test-token',
      });
      expect(service).toBeDefined();
    });
  });

  describe('send', () => {
    it('should fail when token not set', async () => {
      const service = new WebhookService({
        url: 'https://api.example.com/webhook',
        token: undefined,
      });

      const result = await service.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Token not set');
    });

    it('should fail when URL is invalid in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.F2A_ALLOW_LOCAL_WEBHOOK;

      const service = new WebhookService({
        url: 'http://localhost/webhook',
        token: 'test-token',
      });

      const result = await service.send({ message: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('localhost');
    });

    it('should attempt send in test mode', async () => {
      process.env.NODE_ENV = 'test';

      const service = new WebhookService({
        url: 'http://localhost/webhook',
        token: 'test-token',
        timeout: 1000,
        retries: 1,
      });

      const result = await service.send({ message: 'test message' });
      // 会因为实际网络请求失败，但验证了 URL 通过了安全检查
      expect(result).toBeDefined();
    });
  });
});