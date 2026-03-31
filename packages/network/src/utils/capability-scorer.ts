/**
 * F2A 能力评分算法
 * Phase 2: 能力量化模型
 * 
 * 提供各维度的能力评分计算
 */

import type {
  ComputationMetrics,
  StorageMetrics,
  NetworkMetrics,
  SkillTag,
  ReputationMetrics,
  DimensionScores,
  CapabilityVector,
  CapabilityWeights,
  CapabilityScore,
} from '../types/capability-quant.js';

import { DEFAULT_CAPABILITY_WEIGHTS } from '../types/capability-quant.js';

// ============================================================================
// 各维度评分算法
// ============================================================================

/**
 * 计算能力评分 (0-100)
 * 
 * 评分公式：
 * cpuScore * 0.3 + memoryScore * 0.25 + concurrencyScore * 0.25 + throughputScore * 0.2 + gpuBonus
 */
export function scoreComputation(metrics: ComputationMetrics): number {
  // 归一化各子指标
  // CPU 分数：2000 Geekbench 分为满分基准
  const cpuScore = Math.min(100, (metrics.cpuScore || 1000) / 20);
  
  // 内存分数：16GB 为满分基准
  const memoryScore = Math.min(100, metrics.memoryMB / 160);
  
  // 并发分数：10 并发为满分基准
  const concurrencyScore = Math.min(100, metrics.concurrencyLimit * 10);
  
  // 吞吐量分数：50 tokens/s 为满分基准，未知默认 50 分
  const throughputScore = metrics.throughput 
    ? Math.min(100, metrics.throughput / 50) 
    : 50;
  
  // GPU 加成：10 分
  const gpuBonus = metrics.gpuAccelerated ? 10 : 0;
  
  // 加权平均
  const raw = (
    cpuScore * 0.3 + 
    memoryScore * 0.25 + 
    concurrencyScore * 0.25 + 
    throughputScore * 0.2
  ) + gpuBonus;
  
  return Math.min(100, Math.max(0, raw));
}

/**
 * 存储能力评分 (0-100)
 * 
 * 评分公式：
 * (capacityScore * 0.5 + speedScore * 0.5) * typeMultiplier
 */
export function scoreStorage(metrics: StorageMetrics): number {
  // 容量分数：1TB 为满分基准
  const capacityScore = Math.min(100, metrics.availableGB / 10);
  
  // 类型乘数
  const typeMultiplier: Record<string, number> = {
    hdd: 0.5,
    ssd: 0.8,
    nvme: 1.0,
    memory: 1.2,
  };
  const multiplier = typeMultiplier[metrics.storageType] ?? 0.5;
  
  // 速度分数：未知默认 50 分
  const speedScore = metrics.readSpeedMBps 
    ? Math.min(100, metrics.readSpeedMBps / 50) 
    : 50;
  
  const raw = (capacityScore * 0.5 + speedScore * 0.5) * multiplier;
  
  return Math.min(100, Math.max(0, raw));
}

/**
 * 网络能力评分 (0-100)
 * 
 * 评分公式：
 * bandwidthScore * 0.3 + latencyScore * 0.3 + stabilityScore * 0.4 + directBonus
 */
export function scoreNetwork(metrics: NetworkMetrics): number {
  // 带宽分数：100Mbps 为满分基准
  const bandwidthScore = Math.min(100, metrics.bandwidthMbps / 100);
  
  // 延迟分数：<100ms 为优，未知默认 50 分
  const latencyScore = metrics.latencyP95Ms 
    ? Math.max(0, 100 - metrics.latencyP95Ms) 
    : 50;
  
  // 稳定性分数
  const stabilityScore = metrics.stability * 100;
  
  // 直连加成：10 分
  const directBonus = metrics.directConnect ? 10 : 0;
  
  const raw = (
    bandwidthScore * 0.3 + 
    latencyScore * 0.3 + 
    stabilityScore * 0.4
  ) + directBonus;
  
  return Math.min(100, Math.max(0, raw));
}

/**
 * 专业技能评分 (0-100)
 * 
 * 评分公式：
 * 对每个技能计算 (proficiencyScore * 0.4 + successScore * 0.4 + experienceScore * 0.2)
 * 按时间衰减后取平均，最低保证 30 分
 */
export function scoreSkills(skills: SkillTag[]): number {
  // 无技能时，默认基础分 30
  if (skills.length === 0) {
    return 30;
  }
  
  const now = Date.now();
  let totalScore = 0;
  
  for (const skill of skills) {
    // 时间衰减：最近使用的技能分数更高
    // 30 天半衰期，衰减应用于最终技能分数
    const daysSinceUse = (now - skill.lastUsedAt) / (1000 * 60 * 60 * 24);
    const recencyDecay = Math.exp(-daysSinceUse / 30);
    
    // 熟练度分数：5 级 -> 100 分
    const proficiencyScore = skill.proficiency * 20;
    
    // 成功率分数
    const successScore = skill.successRate * 100;
    
    // 经验分数：log10(executions + 1) * 25，最大 100
    const experienceScore = Math.min(100, Math.log10(skill.executions + 1) * 25);
    
    // 技能综合分数
    const skillScore = (
      proficiencyScore * 0.4 + 
      successScore * 0.4 + 
      experienceScore * 0.2
    );
    
    // 应用时间衰减后累加
    totalScore += skillScore * recencyDecay;
  }
  
  // 平均分（衰减后），最低保证 30 分
  const avgScore = totalScore / skills.length;
  return Math.min(100, Math.max(30, avgScore));
}

