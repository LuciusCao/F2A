/**
 * 身份管理模块导出
 */

export { IdentityManager } from './identity-manager.js';
export { encryptIdentity, decryptIdentity } from './encrypted-key-store.js';
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