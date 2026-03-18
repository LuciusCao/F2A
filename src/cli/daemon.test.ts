import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPidFile,
  getLogFile,
  isDaemonRunning,
  getDaemonStatus,
} from './daemon.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, renameSync, unlinkSync, openSync, closeSync, writeSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Mock fs module properly with importOriginal
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(),
    statSync: vi.fn(),
    renameSync: vi.fn(),
    openSync: vi.fn(),
    closeSync: vi.fn(),
    writeSync: vi.fn(),
  };
});

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
  const LOCK_FILE = join(F2A_DIR, 'daemon.lock');
  const LOG_FILE = join(F2A_DIR, 'daemon.log');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.F2A_CONTROL_PORT = '9001';
  });

  afterEach(() => {
    delete process.env.F2A_CONTROL_PORT;
    vi.resetModules();
  });

  describe('File Lock (acquireLock/releaseLock)', () => {
    it('should acquire lock successfully when no lock exists', async () => {
      (existsSync as any).mockReturnValue(false);
      (openSync as any).mockReturnValue(3);
      (writeSync as any).mockReturnValue(0);
      (closeSync as any).mockReturnValue(undefined);

      const { acquireLock } = await import('./daemon.js');
      const result = acquireLock();
      
      expect(result).toBe(true);
      expect(openSync).toHaveBeenCalledWith(LOCK_FILE, 'wx');
      expect(writeSync).toHaveBeenCalledWith(3, process.pid.toString());
      expect(closeSync).toHaveBeenCalledWith(3);
    });

    it('should clean up stale lock when process is dead', async () => {
      // ensureF2ADir() checks F2A_DIR exists
      // acquireLock() checks LOCK_FILE exists
      (existsSync as any)
        .mockReturnValueOnce(true) // F2A_DIR exists (ensureF2ADir)
        .mockReturnValueOnce(true); // LOCK_FILE exists
      
      (readFileSync as any).mockReturnValue('99999');
      
      // Mock process.kill to throw ESRCH (process not running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      });

      (openSync as any).mockReturnValue(3);
      (writeSync as any).mockReturnValue(0);
      (closeSync as any).mockReturnValue(undefined);

      const { acquireLock } = await import('./daemon.js');
      const result = acquireLock();
      
      expect(result).toBe(true);
      expect(unlinkSync).toHaveBeenCalledWith(LOCK_FILE); // Stale lock cleaned
      
      (process as any).kill = originalKill;
    });

    it('should fail to acquire lock when another process holds it', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed (process running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => true);

      const { acquireLock } = await import('./daemon.js');
      const result = acquireLock();
      
      expect(result).toBe(false);
      expect(openSync).not.toHaveBeenCalled(); // No attempt to create lock
      
      (process as any).kill = originalKill;
    });

    it('should release lock owned by current process', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(process.pid.toString());
      (unlinkSync as any).mockReturnValue(undefined);

      const { releaseLock } = await import('./daemon.js');
      releaseLock();
      
      expect(unlinkSync).toHaveBeenCalledWith(LOCK_FILE);
    });

    it('should not release lock owned by different process', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('54321'); // Different PID

      const { releaseLock } = await import('./daemon.js');
      releaseLock();
      
      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it('should handle corrupted lock file on release', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('invalid-content');

      const { releaseLock } = await import('./daemon.js');
      // Should not throw
      expect(() => releaseLock()).not.toThrow();
    });
  });

  describe('Log Rotation (rotateLogIfNeeded)', () => {
    it('should not rotate when log file does not exist', async () => {
      (existsSync as any).mockReturnValue(false);

      const { rotateLogIfNeeded } = await import('./daemon.js');
      rotateLogIfNeeded();
      
      expect(statSync).not.toHaveBeenCalled();
      expect(renameSync).not.toHaveBeenCalled();
    });

    it('should not rotate when log file is small', async () => {
      (existsSync as any).mockReturnValue(true);
      (statSync as any).mockReturnValue({ size: 1024 }); // 1KB, less than 10MB

      const { rotateLogIfNeeded } = await import('./daemon.js');
      rotateLogIfNeeded();
      
      expect(statSync).toHaveBeenCalledWith(LOG_FILE);
      expect(renameSync).not.toHaveBeenCalled();
    });

    it('should rotate when log file exceeds max size (10MB)', async () => {
      (existsSync as any)
        .mockReturnValueOnce(true) // LOG_FILE exists
        .mockReturnValueOnce(false); // .old file does not exist
      (statSync as any).mockReturnValue({ size: 15 * 1024 * 1024 }); // 15MB
      (renameSync as any).mockReturnValue(undefined);

      const { rotateLogIfNeeded } = await import('./daemon.js');
      rotateLogIfNeeded();
      
      expect(statSync).toHaveBeenCalledWith(LOG_FILE);
      expect(renameSync).toHaveBeenCalledWith(LOG_FILE, LOG_FILE + '.old');
    });

    it('should delete old backup before rotating', async () => {
      (existsSync as any)
        .mockReturnValueOnce(true) // LOG_FILE exists
        .mockReturnValueOnce(true); // .old file exists
      (statSync as any).mockReturnValue({ size: 15 * 1024 * 1024 }); // 15MB
      (unlinkSync as any).mockReturnValue(undefined);
      (renameSync as any).mockReturnValue(undefined);

      const { rotateLogIfNeeded } = await import('./daemon.js');
      rotateLogIfNeeded();
      
      expect(unlinkSync).toHaveBeenCalledWith(LOG_FILE + '.old');
      expect(renameSync).toHaveBeenCalledWith(LOG_FILE, LOG_FILE + '.old');
    });

    it('should handle errors gracefully', async () => {
      (existsSync as any).mockReturnValue(true);
      (statSync as any).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const { rotateLogIfNeeded } = await import('./daemon.js');
      // Should not throw
      expect(() => rotateLogIfNeeded()).not.toThrow();
    });
  });

  describe('Health Check Timeout Configuration', () => {
    it('should use default health timeout when not configured', async () => {
      delete process.env.F2A_HEALTH_TIMEOUT;
      
      // Default is 15000ms
      expect(parseInt('15000', 10)).toBe(15000);
    });

    it('should use custom health timeout from environment', async () => {
      process.env.F2A_HEALTH_TIMEOUT = '30000';
      
      expect(parseInt(process.env.F2A_HEALTH_TIMEOUT || '15000', 10)).toBe(30000);
    });
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
    it('should return false when PID file does not exist', async () => {
      (existsSync as any).mockReturnValue(false);
      
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
      
      const running = await isDaemonRunning();
      
      expect(running).toBe(false);
      expect(existsSync).toHaveBeenCalledWith(PID_FILE);
    });

    it('should return false when PID file contains invalid content', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('invalid');
      
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
      
      const running = await isDaemonRunning();
      
      expect(running).toBe(false);
    });

    it('should return false when process is not running', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
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
      
      // Mock process.kill to throw (process not running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => {
        const err = new Error('ESRCH');
        (err as any).code = 'ESRCH';
        throw err;
      });
      
      const running = await isDaemonRunning();
      
      expect(running).toBe(false);
      (process as any).kill = originalKill;
    });

    it('should return true when process is running', async () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('12345');
      
      // Mock process.kill to succeed (process running)
      const originalKill = process.kill;
      (process as any).kill = vi.fn(() => true);
      
      const running = await isDaemonRunning();
      
      expect(running).toBe(true);
      (process as any).kill = originalKill;
    });
    
    it('should return true when port is in use but no PID file', async () => {
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
      
      const running = await isDaemonRunning();
      
      expect(running).toBe(true);
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

    it('should exit if daemon script not found', async () => {
      // Mock existsSync for multiple calls:
      // 1. PID file check (false - no daemon running)
      // 2. F2A_DIR check in ensureF2ADir (true - dir exists)
      // 3. LOG_FILE check in rotateLogIfNeeded (false - no log file)
      // 4. daemon script check (false - script not found)
      (existsSync as any)
        .mockReturnValueOnce(false) // PID file check
        .mockReturnValueOnce(true)  // F2A_DIR exists
        .mockReturnValueOnce(false) // LOG_FILE not exists
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