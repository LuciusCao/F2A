/**
 * Encrypted key store
 * Provides AES-256-GCM encryption and decryption functionality
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { PersistedIdentity, EncryptedIdentity } from './types.js';
import { AES_KEY_SIZE, AES_IV_SIZE, SCRYPT_N, SCRYPT_R, SCRYPT_P, SALT_SIZE } from './types.js';

/**
 * Encrypt identity data
 * 
 * Security note: Uses scrypt with N=32768 for key derivation,
 * which provides strong resistance against brute-force attacks.
 */
export function encryptIdentity(
  identity: PersistedIdentity, 
  password: string
): EncryptedIdentity {
  // Generate random salt
  const salt = randomBytes(SALT_SIZE);
  // Derive key using scrypt with secure parameters
  const key = scryptSync(password, salt, AES_KEY_SIZE, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  // Generate random IV
  const iv = randomBytes(AES_IV_SIZE);
  
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(identity);
  
  let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
  ciphertext += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: true,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext
  };
}

/**
 * Decrypt identity data
 * 
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export function decryptIdentity(
  encrypted: EncryptedIdentity, 
  password: string
): PersistedIdentity {
  const salt = Buffer.from(encrypted.salt, 'base64');
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  
  // Derive key using scrypt with secure parameters
  const key = scryptSync(password, salt, AES_KEY_SIZE, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf-8');
  plaintext += decipher.final('utf-8');
  
  return JSON.parse(plaintext);
}