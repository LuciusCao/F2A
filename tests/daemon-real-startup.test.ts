import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { F2ADaemon } from '../src/daemon/index.js';

/**
 * Daemon 真实启动测试
 * 不使用 mock，验证实际功能
 */
describe('Daemon Real Startup', () => {
  const testDir = join(tmpdir(), `f2a-test-${Date.now()}`);
  let daemon: F2ADaemon | null = null;

  beforeEach(() => {
    // 创建临时测试目录
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理 daemon
    if (daemon?.isRunning()) {
      await daemon.stop();
    }
    daemon = null;
    
    // 清理临时目录
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('should generate control token on startup', async () => {
    const controlPort = 19001; // 使用高位端口避免冲突
    
    daemon = new F2ADaemon({
      controlPort,
      dataDir: testDir,
    });

    await daemon.start();

    // 验证 token 文件已生成
    const tokenPath = join(testDir, 'control-token');
    expect(existsSync(tokenPath)).toBe(true);
    
    const token = readFileSync(tokenPath, 'utf-8');
    expect(token).toMatch(/^f2a-[a-f0-9]{64}$/); // 验证格式
  });

  it('should create log file on startup', async () => {
    const controlPort = 19002;
    
    daemon = new F2ADaemon({
      controlPort,
      dataDir: testDir,
    });

    await daemon.start();

    // 验证日志文件已创建
    const logPath = join(testDir, 'f2a.log');
    expect(existsSync(logPath)).toBe(true);
  });

  it('should start HTTP control server on specified port', async () => {
    const controlPort = 19003;
    
    daemon = new F2ADaemon({
      controlPort,
      dataDir: testDir,
    });

    await daemon.start();

    // 验证 HTTP 服务可达
    const response = await fetch(`http://localhost:${controlPort}/health`);
    expect(response.status).toBe(200);
    
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.peerId).toBeDefined();
  });

  it('should respond to status endpoint with auth', async () => {
    const controlPort = 19004;
    
    daemon = new F2ADaemon({
      controlPort,
      dataDir: testDir,
    });

    await daemon.start();

    // 读取 token
    const tokenPath = join(testDir, 'control-token');
    const token = readFileSync(tokenPath, 'utf-8');

    // 验证带 token 的请求成功
    const response = await fetch(`http://localhost:${controlPort}/status`, {
      headers: { 'X-F2A-Token': token },
    });
    expect(response.status).toBe(200);
    
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.peerId).toBeDefined();
  });

  it('should reject status request without token', async () => {
    const controlPort = 19005;
    
    daemon = new F2ADaemon({
      controlPort,
      dataDir: testDir,
    });

    await daemon.start();

    // 验证无 token 请求被拒绝
    const response = await fetch(`http://localhost:${controlPort}/status`);
    expect(response.status).toBe(401);
  });
});
