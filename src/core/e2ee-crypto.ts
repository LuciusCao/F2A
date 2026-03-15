/**
 * 端到端加密模块
 * 使用 X25519 + AES-256-GCM 实现 Agent 间加密通信
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes, createCipheriv, createDecipheriv, createHash, hkdfSync } from 'crypto';
import { Logger } from '../utils/logger.js';

// AES-256-GCM 参数
const AES_KEY_SIZE = 32; // 256 bits
const AES_IV_SIZE = 16;  // 128 bits
const AES_TAG_SIZE = 16; // 128 bits

// P2-7 修复：使用常量 SALT_SIZE 并保持一致
const SALT_SIZE = 16; // 128 bits

/**
 * 加密密钥对
 */
export interface EncryptionKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * 加密后的消息
 */
export interface EncryptedMessage {
  /** 发送方公钥 (用于接收方识别身份) */
  senderPublicKey: string;
  /**  nonce/IV */
  iv: string;
  /** 认证标签 */
  authTag: string;
  /** 加密后的密文 */
  ciphertext: string;
  /** 可选的附加认证数据 */
  aad?: string;
  /** 密钥派生使用的随机盐值（每次加密随机生成） */
  salt: string;
}

/**
 * 密钥管理器
 */
export class E2EECrypto {
  private keyPair: EncryptionKeyPair | null = null;
  private peerPublicKeys: Map<string, Uint8Array> = new Map();
  private sharedSecrets: Map<string, Uint8Array> = new Map();
  private logger: Logger;
  
  /** P2-10 修复：IV 使用记录，用于检测 IV 重用 */
  private usedIVs: Map<string, Set<string>> = new Map();
  /** P2-10 修复：IV 重用警告阈值 */
  private static readonly IV_REUSE_WARN_THRESHOLD = 1000;

  constructor() {
    this.logger = new Logger({ component: 'E2EE' });
  }

  /**
   * 初始化密钥对
   */
  async initialize(): Promise<void> {
    // 生成 X25519 密钥对用于加密
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);

