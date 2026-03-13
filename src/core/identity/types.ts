/**
 * Identity manager type definitions
 */

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
  /** libp2p PeerId (Ed25519) protobuf encoded (base64) */
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
