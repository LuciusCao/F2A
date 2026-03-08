/**
 * 请求签名验证工具
 * 使用 HMAC-SHA256 验证消息来源真实性
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Logger } from './logger.js';

export interface SignatureConfig {
  /** 签名密钥 */
  secretKey: string;
  /** 时间戳容忍度（毫秒，默认 5 分钟） */
  timestampTolerance?: number;
}

export interface SignedMessage {
  /** 消息体 */
  payload: string;
  /** 时间戳 */
  timestamp: number;
  /** 签名 */
  signature: string;
  /** 随机 nonce */
  nonce: string;
}

/**
 * 请求签名验证器
 */
export class RequestSigner {
  private secretKey: string;
  private timestampTolerance: number;
  private logger: Logger;

  constructor(config: SignatureConfig) {
    this.secretKey = config.secretKey;
    this.timestampTolerance = config.timestampTolerance || 5 * 60 * 1000; // 5 分钟
    this.logger = new Logger({ component: 'RequestSigner' });
  }

  /**
   * 生成签名
   * @param payload - 消息体（JSON 字符串）
   * @returns 签名后的消息
   */
  sign(payload: string): SignedMessage {
    const timestamp = Date.now();
    const nonce = randomBytes(16).toString('hex');
    const signature = this.generateSignature(payload, timestamp, nonce);

    return {
      payload,
      timestamp,
      signature,
      nonce
    };
  }

  /**
   * 验证签名
   * @param message - 签名后的消息
   * @returns 验证结果
   */
  verify(message: SignedMessage): { valid: boolean; error?: string } {
    // 1. 检查时间戳
    const now = Date.now();
    const timeDiff = Math.abs(now - message.timestamp);
    if (timeDiff > this.timestampTolerance) {
      this.logger.warn('Signature timestamp expired', {
        timestamp: message.timestamp,
        diff: timeDiff
      });
      return { valid: false, error: 'Timestamp expired' };
    }

    // 2. 验证签名
    const expectedSignature = this.generateSignature(
      message.payload,
      message.timestamp,
      message.nonce
    );

    if (!this.constantTimeCompare(message.signature, expectedSignature)) {
      this.logger.warn('Invalid signature');
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true };
  }

  /**
   * 生成 HMAC-SHA256 签名
   */
  private generateSignature(payload: string, timestamp: number, nonce: string): string {
    const data = `${payload}:${timestamp}:${nonce}`;
    return createHmac('sha256', this.secretKey).update(data).digest('hex');
  }

  /**
   * 常量时间比较（防止时序攻击）
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return timingSafeEqual(bufA, bufB);
  }
}

/**
 * 从环境变量加载签名密钥
 */
export function loadSignatureConfig(): SignatureConfig | null {
  const secretKey = process.env.F2A_SIGNATURE_KEY;
  if (!secretKey) {
    // 生产环境强制警告，开发环境仅提示
    const isProduction = process.env.NODE_ENV === 'production';
    const logger = new Logger({ component: 'SignatureConfig' });
    
    if (isProduction) {
      logger.error('F2A_SIGNATURE_KEY is not set! Signature verification is DISABLED. This is a security risk in production.');
    } else {
      logger.warn('F2A_SIGNATURE_KEY is not set. Signature verification is disabled. Set this environment variable for secure message verification.');
    }
    return null;
  }

  const tolerance = process.env.F2A_SIGNATURE_TOLERANCE
    ? parseInt(process.env.F2A_SIGNATURE_TOLERANCE, 10)
    : undefined;

  return {
    secretKey,
    timestampTolerance: tolerance
  };
}
