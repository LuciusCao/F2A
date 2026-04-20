/**
 * AgentId 格式与验证 - RFC008 实现
 *
 * 支持两种 AgentId 格式：
 * - 旧格式 (RFC003): agent:<PeerId前16位>:<随机8位>
 *   示例: agent:12D3KooWHxWdnxJa:abc12345
 *   PeerId 前缀使用 base58btc 字符集，随机后缀使用十六进制
 *
 * - 新格式 (RFC008): agent:<公钥指纹16位>
 *   示例: agent:a3b2c1d4e5f67890
 *   公钥指纹使用十六进制
 *
 * 公钥指纹计算: SHA256(publicKey).slice(0, 16).toHex()
 */

import { createHash } from 'crypto';
import { Logger } from '../../utils/logger.js';

/**
 * AgentId 解析结果
 */
export interface ParsedAgentId {
  /** AgentId 格式 */
  format: 'old' | 'new';
  /** 格式是否有效 */
  valid: boolean;
  /** 新格式：公钥指纹 */
  fingerprint?: string;
  /** 旧格式：PeerId 前缀 */
  peerIdPrefix?: string;
  /** 旧格式：随机后缀 */
  randomSuffix?: string;
  /** 错误信息（如果无效） */
  error?: string;
}

/**
 * AgentId 验证结果
 */
export interface AgentIdValidationResult {
  /** 验证是否成功 */
  valid: boolean;
  /** 错误信息（如果失败） */
  error?: string;
  /** AgentId 格式 */
  format?: 'old' | 'new';
  /** 解析出的指纹（新格式） */
  fingerprint?: string;
  /** 解析出的 PeerId 前缀（旧格式） */
  peerIdPrefix?: string;
}

const logger = new Logger({ component: 'AgentId' });

// Base58btc 字符集（排除 0, O, I, l）
const BASE58BTC_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

/**
 * 计算公钥指纹
 *
 * 公钥指纹 = SHA256(publicKey).slice(0, 16).toHex()
 *
 * @param publicKey 公钥（Uint8Array 或 Base64 字符串）
 * @returns 16 位十六进制指纹字符串
 */
export function computeFingerprint(publicKey: Uint8Array | string): string {
  let keyBytes: Uint8Array;

  if (typeof publicKey === 'string') {
    // 假设是 Base64 编码的公钥
    keyBytes = Buffer.from(publicKey, 'base64');
  } else {
    keyBytes = publicKey;
  }

  // SHA256 哈希，取前 16 字节（32 个十六进制字符），再取前 16 个字符
  const hash = createHash('sha256').update(keyBytes).digest('hex');
  return hash.slice(0, 16);
}

/**
 * 生成新格式 AgentId (RFC008)
 *
 * 格式: agent:<公钥指纹16位>
 *
 * @param publicKey 公钥（Uint8Array 或 Base64 字符串）
 * @returns 新格式 AgentId
 */
export function generateAgentId(publicKey: Uint8Array | string): string {
  const fingerprint = computeFingerprint(publicKey);
  return `agent:${fingerprint}`;
}

/**
 * 解析 AgentId，支持新旧两种格式
 *
 * 旧格式 (RFC003): agent:<PeerId前16位>:<随机8位>
 * 新格式 (RFC008): agent:<公钥指纹16位>
 *
 * @param agentId Agent ID
 * @returns 解析结果
 */
export function parseAgentId(agentId: string): ParsedAgentId {
  if (!agentId || typeof agentId !== 'string') {
    return {
      format: 'new', // 默认新格式
      valid: false,
      error: 'Invalid AgentId: must be a non-empty string'
    };
  }

  const parts = agentId.split(':');

  // 必须以 'agent:' 开头
  if (parts[0] !== 'agent') {
    return {
      format: 'new',
      valid: false,
      error: 'Invalid AgentId: must start with "agent:"'
    };
  }

  // 新格式 (RFC008): agent:<fingerprint> - 2 部分
  if (parts.length === 2) {
    const fingerprint = parts[1];

    // 验证指纹格式：16 位十六进制
    if (fingerprint.length !== 16) {
      return {
        format: 'new',
        valid: false,
        fingerprint,
        error: `Invalid AgentId fingerprint length: expected 16, got ${fingerprint.length}`
      };
    }

    if (!/^[0-9a-fA-F]{16}$/.test(fingerprint)) {
      return {
        format: 'new',
        valid: false,
        fingerprint,
        error: 'Invalid AgentId fingerprint: must be 16 hexadecimal characters'
      };
    }

    return {
      format: 'new',
      valid: true,
      fingerprint: fingerprint.toLowerCase()
    };
  }

  // 旧格式 (RFC003): agent:<peerIdPrefix>:<randomSuffix> - 3 部分
  if (parts.length === 3) {
    const peerIdPrefix = parts[1];
    const randomSuffix = parts[2];

    // 验证 PeerId 前缀长度（应该是 16 位）
    if (peerIdPrefix.length !== 16) {
      return {
        format: 'old',
        valid: false,
        peerIdPrefix,
        randomSuffix,
        error: `Invalid PeerId prefix length: expected 16, got ${peerIdPrefix.length}`
      };
    }

    // PeerId 前缀使用 base58btc 字符集
    if (!BASE58BTC_REGEX.test(peerIdPrefix)) {
      return {
        format: 'old',
        valid: false,
        peerIdPrefix,
        randomSuffix,
        error: 'Invalid PeerId prefix: must use base58btc characters (1-9, A-Z excluding O/I, a-z excluding l)'
      };
    }

    // 验证随机后缀格式（8 位十六进制）
    if (randomSuffix.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(randomSuffix)) {
      return {
        format: 'old',
        valid: false,
        peerIdPrefix,
        randomSuffix,
        error: 'Invalid random suffix: must be 8 hexadecimal characters'
      };
    }

    return {
      format: 'old',
      valid: true,
      peerIdPrefix,
      randomSuffix: randomSuffix.toLowerCase()
    };
  }

  // 无效格式
  return {
    format: 'new',
    valid: false,
    error: `Invalid AgentId format: expected 2 or 3 parts, got ${parts.length}`
  };
}

