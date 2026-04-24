/**
 * RFC011: Agent Identity Verification Chain
 * 
 * 签名验证链：Agent 自签名 → Node 签名验证
 * 
 * 签名流程：
 * 1. Agent 生成 Ed25519 密钥对
 * 2. Agent 用自己的私钥签名 selfSignature payload → selfSignature
 * 3. Agent 向 Node 注册时发送 agentId + publicKey + selfSignature
 * 4. Node 验证 selfSignature 是否有效（用 Agent 公钥验证）
 * 5. 验证通过后，Node 用自己的私钥签名 nodeSignature payload → nodeSignature
 * 6. Node 返回 nodeSignature 给 Agent
 * 
 * 验证流程：
 * - 验证 selfSignature: SHA256(agentId:publicKey) 用 Agent 公钥验证
 * - 验证 nodeSignature: SHA256(agentId:publicKey:nodeId) 用 Node 公钥验证
 */

import { sha256 } from '@noble/hashes/sha256';
import { ed25519 } from '@noble/curves/ed25519.js';

// ============================================================================
// Payload Creation - 创建签名载荷
// ============================================================================

/**
 * 创建 Self-Signature payload
 * RFC011: SHA256(agentId:publicKey)
 * 
 * @param agentId - Agent ID (格式: agent:<16位公钥指纹>)
 * @param publicKeyBase64 - Agent Ed25519 公钥 (base64)
 * @returns SHA256 hash 的 Uint8Array
 */
export function createSelfSignaturePayload(
  agentId: string,
  publicKeyBase64: string
): Uint8Array {
  const payload = `${agentId}:${publicKeyBase64}`;
  return sha256(Buffer.from(payload, 'utf-8'));
}

/**
 * 创建 Node-Signature payload
 * RFC011: SHA256(agentId:publicKey:nodeId)
 * 
 * @param agentId - Agent ID
 * @param publicKeyBase64 - Agent Ed25519 公钥 (base64)
 * @param nodeId - Node ID (PeerId 字符串)
 * @returns SHA256 hash 的 Uint8Array
 */
export function createNodeSignaturePayload(
  agentId: string,
  publicKeyBase64: string,
  nodeId: string
): Uint8Array {
  const payload = `${agentId}:${publicKeyBase64}:${nodeId}`;
  return sha256(Buffer.from(payload, 'utf-8'));
}

// ============================================================================
// Signing - 创建签名
// ============================================================================

/**
 * 使用 Agent 私钥创建 selfSignature
 * 
 * @param agentId - Agent ID
 * @param publicKeyBase64 - Agent Ed25519 公钥 (base64)
 * @param privateKeyBase64 - Agent Ed25519 私钥 (base64, raw 32 bytes seed)
 * @returns selfSignature (base64)
 */
export function signSelfSignature(
  agentId: string,
  publicKeyBase64: string,
  privateKeyBase64: string
): string {
  const payload = createSelfSignaturePayload(agentId, publicKeyBase64);
  const privateKey = decodeBase64(privateKeyBase64);
  const signature = ed25519.sign(payload, privateKey);
  return encodeBase64(signature);
}

/**
 * 使用 Node 私钥创建 nodeSignature
 * 
 * @param agentId - Agent ID
 * @param publicKeyBase64 - Agent Ed25519 公钥 (base64)
 * @param nodeId - Node ID
 * @param nodePrivateKeyBase64 - Node Ed25519 私钥 (base64, raw 32 bytes seed)
 * @returns nodeSignature (base64)
 */
export function signNodeSignature(
  agentId: string,
  publicKeyBase64: string,
  nodeId: string,
  nodePrivateKeyBase64: string
): string {
  const payload = createNodeSignaturePayload(agentId, publicKeyBase64, nodeId);
  const privateKey = decodeBase64(nodePrivateKeyBase64);
  const signature = ed25519.sign(payload, privateKey);
  return encodeBase64(signature);
}

// ============================================================================
// Verification - 验证签名
// ============================================================================

/**
 * 验证 Agent 的 selfSignature
 * 
 * @param agentId - Agent ID
 * @param publicKeyBase64 - Agent Ed25519 公钥 (base64)
 * @param selfSignatureBase64 - 待验证的 selfSignature (base64)
 * @returns 验证是否通过
 */
export function verifySelfSignature(
  agentId: string,
  publicKeyBase64: string,
  selfSignatureBase64: string
): boolean {
  try {
    const payload = createSelfSignaturePayload(agentId, publicKeyBase64);
    const signature = decodeBase64(selfSignatureBase64);
    const publicKey = decodeBase64(publicKeyBase64);
    return ed25519.verify(signature, payload, publicKey);
  } catch {
    return false;
  }
}

