import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { E2EECrypto } from './e2ee-crypto.js';
import { x25519 } from '@noble/curves/ed25519.js';

describe('E2EECrypto', () => {
  let cryptoA: E2EECrypto;
  let cryptoB: E2EECrypto;

  beforeEach(async () => {
    cryptoA = new E2EECrypto();
    cryptoB = new E2EECrypto();
    await cryptoA.initialize();
    await cryptoB.initialize();
  });

  // R2-2 修复：清理资源，防止定时器泄漏
  afterEach(() => {
    if (cryptoA) {
      cryptoA.stop();
    }
    if (cryptoB) {
      cryptoB.stop();
    }
  });

  describe('initialization', () => {
    it('should generate key pair on initialize', async () => {
      const publicKey = cryptoA.getPublicKey();
      expect(publicKey).not.toBeNull();
      expect(typeof publicKey).toBe('string');
      expect(publicKey!.length).toBeGreaterThan(0);
    });

    it('should generate different keys for different instances', async () => {
      const keyA = cryptoA.getPublicKey();
      const keyB = cryptoB.getPublicKey();
      expect(keyA).not.toBe(keyB);
    });

    it('should export and import key pair', () => {
      const exported = cryptoA.exportKeyPair();
      expect(exported).not.toBeNull();
      expect(exported!.publicKey).toBeDefined();
      expect(exported!.privateKey).toBeDefined();

      // Create new instance and import
      const cryptoC = new E2EECrypto();
      try {
        const privateKey = Buffer.from(exported!.privateKey, 'base64');
        const publicKey = Buffer.from(exported!.publicKey, 'base64');
        cryptoC.initializeWithKeyPair(privateKey, publicKey);
        
        expect(cryptoC.getPublicKey()).toBe(exported!.publicKey);
      } finally {
        cryptoC.stop();
      }
    });

    describe('initializeWithKeyPair validation (P1-2)', () => {
      it('should throw error for invalid private key length', () => {
        const crypto = new E2EECrypto();
        try {
          const invalidPrivateKey = new Uint8Array(16); // 只16字节，应该是32字节
          const publicKey = new Uint8Array(32);
          
          expect(() => {
            crypto.initializeWithKeyPair(invalidPrivateKey, publicKey);
          }).toThrow('Invalid private key length: expected 32 bytes, got 16');
        } finally {
          crypto.stop();
        }
      });

      it('should throw error for invalid public key length', () => {
        const crypto = new E2EECrypto();
        try {
          const privateKey = new Uint8Array(32);
          const invalidPublicKey = new Uint8Array(16); // 只16字节，应该是32字节
          
          expect(() => {
            crypto.initializeWithKeyPair(privateKey, invalidPublicKey);
          }).toThrow('Invalid public key length: expected 32 bytes, got 16');
        } finally {
          crypto.stop();
        }
      });

      it('should throw error when public key does not match private key', () => {
        const crypto = new E2EECrypto();
        try {
          // 生成一个有效的密钥对
          const validPrivate = x25519.utils.randomSecretKey();
          const validPublic = x25519.getPublicKey(validPrivate);
          
          // 使用另一个随机公钥
          const otherPrivate = x25519.utils.randomSecretKey();
          const otherPublic = x25519.getPublicKey(otherPrivate);
          
          expect(() => {
            crypto.initializeWithKeyPair(validPrivate, otherPublic);
          }).toThrow('Public key does not match the private key');
        } finally {
          crypto.stop();
        }
      });

      it('should accept valid key pair', () => {
        const crypto = new E2EECrypto();
        try {
          // 生成有效的密钥对
          const privateKey = x25519.utils.randomSecretKey();
          const publicKey = x25519.getPublicKey(privateKey);
          
          // 应该不抛出异常
          expect(() => {
            crypto.initializeWithKeyPair(privateKey, publicKey);
          }).not.toThrow();
          
          expect(crypto.getPublicKey()).toBe(Buffer.from(publicKey).toString('base64'));
        } finally {
          crypto.stop();
        }
      });
    });
  });

  describe('peer key registration', () => {
    it('should register peer public key', () => {
      const keyB = cryptoB.getPublicKey()!;
      cryptoA.registerPeerPublicKey('peer-b', keyB);
      expect(cryptoA.canEncryptTo('peer-b')).toBe(true);
    });

    it('should track registered peer count', () => {
      expect(cryptoA.getRegisteredPeerCount()).toBe(0);
      cryptoA.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      expect(cryptoA.getRegisteredPeerCount()).toBe(1);
    });
  });

  describe('encryption/decryption', () => {
    beforeEach(() => {
      // Exchange public keys
      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
      cryptoB.registerPeerPublicKey('peer-a', cryptoA.getPublicKey()!);
    });

    it('should encrypt and decrypt message', () => {
      const plaintext = 'Hello, secure world!';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      
      expect(encrypted).not.toBeNull();
      expect(encrypted!.ciphertext).toBeDefined();
      expect(encrypted!.iv).toBeDefined();
      expect(encrypted!.authTag).toBeDefined();

      const decrypted = cryptoB.decrypt(encrypted!);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt with AAD', () => {
      const plaintext = 'Secret message';
      const aad = 'message-metadata';
      
      const encrypted = cryptoA.encrypt('peer-b', plaintext, aad);
      expect(encrypted).not.toBeNull();
      expect(encrypted!.aad).toBe(aad);

      const decrypted = cryptoB.decrypt(encrypted!);
      expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt tampered ciphertext', () => {
      const plaintext = 'Original message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      
      // Tamper with ciphertext
      encrypted!.ciphertext = encrypted!.ciphertext.slice(0, -4) + 'xxxx';
      
      const decrypted = cryptoB.decrypt(encrypted!);
      expect(decrypted).toBeNull(); // Should fail
    });

    it('should return null when encrypting to unknown peer', async () => {
      const cryptoC = new E2EECrypto();
      try {
        await cryptoC.initialize();
        // Don't register any peer keys
        
        const result = cryptoC.encrypt('unknown-peer', 'test');
        expect(result).toBeNull();
      } finally {
        cryptoC.stop();
      }
    });
  });

  describe('error handling', () => {
    it('should return null when decrypting malformed message', () => {
      const malformed = {
        senderPublicKey: 'invalid-base64!!!',
        iv: Buffer.from('invalid').toString('base64'),
        authTag: Buffer.from('short').toString('base64'),
        ciphertext: 'garbage'
      };

      const decrypted = cryptoA.decrypt(malformed as any);
      expect(decrypted).toBeNull();
    });
  });

  describe('盐值验证 (P2 安全修复)', () => {
    beforeEach(() => {
      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
      cryptoB.registerPeerPublicKey('peer-a', cryptoA.getPublicKey()!);
    });

    it('应该拒绝没有盐值的加密消息', () => {
      const plaintext = 'Secret message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      expect(encrypted).not.toBeNull();
      
      // 删除盐值
      const encryptedWithoutSalt = { ...encrypted!, salt: undefined as any };
      
      const decrypted = cryptoB.decrypt(encryptedWithoutSalt);
      expect(decrypted).toBeNull();
    });

    it('应该拒绝盐值过短的加密消息', () => {
      const plaintext = 'Secret message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      expect(encrypted).not.toBeNull();
      
      // 使用过短的盐值（只有 8 字节）
      const shortSalt = Buffer.alloc(8).toString('base64');
      const encryptedWithShortSalt = { ...encrypted!, salt: shortSalt };
      
      const decrypted = cryptoB.decrypt(encryptedWithShortSalt);
      expect(decrypted).toBeNull();
    });

    it('应该接受有效的盐值（16 字节）', () => {
      const plaintext = 'Secret message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      expect(encrypted).not.toBeNull();
      
      // 验证加密消息包含盐值
      expect(encrypted!.salt).toBeDefined();
      
      // 验证盐值长度（base64 编码的 16 字节）
      const saltBuffer = Buffer.from(encrypted!.salt, 'base64');
      expect(saltBuffer.length).toBeGreaterThanOrEqual(16);
      
      // 正常解密应该成功
      const decrypted = cryptoB.decrypt(encrypted!);
      expect(decrypted).toBe(plaintext);
    });

    it('每次加密应该使用不同的盐值', () => {
      const plaintext = 'Same message';
      
      const encrypted1 = cryptoA.encrypt('peer-b', plaintext);
      const encrypted2 = cryptoA.encrypt('peer-b', plaintext);
      
      expect(encrypted1).not.toBeNull();
      expect(encrypted2).not.toBeNull();
      
      // 两次加密的盐值应该不同
      expect(encrypted1!.salt).not.toBe(encrypted2!.salt);
      
      // 但密文也应该不同（因为盐值影响密钥派生）
      expect(encrypted1!.ciphertext).not.toBe(encrypted2!.ciphertext);
    });
  });
});
