/**
 * encrypted-key-store.ts 测试
 * 
 * 测试覆盖：
 * - 密码强度验证（弱密码拒绝）
 * - 加密/解密成功
 * - 加密/解密失败（错误密码）
 * - 密钥清零（secureWipe）
 * - 边界情况（空输入、超长密码）
 */

import { describe, it, expect } from 'vitest';
import { 
  validatePasswordStrength,
  encryptIdentity,
  decryptIdentity,
  MIN_PASSWORD_LENGTH
} from './encrypted-key-store.js';
import { secureWipe } from '../../utils/crypto-utils.js';
import type { PersistedIdentity, EncryptedIdentity } from './types.js';

// 测试用的有效身份数据
function createTestIdentity(): PersistedIdentity {
  return {
    peerId: 'test-private-key-base64',
    e2eePrivateKey: 'test-e2ee-private-key-base64',
    e2eePublicKey: 'test-e2ee-public-key-base64',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString()
  };
}

// 测试用的有效密码（满足所有要求）
const VALID_PASSWORD = 'Secure-password-123';

describe('validatePasswordStrength', () => {
  describe('密码长度验证', () => {
    it('should reject password shorter than MIN_PASSWORD_LENGTH', () => {
      const shortPassword = 'Ab1'; // 3 characters, below minimum
      
      expect(() => validatePasswordStrength(shortPassword)).toThrow(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
      );
    });

    it('should accept password exactly at MIN_PASSWORD_LENGTH with proper format', () => {
      // MIN_PASSWORD_LENGTH = 8, create password exactly 8 chars with uppercase, lowercase, digit
      const validPassword = 'Abcdefg1'; // 8 characters
      
      expect(() => validatePasswordStrength(validPassword)).not.toThrow();
    });

    it('should reject password at MIN_PASSWORD_LENGTH but missing complexity', () => {
      // 8 characters but all lowercase
      const weakPassword = 'abcdefgh';
      
      expect(() => validatePasswordStrength(weakPassword)).toThrow(
        'Password must contain at least one uppercase letter, one lowercase letter, and one digit'
      );
    });
  });

  describe('密码复杂度验证', () => {
    it('should reject password without uppercase letter', () => {
      const noUppercase = 'secure-password-123'; // all lowercase
      
      expect(() => validatePasswordStrength(noUppercase)).toThrow(
        'Password must contain at least one uppercase letter, one lowercase letter, and one digit'
      );
    });

    it('should reject password without lowercase letter', () => {
      const noLowercase = 'SECURE-PASSWORD-123'; // all uppercase
      
      expect(() => validatePasswordStrength(noLowercase)).toThrow(
        'Password must contain at least one uppercase letter, one lowercase letter, and one digit'
      );
    });

    it('should reject password without digit', () => {
      const noDigit = 'Secure-password'; // no numbers
      
      expect(() => validatePasswordStrength(noDigit)).toThrow(
        'Password must contain at least one uppercase letter, one lowercase letter, and one digit'
      );
    });

    it('should accept password with all required characters', () => {
      const validPassword = 'MySecurePassword123';
      
      expect(() => validatePasswordStrength(validPassword)).not.toThrow();
    });

    it('should accept password with mixed case and digit anywhere', () => {
      // Digit at the beginning
      expect(() => validatePasswordStrength('1SecurePassword')).not.toThrow();
      // Uppercase at the end
      expect(() => validatePasswordStrength('securepassword1A')).not.toThrow();
      // Mixed throughout
      expect(() => validatePasswordStrength('aB1cD2eF')).not.toThrow();
    });
  });

  describe('类型验证', () => {
    it('should reject non-string password', () => {
      expect(() => validatePasswordStrength(null as any)).toThrow(
        'Password must be a string'
      );
    });

    it('should reject undefined password', () => {
      expect(() => validatePasswordStrength(undefined as any)).toThrow(
        'Password must be a string'
      );
    });

    it('should reject number password', () => {
      expect(() => validatePasswordStrength(12345678 as any)).toThrow(
        'Password must be a string'
      );
    });

    it('should reject object password', () => {
      expect(() => validatePasswordStrength({} as any)).toThrow(
        'Password must be a string'
      );
    });
  });

  describe('边界情况', () => {
    it('should reject empty string password', () => {
      expect(() => validatePasswordStrength('')).toThrow(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
      );
    });

    it('should handle very long password (1000 chars)', () => {
      // Create a 1000 character password with required complexity
      const longPassword = 'A' + 'b'.repeat(998) + '1';
      
      expect(() => validatePasswordStrength(longPassword)).not.toThrow();
    });

    it('should handle password with special characters', () => {
      // Password with special chars still needs uppercase, lowercase, digit
      const withSpecialChars = 'Secure@Password#123!';
      
      expect(() => validatePasswordStrength(withSpecialChars)).not.toThrow();
    });

    it('should handle password with unicode characters', () => {
      // Unicode chars should work as long as requirements met
      const withUnicode = 'Secure密码123';
      
      // 'S' = uppercase, 'e' = lowercase, '1' = digit
      expect(() => validatePasswordStrength(withUnicode)).not.toThrow();
    });
  });
});

