/**
 * Challenge-Response 认证协议 - RFC008 实现
 *
 * 提供 Challenge-Response 认证机制：
 * - Challenge 生成（256-bit 随机数据，30秒有效期）
 * - Challenge 签名
 * - 签名响应验证
 * - 防重放攻击管理
 *
 * 参考: RFC008 Agent Self-Identity (239-296行)
 */

import { randomBytes } from 'crypto';
import { AgentIdentityKeypair } from './agent-keypair.js';
import { computeFingerprint, validateAgentId } from './agent-id.js';
import { Logger } from '../../utils/logger.js';

const logger = new Logger({ component: 'ChallengeResponse' });

/**
 * Challenge 结构
 *
 * 按照 RFC008 规范：
 * - challenge: 256-bit 随机数据 (Base64)
 * - timestamp: ISO 8601 时间戳
 * - expiresInSeconds: 有效期（默认30秒）
 * - operation: 操作类型
 */
export interface Challenge {
  /** 256-bit 随机数据 (Base64 编码) */
  challenge: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 有效期（秒），默认30秒 */
  expiresInSeconds: number;
  /** 操作类型: "send_message", "update_webhook" 等 */
  operation: string;
}

/**
 * ChallengeResponse 结构
 *
 * 按照 RFC008 规范：
 * - signature: Ed25519签名 (Base64)
 * - publicKey: Agent 的 Ed25519 公钥 (Base64)
 */
export interface ChallengeResponse {
  /** Ed25519 签名 (Base64 编码) */
  signature: string;
  /** Agent 的 Ed25519 公钥 (Base64 编码) */
  publicKey: string;
}

/**
 * Challenge 验证结果
 */
export interface ChallengeVerificationResult {
  /** 验证是否成功 */
  valid: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** 错误代码 */
  errorCode?: 'EXPIRED' | 'INVALID_SIGNATURE' | 'FINGERPRINT_MISMATCH' | 'REPLAY_ATTACK' | 'INVALID_CHALLENGE';
}

/**
 * 存储的 Challenge 记录
 */
interface StoredChallenge {
  /** Challenge 数据 */
  challenge: Challenge;
  /** 创建时间戳 */
  createdAt: number;
  /** 是否已使用（防重放） */
  used: boolean;
}

/**
 * 生成随机 Challenge
 *
 * 生成 256-bit (32字节) 随机数据作为 Challenge
 *
 * @param operation 操作类型
 * @param expiresInSeconds 有效期（秒），默认30秒
 * @returns Challenge 对象
 */
export function generateChallenge(
  operation: string,
  expiresInSeconds: number = 30
): Challenge {
  // 生成 32 字节 (256-bit) 随机数据
  const challengeBytes = randomBytes(32);
  const challengeBase64 = challengeBytes.toString('base64');

  const challenge: Challenge = {
    challenge: challengeBase64,
    timestamp: new Date().toISOString(),
    expiresInSeconds,
    operation
  };

  logger.debug('Generated challenge', {
    operation,
    expiresInSeconds,
    challengePreview: challengeBase64.substring(0, 16) + '...'
  });

  return challenge;
}

/**
 * 签名 Challenge
 *
 * 使用 Agent 的私钥对 Challenge 进行签名
 * 签名数据格式: `${challenge}:${timestamp}:${operation}`
 *
 * @param challenge Challenge 对象
 * @param privateKey 私钥（Base64 编码）
 * @returns ChallengeResponse 对象
 */
export function signChallenge(
  challenge: Challenge,
  privateKey: string
): ChallengeResponse {
  // 构建签名数据
  const challengeData = `${challenge.challenge}:${challenge.timestamp}:${challenge.operation}`;

  // 从私钥派生公钥
  const keypair = new AgentIdentityKeypair();
  const publicKey = keypair.derivePublicKey(privateKey);

  // 使用 Ed25519 签名
  const signature = AgentIdentityKeypair.sign(challengeData, privateKey);

  logger.debug('Signed challenge', {
    operation: challenge.operation,
    publicKeyPreview: publicKey.substring(0, 16) + '...'
  });

  return {
    signature,
    publicKey
  };
}

/**
 * 验证 ChallengeResponse
 *
 * 按照 RFC008 规范验证签名响应：
 * 1. 检查 Challenge 是否过期
 * 2. 验证 AgentId 与公钥指纹匹配
 * 3. 验证 Ed25519 签名有效
 *
 * @param agentId Agent ID (格式: agent:{fingerprint})
 * @param challenge Challenge 对象
 * @param response ChallengeResponse 对象
 * @returns 验证结果
 */
