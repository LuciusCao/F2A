/**
 * RFC011: Agent Identity Verification Chain 测试
 * 
 * 测试签名验证链：
 * - Self-Signature 验证
 * - Node-Signature 验证
 * - 完整身份验证
 */

import { describe, it, expect } from 'vitest';
import {
  createSelfSignaturePayload,
  createNodeSignaturePayload,
  signSelfSignature,
  signNodeSignature,
  verifySelfSignature,
  verifyNodeSignature,
  verifyNodeSignatureRaw,
  verifyAgentIdentity,
  generateIdentityKeyPair,
  computeAgentId,
  encodeBase64,
  decodeBase64
} from './identity-signature.js';
import { sha256 } from '@noble/hashes/sha256';
import { ed25519 } from '@noble/curves/ed25519.js';

describe('RFC011: Identity Signature Utils', () => {
  // ============================================================================
  // Payload Creation Tests
  // ============================================================================

  describe('createSelfSignaturePayload', () => {
    it('should create correct payload format', () => {
      const agentId = 'agent:test123';
      const publicKey = 'dGVzdC1wdWJsaWMta2V5';
      
      const payload = createSelfSignaturePayload(agentId, publicKey);
      
      // Verify payload is SHA256 hash (32 bytes)
      expect(payload.length).toBe(32);
      
      // Verify it matches manual calculation
      const expectedPayload = `${agentId}:${publicKey}`;
      const expectedHash = sha256(Buffer.from(expectedPayload, 'utf-8'));
      expect(payload).toEqual(expectedHash);
    });

    it('should produce different payloads for different inputs', () => {
      const payload1 = createSelfSignaturePayload('agent:abc', 'key1');
      const payload2 = createSelfSignaturePayload('agent:xyz', 'key1');
      const payload3 = createSelfSignaturePayload('agent:abc', 'key2');
      
      expect(payload1).not.toEqual(payload2);
      expect(payload1).not.toEqual(payload3);
      expect(payload2).not.toEqual(payload3);
    });
  });

  describe('createNodeSignaturePayload', () => {
    it('should create correct payload format', () => {
      const agentId = 'agent:test123';
      const publicKey = 'dGVzdC1wdWJsaWMta2V5';
      const nodeId = 'node-abc123';
      
      const payload = createNodeSignaturePayload(agentId, publicKey, nodeId);
      
      // Verify payload is SHA256 hash (32 bytes)
      expect(payload.length).toBe(32);
      
      // Verify it matches manual calculation
      const expectedPayload = `${agentId}:${publicKey}:${nodeId}`;
      const expectedHash = sha256(Buffer.from(expectedPayload, 'utf-8'));
      expect(payload).toEqual(expectedHash);
    });

    it('should produce different payloads for different nodeIds', () => {
      const payload1 = createNodeSignaturePayload('agent:abc', 'key', 'node1');
      const payload2 = createNodeSignaturePayload('agent:abc', 'key', 'node2');
      
      expect(payload1).not.toEqual(payload2);
    });
  });

  // ============================================================================
  // Key Generation Tests
  // ============================================================================

  describe('generateIdentityKeyPair', () => {
    it('should generate valid Ed25519 key pair', () => {
      const keyPair = generateIdentityKeyPair();
      
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      
      // Verify base64 encoding
      const publicKeyBytes = decodeBase64(keyPair.publicKey);
      const privateKeyBytes = decodeBase64(keyPair.privateKey);
      
      // Ed25519 public key is 32 bytes, private key seed is 32 bytes
      expect(publicKeyBytes.length).toBe(32);
      expect(privateKeyBytes.length).toBe(32);
      
      // Verify public key matches private key
      const derivedPublicKey = ed25519.getPublicKey(privateKeyBytes);
      expect(Buffer.from(derivedPublicKey)).toEqual(Buffer.from(publicKeyBytes));
    });

    it('should generate different key pairs each time', () => {
      const keyPair1 = generateIdentityKeyPair();
      const keyPair2 = generateIdentityKeyPair();
      
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
    });
  });

  describe('computeAgentId', () => {
    it('should compute agent ID in correct format', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      
      // Should be "agent:<16位指纹>" format
      expect(agentId).toMatch(/^agent:[A-Za-z0-9+/]+=*$/);
    });

    it('should produce same agent ID for same public key', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId1 = computeAgentId(keyPair.publicKey);
      const agentId2 = computeAgentId(keyPair.publicKey);
      
      expect(agentId1).toBe(agentId2);
    });

    it('should produce different agent IDs for different public keys', () => {
      const keyPair1 = generateIdentityKeyPair();
      const keyPair2 = generateIdentityKeyPair();
      
      const agentId1 = computeAgentId(keyPair1.publicKey);
      const agentId2 = computeAgentId(keyPair2.publicKey);
      
      expect(agentId1).not.toBe(agentId2);
    });
  });

  // ============================================================================
  // Self Signature Tests
  // ============================================================================

  describe('signSelfSignature', () => {
    it('should create valid self-signature', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      
      const signature = signSelfSignature(agentId, keyPair.publicKey, keyPair.privateKey);
      
      // Signature should be base64 encoded
      expect(signature).toBeDefined();
      const signatureBytes = decodeBase64(signature);
      expect(signatureBytes.length).toBe(64); // Ed25519 signature is 64 bytes
    });

    it('should create signature that can be verified', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      
      const signature = signSelfSignature(agentId, keyPair.publicKey, keyPair.privateKey);
      
      const isValid = verifySelfSignature(agentId, keyPair.publicKey, signature);
      expect(isValid).toBe(true);
    });
  });

  describe('verifySelfSignature', () => {
    it('should return true for valid signature', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      const signature = signSelfSignature(agentId, keyPair.publicKey, keyPair.privateKey);
      
      expect(verifySelfSignature(agentId, keyPair.publicKey, signature)).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      
      // Wrong signature
      const wrongSignature = encodeBase64(ed25519.utils.randomSecretKey());
      
      expect(verifySelfSignature(agentId, keyPair.publicKey, wrongSignature)).toBe(false);
    });

    it('should return false for tampered public key', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      const signature = signSelfSignature(agentId, keyPair.publicKey, keyPair.privateKey);
      
      // Tampered agent ID (computed from different key)
      const otherKeyPair = generateIdentityKeyPair();
      const wrongAgentId = computeAgentId(otherKeyPair.publicKey);
      
      expect(verifySelfSignature(wrongAgentId, keyPair.publicKey, signature)).toBe(false);
    });

    it('should return false for tampered agentId in payload', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      const signature = signSelfSignature(agentId, keyPair.publicKey, keyPair.privateKey);
      
      // Tampered agentId
      const tamperedAgentId = 'agent:tampered';
      
      expect(verifySelfSignature(tamperedAgentId, keyPair.publicKey, signature)).toBe(false);
    });

    it('should return false for signature with wrong key', () => {
      const keyPair1 = generateIdentityKeyPair();
      const keyPair2 = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair1.publicKey);
      
      // Sign with different key
      const signature = signSelfSignature(agentId, keyPair1.publicKey, keyPair2.privateKey);
      
      expect(verifySelfSignature(agentId, keyPair1.publicKey, signature)).toBe(false);
    });

    it('should return false for malformed inputs', () => {
      expect(verifySelfSignature('agent:abc', 'invalid-base64!', 'signature')).toBe(false);
      expect(verifySelfSignature('agent:abc', 'key', 'invalid-base64!')).toBe(false);
    });
  });

  // ============================================================================
  // Node Signature Tests
  // ============================================================================

  describe('signNodeSignature', () => {
    it('should create valid node-signature', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const signature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        nodeKeyPair.privateKey
      );
      
      // Signature should be base64 encoded
      expect(signature).toBeDefined();
      const signatureBytes = decodeBase64(signature);
      expect(signatureBytes.length).toBe(64); // Ed25519 signature is 64 bytes
    });

    it('should create signature that can be verified', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const signature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        nodeKeyPair.privateKey
      );
      
      const isValid = verifyNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        signature,
        nodeKeyPair.publicKey
      );
      expect(isValid).toBe(true);
    });
  });

  describe('verifyNodeSignature', () => {
    it('should return true for valid signature', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const signature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        nodeKeyPair.privateKey
      );
      
      expect(verifyNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        signature,
        nodeKeyPair.publicKey
      )).toBe(true);
    });

    it('should return false for invalid signature', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      // Wrong signature
      const wrongSignature = encodeBase64(ed25519.utils.randomSecretKey());
      
      expect(verifyNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        wrongSignature,
        nodeKeyPair.publicKey
      )).toBe(false);
    });

    it('should return false for wrong node public key', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const wrongNodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const signature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        nodeKeyPair.privateKey
      );
      
      expect(verifyNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        signature,
        wrongNodeKeyPair.publicKey
      )).toBe(false);
    });

    it('should return false for wrong nodeId', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const signature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        nodeKeyPair.privateKey
      );
      
      expect(verifyNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        'wrong-node-id',
        signature,
        nodeKeyPair.publicKey
      )).toBe(false);
    });

    it('verifyNodeSignatureRaw should work with Uint8Array public key', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const signature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        nodeKeyPair.privateKey
      );
      
      const nodePublicKeyRaw = decodeBase64(nodeKeyPair.publicKey);
      
      expect(verifyNodeSignatureRaw(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        signature,
        nodePublicKeyRaw
      )).toBe(true);
    });
  });

  // ============================================================================
  // Full Identity Verification Tests
  // ============================================================================

  describe('verifyAgentIdentity', () => {
    it('should return valid for identity with valid selfSignature', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      const selfSignature = signSelfSignature(agentId, keyPair.publicKey, keyPair.privateKey);
      
      const result = verifyAgentIdentity({
        agentId,
        publicKey: keyPair.publicKey,
        selfSignature
      });
      
      expect(result.valid).toBe(true);
      expect(result.details?.selfSignatureValid).toBe(true);
    });

    it('should return invalid for identity with invalid selfSignature', () => {
      const keyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(keyPair.publicKey);
      
      // Invalid signature
      const invalidSignature = encodeBase64(ed25519.utils.randomSecretKey());
      
      const result = verifyAgentIdentity({
        agentId,
        publicKey: keyPair.publicKey,
        selfSignature: invalidSignature
      });
      
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.details?.selfSignatureValid).toBe(false);
    });

    it('should verify both signatures when nodeSignature provided', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const selfSignature = signSelfSignature(agentId, agentKeyPair.publicKey, agentKeyPair.privateKey);
      const nodeSignature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        nodeKeyPair.privateKey
      );
      
      const result = verifyAgentIdentity(
        {
          agentId,
          publicKey: agentKeyPair.publicKey,
          selfSignature,
          nodeId,
          nodeSignature
        },
        nodeKeyPair.publicKey
      );
      
      expect(result.valid).toBe(true);
      expect(result.details?.selfSignatureValid).toBe(true);
      expect(result.details?.nodeSignatureValid).toBe(true);
    });

    it('should return invalid when nodeSignature is wrong', () => {
      const agentKeyPair = generateIdentityKeyPair();
      const nodeKeyPair = generateIdentityKeyPair();
      const wrongNodeKeyPair = generateIdentityKeyPair();
      const agentId = computeAgentId(agentKeyPair.publicKey);
      const nodeId = 'node-test-123';
      
      const selfSignature = signSelfSignature(agentId, agentKeyPair.publicKey, agentKeyPair.privateKey);
      const nodeSignature = signNodeSignature(
        agentId,
        agentKeyPair.publicKey,
        nodeId,
        wrongNodeKeyPair.privateKey  // Wrong key!
      );
      
      const result = verifyAgentIdentity(
        {
          agentId,
          publicKey: agentKeyPair.publicKey,
          selfSignature,
          nodeId,
          nodeSignature
        },
        nodeKeyPair.publicKey  // Different node key
      );
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('nodeSignature');
      expect(result.details?.selfSignatureValid).toBe(true);
      expect(result.details?.nodeSignatureValid).toBe(false);
    });
  });

  // ============================================================================
  // Utility Functions Tests
  // ============================================================================

  describe('encodeBase64 / decodeBase64', () => {
    it('should correctly encode and decode', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encoded = encodeBase64(data);
      const decoded = decodeBase64(encoded);
      
      // Buffer is compatible with Uint8Array for content comparison
      expect(Buffer.from(decoded)).toEqual(Buffer.from(data));
    });

    it('should handle empty data', () => {
      const data = new Uint8Array([]);
      const encoded = encodeBase64(data);
      const decoded = decodeBase64(encoded);
      
      expect(decoded.length).toBe(0);
    });
  });
});