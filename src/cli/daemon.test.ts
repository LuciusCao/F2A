import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPidFile,
  getLogFile,
  isDaemonRunning,
  getDaemonStatus,
} from './daemon.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  exec: vi.fn(),
}));

// Mock http
vi.mock('http', () => ({
  request: vi.fn(),
}));

describe('CLI Daemon Commands', () => {
  const F2A_DIR = join(homedir(), '.f2a');
  const PID_FILE = join(F2A_DIR, 'daemon.pid');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.F2A_CONTROL_PORT = '9001';
  });

  afterEach(() => {
    delete process.env.F2A_CONTROL_PORT;
    vi.resetModules();
  });

  describe('getPidFile', () => {
    it('should return correct PID file path', () => {
      const pidFile = getPidFile();
      expect(pidFile).toBe(PID_FILE);
    });
  });

  describe('getLogFile', () => {
    it('should return correct log file path', () => {
      const logFile = getLogFile();
      expect(logFile).toBe(join(F2A_DIR, 'daemon.log'));
    });
  });

  describe('isDaemonRunning', () => {
    it('should return false when PID file does not exist', () => {
      (existsSync as any).mockReturnValue(false);
      
      const running = isDaemonRunning();
      
      expect(running).toBe(false);
      expect(existsSync).toHaveBeenCalledWith(PID_FILE);
    });

    it('should return false when PID file contains invalid content', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('invalid');
      
      const running = isDaemonRunning();
      
      expect(running).toBe(false);
    });

    it('should return false when process is not running', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to throw (process not running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => {
        const err = new Error('ESRCH');
        (err as any).code = 'ESRCH';
        throw err;
      });
      
      const running = isDaemonRunning();
      
      expect(running).toBe(false);
      (process as any).kill = originalKill;
    });

    it('should return true when process is running', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed (process running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => true);
      
      const running = isDaemonRunning();
      
      expect(running).toBe(true);
      (process as any).kill = originalKill;
    });
  });

  describe('getDaemonStatus', () => {
    it('should return correct status when daemon is not running', () => {
      (existsSync as any).mockReturnValue(false);
      
      const status = getDaemonStatus();
      
      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
      expect(status.port).toBe(9001);
    });

    it('should return correct status when daemon is running', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed (process running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => true);
      
      const status = getDaemonStatus();
      
      expect(status.running).toBe(true);
      expect(status.pid).toBe(12345);
      expect(status.port).toBe(9001);
      
      (process as any).kill = originalKill;
    });

    it('should use custom control port from environment', () => {
      process.env.F2A_CONTROL_PORT = '8080';
      (existsSync as any).mockReturnValue(false);
      
      const status = getDaemonStatus();
      
      expect(status.port).toBe(8080);
    });
  });

  describe('startForeground', () => {
    it('should exit if daemon is already running', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed (process running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => true);
      
      // Mock http request to check port
      const mockReq = {
        on: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const { request } = await import('http');
      (request as any).mockImplementation((options: any, callback: Function) => {
        // Port check fails, so port is free
        mockReq.on('error', () => {});
        return mockReq;
      });
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      
      // Import after mocks are set up
      const { startForeground } = await import('./daemon.js');
      
      await expect(startForeground()).rejects.toThrow('exit');
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] Daemon 已经在运行中');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
      (process as any).kill = originalKill;
    });
  });

  describe('stopDaemon', () => {
    it('should show message when no daemon is running', async () => {
      (existsSync as any).mockReturnValue(false);
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { stopDaemon } = await import('./daemon.js');
      await stopDaemon();
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] 没有运行中的 daemon');
      
      consoleSpy.mockRestore();
    });
  });

  describe('showStatus', () => {
    it('should show daemon not running status', async () => {
      (existsSync as any).mockReturnValue(false);
      
      // Mock http request
      const mockReq = {
        on: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const { request } = await import('http');
      (request as any).mockReturnValue(mockReq);
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { showStatus } = await import('./daemon.js');
      await showStatus();
      
      expect(consoleSpy).toHaveBeenCalledWith('F2A Daemon 状态:');
      expect(consoleSpy).toHaveBeenCalledWith('  运行中: 否');
      
      consoleSpy.mockRestore();
    });

    it('should show daemon running status with PID', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed (process running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => true);
      
      // Mock http request
      const mockReq = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            // Simulate connection error (daemon not actually responding)
            setTimeout(() => callback(new Error('ECONNREFUSED')), 0);
          }
        }),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const { request } = await import('http');
      (request as any).mockReturnValue(mockReq);
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { showStatus } = await import('./daemon.js');
      await showStatus();
      
      expect(consoleSpy).toHaveBeenCalledWith('  运行中: 是');
      expect(consoleSpy).toHaveBeenCalledWith('  PID: 12345');
      
      consoleSpy.mockRestore();
      (process as any).kill = originalKill;
    });
  });
});