export function verifyChallengeResponse(
  agentId: string,
  challenge: Challenge,
  response: ChallengeResponse
): ChallengeVerificationResult {
  // 1. 验证 Challenge 格式
  if (!challenge.challenge || !challenge.timestamp || !challenge.operation) {
    logger.warn('Invalid challenge format');
    return {
      valid: false,
      error: 'Invalid challenge format',
      errorCode: 'INVALID_CHALLENGE'
    };
  }

  // 2. 验证 Challenge 未过期
  const now = Date.now();
  const challengeTime = new Date(challenge.timestamp).getTime();

  if (isNaN(challengeTime)) {
    logger.warn('Invalid challenge timestamp', { timestamp: challenge.timestamp });
    return {
      valid: false,
      error: 'Invalid challenge timestamp',
      errorCode: 'INVALID_CHALLENGE'
    };
  }

  const elapsedSeconds = (now - challengeTime) / 1000;
  if (elapsedSeconds > challenge.expiresInSeconds) {
    logger.warn('Challenge expired', {
      elapsedSeconds,
      expiresInSeconds: challenge.expiresInSeconds
    });
    return {
      valid: false,
      error: `Challenge expired: ${elapsedSeconds.toFixed(1)}s elapsed, max ${challenge.expiresInSeconds}s`,
      errorCode: 'EXPIRED'
    };
  }

  // 3. 验证 AgentId 与公钥指纹匹配
  const fingerprintValidation = validateAgentId(agentId, response.publicKey);
  if (!fingerprintValidation.valid) {
    logger.warn('AgentId fingerprint mismatch', {
      agentId,
      error: fingerprintValidation.error
    });
    return {
      valid: false,
      error: `AgentId fingerprint mismatch: ${fingerprintValidation.error}`,
      errorCode: 'FINGERPRINT_MISMATCH'
    };
  }

  // 4. 验证 Ed25519 签名
  const challengeData = `${challenge.challenge}:${challenge.timestamp}:${challenge.operation}`;
  const isValidSignature = AgentIdentityKeypair.verify(
    response.signature,
    challengeData,
    response.publicKey
  );

  if (!isValidSignature) {
    logger.warn('Invalid signature', {
      agentId,
      operation: challenge.operation
    });
    return {
      valid: false,
      error: 'Invalid Ed25519 signature',
      errorCode: 'INVALID_SIGNATURE'
    };
  }

  logger.debug('Challenge response verified successfully', {
    agentId,
    operation: challenge.operation
  });

  return { valid: true };
}

/**
 * ChallengeStore - 防重放攻击管理
 *
 * 存储已生成的 Challenge，防止重放攻击：
 * - 跟踪已使用的 Challenge
 * - 自动清理过期 Challenge
 */
