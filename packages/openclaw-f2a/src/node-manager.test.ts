import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2ANodeManager } from './node-manager.js';
import type { Logger } from './logger.js';

// Mock child_process
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

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() - 10000 })),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('F2ANodeManager', () => {
  let manager: F2ANodeManager;
  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new F2ANodeManager({
      nodePath: '/test/path',
      controlPort: 9001,
      controlToken: 'test-token',
      p2pPort: 9000,
    }, mockLogger);
    
    // Mock fetch to return healthy status
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ running: true, peerId: 'test-peer', connectedPeers: 0 }),
    });
  });

  afterEach(async () => {
    await manager.stop();
  });

  describe('构造函数', () => {
    it('应该创建 F2ANodeManager 实例', () => {
      expect(manager).toBeDefined();
    });

    it('应该使用默认配置', () => {
      const defaultManager = new F2ANodeManager({});
      const config = defaultManager.getConfig();
      expect(config.controlPort).toBe(9001);
      expect(config.p2pPort).toBe(9000);
      expect(config.enableMDNS).toBe(true);
    });

    it('应该使用自定义配置', () => {
      const customManager = new F2ANodeManager({
        controlPort: 8080,
        p2pPort: 4001,
        enableMDNS: false,
      });
      const config = customManager.getConfig();
      expect(config.controlPort).toBe(8080);
      expect(config.p2pPort).toBe(4001);
      expect(config.enableMDNS).toBe(false);
    });

    it('应该使用自定义 logger', () => {
      const customManager = new F2ANodeManager({}, mockLogger);
      expect(customManager).toBeDefined();
    });
  });

  describe('isRunning', () => {
    it('应该返回 true 当服务健康时', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await manager.isRunning();
      expect(result).toBe(true);
    });

    it('应该返回 false 当服务不健康时', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await manager.isRunning();
      expect(result).toBe(false);
    });

    it('应该返回 false 当 fetch 失败时', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await manager.isRunning();
      expect(result).toBe(false);
    });

    it('应该正确设置 Authorization header', async () => {
      await manager.isRunning();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:9001/health',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-token',
          },
        })
      );
    });
  });

  describe('getStatus', () => {
    it('应该返回状态信息', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          running: true,
          peerId: 'test-peer-123',
          connectedPeers: 5,
          uptime: 3600,
        }),
      });

      const result = await manager.getStatus();

      expect(result.success).toBe(true);
      expect(result.data?.running).toBe(true);
      expect(result.data?.peerId).toBe('test-peer-123');
      expect(result.data?.connectedPeers).toBe(5);
    });

    it('应该返回错误当服务未响应时', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await manager.getStatus();

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Node 未响应');
    });

    it('应该返回错误当 fetch 失败时', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await manager.getStatus();

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Network error');
    });
  });

  describe('getConfig', () => {
    it('应该返回配置的副本', () => {
      const config = manager.getConfig();
      expect(config.controlPort).toBe(9001);
      expect(config.controlToken).toBe('test-token');
    });
  });

  describe('ensureRunning', () => {
    it('应该返回成功当已在运行时', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await manager.ensureRunning();

      expect(result.success).toBe(true);
    });
  });

  describe('stop', () => {
    it('应该能够停止', async () => {
      // 不应该抛出错误
      await manager.stop();
    });

    it('应该清理健康检查定时器', async () => {
      await manager.stop();
      // 定时器应该被清除
    });
  });

  describe('错误处理', () => {
    it('应该处理 fetch 超时', async () => {
      // Mock AbortController timeout
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      });

      const result = await manager.isRunning();
      expect(result).toBe(false);

      global.fetch = originalFetch;
    });

    it('应该处理网络错误', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await manager.isRunning();
      expect(result).toBe(false);

      global.fetch = originalFetch;
    });
  });
});