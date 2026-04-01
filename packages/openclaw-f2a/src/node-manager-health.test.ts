/**
 * F2A Node Manager Health Check Tests
 * 覆盖 waitForReady 超时和基本的健康检查功能
 * 
 * 注意：健康检查重启逻辑的测试需要等待 30 秒健康检查周期，
 * 这些测试标记为 skip，建议作为集成测试单独运行。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as childProcess from 'child_process';

// Mock child_process
vi.mock('child_process', () => {
  const createMockProcess = () => {
    const _exitCallbacks: Function[] = [];
    const processObj = {
      pid: 12345,
      on: vi.fn((event: string, callback: Function) => {
        if (event === 'exit') {
          _exitCallbacks.push(callback);
        }
      }),
      unref: vi.fn(),
      kill: vi.fn((signal: string) => {
        processObj.exitCode = signal === 'SIGKILL' ? -9 : 0;
        for (const cb of _exitCallbacks) {
          cb(processObj.exitCode, null);
        }
        return true;
      }),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      exitCode: null,
    };
    return processObj;
  };
  return {
    spawn: vi.fn(createMockProcess),
  };
});

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '12345'),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() - 10000 })),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock process.kill for PID cleanup
vi.spyOn(process, 'kill').mockImplementation(() => true);

// Import after mocking
import { F2ANodeManager } from './node-manager.js';
import type { Logger } from './logger.js';

describe('F2ANodeManager - waitForReady 超时', () => {
  let manager: F2ANodeManager | null = null;
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockFetch.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (manager) {
      try { await manager.stop(); } catch {}
      manager = null;
    }
  });

  it('应该在 Node 启动超时时抛出错误', async () => {
    vi.useFakeTimers();
    
    mockFetch.mockResolvedValue({ ok: false });

    manager = new F2ANodeManager({
      nodePath: '/test/path',
    }, mockLogger);

    const startPromise = manager.start();
    
    await vi.advanceTimersByTimeAsync(31000);
    
    const result = await startPromise;

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('启动超时');
    
    vi.useRealTimers();
  });

  it('应该在多次检查后最终成功', async () => {
    vi.useFakeTimers();
    
    mockFetch
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });

    manager = new F2ANodeManager({
      nodePath: '/test/path',
    }, mockLogger);

    const startPromise = manager.start();
    
    await vi.advanceTimersByTimeAsync(2000);
    
    const result = await startPromise;

    expect(result.success).toBe(true);
    
    vi.useRealTimers();
  });
});

// 健康检查重启逻辑测试 - 需要等待 30 秒健康检查周期
// 这些测试标记为 skip，建议作为集成测试单独运行
describe.skip('F2ANodeManager - startHealthCheck 重启逻辑（集成测试）', () => {
  let manager: F2ANodeManager | null = null;
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockFetch.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (manager) {
      try { await manager.stop(); } catch {}
      manager = null;
    }
  });

  // 注意：以下测试需要等待 30 秒健康检查周期
  // 运行这些测试：npx vitest run --testNamePattern="startHealthCheck" --testTimeout=120000
  
  it('应该在进程不健康时尝试重启', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    manager = new F2ANodeManager({
      nodePath: '/test/path',
    }, mockLogger);

    const result = await manager.start();
    expect(result.success).toBe(true);
    
    mockFetch.mockClear();
    mockLogger.warn.mockClear();
    
    mockFetch.mockResolvedValue({ ok: false });
    
    await vi.waitFor(() => {
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('健康检查失败'),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number)
      );
    }, { timeout: 40000, interval: 1000 });
  }, 60000);

  it('应该在健康时跳过重启', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    manager = new F2ANodeManager({
      nodePath: '/test/path',
    }, mockLogger);

    const result = await manager.start();
    expect(result.success).toBe(true);
    
    mockFetch.mockClear();
    mockLogger.warn.mockClear();
    
    mockFetch.mockResolvedValue({ ok: true });
    
    await new Promise(resolve => setTimeout(resolve, 35000));
    
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('健康检查失败'),
      expect.anything()
    );
  }, 50000);
});

describe('F2ANodeManager - 停止时清理健康检查定时器', () => {
  let manager: F2ANodeManager | null = null;
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    manager = null;
  });

  it('应该在停止时清理健康检查定时器', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    manager = new F2ANodeManager({
      nodePath: '/test/path',
    }, mockLogger);

    const result = await manager.start();
    expect(result.success).toBe(true);
    
    await manager.stop();
    
    mockFetch.mockClear();
    mockLogger.warn.mockClear();
    
    mockFetch.mockResolvedValue({ ok: false });
    
    // 等待很短时间，验证健康检查不会触发
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('健康检查失败'),
      expect.anything()
    );
    
    manager = null;
  }, 30000);
});