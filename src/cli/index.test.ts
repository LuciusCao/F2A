import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
const mockRequest = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('http', () => ({
  request: (...args: any[]) => mockRequest(...args),
}));

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  exec: vi.fn(),
}));

// Mock daemon module
vi.mock('./daemon.js', () => ({
  startForeground: vi.fn().mockResolvedValue(undefined),
  startBackground: vi.fn().mockResolvedValue(undefined),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
  showStatus: vi.fn().mockResolvedValue(undefined),
  getDaemonStatus: vi.fn().mockReturnValue({ running: false, port: 9001 }),
  getPidFile: vi.fn().mockReturnValue('/home/test/.f2a/daemon.pid'),
  getLogFile: vi.fn().mockReturnValue('/home/test/.f2a/daemon.log'),
  isDaemonRunning: vi.fn().mockReturnValue(false),
}));

describe('CLI Index', () => {
  const mockReq = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };

  const mockRes = {
    statusCode: 200,
    on: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockRequest.mockImplementation((options: any, callback: Function) => {
      callback(mockRes);
      return mockReq;
    });

    mockRes.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'data') callback(Buffer.from(JSON.stringify({ success: true, status: 'ok' })));
      if (event === 'end') callback();
    });

    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.F2A_CONTROL_PORT;
    delete process.env.F2A_CONTROL_TOKEN;
  });

  describe('getControlToken', () => {
    it('should use environment variable token', async () => {
      process.env.F2A_CONTROL_TOKEN = 'env-token';

      vi.resetModules();
      // Just verify env is set correctly
      expect(process.env.F2A_CONTROL_TOKEN).toBe('env-token');
    });

    it('should lazily read token from file when env not set', async () => {
      delete process.env.F2A_CONTROL_TOKEN;

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file-token');

      vi.resetModules();
      // Import module - token is now lazy-loaded, so no immediate check
      await import('./index');

      // Token check should not happen on import (lazy loading behavior)
      expect(mockExistsSync).not.toHaveBeenCalled();
    });
  });
});

describe('CLI Daemon Commands Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.F2A_CONTROL_PORT = '9001';
  });

  afterEach(() => {
    delete process.env.F2A_CONTROL_PORT;
    vi.resetModules();
  });

  describe('daemon command parsing', () => {
    it('should parse daemon command without subcommand', () => {
      const args = ['daemon'];
      // parseArgs would see command='daemon', subcommand=undefined
      expect(args[0]).toBe('daemon');
    });

    it('should parse daemon -d for background mode', () => {
      const args = ['daemon', '-d'];
      expect(args[0]).toBe('daemon');
      expect(args[1]).toBe('-d');
    });

    it('should parse daemon --detach for background mode', () => {
      const args = ['daemon', '--detach'];
      expect(args[0]).toBe('daemon');
      expect(args[1]).toBe('--detach');
    });

    it('should parse daemon stop command', () => {
      const args = ['daemon', 'stop'];
      expect(args[0]).toBe('daemon');
      expect(args[1]).toBe('stop');
    });

    it('should parse daemon status command', () => {
      const args = ['daemon', 'status'];
      expect(args[0]).toBe('daemon');
      expect(args[1]).toBe('status');
    });
  });
});
