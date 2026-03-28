/**
 * Plugin 入口测试
 * 
 * 测试 OpenClaw 插件注册函数。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import register from '../src/plugin.js';
import type { OpenClawPluginApi } from '../src/types.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Plugin 入口', () => {
  let tempDir: string;
  let mockApi: OpenClawPluginApi;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'plugin-test-'));
    
    // 创建 IDENTITY.md
    writeFileSync(
      join(tempDir, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** TestAgent'
    );
    
    mockApi = {
      config: {
        agents: {
          defaults: {
            workspace: tempDir,
          },
        },
        plugins: {
          entries: {
            'openclaw-f2a': {
              config: {},
            },
          },
        },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      registerTool: vi.fn(),
      registerService: vi.fn(),
    };
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('register 函数', () => {
    it('应该能够注册插件', async () => {
      await register(mockApi);
      
      // 应该注册工具
      expect(mockApi.registerTool).toHaveBeenCalled();
    });

    it('应该注册后台服务', async () => {
      await register(mockApi);
      
      expect(mockApi.registerService).toHaveBeenCalled();
    });

    it('应该记录初始化完成日志', async () => {
      await register(mockApi);
      
      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.stringContaining('初始化完成')
      );
    });

    it('应该注册所有工具', async () => {
      await register(mockApi);
      
      // 获取 registerTool 被调用的次数
      const callCount = (mockApi.registerTool as any).mock.calls.length;
      expect(callCount).toBeGreaterThan(10);
    });
  });
});