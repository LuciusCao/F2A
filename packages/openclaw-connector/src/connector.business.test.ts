/**
 * F2A OpenClaw Connector - 业务逻辑测试
 * 测试核心功能，不使用无意义的 mock
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { F2AOpenClawConnector } from './connector.js';
import { ReputationSystem } from './reputation.js';
import { CapabilityDetector } from './capability-detector.js';
import type { F2APluginConfig, AgentCapability, AgentInfo, TaskRequest } from './types.js';

describe('F2AOpenClawConnector 业务逻辑', () => {
  describe('配置合并', () => {
    it('应该使用默认配置当未提供可选配置时', () => {
      const connector = new F2AOpenClawConnector();
      const minimalConfig = {
        openclaw: {
          execute: async () => ({}),
          listTools: async () => [],
          listSkills: async () => []
        }
      };
      
      // 验证默认配置值
      const mergedConfig = (connector as any).mergeConfig(minimalConfig);
      
      expect(mergedConfig.autoStart).toBe(true);
      expect(mergedConfig.webhookPort).toBe(9002);
      expect(mergedConfig.agentName).toBe('OpenClaw Agent');
      expect(mergedConfig.dataDir).toBe('./f2a-data');
      expect(mergedConfig.reputation.enabled).toBe(true);
      expect(mergedConfig.reputation.initialScore).toBe(50);
      expect(mergedConfig.security.requireConfirmation).toBe(false);
    });

    it('应该覆盖默认配置当提供自定义值时', () => {
      const connector = new F2AOpenClawConnector();
      const customConfig = {
        openclaw: {
          execute: async () => ({}),
          listTools: async () => [],
          listSkills: async () => []
        },
        autoStart: false,
        webhookPort: 9999,
        agentName: 'Custom Agent',
        reputation: {
          enabled: false,
          initialScore: 100
        }
      };
      
      const mergedConfig = (connector as any).mergeConfig(customConfig);
      
      expect(mergedConfig.autoStart).toBe(false);
      expect(mergedConfig.webhookPort).toBe(9999);
      expect(mergedConfig.agentName).toBe('Custom Agent');
      expect(mergedConfig.reputation.enabled).toBe(false);
      expect(mergedConfig.reputation.initialScore).toBe(100);
    });
  });

  describe('Agent 解析', () => {
    it('应该通过 #索引 格式解析 Agent', async () => {
      const connector = new F2AOpenClawConnector();
      const mockAgents: AgentInfo[] = [
        { peerId: 'peer-1', displayName: 'Agent A', agentType: 'test', version: '1.0', capabilities: [], multiaddrs: [], lastSeen: Date.now() },
        { peerId: 'peer-2', displayName: 'Agent B', agentType: 'test', version: '1.0', capabilities: [], multiaddrs: [], lastSeen: Date.now() }
      ];
      
      // 模拟 discoverAgents 返回数据
      (connector as any).networkClient = {
        discoverAgents: async () => ({ success: true, data: mockAgents })
      };
      
      const result = await (connector as any).resolveAgent('#1');
      expect(result?.displayName).toBe('Agent A');
      
      const result2 = await (connector as any).resolveAgent('#2');
      expect(result2?.displayName).toBe('Agent B');
    });

    it('应该通过 displayName 精确匹配解析 Agent', async () => {
      const connector = new F2AOpenClawConnector();
      const mockAgents: AgentInfo[] = [
        { peerId: 'peer-1', displayName: 'MacBook-Pro', agentType: 'test', version: '1.0', capabilities: [], multiaddrs: [], lastSeen: Date.now() }
      ];
      
      (connector as any).networkClient = {
        discoverAgents: async () => ({ success: true, data: mockAgents })
      };
      
      const result = await (connector as any).resolveAgent('MacBook-Pro');
      expect(result?.peerId).toBe('peer-1');
    });

    it('应该通过 peerId 前缀模糊匹配解析 Agent', async () => {
      const connector = new F2AOpenClawConnector();
      const mockAgents: AgentInfo[] = [
        { peerId: 'f2a-abc123', displayName: 'Test Agent', agentType: 'test', version: '1.0', capabilities: [], multiaddrs: [], lastSeen: Date.now() }
      ];
      
      (connector as any).networkClient = {
        discoverAgents: async () => ({ success: true, data: mockAgents })
      };
      
      const result = await (connector as any).resolveAgent('f2a-ab');
      expect(result?.peerId).toBe('f2a-abc123');
    });

    it('应该返回 null 当找不到匹配的 Agent', async () => {
      const connector = new F2AOpenClawConnector();
      
      (connector as any).networkClient = {
        discoverAgents: async () => ({ success: true, data: [] })
      };
      
      const result = await (connector as any).resolveAgent('NonExistent');
      expect(result).toBeNull();
    });
  });

  describe('广播结果格式化', () => {
    it('应该正确格式化成功的广播结果', () => {
      const connector = new F2AOpenClawConnector();
      const results = [
        { agent: 'Agent A', success: true, latency: 100 },
        { agent: 'Agent B', success: true, latency: 200 }
      ];
      
      const formatted = (connector as any).formatBroadcastResults(results);
      
      expect(formatted).toContain('✅ Agent A (100ms)');
      expect(formatted).toContain('✅ Agent B (200ms)');
      expect(formatted).toContain('完成');
    });

    it('应该正确格式化失败的广播结果', () => {
      const connector = new F2AOpenClawConnector();
      const results = [
        { agent: 'Agent A', success: false, error: 'Timeout' }
      ];
      
      const formatted = (connector as any).formatBroadcastResults(results);
      
      expect(formatted).toContain('❌ Agent A');
      expect(formatted).toContain('失败: Timeout');
    });
  });

  describe('Token 生成', () => {
    it('应该生成符合格式的 token', () => {
      const connector = new F2AOpenClawConnector();
      const token = (connector as any).generateToken();
      
      expect(token).toMatch(/^f2a-[A-Za-z0-9]{32}$/);
    });

    it('应该生成不同的 token 每次调用', () => {
      const connector = new F2AOpenClawConnector();
      const token1 = (connector as any).generateToken();
      const token2 = (connector as any).generateToken();
      
      expect(token1).not.toBe(token2);
    });
  });
});

describe('ReputationSystem 业务逻辑', () => {
  const testDir = '/tmp/f2a-test-reputation';
  
  beforeEach(() => {
    // 创建测试目录
    try {
      mkdirSync(testDir, { recursive: true });
    } catch (e) {
      // 目录可能已存在
    }
  });
  
  afterEach(() => {
    // 清理测试目录
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // 忽略清理错误
    }
  });

  describe('信誉计算', () => {
    it('新 peer 应该获得初始信誉分', () => {
      const config = { enabled: true, initialScore: 50, minScoreForService: 20, decayRate: 0.01 };
      const reputation = new ReputationSystem(config, testDir);
      
      const rep = reputation.getReputation('new-peer');
      expect(rep.score).toBe(50);
      expect(rep.successfulTasks).toBe(0);
      expect(rep.failedTasks).toBe(0);
    });

    it('成功任务应该增加信誉分', () => {
      const config = { enabled: true, initialScore: 50, minScoreForService: 20, decayRate: 0.01 };
      const reputation = new ReputationSystem(config, testDir);
      
      reputation.recordSuccess('peer-1', 'task-1', 100);
      const rep = reputation.getReputation('peer-1');
      
      expect(rep.score).toBeGreaterThan(50);
      expect(rep.successfulTasks).toBe(1);
      expect(rep.avgResponseTime).toBe(100);
    });

    it('失败任务应该降低信誉分', () => {
      const config = { enabled: true, initialScore: 50, minScoreForService: 20, decayRate: 0.01 };
      const reputation = new ReputationSystem(config, testDir);
      
      reputation.recordFailure('peer-1', 'task-1', 'Error');
      const rep = reputation.getReputation('peer-1');
      
      expect(rep.score).toBeLessThan(50);
      expect(rep.failedTasks).toBe(1);
    });

    it('信誉低于阈值应该被拒绝服务', () => {
      const config = { enabled: true, initialScore: 50, minScoreForService: 20, decayRate: 0.01 };
      const reputation = new ReputationSystem(config, testDir);
      
      // 多次失败降低信誉
      for (let i = 0; i < 10; i++) {
        reputation.recordFailure('bad-peer', `task-${i}`, 'Error');
      }
      
      expect(reputation.isAllowed('bad-peer')).toBe(false);
    });

    it('信誉高于阈值应该被允许服务', () => {
      const config = { enabled: true, initialScore: 50, minScoreForService: 20, decayRate: 0.01 };
      const reputation = new ReputationSystem(config, testDir);
      
      reputation.recordSuccess('good-peer', 'task-1', 100);
      
      expect(reputation.isAllowed('good-peer')).toBe(true);
    });
  });

  describe('历史记录', () => {
    it('应该记录成功任务历史', () => {
      const config = { enabled: true, initialScore: 50, minScoreForService: 20, decayRate: 0.01 };
      const reputation = new ReputationSystem(config, testDir);
      
      reputation.recordSuccess('peer-1', 'task-1', 100);
      const rep = reputation.getReputation('peer-1');
      
      expect(rep.history.length).toBe(1);
      expect(rep.history[0].type).toBe('task_success');
      expect(rep.history[0].taskId).toBe('task-1');
    });

    it('应该记录失败任务历史', () => {
      const config = { enabled: true, initialScore: 50, minScoreForService: 20, decayRate: 0.01 };
      const reputation = new ReputationSystem(config, testDir);
      
      reputation.recordFailure('peer-1', 'task-1', 'Timeout');
      const rep = reputation.getReputation('peer-1');
      
      expect(rep.history.length).toBe(1);
      expect(rep.history[0].type).toBe('task_failure');
      expect(rep.history[0].reason).toBe('Timeout');
    });
  });
});

describe('CapabilityDetector 业务逻辑', () => {
  describe('能力检测', () => {
    it('应该从 OpenClaw 会话中检测工具能力', async () => {
      const detector = new CapabilityDetector();
      const mockSession = {
        listTools: async () => ['read', 'write', 'exec'],
        listSkills: async () => []
      };
      
      const capabilities = await detector.detectCapabilities(mockSession as any);
      
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.name === 'file-operation')).toBe(true);
    });

    it('当 listTools 不可用时应该使用默认工具列表', async () => {
      const detector = new CapabilityDetector();
      const mockSession = {};
      
      const capabilities = await detector.detectCapabilities(mockSession as any);
      
      // 应该返回默认工具映射的能力，而不是空数组
      expect(capabilities.length).toBeGreaterThan(0);
      expect(capabilities.some(c => c.name === 'file-operation')).toBe(true);
    });
  });

  describe('默认能力合并', () => {
    it('应该保留现有能力并添加缺失的默认能力', () => {
      const detector = new CapabilityDetector();
      const existingCapabilities: AgentCapability[] = [
        { name: 'custom-capability', description: 'Custom' }
      ];
      
      const merged = detector.mergeDefaultCapabilities(existingCapabilities);
      
      expect(merged.some(c => c.name === 'custom-capability')).toBe(true);
      expect(merged.some(c => c.name === 'code-generation')).toBe(true);
    });

    it('不应该重复添加已存在的能力', () => {
      const detector = new CapabilityDetector();
      const existingCapabilities: AgentCapability[] = [
        { name: 'code-generation', description: 'Already have this' }
      ];
      
      const merged = detector.mergeDefaultCapabilities(existingCapabilities);
      
      const codeGenCapabilities = merged.filter(c => c.name === 'code-generation');
      expect(codeGenCapabilities.length).toBe(1);
    });
  });
});
