/**
 * Tests for AgentIdentityKeypair
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentityKeypair } from './agent-keypair.js';

describe('AgentIdentityKeypair', () => {
  const keypair = new AgentIdentityKeypair();

  describe('generateKeypair', () => {
    it('should generate a valid Ed25519 keypair', () => {
      const kp = keypair.generateKeypair();

      expect(kp.privateKey).toBeDefined();
      expect(kp.publicKey).toBeDefined();
      expect(typeof kp.privateKey).toBe('string');
      expect(typeof kp.publicKey).toBe('string');

      // Decode and check sizes
      const privateKeyBytes = Buffer.from(kp.privateKey, 'base64');
      const publicKeyBytes = Buffer.from(kp.publicKey, 'base64');

      expect(privateKeyBytes.length).toBe(32); // Ed25519 seed is 32 bytes
      expect(publicKeyBytes.length).toBe(32); // Ed25519 public key is 32 bytes
    });

    it('should generate unique keypairs each time', () => {
      const kp1 = keypair.generateKeypair();
      const kp2 = keypair.generateKeypair();

      expect(kp1.privateKey).not.toBe(kp2.privateKey);
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
    });
  });

  describe('computeFingerprint', () => {
    it('should compute a 16-character hex fingerprint from public key', () => {
      const kp = keypair.generateKeypair();
      const fingerprint = keypair.computeFingerprint(kp.publicKey);

      expect(fingerprint).toBeDefined();
      expect(typeof fingerprint).toBe('string');
      expect(fingerprint.length).toBe(16);
      expect(/^[0-9a-f]+$/.test(fingerprint)).toBe(true);
    });

    it('should compute same fingerprint for same public key', () => {
      const kp = keypair.generateKeypair();
      const fp1 = keypair.computeFingerprint(kp.publicKey);
      const fp2 = keypair.computeFingerprint(kp.publicKey);

      expect(fp1).toBe(fp2);
    });

    it('should work with Uint8Array public key', () => {
      const kp = keypair.generateKeypair();
      const publicKeyBytes = Buffer.from(kp.publicKey, 'base64');
      const fingerprint = keypair.computeFingerprint(publicKeyBytes);

      expect(fingerprint.length).toBe(16);
    });
  });

  describe('computeAgentId', () => {
    it('should compute AgentId with correct format', () => {
      const kp = keypair.generateKeypair();
      const agentId = keypair.computeAgentId(kp.publicKey);

      expect(agentId).toMatch(/^agent:[0-9a-f]{16}$/);
    });

    it('should compute same AgentId for same public key', () => {
      const kp = keypair.generateKeypair();
      const agentId1 = keypair.computeAgentId(kp.publicKey);
      const agentId2 = keypair.computeAgentId(kp.publicKey);

      expect(agentId1).toBe(agentId2);
    });
  });

  describe('sign and verify', () => {
    it('should sign data and verify signature correctly', () => {
      const kp = keypair.generateKeypair();
      const data = 'test message';

      const signature = keypair.sign(data, kp.privateKey);
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');

      // Signature should be 64 bytes (Ed25519), Base64 encoded
      const signatureBytes = Buffer.from(signature, 'base64');
      expect(signatureBytes.length).toBe(64);

      // Verify signature
      const isValid = keypair.verify(signature, data, kp.publicKey);
      expect(isValid).toBe(true);
    });

    it('should work with Uint8Array data', () => {
      const kp = keypair.generateKeypair();
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const signature = keypair.sign(data, kp.privateKey);
      const isValid = keypair.verify(signature, data, kp.publicKey);

      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong public key', () => {
      const kp1 = keypair.generateKeypair();
      const kp2 = keypair.generateKeypair();
      const data = 'test message';

      const signature = keypair.sign(data, kp1.privateKey);
      const isValid = keypair.verify(signature, data, kp2.publicKey);

      expect(isValid).toBe(false);
    });

    it('should fail verification with wrong data', () => {
      const kp = keypair.generateKeypair();
      const signature = keypair.sign('original data', kp.privateKey);
      const isValid = keypair.verify(signature, 'different data', kp.publicKey);

      expect(isValid).toBe(false);
    });

    it('should fail verification with wrong signature', () => {
      const kp = keypair.generateKeypair();
      const signature = keypair.sign('original data', kp.privateKey);
      const tamperedSignature = signature.slice(0, -10) + 'AAAAAAAAAA';
      const isValid = keypair.verify(tamperedSignature, 'original data', kp.publicKey);

      expect(isValid).toBe(false);
    });
  });

  describe('validateAgentId', () => {
    it('should validate correct AgentId', () => {
      const kp = keypair.generateKeypair();
      const agentId = keypair.computeAgentId(kp.publicKey);
      const isValid = keypair.validateAgentId(agentId, kp.publicKey);

      expect(isValid).toBe(true);
    });

    it('should reject invalid AgentId format', () => {
      const kp = keypair.generateKeypair();
      const isValid = keypair.validateAgentId('invalid-id', kp.publicKey);

      expect(isValid).toBe(false);
    });

    it('should reject mismatched AgentId', () => {
      const kp1 = keypair.generateKeypair();
      const kp2 = keypair.generateKeypair();
      const agentId = keypair.computeAgentId(kp1.publicKey);
      const isValid = keypair.validateAgentId(agentId, kp2.publicKey);

      expect(isValid).toBe(false);
    });
  });

  describe('derivePublicKey', () => {
    it('should derive correct public key from private key', () => {
      const kp = keypair.generateKeypair();
      const derivedPublicKey = keypair.derivePublicKey(kp.privateKey);

      expect(derivedPublicKey).toBe(kp.publicKey);
    });
  });

  describe('createIdentityFile', () => {
    it('should create valid RFC008 identity file structure', () => {
      const kp = keypair.generateKeypair();
      const identityFile = keypair.createIdentityFile(kp, {
        name: 'Test Agent',
        capabilities: [{ name: 'chat', version: '1.0.0' }]
      });

      expect(identityFile.agentId).toMatch(/^agent:[0-9a-f]{16}$/);
      expect(identityFile.publicKey).toBe(kp.publicKey);
      expect(identityFile.privateKey).toBe(kp.privateKey);
      expect(identityFile.privateKeyEncrypted).toBe(false);
      expect(identityFile.name).toBe('Test Agent');
      expect(identityFile.capabilities).toHaveLength(1);
      expect(identityFile.createdAt).toBeDefined();
      expect(identityFile.lastActiveAt).toBeDefined();
    });

    it('should create identity file with node signature', () => {
      const kp = keypair.generateKeypair();
      const identityFile = keypair.createIdentityFile(kp, {
        nodeSignature: 'base64-encoded-signature',
        nodePeerId: '12D3KooWTest'
      });

      expect(identityFile.nodeSignature).toBe('base64-encoded-signature');
      expect(identityFile.nodePeerId).toBe('12D3KooWTest');
    });
  });

  describe('static methods', () => {
    it('should work with static generateKeypair', () => {
      const kp = AgentIdentityKeypair.generateKeypair();
      expect(kp.privateKey).toBeDefined();
      expect(kp.publicKey).toBeDefined();
    });

    it('should work with static computeFingerprint', () => {
      const kp = AgentIdentityKeypair.generateKeypair();
      const fingerprint = AgentIdentityKeypair.computeFingerprint(kp.publicKey);
      expect(fingerprint.length).toBe(16);
    });

    it('should work with static sign and verify', () => {
      const kp = AgentIdentityKeypair.generateKeypair();
      const signature = AgentIdentityKeypair.sign('test', kp.privateKey);
      const isValid = AgentIdentityKeypair.verify(signature, 'test', kp.publicKey);
      expect(isValid).toBe(true);
    });
  });

  describe('cross-compatibility', () => {
    it('should be compatible with Ed25519Signer', async () => {
      // Generate keypair with AgentIdentityKeypair
      const kp = keypair.generateKeypair();

      // Sign with AgentIdentityKeypair
      const signature = keypair.sign('test message', kp.privateKey);

      // Import Ed25519Signer for verification
      const { Ed25519Signer } = await import('./ed25519-signer.js');
      const signer = Ed25519Signer.fromPublicKey(kp.publicKey);

      // Verify with Ed25519Signer
      const isValid = await signer.verify('test message', signature);
      expect(isValid).toBe(true);
    });

    it('should verify Ed25519Signer signatures', async () => {
      // Import Ed25519Signer
      const { Ed25519Signer } = await import('./ed25519-signer.js');

      // Create signer and generate signature
      const signer = new Ed25519Signer();
      const signature = signer.signSync('test message');
      const publicKey = signer.getPublicKey();

      // Verify with AgentIdentityKeypair
      const isValid = keypair.verify(signature, 'test message', publicKey);
      expect(isValid).toBe(true);
    });
  });
});