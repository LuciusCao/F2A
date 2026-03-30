/**
 * Shared type guards for F2A
 */

import type { F2AMessage } from '../types/index.js';
import type { EncryptedMessage } from '../core/e2ee-crypto.js';

/**
 * Encrypted F2A message - extends F2AMessage with encrypted payload
 */
export interface EncryptedF2AMessage extends F2AMessage {
  encrypted: true;
  payload: EncryptedMessage;
}

/**
 * Type guard to check if a message is encrypted
 */
export function isEncryptedMessage(msg: F2AMessage): msg is EncryptedF2AMessage {
  return 'encrypted' in msg && msg.encrypted === true && 'payload' in msg;
}