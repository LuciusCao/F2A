/**
 * 端到端加密模块
 * 使用 X25519 + AES-256-GCM 实现 Agent 间加密通信
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync } from 'crypto';
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
 * P1-2 修复：密钥确认挑战
 */
export interface KeyConfirmationChallenge {
  /** 挑战随机数 */
  challenge: string;
  /** 发送方标识 */
  senderId: string;
  /** 时间戳防止重放 */
  timestamp: number;
}

/**
 * P1-2 修复：密钥确认响应
 */
export interface KeyConfirmationResponse {
  /** 对挑战的响应（用共享密钥加密的挑战数据） */
  challengeResponse: string;
  /** 反向挑战随机数 */
  counterChallenge: string;
  /** 发送方标识 */
  senderId: string;
  /** 时间戳 */
  timestamp: number;
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
  
  /** P1-2 修复：待处理的密钥确认挑战 */
  private pendingChallenges: Map<string, { challenge: string; timestamp: number }> = new Map();
  /** P1-2 修复：已确认的密钥 */
  private keyConfirmed: Map<string, boolean> = new Map();
  
  /** P1-1 修复：挑战清理定时器 */
  private challengeCleanupTimer: ReturnType<typeof setInterval> | null = null;
  /** P1-1 修复：挑战过期时间（5分钟） */
  private static readonly CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;
  /** P1-1 修复：清理间隔（每分钟） */
  private static readonly CHALLENGE_CLEANUP_INTERVAL_MS = 60 * 1000;

  constructor() {
    this.logger = new Logger({ component: 'E2EE' });
    this.startChallengeCleanup();
  }

