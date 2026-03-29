/**
 * 能力量化类型定义测试
 */

import { describe, it, expect } from 'vitest';
import type {
  CapabilityDimension,
  ComputationMetrics,
  StorageMetrics,
  NetworkMetrics,
  SkillTag,
  ReputationMetrics,
  DimensionScores,
  CapabilityVector,
  CapabilityScore,
  AgentCapabilityQuant,
  CapabilityWeights,
  UpdateStrategy,
  CapabilityUpdateEvent,
  LoadInfo,
  ComparativeAdvantageScore,
} from './capability-quant.js';

import {
  DEFAULT_CAPABILITY_WEIGHTS,
  DEFAULT_UPDATE_STRATEGY,
} from './capability-quant.js';

describe('CapabilityDimension', () => {
  it('should have correct dimension types', () => {
    const dimensions: CapabilityDimension[] = [
      'computation',
      'storage',
      'network',
      'skill',
      'reputation',
    ];
    expect(dimensions.length).toBe(5);
  });
});

describe('ComputationMetrics', () => {
  it('should define required fields', () => {
    const metrics: ComputationMetrics = {
      cpuCores: 4,
      memoryMB: 4096,
      gpuAccelerated: false,
      concurrencyLimit: 4,
    };
    expect(metrics.cpuCores).toBe(4);
    expect(metrics.memoryMB).toBe(4096);
  });

  it('should support optional fields', () => {
    const metrics: ComputationMetrics = {
      cpuCores: 4,
      memoryMB: 4096,
      gpuAccelerated: true,
      concurrencyLimit: 8,
      cpuScore: 2000,
      throughput: 50,
    };
    expect(metrics.cpuScore).toBe(2000);
    expect(metrics.throughput).toBe(50);
  });
});

describe('StorageMetrics', () => {
  it('should define required fields', () => {
    const metrics: StorageMetrics = {
      availableGB: 100,
      storageType: 'ssd',
      supportedFormats: ['txt', 'json'],
    };
    expect(metrics.availableGB).toBe(100);
    expect(metrics.storageType).toBe('ssd');
  });

  it('should support all storage types', () => {
    const types: StorageMetrics['storageType'][] = ['hdd', 'ssd', 'nvme', 'memory'];
    expect(types.length).toBe(4);
  });
});

describe('NetworkMetrics', () => {
  it('should define required fields', () => {
    const metrics: NetworkMetrics = {
      bandwidthMbps: 100,
      stability: 0.9,
      directConnect: true,
    };
    expect(metrics.bandwidthMbps).toBe(100);
    expect(metrics.stability).toBe(0.9);
  });
});

describe('SkillTag', () => {
  it('should define skill with required fields', () => {
    const skill: SkillTag = {
      name: 'code-generation',
      proficiency: 4,
      executions: 100,
      successRate: 0.9,
      lastUsedAt: Date.now(),
    };
    expect(skill.name).toBe('code-generation');
    expect(skill.proficiency).toBe(4);
  });

  it('should only allow proficiency 1-5', () => {
    const proficiencies: SkillTag['proficiency'][] = [1, 2, 3, 4, 5];
    expect(proficiencies.length).toBe(5);
  });
});

describe('ReputationMetrics', () => {
  it('should define all required fields', () => {
    const metrics: ReputationMetrics = {
      score: 70,
      level: 'participant',
      totalTasks: 100,
      successTasks: 85,
      failureTasks: 15,
      avgResponseTimeMs: 2000,
      nodeAgeDays: 30,
    };
    expect(metrics.score).toBe(70);
    expect(metrics.level).toBe('participant');
  });

  it('should support all reputation levels', () => {
    const levels: ReputationMetrics['level'][] = [
      'restricted',
      'novice',
      'participant',
      'contributor',
      'core',
    ];
    expect(levels.length).toBe(5);
  });
});

describe('DimensionScores', () => {
  it('should have all dimension scores', () => {
    const scores: DimensionScores = {
      computation: 80,
      storage: 70,
      network: 75,
      skill: 65,
      reputation: 85,
    };
    expect(scores.computation).toBe(80);
    expect(scores.reputation).toBe(85);
  });
});

describe('CapabilityVector', () => {
  it('should be a number array', () => {
    const vector: CapabilityVector = [0.8, 0.7, 0.75, 0.65, 0.85];
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBe(5);
  });
});

describe('CapabilityScore', () => {
  it('should define complete score structure', () => {
    const score: CapabilityScore = {
      dimensionScores: {
        computation: 80,
        storage: 70,
        network: 75,
        skill: 65,
        reputation: 85,
      },
      overallScore: 75,
      capabilityVector: [0.8, 0.7, 0.75, 0.65, 0.85],
    };
    expect(score.overallScore).toBe(75);
    expect(score.dimensionScores.computation).toBe(80);
  });
});

