/**
 * F2A CLI 配置测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  updateConfig,
  configExists,
  validateConfig,
  getConfigPath,
  validateAgentName,
  F2AConfig,
  F2AConfigSchema,
} from './config.js';

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), 'f2a-config-test-' + Date.now());

describe('Config', () => {
  // 保存原始环境变量
  const originalConfigDir = process.env.F2A_CONFIG_DIR;

  beforeEach(() => {
    // 创建测试目录
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    // 设置测试配置目录
    process.env.F2A_CONFIG_DIR = TEST_DIR;
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    // 恢复环境变量
    if (originalConfigDir !== undefined) {
      process.env.F2A_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.F2A_CONFIG_DIR;
    }
  });

  describe('getDefaultConfig', () => {
    it('should return default config', () => {
      const config = getDefaultConfig();
      
      expect(config.agentName).toBe('my-agent');
      expect(config.network.bootstrapPeers).toEqual([]);
      expect(config.autoStart).toBe(false);
      expect(config.controlPort).toBe(9001);
      expect(config.p2pPort).toBe(0);
      expect(config.enableMDNS).toBe(true);
      expect(config.enableDHT).toBe(true);
      expect(config.logLevel).toBe('INFO');
    });
  });

  describe('validateConfig', () => {
    it('should validate a valid config', () => {
      const config = getDefaultConfig();
      const result = validateConfig(config);
      
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('should detect missing required fields', () => {
      const config = {} as F2AConfig;
      const result = validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });

    it('should validate agentName length', () => {
      const config = {
        ...getDefaultConfig(),
        agentName: '',
      };
      const result = validateConfig(config);
      
      expect(result.valid).toBe(false);
    });

    it('should reject port below 1024 for controlPort', () => {
      // 注意：validateConfig 只验证 RequiredConfigSchema
      // controlPort 在 AdvancedConfigSchema 中，需要使用 F2AConfigSchema 直接验证
      const config = {
        ...getDefaultConfig(),
        controlPort: 80, // 低于 1024
      };
      const result = F2AConfigSchema.safeParse(config);
      
      expect(result.success).toBe(false);
    });

    it('should accept valid port in range 1024-65535', () => {
      const config = {
        ...getDefaultConfig(),
        controlPort: 9001,
      };
      const result = validateConfig(config);
      
      expect(result.valid).toBe(true);
    });

    it('should reject port above 65535', () => {
      // 注意：validateConfig 只验证 RequiredConfigSchema
      // controlPort 在 AdvancedConfigSchema 中，需要使用 F2AConfigSchema 直接验证
      const config = {
        ...getDefaultConfig(),
        controlPort: 70000,
      };
      const result = F2AConfigSchema.safeParse(config);
      
      expect(result.success).toBe(false);
    });
  });

  describe('validateAgentName', () => {
    it('should reject empty name', () => {
      const result = validateAgentName('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject name with special characters', () => {
      const result = validateAgentName('test@agent');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('letters, numbers');
    });

    it('should accept valid name with hyphens and underscores', () => {
      const result = validateAgentName('my-test_agent');
      expect(result.valid).toBe(true);
    });

    it('should reject name longer than 50 characters', () => {
      const longName = 'a'.repeat(51);
      const result = validateAgentName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('50');
    });
  });

  describe('saveConfig and loadConfig', () => {
    it('should save and load config correctly', () => {
      const config = getDefaultConfig();
      config.agentName = 'test-agent';
      
      saveConfig(config);
      
      const loaded = loadConfig();
      expect(loaded.agentName).toBe('test-agent');
    });

    it('should use test directory', () => {
      const config = getDefaultConfig();
      saveConfig(config);
      
      const configPath = getConfigPath();
      expect(configPath).toContain(TEST_DIR);
    });
  });

  describe('updateConfig', () => {
    it('should merge partial config', () => {
      // 先保存一个基础配置
      saveConfig(getDefaultConfig());
      
      const updated = updateConfig({
        agentName: 'new-agent',
        controlPort: 9002,
      });
      
      expect(updated.agentName).toBe('new-agent');
      expect(updated.controlPort).toBe(9002);
      expect(updated.enableMDNS).toBe(true);
    });

    it('should deep merge network config', () => {
      saveConfig(getDefaultConfig());
      
      const updated = updateConfig({
        network: {
          bootstrapPeers: ['/ip4/1.2.3.4/tcp/9000/p2p/peer1', '/ip4/5.6.7.8/tcp/9000/p2p/peer2'],
        },
      });
      
      expect(updated.network.bootstrapPeers).toEqual(['/ip4/1.2.3.4/tcp/9000/p2p/peer1', '/ip4/5.6.7.8/tcp/9000/p2p/peer2']);
    });

    it('should deep merge security config', () => {
      const config = getDefaultConfig();
      config.security = {
        level: 'medium',
        requireConfirmation: true,
      };
      saveConfig(config);
      
      const updated = updateConfig({
        security: {
          level: 'high',
          requireConfirmation: true,
        },
      });
      
      expect(updated.security?.level).toBe('high');
      expect(updated.security?.requireConfirmation).toBe(true);
    });

    it('should deep merge rateLimit config', () => {
      const config = getDefaultConfig();
      config.rateLimit = {
        maxRequests: 100,
        windowMs: 60000,
      };
      saveConfig(config);
      
      const updated = updateConfig({
        rateLimit: {
          maxRequests: 200,
          windowMs: 60000,
        },
      });
      
      expect(updated.rateLimit?.maxRequests).toBe(200);
      expect(updated.rateLimit?.windowMs).toBe(60000);
    });
  });

  describe('configExists', () => {
    it('should return false when config does not exist', () => {
      expect(configExists()).toBe(false);
    });

    it('should return true when config exists', () => {
      saveConfig(getDefaultConfig());
      expect(configExists()).toBe(true);
    });
  });

  describe('Security: bootstrapPeers validation', () => {
    it('should accept valid multiaddr format', () => {
      const config = {
        ...getDefaultConfig(),
        network: {
          bootstrapPeers: ['/ip4/192.168.1.1/tcp/9000/p2p/QmPeerId123'],
        },
      };
      const result = F2AConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept dns4 multiaddr format', () => {
      const config = {
        ...getDefaultConfig(),
        network: {
          bootstrapPeers: ['/dns4/bootstrap.example.com/tcp/9000/p2p/QmPeerId123'],
        },
      };
      const result = F2AConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject invalid multiaddr format', () => {
      const config = {
        ...getDefaultConfig(),
        network: {
          bootstrapPeers: ['invalid-peer-address'],
        },
      };
      const result = F2AConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject multiaddr without p2p peer-id', () => {
      const config = {
        ...getDefaultConfig(),
        network: {
          bootstrapPeers: ['/ip4/192.168.1.1/tcp/9000'],
        },
      };
      const result = F2AConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('Security: dataDir path validation', () => {
    it('should reject dataDir with path traversal', () => {
      const config = {
        ...getDefaultConfig(),
        dataDir: '/var/data/../etc/passwd',
      };
      const result = F2AConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject relative path for dataDir', () => {
      const config = {
        ...getDefaultConfig(),
        dataDir: 'relative/path/data',
      };
      const result = F2AConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should accept valid absolute path for dataDir', () => {
      const config = {
        ...getDefaultConfig(),
        dataDir: '/var/f2a/data',
      };
      const result = F2AConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('Security: no sensitive info in errors', () => {
    it('should not leak config details in loadConfig errors', () => {
      // 写入无效 JSON
      writeFileSync(join(TEST_DIR, 'config.json'), '{ invalid json', 'utf-8');
      
      // 捕获 console.warn 输出
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const config = loadConfig();
      
      // 应该返回默认配置
      expect(config).toEqual(getDefaultConfig());
      
      // 检查 console.warn 不包含敏感信息
      const warnCalls = warnSpy.mock.calls.map(c => c.join(' ')).join(' ');
      expect(warnCalls).not.toContain('invalid json');
      expect(warnCalls).not.toContain('{');
      
      warnSpy.mockRestore();
    });

    it('should not leak validation details in saveConfig errors', () => {
      const invalidConfig = {
        ...getDefaultConfig(),
        network: {
          bootstrapPeers: ['not-a-valid-multiaddr'],
        },
      } as F2AConfig;
      
      // 捕获 console.error (debugLog 使用 console.error)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(() => saveConfig(invalidConfig)).toThrow('Configuration validation failed');
      
      // 检查抛出的错误不包含详细验证信息
      try {
        saveConfig(invalidConfig);
      } catch (e) {
        const errorMessage = (e as Error).message;
        expect(errorMessage).not.toContain('multiaddr');
        expect(errorMessage).not.toContain('bootstrapPeers');
      }
      
      errorSpy.mockRestore();
    });
  });
});