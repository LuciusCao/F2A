/**
 * 能力量化评分算法测试
 */

import { describe, it, expect } from 'vitest';
import {
  scoreComputation,
  scoreStorage,
  scoreNetwork,
  scoreSkills,
  scoreReputation,
  calculateOverallScore,
  generateCapabilityVector,
  calculateCapabilityScore,
  cosineSimilarity,
  applyDecay,
  decaySkillProficiency,
} from './capability-scorer.js';
import type {
  ComputationMetrics,
  StorageMetrics,
  NetworkMetrics,
  SkillTag,
  ReputationMetrics,
} from '../types/capability-quant.js';
import { DEFAULT_CAPABILITY_WEIGHTS } from '../types/capability-quant.js';

// ============================================================================
// 测试数据
// ============================================================================

const defaultComputationMetrics: ComputationMetrics = {
  cpuCores: 4,
  cpuScore: 1500,
  memoryMB: 4096,
  gpuAccelerated: false,
  concurrencyLimit: 4,
  throughput: 30,
};

const defaultStorageMetrics: StorageMetrics = {
  availableGB: 100,
  storageType: 'ssd',
  readSpeedMBps: 500,
  writeSpeedMBps: 400,
  supportedFormats: ['txt', 'json', 'csv'],
};

const defaultNetworkMetrics: NetworkMetrics = {
  bandwidthMbps: 50,
  latencyP95Ms: 30,
  stability: 0.9,
  directConnect: true,
  monthlyDataCapGB: 1000,
};

const defaultSkillTags: SkillTag[] = [
  {
    name: 'code-generation',
    proficiency: 4,
    executions: 100,
    successRate: 0.9,
    avgExecutionTimeMs: 5000,
    lastUsedAt: Date.now() - 1000 * 60 * 60, // 1 小时前
  },
  {
    name: 'data-processing',
    proficiency: 3,
    executions: 50,
    successRate: 0.85,
    avgExecutionTimeMs: 10000,
    lastUsedAt: Date.now() - 1000 * 60 * 60 * 24 * 7, // 7 天前
  },
];

const defaultReputationMetrics: ReputationMetrics = {
  score: 70,
  level: 'participant',
  totalTasks: 100,
  successTasks: 85,
  failureTasks: 15,
  avgResponseTimeMs: 2000,
  nodeAgeDays: 30,
};

// ============================================================================
// 计算能力评分测试
// ============================================================================

