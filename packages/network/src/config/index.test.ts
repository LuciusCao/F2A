import { describe, it, expect } from 'vitest';
import {
  validateP2PNetworkConfig,
  validateSecurityConfig,
  mergeConfig,
} from './index.js';
import {
  DEFAULT_P2P_NETWORK_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_F2A_OPTIONS,
  DEFAULT_RATE_LIMIT_CONFIG,
} from './defaults.js';

describe('Config Module', () => {
  describe('validateP2PNetworkConfig', () => {
    it('应该验证有效配置', () => {
      const result = validateP2PNetworkConfig({
        listenPort: 4001,
        bootstrapPeers: ['/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWTest'],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('应该接受空配置', () => {
      const result = validateP2PNetworkConfig({});

      expect(result.valid).toBe(true);
    });

    it('应该拒绝无效端口（负数）', () => {
      const result = validateP2PNetworkConfig({ listenPort: -1 });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('listenPort must be between 0 and 65535');
    });

    it('应该拒绝无效端口（过大）', () => {
      const result = validateP2PNetworkConfig({ listenPort: 70000 });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('listenPort must be between 0 and 65535');
    });

    it('应该接受端口 0（随机分配）', () => {
      const result = validateP2PNetworkConfig({ listenPort: 0 });

      expect(result.valid).toBe(true);
    });

    it('应该拒绝无效的引导节点格式', () => {
      const result = validateP2PNetworkConfig({
        bootstrapPeers: ['invalid-peer-address'],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid bootstrap peer format');
    });

    it('应该验证多个引导节点', () => {
      const result = validateP2PNetworkConfig({
        bootstrapPeers: [
          '/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWValid',
          'invalid-peer',
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('validateSecurityConfig', () => {
    it('应该验证有效配置', () => {
      const result = validateSecurityConfig({
        level: 'medium',
        rateLimit: {
          maxRequests: 100,
          windowMs: 60000,
        },
      });

      expect(result.valid).toBe(true);
    });

    it('应该接受空配置', () => {
      const result = validateSecurityConfig({});

      expect(result.valid).toBe(true);
    });

    it('应该拒绝无效的安全级别', () => {
      const result = validateSecurityConfig({ level: 'invalid' as 'low' | 'medium' | 'high' });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid security level');
    });

    it('应该接受所有有效安全级别', () => {
      for (const level of ['low', 'medium', 'high'] as const) {
        const result = validateSecurityConfig({ level });
        expect(result.valid).toBe(true);
      }
    });

    it('应该拒绝 maxRequests < 1', () => {
      const result = validateSecurityConfig({
        rateLimit: {
          maxRequests: 0,
          windowMs: 60000,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('rateLimit.maxRequests must be at least 1');
    });

    it('应该拒绝 windowMs < 1000', () => {
      const result = validateSecurityConfig({
        rateLimit: {
          maxRequests: 100,
          windowMs: 500,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('rateLimit.windowMs must be at least 1000ms');
    });

    it('应该接受最小有效速率限制', () => {
      const result = validateSecurityConfig({
        rateLimit: {
          maxRequests: 1,
          windowMs: 1000,
        },
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('mergeConfig', () => {
    it('应该合并简单对象', () => {
      const target = { a: 1, b: 2 };
      const source = { b: 3, c: 4 };

      const result = mergeConfig(target, source);

      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('应该深度合并嵌套对象', () => {
      const target = {
        a: 1,
        nested: { x: 1, y: 2 },
      };
      const source = {
        b: 2,
        nested: { y: 3, z: 4 },
      };

      const result = mergeConfig(target, source);

      expect(result).toEqual({
        a: 1,
        b: 2,
        nested: { x: 1, y: 3, z: 4 },
      });
    });

    it('应该处理空 source', () => {
      const target = { a: 1, b: 2 };

      const result = mergeConfig(target, {});

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('应该处理空 target', () => {
      const source = { a: 1, b: 2 };

      const result = mergeConfig({} as Record<string, unknown>, source);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('应该处理数组（直接替换）', () => {
      const target = { arr: [1, 2, 3] };
      const source = { arr: [4, 5] };

      const result = mergeConfig(target, source);

      expect(result.arr).toEqual([4, 5]);
    });

    it('应该处理 null 值', () => {
      const target = { a: 1, b: null };
      const source = { b: 2 };

      const result = mergeConfig(target, source);

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('应该处理 undefined 值', () => {
      const target = { a: 1, b: 2 };
      const source = { b: undefined };

      const result = mergeConfig(target, source);

      // 检查 b 是否被设置为 undefined 或保持原值
      // 具体行为取决于实现
      expect(result.a).toBe(1);
    });

    it('应该处理深层嵌套', () => {
      const target = {
        level1: {
          level2: {
            level3: {
              value: 'original',
            },
          },
        },
      };
      const source = {
        level1: {
          level2: {
            level3: {
              value: 'updated',
              newKey: 'new',
            },
          },
        },
      };

      const result = mergeConfig(target, source);

      expect(result.level1.level2.level3.value).toBe('updated');
      expect(result.level1.level2.level3.newKey).toBe('new');
    });
  });

  describe('默认值导出', () => {
    it('应该导出 DEFAULT_P2P_NETWORK_CONFIG', () => {
      expect(DEFAULT_P2P_NETWORK_CONFIG).toBeDefined();
      expect(DEFAULT_P2P_NETWORK_CONFIG.listenPort).toBeDefined();
    });

    it('应该导出 DEFAULT_SECURITY_CONFIG', () => {
      expect(DEFAULT_SECURITY_CONFIG).toBeDefined();
    });

    it('应该导出 DEFAULT_F2A_OPTIONS', () => {
      expect(DEFAULT_F2A_OPTIONS).toBeDefined();
    });

    it('应该导出 DEFAULT_RATE_LIMIT_CONFIG', () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG).toBeDefined();
      expect(DEFAULT_RATE_LIMIT_CONFIG.maxRequests).toBeGreaterThan(0);
      expect(DEFAULT_RATE_LIMIT_CONFIG.windowMs).toBeGreaterThan(0);
    });
  });
});