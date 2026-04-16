/**
 * Ed25519Signer - RFC 003 Ed25519 签名实现
 *
 * 使用 Ed25519 非对称签名替代 HMAC-SHA256，支持首次连接验证。
 *
 * 优势：
 * - 公钥公开，无需共享密钥
 * - 支持首次连接验证
 * - 更符合标准签名用途
 *
 * 使用 @noble/curves/ed25519 实现
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { Logger } from '../../utils/logger.js';

/**
 * Ed25519 密钥对
 */
export interface Ed25519KeyPair {
  /** 私钥（32字节，Base64编码） */
  privateKey: string;
  /** 公钥（32字节，Base64编码） */
  publicKey: string;
}

/**
 * Ed25519Signer - Ed25519 签名器
 *
 * 用于 AgentId 签名和验证，支持无共享密钥验证
 */
export class Ed25519Signer {
  private privateKey: Uint8Array | null = null;
  private publicKey: Uint8Array | null = null;
  private logger: Logger;

  /**
   * 创建 Ed25519 签名器
   *
   * @param privateKey Base64编码的私钥（可选），不提供则生成新密钥对
   */
  constructor(privateKey?: string) {
    this.logger = new Logger({ component: 'Ed25519Signer' });

    if (privateKey) {
      // 从 Base64 加载私钥
      this.privateKey = Buffer.from(privateKey, 'base64');
      // 从私钥派生公钥（Ed25519 特性：公钥可从私钥派生）
      this.publicKey = ed25519.getPublicKey(this.privateKey);
      this.logger.debug('Loaded existing Ed25519 key pair');
    } else {
      // 生成新密钥对
      this.privateKey = ed25519.utils.randomSecretKey();
      this.publicKey = ed25519.getPublicKey(this.privateKey);
      this.logger.info('Generated new Ed25519 key pair');
    }
  }

  /**
   * 仅使用公钥创建验证器（不包含私钥）
   *
   * @param publicKey Base64编码的公钥
   * @returns 仅用于验证的 Ed25519Signer
   */
  static fromPublicKey(publicKey: string): Ed25519Signer {
    const signer = new Ed25519Signer();
    signer.publicKey = Buffer.from(publicKey, 'base64');
    signer.privateKey = null; // 无私钥，仅用于验证
    signer.logger.debug('Created Ed25519 verifier from public key only');
    return signer;
  }

  /**
   * 签名数据（异步版本）
   *
   * @param data 要签名的数据字符串
   * @returns Base64编码的签名（64字节）
   */
  async sign(data: string): Promise<string> {
    return this.signSync(data);
  }

  /**
   * 签名数据（同步版本）
   *
   * 用于需要同步签名的场景（如 AgentId 签发）
   *
   * @param data 要签名的数据字符串
   * @returns Base64编码的签名（64字节）
   */
  signSync(data: string): string {
    if (!this.privateKey) {
      throw new Error('No private key available for signing');
    }

    // 将字符串转换为字节
    const dataBytes = Buffer.from(data, 'utf-8');

    // Ed25519 签名（@noble/curves 的 sign 是同步的）
    const signature = ed25519.sign(dataBytes, this.privateKey);

    // 返回 Base64 编码的签名
    return Buffer.from(signature).toString('base64');
  }

  /**
   * 验证签名
   *
   * @param data 原始数据字符串
   * @param signature Base64编码的签名
   * @returns 验证是否成功
   */
  async verify(data: string, signature: string): Promise<boolean> {
    if (!this.publicKey) {
      this.logger.error('No public key available for verification');
      return false;
    }

    try {
      // 将字符串转换为字节
      const dataBytes = Buffer.from(data, 'utf-8');

      // 将签名从 Base64 解码
      const signatureBytes = Buffer.from(signature, 'base64');

      // Ed25519 验证
      const isValid = ed25519.verify(signatureBytes, dataBytes, this.publicKey);

      if (isValid) {
        this.logger.debug('Signature verified successfully');
      } else {
        this.logger.warn('Signature verification failed');
      }

      return isValid;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Signature verification error', { error: errorMessage });
      return false;
    }
  }

  /**
   * 使用指定公钥验证签名（无需私钥）
   *
   * @param data 原始数据字符串
   * @param signature Base64编码的签名
   * @param publicKey Base64编码的公钥
   * @returns 验证是否成功
   */
  static async verifyWithPublicKey(
    data: string,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    try {
      // 将字符串转换为字节
      const dataBytes = Buffer.from(data, 'utf-8');

      // 将签名和公钥从 Base64 解码
      const signatureBytes = Buffer.from(signature, 'base64');
      const publicKeyBytes = Buffer.from(publicKey, 'base64');

      // Ed25519 验证
      const isValid = ed25519.verify(signatureBytes, dataBytes, publicKeyBytes);

      return isValid;
    } catch (error) {
      const logger = new Logger({ component: 'Ed25519Signer' });
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Static signature verification error', { error: errorMessage });
      return false;
    }
  }

  /**
   * 获取公钥（Base64编码）
   *
   * @returns Base64编码的公钥（32字节）
   */
  getPublicKey(): string {
    if (!this.publicKey) {
      throw new Error('No public key available');
    }
    return Buffer.from(this.publicKey).toString('base64');
  }

  /**
   * 获取私钥（Base64编码）- 敏感操作
   *
   * WARNING: 返回敏感的私钥材料，请谨慎使用
   *
   * @returns Base64编码的私钥（32字节）
   */
  getPrivateKey(): string {
    if (!this.privateKey) {
      throw new Error('No private key available');
    }
    return Buffer.from(this.privateKey).toString('base64');
  }

  /**
   * 导出密钥对（包含私钥）- 敏感操作
   *
   * WARNING: 返回敏感的私钥材料，请谨慎使用
   *
   * @returns Ed25519 密钥对
   */
  exportKeyPair(): Ed25519KeyPair {
    if (!this.privateKey || !this.publicKey) {
      throw new Error('Key pair not available');
    }

    return {
      privateKey: this.getPrivateKey(),
      publicKey: this.getPublicKey()
    };
  }

  /**
   * 检查是否有私钥（可以签名）
   */
  canSign(): boolean {
    return this.privateKey !== null;
  }

  /**
   * 检查是否有公钥（可以验证）
   */
  canVerify(): boolean {
    return this.publicKey !== null;
  }

  /**
   * 生成新的 Ed25519 密钥对
   *
   * @returns Ed25519 密钥对
   */
  static generateKeyPair(): Ed25519KeyPair {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);

    return {
      privateKey: Buffer.from(privateKey).toString('base64'),
      publicKey: Buffer.from(publicKey).toString('base64')
    };
  }
}