/**
 * connector-helpers.ts 测试
 * 
 * 测试辅助函数和验证工具。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isValidPeerId,
  isPathSafe,
  extractErrorMessage,
  readAgentNameFromIdentity,
  mergeConfig,
  generateToken,
  checkF2AInstalled,
  formatBroadcastResults,
  MAX_MESSAGE_LENGTH,
  PEER_ID_REGEX,
} from '../src/connector-helpers.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('connector-helpers', () => {
  describe('常量', () => {
    it('MAX_MESSAGE_LENGTH 应该是 1MB', () => {
      expect(MAX_MESSAGE_LENGTH).toBe(1024 * 1024);
    });

    it('PEER_ID_REGEX 应该匹配正确的格式', () => {
      expect(PEER_ID_REGEX.test('12D3KooW' + 'A'.repeat(44))).toBe(true);
      expect(PEER_ID_REGEX.test('InvalidPeerId')).toBe(false);
    });
  });

  describe('isValidPeerId', () => {
    it('应该接受有效的 Peer ID', () => {
      const validPeerId = '12D3KooW' + 'A'.repeat(44);
      expect(isValidPeerId(validPeerId)).toBe(true);
    });

    it('应该拒绝无效的 Peer ID', () => {
      expect(isValidPeerId('InvalidPeerId')).toBe(false);
      expect(isValidPeerId('12D3KooW' + 'A'.repeat(10))).toBe(false); // 太短
      expect(isValidPeerId('12D3KooW' + 'A'.repeat(50))).toBe(false); // 太长
    });

    it('应该拒绝 null 和 undefined', () => {
      expect(isValidPeerId(null)).toBe(false);
      expect(isValidPeerId(undefined)).toBe(false);
    });

    it('应该拒绝空字符串', () => {
      expect(isValidPeerId('')).toBe(false);
    });

    it('应该拒绝非字符串类型', () => {
      expect(isValidPeerId(123 as any)).toBe(false);
      expect(isValidPeerId({} as any)).toBe(false);
    });
  });

  describe('isPathSafe', () => {
    it('应该接受安全的路径', () => {
      expect(isPathSafe('/safe/path')).toBe(true);
      expect(isPathSafe('./relative/path')).toBe(true);
      expect(isPathSafe('simple-filename.txt')).toBe(true);
    });

    it('应该拒绝包含路径遍历的路径', () => {
      expect(isPathSafe('../unsafe')).toBe(false);
      expect(isPathSafe('path/../../../etc/passwd')).toBe(false);
      expect(isPathSafe('..\\windows\\system32')).toBe(false);
    });

    it('应该拒绝以 ~ 开头的路径', () => {
      expect(isPathSafe('~/Documents')).toBe(false);
    });

    it('应该拒绝 URL 编码的路径遍历', () => {
      expect(isPathSafe('%2e%2e/unsafe')).toBe(false);
      expect(isPathSafe('%2e%2e%2funsafe')).toBe(false);
    });

    it('应该拒绝 null 和 undefined', () => {
      expect(isPathSafe(null)).toBe(false);
      expect(isPathSafe(undefined)).toBe(false);
    });

    it('应该拒绝空字符串', () => {
      expect(isPathSafe('')).toBe(false);
    });
  });

  describe('extractErrorMessage', () => {
    it('应该从 Error 对象提取消息', () => {
      const error = new Error('测试错误');
      expect(extractErrorMessage(error)).toBe('测试错误');
    });

    it('应该处理字符串错误', () => {
      expect(extractErrorMessage('字符串错误')).toBe('字符串错误');
    });

    it('应该处理对象错误', () => {
      expect(extractErrorMessage({ message: '对象错误' })).toBe('对象错误');
    });

    it('应该处理其他类型', () => {
      expect(extractErrorMessage(123)).toBe('123');
      expect(extractErrorMessage(null)).toBe('null');
      expect(extractErrorMessage(undefined)).toBe('undefined');
    });
  });

  describe('readAgentNameFromIdentity', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'f2a-identity-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('应该从 IDENTITY.md 读取 agent 名字', () => {
      writeFileSync(
        join(tempDir, 'IDENTITY.md'),
        '# IDENTITY\n\n- **Name:** 测试Agent\n- **其他字段:** 值\n'
      );

      const name = readAgentNameFromIdentity(tempDir);
      expect(name).toBe('测试Agent');
    });

    it('应该返回 null 如果文件不存在', () => {
      const name = readAgentNameFromIdentity(tempDir);
      expect(name).toBeNull();
    });

    it('应该返回 null 如果 workspace 为空', () => {
      expect(readAgentNameFromIdentity(undefined)).toBeNull();
      expect(readAgentNameFromIdentity('')).toBeNull();
    });
  });

  describe('mergeConfig', () => {
    it('应该合并配置并提供默认值', () => {
      const config = mergeConfig({});
      
      expect(config.autoStart).toBe(true);
      expect(config.webhookPort).toBe(9002);
      expect(config.agentName).toBe('OpenClaw Agent');
      expect(config.capabilities).toEqual([]);
    });

    it('应该覆盖默认值', () => {
      const config = mergeConfig({
        autoStart: false,
        webhookPort: 8080,
        agentName: 'Custom Agent',
      });

      expect(config.autoStart).toBe(false);
      expect(config.webhookPort).toBe(8080);
      expect(config.agentName).toBe('Custom Agent');
    });

    it('应该处理 _api 字段', () => {
      const config = mergeConfig({
        _api: {
          config: {
            agents: {
              defaults: {
                workspace: '/test/workspace',
              },
            },
          },
        },
      });

      // 验证不会崩溃
      expect(config).toBeDefined();
    });
  });

  describe('generateToken', () => {
    it('应该生成 32 字符的 token', () => {
      const token = generateToken();
      expect(token.length).toBe(32);
    });

    it('应该生成不同的 token', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });

    it('应该只包含字母和数字', () => {
      const token = generateToken();
      expect(/^[A-Za-z0-9]+$/.test(token)).toBe(true);
    });
  });

  describe('checkF2AInstalled', () => {
    it('应该返回 false 如果路径无效', () => {
      expect(checkF2AInstalled('/non/existent/path')).toBe(false);
    });
  });

  describe('formatBroadcastResults', () => {
    it('应该格式化广播结果', () => {
      const results = [
        { peerId: '12D3KooW' + 'A'.repeat(44), name: 'Agent1', success: true },
        { peerId: '12D3KooW' + 'B'.repeat(44), name: 'Agent2', success: false, error: '超时' },
      ];

      const formatted = formatBroadcastResults(results);
      expect(formatted).toContain('Agent1');
      expect(formatted).toContain('✅');
      expect(formatted).toContain('Agent2');
      expect(formatted).toContain('❌');
      expect(formatted).toContain('超时');
    });

    it('应该处理空结果', () => {
      const formatted = formatBroadcastResults([]);
      expect(formatted).toBe('');
    });
  });
});