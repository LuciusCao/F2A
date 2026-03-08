import { describe, it, expect, beforeEach } from 'vitest';
import { E2EECrypto } from './e2ee-crypto.js';

describe('E2EECrypto', () => {
  let cryptoA: E2EECrypto;
  let cryptoB: E2EECrypto;

  beforeEach(async () => {
    cryptoA = new E2EECrypto();
    cryptoB = new E2EECrypto();
    await cryptoA.initialize();
    await cryptoB.initialize();
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
      const privateKey = Buffer.from(exported!.privateKey, 'base64');
      const publicKey = Buffer.from(exported!.publicKey, 'base64');
      cryptoC.initializeWithKeyPair(privateKey, publicKey);
      
      expect(cryptoC.getPublicKey()).toBe(exported!.publicKey);
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
      await cryptoC.initialize();
      // Don't register any peer keys
      
      const result = cryptoC.encrypt('unknown-peer', 'test');
      expect(result).toBeNull();
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
});
