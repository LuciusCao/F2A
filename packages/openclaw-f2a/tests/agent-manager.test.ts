/**
 * AgentManager 测试
 * 
 * 测试 Agent 身份管理功能。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentManager } from '../src/agent-manager.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('AgentManager', () => {
  let tempDir: string;
  let manager: AgentManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-manager-test-'));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('构造函数', () => {
    it('应该能够创建 AgentManager', () => {
      manager = new AgentManager(tempDir);
      expect(manager).toBeDefined();
    });

    it('应该自动创建 Agent 身份', () => {
      manager = new AgentManager(tempDir);
      const identity = manager.getIdentity();
      expect(identity).toBeDefined();
      expect(identity?.agentId).toBeDefined();
    });

    it('应该使用配置的 Agent 名称', () => {
      manager = new AgentManager(tempDir, { name: 'TestAgent' });
      const name = manager.getAgentName();
      expect(name).toBe('TestAgent');
    });

    it('应该使用配置的 Agent ID', () => {
      manager = new AgentManager(tempDir, { id: 'test-agent-123' });
      const agentId = manager.getAgentId();
      expect(agentId).toBe('test-agent-123');
    });
  });

  describe('身份获取', () => {
    beforeEach(() => {
      manager = new AgentManager(tempDir);
    });

    it('应该能够获取 Agent 身份', () => {
      const identity = manager.getIdentity();
      expect(identity).not.toBeNull();
      expect(identity?.agentId).toBeDefined();
      expect(identity?.name).toBeDefined();
      expect(identity?.createdAt).toBeDefined();
    });

    it('应该能够获取 Agent ID', () => {
      const agentId = manager.getAgentId();
      expect(agentId).not.toBeNull();
      expect(typeof agentId).toBe('string');
    });

    it('应该能够获取 Agent 名称', () => {
      const name = manager.getAgentName();
      expect(name).toBeDefined();
      expect(typeof name).toBe('string');
    });
  });

  describe('持久化', () => {
    it('应该持久化 Agent 身份', () => {
      manager = new AgentManager(tempDir, { name: 'PersistentAgent' });
      const agentId = manager.getAgentId();

      // 创建新的 manager 应该加载相同的身份
      const manager2 = new AgentManager(tempDir);
      expect(manager2.getAgentId()).toBe(agentId);
      expect(manager2.getAgentName()).toBe('PersistentAgent');
    });

    it('应该在文件中保存身份', () => {
      manager = new AgentManager(tempDir);
      
      const agentFile = join(tempDir, 'agent.json');
      expect(existsSync(agentFile)).toBe(true);
    });
  });

  describe('异步初始化', () => {
    it('应该支持异步初始化', async () => {
      manager = new AgentManager(tempDir);
      const identity = await manager.initialize();
      expect(identity).toBeDefined();
    });
  });
});