/**
 * 验证 AgentId 与公钥指纹是否匹配（新格式）
 *
 * 注意：此方法仅适用于新格式 (RFC008) 的 AgentId。
 * 旧格式的 AgentId 需要通过签名验证，不通过公钥指纹验证。
 *
 * @param agentId Agent ID
 * @param publicKey 公钥（Uint8Array 或 Base64 字符串）
 * @returns 验证结果
 */
export function validateAgentId(
  agentId: string,
  publicKey: Uint8Array | string
): AgentIdValidationResult {
  // 解析 AgentId
  const parsed = parseAgentId(agentId);

  if (!parsed.valid) {
    return {
      valid: false,
      error: parsed.error,
      format: parsed.format
    };
  }

  // 旧格式无法通过公钥指纹验证
  if (parsed.format === 'old') {
    return {
      valid: false,
      format: 'old',
      peerIdPrefix: parsed.peerIdPrefix,
      error: 'Old format (RFC003) AgentId cannot be validated by public key fingerprint. Use signature verification instead.'
    };
  }

  // 新格式：验证公钥指纹匹配
  const expectedFingerprint = computeFingerprint(publicKey);
  const actualFingerprint = parsed.fingerprint!;

  if (expectedFingerprint.toLowerCase() === actualFingerprint.toLowerCase()) {
    logger.debug('AgentId fingerprint validated', {
      agentId,
      fingerprint: actualFingerprint
    });
    return {
      valid: true,
      format: 'new',
      fingerprint: actualFingerprint
    };
  }

  logger.warn('AgentId fingerprint mismatch', {
    agentId,
    expected: expectedFingerprint,
    actual: actualFingerprint
  });

  return {
    valid: false,
    format: 'new',
    fingerprint: actualFingerprint,
    error: `Fingerprint mismatch: expected ${expectedFingerprint}, got ${actualFingerprint}`
  };
}

/**
 * 判断是否为 RFC008 新格式 AgentId
 *
 * 新格式: agent:<公钥指纹16位>
 * 示例: agent:a3b2c1d4e5f67890
 *
 * @param agentId Agent ID
 * @returns 是否为新格式
 */
export function isNewFormat(agentId: string): boolean {
  const parsed = parseAgentId(agentId);
  return parsed.valid && parsed.format === 'new';
}

/**
 * 判断是否为 RFC003 旧格式 AgentId
 *
 * 旧格式: agent:<PeerId前16位>:<随机8位>
 * 示例: agent:12D3KooWHxWdnxJa:abc12345
 *
 * @param agentId Agent ID
 * @returns 是否为旧格式
 */
export function isOldFormat(agentId: string): boolean {
  const parsed = parseAgentId(agentId);
  return parsed.valid && parsed.format === 'old';
}

/**
 * 验证 AgentId 格式是否有效（不验证指纹）
 *
 * @param agentId Agent ID
 * @returns 是否为有效的 AgentId 格式
 */
export function isValidAgentIdFormat(agentId: string): boolean {
  const parsed = parseAgentId(agentId);
  return parsed.valid;
}

/**
 * 从 AgentId 提取指纹（仅新格式）
 *
 * @param agentId Agent ID
 * @returns 指纹字符串，如果不是新格式返回 null
 */
export function extractFingerprint(agentId: string): string | null {
  const parsed = parseAgentId(agentId);
  if (parsed.valid && parsed.format === 'new') {
    return parsed.fingerprint!;
  }
  return null;
}

/**
 * 从 AgentId 提取 PeerId 前缀（仅旧格式）
 *
 * @param agentId Agent ID
 * @returns PeerId 前缀，如果不是旧格式返回 null
 */
export function extractPeerIdPrefix(agentId: string): string | null {
  const parsed = parseAgentId(agentId);
  if (parsed.valid && parsed.format === 'old') {
    return parsed.peerIdPrefix!;
  }
  return null;
}