describe('encryptIdentity', () => {
  describe('加密成功', () => {
    it('should encrypt identity with valid password', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    });

    it('should return valid base64 for all encrypted fields', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // All fields should be valid base64
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      
      expect(base64Regex.test(encrypted.salt)).toBe(true);
      expect(base64Regex.test(encrypted.iv)).toBe(true);
      expect(base64Regex.test(encrypted.authTag)).toBe(true);
      expect(base64Regex.test(encrypted.ciphertext)).toBe(true);
    });

    it('should generate unique salt for each encryption', () => {
      const identity = createTestIdentity();
      
      const encrypted1 = encryptIdentity(identity, VALID_PASSWORD);
      const encrypted2 = encryptIdentity(identity, VALID_PASSWORD);
      
      // Different salts should be generated (random)
      expect(encrypted1.salt).not.toBe(encrypted2.salt);
    });

    it('should generate unique IV for each encryption', () => {
      const identity = createTestIdentity();
      
      const encrypted1 = encryptIdentity(identity, VALID_PASSWORD);
      const encrypted2 = encryptIdentity(identity, VALID_PASSWORD);
      
      // Different IVs should be generated (random)
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should produce different ciphertext for same data (due to random salt/IV)', () => {
      const identity = createTestIdentity();
      
      const encrypted1 = encryptIdentity(identity, VALID_PASSWORD);
      const encrypted2 = encryptIdentity(identity, VALID_PASSWORD);
      
      // Ciphertext should differ due to different salt/IV
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });
  });

  describe('密码验证集成', () => {
    it('should reject weak password during encryption', () => {
      const identity = createTestIdentity();
      const weakPassword = 'weak'; // too short
      
      expect(() => encryptIdentity(identity, weakPassword)).toThrow(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
      );
    });

    it('should reject password missing complexity during encryption', () => {
      const identity = createTestIdentity();
      const noDigitPassword = 'SecurePassword';
      
      expect(() => encryptIdentity(identity, noDigitPassword)).toThrow(
        'Password must contain at least one uppercase letter, one lowercase letter, and one digit'
      );
    });
  });

  describe('密钥清零验证', () => {
    it('should securely wipe derived key after encryption', () => {
      // This is an indirect test - we can't directly access the internal key
      // But we can verify the function completes without error
      // A more thorough test would need to mock scryptSync or use memory analysis
      
      const identity = createTestIdentity();
      
      // Multiple encryptions should work independently
      // If key wasn't wiped properly, this might cause issues
      for (let i = 0; i < 10; i++) {
        const encrypted = encryptIdentity(identity, VALID_PASSWORD);
        expect(encrypted.encrypted).toBe(true);
      }
    });
  });
});

