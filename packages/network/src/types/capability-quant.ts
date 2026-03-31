/**
 * F2A 能力量化评估类型定义
 * Phase 2: 能力量化模型
 * 
 * 参考: docs/agent-collaboration-design.md
 */

import type { AgentCapability } from './index.js';

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
 * 能力维度评分
 */
export interface DimensionScores {
  computation: number;
  storage: number;
  network: number;
  skill: number;
  reputation: number;
}

/**
 * 能力详细指标
 */
export interface CapabilityMetrics {
  computation: ComputationMetrics;
  storage: StorageMetrics;
  network: NetworkMetrics;
  skills: SkillTag[];
  reputation: ReputationMetrics;
}

/**
 * 能力向量 (用于相似度计算)
 * 格式: [computation, storage, network, skill, reputation, ...skillEmbeddings]
 */
export type CapabilityVector = number[];

/**
 * 能力评分
 */
export interface CapabilityScore {
  /** 各维度评分 (0-100) */
  dimensionScores: DimensionScores;
  /** 综合评分 (加权平均) */
  overallScore: number;
  /** 能力向量 */
  capabilityVector: CapabilityVector;
}

/**
 * Agent 能力量化评估
 */
export interface AgentCapabilityQuant {
  /** PeerID */
  peerId: string;
  
  /** 基础能力 (从现有 AgentCapability 扩展) */
  baseCapabilities: AgentCapability[];
  
  /** 能力评分 */
  scores: CapabilityScore;
  
  /** 详细指标 */
  metrics: CapabilityMetrics;
  
  /** 最后更新时间 */
  lastUpdated: number;
  
  /** 数据版本 (用于冲突解决) */
  version: number;
}

// ============================================================================
// 权重配置
// ============================================================================

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

// ============================================================================
// 更新策略
// ============================================================================

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
 * 默认更新策略
 */
export const DEFAULT_UPDATE_STRATEGY: UpdateStrategy = {
  trigger: 'periodic',
  intervalMs: 5 * 60 * 1000, // 5 分钟
  decayRate: 0.01,           // 每日衰减 1%
  maxVersion: Number.MAX_SAFE_INTEGER,
};

// ============================================================================
// 能力更新事件
// ============================================================================

/**
 * 能力更新事件类型
 */
export type CapabilityUpdateEvent =
  | { type: 'task_completed'; taskId: string; success: boolean; latency: number }
  | { type: 'metrics_changed'; dimension: CapabilityDimension }
  | { type: 'periodic_decay' }
  | { type: 'peer_discovered'; peerId: string }
  | { type: 'peer_disconnected'; peerId: string };

// ============================================================================
// 负载信息
// ============================================================================

/**
 * 节点负载信息
 */
export interface LoadInfo {
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

// ============================================================================
// 比较优势
// ============================================================================

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