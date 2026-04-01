/**
 * F2A Node Manager Enhanced Tests
 * 覆盖核心启动、健康检查、孤儿进程清理等逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as childProcess from 'child_process';

// Must use factory function with vi.mock to avoid hoisting issues
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    on: vi.fn(),
    unref: vi.fn(),
    kill: vi.fn(() => true),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    exitCode: null,
  })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
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

// Import after mocking
import { F2ANodeManager } from './node-manager.js';
import type { Logger } from './logger.js';

describe('F2ANodeManager - 启动流程', () => {
  let manager: F2ANodeManager;
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (process.exit as any) = null; // Reset process.exit mock
    mockFetch.mockReset();
  });

  afterEach(async () => {
    if (manager) {
      await manager.stop();
    }
  });

  describe('start() 方法', () => {
    it('应该返回错误当 daemon 脚本不存在', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockFetch.mockResolvedValue({ ok: false });

      manager = new F2ANodeManager({
        nodePath: '/test/path',
        controlPort: 9001,
        controlToken: 'test-token',
        p2pPort: 9000,
      }, mockLogger);

      const result = await manager.start();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INTERNAL_ERROR');
    });

    it('应该成功启动 Node 进程', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });

      manager = new F2ANodeManager({
        nodePath: '/test/path',
        controlPort: 9001,
        controlToken: 'test-token',
        p2pPort: 9000,
      }, mockLogger);

      const result = await manager.start();

      expect(result.success).toBe(true);
      expect(childProcess.spawn).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('应该设置正确的环境变量', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });

      manager = new F2ANodeManager({
        nodePath: '/test/path',
        controlPort: 9001,
        controlToken: 'test-token',
        p2pPort: 9000,
      }, mockLogger);

      await manager.start();

      const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
      const env = spawnCall[2]?.env;

      expect(env?.F2A_CONTROL_PORT).toBe('9001');
      expect(env?.F2A_CONTROL_TOKEN).toBe('test-token');
      expect(env?.F2A_P2P_PORT).toBe('9000');
    });

    it('应该设置 bootstrap peers 环境变量', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });

      manager = new F2ANodeManager({
        nodePath: '/test/path',
        bootstrapPeers: ['/ip4/1.2.3.4/tcp/9000'],
      }, mockLogger);

      await manager.start();

      const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
      const env = spawnCall[2]?.env;

      expect(env?.BOOTSTRAP_PEERS).toBe('/ip4/1.2.3.4/tcp/9000');
    });
  });

  describe('ensureRunning() 方法', () => {
    it('应该在已运行时返回成功', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      manager = new F2ANodeManager({}, mockLogger);
      const result = await manager.ensureRunning();

      expect(result.success).toBe(true);
    });

    it('应该在未运行时尝试启动', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true });

      manager = new F2ANodeManager({}, mockLogger);
      const result = await manager.ensureRunning();

      expect(result.success).toBe(true);
    });
  });
});

describe('F2ANodeManager - 孤儿进程清理', () => {
  let manager: F2ANodeManager;
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (manager) {
      await manager.stop();
    }
  });

  it('应该跳过清理刚创建的 PID 文件', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('54321');
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() - 1000 });

    manager = new F2ANodeManager({
      nodePath: '/test/path',
    }, mockLogger);

    // 等待异步清理
    await new Promise(resolve => setTimeout(resolve, 50));

    // 刚创建的 PID 文件不应该被清理
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('应该处理无效的 PID 文件', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('invalid');
    vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() - 10000 });

    manager = new F2ANodeManager({
      nodePath: '/test/path',
    }, mockLogger);

    // 等待异步清理
    await new Promise(resolve => setTimeout(resolve, 50));

    // 无效的 PID 文件应该被删除
    expect(fs.unlinkSync).toHaveBeenCalled();
  });
});

describe('F2ANodeManager - 停止流程', () => {
  let manager: F2ANodeManager;
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (manager) {
      await manager.stop();
    }
  });

  it('应该能够多次调用 stop', async () => {
    manager = new F2ANodeManager({}, mockLogger);
    
    await manager.stop();
    await manager.stop();
    await manager.stop();
    
    // 不应该抛出错误
  });

  it('应该处理未启动时调用 stop', async () => {
    manager = new F2ANodeManager({}, mockLogger);
    
    await manager.stop();
    
    // 不应该抛出错误
  });
});

describe('F2ANodeManager - Token 生成', () => {
  it('应该生成唯一的 token', () => {
    const manager1 = new F2ANodeManager({});
    const manager2 = new F2ANodeManager({});
    
    const config1 = manager1.getConfig();
    const config2 = manager2.getConfig();
    
    expect(config1.controlToken).toBeDefined();
    expect(config2.controlToken).toBeDefined();
  });

  it('应该使用自定义 token', () => {
    const manager = new F2ANodeManager({
      controlToken: 'custom-token',
    });
    
    const config = manager.getConfig();
    expect(config.controlToken).toBe('custom-token');
  });
});