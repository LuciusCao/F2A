import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from './token-manager.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TokenManager', () => {
  let tempDir: string;
  let tokenManager: TokenManager;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // 创建临时目录
    tempDir = join(tmpdir(), `f2a-test-${Date.now()}`);
    
    // 保存原始环境变量
    originalEnv = process.env.F2A_CONTROL_TOKEN;
    delete process.env.F2A_CONTROL_TOKEN;
    
    // 创建新的 TokenManager
    tokenManager = new TokenManager(tempDir);
  });

  afterEach(() => {
    // 恢复环境变量
    if (originalEnv !== undefined) {
      process.env.F2A_CONTROL_TOKEN = originalEnv;
    } else {
      delete process.env.F2A_CONTROL_TOKEN;
    }
    
    // 清理临时目录
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('getToken', () => {
    it('should generate new token when none exists', () => {
      const token = tokenManager.getToken();
      
      expect(token).toBeDefined();
      expect(token.startsWith('f2a-')).toBe(true);
      expect(token.length).toBeGreaterThan(40); // f2a- + 64 hex chars
    });

    it('should return same token on subsequent calls', () => {
      const token1 = tokenManager.getToken();
      const token2 = tokenManager.getToken();
      
      expect(token1).toBe(token2);
    });

    it('should use environment variable if set', () => {
      const envToken = 'custom-env-token-123';
      process.env.F2A_CONTROL_TOKEN = envToken;
      
      const token = tokenManager.getToken();
      expect(token).toBe(envToken);
    });

    it('should load token from file if exists', () => {
      // 先获取一个 token（会保存到文件）
      const token1 = tokenManager.getToken();
      
      // 创建新的 TokenManager 实例（相同目录）
      const newManager = new TokenManager(tempDir);
      const token2 = newManager.getToken();
      
      expect(token2).toBe(token1);
    });

    it('should reject insecure default token', () => {
      process.env.F2A_CONTROL_TOKEN = 'f2a-default-token';

      // 应该抛出错误
      expect(() => tokenManager.getToken()).toThrow('Insecure token detected');

      delete process.env.F2A_CONTROL_TOKEN;
    });
  });

  describe('verifyToken', () => {
    it('should return true for valid token', () => {
      const token = tokenManager.getToken();
      
      expect(tokenManager.verifyToken(token)).toBe(true);
    });

    it('should return false for invalid token', () => {
      tokenManager.getToken(); // 确保有 token
      
      expect(tokenManager.verifyToken('wrong-token')).toBe(false);
    });

    it('should return false for undefined token', () => {
      tokenManager.getToken();
      
      expect(tokenManager.verifyToken(undefined)).toBe(false);
    });

    it('should return false for empty string', () => {
      tokenManager.getToken();
      
      expect(tokenManager.verifyToken('')).toBe(false);
    });
  });

  describe('getTokenPath', () => {
    it('should return correct path', () => {
      const path = tokenManager.getTokenPath();
      
      expect(path).toContain('control-token');
      expect(path).toBe(join(tempDir, 'control-token'));
    });
  });

  describe('token format', () => {
    it('should generate token with correct format', () => {
      const token = tokenManager.getToken();
      
      // 格式: f2a-[64 hex chars]
      expect(token).toMatch(/^f2a-[a-f0-9]{64}$/);
    });

    it('should generate unique tokens for different instances', () => {
      const token1 = new TokenManager(join(tempDir, 'a')).getToken();
      const token2 = new TokenManager(join(tempDir, 'b')).getToken();
      
      expect(token1).not.toBe(token2);
    });
  });
});
