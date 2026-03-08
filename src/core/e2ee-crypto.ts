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
   */
  initializeWithKeyPair(privateKey: Uint8Array, publicKey: Uint8Array): void {
    this.keyPair = { privateKey, publicKey };
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
   */
  registerPeerPublicKey(peerId: string, publicKeyBase64: string): void {
    try {
      const publicKey = Buffer.from(publicKeyBase64, 'base64');
      this.peerPublicKeys.set(peerId, publicKey);

      // 预计算共享密钥
      if (this.keyPair) {
        const sharedSecret = x25519.getSharedSecret(this.keyPair.privateKey, publicKey);
        this.sharedSecrets.set(peerId, sharedSecret);
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
      // 生成随机盐值（每次加密使用不同的盐值，提高安全性）
      const salt = randomBytes(16);
      
      // 从共享密钥派生 AES 密钥
      const aesKey = this.deriveAESKey(sharedSecret, salt);

      // 生成随机 IV
      const iv = randomBytes(AES_IV_SIZE);

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
      
      // 使用消息中的盐值派生 AES 密钥（与加密方使用相同的盐值）
      const salt = encrypted.salt ? Buffer.from(encrypted.salt, 'base64') : Buffer.from('F2A-E2EE-SALT-2024', 'utf-8');
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
      this.logger.error('Decryption failed', { error });
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
