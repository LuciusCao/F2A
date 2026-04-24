/**
 * Identity manager type definitions
 * RFC011: Agent Identity Verification Chain
 */

import {
  verifySelfSignature,
  verifyNodeSignatureRaw,
  IdentityVerificationResult
} from './identity-signature.js';

/** AES-256-GCM parameters */
export const AES_KEY_SIZE = 32;
export const AES_IV_SIZE = 12;
export const AES_TAG_SIZE = 16;

/** Scrypt parameters for key derivation */
export const SCRYPT_N = 16384; // CPU/memory cost parameter (default, ~64MB memory)
export const SCRYPT_R = 8;     // Block size
export const SCRYPT_P = 1;     // Parallelization parameter

/** Salt size for key derivation */
export const SALT_SIZE = 16;

/** Data directory */
export const DEFAULT_DATA_DIR = '.f2a';
export const IDENTITY_FILE = 'identity.json';

/**
 * Persisted identity data structure
 */
export interface PersistedIdentity {
  /** 
   * Ed25519 private key (protobuf encoded, base64) - SENSITIVE
   * 
   * Note: Despite the field name "peerId", this field stores the PRIVATE KEY,
   * not the public PeerId. The naming is preserved for backward compatibility
   * with existing identity files.
   */
  peerId: string;
  /** E2EE private key (X25519, base64) */
  e2eePrivateKey: string;
  /** E2EE public key (X25519, base64) */
  e2eePublicKey: string;
  /** Creation time (ISO string) */
  createdAt: string;
  /** Last used time (ISO string) */
  lastUsedAt: string;
}

/**
 * Identity configuration options
 */
export interface IdentityManagerOptions {
  /** Data directory (default ~/.f2a/) */
  dataDir?: string;
  /** Encryption password (optional, for encrypted storage) */
  password?: string;
}

/**
 * Exported identity information
 * 
 * WARNING: This contains sensitive private key material.
 * Handle with care and avoid logging or exposing this data.
 */
export interface ExportedIdentity {
  /** PeerId string */
  peerId: string;
  /** libp2p private key (protobuf encoded, base64) - SENSITIVE */
  privateKey: string;
  /** E2EE key pair */
  e2eeKeyPair: {
    publicKey: string;
    privateKey: string; // SENSITIVE
  };
  /** Creation time */
  createdAt: Date;
}

/**
 * Encrypted identity data structure
 */
