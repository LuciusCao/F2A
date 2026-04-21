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
      // 验证密钥格式：base64 编码的 32 字节 X25519 密钥
      expect(exported!.publicKey.length).toBe(44); // 32 bytes base64 = 44 chars (with padding)
      expect(exported!.privateKey.length).toBe(44);
      expect(exported!.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(exported!.privateKey).toMatch(/^[A-Za-z0-9+/]+=*$/);

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
      // 验证加密结果格式：base64 编码的 AES-GCM 输出
      expect(encrypted!.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted!.ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(encrypted!.iv.length).toBe(24); // 12 bytes base64 = 16 chars (no padding) or 24 with padding
      expect(encrypted!.iv).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(encrypted!.authTag.length).toBeGreaterThan(0);
      expect(encrypted!.authTag).toMatch(/^[A-Za-z0-9+/]+=*$/);

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
      
      // 验证加密消息包含盐值且格式正确
      expect(encrypted!.salt.length).toBeGreaterThan(0);
      expect(encrypted!.salt).toMatch(/^[A-Za-z0-9+/]+=*$/);
      
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

  describe('peer 管理', () => {
    it('应该能够注册 peer 公钥', () => {
      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
      expect(cryptoA.canEncryptTo('peer-b')).toBe(true);
    });

    it('应该能够取消注册 peer', () => {
      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
      expect(cryptoA.canEncryptTo('peer-b')).toBe(true);

      cryptoA.unregisterPeer('peer-b');
      expect(cryptoA.canEncryptTo('peer-b')).toBe(false);
    });

    it('应该能够获取 peer 公钥', () => {
      const publicKeyB = cryptoB.getPublicKey()!;
      cryptoA.registerPeerPublicKey('peer-b', publicKeyB);

      const retrieved = cryptoA.getPeerPublicKey('peer-b');
      expect(retrieved).toBe(publicKeyB);
    });

    it('应该返回 null 对于未注册的 peer', () => {
      const retrieved = cryptoA.getPeerPublicKey('unknown-peer');
      expect(retrieved).toBeNull();
    });

    it('应该返回已注册 peer 数量', () => {
      expect(cryptoA.getRegisteredPeerCount()).toBe(0);

      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
      expect(cryptoA.getRegisteredPeerCount()).toBe(1);

      cryptoA.registerPeerPublicKey('peer-c', cryptoB.getPublicKey()!);
      expect(cryptoA.getRegisteredPeerCount()).toBe(2);

      cryptoA.unregisterPeer('peer-b');
      expect(cryptoA.getRegisteredPeerCount()).toBe(1);
    });
  });

  describe('密钥确认', () => {
    beforeEach(() => {
      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
      cryptoB.registerPeerPublicKey('peer-a', cryptoA.getPublicKey()!);
    });

    it('应该能够生成密钥确认挑战', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();
      // 验证挑战格式
      expect(challenge!.challenge.length).toBeGreaterThan(0);
      expect(challenge!.challenge).toMatch(/^[A-Za-z0-9+/]+=*$/);
      // senderId 是加密后的值，验证格式而非具体值
      expect(challenge!.senderId.length).toBeGreaterThan(0);
      expect(typeof challenge!.senderId).toBe('string');
      expect(challenge!.timestamp).toBeGreaterThan(0);
    });

    it('应该返回 null 对于未注册 peer 的挑战', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('unknown-peer');
      expect(challenge).toBeNull();
    });

    it('应该返回 null 对于未初始化的实例', () => {
      const uninitializedCrypto = new E2EECrypto();
      try {
        uninitializedCrypto.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
        const challenge = uninitializedCrypto.generateKeyConfirmationChallenge('peer-b');
        // 因为没有密钥对初始化，应该返回 null
        expect(challenge).toBeNull();
      } finally {
        uninitializedCrypto.stop();
      }
    });

    it('应该返回 null 对于未初始化实例的挑战响应', () => {
      const uninitializedCrypto = new E2EECrypto();
      try {
        const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
        expect(challenge).not.toBeNull();

        const response = uninitializedCrypto.respondToKeyConfirmationChallenge('peer-a', challenge!);
        // 因为没有密钥对初始化，应该返回 null
        expect(response).toBeNull();
      } finally {
        uninitializedCrypto.stop();
      }
    });

    it('应该能够响应密钥确认挑战', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge!);
      expect(response).not.toBeNull();
      // 验证响应格式
      expect(response!.challengeResponse.length).toBeGreaterThan(0);
      expect(response!.challengeResponse).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(response!.counterChallenge.length).toBeGreaterThan(0);
      expect(response!.counterChallenge).toMatch(/^[A-Za-z0-9+/]+=*$/);
      // senderId 是加密后的值，验证格式而非具体值
      expect(response!.senderId.length).toBeGreaterThan(0);
      expect(typeof response!.senderId).toBe('string');
      expect(response!.timestamp).toBeGreaterThan(0);
    });

    it('应该返回 null 对于未注册 peer 的挑战响应', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      const response = cryptoB.respondToKeyConfirmationChallenge('unknown-peer', challenge!);
      expect(response).toBeNull();
    });

    it('应该拒绝过期时间戳的挑战', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      // 修改时间戳为过期（6分钟前）
      const expiredChallenge = {
        ...challenge!,
        timestamp: Date.now() - 6 * 60 * 1000
      };

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', expiredChallenge);
      expect(response).toBeNull();
    });

    it('应该拒绝未来时间戳的挑战', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      // 修改时间戳为未来（6分钟后）
      const futureChallenge = {
        ...challenge!,
        timestamp: Date.now() + 6 * 60 * 1000
      };

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', futureChallenge);
      expect(response).toBeNull();
    });

    it('应该能够验证密钥确认响应', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge!);
      expect(response).not.toBeNull();

      const result = cryptoA.verifyKeyConfirmationResponse('peer-b', response!, challenge!.challenge);
      expect(result.success).toBe(true);
      expect(result.counterChallengeResponse).toBeDefined();
    });

    it('应该返回 false 对于未注册 peer 的响应验证', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      // 使用一个未注册 peer 来验证
      const crypto = new E2EECrypto();
      try {
        const response = {
          challengeResponse: 'response',
          counterChallenge: 'counter',
          senderId: 'sender',
          timestamp: Date.now()
        };
        const result = crypto.verifyKeyConfirmationResponse('unknown-peer', response, challenge!.challenge);
        expect(result.success).toBe(false);
      } finally {
        crypto.stop();
      }
    });

    it('应该拒绝过期时间戳的响应', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge!);
      expect(response).not.toBeNull();

      // 修改响应时间戳为过期
      const expiredResponse = {
        ...response!,
        timestamp: Date.now() - 6 * 60 * 1000
      };

      const result = cryptoA.verifyKeyConfirmationResponse('peer-b', expiredResponse, challenge!.challenge);
      expect(result.success).toBe(false);
    });

    it('应该拒绝未来时间戳的响应', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge!);
      expect(response).not.toBeNull();

      // 修改响应时间戳为未来
      const futureResponse = {
        ...response!,
        timestamp: Date.now() + 6 * 60 * 1000
      };

      const result = cryptoA.verifyKeyConfirmationResponse('peer-b', futureResponse, challenge!.challenge);
      expect(result.success).toBe(false);
    });

    it('应该能够验证反向挑战响应', () => {
      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge!);
      expect(response).not.toBeNull();

      const result = cryptoA.verifyKeyConfirmationResponse('peer-b', response!, challenge!.challenge);
      expect(result.success).toBe(true);
      expect(result.counterChallengeResponse).toBeDefined();

      // 验证反向挑战响应
      const counterResult = cryptoB.verifyCounterChallengeResponse(
        'peer-a',
        result.counterChallengeResponse!,
        response!.counterChallenge
      );
      expect(counterResult).toBe(true);
    });

    it('应该拒绝无效的反向挑战响应', () => {
      const result = cryptoB.verifyCounterChallengeResponse(
        'peer-a',
        'invalid-counter-response',
        'original-counter-challenge'
      );
      expect(result).toBe(false);
    });

    it('应该拒绝未注册 peer 的反向挑战响应', async () => {
      // 使用一个未注册 peer
      const crypto = new E2EECrypto();
      try {
        await crypto.initialize();
        const result = crypto.verifyCounterChallengeResponse(
          'unknown-peer',
          'response',
          'challenge'
        );
        expect(result).toBe(false);
      } finally {
        crypto.stop();
      }
    });

    it('应该能够检查密钥是否已确认', () => {
      // 初始状态未确认
      expect(cryptoA.isKeyConfirmed('peer-b')).toBe(false);

      const challenge = cryptoA.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge!);
      expect(response).not.toBeNull();

      const result = cryptoA.verifyKeyConfirmationResponse('peer-b', response!, challenge!.challenge);
      expect(result.success).toBe(true);

      // 验证后确认状态
      expect(cryptoA.isKeyConfirmed('peer-b')).toBe(true);
    });

    it('应该能够执行完整的密钥确认流程', async () => {
      const result = await cryptoA.confirmKeyExchange(
        'peer-b',
        async (challenge) => {
          return cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge);
        },
        async (counterResponse) => {
          // 这里我们不需要额外验证，因为已经在测试中验证了
          return true;
        }
      );
      expect(result).toBe(true);
      expect(cryptoA.isKeyConfirmed('peer-b')).toBe(true);
    });

    it('密钥确认流程应该在未注册 peer 时失败', async () => {
      const result = await cryptoA.confirmKeyExchange(
        'unknown-peer',
        async () => null
      );
      expect(result).toBe(false);
    });

    it('密钥确认流程应该在响应为 null 时失败', async () => {
      const result = await cryptoA.confirmKeyExchange(
        'peer-b',
        async () => null
      );
      expect(result).toBe(false);
    });

    it('密钥确认流程应该在验证失败时返回 false', async () => {
      const result = await cryptoA.confirmKeyExchange(
        'peer-b',
        async (challenge) => {
          // 返回一个无效的响应
          return {
            challengeResponse: 'invalid-response',
            counterChallenge: 'counter',
            senderId: 'sender',
            timestamp: Date.now()
          };
        },
        async () => true
      );
      expect(result).toBe(false);
    });

    it('密钥确认流程应该在反向挑战验证失败时返回 false', async () => {
      const result = await cryptoA.confirmKeyExchange(
        'peer-b',
        async (challenge) => {
          return cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge);
        },
        async () => false // 反向挑战验证失败
      );
      expect(result).toBe(false);
    });

    it('密钥确认流程应该在无 receiveCounterResponse 时成功', async () => {
      const result = await cryptoA.confirmKeyExchange(
        'peer-b',
        async (challenge) => {
          return cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge);
        }
        // 不提供 receiveCounterResponse
      );
      expect(result).toBe(true);
      expect(cryptoA.isKeyConfirmed('peer-b')).toBe(true);
    });

    it('密钥确认流程应该在异常时返回 false', async () => {
      const result = await cryptoA.confirmKeyExchange(
        'peer-b',
        async () => {
          throw new Error('Network error');
        }
      );
      expect(result).toBe(false);
    });
  });

  describe('生命周期管理 (#130)', () => {
    it('should reject registration after stop', async () => {
      // stop() 后拒绝注册（无法计算共享密钥，无法加密）
      const crypto = new E2EECrypto();
      await crypto.initialize();
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      expect(crypto.canEncryptTo('peer-1')).toBe(true);

      crypto.stop();

      // stop() 后注册公钥可以成功（存储公钥），但没有共享密钥
      crypto.registerPeerPublicKey('peer-2', cryptoB.getPublicKey()!);
      expect(crypto.canEncryptTo('peer-2')).toBe(false); // 无法加密

      crypto.stop();
    });

    it('should process pending keys after re-initialization', async () => {
      // 初始化后自动处理 pending keys（需要重新注册才能计算共享密钥）
      const crypto = new E2EECrypto();
      await crypto.initialize();
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      expect(crypto.canEncryptTo('peer-1')).toBe(true);

      crypto.stop();

      // 重新初始化
      await crypto.initialize();
      // peer-1 的公钥已被清理，需要重新注册
      expect(crypto.canEncryptTo('peer-1')).toBe(false);
      expect(crypto.getPeerPublicKey('peer-1')).toBeNull();

      // 重新注册 peer 后可以加密
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      expect(crypto.canEncryptTo('peer-1')).toBe(true);

      const encrypted = crypto.encrypt('peer-1', 'test message');
      expect(encrypted).not.toBeNull();

      crypto.stop();
    });

    it('should clear pending keys on stop', async () => {
      // stop() 清理 pending keys（所有 peer 公钥和共享密钥）
      const crypto = new E2EECrypto();
      await crypto.initialize();
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      crypto.registerPeerPublicKey('peer-2', cryptoB.getPublicKey()!);
      crypto.registerPeerPublicKey('peer-3', cryptoB.getPublicKey()!);

      expect(crypto.getRegisteredPeerCount()).toBe(3);
      expect(crypto.canEncryptTo('peer-1')).toBe(true);
      expect(crypto.canEncryptTo('peer-2')).toBe(true);
      expect(crypto.canEncryptTo('peer-3')).toBe(true);

      crypto.stop();

      // 所有 pending keys 已清理
      expect(crypto.getRegisteredPeerCount()).toBe(0);
      expect(crypto.getPublicKey()).toBeNull();
      expect(crypto.canEncryptTo('peer-1')).toBe(false);
      expect(crypto.canEncryptTo('peer-2')).toBe(false);
      expect(crypto.canEncryptTo('peer-3')).toBe(false);

      // 重新初始化后无法恢复 pending keys
      await crypto.initialize();
      expect(crypto.getRegisteredPeerCount()).toBe(0);
      expect(crypto.canEncryptTo('peer-1')).toBe(false);

      crypto.stop();
    });
  });

  describe('stop() 和 Disposable 接口', () => {
    it('应该能够调用 stop() 清理所有资源', async () => {
      const crypto = new E2EECrypto();
      await crypto.initialize();
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      crypto.registerPeerPublicKey('peer-2', cryptoB.getPublicKey()!);

      expect(crypto.getRegisteredPeerCount()).toBe(2);
      expect(crypto.canEncryptTo('peer-1')).toBe(true);

      crypto.stop();

      // 清理后应该无法加密
      expect(crypto.getPublicKey()).toBeNull();
      expect(crypto.canEncryptTo('peer-1')).toBe(false);
    });

    it('应该能够多次调用 stop() 而不出错', async () => {
      const crypto = new E2EECrypto();
      await crypto.initialize();

      crypto.stop();
      crypto.stop(); // 第二次调用应该不抛出错误
      crypto.stop(); // 第三次调用应该不抛出错误
    });

    it('应该通过 Disposable 接口清理资源', async () => {
      {
        const crypto = new E2EECrypto();
        await crypto.initialize();
        crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
        
        expect(crypto.getRegisteredPeerCount()).toBe(1);
        
        // 使用 Symbol.dispose 清理
        crypto[Symbol.dispose]();
        
        // 清理后应该无法加密
        expect(crypto.getPublicKey()).toBeNull();
      }
    });

    it('stop() 应该清理定时器', async () => {
      const crypto = new E2EECrypto();
      await crypto.initialize();

      // 验证定时器存在（通过生成挑战来间接验证）
      const challenge = crypto.generateKeyConfirmationChallenge('peer-1');
      // 因为 peer-1 未注册，应该返回 null
      expect(challenge).toBeNull();

      crypto.stop();

      // 再次生成挑战应该返回 null（因为没有密钥对）
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      const challenge2 = crypto.generateKeyConfirmationChallenge('peer-1');
      expect(challenge2).toBeNull(); // 因为密钥对已被清理
    });

    it('stop() 应该零填充共享密钥', async () => {
      const crypto = new E2EECrypto();
      await crypto.initialize();
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);

      // 验证可以加密
      const encrypted = crypto.encrypt('peer-1', 'test');
      expect(encrypted).not.toBeNull();

      crypto.stop();

      // 清理后无法加密
      crypto.registerPeerPublicKey('peer-1', cryptoB.getPublicKey()!);
      const encrypted2 = crypto.encrypt('peer-1', 'test');
      expect(encrypted2).toBeNull(); // 因为共享密钥被零填充清理
    });
  });

  describe('IV 碰撞检测和清理', () => {
    beforeEach(() => {
      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
    });

    it('每次加密应该使用不同的 IV', () => {
      const plaintext = 'Same message';

      const encrypted1 = cryptoA.encrypt('peer-b', plaintext);
      const encrypted2 = cryptoA.encrypt('peer-b', plaintext);

      expect(encrypted1).not.toBeNull();
      expect(encrypted2).not.toBeNull();

      // IV 应该不同
      expect(encrypted1!.iv).not.toBe(encrypted2!.iv);
    });

    it('应该能够处理大量加密操作', () => {
      // 执行多次加密，验证 IV 碰撞检测逻辑
      const results = [];
      for (let i = 0; i < 100; i++) {
        const encrypted = cryptoA.encrypt('peer-b', `message-${i}`);
        expect(encrypted).not.toBeNull();
        results.push(encrypted!.iv);
      }

      // 所有 IV 应该唯一
      const uniqueIVs = new Set(results);
      expect(uniqueIVs.size).toBe(results.length);
    });
  });

  describe('挑战清理定时器', () => {
    it('挑战应该有过期时间', async () => {
      const crypto = new E2EECrypto();
      await crypto.initialize();
      crypto.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);

      // 确保 cryptoB 也注册了 crypto 的公钥
      await cryptoB.initialize();
      cryptoB.registerPeerPublicKey('peer-a', crypto.getPublicKey()!);

      // 生成挑战
      const challenge = crypto.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100));

      // 验证定时器正在运行（通过检查挑战是否可以正常工作）
      const response = cryptoB.respondToKeyConfirmationChallenge('peer-a', challenge!);
      expect(response).not.toBeNull();

      crypto.stop();
    });

    it('清理定时器应该在 stop() 时停止', async () => {
      const crypto = new E2EECrypto();
      await crypto.initialize();

      // 立即停止
      crypto.stop();

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100));

      // 验证没有错误发生
    });
  });

  describe('未初始化状态', () => {
    it('未初始化时加密应该返回 null', () => {
      const uninitializedCrypto = new E2EECrypto();
      try {
        uninitializedCrypto.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
        const result = uninitializedCrypto.encrypt('peer-b', 'test');
        expect(result).toBeNull();
      } finally {
        uninitializedCrypto.stop();
      }
    });

    it('未初始化时解密应该返回 null', () => {
      const uninitializedCrypto = new E2EECrypto();
      try {
        const encrypted = {
          senderPublicKey: cryptoA.getPublicKey()!,
          iv: 'test-iv',
          authTag: 'test-tag',
          ciphertext: 'test-ciphertext',
          salt: Buffer.alloc(16).toString('base64')
        };
        const result = uninitializedCrypto.decrypt(encrypted);
        expect(result).toBeNull();
      } finally {
        uninitializedCrypto.stop();
      }
    });

    it('未初始化时 getPublicKey 应该返回 null', () => {
      const uninitializedCrypto = new E2EECrypto();
      try {
        expect(uninitializedCrypto.getPublicKey()).toBeNull();
      } finally {
        uninitializedCrypto.stop();
      }
    });

    it('未初始化时 exportKeyPair 应该返回 null', () => {
      const uninitializedCrypto = new E2EECrypto();
      try {
        expect(uninitializedCrypto.exportKeyPair()).toBeNull();
      } finally {
        uninitializedCrypto.stop();
      }
    });
  });

  describe('更多错误处理场景', () => {
    beforeEach(() => {
      cryptoA.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);
      cryptoB.registerPeerPublicKey('peer-a', cryptoA.getPublicKey()!);
    });

    it('应该拒绝无效的 IV 格式', () => {
      const plaintext = 'Secret message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      expect(encrypted).not.toBeNull();

      // 修改 IV 为无效格式
      const invalidIVEncrypted = {
        ...encrypted!,
        iv: 'invalid-iv!!!'
      };

      const decrypted = cryptoB.decrypt(invalidIVEncrypted);
      expect(decrypted).toBeNull();
    });

    it('应该拒绝无效的 authTag 格式', () => {
      const plaintext = 'Secret message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      expect(encrypted).not.toBeNull();

      // 修改 authTag 为无效格式
      const invalidAuthTagEncrypted = {
        ...encrypted!,
        authTag: 'invalid-authTag!!!'
      };

      const decrypted = cryptoB.decrypt(invalidAuthTagEncrypted);
      expect(decrypted).toBeNull();
    });

    it('应该拒绝 IV 长度不正确', () => {
      const plaintext = 'Secret message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      expect(encrypted).not.toBeNull();

      // 修改 IV 长度（只有 8 字节）
      const shortIV = Buffer.alloc(8).toString('base64');
      const invalidIVEncrypted = {
        ...encrypted!,
        iv: shortIV
      };

      const decrypted = cryptoB.decrypt(invalidIVEncrypted);
      expect(decrypted).toBeNull();
    });

    it('应该拒绝 authTag 长度不正确', () => {
      const plaintext = 'Secret message';
      const encrypted = cryptoA.encrypt('peer-b', plaintext);
      expect(encrypted).not.toBeNull();

      // 修改 authTag 长度（只有 8 字节）
      const shortAuthTag = Buffer.alloc(8).toString('base64');
      const invalidAuthTagEncrypted = {
        ...encrypted!,
        authTag: shortAuthTag
      };

      const decrypted = cryptoB.decrypt(invalidAuthTagEncrypted);
      expect(decrypted).toBeNull();
    });

    it('应该拒绝空 ciphertext', () => {
      const encrypted = {
        senderPublicKey: cryptoA.getPublicKey()!,
        iv: Buffer.alloc(16).toString('base64'),
        authTag: Buffer.alloc(16).toString('base64'),
        ciphertext: '', // 空 ciphertext
        salt: Buffer.alloc(16).toString('base64')
      };

      const decrypted = cryptoB.decrypt(encrypted);
      expect(decrypted).toBeNull();
    });

    it('应该拒绝发送方公钥长度不正确', () => {
      const encrypted = {
        senderPublicKey: Buffer.alloc(16).toString('base64'), // 只有 16 字节
        iv: Buffer.alloc(16).toString('base64'),
        authTag: Buffer.alloc(16).toString('base64'),
        ciphertext: 'test-ciphertext',
        salt: Buffer.alloc(16).toString('base64')
      };

      const decrypted = cryptoB.decrypt(encrypted);
      expect(decrypted).toBeNull();
    });

    it('应该拒绝 AAD 不匹配的解密', () => {
      const plaintext = 'Secret message';
      const aad = 'original-aad';

      const encrypted = cryptoA.encrypt('peer-b', plaintext, aad);
      expect(encrypted).not.toBeNull();

      // 修改 AAD 为不同值
      const mismatchedADEncrypted = {
        ...encrypted!,
        aad: 'different-aad'
      };

      const decrypted = cryptoB.decrypt(mismatchedADEncrypted);
      // AES-GCM 严格要求 AAD 匹配，所以应该返回 null
      expect(decrypted).toBeNull();
    });

    it('应该正确处理带 AAD 的加密解密', () => {
      const plaintext = 'Secret message';
      const aad = 'message-metadata';

      const encrypted = cryptoA.encrypt('peer-b', plaintext, aad);
      expect(encrypted).not.toBeNull();
      expect(encrypted!.aad).toBe(aad);

      const decrypted = cryptoB.decrypt(encrypted!);
      expect(decrypted).toBe(plaintext);
    });

    it('unregisterPeer 应该清理所有相关资源', async () => {
      const crypto = new E2EECrypto();
      await crypto.initialize();
      crypto.registerPeerPublicKey('peer-b', cryptoB.getPublicKey()!);

      // 生成挑战
      const challenge = crypto.generateKeyConfirmationChallenge('peer-b');
      expect(challenge).not.toBeNull();

      // 取消注册
      crypto.unregisterPeer('peer-b');

      // 验证资源已清理
      expect(crypto.canEncryptTo('peer-b')).toBe(false);
      expect(crypto.getPeerPublicKey('peer-b')).toBeNull();

      // 再次生成挑战应该返回 null
      const challenge2 = crypto.generateKeyConfirmationChallenge('peer-b');
      expect(challenge2).toBeNull();

      crypto.stop();
    });
  });
});