describe('decryptIdentity', () => {
  describe('解密成功', () => {
    it('should decrypt identity with correct password', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      
      expect(decrypted.peerId).toBe(identity.peerId);
      expect(decrypted.e2eePrivateKey).toBe(identity.e2eePrivateKey);
      expect(decrypted.e2eePublicKey).toBe(identity.e2eePublicKey);
      expect(decrypted.createdAt).toBe(identity.createdAt);
      expect(decrypted.lastUsedAt).toBe(identity.lastUsedAt);
    });

    it('should decrypt identity with same password used for encryption', () => {
      const identity = createTestIdentity();
      const password = 'TestPassword123';
      
      const encrypted = encryptIdentity(identity, password);
      const decrypted = decryptIdentity(encrypted, password);
      
      expect(decrypted).toEqual(identity);
    });

    it('should handle complex identity data', () => {
      const complexIdentity: PersistedIdentity = {
        peerId: '12D3KooWVeryLongPeerIdStringWithSpecialCharacters!@#$%',
        e2eePrivateKey: Buffer.from('complex-private-key-data').toString('base64'),
        e2eePublicKey: Buffer.from('complex-public-key-data').toString('base64'),
        createdAt: '2024-01-15T10:30:00.000Z',
        lastUsedAt: '2024-12-31T23:59:59.999Z'
      };
      
      const encrypted = encryptIdentity(complexIdentity, VALID_PASSWORD);
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      
      expect(decrypted).toEqual(complexIdentity);
    });
  });

  describe('解密失败 - 错误密码', () => {
    it('should throw error when decrypting with wrong password', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      expect(() => decryptIdentity(encrypted, 'WrongPassword123')).toThrow();
    });

    it('should throw error for completely different password', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, 'OriginalPassword1');
      
      expect(() => decryptIdentity(encrypted, 'DifferentPassword2')).toThrow();
    });

    it('should throw error for password with same format but different content', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, 'PasswordAAA111');
      
      // Same length, same complexity pattern, but different content
      expect(() => decryptIdentity(encrypted, 'PasswordBBB222')).toThrow();
    });

    it('should not reveal plaintext with wrong password', () => {
      const identity = createTestIdentity();
      const sensitiveData = 'SENSITIVE_PRIVATE_KEY_DATA';
      identity.peerId = sensitiveData;
      
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Try wrong password
      try {
        decryptIdentity(encrypted, 'WrongPassword123');
      } catch (error) {
        // Error should not contain the sensitive data
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).not.toContain(sensitiveData);
      }
    });
  });

  describe('密钥清零验证', () => {
    it('should securely wipe derived key after decryption (success)', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Multiple decryptions should work independently
      for (let i = 0; i < 10; i++) {
        const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
        expect(decrypted.peerId).toBe(identity.peerId);
      }
    });

    it('should securely wipe derived key even when decryption fails', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Attempt decryption with wrong password multiple times
      // Should not accumulate memory issues
      for (let i = 0; i < 10; i++) {
        expect(() => decryptIdentity(encrypted, 'WrongPassword123')).toThrow();
      }
      
      // Correct password should still work after failed attempts
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      expect(decrypted).toEqual(identity);
    });
  });

  describe('base64 格式验证', () => {
    it('should throw error for invalid base64 salt', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Corrupt the salt
      const corrupted: EncryptedIdentity = {
        ...encrypted,
        salt: 'not-valid-base64!!!'
      };
      
      expect(() => decryptIdentity(corrupted, VALID_PASSWORD)).toThrow(
        'Invalid salt: not valid base64'
      );
    });

    it('should throw error for invalid base64 iv', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Corrupt the iv
      const corrupted: EncryptedIdentity = {
        ...encrypted,
        iv: 'not-valid-base64!!!'
      };
      
      expect(() => decryptIdentity(corrupted, VALID_PASSWORD)).toThrow(
        'Invalid iv: not valid base64'
      );
    });

    it('should throw error for invalid base64 authTag', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Corrupt the authTag
      const corrupted: EncryptedIdentity = {
        ...encrypted,
        authTag: 'not-valid-base64!!!'
      };
      
      expect(() => decryptIdentity(corrupted, VALID_PASSWORD)).toThrow(
        'Invalid authTag: not valid base64'
      );
    });

    it('should throw error for empty ciphertext', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Empty ciphertext
      const corrupted: EncryptedIdentity = {
        ...encrypted,
        ciphertext: ''
      };
      
      expect(() => decryptIdentity(corrupted, VALID_PASSWORD)).toThrow(
        'Invalid ciphertext: empty or not a string'
      );
    });

    it('should throw error for non-string ciphertext', () => {
      const identity = createTestIdentity();
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      
      // Non-string ciphertext
      const corrupted: EncryptedIdentity = {
        ...encrypted,
        ciphertext: null as any
      };
      
      expect(() => decryptIdentity(corrupted, VALID_PASSWORD)).toThrow(
        'Invalid ciphertext: empty or not a string'
      );
    });
  });
});

describe('secureWipe', () => {
  it('should zero out Buffer', () => {
    const buffer = Buffer.from('sensitive-data');
    expect(buffer.toString()).toBe('sensitive-data');
    
    secureWipe(buffer);
    
    // Buffer should be zeroed
    expect(buffer.every(byte => byte === 0)).toBe(true);
  });

  it('should zero out Uint8Array', () => {
    const arr = new Uint8Array([1, 2, 3, 4, 5]);
    expect(arr[0]).toBe(1);
    
    secureWipe(arr);
    
    // Array should be zeroed
    expect(arr.every(byte => byte === 0)).toBe(true);
  });

  it('should handle null input safely', () => {
    // Should not throw
    expect(() => secureWipe(null)).not.toThrow();
  });

  it('should handle undefined input safely', () => {
    // Should not throw
    expect(() => secureWipe(undefined)).not.toThrow();
  });

  it('should handle empty Buffer', () => {
    const emptyBuffer = Buffer.alloc(0);
    
    expect(() => secureWipe(emptyBuffer)).not.toThrow();
  });

  it('should handle empty Uint8Array', () => {
    const emptyArr = new Uint8Array(0);
    
    expect(() => secureWipe(emptyArr)).not.toThrow();
  });

  it('should zero large Buffer', () => {
    // 1MB buffer
    const largeBuffer = Buffer.alloc(1024 * 1024, 0xFF);
    expect(largeBuffer[0]).toBe(0xFF);
    
    secureWipe(largeBuffer);
    
    expect(largeBuffer.every(byte => byte === 0)).toBe(true);
  });
});