describe('scoreComputation', () => {
  it('should return a score between 0 and 100', () => {
    const score = scoreComputation(defaultComputationMetrics);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should give higher score for GPU acceleration', () => {
    const withGpu = scoreComputation({
      ...defaultComputationMetrics,
      gpuAccelerated: true,
    });
    const withoutGpu = scoreComputation({
      ...defaultComputationMetrics,
      gpuAccelerated: false,
    });
    expect(withGpu).toBeGreaterThan(withoutGpu);
  });

  it('should handle missing optional fields', () => {
    const minimal: ComputationMetrics = {
      cpuCores: 2,
      memoryMB: 2048,
      gpuAccelerated: false,
      concurrencyLimit: 2,
    };
    const score = scoreComputation(minimal);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should cap score at 100', () => {
    const highEnd: ComputationMetrics = {
      cpuCores: 64,
      cpuScore: 5000,
      memoryMB: 128000,
      gpuAccelerated: true,
      concurrencyLimit: 100,
      throughput: 200,
    };
    const score = scoreComputation(highEnd);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should return 0 for minimal resources', () => {
    const minimal: ComputationMetrics = {
      cpuCores: 0,
      memoryMB: 0,
      gpuAccelerated: false,
      concurrencyLimit: 0,
    };
    const score = scoreComputation(minimal);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// 存储能力评分测试
// ============================================================================

describe('scoreStorage', () => {
  it('should return a score between 0 and 100', () => {
    const score = scoreStorage(defaultStorageMetrics);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should give higher score for faster storage types', () => {
    const nvme = scoreStorage({ ...defaultStorageMetrics, storageType: 'nvme' });
    const ssd = scoreStorage({ ...defaultStorageMetrics, storageType: 'ssd' });
    const hdd = scoreStorage({ ...defaultStorageMetrics, storageType: 'hdd' });
    
    expect(nvme).toBeGreaterThan(ssd);
    expect(ssd).toBeGreaterThan(hdd);
  });

  it('should give memory storage highest score', () => {
    const memory = scoreStorage({ ...defaultStorageMetrics, storageType: 'memory' });
    const nvme = scoreStorage({ ...defaultStorageMetrics, storageType: 'nvme' });
    expect(memory).toBeGreaterThan(nvme);
  });

  it('should handle missing read speed', () => {
    const noSpeed: StorageMetrics = {
      availableGB: 100,
      storageType: 'ssd',
      supportedFormats: [],
    };
    const score = scoreStorage(noSpeed);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should cap score at 100 for very high values', () => {
    const highEnd: StorageMetrics = {
      availableGB: 10000,
      storageType: 'memory',
      readSpeedMBps: 10000,
      writeSpeedMBps: 10000,
      supportedFormats: [],
    };
    const score = scoreStorage(highEnd);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// 网络能力评分测试
// ============================================================================

describe('scoreNetwork', () => {
  it('should return a score between 0 and 100', () => {
    const score = scoreNetwork(defaultNetworkMetrics);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should give bonus for direct connect', () => {
    const withDirect = scoreNetwork({
      ...defaultNetworkMetrics,
      directConnect: true,
    });
    const withoutDirect = scoreNetwork({
      ...defaultNetworkMetrics,
      directConnect: false,
    });
    expect(withDirect).toBeGreaterThan(withoutDirect);
  });

  it('should penalize high latency', () => {
    const lowLatency = scoreNetwork({
      ...defaultNetworkMetrics,
      latencyP95Ms: 10,
    });
    const highLatency = scoreNetwork({
      ...defaultNetworkMetrics,
      latencyP95Ms: 200,
    });
    expect(lowLatency).toBeGreaterThan(highLatency);
  });

  it('should handle missing latency', () => {
    const noLatency: NetworkMetrics = {
      bandwidthMbps: 50,
      stability: 0.8,
      directConnect: false,
    };
    const score = scoreNetwork(noLatency);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should reward high stability', () => {
    const stable = scoreNetwork({ ...defaultNetworkMetrics, stability: 1.0 });
    const unstable = scoreNetwork({ ...defaultNetworkMetrics, stability: 0.5 });
    expect(stable).toBeGreaterThan(unstable);
  });
});

// ============================================================================
// 技能评分测试
// ============================================================================

describe('scoreSkills', () => {
  it('should return default 30 for empty skills', () => {
    const score = scoreSkills([]);
    expect(score).toBe(30);
  });

  it('should return a score between 0 and 100', () => {
    const score = scoreSkills(defaultSkillTags);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should weight recent skills higher', () => {
    const recentSkill: SkillTag[] = [{
      name: 'test',
      proficiency: 5,
      executions: 100,
      successRate: 0.9,
      lastUsedAt: Date.now(),
    }];
    
    const oldSkill: SkillTag[] = [{
      name: 'test',
      proficiency: 5,
      executions: 100,
      successRate: 0.9,
      lastUsedAt: Date.now() - 1000 * 60 * 60 * 24 * 90, // 90 天前，确保明显衰减
    }];
    
    const recentScore = scoreSkills(recentSkill);
    const oldScore = scoreSkills(oldSkill);
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('should reward higher proficiency', () => {
    const highProficiency: SkillTag[] = [{
      name: 'test',
      proficiency: 5,
      executions: 100,
      successRate: 0.9,
      lastUsedAt: Date.now(),
    }];
    
    const lowProficiency: SkillTag[] = [{
      name: 'test',
      proficiency: 1,
      executions: 100,
      successRate: 0.9,
      lastUsedAt: Date.now(),
    }];
    
    const highScore = scoreSkills(highProficiency);
    const lowScore = scoreSkills(lowProficiency);
    expect(highScore).toBeGreaterThan(lowScore);
  });

  it('should reward higher success rate', () => {
    const highSuccess: SkillTag[] = [{
      name: 'test',
      proficiency: 3,
      executions: 100,
      successRate: 0.95,
      lastUsedAt: Date.now(),
    }];
    
    const lowSuccess: SkillTag[] = [{
      name: 'test',
      proficiency: 3,
      executions: 100,
      successRate: 0.5,
      lastUsedAt: Date.now(),
    }];
    
    const highScore = scoreSkills(highSuccess);
    const lowScore = scoreSkills(lowSuccess);
    expect(highScore).toBeGreaterThan(lowScore);
  });

  it('should reward more executions', () => {
    const manyExecutions: SkillTag[] = [{
      name: 'test',
      proficiency: 3,
      executions: 1000,
      successRate: 0.9,
      lastUsedAt: Date.now(),
    }];
    
    const fewExecutions: SkillTag[] = [{
      name: 'test',
      proficiency: 3,
      executions: 1,
      successRate: 0.9,
      lastUsedAt: Date.now(),
    }];
    
    const manyScore = scoreSkills(manyExecutions);
    const fewScore = scoreSkills(fewExecutions);
    expect(manyScore).toBeGreaterThan(fewScore);
  });
});

// ============================================================================
// 信誉评分测试
// ============================================================================

describe('scoreReputation', () => {
  it('should return a score between 0 and 100', () => {
    const score = scoreReputation(defaultReputationMetrics);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should reward higher success rate', () => {
    const highSuccess = scoreReputation({
      ...defaultReputationMetrics,
      successTasks: 95,
      failureTasks: 5,
    });
    const lowSuccess = scoreReputation({
      ...defaultReputationMetrics,
      successTasks: 50,
      failureTasks: 50,
    });
    expect(highSuccess).toBeGreaterThan(lowSuccess);
  });

  it('should reward older nodes (Sybil protection)', () => {
    const oldNode = scoreReputation({
      ...defaultReputationMetrics,
      nodeAgeDays: 60,
    });
    const newNode = scoreReputation({
      ...defaultReputationMetrics,
      nodeAgeDays: 1,
    });
    expect(oldNode).toBeGreaterThan(newNode);
  });

  it('should penalize slow response time', () => {
    const fast = scoreReputation({
      ...defaultReputationMetrics,
      avgResponseTimeMs: 1000,
    });
    const slow = scoreReputation({
      ...defaultReputationMetrics,
      avgResponseTimeMs: 20000,
    });
    expect(fast).toBeGreaterThan(slow);
  });

  it('should not penalize response time under threshold', () => {
    const fast = scoreReputation({
      ...defaultReputationMetrics,
      avgResponseTimeMs: 5000, // < 10000ms threshold
    });
    const veryFast = scoreReputation({
      ...defaultReputationMetrics,
      avgResponseTimeMs: 1000,
    });
    expect(fast).toBe(veryFast); // No penalty under threshold
  });

  it('should handle zero tasks', () => {
    const noTasks = scoreReputation({
      ...defaultReputationMetrics,
      totalTasks: 0,
      successTasks: 0,
      failureTasks: 0,
    });
    expect(noTasks).toBeGreaterThanOrEqual(0);
    expect(noTasks).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// 综合评分测试
// ============================================================================

describe('calculateOverallScore', () => {
  it('should return a weighted average of dimension scores', () => {
    const scores = {
      computation: 80,
      storage: 60,
      network: 70,
      skill: 50,
      reputation: 90,
    };
    
    const overall = calculateOverallScore(scores);
    
    // Expected: 80*0.25 + 60*0.15 + 70*0.20 + 50*0.20 + 90*0.20 = 71
    expect(overall).toBeCloseTo(71, 1);
  });

  it('should cap at 100', () => {
    const scores = {
      computation: 150,
      storage: 150,
      network: 150,
      skill: 150,
      reputation: 150,
    };
    
    const overall = calculateOverallScore(scores);
    expect(overall).toBeLessThanOrEqual(100);
  });

  it('should use custom weights', () => {
    const scores = {
      computation: 100,
      storage: 0,
      network: 0,
      skill: 0,
      reputation: 0,
    };
    
    const customWeights = {
      computation: 1.0,
      storage: 0,
      network: 0,
      skill: 0,
      reputation: 0,
    };
    
    const overall = calculateOverallScore(scores, customWeights);
    expect(overall).toBe(100);
  });
});

// ============================================================================
// 能力向量测试
// ============================================================================

describe('generateCapabilityVector', () => {
  it('should return a vector of length 35', () => {
    const vector = generateCapabilityVector({
      computation: 50,
      storage: 50,
      network: 50,
      skill: 50,
      reputation: 50,
    });
    
    expect(vector.length).toBe(35);
  });

  it('should normalize dimension scores to 0-1', () => {
    const vector = generateCapabilityVector({
      computation: 50,
      storage: 50,
      network: 50,
      skill: 50,
      reputation: 50,
    });
    
    expect(vector[0]).toBeCloseTo(0.5); // computation
    expect(vector[1]).toBeCloseTo(0.5); // storage
    expect(vector[2]).toBeCloseTo(0.5); // network
    expect(vector[3]).toBeCloseTo(0.5); // skill
    expect(vector[4]).toBeCloseTo(0.5); // reputation
  });

  it('should include skill embeddings', () => {
    const skills: SkillTag[] = [{
      name: 'test',
      proficiency: 5,
      executions: 100,
      successRate: 0.9,
      lastUsedAt: Date.now(),
    }];
    
    const vector = generateCapabilityVector({
      computation: 50,
      storage: 50,
      network: 50,
      skill: 50,
      reputation: 50,
    }, skills);
    
    // Skill embedding starts at index 5
    expect(vector[5]).toBeCloseTo(1.0); // proficiency / 5
    expect(vector[6]).toBeCloseTo(0.9); // successRate
    expect(vector[7]).toBeGreaterThan(0); // normalizedExecutions
  });

  it('should pad with zeros for fewer than 10 skills', () => {
    const vector = generateCapabilityVector({
      computation: 50,
      storage: 50,
      network: 50,
      skill: 50,
      reputation: 50,
    }, []);
    
    // All skill embeddings should be 0
    for (let i = 5; i < 35; i++) {
      expect(vector[i]).toBe(0);
    }
  });
});

// ============================================================================
// 完整评分测试
// ============================================================================

describe('calculateCapabilityScore', () => {
  it('should return complete capability score', () => {
    const metrics = {
      computation: defaultComputationMetrics,
      storage: defaultStorageMetrics,
      network: defaultNetworkMetrics,
      skills: defaultSkillTags,
      reputation: defaultReputationMetrics,
    };
    
    const score = calculateCapabilityScore(metrics);
    
    expect(score.dimensionScores).toBeDefined();
    expect(score.overallScore).toBeDefined();
    expect(score.capabilityVector).toBeDefined();
    expect(score.capabilityVector.length).toBe(35);
  });

  it('should calculate consistent scores', () => {
    const metrics = {
      computation: defaultComputationMetrics,
      storage: defaultStorageMetrics,
      network: defaultNetworkMetrics,
      skills: defaultSkillTags,
      reputation: defaultReputationMetrics,
    };
    
    const score = calculateCapabilityScore(metrics);
    
    expect(score.dimensionScores.computation).toBe(
      scoreComputation(defaultComputationMetrics)
    );
    expect(score.dimensionScores.storage).toBe(
      scoreStorage(defaultStorageMetrics)
    );
  });
});

// ============================================================================
// 余弦相似度测试
// ============================================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const vec = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const vecA = [1, 0, 0];
    const vecB = [0, 1, 0];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0, 5);
  });

  it('should return 0 for different length vectors', () => {
    const vecA = [1, 2, 3];
    const vecB = [1, 2];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });

  it('should return 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('should return 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

// ============================================================================
// 衰减测试
// ============================================================================

describe('applyDecay', () => {
  it('should reduce score over time', () => {
    const initial = 100;
    const decayed = applyDecay(initial, 0.01, 1);
    expect(decayed).toBeLessThan(initial);
  });

  it('should apply exponential decay', () => {
    const score = 100;
    const decayRate = 0.01;
    
    const oneDay = applyDecay(score, decayRate, 1);
    const twoDays = applyDecay(score, decayRate, 2);
    const tenDays = applyDecay(score, decayRate, 10);
    
    expect(twoDays).toBeLessThan(oneDay);
    expect(tenDays).toBeLessThan(twoDays);
  });

  it('should not go below 0', () => {
    const decayed = applyDecay(1, 0.5, 1000);
    expect(decayed).toBeGreaterThanOrEqual(0);
  });
});

describe('decaySkillProficiency', () => {
  it('should reduce proficiency over time', () => {
    const decayed = decaySkillProficiency(5, 0.1, 10);
    expect(decayed).toBeLessThan(5);
  });

  it('should not go below 1', () => {
    const decayed = decaySkillProficiency(1, 0.5, 100);
    expect(decayed).toBeGreaterThanOrEqual(1);
  });

  it('should not exceed 5', () => {
    const decayed = decaySkillProficiency(5, 0, 0);
    expect(decayed).toBeLessThanOrEqual(5);
  });
});