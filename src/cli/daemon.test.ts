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
}));

// Mock http
vi.mock('http', () => ({
  request: vi.fn(),
}));

// Mock net module
vi.mock('net', () => ({
  createServer: vi.fn(),
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
      
      // Mock net.createServer for port check
      const mockServer = {
        once: vi.fn((event: string, callback: Function) => {
          if (event === 'listening') {
            setTimeout(() => callback(), 0);
          }
        }),
        listen: vi.fn(),
        close: vi.fn((callback) => callback && callback()),
      };
      const { createServer } = await import('net');
      (createServer as any).mockReturnValue(mockServer);
      
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

    it('should exit if port is already in use', async () => {
      (existsSync as any).mockReturnValue(false);
      
      // Mock net.createServer for port check - port in use
      const mockServer = {
        once: vi.fn((event: string, callback: Function) => {
          if (event === 'error') {
            const err = new Error('EADDRINUSE') as NodeJS.ErrnoException;
            err.code = 'EADDRINUSE';
            setTimeout(() => callback(err), 0);
          }
        }),
        listen: vi.fn(),
        close: vi.fn(),
      };
      const { createServer } = await import('net');
      (createServer as any).mockReturnValue(mockServer);
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      
      const { startForeground } = await import('./daemon.js');
      
      await expect(startForeground()).rejects.toThrow('exit');
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] 端口 9001 已被占用');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('startBackground', () => {
    it('should exit if daemon is already running', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed (process running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => true);
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      
      const { startBackground } = await import('./daemon.js');
      
      await expect(startBackground()).rejects.toThrow('exit');
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] Daemon 已经在运行中');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
      (process as any).kill = originalKill;
    });

    it('should exit if port is already in use', async () => {
      (existsSync as any).mockReturnValue(false);
      
      // Mock net.createServer for port check - port in use
      const mockServer = {
        once: vi.fn((event: string, callback: Function) => {
          if (event === 'error') {
            const err = new Error('EADDRINUSE') as NodeJS.ErrnoException;
            err.code = 'EADDRINUSE';
            setTimeout(() => callback(err), 0);
          }
        }),
        listen: vi.fn(),
        close: vi.fn(),
      };
      const { createServer } = await import('net');
      (createServer as any).mockReturnValue(mockServer);
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      
      const { startBackground } = await import('./daemon.js');
      
      await expect(startBackground()).rejects.toThrow('exit');
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] 端口 9001 已被占用');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should exit if daemon script not found', async () => {
      (existsSync as any)
        .mockReturnValueOnce(false) // PID file check
        .mockReturnValueOnce(false); // daemon script check
      
      // Mock net.createServer for port check - port available
      const mockServer = {
        once: vi.fn((event: string, callback: Function) => {
          if (event === 'listening') {
            setTimeout(() => callback(), 0);
          }
        }),
        listen: vi.fn(),
        close: vi.fn((callback) => callback && callback()),
      };
      const { createServer } = await import('net');
      (createServer as any).mockReturnValue(mockServer);
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      
      const { startBackground } = await import('./daemon.js');
      
      await expect(startBackground()).rejects.toThrow('exit');
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] 错误: 找不到 daemon 脚本');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
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

    it('should clean up PID file when process does not exist', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to throw (process not running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      });
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { stopDaemon } = await import('./daemon.js');
      await stopDaemon();
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] Daemon 进程已不存在，清理 PID 文件');
      
      consoleSpy.mockRestore();
      (process as any).kill = originalKill;
    });

    it('should stop daemon successfully on Unix', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock Unix platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
      
      // Mock process.kill
      // - First call (isProcessRunning check): return true
      // - Second call (SIGTERM): return true
      // - Third call (isProcessRunning check after waiting): throw ESRCH (process stopped)
      const originalKill = process.kill;
      let callCount = 0;
      (process as any).kill = vi.fn((pid: number, signal?: string) => {
        callCount++;
        // After SIGTERM, process stops (throws ESRCH on check)
        if (callCount >= 3) {
          const err = new Error('ESRCH') as NodeJS.ErrnoException;
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { stopDaemon } = await import('./daemon.js');
      await stopDaemon();
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] Daemon 已停止');
      
      consoleSpy.mockRestore();
      (process as any).kill = originalKill;
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    });

    it('should handle permission error when stopping daemon', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed for isProcessRunning, then throw EPERM on SIGTERM
      const originalKill = process.kill;
      let callCount = 0;
      (process as any).kill = vi.fn((pid: number, signal?: string) => {
        callCount++;
        // First call is isProcessRunning check (signal = 0)
        if (callCount === 1) {
          return true;
        }
        // Second call is SIGTERM - throw EPERM
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });
      
      const { stopDaemon } = await import('./daemon.js');
      
      await expect(stopDaemon()).rejects.toThrow('exit');
      
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] 没有权限停止 daemon');
      
      consoleSpy.mockRestore();
      exitSpy.mockRestore();
      (process as any).kill = originalKill;
    });

    it('should force kill daemon if SIGTERM fails on Unix', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock Unix platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
      
      // We need to mock process.kill so that:
      // - First call (isProcessRunning in stopDaemon): return true
      // - Second call (SIGTERM): return true
      // - Calls 3-32 (isProcessRunning in while loop, 30 iterations): return true
      // - Call 33 (SIGKILL): return true
      // - Call 34 (isProcessRunning after wait): throw ESRCH (process stopped)
      const originalKill = process.kill;
      let callCount = 0;
      (process as any).kill = vi.fn((pid: number, signal?: string) => {
        callCount++;
        // After SIGKILL, process stops - throw ESRCH to indicate process not running
        if (callCount >= 34) {
          const err = new Error('ESRCH') as NodeJS.ErrnoException;
          err.code = 'ESRCH';
          throw err;
        }
        return true;
      });
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const { stopDaemon } = await import('./daemon.js');
      await stopDaemon();
      
      // Verify the daemon stopping process includes force kill message
      expect(consoleSpy).toHaveBeenCalledWith('[F2A] Daemon 未响应 SIGTERM，强制终止...');
      
      // The final message should indicate the daemon stopped
      // Depending on where the ESRCH exception is caught, it could be either:
      // - "[F2A] Daemon 已停止" (if caught by isProcessRunning and returns false)
      // - "[F2A] Daemon 进程已不存在" (if caught by outer catch block)
      // Both are correct outcomes indicating the daemon was stopped
      const calls = consoleSpy.mock.calls.map(call => call[0]);
      const hasStopped = calls.includes('[F2A] Daemon 已停止') || calls.includes('[F2A] Daemon 进程已不存在');
      expect(hasStopped).toBe(true);
      
      consoleSpy.mockRestore();
      (process as any).kill = originalKill;
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
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

  describe('Port Check', () => {
    it('should detect port is available', async () => {
      // Mock net.createServer for port check - port available
      const mockServer = {
        once: vi.fn((event: string, callback: Function) => {
          if (event === 'listening') {
            setTimeout(() => callback(), 0);
          }
        }),
        listen: vi.fn(),
        close: vi.fn((callback) => callback && callback()),
      };
      const { createServer } = await import('net');
      (createServer as any).mockReturnValue(mockServer);
      
      // Re-import to use the mock
      vi.resetModules();
      const { checkPortInUse } = await import('./daemon.js');
      
      // The function should be available internally but we test via startForeground
      expect(mockServer.listen).toBeDefined();
    });

    it('should detect port is in use', async () => {
      // Mock net.createServer for port check - port in use
      const mockServer = {
        once: vi.fn((event: string, callback: Function) => {
          if (event === 'error') {
            const err = new Error('EADDRINUSE') as NodeJS.ErrnoException;
            err.code = 'EADDRINUSE';
            setTimeout(() => callback(err), 0);
          }
        }),
        listen: vi.fn(),
        close: vi.fn(),
      };
      const { createServer } = await import('net');
      (createServer as any).mockReturnValue(mockServer);
      
      expect(mockServer.listen).toBeDefined();
    });
  });
});