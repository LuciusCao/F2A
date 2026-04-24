/**
 * AgentIdentityKeypair - RFC 008 Agent Self-Identity Ed25519 密钥管理
 *
 * 提供独立的 Ed25519 密钥对管理，用于 Agent 自有身份体系：
 * - 密钥对生成
 * - 公钥指纹计算（SHA256 取前16位）
 * - 签名与验证
 *
 * 参考: RFC008 Agent Self-Identity
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha256';
import { Logger } from '../../utils/logger.js';
import { signSelfSignature } from './identity-signature.js';

/**
 * Ed25519 密钥对
 */
export interface Ed25519Keypair {
  /** 私钥（32字节种子，Base64编码） */
  privateKey: string;
  /** 公钥（32字节，Base64编码） */
  publicKey: string;
}

/**
 * Agent Identity File 格式 (RFC008 + RFC011 定义)
 * 
 * RFC011: 新增 selfSignature 字段（Agent 对自己的公钥签名）
 */
export interface AgentIdentityFile {
  /** Agent ID (格式: agent:{fingerprint}) */
  agentId: string;
  /** 公钥 (Base64) */
  publicKey: string;
  /** 私钥 (Base64，可选加密) */
  privateKey: string;
  /** 私钥是否加密 */
  privateKeyEncrypted: boolean;
  /** RFC011: Agent 自签名 (Base64) - Agent 对自己的公钥签名 */
  selfSignature: string;
  /** Node 签发的归属证明 (Base64) */
  nodeSignature?: string;
  /** 签发节点的 NodeId (值等同 libp2p PeerId) */
  nodeId?: string;
  /** Agent 名称 */
  name?: string;
  /** 能力列表 */
  capabilities?: Array<{ name: string; version: string }>;
  /** 创建时间 (ISO string) */
  createdAt: string;
  /** 最后活跃时间 (ISO string) */
  lastActiveAt?: string;
  /** Webhook 配置 */
  webhook?: {
    url: string;
  };
}

/**
 * AgentIdentityKeypair - Ed25519 密钥管理器
 *
 * 按照 RFC008 规范实现 Agent 自有身份的密钥管理。
 * Agent 拥有独立的 Ed25519 密钥对，公钥指纹作为 AgentId。
 */
