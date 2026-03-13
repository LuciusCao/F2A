/**
 * 加密密钥存储
 * 提供 AES-256-GCM 加密和解密功能
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { PersistedIdentity, EncryptedIdentity } from './types.js';
import { AES_KEY_SIZE, AES_IV_SIZE } from './types.js';

/**
 * 加密身份数据
 */
export async function encryptIdentity(
  identity: PersistedIdentity, 
  password: string
): Promise<EncryptedIdentity> {
  // 生成随机盐值
  const salt = randomBytes(16);
  // 使用 scrypt 派生密钥
  const key = scryptSync(password, salt, AES_KEY_SIZE);
  // 生成随机 IV
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
 * 解密身份数据
 */
export async function decryptIdentity(
  encrypted: EncryptedIdentity, 
  password: string
): Promise<PersistedIdentity> {
  const salt = Buffer.from(encrypted.salt, 'base64');
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  
  // 使用 scrypt 派生密钥
  const key = scryptSync(password, salt, AES_KEY_SIZE);
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf-8');
  plaintext += decipher.final('utf-8');
  
  return JSON.parse(plaintext);
}