/**
 * Encrypted key store
 * Provides AES-256-GCM encryption and decryption functionality
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { PersistedIdentity, EncryptedIdentity } from './types.js';
import { AES_KEY_SIZE, AES_IV_SIZE, SCRYPT_N, SCRYPT_R, SCRYPT_P, SALT_SIZE } from './types.js';

/**
 * Validate if a string is valid base64
 * P3 修复：添加 base64 格式验证
 */
function isValidBase64(str: string): boolean {
  if (typeof str !== 'string' || str.length === 0) {
    return false;
  }
  // Base64 regex: allows A-Z, a-z, 0-9, +, /, and optional = padding
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str);
}

/**
 * Encrypt identity data
 * 
 * Security note: Uses scrypt with N=16384 for key derivation,
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
  
  // P6 修复：安全清零 scrypt 派生密钥
  key.fill(0);
  
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
  // P3 修复：验证 base64 格式
  if (!isValidBase64(encrypted.salt)) {
    throw new Error('Invalid salt: not valid base64');
  }
  if (!isValidBase64(encrypted.iv)) {
    throw new Error('Invalid iv: not valid base64');
  }
  if (!isValidBase64(encrypted.authTag)) {
    throw new Error('Invalid authTag: not valid base64');
  }
  if (typeof encrypted.ciphertext !== 'string' || encrypted.ciphertext.length === 0) {
    throw new Error('Invalid ciphertext: empty or not a string');
  }
  
  const salt = Buffer.from(encrypted.salt, 'base64');
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  
  // Derive key using scrypt with secure parameters
  const key = scryptSync(password, salt, AES_KEY_SIZE, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf-8');
    plaintext += decipher.final('utf-8');
    
    return JSON.parse(plaintext);
  } finally {
    // P6 修复：安全清零 scrypt 派生密钥
    key.fill(0);
  }
}