/**
 * 验证 Node 的 nodeSignature
 * 
 * @param agentId - Agent ID
 * @param publicKeyBase64 - Agent Ed25519 公钥 (base64)
 * @param nodeId - Node ID
 * @param nodeSignatureBase64 - 待验证的 nodeSignature (base64)
 * @param nodePublicKeyBase64 - Node Ed25519 公钥 (base64)
 * @returns 验证是否通过
 */
export function verifyNodeSignature(
  agentId: string,
  publicKeyBase64: string,
  nodeId: string,
  nodeSignatureBase64: string,
  nodePublicKeyBase64: string
): boolean {
  try {
    const payload = createNodeSignaturePayload(agentId, publicKeyBase64, nodeId);
    const signature = decodeBase64(nodeSignatureBase64);
    const nodePublicKey = decodeBase64(nodePublicKeyBase64);
    return ed25519.verify(signature, payload, nodePublicKey);
  } catch {
    return false;
  }
}

/**
 * 验证 Node 的 nodeSignature (Uint8Array 公钥版本)
 * 
 * @param agentId - Agent ID
 * @param publicKeyBase64 - Agent Ed25519 公钥 (base64)
 * @param nodeId - Node ID
 * @param nodeSignatureBase64 - 待验证的 nodeSignature (base64)
 * @param nodePublicKey - Node Ed25519 公钥 (Uint8Array)
 * @returns 验证是否通过
 */
export function verifyNodeSignatureRaw(
  agentId: string,
  publicKeyBase64: string,
  nodeId: string,
  nodeSignatureBase64: string,
  nodePublicKey: Uint8Array
): boolean {
  try {
    const payload = createNodeSignaturePayload(agentId, publicKeyBase64, nodeId);
    const signature = decodeBase64(nodeSignatureBase64);
    return ed25519.verify(signature, payload, nodePublicKey);
  } catch {
    return false;
  }
}

// ============================================================================
// Utility Functions - 工具函数
// ============================================================================

/**
 * 生成 Ed25519 密钥对
 * 
 * @returns { publicKey: base64, privateKey: base64 }
 */
export function generateIdentityKeyPair(): { publicKey: string; privateKey: string } {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKey: encodeBase64(publicKey),
    privateKey: encodeBase64(privateKey)
  };
}

/**
 * 从公钥计算 Agent ID
 * RFC008: agent:<16位公钥指纹>
 * 
 * @param publicKeyBase64 - Ed25519 公钥 (base64)
 * @returns Agent ID
 */
export function computeAgentId(publicKeyBase64: string): string {
  const publicKey = decodeBase64(publicKeyBase64);
  const hash = sha256(publicKey);
  // 取前 16 位作为指纹
  const fingerprint = encodeBase64(hash.slice(0, 8)); // 8 bytes = 16 hex chars
  return `agent:${fingerprint}`;
}

/**
 * Base64 编码
 */
export function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/**
 * Base64 解码
 */
export function decodeBase64(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64');
}

// ============================================================================
// Identity Verification Result - 验证结果
// ============================================================================

/**
 * 身份验证结果
 */
export interface IdentityVerificationResult {
  /** 验证是否通过 */
  valid: boolean;
  /** 错误信息（失败时） */
  error?: string;
  /** 验证详情 */
  details?: {
    selfSignatureValid: boolean;
    nodeSignatureValid?: boolean;
  };
}

/**
 * 验证完整的 Agent Identity
 * 
 * @param identity - Agent Identity 对象
 * @param nodePublicKeyBase64 - Node 公钥 (base64)，用于验证 nodeSignature
 * @returns 验证结果
 */
export function verifyAgentIdentity(
  identity: {
    agentId: string;
    publicKey: string;
    selfSignature: string;
    nodeId?: string;
    nodeSignature?: string;
  },
  nodePublicKeyBase64?: string
): IdentityVerificationResult {
  // 1. 验证 selfSignature（必需）
  const selfSignatureValid = verifySelfSignature(
    identity.agentId,
    identity.publicKey,
    identity.selfSignature
  );

  if (!selfSignatureValid) {
    return {
      valid: false,
      error: 'Invalid selfSignature: signature does not match publicKey',
      details: { selfSignatureValid: false }
    };
  }

  // 2. 如果有 nodeSignature，验证它
  if (identity.nodeSignature && identity.nodeId && nodePublicKeyBase64) {
    const nodeSignatureValid = verifyNodeSignature(
      identity.agentId,
      identity.publicKey,
      identity.nodeId,
      identity.nodeSignature,
      nodePublicKeyBase64
    );

    if (!nodeSignatureValid) {
      return {
        valid: false,
        error: 'Invalid nodeSignature: signature does not match Node publicKey',
        details: { selfSignatureValid: true, nodeSignatureValid: false }
      };
    }

    return {
      valid: true,
      details: { selfSignatureValid: true, nodeSignatureValid: true }
    };
  }

  // 3. 只有 selfSignature 验证通过
  return {
    valid: true,
    details: { selfSignatureValid: true }
  };
}