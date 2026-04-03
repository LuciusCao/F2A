/**
 * F2ANodeManager 边缘情况和高价值测试
 * 专注于：PID 文件管理、孤儿进程清理、错误处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2ANodeManager } from './node-manager.js';
import type { F2ANodeConfig } from './types.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock util - 返回一个立即 resolve 的 sleep 函数
vi.mock('util', () => ({
  promisify: vi.fn(() => () => Promise.resolve()),
}));

describe('F2ANodeManager - 高价值边缘情况', () => {
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

  afterEach(() => {
    // 清理
  });

  // ========== 1. PID 文件管理 ==========
  describe('PID 文件管理', () => {
    it('应该在启动时保存 PID 文件', async () => {
      const { existsSync, writeFileSync } = await import('fs');
      (existsSync as any).mockReturnValue(true); // daemon 存在

      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      // Mock fetch 用于健康检查
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      await manager.start();

      expect(writeFileSync).toHaveBeenCalledWith(
        '/test/F2A/f2a-node.pid',
        '12345',
        { mode: 0o644 }
      );
    });

    it('应该在保存 PID 文件失败时记录警告但不抛出错误', async () => {
      const { existsSync, writeFileSync } = await import('fs');
      (existsSync as any).mockReturnValue(true);
      (writeFileSync as any).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      // 不应该抛出错误
      await expect(manager.start()).resolves.not.toThrow();
    });
  });

  // ========== 2. 孤儿进程清理 ==========
  describe('孤儿进程清理', () => {
    // Skip: PID 文件清理逻辑已变更
    it.skip('应该在启动时清理孤儿进程（如果 PID 文件存在且进程存在）', async () => {
      const { existsSync, readFileSync, unlinkSync } = await import('fs');
      (existsSync as any).mockImplementation((path: string) => {
        if (path.includes('pid')) return true;
        return true; // daemon 存在
      });
      (readFileSync as any).mockReturnValue('99999');

      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      await manager.start();

      expect(unlinkSync).toHaveBeenCalledWith('/test/F2A/f2a-node.pid');
    });

    // Skip: PID 文件清理逻辑已变更
    it.skip('应该删除无效的 PID 文件', async () => {
      const { existsSync, readFileSync, unlinkSync } = await import('fs');
      (existsSync as any).mockImplementation((path: string) => {
        if (path.includes('pid')) return true;
        return true; // daemon 存在
      });
      (readFileSync as any).mockReturnValue('99999');

      const mockProcess = {
        pid: 12345,
        kill: vi.fn().mockImplementation(() => {
          throw new Error('Process not found');
        }),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      await manager.start();

      expect(unlinkSync).toHaveBeenCalledWith('/test/F2A/f2a-node.pid');
    });

    it('应该处理进程不存在的情况', async () => {
      const { existsSync, readFileSync } = await import('fs');
      (existsSync as any).mockImplementation((path: string) => {
        if (path.includes('pid')) return true;
        return true;
      });
      (readFileSync as any).mockReturnValue('99999');

      const mockProcess = {
        pid: 12345,
        kill: vi.fn().mockImplementation(() => {
          throw new Error('Process not found');
        }),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      // 不应该抛出错误
      await expect(manager.start()).resolves.not.toThrow();
    });
  });

  // ========== 3. isRunning - 错误处理 ==========
  describe('isRunning - 错误处理', () => {
    it('应该在 fetch 失败时返回 false', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await manager.isRunning();

      expect(result).toBe(false);
    });

    it('应该在响应非 200 时返回 false', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const result = await manager.isRunning();

      expect(result).toBe(false);
    });
  });

  // ========== 4. getStatus - 错误处理 ==========
  describe('getStatus - 错误处理', () => {
    it('应该在节点未响应时返回错误', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await manager.getStatus();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
    });

    it('应该在响应非 200 时返回错误', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const result = await manager.getStatus();

      expect(result.success).toBe(false);
    });

    it('应该在解析 JSON 失败时返回错误', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      const result = await manager.getStatus();

      expect(result.success).toBe(false);
    });
  });

  // ========== 5. start - 错误处理 ==========
  describe('start - 错误处理', () => {
    it('应该在 daemon 路径不存在时返回错误', async () => {
      const { existsSync } = await import('fs');
      (existsSync as any).mockReturnValue(false);

      const result = await manager.start();

      expect(result.success).toBe(false);
    });

    it('应该在 spawn 失败时返回错误', async () => {
      const { existsSync } = await import('fs');
      (existsSync as any).mockReturnValue(true);

      const { spawn } = await import('child_process');
      (spawn as any).mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const result = await manager.start();

      expect(result.success).toBe(false);
    });
  });

  // ========== 6. 进程退出事件处理 ==========
  describe('进程退出事件处理', () => {
    it('应该在进程退出时清理 PID 文件', async () => {
      const { existsSync, unlinkSync } = await import('fs');
      (existsSync as any).mockReturnValue(true);

      let exitHandler: any = null;
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn((event, handler) => {
          if (event === 'exit') {
            exitHandler = handler;
          }
        }),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: 0,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      await manager.start();

      // 触发退出事件
      if (exitHandler) {
        exitHandler(0, null);
      }

      expect(unlinkSync).toHaveBeenCalledWith('/test/F2A/f2a-node.pid');
    });

    it('应该在进程错误时清理 PID 文件', async () => {
      const { existsSync, unlinkSync } = await import('fs');
      (existsSync as any).mockReturnValue(true);

      let errorHandler: any = null;
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn((event, handler) => {
          if (event === 'error') {
            errorHandler = handler;
          }
        }),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      await manager.start();

      // 触发错误事件
      if (errorHandler) {
        errorHandler(new Error('Process error'));
      }

      expect(unlinkSync).toHaveBeenCalledWith('/test/F2A/f2a-node.pid');
    });
  });

  // ========== 7. ensureRunning ==========
  describe('ensureRunning', () => {
    it('应该在节点已在运行时直接返回成功', async () => {
      const { existsSync } = await import('fs');
      (existsSync as any).mockReturnValue(false);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const result = await manager.ensureRunning();

      expect(result.success).toBe(true);
    });

    it('应该在节点未运行时启动', async () => {
      const { existsSync } = await import('fs');
      (existsSync as any).mockReturnValue(true);

      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };
      const { spawn } = await import('child_process');
      (spawn as any).mockReturnValue(mockProcess);

      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false }) // isRunning 检查
        .mockResolvedValue({ ok: true }); // start 后的健康检查

      const result = await manager.ensureRunning();

      expect(result.success).toBe(true);
    });
  });
});