/**
 * 信誉度评分 (0-100)
 * 
 * 评分公式：
 * baseScore + successRateBonus + ageBonus - latencyPenalty
 */
export function scoreReputation(metrics: ReputationMetrics): number {
  // 基础信誉分
  let score = metrics.score;
  
  // 成功率加成：±10 分
  const successRate = metrics.totalTasks > 0 
    ? metrics.successTasks / metrics.totalTasks 
    : 0.5;
  score += (successRate - 0.5) * 20;
  
  // 节点年龄加成 (防止 Sybil 攻击)
  // 40 天拿满 20 分
  const ageBonus = Math.min(20, metrics.nodeAgeDays * 0.5);
  
  // 响应时间惩罚：超过 10 秒开始惩罚，最多 10 分
  const latencyPenalty = metrics.avgResponseTimeMs > 10000 
    ? Math.min(10, (metrics.avgResponseTimeMs - 10000) / 1000) 
    : 0;
  
  const finalScore = score + ageBonus - latencyPenalty;
  return Math.min(100, Math.max(0, finalScore));
}

// ============================================================================
// 综合评分
// ============================================================================

/**
 * 计算综合评分
 * 
 * 公式：overall = Σ(dimensionScore[i] × weight[i])
 */
export function calculateOverallScore(
  dimensionScores: DimensionScores,
  weights: CapabilityWeights = DEFAULT_CAPABILITY_WEIGHTS
): number {
  const { computation, storage, network, skill, reputation } = dimensionScores;
  
  const overall = 
    computation * weights.computation +
    storage * weights.storage +
    network * weights.network +
    skill * weights.skill +
    reputation * weights.reputation;
  
  return Math.min(100, Math.max(0, overall));
}

// ============================================================================
// 能力向量
// ============================================================================

/**
 * 生成能力向量
 * 
 * 格式: [computation, storage, network, skill, reputation, ...skillEmbeddings]
 * 
 * @param dimensionScores 维度评分
 * @param skills 技能标签列表
 */
export function generateCapabilityVector(
  dimensionScores: DimensionScores,
  skills: SkillTag[] = []
): CapabilityVector {
  // 基础 5 维向量
  const vector: number[] = [
    dimensionScores.computation / 100,
    dimensionScores.storage / 100,
    dimensionScores.network / 100,
    dimensionScores.skill / 100,
    dimensionScores.reputation / 100,
  ];
  
  // 技能嵌入向量 (简化版：按熟练度排序前 10 个技能)
  const sortedSkills = [...skills]
    .sort((a, b) => b.proficiency - a.proficiency)
    .slice(0, 10);
  
  // 技能向量：每个技能用 proficiency + successRate + normalizedExecutions 表示
  for (const skill of sortedSkills) {
    const normalizedExecutions = Math.min(1, Math.log10(skill.executions + 1) / 3);
    vector.push(
      skill.proficiency / 5,
      skill.successRate,
      normalizedExecutions
    );
  }
  
  // 填充到固定长度 (5 + 10 * 3 = 35)
  while (vector.length < 35) {
    vector.push(0);
  }
  
  return vector;
}

// ============================================================================
// 完整评分
// ============================================================================

/**
 * 计算完整能力评分
 */
export function calculateCapabilityScore(
  metrics: {
    computation: ComputationMetrics;
    storage: StorageMetrics;
    network: NetworkMetrics;
    skills: SkillTag[];
    reputation: ReputationMetrics;
  },
  weights: CapabilityWeights = DEFAULT_CAPABILITY_WEIGHTS
): CapabilityScore {
  // 计算各维度评分
  const dimensionScores: DimensionScores = {
    computation: scoreComputation(metrics.computation),
    storage: scoreStorage(metrics.storage),
    network: scoreNetwork(metrics.network),
    skill: scoreSkills(metrics.skills),
    reputation: scoreReputation(metrics.reputation),
  };
  
  // 计算综合评分
  const overallScore = calculateOverallScore(dimensionScores, weights);
  
  // 生成能力向量
  const capabilityVector = generateCapabilityVector(dimensionScores, metrics.skills);
  
  return {
    dimensionScores,
    overallScore,
    capabilityVector,
  };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 余弦相似度计算
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 能力衰减
 * 
 * @param currentScore 当前分数
 * @param decayRate 衰减率 (每日)
 * @param daysPassed 经过的天数
 */
export function applyDecay(
  currentScore: number,
  decayRate: number,
  daysPassed: number
): number {
  // 指数衰减
  const decayFactor = Math.pow(1 - decayRate, daysPassed);
  return Math.max(0, currentScore * decayFactor);
}

/**
 * 技能熟练度衰减
 * 
 * @param proficiency 当前熟练度 (1-5)
 * @param decayRate 衰减率
 * @param daysPassed 经过的天数
 */
export function decaySkillProficiency(
  proficiency: 1 | 2 | 3 | 4 | 5,
  decayRate: number,
  daysPassed: number
): 1 | 2 | 3 | 4 | 5 {
  const decayFactor = Math.pow(1 - decayRate, daysPassed);
  const newProficiency = Math.floor(proficiency * decayFactor);
  return Math.max(1, Math.min(5, newProficiency)) as 1 | 2 | 3 | 4 | 5;
}