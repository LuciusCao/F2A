# F2A Agent 协作系统设计

**版本**: 1.0.0  
**日期**: 2026-03-12  
**状态**: Phase 0 设计稿

---

## 1. 能力量化模型设计

### 1.1 设计原则

1. **多维度评估**: 不单一依赖信誉分，综合考虑计算、存储、网络、专业技能
2. **动态更新**: 能力评分随时间衰减，反映 Agent 当前状态
3. **防 Sybil 攻击**: 渐进式信誉，新节点需要时间积累信任
4. **分布式同步**: 能力信息通过 P2P 网络广播，无需中心化存储

### 1.2 能力量化 Schema

#### TypeScript 接口定义

```typescript
// src/types/capability-quant.ts

/**
 * Agent 能力量化评估体系
 */

// ============================================================================
// 能力维度定义
// ============================================================================

/**
 * 能力维度类型
 */
export type CapabilityDimension = 
  | 'computation'    // 计算能力
  | 'storage'        // 存储能力
  | 'network'        // 网络能力
  | 'skill'          // 专业技能
  | 'reputation';    // 信誉度

/**
 * 计算能力指标
 */
export interface ComputationMetrics {
  /** CPU 核心数 */
  cpuCores: number;
  /** CPU 基准分数 (Geekbench 单核) */
  cpuScore?: number;
  /** 可用内存 (MB) */
  memoryMB: number;
  /** GPU 加速支持 */
  gpuAccelerated: boolean;
  /** 并发任务处理能力 (同时执行的任务数) */
  concurrencyLimit: number;
  /** 平均任务执行速度 (tokens/秒 或 操作/秒) */
  throughput?: number;
}

/**
 * 存储能力指标
 */
export interface StorageMetrics {
  /** 可用存储空间 (GB) */
  availableGB: number;
  /** 存储类型 */
  storageType: 'hdd' | 'ssd' | 'nvme' | 'memory';
  /** 读写速度 (MB/s) */
  readSpeedMBps?: number;
  writeSpeedMBps?: number;
  /** 支持的文件类型 */
  supportedFormats: string[];
}

/**
 * 网络能力指标
 */
export interface NetworkMetrics {
  /** 带宽 (Mbps) */
  bandwidthMbps: number;
  /** 网络延迟 (ms，到主要节点的 P95) */
  latencyP95Ms?: number;
  /** 网络稳定性 (0-1，1 最稳定) */
  stability: number;
  /** 是否支持直连 */
  directConnect: boolean;
  /** 每月可用流量 (GB) */
  monthlyDataCapGB?: number;
}

/**
 * 专业技能标签
 */
export interface SkillTag {
  /** 技能名称 */
  name: string;
  /** 熟练度等级 (1-5) */
  proficiency: 1 | 2 | 3 | 4 | 5;
  /** 执行次数 */
  executions: number;
  /** 成功率 (0-1) */
  successRate: number;
  /** 平均执行时间 (ms) */
  avgExecutionTimeMs?: number;
  /** 最后使用时间 */
  lastUsedAt: number;
}

/**
 * 信誉度指标 (与现有 reputation.ts 集成)
 */
export interface ReputationMetrics {
  /** 信誉分数 (0-100) */
  score: number;
  /** 信誉等级 */
  level: 'restricted' | 'novice' | 'participant' | 'contributor' | 'core';
  /** 总任务数 */
  totalTasks: number;
  /** 成功任务数 */
  successTasks: number;
  /** 失败任务数 */
  failureTasks: number;
  /** 平均响应时间 (ms) */
  avgResponseTimeMs: number;
  /** 节点年龄 (天，从首次发现开始) */
  nodeAgeDays: number;
}

// ============================================================================
// 能力量化 Schema
// ============================================================================

/**
 * Agent 能力量化评估
 */
export interface AgentCapabilityQuant {
  /** PeerID */
  peerId: string;
  
  /** 基础能力 (从现有 AgentCapability 扩展) */
  baseCapabilities: AgentCapability[];
  
  /** 各维度评分 (0-100) */
  dimensionScores: {
    computation: number;
    storage: number;
    network: number;
    skill: number;
    reputation: number;
  };
  
  /** 详细指标 */
  metrics: {
    computation: ComputationMetrics;
    storage: StorageMetrics;
    network: NetworkMetrics;
    skills: SkillTag[];
    reputation: ReputationMetrics;
  };
  
  /** 综合评分 (加权平均) */
  overallScore: number;
  
  /** 能力向量 (用于相似度计算) */
  capabilityVector: number[];
  
  /** 最后更新时间 */
  lastUpdated: number;
  
  /** 数据版本 (用于冲突解决) */
  version: number;
}

/**
 * 能力维度权重配置
 */
export interface CapabilityWeights {
  computation: number;   // 默认 0.25
  storage: number;       // 默认 0.15
  network: number;       // 默认 0.20
  skill: number;         // 默认 0.20
  reputation: number;    // 默认 0.20
}

/**
 * 默认权重配置
 */
export const DEFAULT_CAPABILITY_WEIGHTS: CapabilityWeights = {
  computation: 0.25,
  storage: 0.15,
  network: 0.20,
  skill: 0.20,
  reputation: 0.20,
};
```

