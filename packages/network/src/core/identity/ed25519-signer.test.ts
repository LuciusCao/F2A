/**
 * Ed25519Signer 测试
 */

import { describe, it, expect } from 'vitest';
import { Ed25519Signer } from './ed25519-signer.js';

describe('Ed25519Signer', () => {
  describe('constructor', () => {
    it('should generate new key pair when no privateKey provided', () => {
      const signer = new Ed25519Signer();
      
      expect(signer.canSign()).toBe(true);
      expect(signer.canVerify()).toBe(true);
      expect(signer.getPublicKey().length).toBe(44); // Base64 encoded 32 bytes
    });

    it('should load existing key pair from privateKey', () => {
      // 先生成一个密钥对
      const originalSigner = new Ed25519Signer();
      const privateKey = originalSigner.getPrivateKey();
      
      // 从私钥加载
      const signer = new Ed25519Signer(privateKey);
      
      expect(signer.canSign()).toBe(true);
      expect(signer.canVerify()).toBe(true);
      expect(signer.getPublicKey()).toBe(originalSigner.getPublicKey());
    });
  });

  describe('fromPublicKey', () => {
    it('should create verifier from public key only', () => {
      const signer = new Ed25519Signer();
      const publicKey = signer.getPublicKey();
      
      const verifier = Ed25519Signer.fromPublicKey(publicKey);
      
      expect(verifier.canSign()).toBe(false);
      expect(verifier.canVerify()).toBe(true);
      expect(verifier.getPublicKey()).toBe(publicKey);
    });

    it('should throw when trying to sign without private key', async () => {
      const signer = new Ed25519Signer();
      const publicKey = signer.getPublicKey();
      
      const verifier = Ed25519Signer.fromPublicKey(publicKey);
      
      expect(() => verifier.getPrivateKey()).toThrow('No private key available');
      await expect(verifier.sign('test')).rejects.toThrow('No private key available for signing');
    });
  });

  describe('sign and verify', () => {
    it('should sign and verify data correctly', async () => {
      const signer = new Ed25519Signer();
      const data = 'test-data-123';
      
      const signature = await signer.sign(data);
      
      // 验证签名
      const isValid = await signer.verify(data, signature);
      expect(isValid).toBe(true);
      
      // 使用静态方法验证
      const isValidStatic = await Ed25519Signer.verifyWithPublicKey(
        data,
        signature,
        signer.getPublicKey()
      );
      expect(isValidStatic).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const signer = new Ed25519Signer();
      const data = 'test-data-123';
      
      const signature = await signer.sign(data);
      
      // 使用不同的数据验证
      const isValid = await signer.verify('different-data', signature);
      expect(isValid).toBe(false);
    });

    it('should reject signature from different key', async () => {
      const signer1 = new Ed25519Signer();
      const signer2 = new Ed25519Signer();
      const data = 'test-data-123';
      
      const signature = await signer1.sign(data);
      
      // 使用不同的公钥验证
      const isValid = await signer2.verify(data, signature);
      expect(isValid).toBe(false);
    });

    it('should verify signature from another instance with same public key', async () => {
      const signer = new Ed25519Signer();
      const data = 'test-data-123';
      
      const signature = await signer.sign(data);
      const publicKey = signer.getPublicKey();
      
      // 创建仅验证器
      const verifier = Ed25519Signer.fromPublicKey(publicKey);
      const isValid = await verifier.verify(data, signature);
      expect(isValid).toBe(true);
    });
  });

  describe('signSync', () => {
    it('should return Base64 encoded signature', () => {
      const signer = new Ed25519Signer();
      const data = 'test-data-sync';
      
      const signature = signer.signSync(data);
      
      // Base64 编码的签名应该是 88 字符（64字节 * 8/6 ≈ 88）
      expect(typeof signature).toBe('string');
      expect(signature.length).toBe(88);
      // 验证是否为有效的 Base64 字符串
      expect(() => Buffer.from(signature, 'base64')).not.toThrow();
    });

    it('should produce signature that can be verified', async () => {
      const signer = new Ed25519Signer();
      const data = 'test-data-to-verify';
      
      const signature = signer.signSync(data);
      
      // 使用实例方法验证
      const isValid = await signer.verify(data, signature);
      expect(isValid).toBe(true);
      
      // 使用静态方法验证
      const isValidStatic = await Ed25519Signer.verifyWithPublicKey(
        data,
        signature,
        signer.getPublicKey()
      );
      expect(isValidStatic).toBe(true);
    });

    it('should return same signature as sign()', async () => {
      const signer = new Ed25519Signer();
      const data = 'test-data-comparison';
      
      // sign() 内部调用 signSync()，所以应该返回相同的签名
      const syncSignature = signer.signSync(data);
      const asyncSignature = await signer.sign(data);
      
      expect(syncSignature).toBe(asyncSignature);
    });

    it('should throw when no private key available', () => {
      const signer = new Ed25519Signer();
      const publicKey = signer.getPublicKey();
      
      const verifier = Ed25519Signer.fromPublicKey(publicKey);
      
      expect(() => verifier.signSync('test')).toThrow('No private key available for signing');
    });
  });

  describe('generateKeyPair', () => {
    it('should generate unique key pairs', () => {
      const keyPair1 = Ed25519Signer.generateKeyPair();
      const keyPair2 = Ed25519Signer.generateKeyPair();
      
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
      
      // 密钥长度正确
      expect(keyPair1.privateKey.length).toBe(44); // Base64 encoded 32 bytes
      expect(keyPair1.publicKey.length).toBe(44);
    });
  });

  describe('cross-instance verification', () => {
    it('should verify signature across instances without shared secret', async () => {
      // 场景：模拟两个节点之间的验证
      // Node A: 签名
      const nodeA = new Ed25519Signer();
      const agentId = 'agent:12D3KooWABCDEF:a1b2c3d4';
      
      const signature = await nodeA.sign(agentId);
      const publicKey = nodeA.getPublicKey();
      
      // Node B: 验证（不需要共享密钥）
      // Node B 只需要公钥就可以验证签名
      const isValid = await Ed25519Signer.verifyWithPublicKey(
        agentId,
        signature,
        publicKey
      );
      expect(isValid).toBe(true);
      
      // 也可以使用实例方法
      const verifierB = Ed25519Signer.fromPublicKey(publicKey);
      const isValidInstance = await verifierB.verify(agentId, signature);
      expect(isValidInstance).toBe(true);
    });

    it('should work with agent-identity-verifier scenario', async () => {
      // 模拟 RFC 003 场景：
      // Agent A 发送消息，携带 Ed25519 公钥和签名
      // Agent B 验证签名（无需共享密钥）
      
      const agentA = new Ed25519Signer();
      const agentId = 'agent:12D3KooWPeer123:a1b2c3d4';
      
      // Agent A 签名 AgentId
      const signature = await agentA.sign(agentId);
      const ed25519PublicKey = agentA.getPublicKey();
      
      // Agent B 验证（使用静态方法，模拟跨节点）
      const isValid = await Ed25519Signer.verifyWithPublicKey(
        agentId,
        signature,
        ed25519PublicKey
      );
      
      expect(isValid).toBe(true);
      
      // 验证错误场景：篡改 agentId
      const tamperedId = 'agent:12D3KooWPeer123:hacked123';
      const isTamperedValid = await Ed25519Signer.verifyWithPublicKey(
        tamperedId,
        signature,
        ed25519PublicKey
      );
      expect(isTamperedValid).toBe(false);
    });
  });
});