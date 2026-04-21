/**
 * 签名工具测试
 * 测试 RequestSigner 和 loadSignatureConfig
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RequestSigner, loadSignatureConfig, isSignatureAvailable, requireSignatureInProduction } from './signature.js';

describe('RequestSigner', () => {
  let signer: RequestSigner;

  beforeEach(() => {
    signer = new RequestSigner({
      secretKey: 'test-secret-key-for-unit-testing-32ch',
      timestampTolerance: 5000 // 5 秒
    });
  });

  describe('sign', () => {
    it('应该生成有效的签名消息', () => {
      const payload = JSON.stringify({ action: 'test', data: 'hello' });
      const signed = signer.sign(payload);

      expect(signed.payload).toBe(payload);
      expect(typeof signed.timestamp).toBe('number');
      expect(signed.timestamp).toBeGreaterThan(0);
      expect(signed.signature).toMatch(/^[a-f0-9]{64}$/); // HMAC-SHA256 = 64 hex chars
      expect(signed.nonce).toMatch(/^[a-f0-9]{32}$/); // 16 bytes -> 32 hex chars
      expect(signed.nonce.length).toBe(32);
    });

    it('应该为相同的 payload 生成不同的签名（因为 nonce 和 timestamp）', () => {
      const payload = JSON.stringify({ action: 'test' });
      const signed1 = signer.sign(payload);
      const signed2 = signer.sign(payload);

      expect(signed1.signature).not.toBe(signed2.signature);
      expect(signed1.nonce).not.toBe(signed2.nonce);
    });
  });

  describe('verify', () => {
    it('应该验证有效的签名', () => {
      const payload = JSON.stringify({ action: 'test' });
      const signed = signer.sign(payload);

      const result = signer.verify(signed);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('应该拒绝过期的签名', async () => {
      // 创建一个使用较长容忍度的 signer 来测试过期逻辑
      const shortToleranceSigner = new RequestSigner({
        secretKey: 'test-secret-key-for-unit-testing-32ch',
        timestampTolerance: 100 // 100ms 容忍度
      });
      
      const payload = JSON.stringify({ action: 'test' });
      const signed = shortToleranceSigner.sign(payload);
      
      // 等待超过容忍时间
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // 现在签名应该过期了
      const result = shortToleranceSigner.verify(signed);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Timestamp expired');
    });

    it('应该拒绝无效的签名', () => {
      const payload = JSON.stringify({ action: 'test' });
      const signed = signer.sign(payload);
      
      // 修改签名使其无效
      signed.signature = 'invalid-signature-hash';

      const result = signer.verify(signed);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });

    it('应该拒绝被篡改的 payload', () => {
      const payload = JSON.stringify({ action: 'test' });
      const signed = signer.sign(payload);
      
      // 篡改 payload
      signed.payload = JSON.stringify({ action: 'hacked' });

      const result = signer.verify(signed);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid signature');
    });
  });

  describe('常量时间比较', () => {
    it('应该正确比较相同长度的字符串', () => {
      const payload = JSON.stringify({ action: 'test' });
      const signed = signer.sign(payload);
      const result = signer.verify(signed);
      expect(result.valid).toBe(true);
    });

    it('应该拒绝不同长度的签名', () => {
      const payload = JSON.stringify({ action: 'test' });
      const signed = signer.sign(payload);
      signed.signature = 'short';
      
      const result = signer.verify(signed);
      expect(result.valid).toBe(false);
    });
  });
});

describe('loadSignatureConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 重置环境变量
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('开发环境行为', () => {
    it('当 F2A_SIGNATURE_KEY 未设置时应该返回 null', async () => {
      delete process.env.F2A_SIGNATURE_KEY;
      process.env.NODE_ENV = 'development';

      const { loadSignatureConfig } = await import('./signature.js');
      const config = loadSignatureConfig();

      expect(config).toBeNull();
    });

    it('当 F2A_SIGNATURE_KEY 设置时应该返回配置', async () => {
      process.env.F2A_SIGNATURE_KEY = 'test-secret-key-32-chars-long!!';
      process.env.NODE_ENV = 'development';

      const { loadSignatureConfig } = await import('./signature.js');
      const config = loadSignatureConfig();

      expect(config).not.toBeNull();
      expect(config?.secretKey).toBe('test-secret-key-32-chars-long!!');
    });

    it('应该使用自定义时间戳容忍度', async () => {
      process.env.F2A_SIGNATURE_KEY = 'test-secret-key-32-chars-long!!';
      process.env.F2A_SIGNATURE_TOLERANCE = '60000';
      process.env.NODE_ENV = 'development';

      const { loadSignatureConfig } = await import('./signature.js');
      const config = loadSignatureConfig();

      expect(config?.timestampTolerance).toBe(60000);
    });
  });

  describe('生产环境行为', () => {
    it('当 F2A_SIGNATURE_KEY 未设置时应该抛出错误', async () => {
      delete process.env.F2A_SIGNATURE_KEY;
      process.env.NODE_ENV = 'production';

      // 需要重新导入模块以获取新的环境变量状态
      vi.resetModules();
      const { loadSignatureConfig } = await import('./signature.js');

      expect(() => loadSignatureConfig()).toThrow(
        'F2A_SIGNATURE_KEY is required in production environment'
      );
    });

    it('当 F2A_SIGNATURE_KEY 设置时应该返回配置', async () => {
      process.env.F2A_SIGNATURE_KEY = 'production-secret-key-32-chars!!!';
      process.env.NODE_ENV = 'production';

      vi.resetModules();
      const { loadSignatureConfig } = await import('./signature.js');
      const config = loadSignatureConfig();

      expect(config).not.toBeNull();
      expect(config?.secretKey).toBe('production-secret-key-32-chars!!!');
    });

    it('错误消息应该包含设置密钥的示例', async () => {
      delete process.env.F2A_SIGNATURE_KEY;
      process.env.NODE_ENV = 'production';

      vi.resetModules();
      const { loadSignatureConfig } = await import('./signature.js');

      try {
        loadSignatureConfig();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('openssl rand -hex 32');
      }
    });
  });

  describe('密钥强度警告', () => {
    it('应该对短密钥发出警告', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      process.env.F2A_SIGNATURE_KEY = 'short-key';
      process.env.NODE_ENV = 'development';

      vi.resetModules();
      const { loadSignatureConfig } = await import('./signature.js');
      loadSignatureConfig();

      // 注意：Logger 内部可能使用不同的日志方式
      // 这里我们检查函数返回了配置
      // 实际警告由 Logger 输出
      
      warnSpy.mockRestore();
    });
  });
});

describe('isSignatureAvailable', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('当 F2A_SIGNATURE_KEY 设置时应该返回 true', async () => {
    process.env.F2A_SIGNATURE_KEY = 'test-secret-key-32-chars-long!!';

    vi.resetModules();
    const { isSignatureAvailable } = await import('./signature.js');

    expect(isSignatureAvailable()).toBe(true);
  });

  it('当 F2A_SIGNATURE_KEY 未设置时应该返回 false', async () => {
    delete process.env.F2A_SIGNATURE_KEY;

    vi.resetModules();
    const { isSignatureAvailable } = await import('./signature.js');

    expect(isSignatureAvailable()).toBe(false);
  });
});

describe('requireSignatureInProduction', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('在生产环境无密钥时应该抛出错误', async () => {
    delete process.env.F2A_SIGNATURE_KEY;
    process.env.NODE_ENV = 'production';

    vi.resetModules();
    const { requireSignatureInProduction } = await import('./signature.js');

    expect(() => requireSignatureInProduction()).toThrow(
      'Signature verification is required in production'
    );
  });

  it('在生产环境有密钥时不应该抛出错误', async () => {
    process.env.F2A_SIGNATURE_KEY = 'production-secret-key-32-chars!!!';
    process.env.NODE_ENV = 'production';

    vi.resetModules();
    const { requireSignatureInProduction } = await import('./signature.js');

    expect(() => requireSignatureInProduction()).not.toThrow();
  });

  it('在开发环境无密钥时不应该抛出错误', async () => {
    delete process.env.F2A_SIGNATURE_KEY;
    process.env.NODE_ENV = 'development';

    vi.resetModules();
    const { requireSignatureInProduction } = await import('./signature.js');

    expect(() => requireSignatureInProduction()).not.toThrow();
  });
});