    this.keyPair = { publicKey, privateKey };
  }

  /**
   * 从已有密钥初始化
   * P1-2: 添加输入验证
   */
  initializeWithKeyPair(privateKey: Uint8Array, publicKey: Uint8Array): void {
    // 验证私钥长度 (X25519 私钥应为 32 字节)
    if (privateKey.length !== 32) {
      throw new Error(`Invalid private key length: expected 32 bytes, got ${privateKey.length}`);
    }
    
    // 验证公钥长度 (X25519 公钥应为 32 字节)
    if (publicKey.length !== 32) {
      throw new Error(`Invalid public key length: expected 32 bytes, got ${publicKey.length}`);
    }
    
    // 验证公私钥配对
    try {
      const derivedPublicKey = x25519.getPublicKey(privateKey);
      const publicKeyMatch = Buffer.from(derivedPublicKey).equals(Buffer.from(publicKey));
      if (!publicKeyMatch) {
        throw new Error('Public key does not match the private key. The key pair is invalid.');
      }
    } catch (error) {
      // 如果派生失败，可能是无效的私钥
      throw new Error(`Invalid key pair: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    this.keyPair = { privateKey, publicKey };
    this.logger.info('Key pair initialized successfully', {
      publicKeyPrefix: Buffer.from(publicKey).toString('hex').slice(0, 16)
    });
  }

  /**
   * 获取公钥 (用于广播)
   */
  getPublicKey(): string | null {
    if (!this.keyPair) return null;
    return Buffer.from(this.keyPair.publicKey).toString('base64');
  }

  /**
   * 注册对等方的公钥
   * P2-3 修复：使用 Uint8Array.slice() 创建不可变副本
   */
  registerPeerPublicKey(peerId: string, publicKeyBase64: string): void {
    try {
      const publicKey = Buffer.from(publicKeyBase64, 'base64');
      
      // P2-3 修复：创建不可变副本（Object.freeze 不能冻结 Buffer）
      // 使用 slice() 创建新数组，然后冻结
      const frozenPublicKey = new Uint8Array(publicKey);
      Object.freeze(frozenPublicKey.buffer);
      this.peerPublicKeys.set(peerId, frozenPublicKey);

      // 预计算共享密钥
      if (this.keyPair) {
        const sharedSecret = x25519.getSharedSecret(this.keyPair.privateKey, frozenPublicKey);
        // P2-3 修复：创建不可变副本
        const frozenSharedSecret = new Uint8Array(sharedSecret);
        Object.freeze(frozenSharedSecret.buffer);
        this.sharedSecrets.set(peerId, frozenSharedSecret);
        
        // P2-10 修复：初始化 IV 记录集
        if (!this.usedIVs.has(peerId)) {
          this.usedIVs.set(peerId, new Set());
        }
      }
    } catch (error) {
      this.logger.error('Failed to register public key', { peerId, error });
    }
  }

  /**
   * 检查是否可以对等方加密通信
   */
  canEncryptTo(peerId: string): boolean {
    return this.sharedSecrets.has(peerId);
  }

  /**
   * 加密消息
   */
  encrypt(peerId: string, plaintext: string, aad?: string): EncryptedMessage | null {
    if (!this.keyPair) {
      this.logger.error('Not initialized');
      return null;
    }

    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      this.logger.error('No shared secret for peer', { peerId });
      return null;
    }

    try {
      // P2-7 修复：使用常量 SALT_SIZE
      const salt = randomBytes(SALT_SIZE);
      
      // 从共享密钥派生 AES 密钥
      const aesKey = this.deriveAESKey(sharedSecret, salt);

      // 生成随机 IV
      const iv = randomBytes(AES_IV_SIZE);
      
      // P2-10 修复：检查 IV 唯一性，防止 IV 重用攻击
      const ivBase64 = iv.toString('base64');
      const ivSet = this.usedIVs.get(peerId);
      
      if (ivSet) {
        // 检测 IV 重用（极低概率事件，但安全起见）
        if (ivSet.has(ivBase64)) {
          this.logger.warn('IV collision detected, regenerating', { peerId: peerId.slice(0, 16) });
          // 生成新的 IV（碰撞概率约 2^-128，几乎不可能）
          const newIv = randomBytes(AES_IV_SIZE);
          ivSet.add(newIv.toString('base64'));
          
          // 创建加密器
          const cipher = createCipheriv('aes-256-gcm', aesKey, newIv);

          // 添加 AAD (如果有)
          if (aad) {
            cipher.setAAD(Buffer.from(aad, 'utf-8'));
          }

          // 加密
          let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
          ciphertext += cipher.final('base64');

          // 获取认证标签
          const authTag = cipher.getAuthTag();

          return {
            senderPublicKey: this.getPublicKey()!,
            iv: newIv.toString('base64'),
            authTag: authTag.toString('base64'),
            ciphertext,
            aad,
            salt: salt.toString('base64')
          };
        }
        
        ivSet.add(ivBase64);
        
        // P2-10 修复：清理过期的 IV 记录，防止内存泄漏
        if (ivSet.size > E2EECrypto.IV_REUSE_WARN_THRESHOLD) {
          this.logger.warn('IV usage count exceeded threshold, clearing old records', {
            peerId: peerId.slice(0, 16),
            count: ivSet.size
          });
          // 保留最近的一半记录
          const entries = Array.from(ivSet);
          ivSet.clear();
          entries.slice(-Math.floor(E2EECrypto.IV_REUSE_WARN_THRESHOLD / 2)).forEach(e => ivSet.add(e));
        }
      }

      // 创建加密器
      const cipher = createCipheriv('aes-256-gcm', aesKey, iv);

      // 添加 AAD (如果有)
      if (aad) {
        cipher.setAAD(Buffer.from(aad, 'utf-8'));
      }

      // 加密
      let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
      ciphertext += cipher.final('base64');

      // 获取认证标签
      const authTag = cipher.getAuthTag();

      return {
        senderPublicKey: this.getPublicKey()!,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext,
        aad,
        salt: salt.toString('base64')
      };
    } catch (error) {
      this.logger.error('Encryption failed', { error });
      return null;
    }
  }

  /**
   * 解密消息
   */
  decrypt(encrypted: EncryptedMessage): string | null {
    if (!this.keyPair) {
      this.logger.error('Not initialized');
      return null;
    }

    try {
      // 使用发送方公钥计算共享密钥
      const senderPublicKey = Buffer.from(encrypted.senderPublicKey, 'base64');
      const sharedSecret = x25519.getSharedSecret(this.keyPair.privateKey, senderPublicKey);
      
      // P2 修复：强制要求盐值，不使用硬编码默认值
      if (!encrypted.salt) {
        this.logger.error('Decryption failed: missing salt value. Salt is required for security.');
        return null;
      }
      
      const salt = Buffer.from(encrypted.salt, 'base64');
      
      // P2-7 修复：使用常量 SALT_SIZE 验证盐值长度
      if (salt.length < SALT_SIZE) {
        this.logger.error('Decryption failed: salt value too short. Minimum 16 bytes required.');
        return null;
      }
      
      const aesKey = this.deriveAESKey(sharedSecret, salt);

      // 解码参数
      const iv = Buffer.from(encrypted.iv, 'base64');
      const authTag = Buffer.from(encrypted.authTag, 'base64');

      // 创建解密器
      const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
      decipher.setAuthTag(authTag);

      // 添加 AAD (如果有)
      if (encrypted.aad) {
        decipher.setAAD(Buffer.from(encrypted.aad, 'utf-8'));
      }

      // 解密
      let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf-8');
      plaintext += decipher.final('utf-8');

      return plaintext;
    } catch (error) {
      // 增强错误处理：区分不同类型的解密失败
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorType = errorMessage.includes('authTag') || errorMessage.includes('authentication')
        ? 'AUTH_FAILED'
        : errorMessage.includes('invalid') || errorMessage.includes('corrupt')
          ? 'INVALID_FORMAT'
          : 'DECRYPTION_ERROR';
      
      this.logger.error('Decryption failed', {
        errorType,
        errorMessage,
        hasKey: !!this.keyPair,
        hasSalt: !!encrypted.salt,
        ciphertextLength: encrypted.ciphertext?.length || 0
      });
      
      // 安全提示：认证失败可能表示消息被篡改
      if (errorType === 'AUTH_FAILED') {
        this.logger.warn('Possible message tampering detected: authentication tag verification failed');
      }
      
      return null;
    }
  }

  /**
   * 从共享密钥派生 AES 密钥
   * 使用 HKDF (HMAC-based Key Derivation Function) 进行安全密钥派生
   * @param sharedSecret 共享密钥
   * @param salt 随机盐值（每次加密使用不同的盐值，提高安全性）
   */
  private deriveAESKey(sharedSecret: Uint8Array, salt: Buffer): Buffer {
    // HKDF 参数
    const info = Buffer.from('AES-256-GCM-KEY', 'utf-8');    // 密钥用途标识
    
    // 使用 HKDF-SHA256 进行密钥派生
    // hkdfSync(digest, ikm, salt, info, keylen)
    const derivedKey = hkdfSync('sha256', sharedSecret, salt, info, AES_KEY_SIZE);
    
    return Buffer.from(derivedKey);
  }

  /**
   * 获取已注册的对等方公钥
   */
  getPeerPublicKey(peerId: string): string | null {
    const publicKey = this.peerPublicKeys.get(peerId);
    return publicKey ? Buffer.from(publicKey).toString('base64') : null;
  }

  /**
   * 序列化密钥对用于存储
   */
  exportKeyPair(): { publicKey: string; privateKey: string } | null {
    if (!this.keyPair) return null;
    return {
      publicKey: Buffer.from(this.keyPair.publicKey).toString('base64'),
      privateKey: Buffer.from(this.keyPair.privateKey).toString('base64')
    };
  }

  /**
   * 获取已注册的对等方数量
   */
  getRegisteredPeerCount(): number {
    return this.peerPublicKeys.size;
  }
}

// 单例导出
export const defaultE2EECrypto = new E2EECrypto();
