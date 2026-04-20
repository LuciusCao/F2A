/**
 * 身份管理模块导出
 */

// 原有的导出
export { IdentityManager } from './identity-manager.js';
export { encryptIdentity, decryptIdentity, validatePasswordStrength, MIN_PASSWORD_LENGTH } from './encrypted-key-store.js';
export type { 
  PersistedIdentity, 
  IdentityManagerOptions, 
  ExportedIdentity,
  EncryptedIdentity 
} from './types.js';
export { 
  DEFAULT_DATA_DIR, 
  IDENTITY_FILE,
  AES_KEY_SIZE,
  AES_IV_SIZE,
  AES_TAG_SIZE
} from './types.js';

// Node Identity 导出
export { NodeIdentityManager } from './node-identity.js';
export type {
  NodeIdentityOptions,
  PersistedNodeIdentity,
  ExportedNodeIdentity
} from './types.js';
export { NODE_IDENTITY_FILE } from './types.js';

// Agent Identity 导出
export { AgentIdentityManager } from './agent-identity.js';
export type {
  AgentIdentity,
  AgentIdentityOptions,
  PersistedAgentIdentity,
  ExportedAgentIdentity,
  AgentSignaturePayload
} from './types.js';
export { AGENT_IDENTITY_FILE } from './types.js';

// Identity Delegator 导出
export { IdentityDelegator } from './delegator.js';
export type {
  IdentityDelegatorOptions,
  DelegationResult,
  MigrationResult
} from './types.js';

// RFC 003: AgentIdentityVerifier 导出
export { AgentIdentityVerifier } from './agent-identity-verifier.js';
export type {
  AgentIdVerificationResult,
  VerificationOptions
} from './agent-identity-verifier.js';

// RFC 003: Ed25519Signer 导出
export { Ed25519Signer } from './ed25519-signer.js';
export type { Ed25519KeyPair } from './ed25519-signer.js';

// RFC 008: AgentId 格式与验证导出
export {
  generateAgentId,
  computeFingerprint,
  parseAgentId,
  validateAgentId,
  isNewFormat,
  isOldFormat,
  isValidAgentIdFormat,
  extractFingerprint,
  extractPeerIdPrefix
} from './agent-id.js';
export type { ParsedAgentId, AgentIdValidationResult } from './agent-id.js';

// RFC 008: AgentIdentityKeypair 导出
export { AgentIdentityKeypair } from './agent-keypair.js';
export type { Ed25519Keypair, RFC008IdentityFile } from './agent-keypair.js';

// RFC 008: Challenge-Response 认证协议导出
export {
  generateChallenge,
  signChallenge,
  verifyChallengeResponse,
  verifyChallengeResponseWithStore,
  ChallengeStore
} from './challenge.js';
export type {
  Challenge,
  ChallengeResponse,
  ChallengeVerificationResult
} from './challenge.js';