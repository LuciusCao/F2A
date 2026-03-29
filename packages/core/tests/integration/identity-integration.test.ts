/**
 * Phase 1 Identity Integration Tests
 * 
 * 测试 Node/Agent Identity 系统集成到 F2A
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { F2A } from '../../src/core/f2a.js';
import { NodeIdentityManager } from '../../src/core/identity/node-identity.js';
import { AgentIdentityManager } from '../../src/core/identity/agent-identity.js';
import { IdentityDelegator } from '../../src/core/identity/delegator.js';

// 测试数据目录
const TEST_DATA_DIR = join(homedir(), '.f2a-test-identity-integration');

describe('Phase 1 Identity Integration', () => {
  beforeAll(async () => {
    // 清理测试目录
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterAll(async () => {
    // 清理测试目录
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  describe('Node Identity', () => {
    it('should create and load node identity', async () => {
      const nodeManager = new NodeIdentityManager({ dataDir: TEST_DATA_DIR });
      
      const result = await nodeManager.loadOrCreate();
      
      expect(result.success).toBe(true);
      expect(nodeManager.getNodeId()).toBeTruthy();
      expect(nodeManager.getPeerIdString()).toBeTruthy();
      expect(nodeManager.isNodeLoaded()).toBe(true);
    });

    it('should persist node identity across restarts', async () => {
      // 第一次创建
      const nodeManager1 = new NodeIdentityManager({ dataDir: TEST_DATA_DIR });
      await nodeManager1.loadOrCreate();
      const nodeId1 = nodeManager1.getNodeId();
      
      // 第二次加载（模拟重启）
      const nodeManager2 = new NodeIdentityManager({ dataDir: TEST_DATA_DIR });
      await nodeManager2.loadOrCreate();
      const nodeId2 = nodeManager2.getNodeId();
      
      expect(nodeId1).toBe(nodeId2);
    });
  });

  describe('Agent Identity', () => {
    let nodeManager: NodeIdentityManager;
    let delegator: IdentityDelegator;

    beforeEach(async () => {
      nodeManager = new NodeIdentityManager({ dataDir: TEST_DATA_DIR });
      await nodeManager.loadOrCreate();
      delegator = new IdentityDelegator(nodeManager, TEST_DATA_DIR);
    });

    it('should create agent identity with valid name', async () => {
      const result = await delegator.createAgent({
        name: 'Test-Agent-001',
        capabilities: ['test-capability']
      });

      expect(result.success).toBe(true);
      expect(result.data.agentIdentity).toBeTruthy();
      expect(result.data.agentIdentity.name).toBe('Test-Agent-001');
      expect(result.data.agentIdentity.capabilities).toContain('test-capability');
      expect(result.data.agentIdentity.nodeId).toBe(nodeManager.getNodeId());
      expect(result.data.agentPrivateKey).toBeTruthy();
    });

    it('should reject invalid agent name', async () => {
      const result = await delegator.createAgent({
        name: 'Invalid Agent Name!',  // 包含空格和特殊字符
        capabilities: []
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AGENT_IDENTITY_INVALID_NAME');
    });

    it('should load existing agent identity', async () => {
      // 创建
      const createResult = await delegator.createAgent({
        name: 'PersistentAgent',
        capabilities: []
      });
      expect(createResult.success).toBe(true);

      // 加载 - 使用相同的 dataDir
      const agentManager = new AgentIdentityManager(TEST_DATA_DIR);
      const loadResult = await agentManager.loadAgentIdentity();
      
      expect(loadResult.success).toBe(true);
      expect(loadResult.data.name).toBe('PersistentAgent');
    });
  });

  describe('F2A Identity Integration', () => {
    it('should create F2A with Node/Agent Identity', async () => {
      const testDir = join(TEST_DATA_DIR, 'f2a-test');
      
      const f2a = await F2A.create({
        dataDir: testDir,
        displayName: 'Test F2A Agent',
        agentType: 'custom'
      });

      // 验证身份
      expect(f2a.getNodeId()).toBeTruthy();
      expect(f2a.getAgentId()).toBeTruthy();
      expect(f2a.getAgentName()).toBeTruthy();

      // 清理
      await f2a.stop();
    });

    it('should handle displayName with special characters', async () => {
      const testDir = join(TEST_DATA_DIR, 'f2a-special-chars');
      
      // displayName 包含空格和特殊字符
      const f2a = await F2A.create({
        dataDir: testDir,
        displayName: 'My F2A Agent! @#$',
        agentType: 'custom'
      });

      // Agent 名称应该被转换为有效格式
      expect(f2a.getAgentId()).toBeTruthy();
      expect(f2a.getAgentName()).toBeTruthy();
      // Agent 名称不应包含空格或特殊字符
      expect(f2a.getAgentName()).toMatch(/^[a-zA-Z0-9_\-:]+$/);

      // 清理
      await f2a.stop();
    });

    it('should have consistent agentId across restarts', async () => {
      const testDir = join(TEST_DATA_DIR, 'f2a-consistency');
      
      // 第一次创建
      const f2a1 = await F2A.create({
        dataDir: testDir,
        displayName: 'ConsistencyTest',
        agentType: 'custom'
      });
      const agentId1 = f2a1.getAgentId();
      await f2a1.stop();

      // 第二次加载
      const f2a2 = await F2A.create({
        dataDir: testDir,
        displayName: 'ConsistencyTest',
        agentType: 'custom'
      });
      const agentId2 = f2a2.getAgentId();
      await f2a2.stop();

      expect(agentId1).toBe(agentId2);
    });
  });

  describe('Agent Info', () => {
    it('should include agentId in AgentInfo', async () => {
      const testDir = join(TEST_DATA_DIR, 'agent-info-test');
      
      const f2a = await F2A.create({
        dataDir: testDir,
        displayName: 'AgentInfo Test',
        agentType: 'custom'
      });

      const agentInfo = f2a.agentInfo;
      expect(agentInfo.agentId).toBeTruthy();
      expect(agentInfo.agentId).toBe(f2a.getAgentId());

      await f2a.stop();
    });
  });
});