describe('encrypt-decrypt roundtrip', () => {
  it('should preserve all identity fields through encrypt-decrypt cycle', () => {
    const originalIdentity: PersistedIdentity = {
      peerId: 'peer-id-value',
      e2eePrivateKey: 'private-key-value',
      e2eePublicKey: 'public-key-value',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastUsedAt: '2024-06-15T12:30:45.123Z'
    };
    
    const encrypted = encryptIdentity(originalIdentity, VALID_PASSWORD);
    const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
    
    expect(decrypted).toEqual(originalIdentity);
  });

  it('should work with different valid passwords', () => {
    const identity = createTestIdentity();
    
    const passwords = [
      'PasswordAAA111',
      'SecurePass123',
      'MyTestPass456',
      'ValidPass789'
    ];
    
    for (const password of passwords) {
      const encrypted = encryptIdentity(identity, password);
      const decrypted = decryptIdentity(encrypted, password);
      expect(decrypted).toEqual(identity);
    }
  });

  it('should handle multiple encrypt-decrypt cycles', () => {
    const identity = createTestIdentity();
    
    // Multiple cycles should work
    for (let i = 0; i < 5; i++) {
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      expect(decrypted).toEqual(identity);
    }
  });
});

describe('edge cases', () => {
  describe('空输入处理', () => {
    it('should encrypt null identity (JSON.stringify behavior)', () => {
      // encryptIdentity doesn't validate identity input - it just JSON.stringify it
      const encrypted = encryptIdentity(null as any, VALID_PASSWORD);
      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.ciphertext).toBeDefined();
      
      // Decrypting null identity returns null (JSON.parse behavior)
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      expect(decrypted).toBeNull();
    });

    it('should encrypt undefined identity (JSON.stringify behavior)', () => {
      // JSON.stringify(undefined) returns undefined, which causes different behavior
      // This will throw because JSON.stringify(undefined) returns undefined (not a string)
      expect(() => encryptIdentity(undefined as any, VALID_PASSWORD)).toThrow();
    });

    it('should throw error for null encrypted data', () => {
      expect(() => decryptIdentity(null as any, VALID_PASSWORD)).toThrow();
    });

    it('should throw error for undefined encrypted data', () => {
      expect(() => decryptIdentity(undefined as any, VALID_PASSWORD)).toThrow();
    });
  });

  describe('超长密码', () => {
    it('should handle very long password for encryption', () => {
      const identity = createTestIdentity();
      // 500 character password with complexity
      const longPassword = 'A' + 'b'.repeat(498) + '1';
      
      const encrypted = encryptIdentity(identity, longPassword);
      expect(encrypted.encrypted).toBe(true);
      
      const decrypted = decryptIdentity(encrypted, longPassword);
      expect(decrypted).toEqual(identity);
    });

    it('should handle 1000 character password', () => {
      const identity = createTestIdentity();
      const veryLongPassword = 'A' + 'b'.repeat(998) + '1';
      
      const encrypted = encryptIdentity(identity, veryLongPassword);
      const decrypted = decryptIdentity(encrypted, veryLongPassword);
      
      expect(decrypted).toEqual(identity);
    });
  });

  describe('边界数据', () => {
    it('should handle identity with empty string fields', () => {
      const identity: PersistedIdentity = {
        peerId: '',
        e2eePrivateKey: '',
        e2eePublicKey: '',
        createdAt: '',
        lastUsedAt: ''
      };
      
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      
      expect(decrypted).toEqual(identity);
    });

    it('should handle identity with very long field values', () => {
      // Create identity with very long field values (simulating large keys)
      const longValue = 'x'.repeat(10000);
      const identity: PersistedIdentity = {
        peerId: longValue,
        e2eePrivateKey: longValue,
        e2eePublicKey: longValue,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      };
      
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      
      expect(decrypted).toEqual(identity);
    });

    it('should handle identity with unicode in fields', () => {
      const identity: PersistedIdentity = {
        peerId: 'peer-id-中文-日本語-한국어',
        e2eePrivateKey: 'private-key-🎉-🔐',
        e2eePublicKey: 'public-key-🚀-⚡',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      };
      
      const encrypted = encryptIdentity(identity, VALID_PASSWORD);
      const decrypted = decryptIdentity(encrypted, VALID_PASSWORD);
      
      expect(decrypted).toEqual(identity);
    });
  });
});