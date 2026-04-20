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
 * P1-2 修复：Nonce 记录，用于重放防护
 */
interface NonceRecord {
  timestamp: number;
}

/**
 * 请求签名验证器
 * P2-1 修复：实现 Disposable 接口，防止资源泄漏
 */
export class RequestSigner implements Disposable {
  private secretKey: string;
  private timestampTolerance: number;
  private logger: Logger;
  /** P1-2 修复：已使用的 nonce 缓存，防止重放攻击 */
  private usedNonces: Map<string, NonceRecord> = new Map();
  /** P1-2 修复：nonce 清理定时器 */
  private nonceCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SignatureConfig) {
    this.secretKey = config.secretKey;
    this.timestampTolerance = config.timestampTolerance || 5 * 60 * 1000; // 5 分钟
    this.logger = new Logger({ component: 'RequestSigner' });
    // P1-2 修复：启动 nonce 清理定时器
    this.startNonceCleanup();
  }

  /**
   * P1-2 修复：启动 nonce 清理定时器
   */
  private startNonceCleanup(): void {
    // 每分钟清理一次过期的 nonce
    this.nonceCleanupTimer = setInterval(() => {
      const now = Date.now();
      const expiryTime = this.timestampTolerance * 2; // 保留两倍容忍时间
      let cleaned = 0;
      for (const [nonce, record] of this.usedNonces) {
        if (now - record.timestamp > expiryTime) {
          this.usedNonces.delete(nonce);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        this.logger.debug('Cleaned expired nonces', { count: cleaned });
      }
    }, 60 * 1000);
  }

  /**
   * P1-2 修复：停止清理定时器，释放资源
   * P3-1 修复：重命名为 dispose() 以符合 Disposable 接口
   */
  dispose(): void {
    if (this.nonceCleanupTimer) {
      clearInterval(this.nonceCleanupTimer);
      this.nonceCleanupTimer = null;
    }
    this.usedNonces.clear();
  }

  /**
   * P3-1 修复：实现 Disposable 接口
   */
  [Symbol.dispose](): void {
    this.dispose();
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
    const now = Date.now();
    
    // P1-1 修复：单独拒绝未来时间戳
    // 未来时间戳可能是时钟不同步或恶意攻击
    if (message.timestamp > now + this.timestampTolerance) {
      this.logger.warn('Signature timestamp is in the future', {
        timestamp: message.timestamp,
        now,
        diff: message.timestamp - now
      });
      return { valid: false, error: 'Timestamp is in the future' };
    }
    
    // 检查时间戳是否过期
    if (message.timestamp < now - this.timestampTolerance) {
      this.logger.warn('Signature timestamp expired', {
        timestamp: message.timestamp,
        diff: now - message.timestamp
      });
      return { valid: false, error: 'Timestamp expired' };
    }

    // P1-2 修复：检查 nonce 是否已被使用（重放防护）
    if (this.usedNonces.has(message.nonce)) {
      this.logger.warn('Nonce already used, possible replay attack', {
        nonce: message.nonce.slice(0, 16)
      });
      return { valid: false, error: 'Nonce already used' };
    }

    // 验证签名
    const expectedSignature = this.generateSignature(
      message.payload,
      message.timestamp,
      message.nonce
    );

    if (!this.constantTimeCompare(message.signature, expectedSignature)) {
      this.logger.warn('Invalid signature');
      return { valid: false, error: 'Invalid signature' };
    }

    // P1-2 修复：记录已使用的 nonce
    this.usedNonces.set(message.nonce, { timestamp: now });

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
 * 
 * P1.5 修复：生产环境强制要求签名密钥，否则抛出错误
 */
export function loadSignatureConfig(): SignatureConfig | null {
  const secretKey = process.env.F2A_SIGNATURE_KEY;
  const isProduction = process.env.NODE_ENV === 'production';
  const logger = new Logger({ component: 'SignatureConfig' });
  
  if (!secretKey) {
    if (isProduction) {
      // P1.5 修复：生产环境强制要求签名密钥，抛出错误
      // 签名验证在生产环境是必需的安全措施
      const errorMessage = 
        'F2A_SIGNATURE_KEY is required in production environment. ' +
        'Set the environment variable to enable secure message verification. ' +
        'Example: export F2A_SIGNATURE_KEY=$(openssl rand -hex 32)';
      
      logger.error(errorMessage);
      throw new Error(errorMessage);
    } else {
      // 开发环境仅提示
      logger.warn('F2A_SIGNATURE_KEY is not set. Signature verification is disabled.');
      logger.warn('Set this environment variable for secure message verification.');
      logger.warn('Example: export F2A_SIGNATURE_KEY=$(openssl rand -hex 32)');
    }
    return null;
  }

  // 验证密钥强度
  if (secretKey.length < 32) {
    logger.warn('F2A_SIGNATURE_KEY is too short. Recommended minimum length is 32 characters.');
  }

  const tolerance = process.env.F2A_SIGNATURE_TOLERANCE
    ? parseInt(process.env.F2A_SIGNATURE_TOLERANCE, 10)
    : undefined;

  // P2-3 修复：parseInt NaN 检查
  if (tolerance !== undefined && isNaN(tolerance)) {
    logger.warn('F2A_SIGNATURE_TOLERANCE is not a valid number, using default 300000ms');
  }
  const actualTolerance = (tolerance !== undefined && !isNaN(tolerance)) ? tolerance : 300000;

  logger.info('Signature verification enabled', { 
    timestampTolerance: actualTolerance // 默认 5 分钟
  });

  return {
    secretKey,
    timestampTolerance: actualTolerance
  };
}

/**
 * 检查签名功能是否可用
 * 在生产环境，如果签名密钥未设置，应考虑禁用需要签名的功能
 */
export function isSignatureAvailable(): boolean {
  return !!process.env.F2A_SIGNATURE_KEY;
}

/**
 * 生产环境签名检查装饰器
 * 如果签名功能不可用且处于生产环境，抛出错误
 */
export function requireSignatureInProduction(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.F2A_SIGNATURE_KEY) {
    throw new Error(
      'Signature verification is required in production but F2A_SIGNATURE_KEY is not set. ' +
      'Please set F2A_SIGNATURE_KEY environment variable.'
    );
  }
}

/**
 * P2-9 修复：安全的签名配置加载
 * 不抛出异常，而是返回结果对象，让调用方决定如何处理
 */
export function loadSignatureConfigSafe(): { 
  success: boolean; 
  config?: SignatureConfig; 
  error?: string;
  warning?: string;
  isProduction: boolean;
} {
  const secretKey = process.env.F2A_SIGNATURE_KEY;
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!secretKey) {
    const errorMessage = 
      'F2A_SIGNATURE_KEY is not set. ' +
      (isProduction 
        ? 'This is required in production environment.' 
        : 'Signature verification is disabled in development.');
    
    return {
      success: false,
      error: errorMessage,
      isProduction
    };
  }

  // P2-1 修复：使用数组累积警告，避免覆盖
  const warnings: string[] = [];

  // 验证密钥强度
  if (secretKey.length < 32) {
    warnings.push('F2A_SIGNATURE_KEY is too short. Recommended minimum length is 32 characters.');
  }

  const tolerance = process.env.F2A_SIGNATURE_TOLERANCE
    ? parseInt(process.env.F2A_SIGNATURE_TOLERANCE, 10)
    : undefined;

  // P2-3 修复：parseInt NaN 检查
  let actualTolerance = 300000; // 默认 5 分钟
  if (tolerance !== undefined) {
    if (isNaN(tolerance)) {
      warnings.push('F2A_SIGNATURE_TOLERANCE is not a valid number, using default 300000ms.');
    } else {
      actualTolerance = tolerance;
    }
  }

  return {
    success: true,
    config: {
      secretKey,
      timestampTolerance: actualTolerance
    },
    isProduction,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined
  };
}