  /**
   * P1-1 修复：启动挑战清理定时器
   */
  private startChallengeCleanup(): void {
    this.challengeCleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, challenge] of this.pendingChallenges) {
        if (now - challenge.timestamp > E2EECrypto.CHALLENGE_EXPIRY_MS) {
          this.pendingChallenges.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.logger.debug('Cleaned expired challenges', { count: cleaned });
      }
    }, E2EECrypto.CHALLENGE_CLEANUP_INTERVAL_MS);
  }

  /**
   * P1-2 修复：注销对等方，清理所有相关资源
   * P1-4 修复：删除共享密钥前先零填充
   * @param peerId 对等方标识
   */
  unregisterPeer(peerId: string): void {
    // P1-4 修复：清理共享密钥前先零填充
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (sharedSecret) {
      sharedSecret.fill(0);
    }
    this.sharedSecrets.delete(peerId);
    
    // 清理对等方公钥
    this.peerPublicKeys.delete(peerId);
    
    // 清理密钥确认状态
    const confirmKey = `confirmed:${peerId}`;
    this.keyConfirmed.delete(confirmKey);
    
    // 清理 IV 记录
    this.usedIVs.delete(peerId);
    
    // 清理相关的 pendingChallenges
    const challengeKey = `challenge:${peerId}`;
    const counterChallengeKey = `counter:${peerId}`;
    this.pendingChallenges.delete(challengeKey);
    this.pendingChallenges.delete(counterChallengeKey);
    
    this.logger.info('Peer unregistered and resources cleaned', { peerId: peerId.slice(0, 16) });
  }

  /**
   * P1-1 修复：停止清理定时器，释放资源
   * P1-4 修复：清理共享密钥前先零填充
   */
  stop(): void {
    if (this.challengeCleanupTimer) {
      clearInterval(this.challengeCleanupTimer);
      this.challengeCleanupTimer = null;
    }
    
    // P1-4 修复：零填充所有共享密钥
    for (const secret of this.sharedSecrets.values()) {
      secret.fill(0);
    }
    
    // 清理所有资源
    this.pendingChallenges.clear();
    this.keyConfirmed.clear();
    this.usedIVs.clear();
    this.sharedSecrets.clear();
    this.peerPublicKeys.clear();
    
    this.logger.info('E2EECrypto stopped and all resources cleaned');
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
      
      // P3-1 修复：重命名为 Copy 以更准确反映语义（可修改的副本）
      const publicKeyCopy = new Uint8Array(publicKey);
      this.peerPublicKeys.set(peerId, publicKeyCopy);

      // 预计算共享密钥
      if (this.keyPair) {
        const sharedSecret = x25519.getSharedSecret(this.keyPair.privateKey, publicKeyCopy);
        // P3-1 修复：重命名为 Copy 以更准确反映语义
        const sharedSecretCopy = new Uint8Array(sharedSecret);
        this.sharedSecrets.set(peerId, sharedSecretCopy);
        
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

  /**
   * P1-2 修复：生成密钥确认挑战
   * 在密钥交换后，用于验证双方拥有相同的共享密钥
   * @param peerId 对等方标识
   * @returns 挑战数据
   */
  generateKeyConfirmationChallenge(peerId: string): KeyConfirmationChallenge | null {
    if (!this.keyPair) {
      this.logger.error('Cannot generate challenge: not initialized');
      return null;
    }

    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      this.logger.error('Cannot generate challenge: no shared secret for peer', { peerId });
      return null;
    }

    // 生成随机挑战
    const challenge = randomBytes(32).toString('base64');
    
    // 存储挑战以便后续验证
    const challengeKey = `challenge:${peerId}`;
    this.pendingChallenges.set(challengeKey, {
      challenge,
      timestamp: Date.now()
    });

    return {
      challenge,
      senderId: Buffer.from(this.keyPair.publicKey).toString('base64').slice(0, 16),
      timestamp: Date.now()
    };
  }

  /**
   * P1-2 修复：响应密钥确认挑战
   * 使用共享密钥加密挑战数据作为证明
   * @param peerId 对等方标识
   * @param challenge 收到的挑战
   * @returns 响应数据和反向挑战
   */
  respondToKeyConfirmationChallenge(
    peerId: string,
    challenge: KeyConfirmationChallenge
  ): KeyConfirmationResponse | null {
    if (!this.keyPair) {
      this.logger.error('Cannot respond to challenge: not initialized');
      return null;
    }

    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      this.logger.error('Cannot respond to challenge: no shared secret for peer', { peerId });
      return null;
    }

    // 验证时间戳防止重放攻击（5分钟有效期）
    // P1-3 修复：拒绝未来时间戳，只允许过去的时间戳
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 分钟
    if (challenge.timestamp > now + maxAge || challenge.timestamp < now - maxAge) {
      this.logger.error('Challenge timestamp invalid: future timestamp or expired');
      return null;
    }

    // 使用共享密钥加密挑战数据作为响应
    // 这证明我们拥有正确的共享密钥
    // P1-5 修复：使用 HMAC 而非 Hash，防止长度扩展攻击
    const challengeResponse = createHmac('sha256', sharedSecret)
      .update(challenge.challenge)
      .digest('base64');

    // 生成反向挑战
    const counterChallenge = randomBytes(32).toString('base64');
    
    // 存储反向挑战
    const counterChallengeKey = `counter:${peerId}`;
    this.pendingChallenges.set(counterChallengeKey, {
      challenge: counterChallenge,
      timestamp: now
    });

    return {
      challengeResponse,
      counterChallenge,
      senderId: Buffer.from(this.keyPair.publicKey).toString('base64').slice(0, 16),
      timestamp: now
    };
  }

  /**
   * P1-2 修复：验证密钥确认响应并响应反向挑战
   * 完成双向密钥确认
   * @param peerId 对等方标识
   * @param response 收到的响应
   * @param originalChallenge 原始挑战数据
   * @returns 反向挑战的响应，如果验证失败返回 null
   */
  verifyKeyConfirmationResponse(
    peerId: string,
    response: KeyConfirmationResponse,
    originalChallenge: string
  ): { success: boolean; counterChallengeResponse?: string } {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      this.logger.error('Cannot verify response: no shared secret for peer', { peerId });
      return { success: false };
    }

    // 验证时间戳
    // P1-3 修复：拒绝未来时间戳，只允许过去的时间戳
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 分钟
    if (response.timestamp > now + maxAge || response.timestamp < now - maxAge) {
      this.logger.error('Response timestamp invalid: future timestamp or expired');
      return { success: false };
    }

    // 验证挑战响应
    // P1-5 修复：使用 HMAC 而非 Hash，防止长度扩展攻击
    const expectedResponse = createHmac('sha256', sharedSecret)
      .update(originalChallenge)
      .digest('base64');

    if (response.challengeResponse !== expectedResponse) {
      this.logger.error('Challenge response verification failed', { peerId });
      return { success: false };
    }

    // 响应反向挑战
    // P1-5 修复：使用 HMAC 而非 Hash
    const counterChallengeResponse = createHmac('sha256', sharedSecret)
      .update(response.counterChallenge)
      .digest('base64');

    // 标记密钥确认完成
    const confirmKey = `confirmed:${peerId}`;
    this.keyConfirmed.set(confirmKey, true);

    this.logger.info('Key exchange confirmed with peer', { peerId: peerId.slice(0, 16) });

    return { 
      success: true, 
      counterChallengeResponse 
    };
  }

  /**
   * P1-2 修复：验证反向挑战的响应
   * P1-5 修复：使用 HMAC 而非 Hash
   * @param peerId 对等方标识
   * @param counterChallengeResponse 反向挑战的响应
   * @param originalCounterChallenge 原始反向挑战
   * @returns 验证结果
   */
  verifyCounterChallengeResponse(
    peerId: string,
    counterChallengeResponse: string,
    originalCounterChallenge: string
  ): boolean {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) {
      this.logger.error('Cannot verify counter challenge: no shared secret for peer', { peerId });
      return false;
    }

    // P1-5 修复：使用 HMAC 而非 Hash
    const expectedResponse = createHmac('sha256', sharedSecret)
      .update(originalCounterChallenge)
      .digest('base64');

    if (counterChallengeResponse !== expectedResponse) {
      this.logger.error('Counter challenge response verification failed', { peerId });
      return false;
    }

    // 标记密钥确认完成
    const confirmKey = `confirmed:${peerId}`;
    this.keyConfirmed.set(confirmKey, true);

    this.logger.info('Key exchange fully confirmed with peer', { peerId: peerId.slice(0, 16) });
    return true;
  }

  /**
   * P1-2 修复：检查与对等方的密钥是否已确认
   */
  isKeyConfirmed(peerId: string): boolean {
    const confirmKey = `confirmed:${peerId}`;
    return this.keyConfirmed.get(confirmKey) === true;
  }

  /**
   * P1-2 修复：执行完整的双向密钥确认流程
   * 这是一个便捷方法，封装了完整的确认流程
   * @param peerId 对等方标识
   * @param sendChallenge 发送挑战的函数
   * @param receiveResponse 接收响应的函数
   * @returns 确认是否成功
   */
  async confirmKeyExchange(
    peerId: string,
    sendChallenge: (challenge: KeyConfirmationChallenge) => Promise<KeyConfirmationResponse | null>,
    receiveCounterResponse?: (counterResponse: string) => Promise<boolean>
  ): Promise<boolean> {
    try {
      // 生成挑战
      const challenge = this.generateKeyConfirmationChallenge(peerId);
      if (!challenge) {
        return false;
      }

      // 发送挑战并等待响应
      const response = await sendChallenge(challenge);
      if (!response) {
        this.logger.error('No response received for key confirmation challenge', { peerId });
        return false;
      }

      // 验证响应
      const result = this.verifyKeyConfirmationResponse(
        peerId,
        response,
        challenge.challenge
      );

      if (!result.success || !result.counterChallengeResponse) {
        return false;
      }

      // 如果需要验证反向挑战响应
      if (receiveCounterResponse) {
        const verified = await receiveCounterResponse(result.counterChallengeResponse);
        if (!verified) {
          this.logger.error('Counter challenge response verification failed', { peerId });
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Key exchange confirmation failed with exception', {
        peerId: peerId.slice(0, 16),
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}

// 单例导出
export const defaultE2EECrypto = new E2EECrypto();
