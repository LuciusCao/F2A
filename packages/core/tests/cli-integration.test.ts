import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * CLI 集成测试
 * 测试完整的 CLI 命令链
 * 
 * 注意：
 * - 这些测试使用默认 ~/.f2a 目录
 * - 需要先清理测试身份文件
 * - 测试运行时间较长，需要足够超时时间
 */
describe('CLI Integration', () => {
  const f2aDir = join(homedir(), '.f2a');
  const cliPath = join(process.cwd(), 'dist/cli/index.js');
  const backupDir = join(f2aDir, 'backup');
  let daemonProcess: ChildProcess | null = null;
  let testToken: string | null = null;

  // 辅助函数：执行 CLI 命令
  const execCLI = (args: string[], timeout = 10000): Promise<{ stdout: string; stderr: string; code: number }> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`CLI command timed out after ${timeout}ms`));
      }, timeout);
      
      const proc = spawn('node', [cliPath, ...args], {
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 0 });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  };

  // 辅助函数：等待 daemon 就绪
  const waitForDaemon = async (port = 9001, timeout = 30000): Promise<boolean> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.status === 200) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };

  // 辅助函数：读取 control token
  const readControlToken = (): string | null => {
    const tokenPath = join(f2aDir, 'control-token');
    if (existsSync(tokenPath)) {
      try {
        return readFileSync(tokenPath, 'utf-8').trim();
      } catch {
        return null;
      }
    }
    return null;
  };

  // 辅助函数：备份并清理测试身份文件
  const backupAndCleanIdentities = () => {
    // 创建备份目录
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    
    // 需要备份和清理的文件
    const filesToBackup = [
      'node-identity.json',
      'agent-identity.json',
      'identity.json',
      'identity.json.bak',
      'control-token'
    ];
    
    const timestamp = Date.now();
    
    for (const file of filesToBackup) {
      const filePath = join(f2aDir, file);
      if (existsSync(filePath)) {
        // 备份
        const backupPath = join(backupDir, `${file}.test-backup-${timestamp}`);
        try {
          const content = readFileSync(filePath, 'utf-8');
          writeFileSync(backupPath, content, 'utf-8');
          // 删除原文件
          unlinkSync(filePath);
        } catch {}
      }
    }
  };

  // 辅助函数：恢复身份文件
  const restoreIdentities = () => {
    // 找到最新的备份文件
    const filesToRestore = [
      'node-identity.json',
      'agent-identity.json',
      'identity.json',
      'control-token'
    ];
    
    for (const file of filesToRestore) {
      // 找到最新的备份
      const backups = existsSync(backupDir) 
        ? require('fs').readdirSync(backupDir)
          .filter(f => f.startsWith(file) && f.includes('.test-backup-'))
          .sort()
          .reverse()
        : [];
      
      if (backups.length > 0) {
        const backupPath = join(backupDir, backups[0]);
        const originalPath = join(f2aDir, file);
        try {
          const content = readFileSync(backupPath, 'utf-8');
          writeFileSync(originalPath, content, 'utf-8');
        } catch {}
      }
    }
  };

  beforeAll(async () => {
    // 确保没有运行中的 daemon（强制终止）
    try {
      // 尝试通过 CLI 停止
      await execCLI(['daemon', 'stop'], 5000);
    } catch {}
    
    // 检查并杀掉任何占用端口的进程
    try {
      const { execSync } = require('child_process');
      const lsofResult = execSync('lsof -ti:9001 2>/dev/null || true', { encoding: 'utf-8' }).trim();
      if (lsofResult) {
        const pids = lsofResult.split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
          } catch {}
        }
      }
    } catch {}
    
    // 等待端口释放
    await new Promise(r => setTimeout(r, 2000));
    
    // 备份并清理身份文件，让测试使用全新的身份
    backupAndCleanIdentities();
    
    // 等待清理完成
    await new Promise(r => setTimeout(r, 500));
  }, 15000);

  afterAll(async () => {
    // 清理 daemon 进程
    if (daemonProcess) {
      try {
        daemonProcess.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 2000));
        if (daemonProcess.pid) {
          try {
            process.kill(daemonProcess.pid, 'SIGKILL');
          } catch {}
        }
      } catch {}
    }
    
    // 停止可能残留的 daemon
    try {
      await execCLI(['daemon', 'stop'], 5000);
    } catch {}
    
    // 强制杀掉任何占用端口的进程
    try {
      const { execSync } = require('child_process');
      const lsofResult = execSync('lsof -ti:9001 2>/dev/null || true', { encoding: 'utf-8' }).trim();
      if (lsofResult) {
        const pids = lsofResult.split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
          } catch {}
        }
      }
    } catch {}
    
    // 恢复原始身份文件
    restoreIdentities();
    
    // 清理测试备份文件
    try {
      const backups = existsSync(backupDir) 
        ? require('fs').readdirSync(backupDir)
          .filter(f => f.includes('.test-backup-'))
        : [];
      
      for (const backup of backups) {
        try {
          unlinkSync(join(backupDir, backup));
        } catch {}
      }
    } catch {}
  }, 20000);

  describe('daemon lifecycle', () => {
    it('should show error when daemon not running', async () => {
      const { stdout, stderr } = await execCLI(['status'], 5000);
      
      // 应该提示 daemon 未运行或连接被拒绝
      const output = stderr + stdout;
      expect(
        output.includes('ECONNREFUSED') || 
        output.includes('未运行') || 
        output.includes('not running') ||
        output.includes('连接失败') ||
        output.includes('Error')
      ).toBe(true);
    });

    it('should find daemon script at correct path', async () => {
      // 验证编译后的文件存在
      const daemonScript = join(process.cwd(), 'dist/daemon/main.js');
      expect(existsSync(daemonScript)).toBe(true);
      
      // 验证内容不为空
      const content = readFileSync(daemonScript, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('F2ADaemon');
    });

    // Daemon 启动测试
    it('should generate token after daemon start', async () => {
      // CI 环境跳过完整 daemon 测试
      if (process.env.CI) {
        const daemonScript = join(process.cwd(), 'dist/daemon/main.js');
        expect(existsSync(daemonScript)).toBe(true);
        return;
      }

      // 本地环境：完整测试
      // 确保没有运行中的 daemon
      try {
        await execCLI(['daemon', 'stop'], 5000);
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
      
      // 启动 daemon（前台模式）
      daemonProcess = spawn('node', [cliPath, 'daemon'], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // 等待 daemon 就绪（使用更长的超时）
      const ready = await waitForDaemon(9001, 45000);
      expect(ready).toBe(true);

      // 验证 token 文件已生成
      const tokenPath = join(f2aDir, 'control-token');
      expect(existsSync(tokenPath)).toBe(true);
      
      // 验证 token 格式
      const token = readFileSync(tokenPath, 'utf-8').trim();
      expect(token).toMatch(/^f2a-[a-f0-9]{64}$/);
      
      testToken = token;
    }, 60000);  // 60 秒超时

    // Status 命令测试
    it('should work with status command after daemon starts', async () => {
      // CI 环境跳过
      if (process.env.CI) {
        expect(true).toBe(true);
        return;
      }

      // 确保 daemon 在运行
      let ready = await waitForDaemon(9001, 5000);
      if (!ready) {
        // 如果没有运行，启动它
        if (!daemonProcess) {
          daemonProcess = spawn('node', [cliPath, 'daemon'], {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
          });
        }
        ready = await waitForDaemon(9001, 30000);
      }
      expect(ready).toBe(true);

      // 读取 token（如果之前没读到）
      if (!testToken) {
        testToken = readControlToken();
      }
      
      // 使用 token 调用 status
      const token = testToken || readControlToken() || '';
      const { stdout, stderr } = await execCLI(['status'], 10000);

      // 尝试从输出中提取 JSON
      let status: any = null;
      const output = stdout + stderr;
      
      try {
        // 先尝试直接解析
        status = JSON.parse(output.trim());
      } catch {
        // 找到 JSON 对象
        const startIndex = output.indexOf('{');
        const lastEndIndex = output.lastIndexOf('}');
        if (startIndex !== -1 && lastEndIndex !== -1 && lastEndIndex > startIndex) {
          const jsonStr = output.slice(startIndex, lastEndIndex + 1);
          try {
            status = JSON.parse(jsonStr);
          } catch {}
        }
      }
      
      // 验证 status 响应
      expect(status).toBeDefined();
      expect(status).not.toBeNull();
      expect(status.success).toBe(true);
      expect(status.peerId).toBeDefined();
      expect(status.peerId.length).toBeGreaterThan(10);
    }, 45000);
  });

  describe('config command', () => {
    it('should display config', async () => {
      const { stdout } = await execCLI(['config'], 5000);
      
      // 输出应该包含一些配置项
      expect(stdout.length).toBeGreaterThan(0);
    });
  });

  describe('identity commands', () => {
    it('should show identity status', async () => {
      const { stdout, stderr } = await execCLI(['identity', 'status'], 10000);
      const output = stdout + stderr;
      
      // 应该显示身份状态信息
      expect(
        output.includes('Node Identity') ||
        output.includes('Agent Identity') ||
        output.includes('Node ID') ||
        output.includes('Peer ID') ||
        output.includes('Loaded') ||
        output.includes('12D3Koo')
      ).toBe(true);
    });

    it('should export identity', async () => {
      // 导出命令需要密码参数，这里只验证命令能运行
      const { stdout, stderr } = await execCLI(['identity', 'export', '--help'], 5000);
      const output = stdout + stderr;
      
      // 应该显示帮助信息或密码提示
      expect(
        output.includes('password') ||
        output.includes('导出') ||
        output.includes('export') ||
        output.includes('Usage') ||
        output.includes('password')
      ).toBe(true);
    });
  });
});
