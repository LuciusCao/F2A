import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2ANodeManager } from './node-manager';
import { F2ANodeConfig } from './types';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock util
vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}));

describe('F2ANodeManager', () => {
  let manager: F2ANodeManager;
  const mockConfig: F2ANodeConfig = {
    nodePath: '/test/F2A',
    controlPort: 9001,
    controlToken: 'test-token',
    p2pPort: 9000,
    enableMDNS: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new F2ANodeManager(mockConfig);
  });

  describe('isRunning', () => {
    it('should return false initially', async () => {
      const result = await manager.isRunning();
      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return error status when node is down', async () => {
      const status = await manager.getStatus();
      expect(status.success).toBe(false);
    });
  });

  describe('ensureRunning', () => {
    it('should return error if start fails', async () => {
      const result = await manager.ensureRunning();
      // Since we mocked everything, it will fail to start
      expect(result.success).toBe(false);
    });
  });

  describe('start', () => {
    it('should return error when daemon not found', async () => {
      const { existsSync } = await import('fs');
      (existsSync as any).mockReturnValue(false);
      
      const result = await manager.start();
      expect(result.success).toBe(false);
      expect(result.error).toContain('F2A Node 未找到');
    });
  });

  describe('stop', () => {
    it('should stop without error when not running', async () => {
      await expect(manager.stop()).resolves.not.toThrow();
    });
  });

  describe('getConfig', () => {
    it('should return config copy', () => {
      const config = manager.getConfig();
      expect(config.nodePath).toBe(mockConfig.nodePath);
      expect(config.controlPort).toBe(mockConfig.controlPort);
    });
  });
});
