/**
 * Webhook 测试 - 安全防护函数
 */

import { describe, it, expect } from 'vitest';
import { isPrivateIPv4, isIPv6Format, parseIPv4MappedIPv6 } from './webhook.js';

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
      // 十六进制格式需要 ::ffff: 前缀
      // c0a8 = 49320 (192*256 + 168), 0101 = 257 (1*256 + 1)
      // 所以 ::ffff:c0a8:0101 = ::ffff:192.168.1.1
      const result = parseIPv4MappedIPv6('::ffff:c0a8:101');
      expect(result).toEqual([192, 168, 1, 1]);
    });

    it('should return null for non-IPv4-mapped addresses', () => {
      expect(parseIPv4MappedIPv6('2001:db8::1')).toBeNull();
      expect(parseIPv4MappedIPv6('::1')).toBeNull();
      expect(parseIPv4MappedIPv6('192.168.1.1')).toBeNull();
    });
  });
});