import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * CLI 入口功能验证测试
 *
 * 验证移除 API 导出后，CLI 功能仍然正常工作
 * 使用子进程运行 CLI 命令进行真实功能测试
 */
describe('CLI Entry Functionality', () => {
  const cliPath = join(__dirname, '..', 'dist', 'main.js');

  describe('--help 命令', () => {
    it('should output help information', async () => {
      const result = await runCli(['--help']);

      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('Commands');
      expect(result.stdout).toContain('agent');
      expect(result.stdout).toContain('daemon');
      expect(result.stdout).toContain('message');
      expect(result.stdout).toContain('identity');
      expect(result.code).toBe(0);
    });

    it('should show help when called with -h', async () => {
      const result = await runCli(['-h']);

      expect(result.stdout).toContain('Usage');
      expect(result.code).toBe(0);
    });

    it('should show help when called with no arguments', async () => {
      const result = await runCli([]);

      expect(result.stdout).toContain('Usage');
      expect(result.code).toBe(0);
    });
  });

  describe('--version 命令', () => {
    it('should output version number', async () => {
      const result = await runCli(['--version']);

      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
      expect(result.code).toBe(0);
    });

    it('should show version when called with -v', async () => {
      const result = await runCli(['-v']);

      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
      expect(result.code).toBe(0);
    });
  });

  describe('子命令帮助', () => {
    it('should show agent subcommand help', async () => {
      const result = await runCli(['agent', '--help']);

      expect(result.stdout).toContain('Agent 管理');
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('register');
      expect(result.stdout).toContain('unregister');
      expect(result.code).toBe(0);
    });

    it('should show daemon subcommand help', async () => {
      const result = await runCli(['daemon', '--help']);

      expect(result.stdout).toContain('Daemon 管理');
      expect(result.stdout).toContain('start');
      expect(result.stdout).toContain('stop');
      expect(result.stdout).toContain('restart');
      expect(result.stdout).toContain('status');
      expect(result.stdout).toContain('foreground');
      expect(result.code).toBe(0);
    });

    it('should show message subcommand help', async () => {
      const result = await runCli(['message', '--help']);

      expect(result.stdout).toContain('消息管理');
      expect(result.stdout).toContain('send');
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('clear');
      expect(result.code).toBe(0);
    });

    it('should show identity subcommand help', async () => {
      const result = await runCli(['identity', '--help']);

      expect(result.stdout).toContain('身份管理');
      expect(result.stdout).toContain('status');
      expect(result.stdout).toContain('export');
      expect(result.stdout).toContain('import');
      expect(result.code).toBe(0);
    });
  });

  describe('错误处理', () => {
    it('should handle unknown command with error', async () => {
      const result = await runCli(['unknown-command']);

      expect(result.stderr).toContain('未知的命令');
      expect(result.code).toBe(1);
    });

    it('should handle unknown subcommand with error', async () => {
      const result = await runCli(['agent', 'unknown']);

      expect(result.stderr).toContain('未知的 agent 子命令');
      expect(result.code).toBe(1);
    });

    it('should show help after error message', async () => {
      const result = await runCli(['unknown-command']);

      expect(result.stderr).toContain('未知的命令');
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('Commands');
    });
  });

  describe('需要 daemon 的命令（无 daemon 时）', () => {
    it('should handle node status command without daemon', async () => {
      const result = await runCli(['node', 'status']);

      // 无 daemon 时应显示连接错误
      expect(result.stderr).toMatch(/无法连接|Failed to connect|Connection failed|Daemon/);
    });

    it('should handle node peers command without daemon', async () => {
      const result = await runCli(['node', 'peers']);

      expect(result.stderr).toMatch(/无法连接|Failed to connect|Connection failed|Daemon/);
    });

    it('should handle agent list without daemon', async () => {
      const result = await runCli(['agent', 'list']);

      expect(result.stderr).toMatch(/无法连接|Failed to connect|Connection failed|Daemon/);
    });
  });
});

/**
 * 运行 CLI 命令的辅助函数
 */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const cliPath = join(__dirname, '..', 'dist', 'main.js');

    const proc = spawn('node', [cliPath, ...args], {
      env: { ...process.env, F2A_CONTROL_PORT: '9999' } // 使用不存在的端口避免连接真实 daemon
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}