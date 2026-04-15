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