#### JSON Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "f2a://capability-quant.schema.json",
  "title": "F2A Agent Capability Quantification",
  "type": "object",
  "required": ["peerId", "dimensionScores", "metrics", "overallScore"],
  "properties": {
    "peerId": { "type": "string" },
    "dimensionScores": {
      "type": "object",
      "required": ["computation", "storage", "network", "skill", "reputation"],
      "properties": {
        "computation": { "type": "number", "minimum": 0, "maximum": 100 },
        "storage": { "type": "number", "minimum": 0, "maximum": 100 },
        "network": { "type": "number", "minimum": 0, "maximum": 100 },
        "skill": { "type": "number", "minimum": 0, "maximum": 100 },
        "reputation": { "type": "number", "minimum": 0, "maximum": 100 }
      }
    },
    "overallScore": { "type": "number", "minimum": 0, "maximum": 100 },
    "capabilityVector": {
      "type": "array",
      "items": { "type": "number" }
    },
    "lastUpdated": { "type": "number" },
    "version": { "type": "integer", "minimum": 1 }
  }
}
```

### 1.3 能力评分算法

#### 1.3.1 各维度评分公式

```typescript
// src/utils/capability-scorer.ts

/**
 * 计算能力评分 (0-100)
 */
function scoreComputation(metrics: ComputationMetrics): number {
  // 归一化各子指标
  const cpuScore = Math.min(100, (metrics.cpuScore || 1000) / 20); // 2000 分为满分
  const memoryScore = Math.min(100, metrics.memoryMB / 160); // 16GB 为满分
  const concurrencyScore = Math.min(100, metrics.concurrencyLimit * 10); // 10 并发为满分
  const throughputScore = metrics.throughput ? Math.min(100, metrics.throughput / 50) : 50; // 50 tokens/s 为满分
  const gpuBonus = metrics.gpuAccelerated ? 10 : 0;
  
  // 加权平均
  const raw = (cpuScore * 0.3 + memoryScore * 0.25 + concurrencyScore * 0.25 + throughputScore * 0.2) + gpuBonus;
  return Math.min(100, Math.max(0, raw));
}

/**
 * 存储能力评分 (0-100)
 */
function scoreStorage(metrics: StorageMetrics): number {
  const capacityScore = Math.min(100, metrics.availableGB / 10); // 1TB 为满分
  const typeMultiplier = { hdd: 0.5, ssd: 0.8, nvme: 1.0, memory: 1.2 }[metrics.storageType];
  const speedScore = metrics.readSpeedMBps ? Math.min(100, metrics.readSpeedMBps / 50) : 50;
  
  const raw = (capacityScore * 0.5 + speedScore * 0.5) * typeMultiplier;
  return Math.min(100, Math.max(0, raw));
}

/**
 * 网络能力评分 (0-100)
 */
function scoreNetwork(metrics: NetworkMetrics): number {
  const bandwidthScore = Math.min(100, metrics.bandwidthMbps / 100); // 100Mbps 为满分
  const latencyScore = metrics.latencyP95Ms ? Math.max(0, 100 - metrics.latencyP95Ms) : 50; // <100ms 为优
  const stabilityScore = metrics.stability * 100;
  const directBonus = metrics.directConnect ? 10 : 0;
  
  const raw = (bandwidthScore * 0.3 + latencyScore * 0.3 + stabilityScore * 0.4) + directBonus;
  return Math.min(100, Math.max(0, raw));
}

/**
 * 专业技能评分 (0-100)
 */
