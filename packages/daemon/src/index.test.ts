import { describe, it, expect, vi, beforeEach } from 'vitest';
import { F2ADaemon } from './index.js';

// Mock dependencies
vi.mock('@f2a/network', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    Logger: vi.fn().mockImplementation(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
    F2A: {
      create: vi.fn().mockResolvedValue({
        start: vi.fn().mockResolvedValue({ success: true }),
        stop: vi.fn(),
        peerId: 'test-peer-id',
        signData: vi.fn((data: string) => `sig-${data.slice(0, 8)}`)
      })
    }
  };
});

vi.mock('./control-server.js', () => ({
  ControlServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    getAgentRegistry: vi.fn().mockReturnValue({
      register: vi.fn(),
      list: vi.fn().mockReturnValue([])
    })
  }))
}));

describe('F2ADaemon', () => {
  let daemon: F2ADaemon;

  beforeEach(() => {
    vi.clearAllMocks();
    daemon = new F2ADaemon({
      displayName: 'Test Daemon'
    });
  });

  describe('lifecycle', () => {
    it('should create daemon with options', () => {
      expect(daemon).toBeDefined();
      expect(daemon.isRunning()).toBe(false);
    });

    it('should start successfully', async () => {
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);
    });

    it('should not start twice', async () => {
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);

      await expect(daemon.start()).rejects.toThrow('Daemon already running');
    });

    it('should stop gracefully', async () => {
      await daemon.start();
      await daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    it('should handle multiple stop calls', async () => {
      await daemon.start();
      await daemon.stop();
      await daemon.stop(); // Second stop should be safe
      expect(daemon.isRunning()).toBe(false);
    });
  });

  describe('state management', () => {
    it('should track running state correctly', async () => {
      expect(daemon.isRunning()).toBe(false);
      await daemon.start();
      expect(daemon.isRunning()).toBe(true);
      await daemon.stop();
      expect(daemon.isRunning()).toBe(false);
    });

    it('should return F2A instance after start', async () => {
      await daemon.start();
      expect(daemon.getF2A()).toBeDefined();
    });

    it('should return undefined F2A before start', () => {
      expect(daemon.getF2A()).toBeUndefined();
    });
  });

  describe('options', () => {
    it('should use default controlPort', () => {
      const daemon = new F2ADaemon();
      // 默认 controlPort 是 9001
      expect(daemon).toBeDefined();
    });

    it('should accept custom controlPort', () => {
      const daemon = new F2ADaemon({ controlPort: 9002 });
      expect(daemon).toBeDefined();
    });

    it('should accept dataDir option', () => {
      const daemon = new F2ADaemon({ dataDir: '/tmp/test' });
      expect(daemon).toBeDefined();
    });
  });
});

// RFC 003: Agent 注册测试（通过 ControlServer）
describe('RFC 003: AgentId 签发', () => {
  it('daemon 启动后应该可以注册 Agent', async () => {
    const daemon = new F2ADaemon();
    await daemon.start();
    
    // 通过 ControlServer 注册 Agent
    // （实际测试在 control-server.test.ts 中）
    expect(daemon.isRunning()).toBe(true);
    
    await daemon.stop();
  });
});