describe('AgentCapabilityQuant', () => {
  it('should define complete quant structure', () => {
    const quant: AgentCapabilityQuant = {
      peerId: 'test-peer',
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
        capabilityVector: [0.8, 0.7, 0.75, 0.65, 0.85],
      },
      metrics: {
        computation: {
          cpuCores: 4,
          memoryMB: 4096,
          gpuAccelerated: false,
          concurrencyLimit: 4,
        },
        storage: {
          availableGB: 100,
          storageType: 'ssd',
          supportedFormats: [],
        },
        network: {
          bandwidthMbps: 100,
          stability: 0.9,
          directConnect: true,
        },
        skills: [],
        reputation: {
          score: 70,
          level: 'participant',
          totalTasks: 100,
          successTasks: 85,
          failureTasks: 15,
          avgResponseTimeMs: 2000,
          nodeAgeDays: 30,
        },
      },
      lastUpdated: Date.now(),
      version: 1,
    };
    expect(quant.peerId).toBe('test-peer');
    expect(quant.version).toBe(1);
  });
});

describe('CapabilityWeights', () => {
  it('should define all weight values', () => {
    const weights: CapabilityWeights = {
      computation: 0.25,
      storage: 0.15,
      network: 0.20,
      skill: 0.20,
      reputation: 0.20,
    };
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('should have correct default weights', () => {
    expect(DEFAULT_CAPABILITY_WEIGHTS.computation).toBe(0.25);
    expect(DEFAULT_CAPABILITY_WEIGHTS.storage).toBe(0.15);
    expect(DEFAULT_CAPABILITY_WEIGHTS.network).toBe(0.20);
    expect(DEFAULT_CAPABILITY_WEIGHTS.skill).toBe(0.20);
    expect(DEFAULT_CAPABILITY_WEIGHTS.reputation).toBe(0.20);
  });
});

describe('UpdateStrategy', () => {
  it('should define update strategy', () => {
    const strategy: UpdateStrategy = {
      trigger: 'periodic',
      intervalMs: 300000,
      decayRate: 0.01,
      maxVersion: 1000000,
    };
    expect(strategy.trigger).toBe('periodic');
    expect(strategy.decayRate).toBe(0.01);
  });

  it('should have correct default strategy', () => {
    expect(DEFAULT_UPDATE_STRATEGY.trigger).toBe('periodic');
    expect(DEFAULT_UPDATE_STRATEGY.intervalMs).toBe(5 * 60 * 1000);
    expect(DEFAULT_UPDATE_STRATEGY.decayRate).toBe(0.01);
  });
});

describe('CapabilityUpdateEvent', () => {
  it('should support task_completed event', () => {
    const event: CapabilityUpdateEvent = {
      type: 'task_completed',
      taskId: 'task-1',
      success: true,
      latency: 1000,
    };
    expect(event.type).toBe('task_completed');
  });

  it('should support metrics_changed event', () => {
    const event: CapabilityUpdateEvent = {
      type: 'metrics_changed',
      dimension: 'computation',
    };
    expect(event.type).toBe('metrics_changed');
  });

  it('should support periodic_decay event', () => {
    const event: CapabilityUpdateEvent = {
      type: 'periodic_decay',
    };
    expect(event.type).toBe('periodic_decay');
  });

  it('should support peer_discovered event', () => {
    const event: CapabilityUpdateEvent = {
      type: 'peer_discovered',
      peerId: 'peer-1',
    };
    expect(event.type).toBe('peer_discovered');
  });

  it('should support peer_disconnected event', () => {
    const event: CapabilityUpdateEvent = {
      type: 'peer_disconnected',
      peerId: 'peer-1',
    };
    expect(event.type).toBe('peer_disconnected');
  });
});

describe('LoadInfo', () => {
  it('should define load info structure', () => {
    const load: LoadInfo = {
      peerId: 'peer-1',
      activeTasks: 5,
      queueLength: 10,
      cpuUsage: 0.6,
      memoryUsage: 0.5,
      lastUpdated: Date.now(),
    };
    expect(load.peerId).toBe('peer-1');
    expect(load.activeTasks).toBe(5);
  });
});

describe('ComparativeAdvantageScore', () => {
  it('should define advantage score structure', () => {
    const score: ComparativeAdvantageScore = {
      peerId: 'peer-1',
      matchScore: 0.85,
      capabilityMatch: 0.9,
      costEfficiency: 0.8,
      availability: 0.95,
      loadFactor: 0.7,
    };
    expect(score.matchScore).toBe(0.85);
    expect(score.capabilityMatch).toBe(0.9);
  });
});