export interface EncryptedIdentity {
  encrypted: true;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Type guard to validate EncryptedIdentity structure
 */
export function isEncryptedIdentity(obj: unknown): obj is EncryptedIdentity {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return (
    record.encrypted === true &&
    typeof record.salt === 'string' && record.salt.length > 0 &&
    typeof record.iv === 'string' && record.iv.length > 0 &&
    typeof record.authTag === 'string' && record.authTag.length > 0 &&
    typeof record.ciphertext === 'string' && record.ciphertext.length > 0
  );
}

// ============================================================================
// Node Identity - 持久化身份，代表物理设备
// ============================================================================

/** Node Identity 文件名 */
export const NODE_IDENTITY_FILE = 'node-identity.json';

/**
 * Node Identity 配置选项
 */
export interface NodeIdentityOptions {
  /** 数据目录（默认 ~/.f2a/） */
  dataDir?: string;
  /** 加密密码（可选，用于加密存储） */
  password?: string;
}

/**
 * 持久化的 Node Identity 数据结构
 * 
 * Phase 3 优化：移除冗余的 peerId 字段，保留 privateKey（语义更清晰）
 * nodeId 字段现在存储完整的 PeerId 值（Phase 2 已修复）
 */
export interface PersistedNodeIdentity {
  /** Node ID (完整 PeerId 字符串，不截断) */
  nodeId: string;
  /** 
   * libp2p Ed25519 private key (protobuf encoded, base64) - SENSITIVE
   * 
   * Phase 3: 字段名从 peerId 改为 privateKey，语义更清晰
   * 加载旧文件时向后兼容 peerId 字段名
   */
  privateKey: string;
  /** E2EE 私钥 (X25519, base64) */
  e2eePrivateKey: string;
  /** E2EE 公钥 (X25519, base64) */
  e2eePublicKey: string;
  /** 创建时间 (ISO string) */
  createdAt: string;
  /** 最后使用时间 (ISO string) */
  lastUsedAt: string;
}

/**
 * 导出的 Node Identity 信息
 * 
 * WARNING: 包含敏感的私钥材料。
 * 请谨慎处理，避免日志记录或暴露此数据。
 */
export interface ExportedNodeIdentity {
  /** Node ID (PeerId 字符串) */
  nodeId: string;
  /** libp2p PeerId */
  peerId: string;
  /** libp2p 私钥 (protobuf encoded, base64) - 敏感 */
  privateKey: string;
  /** E2EE 密钥对 */
  e2eeKeyPair: {
    publicKey: string;
    privateKey: string; // 敏感
  };
  /** 创建时间 */
  createdAt: Date;
}

// ============================================================================
// Agent Identity - 由 Node 委派的身份，可迁移
// ============================================================================

/** Agent Identity 文件名 */
export const AGENT_IDENTITY_FILE = 'agent-identity.json';

/**
 * Agent Identity 配置选项
 */
export interface AgentIdentityOptions {
  /** Agent ID (UUID)，可选，不提供则自动生成 */
  id?: string;
  /** Agent 名称 */
  name: string;
  /** 能力标签列表 */
  capabilities?: string[];
  /** 过期时间（可选） */
  expiresAt?: Date;
}

/**
 * Agent Identity 数据结构
 * RFC011: Agent Identity Verification Chain
 * 
 * 这是 Agent 的完整身份信息，包含签名链：
 * - selfSignature: Agent 自己对自己的公钥签名（证明公钥所有权）
 * - signature/nodeSignature: Node 对 Agent 的签名（证明委派关系）
 */
export interface AgentIdentity {
  /** Agent ID (格式: agent:<16位公钥指纹>, RFC008) */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** Agent Ed25519 公钥 (base64) */
  publicKey: string;
  /** RFC011: Agent 自签名 (base64) - Agent 对自己的公钥签名 */
  selfSignature: string;
  /** Agent 能力标签列表 */
  capabilities: string[];
  /** 所属 Node ID */
  nodeId: string;
  /** Node 对 Agent 的签名 (base64) - 别名 nodeSignature */
  signature: string;
  /** 创建时间 (ISO string) */
  createdAt: string;
  /** 过期时间 (ISO string, 可选) */
  expiresAt?: string;
}

/**
 * 验证完整的 Agent Identity
 * 
 * @param identity - Agent Identity 对象
 * @param nodePublicKey - Node 公钥 (Uint8Array)，用于验证 nodeSignature
 * @returns 验证结果
 */
export function verifyFullAgentIdentity(
  identity: AgentIdentity,
  nodePublicKey?: Uint8Array
): IdentityVerificationResult {
  // 1. 验证 selfSignature（必需）
  const selfSigValid = verifySelfSignature(
    identity.agentId,
    identity.publicKey,
    identity.selfSignature
  );
  
  if (!selfSigValid) {
    return {
      valid: false,
      error: 'selfSignature verification failed',
      details: { selfSignatureValid: false }
    };
  }
  
  // 2. 如果提供了 Node 公钥，验证 nodeSignature
  if (nodePublicKey && identity.nodeId) {
    const nodeSigValid = verifyNodeSignatureRaw(
      identity.agentId,
      identity.publicKey,
      identity.nodeId,
      identity.signature,
      nodePublicKey
    );
    
    if (!nodeSigValid) {
      return {
        valid: false,
        error: 'nodeSignature verification failed',
        details: { selfSignatureValid: true, nodeSignatureValid: false }
      };
    }
    
    return {
      valid: true,
      details: { selfSignatureValid: true, nodeSignatureValid: true }
    };
  }
  
  return {
    valid: true,
    details: { selfSignatureValid: true, nodeSignatureValid: undefined }
  };
}

/**
 * 持久化的 Agent Identity（包含私钥）
 * 用于本地存储，包含敏感的私钥材料
 */
export interface PersistedAgentIdentity extends AgentIdentity {
  /** Agent Ed25519 私钥 (base64) - 敏感 */
  privateKey: string;
}

/**
 * 导出的 Agent Identity 信息
 * 
 * WARNING: 包含敏感的私钥材料。
 */
export interface ExportedAgentIdentity extends AgentIdentity {
  /** Agent Ed25519 私钥 (base64) - 敏感 */
  privateKey: string;
}

/**
 * Agent 签名载荷（用于签名验证）
 * RFC011: 已更新字段名 id → agentId
 */
export interface AgentSignaturePayload {
  /** Agent ID (格式: agent:<16位公钥指纹>) */
  agentId: string;
  /** Agent 名称 */
  name: string;
  /** 能力标签 */
  capabilities: string[];
  /** Node ID */
  nodeId: string;
  /** Agent 公钥 */
  publicKey: string;
  /** 创建时间 */
  createdAt: string;
  /** 过期时间 */
  expiresAt?: string;
}

// ============================================================================
// Identity Delegation - 身份委派
// ============================================================================

/**
 * Identity Delegator 配置选项
 */
export interface IdentityDelegatorOptions {
  /** 数据目录 */
  dataDir?: string;
}

/**
 * 委派结果
 */
export interface DelegationResult {
  /** Agent Identity（不包含私钥） */
  agentIdentity: AgentIdentity;
  /** Agent 私钥 (base64) - 仅创建时返回一次 */
  agentPrivateKey: string;
}

/**
 * Agent 迁移结果
 */
export interface MigrationResult {
  /** 新的 Agent Identity */
  agentIdentity: AgentIdentity;
  /** 新的签名 */
  signature: string;
}