export class ChallengeStore {
  private challenges: Map<string, StoredChallenge> = new Map();
  private logger: Logger;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.logger = new Logger({ component: 'ChallengeStore' });
  }

  /**
   * 存储 Challenge
   *
   * @param challenge Challenge 对象
   * @returns Challenge ID（用于后续验证）
   */
  store(challenge: Challenge): string {
    const challengeId = this.computeChallengeId(challenge);
    const stored: StoredChallenge = {
      challenge,
      createdAt: Date.now(),
      used: false
    };

    this.challenges.set(challengeId, stored);
    this.logger.debug('Stored challenge', {
      challengeId: challengeId.substring(0, 16) + '...',
      operation: challenge.operation
    });

    return challengeId;
  }

  /**
   * 验证并标记 Challenge 为已使用
   *
   * 检查 Challenge 是否有效且未被使用，如果是则标记为已使用
   *
   * @param challenge Challenge 对象
   * @returns 是否可以使用（true = 有效且未使用，false = 无效或已使用）
   */
  verifyAndConsume(challenge: Challenge): boolean {
    const challengeId = this.computeChallengeId(challenge);
    const stored = this.challenges.get(challengeId);

    if (!stored) {
      this.logger.warn('Challenge not found in store', {
        challengeId: challengeId.substring(0, 16) + '...'
      });
      return false;
    }

    // 检查是否已使用
    if (stored.used) {
      this.logger.warn('Challenge already used (replay attack detected)', {
        challengeId: challengeId.substring(0, 16) + '...'
      });
      return false;
    }

    // 检查是否过期
    const now = Date.now();
    const elapsedSeconds = (now - stored.createdAt) / 1000;
    if (elapsedSeconds > stored.challenge.expiresInSeconds) {
      this.logger.debug('Challenge expired', {
        challengeId: challengeId.substring(0, 16) + '...',
        elapsedSeconds
      });
      // 清理过期 Challenge
      this.challenges.delete(challengeId);
      return false;
    }

    // 标记为已使用
    stored.used = true;
    this.logger.debug('Challenge consumed', {
      challengeId: challengeId.substring(0, 16) + '...'
    });

    return true;
  }

  /**
   * 检查 Challenge 是否已使用
   *
   * @param challenge Challenge 对象
   * @returns 是否已使用
   */
  isUsed(challenge: Challenge): boolean {
    const challengeId = this.computeChallengeId(challenge);
    const stored = this.challenges.get(challengeId);
    return stored?.used ?? false;
  }

  /**
   * 检查 Challenge 是否存在
   *
   * @param challenge Challenge 对象
   * @returns 是否存在
   */
  has(challenge: Challenge): boolean {
    const challengeId = this.computeChallengeId(challenge);
    return this.challenges.has(challengeId);
  }

  /**
   * 清理过期 Challenge
   *
   * 移除所有已过期的 Challenge
   *
   * @returns 清理的数量
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    // 收集需要删除的 keys
    const keysToDelete: string[] = [];
    this.challenges.forEach((stored, id) => {
      const elapsedSeconds = (now - stored.createdAt) / 1000;
      if (elapsedSeconds > stored.challenge.expiresInSeconds) {
        keysToDelete.push(id);
      }
    });

    // 删除过期 Challenge
    keysToDelete.forEach(id => {
      this.challenges.delete(id);
      cleaned++;
    });

    if (cleaned > 0) {
      this.logger.debug('Cleaned up expired challenges', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * 启动自动清理定时器
   *
   * 定期清理过期的 Challenge
   *
   * @param intervalMs 清理间隔（毫秒），默认60秒
   */
  startAutoCleanup(intervalMs: number = 60000): void {
    if (this.cleanupInterval) {
      this.stopAutoCleanup();
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, intervalMs);

    this.logger.info('Started auto cleanup', { intervalMs });
  }

  /**
   * 停止自动清理定时器
   */
  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.info('Stopped auto cleanup');
    }
  }

  /**
   * 获取存储的 Challenge 数量
   *
   * @returns Challenge 数量
   */
  size(): number {
    return this.challenges.size;
  }

  /**
   * 清空所有 Challenge
   */
  clear(): void {
    this.challenges.clear();
    this.logger.debug('Cleared all challenges');
  }

  /**
   * 计算 Challenge ID
   *
   * 使用 Challenge 数据的哈希作为 ID
   */
  private computeChallengeId(challenge: Challenge): string {
    // 使用 challenge 字段本身作为 ID（因为它是唯一的随机数据）
    return challenge.challenge;
  }
}

/**
 * 使用 ChallengeStore 进行完整验证
 *
 * 组合 ChallengeStore 和 verifyChallengeResponse：
 * 1. 检查 Challenge 是否存在且未使用
 * 2. 验证签名
 * 3. 标记 Challenge 为已使用
 *
 * @param store ChallengeStore 实例
 * @param agentId Agent ID
 * @param challenge Challenge 对象
 * @param response ChallengeResponse 对象
 * @returns 验证结果
 */
export function verifyChallengeResponseWithStore(
  store: ChallengeStore,
  agentId: string,
  challenge: Challenge,
  response: ChallengeResponse
): ChallengeVerificationResult {
  // 检查 Challenge 是否存在且未使用
  if (!store.has(challenge)) {
    return {
      valid: false,
      error: 'Challenge not found or expired',
      errorCode: 'REPLAY_ATTACK'
    };
  }

  if (store.isUsed(challenge)) {
    return {
      valid: false,
      error: 'Challenge already used (replay attack)',
      errorCode: 'REPLAY_ATTACK'
    };
  }

  // 验证签名响应
  const result = verifyChallengeResponse(agentId, challenge, response);

  if (result.valid) {
    // 验证成功，标记为已使用
    store.verifyAndConsume(challenge);
  }

  return result;
}