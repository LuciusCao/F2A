import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * main.ts 测试 - 命令路由测试
 * 
 * 测试策略：
 * - 使用子进程运行 CLI 命令
 * - Mock HTTP 请求验证参数传递
 * - 测试正常路径、错误路径和边界情况
 */
describe('CLI Main Entry (main.ts)', () => {
  const cliPath = join(__dirname, '..', 'dist', 'main.js');

  describe('命令路由正确性', () => {
    describe('--help 显示帮助', () => {
      it('should display help when called with --help flag', async () => {
        const result = await runCli(['--help']);
        
        // 验证：输出包含 "Usage" 和 "Commands"
        expect(result.stdout).toContain('Usage');
        expect(result.stdout).toContain('Commands');
        expect(result.code).toBe(0);
      });

      it('should display help when called with -h flag', async () => {
        const result = await runCli(['-h']);
        
        expect(result.stdout).toContain('Usage');
        expect(result.stdout).toContain('Commands');
        expect(result.code).toBe(0);
      });

      it('should display help when called with no arguments', async () => {
        const result = await runCli([]);
        
        expect(result.stdout).toContain('Usage');
        expect(result.stdout).toContain('Commands');
        expect(result.code).toBe(0);
      });

      it('should show all available commands in help', async () => {
        const result = await runCli(['--help']);
        
        // 验证主要命令出现在帮助中
        expect(result.stdout).toContain('node');
        expect(result.stdout).toContain('agent');
        expect(result.stdout).toContain('message');
        expect(result.stdout).toContain('daemon');
        expect(result.stdout).toContain('identity');
      });
    });

    describe('daemon 子命令帮助', () => {
      it('should show daemon subcommands including restart', async () => {
        const result = await runCli(['daemon', '--help']);
        
        expect(result.stdout).toContain('start');
        expect(result.stdout).toContain('stop');
        expect(result.stdout).toContain('restart');
        expect(result.stdout).toContain('status');
        expect(result.stdout).toContain('foreground');
        expect(result.code).toBe(0);
      });
    });

    describe('--version 显示版本', () => {
      it('should display version when called with --version flag', async () => {
        const result = await runCli(['--version']);
        
        // 验证版本格式：x.y.z
        expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
        expect(result.code).toBe(0);
      });

      it('should display version when called with -v flag', async () => {
        const result = await runCli(['-v']);
        
        expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
        expect(result.code).toBe(0);
      });

      it('should display correct version from package.json', async () => {
        const result = await runCli(['--version']);
        
        // 版本应与 package.json 一致（动态读取）
        const { readFileSync } = await import('fs');
        const pkgPath = join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        expect(result.stdout.trim()).toBe(pkg.version);
      });
    });

    describe('子命令路由', () => {
      // 这些测试需要 daemon 运行，所以主要验证命令格式和错误处理
      
      it('should attempt to send node status command without daemon', async () => {
        const result = await runCli(['node', 'status']);
        
        // 无 daemon 时应显示连接错误（中文或英文）
        expect(result.stderr).toMatch(/无法连接|Failed to connect|Connection failed/);
        expect(result.stderr).toMatch(/daemon|Daemon/);
      });

      it('should attempt to send node peers command without daemon', async () => {
        const result = await runCli(['node', 'peers']);
        
        expect(result.stderr).toMatch(/无法连接|Failed to connect|Connection failed/);
      });

      it('should handle node init command (may show deprecation notice)', async () => {
        const result = await runCli(['node', 'init']);
        
        // node init 命令可能显示废弃提示或连接错误
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/废弃|daemon|Daemon|无法连接|Failed to connect|Connection failed|Node Identity/);
      });
    });

    describe('无效命令显示错误', () => {
      it('should handle unknown command gracefully', async () => {
        const result = await runCli(['unknown-command-xyz']);
        
        // 应该显示未知命令错误或尝试连接 daemon
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/未知|Unknown|无法连接|Failed to connect/);
      });

      it('should pass through any command to daemon', async () => {
        const result = await runCli(['some-random-command']);
        
        // 主入口可能直接报错或尝试连接
        const combined = result.stdout + result.stderr;
        expect(combined).toMatch(/未知|Unknown|无法连接|Failed to connect|daemon/);
      });
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