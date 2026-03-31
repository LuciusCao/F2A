/**
 * 能力管理器测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CapabilityManager } from './capability-manager.js';
import type {
  AgentCapabilityQuant,
  CapabilityMetrics,
  ComputationMetrics,
  StorageMetrics,
  NetworkMetrics,
  SkillTag,
  ReputationMetrics,
  LoadInfo,
} from '../types/capability-quant.js';

// ============================================================================
// 测试数据
// ============================================================================

const defaultComputation: ComputationMetrics = {
  cpuCores: 4,
  cpuScore: 1500,
  memoryMB: 4096,
  gpuAccelerated: false,
  concurrencyLimit: 4,
  throughput: 30,
};

const defaultStorage: StorageMetrics = {
  availableGB: 100,
  storageType: 'ssd',
  readSpeedMBps: 500,
  writeSpeedMBps: 400,
  supportedFormats: ['txt', 'json'],
};

const defaultNetwork: NetworkMetrics = {
  bandwidthMbps: 50,
  latencyP95Ms: 30,
  stability: 0.9,
  directConnect: true,
};

const defaultSkills: SkillTag[] = [
  {
    name: 'code-generation',
    proficiency: 4,
    executions: 100,
    successRate: 0.9,
    lastUsedAt: Date.now(),
  },
];

const defaultReputation: ReputationMetrics = {
  score: 70,
  level: 'participant',
  totalTasks: 100,
  successTasks: 85,
  failureTasks: 15,
  avgResponseTimeMs: 2000,
  nodeAgeDays: 30,
};

const defaultMetrics: CapabilityMetrics = {
  computation: defaultComputation,
  storage: defaultStorage,
  network: defaultNetwork,
  skills: defaultSkills,
  reputation: defaultReputation,
};

function createManager(peerId: string = 'test-peer'): CapabilityManager {
  return new CapabilityManager({
    peerId,
    baseCapabilities: [],
  });
}

// ============================================================================
// 基础功能测试
// ============================================================================

describe('CapabilityManager', () => {
  let manager: CapabilityManager;

  beforeEach(() => {
    manager = createManager();
  });

  afterEach(() => {
    manager.stop();
  });

  describe('constructor', () => {
    it('should create a manager with default config', () => {
      expect(manager).toBeDefined();
    });

    it('should use custom weights', () => {
      const customManager = new CapabilityManager({
        peerId: 'test',
        baseCapabilities: [],
        weights: {
          computation: 0.5,
          storage: 0.1,
          network: 0.1,
          skill: 0.2,
          reputation: 0.1,
        },
      });
      expect(customManager).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should start and stop without error', () => {
      manager.start();
      manager.stop();
      // No error means success
    });
  });

  describe('updateMetrics', () => {
    it('should update local capability quant', async () => {
      const result = await manager.updateMetrics(defaultMetrics);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.peerId).toBe('test-peer');
        expect(result.data.scores.dimensionScores).toBeDefined();
        expect(result.data.scores.overallScore).toBeGreaterThanOrEqual(0);
        expect(result.data.version).toBe(1);
      }
    });

    it('should increment version on each update', async () => {
      await manager.updateMetrics(defaultMetrics);
      const result = await manager.updateMetrics(defaultMetrics);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(2);
      }
    });

    it('should merge with existing metrics', async () => {
      await manager.updateMetrics(defaultMetrics);
      
      const result = await manager.updateMetrics({
        computation: {
          ...defaultComputation,
          cpuCores: 8,
        },
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metrics.computation.cpuCores).toBe(8);
        expect(result.data.metrics.storage.storageType).toBe('ssd');
      }
    });

    it('should emit capability:updated event', async () => {
      const listener = vi.fn();
      manager.on('capability:updated', listener);
      
      await manager.updateMetrics(defaultMetrics);
      
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCapabilityScore', () => {
    it('should return null before update', () => {
      expect(manager.getCapabilityScore()).toBeNull();
    });

    it('should return score after update', async () => {
      await manager.updateMetrics(defaultMetrics);
      const score = manager.getCapabilityScore();
      
      expect(score).not.toBeNull();
      expect(score?.dimensionScores).toBeDefined();
      expect(score?.overallScore).toBeDefined();
    });
  });

  describe('getCapabilityVector', () => {
    it('should return null before update', () => {
      expect(manager.getCapabilityVector()).toBeNull();
    });

    it('should return vector after update', async () => {
      await manager.updateMetrics(defaultMetrics);
      const vector = manager.getCapabilityVector();
      
      expect(vector).not.toBeNull();
      expect(vector?.length).toBe(35);
    });
  });

  describe('getLocalQuant', () => {
    it('should return null before update', () => {
      expect(manager.getLocalQuant()).toBeNull();
    });

    it('should return quant after update', async () => {
      await manager.updateMetrics(defaultMetrics);
      const quant = manager.getLocalQuant();
      
      expect(quant).not.toBeNull();
      expect(quant?.peerId).toBe('test-peer');
    });
  });

  describe('broadcastCapability', () => {
    it('should fail without local quant', async () => {
      const result = await manager.broadcastCapability();
      expect(result.success).toBe(false);
    });

    it('should succeed with local quant', async () => {
      await manager.updateMetrics(defaultMetrics);
      const result = await manager.broadcastCapability();
      expect(result.success).toBe(true);
    });

    it('should call broadcastFn if provided', async () => {
      const broadcastFn = vi.fn().mockResolvedValue(undefined);
      const managerWithBroadcast = new CapabilityManager({
        peerId: 'test',
        baseCapabilities: [],
        broadcastFn,
      });
      
      await managerWithBroadcast.updateMetrics(defaultMetrics);
      await managerWithBroadcast.broadcastCapability();
      
      expect(broadcastFn).toHaveBeenCalledTimes(1);
    });

    it('should emit capability:broadcast event', async () => {
      const listener = vi.fn();
      manager.on('capability:broadcast', listener);
      
      await manager.updateMetrics(defaultMetrics);
      await manager.broadcastCapability();
      
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// 衰减测试
// ============================================================================

describe('decayScores', () => {
  let manager: CapabilityManager;

  beforeEach(() => {
    manager = createManager();
  });

  afterEach(() => {
    manager.stop();
  });

  it('should fail without local quant', () => {
    const result = manager.decayScores(1);
    expect(result.success).toBe(false);
  });

  it('should decay skill proficiency', async () => {
    await manager.updateMetrics({
      ...defaultMetrics,
      skills: [{
        name: 'test',
        proficiency: 5,
        executions: 100,
        successRate: 0.9,
        lastUsedAt: Date.now(),
      }],
    });
    
    const before = manager.getLocalQuant()!;
    const result = manager.decayScores(1);
    
    expect(result.success).toBe(true);
    if (result.success) {
      const after = result.data;
      // Skill proficiency should decrease or stay same
      expect(after.metrics.skills[0].proficiency).toBeLessThanOrEqual(
        before.metrics.skills[0].proficiency
      );
    }
  });

  it('should emit capability:decayed event', async () => {
    const listener = vi.fn();
    manager.on('capability:decayed', listener);
    
    await manager.updateMetrics(defaultMetrics);
    manager.decayScores(1);
    
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should increment version', async () => {
    await manager.updateMetrics(defaultMetrics);
    const before = manager.getLocalQuant()!;
    
    const result = manager.decayScores(1);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(before.version + 1);
    }
  });
});

// ============================================================================
// 远程节点管理测试
// ============================================================================

describe('Remote Peer Management', () => {
  let manager: CapabilityManager;

  beforeEach(() => {
    manager = createManager();
  });

  afterEach(() => {
    manager.stop();
  });

  const peerQuant: AgentCapabilityQuant = {
    peerId: 'remote-peer',
    baseCapabilities: [],
    scores: {
      dimensionScores: {
        computation: 80,
        storage: 70,
        network: 75,
        skill: 65,
        reputation: 85,
      },
      overallScore: 75,
      capabilityVector: new Array(35).fill(0.5),
    },
    metrics: defaultMetrics,
    lastUpdated: Date.now(),
    version: 1,
  };

  describe('updatePeerCapability', () => {
    it('should add new peer capability', () => {
      manager.updatePeerCapability(peerQuant);
      expect(manager.getPeerCapability('remote-peer')).not.toBeNull();
    });

    it('should update existing peer with higher version', () => {
      manager.updatePeerCapability(peerQuant);
      
      const updated: AgentCapabilityQuant = {
        ...peerQuant,
        version: 2,
        scores: {
          ...peerQuant.scores,
          overallScore: 80,
        },
      };
      
      manager.updatePeerCapability(updated);
      
      const stored = manager.getPeerCapability('remote-peer');
      expect(stored?.scores.overallScore).toBe(80);
    });

    it('should ignore lower version updates', () => {
      manager.updatePeerCapability({ ...peerQuant, version: 5 });
      
      const older: AgentCapabilityQuant = {
        ...peerQuant,
        version: 3,
        scores: {
          ...peerQuant.scores,
          overallScore: 80,
        },
      };
      
      manager.updatePeerCapability(older);
      
      const stored = manager.getPeerCapability('remote-peer');
      // Should still be version 5 (ignored version 3)
      expect(stored?.version).toBe(5);
    });
  });

  describe('getPeerCapability', () => {
    it('should return null for unknown peer', () => {
      expect(manager.getPeerCapability('unknown')).toBeNull();
    });

    it('should return stored capability', () => {
      manager.updatePeerCapability(peerQuant);
      expect(manager.getPeerCapability('remote-peer')).toEqual(peerQuant);
    });
  });

  describe('removePeerCapability', () => {
    it('should remove peer capability', () => {
      manager.updatePeerCapability(peerQuant);
      manager.removePeerCapability('remote-peer');
      expect(manager.getPeerCapability('remote-peer')).toBeNull();
    });
  });

  describe('getAllPeerCapabilities', () => {
    it('should return empty array initially', () => {
      expect(manager.getAllPeerCapabilities()).toEqual([]);
    });

    it('should return all stored capabilities', () => {
      manager.updatePeerCapability(peerQuant);
      manager.updatePeerCapability({ ...peerQuant, peerId: 'peer-2' });
      
      const all = manager.getAllPeerCapabilities();
      expect(all.length).toBe(2);
    });
  });

  describe('getRankings', () => {
    it('should return sorted by overall score', () => {
      manager.updatePeerCapability({ ...peerQuant, peerId: 'low', scores: { ...peerQuant.scores, overallScore: 50 } });
      manager.updatePeerCapability({ ...peerQuant, peerId: 'high', scores: { ...peerQuant.scores, overallScore: 90 } });
      manager.updatePeerCapability({ ...peerQuant, peerId: 'mid', scores: { ...peerQuant.scores, overallScore: 70 } });
      
      const rankings = manager.getRankings();
      expect(rankings[0].peerId).toBe('high');
      expect(rankings[1].peerId).toBe('mid');
      expect(rankings[2].peerId).toBe('low');
    });

    it('should return sorted by specific dimension', () => {
      manager.updatePeerCapability({
        ...peerQuant,
        peerId: 'high-compute',
        scores: {
          ...peerQuant.scores,
          dimensionScores: {
            computation: 95,
            storage: 50,
            network: 50,
            skill: 50,
            reputation: 50,
          },
        },
      });
      
      manager.updatePeerCapability({
        ...peerQuant,
        peerId: 'high-storage',
        scores: {
          ...peerQuant.scores,
          dimensionScores: {
            computation: 50,
            storage: 95,
            network: 50,
            skill: 50,
            reputation: 50,
          },
        },
      });
      
      const computeRankings = manager.getRankings('computation');
      expect(computeRankings[0].peerId).toBe('high-compute');
      
      const storageRankings = manager.getRankings('storage');
      expect(storageRankings[0].peerId).toBe('high-storage');
    });
  });
});

// ============================================================================
// 负载管理测试
// ============================================================================

describe('Load Management', () => {
  let manager: CapabilityManager;

  beforeEach(() => {
    manager = createManager();
  });

  afterEach(() => {
    manager.stop();
  });

  const loadInfo: LoadInfo = {
    peerId: 'loaded-peer',
    activeTasks: 3,
    queueLength: 5,
    cpuUsage: 0.5,
    memoryUsage: 0.4,
    lastUpdated: Date.now(),
  };

  describe('updatePeerLoad', () => {
    it('should store load info', () => {
      manager.updatePeerLoad(loadInfo);
      expect(manager.getPeerLoad('loaded-peer')).not.toBeNull();
    });
  });

  describe('getPeerLoad', () => {
    it('should return null for unknown peer', () => {
      expect(manager.getPeerLoad('unknown')).toBeNull();
    });

    it('should return stored load info', () => {
      manager.updatePeerLoad(loadInfo);
      const stored = manager.getPeerLoad('loaded-peer');
      expect(stored?.activeTasks).toBe(3);
    });
  });

  describe('calculateLoadFactor', () => {
    it('should return 1.0 for unknown peer', () => {
      expect(manager.calculateLoadFactor('unknown')).toBe(1.0);
    });

    it('should return 1.0 for low load', () => {
      manager.updatePeerLoad({ ...loadInfo, cpuUsage: 0.2, activeTasks: 1, queueLength: 1 });
      expect(manager.calculateLoadFactor('loaded-peer')).toBe(1.0);
    });

    it('should return <1.0 for high load', () => {
      manager.updatePeerLoad({ ...loadInfo, cpuUsage: 0.9, activeTasks: 10, queueLength: 20 });
      expect(manager.calculateLoadFactor('loaded-peer')).toBeLessThan(1.0);
    });
  });

  describe('isOverloaded', () => {
    it('should return false for unknown peer', () => {
      expect(manager.isOverloaded('unknown')).toBe(false);
    });

    it('should return false for normal load', () => {
      manager.updatePeerLoad(loadInfo);
      expect(manager.isOverloaded('loaded-peer')).toBe(false);
    });

    it('should return true for high CPU usage', () => {
      manager.updatePeerLoad({ ...loadInfo, cpuUsage: 0.95 });
      expect(manager.isOverloaded('loaded-peer')).toBe(true);
    });

    it('should return true for high memory usage', () => {
      manager.updatePeerLoad({ ...loadInfo, memoryUsage: 0.95 });
      expect(manager.isOverloaded('loaded-peer')).toBe(true);
    });

    it('should return true for long queue', () => {
      manager.updatePeerLoad({ ...loadInfo, queueLength: 60 });
      expect(manager.isOverloaded('loaded-peer')).toBe(true);
    });
  });
});

// ============================================================================
// 技能统计测试
// ============================================================================

describe('Skill Statistics', () => {
  let manager: CapabilityManager;

  beforeEach(() => {
    manager = createManager();
  });

  afterEach(() => {
    manager.stop();
  });

  describe('recordSkillExecution', () => {
    it('should track skill executions', () => {
      manager.recordSkillExecution('test-skill', true, 1000);
      manager.recordSkillExecution('test-skill', false, 2000);
      
      const stats = manager.getSkillStats('test-skill');
      expect(stats?.executions).toBe(2);
      expect(stats?.successRate).toBe(0.5);
      expect(stats?.avgExecutionTimeMs).toBe(1500);
    });
  });

  describe('getSkillStats', () => {
    it('should return null for unknown skill', () => {
      expect(manager.getSkillStats('unknown')).toBeNull();
    });

    it('should calculate correct statistics', () => {
      manager.recordSkillExecution('test', true, 100);
      manager.recordSkillExecution('test', true, 200);
      manager.recordSkillExecution('test', false, 300);
      
      const stats = manager.getSkillStats('test');
      expect(stats?.executions).toBe(3);
      expect(stats?.successRate).toBeCloseTo(0.666, 2);
      expect(stats?.avgExecutionTimeMs).toBe(200);
    });
  });
});

// ============================================================================
// 事件处理测试
// ============================================================================

describe('Event Handling', () => {
  let manager: CapabilityManager;

  beforeEach(async () => {
    manager = createManager();
    await manager.updateMetrics(defaultMetrics);
  });

  afterEach(() => {
    manager.stop();
  });

  describe('handleUpdateEvent', () => {
    it('should handle task_completed event', () => {
      const initialRep = manager.getLocalQuant()!.metrics.reputation.totalTasks;
      
      manager.handleUpdateEvent({
        type: 'task_completed',
        taskId: 'task-1',
        success: true,
        latency: 1000,
      });
      
      const after = manager.getLocalQuant()!;
      expect(after.metrics.reputation.totalTasks).toBe(initialRep + 1);
    });

    it('should handle peer_disconnected event', () => {
      // Add a peer
      manager.updatePeerCapability({
        peerId: 'disconnect-test',
        baseCapabilities: [],
        scores: {
          dimensionScores: { computation: 50, storage: 50, network: 50, skill: 50, reputation: 50 },
          overallScore: 50,
          capabilityVector: [],
        },
        metrics: defaultMetrics,
        lastUpdated: Date.now(),
        version: 1,
      });
      
      manager.handleUpdateEvent({
        type: 'peer_disconnected',
        peerId: 'disconnect-test',
      });
      
      expect(manager.getPeerCapability('disconnect-test')).toBeNull();
    });

    it('should handle periodic_decay event', () => {
      const listener = vi.fn();
      manager.on('capability:decayed', listener);
      
      manager.handleUpdateEvent({ type: 'periodic_decay' });
      
      expect(listener).toHaveBeenCalled();
    });
  });
});