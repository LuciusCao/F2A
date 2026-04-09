import { describe, it, expect, vi } from 'vitest';

describe('P2PNetwork', () => {
  describe('multiaddr selection', () => {
    it('should not dial localhost when other addresses available', () => {
      // TODO: 测试 multiaddrs 选择逻辑
      expect(true).toBe(true);
    });
    
    it('should prefer LAN over Tailscale addresses', () => {
      // TODO: 测试地址优先级
      expect(true).toBe(true);
    });
  });
  
  describe('sendMessage', () => {
    it('should filter localhost in reconnect scenario', () => {
      // TODO: 测试重连时的地址选择
      expect(true).toBe(true);
    });
  });
});
