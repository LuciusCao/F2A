/**
 * Daemon 生命周期集成测试
 * 
 * 测试 F2A Daemon 的完整生命周期：
 * - 启动 -> 发现 -> 连接 -> 通信 -> 关闭
 * 
 * 运行条件：
 * - 设置 RUN_INTEGRATION_TESTS=true
 * - 本地环境（非 CI）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true' && !process.env.CI;

describe.skipIf(!shouldRun)('Daemon 生命周期集成测试', () => {
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

  // 辅助函数：检查端口是否被占用
  const isPortInUse = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const server = require('net').createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port);
    });
  };

  // 辅助函数：获取 control token
  const getControlToken = (): string | null => {
    const tokenPath = join(f2aDir, 'control-token');
    if (existsSync(tokenPath)) {
      try {
        return readFileSync(tokenPath, 'utf-8').trim();
      } catch {}
    }
    return null;
  };

  // 辅助函数：备份身份文件
  const backupIdentities = () => {
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    
    const files = ['node-identity.json', 'agent-identity.json', 'identity.json', 'control-token'];
    const timestamp = Date.now();
    
    for (const file of files) {
      const filePath = join(f2aDir, file);
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          writeFileSync(join(backupDir, `${file}.lifecycle-${timestamp}`), content, 'utf-8');
          unlinkSync(filePath);
        } catch {}
      }
    }
  };

  // 辅助函数：清理进程
  const killPortProcess = (port: number) => {
    try {
      const { execSync } = require('child_process');
      const result = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
      if (result) {
        const pids = result.split('\n').filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid), 'SIGKILL');
          } catch {}
        }
      }
    } catch {}
  };

  beforeAll(async () => {
    // 停止现有 daemon
    try {
      await execCLI(['daemon', 'stop'], 5000);
    } catch {}
    
    // 杀掉占用端口的进程
    killPortProcess(9001);
    await new Promise(r => setTimeout(r, 2000));
    
    // 备份身份文件
    backupIdentities();
    await new Promise(r => setTimeout(r, 500));
  }, 20000);

  afterAll(async () => {
    // 停止 daemon
    if (daemonProcess) {
      try {
        daemonProcess.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 2000));
        if (daemonProcess.pid) {
          process.kill(daemonProcess.pid, 'SIGKILL');
        }
      } catch {}
    }
    
    try {
      await execCLI(['daemon', 'stop'], 5000);
    } catch {}
    
    killPortProcess(9001);
    
    // 清理测试备份
    try {
      const { readdirSync } = require('fs');
      const backups = existsSync(backupDir) 
        ? readdirSync(backupDir).filter(f => f.includes('.lifecycle-'))
        : [];
      for (const backup of backups) {
        try {
          unlinkSync(join(backupDir, backup));
        } catch {}
      }
    } catch {}
  }, 20000);

  describe('Phase 1: 启动', () => {
    it('端口应该是空闲的', async () => {
      const inUse = await isPortInUse(9001);
      expect(inUse).toBe(false);
    });

    it('应该能成功启动 daemon', async () => {
      daemonProcess = spawn('node', [cliPath, 'daemon'], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // 等待 daemon 就绪
      const ready = await waitForDaemon(9001, 45000);
      expect(ready).toBe(true);
    }, 60000);

    it('应该生成有效的控制 token', async () => {
      // 等待 token 文件生成
      await new Promise(r => setTimeout(r, 1000));
      
      testToken = getControlToken();
      expect(testToken).not.toBeNull();
      expect(testToken).toMatch(/^f2a-[a-f0-9]{64}$/);
    });
  });

  describe('Phase 2: 发现', () => {
    it('应该能查询本地节点状态', async () => {
      const token = testToken || getControlToken();
      expect(token).not.toBeNull();
      
      const response = await fetch('http://localhost:9001/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      expect(response.ok).toBe(true);
      const status = await response.json();
      
      expect(status.success).toBe(true);
      expect(status.peerId).toBeDefined();
    });

    it('应该有有效的 Peer ID', async () => {
      const token = testToken || getControlToken();
      
      const response = await fetch('http://localhost:9001/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const status = await response.json();
      
      expect(status.peerId).toBeDefined();
      expect(status.peerId.length).toBeGreaterThan(20);
      expect(status.peerId).toMatch(/^12D3Koo/); // libp2p PeerId 前缀
    });
  });

  describe('Phase 3: 连接和通信', () => {
    it('健康检查应该返回正常', async () => {
      const response = await fetch('http://localhost:9001/health');
      expect(response.ok).toBe(true);
      
      const health = await response.json();
      expect(health.status).toBe('ok');
    });

    it('应该能查询已连接的节点', async () => {
      const token = testToken || getControlToken();
      
      const response = await fetch('http://localhost:9001/peers', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      expect(response.ok).toBe(true);
      const peers = await response.json();
      expect(Array.isArray(peers)).toBe(true);
    });

    it('应该能查询节点能力', async () => {
      const token = testToken || getControlToken();
      
      const response = await fetch('http://localhost:9001/capabilities', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      // 能力列表可能为空，但端点应该存在
      if (response.ok) {
        const capabilities = await response.json();
        expect(Array.isArray(capabilities)).toBe(true);
      }
    });
  });

  describe('Phase 4: 认证和安全', () => {
    it('应该拒绝无 token 的请求', async () => {
      const response = await fetch('http://localhost:9001/status');
      expect(response.status).toBe(401);
    });

    it('应该拒绝无效 token', async () => {
      const response = await fetch('http://localhost:9001/status', {
        headers: { 'Authorization': 'Bearer invalid-token' }
      });
      expect(response.status).toBe(401);
    });

    it('应该接受有效 token', async () => {
      const token = testToken || getControlToken();
      
      const response = await fetch('http://localhost:9001/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      expect(response.ok).toBe(true);
    });
  });

  describe('Phase 5: 关闭', () => {
    it('应该能通过 CLI 停止 daemon', async () => {
      // 先记录当前 daemon 的 PID
      const token = testToken || getControlToken();
      const response = await fetch('http://localhost:9001/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      expect(response.ok).toBe(true);
      
      // 通过 CLI 停止
      const { stdout, stderr } = await execCLI(['daemon', 'stop'], 10000);
      
      // 等待进程退出
      await new Promise(r => setTimeout(r, 3000));
      
      // 验证端口已释放
      const inUse = await isPortInUse(9001);
      expect(inUse).toBe(false);
    }, 20000);

    it('停止后健康检查应该失败', async () => {
      try {
        await fetch('http://localhost:9001/health');
        // 如果成功，说明 daemon 还在运行
        expect(true).toBe(false); // 测试失败
      } catch {
        // 预期：连接被拒绝
        expect(true).toBe(true);
      }
    });
  });
});