export class AgentIdentityKeypair {
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ component: 'AgentIdentityKeypair' });
  }

  /**
   * 生成 Ed25519 密钥对
   *
   * @returns Ed25519 密钥对（私钥和公钥均为 Base64 编码）
   */
  generateKeypair(): Ed25519Keypair {
    // 生成 32 字节的私钥种子
    const privateKey = ed25519.utils.randomSecretKey();
    // 从私钥派生公钥
    const publicKey = ed25519.getPublicKey(privateKey);

    this.logger.debug('Generated new Ed25519 keypair');

    return {
      privateKey: Buffer.from(privateKey).toString('base64'),
      publicKey: Buffer.from(publicKey).toString('base64')
    };
  }

  /**
   * 计算公钥指纹
   *
   * 按照 RFC008 规范：
   * SHA256(publicKey) 的前 16 位 hex 字符
   *
   * @param publicKey 公钥（Base64 编码或 Uint8Array）
   * @returns 16位 hex 字符串指纹
   */
  computeFingerprint(publicKey: string | Uint8Array): string {
    // 解码公钥
    const publicKeyBytes = typeof publicKey === 'string'
      ? Buffer.from(publicKey, 'base64')
      : publicKey;

    // SHA256 哈希
    const hash = sha256(publicKeyBytes);

    // 取前 16 位 hex 字符（8 字节）
    // hash 是 Uint8Array，每个字节对应 2 个 hex 字符
    // 前 8 字节 = 16 个 hex 字符
    const fingerprintBytes = hash.slice(0, 8);
    const fingerprint = Buffer.from(fingerprintBytes).toString('hex');

    this.logger.debug('Computed fingerprint', { fingerprint });

    return fingerprint;
  }

  /**
   * 从公钥计算 AgentId
   *
   * AgentId 格式: agent:{fingerprint}
   *
   * @param publicKey 公钥（Base64 编码或 Uint8Array）
   * @returns Agent ID
   */
  computeAgentId(publicKey: string | Uint8Array): string {
    const fingerprint = this.computeFingerprint(publicKey);
    return `agent:${fingerprint}`;
  }

  /**
   * 使用私钥签名数据
   *
   * @param data 要签名的数据（字符串或 Uint8Array）
   * @param privateKey 私钥（Base64 编码或 Uint8Array）
   * @returns Base64 编码的签名（64 字节）
   */
  sign(data: string | Uint8Array, privateKey: string | Uint8Array): string {
    // 解码私钥
    const privateKeyBytes = typeof privateKey === 'string'
      ? Buffer.from(privateKey, 'base64')
      : privateKey;

    // 解码数据
    const dataBytes = typeof data === 'string'
      ? Buffer.from(data, 'utf-8')
      : data;

    // Ed25519 签名
    const signature = ed25519.sign(dataBytes, privateKeyBytes);

    return Buffer.from(signature).toString('base64');
  }

  /**
   * 使用公钥验证签名
   *
   * @param signature Base64 编码的签名
   * @param data 原始数据（字符串或 Uint8Array）
   * @param publicKey 公钥（Base64 编码或 Uint8Array）
   * @returns 签名是否有效
   */
  verify(signature: string | Uint8Array, data: string | Uint8Array, publicKey: string | Uint8Array): boolean {
    try {
      // 解码签名
      const signatureBytes = typeof signature === 'string'
        ? Buffer.from(signature, 'base64')
        : signature;

      // 解码数据
      const dataBytes = typeof data === 'string'
        ? Buffer.from(data, 'utf-8')
        : data;

      // 解码公钥
      const publicKeyBytes = typeof publicKey === 'string'
        ? Buffer.from(publicKey, 'base64')
        : publicKey;

      // Ed25519 验证
      const isValid = ed25519.verify(signatureBytes, dataBytes, publicKeyBytes);

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
   * 验证 AgentId 与公钥是否匹配
   *
   * @param agentId Agent ID (格式: agent:{fingerprint})
   * @param publicKey 公钥（Base64 编码或 Uint8Array）
   * @returns 是否匹配
   */
  validateAgentId(agentId: string, publicKey: string | Uint8Array): boolean {
    if (!agentId.startsWith('agent:')) {
      this.logger.warn('Invalid AgentId format', { agentId });
      return false;
    }

    const expectedFingerprint = agentId.slice(6); // 去掉 "agent:" 前缀
    const actualFingerprint = this.computeFingerprint(publicKey);

    const match = expectedFingerprint === actualFingerprint;

    if (!match) {
      this.logger.warn('AgentId fingerprint mismatch', {
        expected: expectedFingerprint,
        actual: actualFingerprint
      });
    }

    return match;
  }

  /**
   * 从私钥派生公钥
   *
   * @param privateKey 私钥（Base64 编码或 Uint8Array）
   * @returns Base64 编码的公钥
   */
  derivePublicKey(privateKey: string | Uint8Array): string {
    const privateKeyBytes = typeof privateKey === 'string'
      ? Buffer.from(privateKey, 'base64')
      : privateKey;

    const publicKey = ed25519.getPublicKey(privateKeyBytes);

    return Buffer.from(publicKey).toString('base64');
  }

  /**
   * 创建 RFC008 + RFC011 格式的身份文件结构
   * 
   * RFC011: 自动生成 selfSignature（Agent 对自己的公钥签名）
   *
   * @param keypair 密钥对
   * @param options 可选配置
   * @returns RFC008 + RFC011 身份文件结构
   */
  createIdentityFile(
    keypair: Ed25519Keypair,
    options: {
      name?: string;
      capabilities?: Array<{ name: string; version: string }>;
      privateKeyEncrypted?: boolean;
      nodeSignature?: string;
      nodeId?: string;
      webhook?: { url: string };
      /** RFC011: 跳过 selfSignature 生成（用于恢复已有身份） */
      skipSelfSignature?: boolean;
      /** RFC011: 使用已有的 selfSignature（用于恢复身份） */
      selfSignature?: string;
    } = {}
  ): AgentIdentityFile {
    const agentId = this.computeAgentId(keypair.publicKey);
    const now = new Date().toISOString();

    // RFC011: 生成 selfSignature（除非已有签名或明确跳过）
    const selfSignature = options.selfSignature || 
      (options.skipSelfSignature ? '' : 
        signSelfSignature(agentId, keypair.publicKey, keypair.privateKey));

    return {
      agentId,
      publicKey: keypair.publicKey,
      privateKey: keypair.privateKey,
      privateKeyEncrypted: options.privateKeyEncrypted ?? false,
      selfSignature,
      nodeSignature: options.nodeSignature,
      nodeId: options.nodeId,
      name: options.name,
      capabilities: options.capabilities,
      createdAt: now,
      lastActiveAt: now,
      webhook: options.webhook
    };
  }

  /**
   * 静态方法：生成密钥对
   *
   * @returns Ed25519 密钥对
   */
  static generateKeypair(): Ed25519Keypair {
    const instance = new AgentIdentityKeypair();
    return instance.generateKeypair();
  }

  /**
   * 静态方法：计算指纹
   *
   * @param publicKey 公钥（Base64 编码或 Uint8Array）
   * @returns 16位 hex 字符串指纹
   */
  static computeFingerprint(publicKey: string | Uint8Array): string {
    const instance = new AgentIdentityKeypair();
    return instance.computeFingerprint(publicKey);
  }

  /**
   * 静态方法：签名
   *
   * @param data 要签名的数据
   * @param privateKey 私钥
   * @returns Base64 编码的签名
   */
  static sign(data: string | Uint8Array, privateKey: string | Uint8Array): string {
    const instance = new AgentIdentityKeypair();
    return instance.sign(data, privateKey);
  }

  /**
   * 静态方法：验证签名
   *
   * @param signature 签名
   * @param data 原始数据
   * @param publicKey 公钥
   * @returns 签名是否有效
   */
  static verify(signature: string | Uint8Array, data: string | Uint8Array, publicKey: string | Uint8Array): boolean {
    const instance = new AgentIdentityKeypair();
    return instance.verify(signature, data, publicKey);
  }
}