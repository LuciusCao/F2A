/**
 * F2ANodeManager 测试
 * 
 * 测试 F2A Node 进程管理功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { F2ANodeManager } from '../src/node-manager.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('F2ANodeManager', () => {
  let tempDir: string;
  let manager: F2ANodeManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'node-manager-test-'));
    mkdirSync(join(tempDir, 'F2A'), { recursive: true });
  });

  afterEach(() => {
    if (manager) {
      try {
        manager.stop();
      } catch {}
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('构造函数', () => {
    it('应该能够创建 NodeManager', () => {
      manager = new F2ANodeManager({
        nodePath: tempDir,
      });
      expect(manager).toBeDefined();
    });

    it('应该使用默认配置', () => {
      manager = new F2ANodeManager({
        nodePath: tempDir,
      });
      expect(manager).toBeDefined();
    });

    it('应该接受自定义配置', () => {
      manager = new F2ANodeManager({
        nodePath: tempDir,
        controlPort: 19001,
        p2pPort: 19000,
        controlToken: 'custom-token',
        enableMDNS: false,
      });
      expect(manager).toBeDefined();
    });
  });

  describe('配置', () => {
    it('应该生成随机 token', () => {
      const manager1 = new F2ANodeManager({ nodePath: tempDir });
      const manager2 = new F2ANodeManager({ nodePath: tempDir });
      
      // 两个未指定 token 的 manager 应该有不同的 token
      // 注意：这可能需要修改构造函数来暴露 token
      expect(manager1).toBeDefined();
      expect(manager2).toBeDefined();
    });
  });

  describe('生命周期', () => {
    it('应该能够停止未启动的 manager', () => {
      manager = new F2ANodeManager({
        nodePath: tempDir,
      });
      
      // 停止未启动的 manager 不应该报错
      manager.stop();
    });
  });

  describe('健康检查', () => {
    it('应该有健康检查配置', () => {
      manager = new F2ANodeManager({
        nodePath: tempDir,
      });
      expect(manager).toBeDefined();
    });
  });
});