/**
 * IdentityManager 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { IdentityManager } from './identity-manager.js';
import { unmarshalPrivateKey } from '@libp2p/crypto/keys';
import { createFromPrivKey } from '@libp2p/peer-id-factory';

describe('IdentityManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    // 创建临时目录用于测试
    tempDir = join(tmpdir(), `f2a-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('loadOrCreate', () => {
    it('should create new identity when none exists', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      const result = await manager.loadOrCreate();

      expect(result.success).toBe(true);
      if (!result.success) return;

      const identity = result.data;
      expect(identity.peerId).toBeDefined();
      expect(identity.peerId.startsWith('12D3Koo')).toBe(true); // Ed25519 PeerId 前缀
      expect(identity.privateKey).toBeDefined();
      expect(identity.e2eeKeyPair.publicKey).toBeDefined();
      expect(identity.e2eeKeyPair.privateKey).toBeDefined();
      expect(identity.createdAt).toBeInstanceOf(Date);
    });

    it('should load existing identity', async () => {
      // 首次创建
      const manager1 = new IdentityManager({ dataDir: tempDir });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);
      if (!result1.success) return;

      const peerId1 = result1.data.peerId;
      const e2eePublicKey1 = result1.data.e2eeKeyPair.publicKey;

      // 再次加载
      const manager2 = new IdentityManager({ dataDir: tempDir });
      const result2 = await manager2.loadOrCreate();
      expect(result2.success).toBe(true);
      if (!result2.success) return;

      expect(result2.data.peerId).toBe(peerId1);
      expect(result2.data.e2eeKeyPair.publicKey).toBe(e2eePublicKey1);
    });

    it('should create different identities for different directories', async () => {
      const dir1 = join(tempDir, 'identity1');
      const dir2 = join(tempDir, 'identity2');

      const manager1 = new IdentityManager({ dataDir: dir1 });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);

      const manager2 = new IdentityManager({ dataDir: dir2 });
      const result2 = await manager2.loadOrCreate();
      expect(result2.success).toBe(true);

      if (!result1.success || !result2.success) return;
      expect(result1.data.peerId).not.toBe(result2.data.peerId);
      expect(result1.data.e2eeKeyPair.publicKey).not.toBe(result2.data.e2eeKeyPair.publicKey);
    });
  });

  describe('password protection', () => {
    it('should encrypt identity with password', async () => {
      const manager = new IdentityManager({ 
        dataDir: tempDir, 
        password: 'secure-password-123' 
      });
      const result = await manager.loadOrCreate();

      expect(result.success).toBe(true);

      // 验证文件内容是加密的
      const identityFile = join(tempDir, 'identity.json');
      const content = await fs.readFile(identityFile, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.encrypted).toBe(true);
      expect(parsed.ciphertext).toBeDefined();
      expect(parsed.salt).toBeDefined();
      expect(parsed.iv).toBeDefined();
    });

    it('should decrypt identity with correct password', async () => {
      const password = 'secure-password-123';
      
      // 创建加密的身份
      const manager1 = new IdentityManager({ dataDir: tempDir, password });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);
      if (!result1.success) return;

      const peerId = result1.data.peerId;

      // 使用正确密码解密
      const manager2 = new IdentityManager({ dataDir: tempDir, password });
      const result2 = await manager2.loadOrCreate();
      expect(result2.success).toBe(true);
      if (!result2.success) return;

      expect(result2.data.peerId).toBe(peerId);
    });

    it('should fail to decrypt with wrong password', async () => {
      const password = 'correct-password';
      
      // 创建加密的身份
      const manager1 = new IdentityManager({ dataDir: tempDir, password });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);
      if (!result1.success) return;

      const originalPeerId = result1.data.peerId;

      // 使用错误密码尝试解密
      const manager2 = new IdentityManager({ dataDir: tempDir, password: 'wrong-password' });
      const result2 = await manager2.loadOrCreate();
      
      // P0-2/P1-1: 现在应该返回 IDENTITY_DECRYPT_FAILED 错误，而不是创建新身份
      expect(result2.success).toBe(false);
      if (result2.success) return;
      expect(result2.error.code).toBe('IDENTITY_DECRYPT_FAILED');
    });

    it('should return IDENTITY_PASSWORD_REQUIRED when encrypted file has no password', async () => {
      const password = 'secure-password';
      
      // 创建加密的身份
      const manager1 = new IdentityManager({ dataDir: tempDir, password });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);

      // 不提供密码尝试加载
      const manager2 = new IdentityManager({ dataDir: tempDir });
      const result2 = await manager2.loadOrCreate();
      
      // P0-2/P1-1: 应该返回 IDENTITY_PASSWORD_REQUIRED 错误
      expect(result2.success).toBe(false);
      if (result2.success) return;
      expect(result2.error.code).toBe('IDENTITY_PASSWORD_REQUIRED');
    });

    it('should load plaintext identity without password (backward compatible)', async () => {
      // 创建明文身份
      const manager1 = new IdentityManager({ dataDir: tempDir });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);
      if (!result1.success) return;

      const peerId = result1.data.peerId;

      // 不提供密码加载明文身份（向后兼容）
      const manager2 = new IdentityManager({ dataDir: tempDir });
      const result2 = await manager2.loadOrCreate();
      
      expect(result2.success).toBe(true);
      if (!result2.success) return;
      expect(result2.data.peerId).toBe(peerId);
    });
  });

  describe('exportIdentity', () => {
    it('should export identity correctly', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      const result = await manager.loadOrCreate();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const exported = manager.exportIdentity();
      
      expect(exported.peerId).toBe(result.data.peerId);
      expect(exported.privateKey).toBe(result.data.privateKey);
      expect(exported.e2eeKeyPair.publicKey).toBe(result.data.e2eeKeyPair.publicKey);
      expect(exported.e2eeKeyPair.privateKey).toBe(result.data.e2eeKeyPair.privateKey);
    });

    it('should throw error when identity not loaded', () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      expect(() => manager.exportIdentity()).toThrow('Identity not initialized');
    });
  });

  describe('getters', () => {
    it('should return null when identity not loaded', () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      
      expect(manager.getPeerId()).toBeNull();
      expect(manager.getPeerIdString()).toBeNull();
      expect(manager.getPrivateKey()).toBeNull();
      expect(manager.getE2EEKeyPair()).toBeNull();
      expect(manager.getE2EEPublicKeyBase64()).toBeNull();
      expect(manager.isLoaded()).toBe(false);
    });

    it('should return correct values when identity is loaded', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();

      expect(manager.getPeerId()).not.toBeNull();
      expect(manager.getPeerIdString()).not.toBeNull();
      expect(manager.getPrivateKey()).not.toBeNull();
      expect(manager.getE2EEKeyPair()).not.toBeNull();
      expect(manager.getE2EEPublicKeyBase64()).not.toBeNull();
      expect(manager.isLoaded()).toBe(true);
    });
  });

  describe('deleteIdentity', () => {
    it('should delete identity file', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();
      expect(manager.isLoaded()).toBe(true);

      const result = await manager.deleteIdentity();
      expect(result.success).toBe(true);
      expect(manager.isLoaded()).toBe(false);

      // 验证文件已删除
      const identityFile = join(tempDir, 'identity.json');
      await expect(fs.access(identityFile)).rejects.toThrow();
    });

    it('should succeed when identity file does not exist', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      const result = await manager.deleteIdentity();
      expect(result.success).toBe(true);
    });
  });

  describe('private key verification', () => {
    it('should generate valid libp2p private key', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      const result = await manager.loadOrCreate();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const exported = result.data;
      
      // 验证可以反序列化私钥
      const privateKeyBytes = Buffer.from(exported.privateKey, 'base64');
      const privateKey = await unmarshalPrivateKey(privateKeyBytes);
      
      // 验证可以从私钥创建 PeerId
      const peerId = await createFromPrivKey(privateKey);
      expect(peerId.toString()).toBe(exported.peerId);
    });
  });

  describe('password edge cases', () => {
    it('should treat empty string password as no password (not encrypt)', async () => {
      // 创建时使用空字符串密码
      const manager1 = new IdentityManager({ dataDir: tempDir, password: '' });
      const result1 = await manager1.loadOrCreate();
      expect(result1.success).toBe(true);

      // 验证文件内容是明文的（空字符串密码不加密）
      const identityFile = join(tempDir, 'identity.json');
      const content = await fs.readFile(identityFile, 'utf-8');
      const parsed = JSON.parse(content);
      
      // 没有 encrypted 字段，说明是明文存储
      expect(parsed.encrypted).toBeUndefined();
      expect(parsed.peerId).toBeDefined();
    });

    it('should encrypt with non-empty password', async () => {
      const manager = new IdentityManager({ 
        dataDir: tempDir, 
        password: 'non-empty-password' 
      });
      const result = await manager.loadOrCreate();

      expect(result.success).toBe(true);

      // 验证文件内容是加密的
      const identityFile = join(tempDir, 'identity.json');
      const content = await fs.readFile(identityFile, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.encrypted).toBe(true);
      expect(parsed.ciphertext).toBeDefined();
    });
  });

  describe('deleteIdentity memory cleanup', () => {
    it('should clear all sensitive data from memory after delete', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();
      
      // 确保身份已加载
      expect(manager.isLoaded()).toBe(true);
      expect(manager.getPrivateKey()).not.toBeNull();
      expect(manager.getE2EEKeyPair()).not.toBeNull();
      
      // 删除身份
      const result = await manager.deleteIdentity();
      expect(result.success).toBe(true);
      
      // 验证内存已清理
      expect(manager.isLoaded()).toBe(false);
      expect(manager.getPeerId()).toBeNull();
      expect(manager.getPrivateKey()).toBeNull();
      expect(manager.getE2EEKeyPair()).toBeNull();
    });
  });

  // P1 修复：添加并发 loadOrCreate 测试
  describe('concurrent loadOrCreate', () => {
    it('should handle concurrent loadOrCreate calls safely', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      
      // 同时发起多个 loadOrCreate 调用
      const promises = await Promise.all([
        manager.loadOrCreate(),
        manager.loadOrCreate(),
        manager.loadOrCreate()
      ]);
      
      // 所有调用都应该成功
      for (const result of promises) {
        expect(result.success).toBe(true);
      }
      
      // 所有调用应该返回相同的 peerId
      const peerIds = promises.map(r => r.success ? r.data.peerId : null);
      expect(peerIds[0]).toBe(peerIds[1]);
      expect(peerIds[1]).toBe(peerIds[2]);
    });

    it('should return existing identity when already loaded', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      
      // 首次加载
      const result1 = await manager.loadOrCreate();
      expect(result1.success).toBe(true);
      if (!result1.success) return;
      
      const peerId1 = result1.data.peerId;
      
      // 再次调用应该直接返回现有身份（不重新加载）
      const result2 = await manager.loadOrCreate();
      expect(result2.success).toBe(true);
      if (!result2.success) return;
      
      expect(result2.data.peerId).toBe(peerId1);
    });

    it('should handle concurrent calls with password protection', async () => {
      const password = 'test-password-123';
      const manager = new IdentityManager({ dataDir: tempDir, password });
      
      // 并发调用
      const promises = await Promise.all([
        manager.loadOrCreate(),
        manager.loadOrCreate()
      ]);
      
      // 都应该成功且返回相同身份
      for (const result of promises) {
        expect(result.success).toBe(true);
      }
      
      const peerIds = promises.map(r => r.success ? r.data.peerId : null);
      expect(peerIds[0]).toBe(peerIds[1]);
    });
  });

  // P1 修复：添加文件权限验证测试
  describe('file permissions', () => {
    it('should set identity file permissions to 600 (owner only)', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();
      
      const identityFile = join(tempDir, 'identity.json');
      const stats = await fs.stat(identityFile);
      const mode = stats.mode & 0o777; // 只取权限位
      
      // 验证文件权限为 600
      expect(mode).toBe(0o600);
    });

    it('should set data directory permissions to 700 (owner only)', async () => {
      const manager = new IdentityManager({ dataDir: tempDir });
      await manager.loadOrCreate();
      
      const stats = await fs.stat(tempDir);
      const mode = stats.mode & 0o777; // 只取权限位
      
      // 验证目录权限为 700
      expect(mode).toBe(0o700);
    });

    it('should set correct permissions for encrypted identity file', async () => {
      const manager = new IdentityManager({ 
        dataDir: tempDir, 
        password: 'secure-password' 
      });
      await manager.loadOrCreate();
      
      const identityFile = join(tempDir, 'identity.json');
      const stats = await fs.stat(identityFile);
      const mode = stats.mode & 0o777;
      
      // 加密文件也应该有 600 权限
      expect(mode).toBe(0o600);
    });
  });

  // P1 修复：添加文件损坏处理测试
  describe('corrupted identity file handling', () => {
    it('should return IDENTITY_CORRUPTED for invalid JSON', async () => {
      // 创建一个损坏的身份文件
      const identityFile = join(tempDir, 'identity.json');
      await fs.writeFile(identityFile, 'not valid json {{{', 'utf-8');
      
      const manager = new IdentityManager({ dataDir: tempDir });
      const result = await manager.loadOrCreate();
      
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('IDENTITY_CORRUPTED');
    });

    it('should return IDENTITY_CORRUPTED for truncated JSON', async () => {
      // 创建一个截断的 JSON 文件
      const identityFile = join(tempDir, 'identity.json');
      await fs.writeFile(identityFile, '{"peerId": "incomplete', 'utf-8');
      
      const manager = new IdentityManager({ dataDir: tempDir });
      const result = await manager.loadOrCreate();
      
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe('IDENTITY_CORRUPTED');
    });
  });
});