function scoreSkills(skills: SkillTag[]): number {
  if (skills.length === 0) return 30; // 默认基础分
  
  // 按熟练度和使用频率加权
  let totalScore = 0;
  let totalWeight = 0;
  
  const now = Date.now();
  for (const skill of skills) {
    // 时间衰减：最近使用的技能权重更高
    const daysSinceUse = (now - skill.lastUsedAt) / (1000 * 60 * 60 * 24);
    const recencyWeight = Math.exp(-daysSinceUse / 30); // 30 天半衰期
    
    const proficiencyScore = skill.proficiency * 20; // 5 级 -> 100 分
    const successScore = skill.successRate * 100;
    const experienceScore = Math.min(100, Math.log10(skill.executions + 1) * 25);
    
    const skillScore = (proficiencyScore * 0.4 + successScore * 0.4 + experienceScore * 0.2);
    const weight = recencyWeight;
    
    totalScore += skillScore * weight;
    totalWeight += weight;
  }
  
  return totalWeight > 0 ? Math.min(100, totalScore / totalWeight) : 30;
}

/**
 * 信誉度评分 (0-100) - 直接使用 reputation.ts 的分数
 */
function scoreReputation(metrics: ReputationMetrics): number {
  // 基础信誉分
  let score = metrics.score;
  
  // 成功率加成
  const successRate = metrics.totalTasks > 0 
    ? metrics.successTasks / metrics.totalTasks 
    : 0.5;
  score += (successRate - 0.5) * 20; // ±10 分
  
  // 节点年龄加成 (防止 Sybil 攻击)
  const ageBonus = Math.min(20, metrics.nodeAgeDays * 0.5); // 40 天拿满 20 分
  
  // 响应时间惩罚
  const latencyPenalty = metrics.avgResponseTimeMs > 10000 
    ? Math.min(10, (metrics.avgResponseTimeMs - 10000) / 1000) 
    : 0;
  
  return Math.min(100, Math.max(0, score + ageBonus - latencyPenalty));
}
```

#### 1.3.2 综合评分公式

```typescript
/**
 * 计算综合评分
 * overall = Σ(dimensionScore[i] × weight[i])
 */
