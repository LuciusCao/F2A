/**
 * 身份管理器类型定义
 */

/** AES-256-GCM 参数 */
export const AES_KEY_SIZE = 32;
export const AES_IV_SIZE = 12;
export const AES_TAG_SIZE = 16;

/** 数据目录 */
export const DEFAULT_DATA_DIR = '.f2a';
export const IDENTITY_FILE = 'identity.json';

/**
 * 持久化的身份数据结构
 */
export interface PersistedIdentity {
  /** libp2p PeerId (Ed25519) 的 protobuf 编码 (base64) */
  peerId: string;
  /** E2EE 私钥 (X25519, base64) */
  e2eePrivateKey: string;
  /** E2EE 公钥 (X25519, base64) */
  e2eePublicKey: string;
  /** 创建时间 (ISO 字符串) */
  createdAt: string;
  /** 最后使用时间 (ISO 字符串) */
  lastUsedAt: string;
}

/**
 * 身份配置选项
 */
export interface IdentityManagerOptions {
  /** 数据目录 (默认 ~/.f2a/) */
  dataDir?: string;
  /** 加密密码 (可选，用于加密存储) */
  password?: string;
}

/**
 * 导出的身份信息
 */
export interface ExportedIdentity {
  /** PeerId 字符串 */
  peerId: string;
  /** libp2p 私钥 (protobuf 编码, base64) */
  privateKey: string;
  /** E2EE 密钥对 */
  e2eeKeyPair: {
    publicKey: string;
    privateKey: string;
  };
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 加密后的身份数据结构
 */
export interface EncryptedIdentity {
  encrypted: true;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}