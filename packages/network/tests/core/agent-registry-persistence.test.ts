/**
 * Agent Registry Persistence Tests
 * 
 * 测试 Agent 注册表的持久化功能（同步版本）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentRegistry, type AgentRegistrationRequest, AGENT_REGISTRY_FILE } from '../../src/core/agent-registry.js';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

// 测试用的临时目录
const TEST_DIR = join(tmpdir(), 'agent-registry-persistence-test');

// Mock PeerId 和签名函数
const mockPeerId = '12D3KooGTestPeerId123456789abcdef';
const mockSignFunction = vi.fn((data: string) => `signature-${data.slice(0, 8)}`);

// Helper: 创建基本注册请求
function createRegistrationRequest(name: string = 'Test Agent'): AgentRegistrationRequest {
  return {
    name,
    capabilities: [
      { name: 'test-capability', description: 'Test capability' }
    ],
    metadata: { test: true }
  };
}

describe('AgentRegistry Persistence', () => {
  let testId: string;
  let testDir: string;

  beforeEach(() => {
    // 为每个测试生成唯一ID
    testId = `test-${Date.now()}-${randomBytes(4).toString('hex')}`;
    testDir = join(TEST_DIR, testId);
    
    // 创建测试目录
    mkdirSync(testDir, { recursive: true });
    
    mockSignFunction.mockClear();
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('auto-save on operations', () => {
    it('should auto-save after register', () => {
      const registry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      registry.register(createRegistrationRequest('Agent 1'));
      
      // 验证文件已创建
      const filePath = join(testDir, AGENT_REGISTRY_FILE);
      expect(existsSync(filePath)).toBe(true);
      
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.agents.length).toBe(1);
      expect(content.agents[0].name).toBe('Agent 1');
    });

    it('should auto-save after unregister', () => {
      const registry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      const agent = registry.register(createRegistrationRequest('Agent 1'));
      
      // 注销
      registry.unregister(agent.agentId);
      
      // 验证文件已更新
      const filePath = join(testDir, AGENT_REGISTRY_FILE);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.agents.length).toBe(0);
    });

    it('should auto-save after updateName', () => {
      const registry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      const agent = registry.register(createRegistrationRequest('Agent 1'));
      
      // 更新名称
      registry.updateName(agent.agentId, 'Agent Updated');
      
      // 验证文件已更新
      const filePath = join(testDir, AGENT_REGISTRY_FILE);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.agents[0].name).toBe('Agent Updated');
    });
  });

  describe('auto-load on startup', () => {
    it('should load persisted agents on creation', () => {
      // 先写入一个持久化文件
      const persistedData = {
        version: 1,
        agents: [
          {
            agentId: `agent:${mockPeerId.slice(0, 16)}:existing1234`,
            name: 'Existing Agent',
            capabilities: [{ name: 'existing-capability', description: 'Existing' }],
            peerId: mockPeerId,
            signature: 'test-signature',
            registeredAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
          }
        ],
        savedAt: new Date().toISOString(),
      };
      
      const filePath = join(testDir, AGENT_REGISTRY_FILE);
      writeFileSync(filePath, JSON.stringify(persistedData, null, 2), 'utf-8');
      
      // 创建新的 registry（应该自动加载）
      const registry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      
      // 验证已加载
      const agents = registry.list();
      expect(agents.length).toBe(1);
      expect(agents[0].name).toBe('Existing Agent');
    });

    it('should start fresh when no persisted file', () => {
      const registry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      expect(registry.list().length).toBe(0);
    });
  });

  describe('save/load cycle', () => {
    it('should preserve all agent data through save/load', () => {
      // 注册 Agent
      const registry1 = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      const agent1 = registry1.register({
        name: 'Agent 1',
        capabilities: [{ name: 'cap1', description: 'Cap 1' }],
        metadata: { key: 'value' },
      });
      
      // 创建新的 registry（应该加载）
      const registry2 = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      
      // 验证数据完整
      const loadedAgent = registry2.get(agent1.agentId);
      expect(loadedAgent).toBeDefined();
      expect(loadedAgent!.name).toBe('Agent 1');
      expect(loadedAgent!.capabilities.length).toBe(1);
      expect(loadedAgent!.metadata).toEqual({ key: 'value' });
      // 注意：onMessage 无法恢复（无法序列化）
    });

    it('should handle multiple agents', () => {
      const registry1 = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      registry1.register({ name: 'Agent 1', capabilities: [] });
      registry1.register({ name: 'Agent 2', capabilities: [] });
      registry1.register({ name: 'Agent 3', capabilities: [] });
      
      // 创建新的 registry
      const registry2 = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      
      expect(registry2.list().length).toBe(3);
    });
  });

  describe('persistence disabled', () => {
    it('should not save/load when persistence disabled', () => {
      const registry = new AgentRegistry(mockPeerId, mockSignFunction, {
        dataDir: testDir,
        enablePersistence: false,
      });
      
      registry.register(createRegistrationRequest('Agent 1'));
      
      // 文件不应该创建
      const filePath = join(testDir, AGENT_REGISTRY_FILE);
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe('date serialization', () => {
    it('should serialize Date objects to ISO strings', () => {
      const registry = new AgentRegistry(mockPeerId, mockSignFunction, { dataDir: testDir });
      registry.register(createRegistrationRequest('Agent 1'));
      
      const filePath = join(testDir, AGENT_REGISTRY_FILE);
      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      
      expect(typeof content.agents[0].registeredAt).toBe('string');
      expect(typeof content.agents[0].lastActiveAt).toBe('string');
      expect(new Date(content.agents[0].registeredAt).toISOString()).toBe(content.agents[0].registeredAt);
    });
  });
});