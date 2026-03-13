/**
 * Identity Manager
 * Manages libp2p PeerId (Ed25519) and E2EE key pair (X25519)
 * Persists identity to local filesystem
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { generateKeyPair, unmarshalPrivateKey, marshalPrivateKey } from '@libp2p/crypto/keys';
import { createFromPrivKey } from '@libp2p/peer-id-factory';
import type { PeerId } from '@libp2p/interface';
import type { PrivateKey } from '@libp2p/interface';
import { x25519 } from '@noble/curves/ed25519.js';
import { Logger } from '../../utils/logger.js';
import { success, failure, failureFromError, Result, createError } from '../../types/index.js';
import { encryptIdentity, decryptIdentity } from './encrypted-key-store.js';
import type { 
  PersistedIdentity, 
  IdentityManagerOptions, 
  ExportedIdentity,
  EncryptedIdentity 
} from './types.js';
import { DEFAULT_DATA_DIR, IDENTITY_FILE } from './types.js';

/**
 * Securely wipe a Uint8Array/Buffer by filling with zeros
 * @param data - The data to wipe (modified in place)
 */
function secureWipe(data: Uint8Array | null | undefined): void {
  if (data) {
    // Both Buffer and Uint8Array have fill(), no need for type check
    data.fill(0);
  }
}

/**
 * Identity Manager
 * 
 * Responsibilities:
 * - Manage libp2p PeerId (Ed25519 key pair)
 * - Manage E2EE key pair (X25519)
 * - Persist identity to local filesystem
 * - Support password-encrypted storage
 */
export class IdentityManager {
  private dataDir: string;
  private password?: string;
  private peerId: PeerId | null = null;
  private privateKey: PrivateKey | null = null;
  private e2eePublicKey: Uint8Array | null = null;
  private e2eePrivateKey: Uint8Array | null = null;
  private createdAt: Date | null = null;
  private logger: Logger;

  constructor(options: IdentityManagerOptions = {}) {
    this.dataDir = options.dataDir || join(homedir(), DEFAULT_DATA_DIR);
    this.password = options.password;
    this.logger = new Logger({ component: 'Identity' });
  }

  /**
   * Get identity data file path
   */
  private getIdentityFilePath(): string {
    return join(this.dataDir, IDENTITY_FILE);
  }

