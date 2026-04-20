/**
 * AgentId 格式与验证测试 - RFC008 实现
 *
 * 测试新格式和旧格式的解析、生成和验证
 */

import { describe, it, expect } from 'vitest';
import {
  generateAgentId,
  computeFingerprint,
  parseAgentId,
  validateAgentId,
  isNewFormat,
  isOldFormat,
  isValidAgentIdFormat,
  extractFingerprint,
  extractPeerIdPrefix
} from './agent-id.js';
import { Ed25519Signer } from './ed25519-signer.js';

describe('AgentId - RFC008', () => {
  describe('computeFingerprint', () => {
    it('should compute fingerprint from Uint8Array public key', () => {
      // 创建一个测试公钥（32 bytes）
      const publicKey = new Uint8Array(32).fill(0x42);
      const fingerprint = computeFingerprint(publicKey);

      // 指纹应该是 16 位十六进制字符串
      expect(fingerprint).toHaveLength(16);
      expect(fingerprint).toMatch(/^[0-9a-fA-F]{16}$/);
    });

    it('should compute fingerprint from Base64 encoded public key', () => {
      // 创建一个 Ed25519 密钥对
      const signer = new Ed25519Signer();
      const publicKeyBase64 = signer.getPublicKey();

      const fingerprint = computeFingerprint(publicKeyBase64);

      expect(fingerprint).toHaveLength(16);
      expect(fingerprint).toMatch(/^[0-9a-fA-F]{16}$/);
    });

    it('should produce consistent fingerprint for same public key', () => {
      const signer = new Ed25519Signer();
      const publicKeyBase64 = signer.getPublicKey();

      const fingerprint1 = computeFingerprint(publicKeyBase64);
      const fingerprint2 = computeFingerprint(publicKeyBase64);

      expect(fingerprint1).toBe(fingerprint2);
    });

    it('should produce different fingerprints for different public keys', () => {
      const signer1 = new Ed25519Signer();
      const signer2 = new Ed25519Signer();

      const fingerprint1 = computeFingerprint(signer1.getPublicKey());
      const fingerprint2 = computeFingerprint(signer2.getPublicKey());

      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('generateAgentId', () => {
    it('should generate new format AgentId', () => {
      const signer = new Ed25519Signer();
      const publicKeyBase64 = signer.getPublicKey();

      const agentId = generateAgentId(publicKeyBase64);

      // 应该是 agent:<fingerprint> 格式
      expect(agentId).toMatch(/^agent:[0-9a-fA-F]{16}$/);
    });

    it('should generate AgentId with correct fingerprint', () => {
      const publicKey = new Uint8Array(32).fill(0x42);
      const agentId = generateAgentId(publicKey);
      const fingerprint = computeFingerprint(publicKey);

      expect(agentId).toBe(`agent:${fingerprint}`);
    });

    it('should generate valid AgentId that can be parsed', () => {
      const signer = new Ed25519Signer();
      const agentId = generateAgentId(signer.getPublicKey());

      const parsed = parseAgentId(agentId);

      expect(parsed.valid).toBe(true);
      expect(parsed.format).toBe('new');
    });
  });

  describe('parseAgentId', () => {
    describe('new format (RFC008)', () => {
      it('should parse valid new format AgentId', () => {
        const agentId = 'agent:a3b2c1d4e5f67890';
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(true);
        expect(parsed.format).toBe('new');
        expect(parsed.fingerprint).toBe('a3b2c1d4e5f67890');
      });

      it('should normalize fingerprint to lowercase', () => {
        const agentId = 'agent:A3B2C1D4E5F67890';
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(true);
        expect(parsed.fingerprint).toBe('a3b2c1d4e5f67890');
      });

      it('should reject invalid fingerprint length', () => {
        const agentId = 'agent:a3b2c1d4'; // 只有 8 位
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(false);
        expect(parsed.error).toContain('length');
      });

      it('should reject non-hexadecimal fingerprint', () => {
        const agentId = 'agent:a3b2c1d4xyz789ab'; // 16 字符，包含非十六进制字符
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(false);
        expect(parsed.error).toContain('hexadecimal');
      });
    });

    describe('old format (RFC003)', () => {
      it('should parse valid old format AgentId', () => {
        // PeerId 前缀使用 base58btc 字符集（16 字符）
        // 示例 PeerId: 12D3KooWHxWdnxJaaCMA4bVcnucEV35j2m6mYpNqZZbQW9zJ9nLVW
        // 前 16 位: 12D3KooWHxWdnxJa
        const agentId = 'agent:12D3KooWHxWdnxJa:abc12345';
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(true);
        expect(parsed.format).toBe('old');
        expect(parsed.peerIdPrefix).toBe('12D3KooWHxWdnxJa');
        expect(parsed.randomSuffix).toBe('abc12345');
      });

      it('should normalize random suffix to lowercase', () => {
        const agentId = 'agent:12D3KooWHxWdnxJa:ABC12345';
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(true);
        expect(parsed.randomSuffix).toBe('abc12345');
      });

      it('should reject invalid PeerId prefix length', () => {
        const agentId = 'agent:12D3KooW:abc12345'; // 只有 8 位
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(false);
        expect(parsed.error).toContain('16');
      });

      it('should reject invalid PeerId prefix with non-base58btc characters', () => {
        // 16 字符，包含 0, I, l（无效 base58btc 字符）
        const agentId = 'agent:12D3KooW0IlmNopa:abc12345';
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(false);
        expect(parsed.error).toContain('base58btc');
      });

      it('should reject invalid random suffix format', () => {
        const agentId = 'agent:12D3KooWHxWdnxJa:abcdefgh'; // 非十六进制（包含 g, h）
        const parsed = parseAgentId(agentId);

        expect(parsed.valid).toBe(false);
        expect(parsed.error).toContain('8 hexadecimal');
      });
    });

    describe('invalid formats', () => {
      it('should reject empty string', () => {
        const parsed = parseAgentId('');

        expect(parsed.valid).toBe(false);
      });

      it('should reject non-agent prefix', () => {
        const parsed = parseAgentId('user:a3b2c1d4e5f67890');

        expect(parsed.valid).toBe(false);
        expect(parsed.error).toContain('must start with "agent:"');
      });

      it('should reject wrong number of parts', () => {
        const parsed = parseAgentId('agent:part1:part2:part3');

        expect(parsed.valid).toBe(false);
        expect(parsed.error).toContain('2 or 3 parts');
      });
    });
  });

  describe('validateAgentId', () => {
    it('should validate new format AgentId with matching public key', () => {
      const signer = new Ed25519Signer();
      const publicKey = signer.getPublicKey();
      const agentId = generateAgentId(publicKey);

      const result = validateAgentId(agentId, publicKey);

      expect(result.valid).toBe(true);
      expect(result.format).toBe('new');
    });

    it('should reject new format AgentId with non-matching public key', () => {
      const signer1 = new Ed25519Signer();
      const signer2 = new Ed25519Signer();

      const agentId = generateAgentId(signer1.getPublicKey());
      const result = validateAgentId(agentId, signer2.getPublicKey());

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Fingerprint mismatch');
    });

    it('should reject old format AgentId (cannot validate by fingerprint)', () => {
      const signer = new Ed25519Signer();
      const agentId = 'agent:12D3KooWHxWdnxJa:abc12345'; // 旧格式

      const result = validateAgentId(agentId, signer.getPublicKey());

      expect(result.valid).toBe(false);
      expect(result.format).toBe('old');
      expect(result.error).toContain('Old format');
      expect(result.error).toContain('signature verification');
    });

    it('should reject invalid AgentId format', () => {
      const signer = new Ed25519Signer();
      const result = validateAgentId('invalid-format', signer.getPublicKey());

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('isNewFormat', () => {
    it('should return true for valid new format AgentId', () => {
      expect(isNewFormat('agent:a3b2c1d4e5f67890')).toBe(true);
    });

    it('should return false for old format AgentId', () => {
      expect(isNewFormat('agent:12D3KooWHxWdnxJa:abc12345')).toBe(false);
    });

    it('should return false for invalid AgentId', () => {
      expect(isNewFormat('invalid')).toBe(false);
      expect(isNewFormat('agent:invalid')).toBe(false);
    });
  });

  describe('isOldFormat', () => {
    it('should return true for valid old format AgentId', () => {
      expect(isOldFormat('agent:12D3KooWHxWdnxJa:abc12345')).toBe(true);
    });

    it('should return false for new format AgentId', () => {
      expect(isOldFormat('agent:a3b2c1d4e5f67890')).toBe(false);
    });

    it('should return false for invalid AgentId', () => {
      expect(isOldFormat('invalid')).toBe(false);
      expect(isOldFormat('agent:invalid')).toBe(false);
    });
  });

  describe('isValidAgentIdFormat', () => {
    it('should return true for valid new format', () => {
      expect(isValidAgentIdFormat('agent:a3b2c1d4e5f67890')).toBe(true);
    });

    it('should return true for valid old format', () => {
      expect(isValidAgentIdFormat('agent:12D3KooWHxWdnxJa:abc12345')).toBe(true);
    });

    it('should return false for invalid formats', () => {
      expect(isValidAgentIdFormat('invalid')).toBe(false);
      expect(isValidAgentIdFormat('agent:short')).toBe(false);
      expect(isValidAgentIdFormat('agent:12D3KooWHxWdnxJa:xyz')).toBe(false);
    });
  });

  describe('extractFingerprint', () => {
    it('should extract fingerprint from new format AgentId', () => {
      const fingerprint = extractFingerprint('agent:a3b2c1d4e5f67890');

      expect(fingerprint).toBe('a3b2c1d4e5f67890');
    });

    it('should return null for old format AgentId', () => {
      const fingerprint = extractFingerprint('agent:12D3KooWHxWdnxJa:abc12345');

      expect(fingerprint).toBeNull();
    });

    it('should return null for invalid AgentId', () => {
      const fingerprint = extractFingerprint('invalid');

      expect(fingerprint).toBeNull();
    });
  });

  describe('extractPeerIdPrefix', () => {
    it('should extract PeerId prefix from old format AgentId', () => {
      const prefix = extractPeerIdPrefix('agent:12D3KooWHxWdnxJa:abc12345');

      expect(prefix).toBe('12D3KooWHxWdnxJa');
    });

    it('should return null for new format AgentId', () => {
      const prefix = extractPeerIdPrefix('agent:a3b2c1d4e5f67890');

      expect(prefix).toBeNull();
    });

    it('should return null for invalid AgentId', () => {
      const prefix = extractPeerIdPrefix('invalid');

      expect(prefix).toBeNull();
    });
  });

  describe('integration tests', () => {
    it('should work end-to-end with Ed25519Signer', () => {
      // 1. 生成密钥对
      const signer = new Ed25519Signer();
      const publicKey = signer.getPublicKey();

      // 2. 生成 AgentId
      const agentId = generateAgentId(publicKey);

      // 3. 解析 AgentId
      const parsed = parseAgentId(agentId);
      expect(parsed.valid).toBe(true);
      expect(parsed.format).toBe('new');

      // 4. 验证 AgentId
      const validation = validateAgentId(agentId, publicKey);
      expect(validation.valid).toBe(true);

      // 5. 检查格式类型
      expect(isNewFormat(agentId)).toBe(true);
      expect(isOldFormat(agentId)).toBe(false);

      // 6. 提取指纹
      const fingerprint = extractFingerprint(agentId);
      expect(fingerprint).toBe(parsed.fingerprint);
    });

    it('should distinguish between new and old format correctly', () => {
      const newFormatId = generateAgentId(new Ed25519Signer().getPublicKey());
      const oldFormatId = 'agent:12D3KooWHxWdnxJa:abc12345';

      expect(isNewFormat(newFormatId)).toBe(true);
      expect(isOldFormat(newFormatId)).toBe(false);

      expect(isNewFormat(oldFormatId)).toBe(false);
      expect(isOldFormat(oldFormatId)).toBe(true);
    });
  });
});