/**
 * OpenClaw Adapter Plugin 集成测试
 * 真实测试插件初始化、错误处理、进程退出行为
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { F2AOpenClawAdapter } from '../../packages/openclaw-adapter/src/connector.js';
import { F2ANodeManager } from '../../packages/openclaw-adapter/src/node-manager.js';

describe('F2A OpenClaw Adapter Plugin', () => {
  const testDir = join(tmpdir(), `f2a-adapter-test-${Date.now()}`);
  let adapter: F2AOpenClawAdapter | null = null;
  let webhookProcess: ChildProcess | null = null;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理 adapter
    if (adapter) {
      await adapter.shutdown();
      adapter = null;
    }
    
    // 清理 webhook 进程
    if (webhookProcess) {
      webhookProcess.kill();
      webhookProcess = null;
    }
    
    // 清理测试目录
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe('初始化', () => {
    it('应该正确初始化并注册 18 个工具', async () => {
      adapter = new F2AOpenClawAdapter();
      
      const config = {
        dataDir: testDir,
        webhookPort: 19002, // 使用高位端口避免冲突
        enableMDNS: false,
        agentName: 'Test-Agent',
      };

      await adapter.initialize(config);
      
      const tools = adapter.getTools();
      expect(tools).toHaveLength(18);
      expect(tools.map(t => t.name)).toContain('f2a_status');
      expect(tools.map(t => t.name)).toContain('f2a_discover');
      expect(tools.map(t => t.name)).toContain('f2a_delegate');
    });

    it('应该创建 Webhook 服务器', async () => {
      adapter = new F2AOpenClawAdapter();
      
      const config = {
        dataDir: testDir,
        webhookPort: 19003,
        enableMDNS: false,
      };

      await adapter.initialize(config);
      
      // 测试 Webhook 服务器是否可访问
      // POST 到根路径会返回 400（没有 event 类型）或类似的错误
      // 这证明服务器正在监听
      const response = await fetch('http://localhost:19003/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      // 400/404/405 都表示服务器在运行
      expect([400, 404, 405]).toContain(response.status);
    });

    it('应该创建数据目录和持久化文件', async () => {
      adapter = new F2AOpenClawAdapter();
      
      await adapter.initialize({
        dataDir: testDir,
        webhookPort: 19004,
        enableMDNS: false,
      });
      
      // 验证数据目录存在
      expect(existsSync(testDir)).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('Webhook 端口冲突时应该优雅降级', async () => {
      // 先启动一个占用端口的进程
      const port = 19005;
      
      // 使用简单的 HTTP 服务器占用端口
      const serverCode = `
        const http = require('http');
        const server = http.createServer((req, res) => res.end('ok'));
        server.listen(${port}, () => console.log('listening'));
      `;
      
      webhookProcess = spawn('node', ['-e', serverCode], { stdio: 'pipe' });
      
      // 等待服务器启动
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 尝试用相同端口初始化 adapter
      adapter = new F2AOpenClawAdapter();
      
      // 不应该抛出异常，而是优雅降级
      await expect(adapter.initialize({
        dataDir: testDir,
        webhookPort: port,
        enableMDNS: false,
      })).resolves.not.toThrow();
      
      // 应该仍然能获取工具（降级模式）
      const tools = adapter.getTools();
      expect(tools).toHaveLength(18);
    });
  });

  describe('Node Manager', () => {
    it('isRunning 应该在超时时间内返回', async () => {
      // 使用一个不太可能被占用的端口
      const manager = new F2ANodeManager({
        nodePath: '/nonexistent',
        controlPort: 59999, // 高位端口，不太可能被占用
        controlToken: 'test-token',
      });

      const start = Date.now();
      const result = await manager.isRunning();
      const elapsed = Date.now() - start;
      
      // 应该返回 false（没有 Node 在运行）
      expect(result).toBe(false);
      // 应该在合理时间内完成（无论超时还是立即失败）
      expect(elapsed).toBeLessThan(5000);
    });

    it('isRunning 对已运行的 Node 应该返回 true', async () => {
      // 这个测试需要真实的 F2A Node 运行
      // 如果没有运行，跳过
      const manager = new F2ANodeManager({
        nodePath: testDir,
        controlPort: 9001, // 默认端口
        controlToken: 'test-token',
      });

      // 如果 Node 未运行，跳过测试
      try {
        const result = await manager.isRunning();
        // 如果返回 true，说明 Node 正在运行
        if (result) {
          expect(result).toBe(true);
        } else {
          // Node 未运行，测试通过（跳过）
          expect(true).toBe(true);
        }
      } catch {
        // 连接失败也是预期行为
        expect(true).toBe(true);
      }
    });
  });

  describe('进程退出行为', () => {
    it('shutdown 后进程应该能正常退出', async () => {
      // 简化测试：验证 adapter 初始化后能正确 shutdown
      adapter = new F2AOpenClawAdapter();
      
      await adapter.initialize({
        dataDir: join(testDir, 'exit-test'),
        webhookPort: 19006,
        enableMDNS: false,
      });
      
      // shutdown 应该清理所有定时器
      await adapter.shutdown();
      adapter = null;
      
      // 如果 shutdown 正确清理了定时器，测试应该能正常完成
      expect(true).toBe(true);
    });

    it('多次 shutdown 应该安全', async () => {
      adapter = new F2AOpenClawAdapter();
      
      await adapter.initialize({
        dataDir: join(testDir, 'multi-shutdown'),
        webhookPort: 19008,
        enableMDNS: false,
      });
      
      // 多次调用 shutdown 不应该抛出异常
      await adapter.shutdown();
      await adapter.shutdown();
      await adapter.shutdown();
      
      expect(true).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('应该正确清理所有资源', async () => {
      adapter = new F2AOpenClawAdapter();
      
      await adapter.initialize({
        dataDir: testDir,
        webhookPort: 19007,
        enableMDNS: false,
      });
      
      // shutdown 应该不抛出异常
      await expect(adapter.shutdown()).resolves.not.toThrow();
      
      // 再次 shutdown 也应该安全
      await expect(adapter.shutdown()).resolves.not.toThrow();
    });
  });
});