function calculateOverallScore(
  dimensionScores: AgentCapabilityQuant['dimensionScores'],
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
```

### 1.4 能力更新机制

#### 1.4.1 动态调整策略

```typescript
/**
 * 能力更新策略
 */
export interface UpdateStrategy {
  /** 更新触发条件 */
  trigger: 'periodic' | 'event' | 'on-demand';
  /** 更新间隔 (ms，periodic 模式) */
  intervalMs?: number;
  /** 衰减率 (每日) */
  decayRate: number;
  /** 最大版本号 */
  maxVersion: number;
}

/**
 * 能力更新事件
 */
export type CapabilityUpdateEvent =
  | { type: 'task_completed'; taskId: string; success: boolean; latency: number }
  | { type: 'metrics_changed'; dimension: CapabilityDimension }
  | { type: 'periodic_decay' }
  | { type: 'peer_discovered'; peerId: string }
  | { type: 'peer_disconnected'; peerId: string };

/**
 * 能力管理器 - 负责动态更新
 */
export class CapabilityManager {
  private localQuant: AgentCapabilityQuant | null = null;
  private peerQuants: Map<string, AgentCapabilityQuant> = new Map();
  private updateListeners: Set<(event: CapabilityUpdateEvent) => void> = new Set();
  
  /**
   * 更新本地能力评估
   */
  async updateLocalCapabilities(): Promise<void> {
    // 1. 收集系统指标
    const metrics = await this.collectSystemMetrics();
    
    // 2. 更新各维度评分
    const dimensionScores = {
      computation: scoreComputation(metrics.computation),
      storage: scoreStorage(metrics.storage),
      network: scoreNetwork(metrics.network),
      skill: scoreSkills(metrics.skills),
      reputation: scoreReputation(metrics.reputation)
    };
    
    // 3. 计算综合评分
    const overallScore = calculateOverallScore(dimensionScores);
    
    // 4. 生成能力向量
    const capabilityVector = this.generateCapabilityVector(dimensionScores, metrics.skills);
    
    // 5. 更新本地评估
    this.localQuant = {
      peerId: this.peerId,
      baseCapabilities: this.getBaseCapabilities(),
      dimensionScores,
      metrics,
      overallScore,
      capabilityVector,
      lastUpdated: Date.now(),
      version: (this.localQuant?.version || 0) + 1
    };
    
    // 6. 广播更新
    this.broadcastCapabilityUpdate();
  }
  
  /**
   * 应用时间衰减
   */
  applyDecay(peerId: string): void {
    const quant = this.peerQuants.get(peerId);
    if (!quant) return;
    
    // 技能和信誉度衰减
    const decayFactor = 0.99; // 每日衰减 1%
    
    for (const skill of quant.metrics.skills) {
      skill.proficiency = Math.max(1, Math.floor(skill.proficiency * decayFactor));
    }
    
    // 重新计算评分
    quant.metrics.skill = scoreSkills(quant.metrics.skills);
    quant.overallScore = calculateOverallScore(quant.dimensionScores);
    quant.version++;
  }
}
```

### 1.5 能力存储与同步

#### 1.5.1 分布式存储策略

```typescript
/**
 * 能力信息同步协议
 * 基于 P2P 网络的 Gossip 协议
 */
export interface CapabilityGossipMessage {
  type: 'CAPABILITY_GOSSIP';
  from: string;
  timestamp: number;
  entries: Array<{
    peerId: string;
    quant: AgentCapabilityQuant;
    signature: string; // 防篡改
  }>;
}

/**
 * 同步策略:
 * 1. 本地能力变更时立即广播
 * 2. 定期 (每 5 分钟) Gossip 交换
 * 3. 新节点加入时全量同步
 * 4. 版本冲突时采用"最新时间戳 + 最高信誉"策略
 */
```

---

## 2. 比较优势计算框架

### 2.1 比较优势计算公式

#### 2.1.1 任务需求解析

```typescript
// src/utils/task-requirements.ts

/**
 * 任务需求解析结果
 */
export interface TaskRequirements {
  /** 必需的能力 */
  requiredCapabilities: string[];
  /** 期望的能力维度权重 */
  dimensionWeights: CapabilityWeights;
  /** 最低综合评分 */
  minOverallScore: number;
  /** 截止时间 (ms) */
  deadline?: number;
  /** 预算 (token/积分) */
  budget?: number;
  /** 优先级 */
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * 从任务描述提取需求
 */
export function parseTaskRequirements(
  taskType: string,
  description: string,
  parameters?: Record<string, unknown>
): TaskRequirements {
  // 基于任务类型的默认配置
  const defaults: Record<string, Partial<TaskRequirements>> = {
    'code-generation': {
      dimensionWeights: { computation: 0.35, storage: 0.1, network: 0.15, skill: 0.3, reputation: 0.1 },
      minOverallScore: 50
    },
    'data-processing': {
      dimensionWeights: { computation: 0.3, storage: 0.3, network: 0.15, skill: 0.15, reputation: 0.1 },
      minOverallScore: 40
    },
    'web-research': {
      dimensionWeights: { computation: 0.15, storage: 0.1, network: 0.4, skill: 0.2, reputation: 0.15 },
      minOverallScore: 45
    },
    'file-operation': {
      dimensionWeights: { computation: 0.2, storage: 0.35, network: 0.15, skill: 0.15, reputation: 0.15 },
      minOverallScore: 35
    }
  };
  
  const defaultReq = defaults[taskType] || {
    dimensionWeights: DEFAULT_CAPABILITY_WEIGHTS,
    minOverallScore: 40
  };
  
  return {
    requiredCapabilities: [taskType],
    dimensionWeights: defaultReq.dimensionWeights!,
    minOverallScore: defaultReq.minOverallScore!,
    priority: parameters?.['priority'] as TaskRequirements['priority'] || 'medium',
    deadline: parameters?.['deadline'] as number,
    budget: parameters?.['budget'] as number
  };
}
```

#### 2.1.2 比较优势计算

```typescript
// src/utils/comparative-advantage.ts

/**
 * 比较优势计算结果
 */
export interface ComparativeAdvantageScore {
  peerId: string;
  /** 综合匹配度 (0-1) */
  matchScore: number;
  /** 能力匹配度 */
  capabilityMatch: number;
  /** 成本效益比 */
  costEfficiency: number;
  /** 可用性评分 */
  availability: number;
  /** 负载均衡因子 */
  loadFactor: number;
}

/**
 * 计算 Agent 对特定任务的比较优势
 * 
 * 公式:
 * advantage(A, T) = α·match(A.capabilityVector, T.requirements) 
 *                 + β·(1 - A.currentLoad) 
 *                 + γ·costEfficiency(A)
 *                 - δ·latency(A)
 * 
 * 其中:
 * - match: 余弦相似度
 * - currentLoad: 当前负载率 (0-1)
 * - costEfficiency: 单位成本产出
 * - latency: 网络延迟
 */
export function calculateComparativeAdvantage(
  agent: AgentCapabilityQuant,
  task: TaskRequirements,
  agentLoad: number, // 当前负载率 0-1
  estimatedCost: number,
  networkLatencyMs: number
): ComparativeAdvantageScore {
  // 1. 能力匹配度 (余弦相似度)
  const capabilityMatch = cosineSimilarity(
    agent.capabilityVector,
    taskToVector(task)
  );
  
  // 2. 可用性评分 (考虑负载)
  const availability = 1 - agentLoad;
  
  // 3. 成本效益比 (能力/成本)
  const costEfficiency = agent.overallScore / Math.max(1, estimatedCost);
  
  // 4. 负载均衡因子 (惩罚高负载节点)
  const loadFactor = agentLoad > 0.8 ? 0.5 : agentLoad > 0.6 ? 0.8 : 1.0;
  
  // 5. 延迟惩罚
  const latencyPenalty = Math.min(0.3, networkLatencyMs / 1000);
  
  // 6. 综合计算 (权重可调)
  const weights = {
    capability: 0.4,
    availability: 0.25,
    costEfficiency: 0.2,
    load: 0.1,
    latency: 0.05
  };
  
  const matchScore = 
    weights.capability * capabilityMatch +
    weights.availability * availability +
    weights.costEfficiency * costEfficiency +
    weights.load * loadFactor -
    weights.latency * latencyPenalty;
  
  return {
    peerId: agent.peerId,
    matchScore: Math.max(0, matchScore),
    capabilityMatch,
    costEfficiency,
    availability,
    loadFactor
  };
}

/**
 * 余弦相似度计算
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 将任务需求转换为向量
 */
function taskToVector(task: TaskRequirements): number[] {
  // 5 个维度 + 技能维度
  const { computation, storage, network, skill, reputation } = task.dimensionWeights;
  return [computation, storage, network, skill, reputation];
}
```

### 2.2 多 Agent 竞标机制

```typescript
// src/core/task-auction.ts

/**
 * 竞标记录
 */
interface Bid {
  peerId: string;
  advantageScore: ComparativeAdvantageScore;
  estimatedTimeMs: number;
  quotedCost: number;
  timestamp: number;
}

/**
 * 任务拍卖器
 */
export class TaskAuctioneer {
  private activeAuctions: Map<string, Bid[]> = new Map();
  
  /**
   * 发起任务拍卖
   */
  async startAuction(
    taskId: string,
    task: TaskRequirements,
    candidateAgents: AgentCapabilityQuant[]
  ): Promise<string> {
    const bids: Bid[] = [];
    
    // 1. 向候选 Agent 发送招标请求
    const bidRequests = candidateAgents.map(agent => 
      this.requestBid(taskId, task, agent)
    );
    
    // 2. 等待竞标 (带超时)
    const auctionTimeout = 2000; // 2 秒
    await Promise.race([
      Promise.all(bidRequests).then(results => bids.push(...results)),
      sleep(auctionTimeout)
    ]);
    
    // 3. 选择最优竞标者
    const winner = this.selectWinner(bids);
    
    return winner.peerId;
  }
  
  /**
   * 选择获胜者
   * 策略：综合评分最高，但引入随机性避免单一节点垄断
   */
  private selectWinner(bids: Bid[]): Bid {
    if (bids.length === 0) {
      throw new Error('No bids received');
    }
    
    if (bids.length === 1) {
      return bids[0];
    }
    
    // 按 matchScore 排序
    bids.sort((a, b) => b.advantageScore.matchScore - a.advantageScore.matchScore);
    
    // Top-K 随机选择 (避免总是选第一名)
    const topK = Math.min(3, bids.length);
    const topBids = bids.slice(0, topK);
    
    // 加权随机 (分数越高概率越大)
    const totalScore = topBids.reduce((sum, b) => sum + b.advantageScore.matchScore, 0);
    const random = Math.random() * totalScore;
    let cumulative = 0;
    
    for (const bid of topBids) {
      cumulative += bid.advantageScore.matchScore;
      if (random <= cumulative) {
        return bid;
      }
    }
    
    return topBids[0];
  }
}
```

### 2.3 负载均衡考虑

```typescript
// src/utils/load-balancer.ts

/**
 * 节点负载信息
 */
interface LoadInfo {
  peerId: string;
  /** 当前运行任务数 */
  activeTasks: number;
  /** 任务队列长度 */
  queueLength: number;
  /** CPU 使用率 (0-1) */
  cpuUsage: number;
  /** 内存使用率 (0-1) */
  memoryUsage: number;
  /** 最后更新时间 */
  lastUpdated: number;
}

/**
 * 负载均衡器
 */
export class LoadBalancer {
  private peerLoads: Map<string, LoadInfo> = new Map();
  
  /**
   * 计算负载因子
   * 用于调整比较优势评分
   */
  calculateLoadFactor(peerId: string): number {
    const load = this.peerLoads.get(peerId);
    if (!load) return 1.0; // 未知节点，不惩罚
    
    // 综合负载率
    const combinedLoad = 
      (load.activeTasks / 10) * 0.4 +  // 假设最大 10 个并发
      (load.queueLength / 20) * 0.3 +   // 假设最大 20 个排队
      load.cpuUsage * 0.2 +
      load.memoryUsage * 0.1;
    
    // 负载因子：低负载=1.0, 高负载=0.5
    if (combinedLoad < 0.5) return 1.0;
    if (combinedLoad < 0.7) return 0.8;
    if (combinedLoad < 0.9) return 0.6;
    return 0.5;
  }
  
  /**
   * 过载检测
   */
  isOverloaded(peerId: string): boolean {
    const load = this.peerLoads.get(peerId);
    if (!load) return false;
    
    return load.cpuUsage > 0.9 || 
           load.memoryUsage > 0.9 || 
           load.queueLength > 50;
  }
}
```

---

## 3. 任务匹配流程

### 3.1 序列图

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│ TaskPublisher│     │ TaskAuctioneer│     │CapabilityMgr│     │  Agents     │
└──────┬──────┘     └──────┬───────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                     │                   │
       │ publishTask(T)    │                     │                   │
       │──────────────────>│                     │                   │
       │                   │                     │                   │
       │                   │ parseRequirements(T)│                   │
       │                   │────────────────────>│                   │
       │                   │                     │                   │
       │                   │     requirements    │                   │
       │                   │<────────────────────│                   │
       │                   │                     │                   │
       │                   │ discoverAgents(req) │                   │
       │                   │────────────────────────────────────────>│
       │                   │                     │                   │
       │                   │    agentList[]      │                   │
       │                   │<────────────────────────────────────────│
       │                   │                     │                   │
       │                   │ calcAdvantage(A,T)  │                   │
       │                   │────────────────────>│                   │
       │                   │                     │                   │
       │                   │   advantageScores[] │                   │
       │                   │<────────────────────│                   │
       │                   │                     │                   │
       │                   │ startAuction()      │                   │
       │                   │────────────────────────────────────────>│
       │                   │                     │                   │
       │                   │       bids[]        │                   │
       │                   │<────────────────────────────────────────│
       │                   │                     │                   │
       │                   │ selectWinner()      │                   │
       │                   │                     │                   │
       │                   │ assignTask(winner)  │                   │
       │                   │────────────────────────────────────────>│
       │                   │                     │                   │
       │ taskAssigned(id)  │                     │                   │
       │<──────────────────│                     │                   │
       │                   │                     │                   │
```

### 3.2 流程图

```
                    ┌─────────────────┐
                    │  发布任务 T     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ 解析任务需求    │
                    │ parseRequirements│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ 发现候选 Agents │
                    │ (按能力过滤)    │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐          ┌────────▼────────┐
     │ 计算比较优势    │          │ 检查负载状态    │
     │ advantageScore  │          │ loadFactor      │
     └────────┬────────┘          └────────┬────────┘
              │                             │
              └──────────────┬──────────────┘
                             │
                    ┌────────▼────────┐
                    │  多 Agent 竞标   │
                    │  (加权随机选择) │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  分配任务       │
                    │  更新负载信息   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  监控执行       │
                    │  更新信誉/能力  │
                    └─────────────────┘
```

---

## 4. 与现有代码的集成点

### 4.1 需要新增的文件

```
src/
├── types/
│   └── capability-quant.ts       # 能力量化类型定义
├── utils/
│   ├── capability-scorer.ts      # 能力评分算法
│   ├── task-requirements.ts      # 任务需求解析
│   ├── comparative-advantage.ts  # 比较优势计算
│   ├── load-balancer.ts          # 负载均衡器
│   └── capability-vector.ts      # 能力向量生成
├── core/
│   ├── capability-manager.ts     # 能力管理器
│   └── task-auction.ts           # 任务拍卖器
└── protocols/
    └── capability-gossip.ts      # 能力同步协议
```

### 4.2 需要修改的文件

#### 4.2.1 `src/types/index.ts`

在现有 `AgentCapability` 接口基础上扩展：

```typescript
// 添加新的导入
import type { AgentCapabilityQuant, CapabilityWeights } from './capability-quant.js';

// 扩展 AgentInfo 接口
export interface AgentInfo {
  // ... 现有字段
  /** 能力量化评估 (Phase 1 新增) */
  capabilityQuant?: AgentCapabilityQuant;
}
```

#### 4.2.2 `src/core/f2a.ts`

在 `F2A` 类中添加能力管理方法：

```typescript
import { CapabilityManager } from './capability-manager.js';
import { TaskAuctioneer } from './task-auction.js';

export class F2A extends EventEmitter<F2AEvents> implements F2AInstance {
  // 新增字段
  private capabilityManager: CapabilityManager;
  private taskAuctioneer: TaskAuctioneer;
  
  // 在构造函数中初始化
  constructor(...) {
    // ...
    this.capabilityManager = new CapabilityManager(this);
    this.taskAuctioneer = new TaskAuctioneer(this);
  }
  
  // 新增方法
  /**
   * 更新本地能力评估
   */
  async updateCapabilities(): Promise<Result<void>> {
    return this.capabilityManager.updateLocalCapabilities();
  }
  
  /**
   * 获取网络中 Agent 的能力排名
   */
  async getCapabilityRankings(
    dimension?: CapabilityDimension
  ): Promise<AgentCapabilityQuant[]> {
    return this.capabilityManager.getRankings(dimension);
  }
  
  // 修改 delegateTask 方法，使用新的拍卖机制
  async delegateTask(options: TaskDelegateOptions): Promise<Result<TaskDelegateResult>> {
    // Phase 1: 保持现有逻辑
    // Phase 2: 使用 TaskAuctioneer 进行智能分配
    const requirements = parseTaskRequirements(
      options.capability,
      options.description,
      options.parameters
    );
    
    const candidates = await this.capabilityManager.findCandidates(requirements);
    const winner = await this.taskAuctioneer.startAuction(
      `task-${randomUUID()}`,
      requirements,
      candidates
    );
    
    // 发送任务给获胜者
    return this.sendTaskTo(winner, options.capability, options.description, options.parameters);
  }
}
```

#### 4.2.3 `src/core/p2p-network.ts`

添加能力同步消息类型：

```typescript
// 扩展 F2AMessageType
export type F2AMessageType = 
  | 'DISCOVER'
  | 'DISCOVER_RESP'
  | 'CAPABILITY_QUERY'
  | 'CAPABILITY_RESPONSE'
  | 'CAPABILITY_GOSSIP'      // 新增：能力同步
  | 'TASK_REQUEST'
  | 'TASK_RESPONSE'
  | 'LOAD_UPDATE'            // 新增：负载更新
  // ... 其他类型
```

### 4.3 与 reputation.ts 的集成

```typescript
// 在 reputation.ts 中添加能力评分钩子
export class ReputationManager {
  // 新增方法
  /**
   * 获取信誉相关的的能力指标
   */
  getReputationMetrics(peerId: string): ReputationMetrics {
    const entry = this.getReputation(peerId);
    return {
      score: entry.score,
      level: entry.level,
      totalTasks: entry.history.length,
      successTasks: entry.history.filter(e => e.type === 'task_success').length,
      failureTasks: entry.history.filter(e => e.type === 'task_failure').length,
      avgResponseTimeMs: this.calculateAvgResponseTime(entry),
      nodeAgeDays: this.calculateNodeAge(entry)
    };
  }
}
```

---

## 5. 示例场景

### 5.1 场景 1: 代码生成任务分配

**背景**: 用户需要生成一个 React 组件

```typescript
// 任务发布
const task = {
  type: 'code-generation',
  description: '创建一个带表单验证的登录组件',
  parameters: {
    framework: 'react',
    language: 'typescript'
  }
};

// 系统处理流程
// 1. 解析需求：需要高 computation(0.35) 和 skill(0.3) 权重
// 2. 发现候选：找到 5 个有 code-generation 能力的 Agent
// 3. 计算比较优势:
//    - Agent A: match=0.85, load=0.3, cost=100 → score=0.78
//    - Agent B: match=0.92, load=0.8, cost=120 → score=0.65 (负载高)
//    - Agent C: match=0.78, load=0.2, cost=80 → score=0.72
// 4. 拍卖选择：Agent A 获胜 (综合评分最高)
// 5. 分配任务并监控执行
```

### 5.2 场景 2: 大文件处理负载均衡

**背景**: 需要处理一个 2GB 的日志文件

```typescript
// 任务发布
const task = {
  type: 'data-processing',
  description: '分析日志文件，提取错误模式',
  parameters: {
    fileSize: '2GB',
    priority: 'high'
  }
};

// 系统处理流程
// 1. 解析需求：需要高 storage(0.3) 和 computation(0.3) 权重
// 2. 过滤候选：排除 availableGB < 5GB 的 Agent
// 3. 负载检查:
//    - Agent X: storage=0.9, but load=0.95 → 过载，排除
//    - Agent Y: storage=0.85, load=0.4 → 合适
//    - Agent Z: storage=0.75, load=0.2 → 合适
// 4. 比较优势计算：考虑网络延迟 (大文件传输)
// 5. 选择 Agent Y (存储能力最强且负载合理)
```

### 5.3 场景 3: 紧急任务的快速响应

**背景**: 生产环境故障，需要立即诊断

```typescript
// 任务发布
const task = {
  type: 'web-research',
  description: '查询最新的服务错误日志和监控数据',
  parameters: {
    priority: 'urgent',
    deadline: Date.now() + 5 * 60 * 1000  // 5 分钟内
  }
};

// 系统处理流程
// 1. 解析需求：urgent 优先级，调整权重 network(0.4)
// 2. 发现候选：只考虑 latencyP95 < 100ms 的 Agent
// 3. 比较优势计算：
//    - 降低 costEfficiency 权重 (紧急任务不考虑成本)
//    - 提高 availability 权重 (确保立即可用)
// 4. 跳过拍卖 (节省时间)，直接选择评分最高的 Agent
// 5. 分配任务并设置超时监控
```

---

## 6. 安全考虑

### 6.1 防 Sybil 攻击

```typescript
/**
 * 渐进式信誉机制
 * 新节点需要时间积累信任，无法立即获得高评分
 */
function calculateReputationScore(metrics: ReputationMetrics): number {
  // 节点年龄因子 (0-40 天线性增长)
  const ageFactor = Math.min(1, metrics.nodeAgeDays / 40);
  
  // 基础分受年龄限制
  const maxScore = 50 + ageFactor * 50; // 新节点最高 50 分，40 天后可达 100 分
  
  const rawScore = metrics.score * ageFactor;
  return Math.min(maxScore, rawScore);
}
```

### 6.2 能力信息防篡改

```typescript
/**
 * 能力信息签名
 * 防止恶意节点伪造能力评估
 */
interface SignedCapabilityQuant extends AgentCapabilityQuant {
  /** 签名 (使用节点私钥) */
  signature: string;
  /** 签名时间戳 */
  signedAt: number;
}

async function signCapabilityQuant(
  quant: AgentCapabilityQuant,
  privateKey: CryptoKey
): Promise<SignedCapabilityQuant> {
  const data = new TextEncoder().encode(JSON.stringify(quant));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
  
  return {
    ...quant,
    signature: Buffer.from(signature).toString('base64'),
    signedAt: Date.now()
  };
}
```

---

## 7. 实施路线图

### Phase 1 (P1) - 基础能力量化

- [ ] 实现 `capability-quant.ts` 类型定义
- [ ] 实现 `capability-scorer.ts` 评分算法
- [ ] 扩展 `AgentInfo` 接口添加 `capabilityQuant` 字段
- [ ] 实现本地能力评估更新

### Phase 2 (P2) - 比较优势与任务匹配

- [ ] 实现 `comparative-advantage.ts`
- [ ] 实现 `task-auction.ts` 拍卖机制
- [ ] 修改 `f2a.ts` 的 `delegateTask` 方法
- [ ] 添加负载均衡器

### Phase 3 (P3) - 分布式同步

- [ ] 实现 `capability-gossip.ts` 协议
- [ ] 添加 `CAPABILITY_GOSSIP` 消息类型
- [ ] 实现版本冲突解决
- [ ] 性能优化与测试

---

## 8. 参考与延伸阅读

- [F2A Phase 0 共识文档](./phase0-consensus.md)
- [信誉系统设计](../src/core/reputation.ts)
- [libp2p Gossipsub 协议](https://docs.libp2p.io/concepts/pubsub/gossipsub/)
