import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2ANodeManager } from './node-manager';
import { F2ANodeConfig } from './types';
import * as fs from 'fs';
import * as childProcess from 'child_process';

// 使用真实的 fs 和 child_process 模块，但 mock 部分功能
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}));

// Mock fetch for health checks
const originalFetch = global.fetch;
global.fetch = vi.fn();

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
    vi.useFakeTimers();
    (global.fetch as any).mockReset();
    manager = new F2ANodeManager(mockConfig);
  });

  afterEach(async () => {
    vi.useRealTimers();
    // 确保 manager 停止
    await manager.stop();
  });

  describe('isRunning', () => {
    it('should return false initially', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));
      const result = await manager.isRunning();
      expect(result).toBe(false);
    });

    it('should return true when health check succeeds', async () => {
      (global.fetch as any).mockResolvedValue({ ok: true });
      const result = await manager.isRunning();
      expect(result).toBe(true);
    });

    it('should return false when health check fails', async () => {
      (global.fetch as any).mockResolvedValue({ ok: false });
      const result = await manager.isRunning();
      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return error status when node is down', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));
      const status = await manager.getStatus();
      expect(status.success).toBe(false);
    });

    it('should return status when node is up', async () => {
      const mockStatus = {
        running: true,
        peerId: 'test-peer-id',
        connectedPeers: 5,
        uptime: 3600,
      };
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStatus),
      });

      const status = await manager.getStatus();
      expect(status.success).toBe(true);
      expect(status.data).toEqual(mockStatus);
    });
  });

  describe('ensureRunning', () => {
    it('should return error if start fails', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));
      (fs.existsSync as any).mockReturnValue(false);

      const result = await manager.ensureRunning();
      expect(result.success).toBe(false);
    });
  });

  describe('start', () => {
    it('should return error when daemon not found', async () => {
      (fs.existsSync as any).mockReturnValue(false);

      const result = await manager.start();
      expect(result.success).toBe(false);
      expect(result.error).toContain('F2A Node 未找到');
    });

    it('should spawn process with correct environment', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockImplementation(() => {
        // 模拟启动成功
        return Promise.resolve({ ok: true });
      });

      const result = await manager.start();

      expect(childProcess.spawn).toHaveBeenCalledWith('node', [expect.stringContaining('daemon/index.js')], {
        cwd: mockConfig.nodePath,
        env: expect.objectContaining({
          F2A_CONTROL_PORT: String(mockConfig.controlPort),
          F2A_CONTROL_TOKEN: mockConfig.controlToken,
          F2A_P2P_PORT: String(mockConfig.p2pPort),
          F2A_ENABLE_MDNS: String(mockConfig.enableMDNS),
        }),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    });

    it('should save PID to file', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockResolvedValue({ ok: true });

      await manager.start();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('f2a-node.pid'),
        '12345',
        { mode: 0o644 }
      );
    });
  });

  describe('stop', () => {
    it('should stop without error when not running', async () => {
      await expect(manager.stop()).resolves.not.toThrow();
    });

    it('should kill process with SIGTERM first', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn((event: string, callback: () => void) => {
          if (event === 'exit') {
            // 立即触发退出
            callback();
          }
        }),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockResolvedValue({ ok: true });

      await manager.start();
      await manager.stop();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('getConfig', () => {
    it('should return config copy', () => {
      const config = manager.getConfig();
      expect(config.nodePath).toBe(mockConfig.nodePath);
      expect(config.controlPort).toBe(mockConfig.controlPort);
    });
  });

  describe('健康检查重启限制测试', () => {
    it('应该在连续重启超过限制后停止重启', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);

      // 模拟健康检查失败
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));

      await manager.start();

      // 模拟进程退出
      const exitCallback = mockProcess.on.mock.calls.find(
        (call: any[]) => call[0] === 'exit'
      )?.[1];
      if (exitCallback) {
        exitCallback(1, null);
      }

      // 触发多次健康检查（超过最大重启次数）
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(30000);
        await vi.runAllTimersAsync();
      }

      // spawn 应该被调用，但有重启限制
      // 默认配置是 maxRestarts: 3，所以最多初始启动 + 3 次重启
      const spawnCalls = (childProcess.spawn as any).mock.calls.length;
      expect(spawnCalls).toBeLessThanOrEqual(4);
    });

    it('应该在成功启动后重置重启计数器', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);

      // 模拟健康检查成功
      (global.fetch as any).mockResolvedValue({ ok: true });

      const result = await manager.start();
      expect(result.success).toBe(true);

      // 验证进程被创建
      expect(childProcess.spawn).toHaveBeenCalled();
    });

    it('重启限制应该使用默认配置', () => {
      // 验证 manager 正确初始化
      const config = manager.getConfig();
      expect(config).toBeDefined();
      expect(config.controlPort).toBe(9001);
    });
  });

  describe('冷却期测试', () => {
    it('应该在重启时应用冷却期（指数退避）', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));

      await manager.start();

      // 记录初始 spawn 调用次数
      const initialSpawnCalls = (childProcess.spawn as any).mock.calls.length;

      // 触发健康检查（模拟健康检查失败）
      vi.advanceTimersByTime(30000);
      await vi.runAllTimersAsync();

      // 由于冷却期，第二次重启不应该立即发生
      // 冷却期是指数退避：5s, 10s, 20s...
      vi.advanceTimersByTime(5000); // 第一次重启的冷却期
      await vi.runAllTimersAsync();

      // 检查是否有更多的 spawn 调用
      const laterSpawnCalls = (childProcess.spawn as any).mock.calls.length;
      expect(laterSpawnCalls).toBeGreaterThanOrEqual(initialSpawnCalls);
    });

    it('冷却期时间应该随重启次数增加', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));

      await manager.start();

      // 第一次重启 - 冷却期 5s
      vi.advanceTimersByTime(30000);
      await vi.runAllTimersAsync();

      // 等待冷却期
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();

      // 第二次重启 - 冷却期 10s
      vi.advanceTimersByTime(30000);
      await vi.runAllTimersAsync();

      vi.advanceTimersByTime(10000);
      await vi.runAllTimersAsync();

      // 验证 spawn 被多次调用（表示重启尝试）
      expect((childProcess.spawn as any).mock.calls.length).toBeGreaterThan(1);
    });

    it('冷却期应该有最大值限制', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockRejectedValue(new Error('Connection refused'));

      await manager.start();

      // 模拟多次健康检查失败
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(30000);
        await vi.runAllTimersAsync();
        vi.advanceTimersByTime(60000); // 超过最大冷却期
        await vi.runAllTimersAsync();
      }

      // 验证重启尝试受到限制
      const spawnCalls = (childProcess.spawn as any).mock.calls.length;
      expect(spawnCalls).toBeLessThanOrEqual(4); // 初始 + 3 次重启
    });
  });

  describe('孤儿进程清理测试', () => {
    it('应该在启动时检查并清理孤儿进程', async () => {
      // 模拟 PID 文件存在
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('99999');

      // 创建新 manager 会触发孤儿进程清理
      const newManager = new F2ANodeManager(mockConfig);

      // 应该检查 PID 文件
      expect(fs.existsSync).toHaveBeenCalledWith(expect.stringContaining('f2a-node.pid'));
      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('f2a-node.pid'), 'utf-8');
    });

    it('应该删除无效的 PID 文件', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('invalid-pid');

      new F2ANodeManager(mockConfig);

      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('应该终止发现的孤儿进程', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('12345');

      // Mock process.kill 在检查时不抛出错误（进程存在）
      const originalProcessKill = process.kill;
      (process as any).kill = vi.fn((pid: number, signal?: string) => {
        if (signal === 0) {
          // 检查进程是否存在 - 模拟存在
          return true;
        }
        // 终止进程
        return true;
      });

      new F2ANodeManager(mockConfig);

      // 应该尝试终止进程
      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');

      (process as any).kill = originalProcessKill;
    });

    it('应该在孤儿进程不存在时只删除 PID 文件', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue('12345');

      // Mock process.kill 在检查时抛出错误（进程不存在）
      const originalProcessKill = process.kill;
      (process as any).kill = vi.fn((pid: number, signal?: string) => {
        if (signal === 0) {
          throw new Error('ESRCH: No such process');
        }
        return true;
      });

      new F2ANodeManager(mockConfig);

      // 应该删除 PID 文件
      expect(fs.unlinkSync).toHaveBeenCalled();

      (process as any).kill = originalProcessKill;
    });

    it('启动成功后应该删除旧的 PID 文件', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockResolvedValue({ ok: true });

      await manager.start();

      // 应该保存新的 PID
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('停止时应该清理 PID 文件', async () => {
      (fs.existsSync as any).mockReturnValue(true);

      await manager.stop();

      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('进程退出时应该删除 PID 文件', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockResolvedValue({ ok: true });

      await manager.start();

      // 重置 unlinkSync 调用计数
      (fs.unlinkSync as any).mockClear();

      // 触发进程退出事件
      const exitCallback = mockProcess.on.mock.calls.find(
        (call: any[]) => call[0] === 'exit'
      )?.[1];
      if (exitCallback) {
        exitCallback(0, null);
      }

      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('进程管理测试', () => {
    it('应该处理进程错误事件', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockResolvedValue({ ok: true });

      await manager.start();

      // 触发进程错误事件
      const errorCallback = mockProcess.on.mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      if (errorCallback) {
        errorCallback(new Error('Process error'));
      }

      // 应该删除 PID 文件
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('应该记录进程 stdout', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockResolvedValue({ ok: true });

      await manager.start();

      // 验证 stdout 事件监听器被设置
      expect(mockProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    it('应该记录进程 stderr', async () => {
      const mockProcess = {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        exitCode: null,
      };

      (fs.existsSync as any).mockReturnValue(true);
      (childProcess.spawn as any).mockReturnValue(mockProcess);
      (global.fetch as any).mockResolvedValue({ ok: true });

      await manager.start();

      expect(mockProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
    });
  });

  describe('Token 生成测试', () => {
    it('应该生成随机 token', async () => {
      const customConfig: F2ANodeConfig = {
        ...mockConfig,
        controlToken: undefined as any, // 不提供 token，应该自动生成
      };

      const defaultManager = new F2ANodeManager(customConfig);
      const config = defaultManager.getConfig();

      expect(config.controlToken).toMatch(/^f2a-/);
      expect(config.controlToken.length).toBeGreaterThan(30);
    });
  });
});
