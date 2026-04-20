/**
 * Tests for Challenge-Response Authentication - RFC008 Implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateChallenge,
  signChallenge,
  verifyChallengeResponse,
  ChallengeStore,
  verifyChallengeResponseWithStore
} from './challenge.js';
import { AgentIdentityKeypair } from './agent-keypair.js';

describe('Challenge', () => {
  describe('generateChallenge', () => {
    it('should generate a valid challenge with default expiry', () => {
      const challenge = generateChallenge('send_message');

      expect(challenge.challenge).toBeDefined();
      expect(challenge.timestamp).toBeDefined();
      expect(challenge.operation).toBe('send_message');
      expect(challenge.expiresInSeconds).toBe(30);

      // Challenge should be Base64 encoded 32 bytes (256 bits)
      const challengeBytes = Buffer.from(challenge.challenge, 'base64');
      expect(challengeBytes.length).toBe(32);
    });

    it('should generate a valid challenge with custom expiry', () => {
      const challenge = generateChallenge('update_webhook', 60);

      expect(challenge.operation).toBe('update_webhook');
      expect(challenge.expiresInSeconds).toBe(60);
    });

    it('should generate unique challenges each time', () => {
      const challenge1 = generateChallenge('test');
      const challenge2 = generateChallenge('test');

      expect(challenge1.challenge).not.toBe(challenge2.challenge);
    });

    it('should generate valid ISO 8601 timestamp', () => {
      const challenge = generateChallenge('test');
      const date = new Date(challenge.timestamp);

      expect(isNaN(date.getTime())).toBe(false);
    });
  });

  describe('signChallenge', () => {
    it('should sign a challenge correctly', () => {
      const keypair = new AgentIdentityKeypair().generateKeypair();
      const challenge = generateChallenge('send_message');

      const response = signChallenge(challenge, keypair.privateKey);

      expect(response.signature).toBeDefined();
      expect(response.publicKey).toBe(keypair.publicKey);

      // Signature should be 64 bytes (Ed25519), Base64 encoded
      const signatureBytes = Buffer.from(response.signature, 'base64');
      expect(signatureBytes.length).toBe(64);
    });

    it('should produce verifiable signature', () => {
      const keypair = new AgentIdentityKeypair().generateKeypair();
      const challenge = generateChallenge('test');

      const response = signChallenge(challenge, keypair.privateKey);

      // Verify signature manually
      const challengeData = `${challenge.challenge}:${challenge.timestamp}:${challenge.operation}`;
      const isValid = AgentIdentityKeypair.verify(
        response.signature,
        challengeData,
        response.publicKey
      );

      expect(isValid).toBe(true);
    });
  });

  describe('verifyChallengeResponse', () => {
    it('should verify a valid challenge response', () => {
      const keypair = new AgentIdentityKeypair().generateKeypair();
      const challenge = generateChallenge('send_message');
      const response = signChallenge(challenge, keypair.privateKey);
      const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

      const result = verifyChallengeResponse(agentId, challenge, response);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid challenge format', () => {
      const keypair = new AgentIdentityKeypair().generateKeypair();
      const challenge = generateChallenge('send_message');
      const response = signChallenge(challenge, keypair.privateKey);
      const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

      // Invalid challenge with missing fields
      const invalidChallenge = { ...challenge, challenge: '' };
      const result = verifyChallengeResponse(agentId, invalidChallenge as any, response);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_CHALLENGE');
    });

    it('should reject expired challenge', () => {
      const keypair = new AgentIdentityKeypair().generateKeypair();
      const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

      // Create an expired challenge (expired 100 seconds ago)
      const expiredChallenge = {
        challenge: Buffer.from('test-challenge-data').toString('base64'),
        timestamp: new Date(Date.now() - 100000).toISOString(),
        expiresInSeconds: 1,
        operation: 'test'
      };

      const response = signChallenge(expiredChallenge, keypair.privateKey);
      const result = verifyChallengeResponse(agentId, expiredChallenge, response);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('EXPIRED');
    });

    it('should reject invalid timestamp', () => {
      const keypair = new AgentIdentityKeypair().generateKeypair();
      const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

      const invalidChallenge = {
        challenge: Buffer.from('test-challenge-data').toString('base64'),
        timestamp: 'invalid-timestamp',
        expiresInSeconds: 30,
        operation: 'test'
      };

      const response = signChallenge(invalidChallenge, keypair.privateKey);
      const result = verifyChallengeResponse(agentId, invalidChallenge, response);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_CHALLENGE');
    });

    it('should reject fingerprint mismatch', () => {
      const keypair1 = new AgentIdentityKeypair().generateKeypair();
      const keypair2 = new AgentIdentityKeypair().generateKeypair();
      const challenge = generateChallenge('test');
      const response = signChallenge(challenge, keypair1.privateKey);

      // Use different agentId
      const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair2.publicKey)}`;
      const result = verifyChallengeResponse(agentId, challenge, response);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('FINGERPRINT_MISMATCH');
    });

    it('should reject invalid signature', () => {
      const keypair1 = new AgentIdentityKeypair().generateKeypair();
      const keypair2 = new AgentIdentityKeypair().generateKeypair();
      const challenge = generateChallenge('test');

      // Sign with different key
      const response = signChallenge(challenge, keypair1.privateKey);
      const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair2.publicKey)}`;

      // Update public key to mismatch
      const responseWithWrongKey = {
        signature: response.signature,
        publicKey: keypair2.publicKey
      };

      const result = verifyChallengeResponse(agentId, challenge, responseWithWrongKey);

      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_SIGNATURE');
    });
  });
});

describe('ChallengeStore', () => {
  let store: ChallengeStore;

  beforeEach(() => {
    store = new ChallengeStore();
  });

  afterEach(() => {
    store.stopAutoCleanup();
    store.clear();
  });

  describe('store', () => {
    it('should store a challenge and return challenge ID', () => {
      const challenge = generateChallenge('test');
      const id = store.store(challenge);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id).toBe(challenge.challenge); // ID should be the challenge data
    });

    it('should store multiple challenges', () => {
      const challenge1 = generateChallenge('test1');
      const challenge2 = generateChallenge('test2');

      const id1 = store.store(challenge1);
      const id2 = store.store(challenge2);

      expect(id1).not.toBe(id2);
      expect(store.size()).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for stored challenge', () => {
      const challenge = generateChallenge('test');
      store.store(challenge);

      expect(store.has(challenge)).toBe(true);
    });

    it('should return false for unknown challenge', () => {
      const challenge = generateChallenge('test');

      expect(store.has(challenge)).toBe(false);
    });
  });

  describe('isUsed', () => {
    it('should return false for newly stored challenge', () => {
      const challenge = generateChallenge('test');
      store.store(challenge);

      expect(store.isUsed(challenge)).toBe(false);
    });

    it('should return true after verification', () => {
      const challenge = generateChallenge('test');
      store.store(challenge);
      store.verifyAndConsume(challenge);

      expect(store.isUsed(challenge)).toBe(true);
    });

    it('should return false for unknown challenge', () => {
      const challenge = generateChallenge('test');

      expect(store.isUsed(challenge)).toBe(false);
    });
  });

  describe('verifyAndConsume', () => {
    it('should return true and mark challenge as used', () => {
      const challenge = generateChallenge('test');
      store.store(challenge);

      const result = store.verifyAndConsume(challenge);

      expect(result).toBe(true);
      expect(store.isUsed(challenge)).toBe(true);
    });

    it('should return false for unknown challenge', () => {
      const challenge = generateChallenge('test');

      const result = store.verifyAndConsume(challenge);

      expect(result).toBe(false);
    });

    it('should return false for already used challenge (replay attack)', () => {
      const challenge = generateChallenge('test');
      store.store(challenge);

      // First use
      const result1 = store.verifyAndConsume(challenge);
      expect(result1).toBe(true);

      // Replay attack
      const result2 = store.verifyAndConsume(challenge);
      expect(result2).toBe(false);
    });

    it('should return false for expired challenge', async () => {
      // Create a challenge with very short expiry (1 second)
      const expiredChallenge = {
        challenge: Buffer.from('expired-challenge').toString('base64'),
        timestamp: new Date().toISOString(),
        expiresInSeconds: 0.001, // 1ms expiry
        operation: 'test'
      };

      store.store(expiredChallenge);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = store.verifyAndConsume(expiredChallenge);

      expect(result).toBe(false);
      // Expired challenge should be removed
      expect(store.has(expiredChallenge)).toBe(false);
    });
  });

  describe('cleanupExpired', () => {
    it('should remove expired challenges', async () => {
      // Create an expired challenge (very short expiry)
      const expiredChallenge = {
        challenge: Buffer.from('expired').toString('base64'),
        timestamp: new Date().toISOString(),
        expiresInSeconds: 0.001, // 1ms expiry
        operation: 'test'
      };

      // Create valid challenge (long expiry)
      const validChallenge = generateChallenge('valid', 300);

      store.store(expiredChallenge);
      store.store(validChallenge);

      expect(store.size()).toBe(2);

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 10));

      const cleaned = store.cleanupExpired();

      expect(cleaned).toBe(1);
      expect(store.size()).toBe(1);
      expect(store.has(validChallenge)).toBe(true);
    });
  });

  describe('size and clear', () => {
    it('should track size correctly', () => {
      expect(store.size()).toBe(0);

      const challenge1 = generateChallenge('test1');
      const challenge2 = generateChallenge('test2');

      store.store(challenge1);
      expect(store.size()).toBe(1);

      store.store(challenge2);
      expect(store.size()).toBe(2);
    });

    it('should clear all challenges', () => {
      store.store(generateChallenge('test1'));
      store.store(generateChallenge('test2'));

      expect(store.size()).toBe(2);

      store.clear();

      expect(store.size()).toBe(0);
    });
  });

  describe('auto cleanup', () => {
    it('should start and stop auto cleanup', () => {
      store.startAutoCleanup(1000);
      store.stopAutoCleanup();
      // No error means success
    });

    it('should replace existing cleanup interval', () => {
      store.startAutoCleanup(1000);
      store.startAutoCleanup(2000);
      store.stopAutoCleanup();
      // No error means success
    });
  });
});

describe('verifyChallengeResponseWithStore', () => {
  let store: ChallengeStore;

  beforeEach(() => {
    store = new ChallengeStore();
  });

  afterEach(() => {
    store.stopAutoCleanup();
    store.clear();
  });

  it('should verify a valid challenge response with store', () => {
    const keypair = new AgentIdentityKeypair().generateKeypair();
    const challenge = generateChallenge('send_message');
    const response = signChallenge(challenge, keypair.privateKey);
    const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

    // Store the challenge first
    store.store(challenge);

    const result = verifyChallengeResponseWithStore(store, agentId, challenge, response);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();

    // Challenge should be marked as used
    expect(store.isUsed(challenge)).toBe(true);
  });

  it('should reject when challenge not found in store', () => {
    const keypair = new AgentIdentityKeypair().generateKeypair();
    const challenge = generateChallenge('send_message');
    const response = signChallenge(challenge, keypair.privateKey);
    const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

    // Don't store the challenge
    const result = verifyChallengeResponseWithStore(store, agentId, challenge, response);

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('REPLAY_ATTACK');
    expect(result.error).toContain('not found');
  });

  it('should reject when challenge already used (replay attack)', () => {
    const keypair = new AgentIdentityKeypair().generateKeypair();
    const challenge = generateChallenge('send_message');
    const response = signChallenge(challenge, keypair.privateKey);
    const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

    // Store and use the challenge
    store.store(challenge);
    store.verifyAndConsume(challenge);

    // Try to use again
    const result = verifyChallengeResponseWithStore(store, agentId, challenge, response);

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('REPLAY_ATTACK');
    expect(result.error).toContain('already used');
  });

  it('should reject invalid signature even if challenge is stored', () => {
    const keypair1 = new AgentIdentityKeypair().generateKeypair();
    const keypair2 = new AgentIdentityKeypair().generateKeypair();
    const challenge = generateChallenge('send_message');

    // Sign with keypair1
    const response = signChallenge(challenge, keypair1.privateKey);

    // Use keypair2's agentId
    const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair2.publicKey)}`;

    // Store the challenge
    store.store(challenge);

    const result = verifyChallengeResponseWithStore(
      store,
      agentId,
      challenge,
      { signature: response.signature, publicKey: keypair1.publicKey }
    );

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('FINGERPRINT_MISMATCH');

    // Challenge should NOT be marked as used
    expect(store.isUsed(challenge)).toBe(false);
  });

  it('should not mark challenge as used on signature verification failure', () => {
    const keypair = new AgentIdentityKeypair().generateKeypair();
    const challenge = generateChallenge('send_message');

    // Create an invalid signature
    const response = {
      signature: Buffer.from('invalid-signature').toString('base64'),
      publicKey: keypair.publicKey
    };
    const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

    // Store the challenge
    store.store(challenge);

    const result = verifyChallengeResponseWithStore(store, agentId, challenge, response);

    expect(result.valid).toBe(false);

    // Challenge should NOT be marked as used
    expect(store.isUsed(challenge)).toBe(false);
  });

  it('should handle expired challenge in store', () => {
    const keypair = new AgentIdentityKeypair().generateKeypair();
    const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

    // Create an expired challenge
    const expiredChallenge = {
      challenge: Buffer.from('expired-challenge-data').toString('base64'),
      timestamp: new Date(Date.now() - 100000).toISOString(),
      expiresInSeconds: 1,
      operation: 'test'
    };

    const response = signChallenge(expiredChallenge, keypair.privateKey);

    // Store the expired challenge
    store.store(expiredChallenge);

    const result = verifyChallengeResponseWithStore(store, agentId, expiredChallenge, response);

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('EXPIRED');
  });

  it('should work with complete flow (store, sign, verify, consume)', () => {
    const keypair = new AgentIdentityKeypair().generateKeypair();
    const agentId = `agent:${AgentIdentityKeypair.computeFingerprint(keypair.publicKey)}`;

    // 1. Server generates and stores challenge
    const challenge = generateChallenge('send_message');
    store.store(challenge);
    expect(store.has(challenge)).toBe(true);

    // 2. Client signs the challenge
    const response = signChallenge(challenge, keypair.privateKey);

    // 3. Server verifies the response with store
    const result = verifyChallengeResponseWithStore(store, agentId, challenge, response);
    expect(result.valid).toBe(true);

    // 4. Challenge should be marked as used
    expect(store.isUsed(challenge)).toBe(true);

    // 5. Attempting to reuse should fail (replay attack)
    const result2 = verifyChallengeResponseWithStore(store, agentId, challenge, response);
    expect(result2.valid).toBe(false);
    expect(result2.errorCode).toBe('REPLAY_ATTACK');
  });
});