  /**
   * Ensure data directory exists with secure permissions
   */
  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      // Set directory permissions to 700 (owner only)
      await fs.chmod(this.dataDir, 0o700);
    } catch (error) {
      this.logger.error('Failed to create data directory', { error });
      throw error;
    }
  }

  /**
   * Load or create identity
   * 
   * - If identity file exists, load it
   * - If not, create new identity
   */
  async loadOrCreate(): Promise<Result<ExportedIdentity>> {
    try {
      await this.ensureDataDir();
      
      const identityFile = this.getIdentityFilePath();
      
      try {
        // Try to read existing identity
        const data = await fs.readFile(identityFile, 'utf-8');
        const parsed = JSON.parse(data);
        
        // Check if file is encrypted
        const isEncrypted = parsed.encrypted === true;
        
        if (isEncrypted) {
          // File is encrypted, password is required
          if (this.password === undefined || this.password === '') {
            this.logger.error('Identity file is encrypted but no password provided');
            return failure(createError(
              'IDENTITY_PASSWORD_REQUIRED',
              'Identity file is encrypted but no password was provided. Please provide a password to decrypt.'
            ));
          }
          
          // Attempt decryption
          try {
            const persisted = decryptIdentity(parsed, this.password);
            await this.loadPersistedIdentity(persisted);
            
            // Update last used time
            await this.saveIdentity();
            
            this.logger.info('Loaded existing encrypted identity', {
              peerId: this.peerId?.toString().slice(0, 16),
              createdAt: this.createdAt?.toISOString()
            });
            
            return success(this.exportIdentity());
          } catch (decryptError) {
            this.logger.error('Failed to decrypt identity with provided password', {
              error: decryptError instanceof Error ? decryptError.message : String(decryptError)
            });
            return failure(createError(
              'IDENTITY_DECRYPT_FAILED',
              'Failed to decrypt identity. The password may be incorrect.'
            ));
          }
        }
        
        // Plaintext identity data (backward compatible)
        const persisted = parsed as PersistedIdentity;
        await this.loadPersistedIdentity(persisted);
        
        // Update last used time
        await this.saveIdentity();
        
        this.logger.info('Loaded existing plaintext identity', {
          peerId: this.peerId?.toString().slice(0, 16),
          createdAt: this.createdAt?.toISOString()
        });
        
        // Warn about plaintext storage
        this.logger.warn('Identity is stored in plaintext. Consider setting a password for encryption.');
        
        return success(this.exportIdentity());
      } catch (readError: unknown) {
        // File doesn't exist or parse failed, create new identity
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          this.logger.info('No existing identity found, creating new one');
          return await this.createNewIdentity();
        }
        throw readError;
      }
    } catch (error) {
      return failureFromError('IDENTITY_LOAD_FAILED', 'Failed to load or create identity', error as Error);
    }
  }

  /**
   * Load identity from persisted data
   */
  private async loadPersistedIdentity(persisted: PersistedIdentity): Promise<void> {
    // Restore private key and PeerId
    const privateKeyBytes = Buffer.from(persisted.peerId, 'base64');
    this.privateKey = await unmarshalPrivateKey(privateKeyBytes);
    this.peerId = await createFromPrivKey(this.privateKey);

    // Securely wipe temporary private key bytes after use
    secureWipe(privateKeyBytes);

    // Restore E2EE key pair
    this.e2eePrivateKey = Buffer.from(persisted.e2eePrivateKey, 'base64');
    this.e2eePublicKey = Buffer.from(persisted.e2eePublicKey, 'base64');
    this.createdAt = new Date(persisted.createdAt);
  }

  /**
   * Create new identity
   */
  private async createNewIdentity(): Promise<Result<ExportedIdentity>> {
    try {
      // Generate Ed25519 key pair for libp2p PeerId
      this.privateKey = await generateKeyPair('Ed25519');
      this.peerId = await createFromPrivKey(this.privateKey);
      
      // Generate X25519 key pair for E2EE
      this.e2eePrivateKey = x25519.utils.randomSecretKey();
      this.e2eePublicKey = x25519.getPublicKey(this.e2eePrivateKey);
      
      this.createdAt = new Date();
      
      // Save identity
      await this.saveIdentity();
      
      this.logger.info('Created new identity', {
        peerId: this.peerId.toString().slice(0, 16),
        createdAt: this.createdAt.toISOString()
      });
      
      return success(this.exportIdentity());
    } catch (error) {
      return failureFromError('IDENTITY_CREATE_FAILED', 'Failed to create new identity', error as Error);
    }
  }

  /**
   * Save identity to file
   */
  private async saveIdentity(): Promise<void> {
    if (!this.privateKey || !this.peerId || !this.e2eePrivateKey || !this.e2eePublicKey || !this.createdAt) {
      throw new Error('Identity not initialized');
    }
    
    const persisted: PersistedIdentity = {
      peerId: Buffer.from(marshalPrivateKey(this.privateKey)).toString('base64'),
      e2eePrivateKey: Buffer.from(this.e2eePrivateKey).toString('base64'),
      e2eePublicKey: Buffer.from(this.e2eePublicKey).toString('base64'),
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    
    // Encrypt or save directly
    if (this.password !== undefined && this.password !== '') {
      const data = JSON.stringify(encryptIdentity(persisted, this.password));
      const identityFile = this.getIdentityFilePath();
      await fs.writeFile(identityFile, data, 'utf-8');
      // Set file permissions to 600 (owner only)
      await fs.chmod(identityFile, 0o600);
    } else {
      // Warn about plaintext storage
      this.logger.warn('Saving identity without encryption. Consider setting a password for better security.');
      const data = JSON.stringify(persisted, null, 2);
      const identityFile = this.getIdentityFilePath();
      await fs.writeFile(identityFile, data, 'utf-8');
      // Set file permissions to 600 (owner only)
      await fs.chmod(identityFile, 0o600);
    }
  }

  /**
   * Export identity information
   * 
   * WARNING: This returns sensitive private key material in plaintext.
   * - Do not log or expose the returned data
   * - Clear from memory when no longer needed
   * - Only call when absolutely necessary
   */
  exportIdentity(): ExportedIdentity {
    if (!this.peerId || !this.privateKey || !this.e2eePublicKey || !this.e2eePrivateKey || !this.createdAt) {
      throw new Error('Identity not initialized');
    }
    
    return {
      peerId: this.peerId.toString(),
      privateKey: Buffer.from(marshalPrivateKey(this.privateKey)).toString('base64'),
      e2eeKeyPair: {
        publicKey: Buffer.from(this.e2eePublicKey).toString('base64'),
        privateKey: Buffer.from(this.e2eePrivateKey).toString('base64')
      },
      createdAt: this.createdAt
    };
  }

  /**
   * Get PeerId
   */
  getPeerId(): PeerId | null {
    return this.peerId;
  }

  /**
   * Get PeerId string
   */
  getPeerIdString(): string | null {
    return this.peerId?.toString() || null;
  }

  /**
   * Get libp2p private key
   */
  getPrivateKey(): PrivateKey | null {
    return this.privateKey;
  }

  /**
   * Get E2EE key pair
   */
  getE2EEKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } | null {
    if (!this.e2eePublicKey || !this.e2eePrivateKey) return null;
    return {
      publicKey: this.e2eePublicKey,
      privateKey: this.e2eePrivateKey
    };
  }

  /**
   * Get E2EE public key (base64)
   */
  getE2EEPublicKeyBase64(): string | null {
    return this.e2eePublicKey ? Buffer.from(this.e2eePublicKey).toString('base64') : null;
  }

  /**
   * Check if identity is fully loaded
   */
  isLoaded(): boolean {
    return (
      this.peerId !== null &&
      this.privateKey !== null &&
      this.e2eePublicKey !== null &&
      this.e2eePrivateKey !== null &&
      this.createdAt !== null
    );
  }

  /**
   * Delete identity file and securely wipe memory (dangerous operation)
   */
  async deleteIdentity(): Promise<Result<void>> {
    try {
      const identityFile = this.getIdentityFilePath();
      await fs.unlink(identityFile);
      
      // Securely wipe private key data from memory
      if (this.e2eePrivateKey) {
        secureWipe(this.e2eePrivateKey);
      }
      
      // Securely wipe libp2p Ed25519 private key bytes
      if (this.privateKey) {
        // Access the raw bytes of the Ed25519 private key and wipe them
        const privateKeyBytes = this.privateKey.bytes;
        if (privateKeyBytes) {
          secureWipe(privateKeyBytes);
        }
      }
      
      // Clear all identity data from memory
      this.peerId = null;
      this.privateKey = null;
      this.e2eePublicKey = null;
      this.e2eePrivateKey = null;
      this.createdAt = null;
      
      this.logger.warn('Identity deleted and memory cleared');
      return success(undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return success(undefined);
      }
      return failureFromError('IDENTITY_DELETE_FAILED', 'Failed to delete identity', error as Error);
    }
  }
}