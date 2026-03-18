/**
 * F2A 能力管理器
 * Phase 2: 能力量化模型
 * 
 * 负责能力评估的动态更新和管理
 */

import { EventEmitter } from 'eventemitter3';
import type {
  AgentCapabilityQuant,
  CapabilityMetrics,
  CapabilityScore,
  CapabilityVector,
  CapabilityDimension,
  CapabilityUpdateEvent,
  CapabilityWeights,
  UpdateStrategy,
  LoadInfo,
  ComputationMetrics,
  StorageMetrics,
  NetworkMetrics,
  SkillTag,
  ReputationMetrics,
} from '../types/capability-quant.js';
import type { AgentCapability } from '../types/index.js';

import { DEFAULT_CAPABILITY_WEIGHTS, DEFAULT_UPDATE_STRATEGY } from '../types/capability-quant.js';

import {
  scoreComputation,
  scoreStorage,
  scoreNetwork,
  scoreSkills,
  scoreReputation,
  calculateOverallScore,
  generateCapabilityVector,
  calculateCapabilityScore,
  applyDecay,
  decaySkillProficiency,
} from '../utils/capability-scorer.js';

import type { Result } from '../types/result.js';
import { success, failure, createError } from '../types/result.js';

// ============================================================================
// 事件定义
// ============================================================================

export interface CapabilityManagerEvents {
  'capability:updated': (quant: AgentCapabilityQuant) => void;
  'capability:decayed': (quant: AgentCapabilityQuant) => void;
  'capability:broadcast': (quant: AgentCapabilityQuant) => void;
  'error': (error: Error) => void;
}

// ============================================================================
// 能力管理器配置
// ============================================================================

export interface CapabilityManagerConfig {
  /** 本地 PeerID */
  peerId: string;
  /** 基础能力列表 */
  baseCapabilities: AgentCapability[];
  /** 权重配置 */
  weights?: CapabilityWeights;
  /** 更新策略 */
  strategy?: UpdateStrategy;
  /** 广播函数 */
  broadcastFn?: (quant: AgentCapabilityQuant) => Promise<void>;
}

// ============================================================================
// 系统指标收集器接口
// ============================================================================

export interface SystemMetricsCollector {
  collectComputationMetrics(): Promise<ComputationMetrics>;
  collectStorageMetrics(): Promise<StorageMetrics>;
  collectNetworkMetrics(): Promise<NetworkMetrics>;
}

// ============================================================================
// 能力管理器
// ============================================================================

/**
 * 能力管理器
 * 
 * 负责管理本地和远程 Agent 的能力评估
 */
export class CapabilityManager extends EventEmitter<CapabilityManagerEvents> {
  private peerId: string;
  private baseCapabilities: AgentCapability[];
  private weights: CapabilityWeights;
  private strategy: UpdateStrategy;
  private broadcastFn?: (quant: AgentCapabilityQuant) => Promise<void>;
  
  // 本地能力评估
  private localQuant: AgentCapabilityQuant | null = null;
  
  // 远程能力评估缓存
  private peerQuants: Map<string, AgentCapabilityQuant> = new Map();
  
  // 负载信息缓存
  private peerLoads: Map<string, LoadInfo> = new Map();
  
  // 技能执行统计
  private skillStats: Map<string, { executions: number; successes: number; totalTimeMs: number }> = new Map();
  
  // 定时衰减器
  private decayTimer?: ReturnType<typeof setInterval>;
  
  constructor(config: CapabilityManagerConfig) {
    super();
    this.peerId = config.peerId;
    this.baseCapabilities = config.baseCapabilities;
    this.weights = config.weights ?? DEFAULT_CAPABILITY_WEIGHTS;
    this.strategy = { ...DEFAULT_UPDATE_STRATEGY, ...config.strategy };
    this.broadcastFn = config.broadcastFn;
  }
  
  // ============================================================================
  // 公共方法
  // ============================================================================
  
  /**
   * 启动能力管理器
   */
  start(): void {
    // 启动定时衰减
    if (this.strategy.trigger === 'periodic' && this.strategy.intervalMs) {
      this.decayTimer = setInterval(() => {
        this.applyPeriodicDecay();
      }, this.strategy.intervalMs);
    }
  }
  
  /**
   * 停止能力管理器
   */
  stop(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = undefined;
    }
  }
  
  /**
   * 更新本地能力指标
   */
  async updateMetrics(
    metrics: Partial<CapabilityMetrics>,
    metricsCollector?: SystemMetricsCollector
  ): Promise<Result<AgentCapabilityQuant>> {
    try {
      // 获取当前或收集新指标
      const currentMetrics = this.localQuant?.metrics ?? await this.getDefaultMetrics(metricsCollector);
      
      // 合并新指标
      const newMetrics: CapabilityMetrics = {
        computation: metrics.computation ?? currentMetrics.computation,
        storage: metrics.storage ?? currentMetrics.storage,
        network: metrics.network ?? currentMetrics.network,
        skills: metrics.skills ?? currentMetrics.skills,
        reputation: metrics.reputation ?? currentMetrics.reputation,
      };
      
      // 计算评分
      const scores = calculateCapabilityScore(newMetrics, this.weights);
      
      // 创建新的能力评估
      const newQuant: AgentCapabilityQuant = {
        peerId: this.peerId,
        baseCapabilities: this.baseCapabilities,
        scores,
        metrics: newMetrics,
        lastUpdated: Date.now(),
        version: (this.localQuant?.version ?? 0) + 1,
      };
      
      this.localQuant = newQuant;
      
      // 触发事件
      this.emit('capability:updated', newQuant);
      
      return success(newQuant);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      return failure(createError('INTERNAL_ERROR', 'Failed to update metrics', { cause: err }));
    }
  }
  
  /**
   * 获取本地能力评分
   */
  getCapabilityScore(): CapabilityScore | null {
    return this.localQuant?.scores ?? null;
  }
  
  /**
   * 获取能力向量
   */
  getCapabilityVector(): CapabilityVector | null {
    return this.localQuant?.scores.capabilityVector ?? null;
  }
  
  /**
   * 获取完整能力评估
   */
  getLocalQuant(): AgentCapabilityQuant | null {
    return this.localQuant;
  }
  
  /**
   * 广播能力更新到网络
   */
  async broadcastCapability(): Promise<Result<void>> {
    if (!this.localQuant) {
      return failure(createError('INTERNAL_ERROR', 'No local capability to broadcast'));
    }
    
    try {
      if (this.broadcastFn) {
        await this.broadcastFn(this.localQuant);
      }
      this.emit('capability:broadcast', this.localQuant);
      return success(undefined);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      return failure(createError('INTERNAL_ERROR', 'Failed to broadcast capability', { cause: err }));
    }
  }
  
  /**
   * 应用能力衰减
   */
  decayScores(daysPassed: number = 1): Result<AgentCapabilityQuant> {
    if (!this.localQuant) {
      return failure(createError('INTERNAL_ERROR', 'No local capability to decay'));
    }
    
    const decayRate = this.strategy.decayRate;
    
    // 衰减技能熟练度
    const decayedSkills = this.localQuant.metrics.skills.map(skill => ({
      ...skill,
      proficiency: decaySkillProficiency(skill.proficiency, decayRate, daysPassed),
    }));
    
    // 重新计算技能评分
    const newSkillScore = scoreSkills(decayedSkills);
    
    // 更新维度评分
    const newDimensionScores = {
      ...this.localQuant.scores.dimensionScores,
      skill: newSkillScore,
    };
    
    // 重新计算综合评分
    const newOverallScore = calculateOverallScore(newDimensionScores, this.weights);
    
    // 创建新的能力评估
    const newQuant: AgentCapabilityQuant = {
      ...this.localQuant,
      metrics: {
        ...this.localQuant.metrics,
        skills: decayedSkills,
      },
      scores: {
        dimensionScores: newDimensionScores,
        overallScore: newOverallScore,
        capabilityVector: this.localQuant.scores.capabilityVector,
      },
      lastUpdated: Date.now(),
      version: this.localQuant.version + 1,
    };
    
    this.localQuant = newQuant;
    this.emit('capability:decayed', newQuant);
    
    return success(newQuant);
  }
  
  // ============================================================================
  // 远程能力管理
  // ============================================================================
  
  /**
   * 更新远程节点能力评估
   */
  updatePeerCapability(quant: AgentCapabilityQuant): void {
    const existing = this.peerQuants.get(quant.peerId);
    
    // 版本检查：只接受更新版本
    if (existing && existing.version >= quant.version) {
      return;
    }
    
    this.peerQuants.set(quant.peerId, quant);
  }
  
  /**
   * 获取远程节点能力评估
   */
  getPeerCapability(peerId: string): AgentCapabilityQuant | null {
    return this.peerQuants.get(peerId) ?? null;
  }
  
  /**
   * 移除远程节点能力评估
   */
  removePeerCapability(peerId: string): void {
    this.peerQuants.delete(peerId);
    this.peerLoads.delete(peerId);
  }
  
  /**
   * 获取所有已知节点的能力评估
   */
  getAllPeerCapabilities(): AgentCapabilityQuant[] {
    return Array.from(this.peerQuants.values());
  }
  
  /**
   * 按能力排名获取节点列表
   */
  getRankings(dimension?: CapabilityDimension): AgentCapabilityQuant[] {
    const all = this.getAllPeerCapabilities();
    
    if (dimension) {
      return all.sort((a, b) => 
        b.scores.dimensionScores[dimension] - a.scores.dimensionScores[dimension]
      );
    }
    
    return all.sort((a, b) => b.scores.overallScore - a.scores.overallScore);
  }
  
  // ============================================================================
  // 负载管理
  // ============================================================================
  
  /**
   * 更新节点负载信息
   */
  updatePeerLoad(loadInfo: LoadInfo): void {
    this.peerLoads.set(loadInfo.peerId, {
      ...loadInfo,
      lastUpdated: Date.now(),
    });
  }
  
  /**
   * 获取节点负载信息
   */
  getPeerLoad(peerId: string): LoadInfo | null {
    return this.peerLoads.get(peerId) ?? null;
  }
  
  /**
   * 计算负载因子
   * 
   * 用于调整比较优势评分
   * 低负载=1.0, 高负载=0.5
   */
  calculateLoadFactor(peerId: string): number {
    const load = this.peerLoads.get(peerId);
    
    if (!load) {
      return 1.0; // 未知节点，不惩罚
    }
    
    // 综合负载率
    const combinedLoad = 
      (load.activeTasks / 10) * 0.4 +  // 假设最大 10 个并发
      (load.queueLength / 20) * 0.3 +   // 假设最大 20 个排队
      load.cpuUsage * 0.2 +
      load.memoryUsage * 0.1;
    
    if (combinedLoad < 0.5) return 1.0;
    if (combinedLoad < 0.7) return 0.8;
    if (combinedLoad < 0.9) return 0.6;
    return 0.5;
  }
  
  /**
   * 检测节点是否过载
   */
  isOverloaded(peerId: string): boolean {
    const load = this.peerLoads.get(peerId);
    
    if (!load) return false;
    
    return load.cpuUsage > 0.9 || 
           load.memoryUsage > 0.9 || 
           load.queueLength > 50;
  }
  
  // ============================================================================
  // 技能统计
  // ============================================================================
  
  /**
   * 记录技能执行
   */
  recordSkillExecution(
    skillName: string,
    success: boolean,
    executionTimeMs: number
  ): void {
    const stats = this.skillStats.get(skillName) ?? {
      executions: 0,
      successes: 0,
      totalTimeMs: 0,
    };
    
    stats.executions += 1;
    if (success) {
      stats.successes += 1;
    }
    stats.totalTimeMs += executionTimeMs;
    
    this.skillStats.set(skillName, stats);
  }
  
  /**
   * 获取技能统计
   */
  getSkillStats(skillName: string): {
    executions: number;
    successRate: number;
    avgExecutionTimeMs: number;
  } | null {
    const stats = this.skillStats.get(skillName);
    
    if (!stats) return null;
    
    return {
      executions: stats.executions,
      successRate: stats.executions > 0 ? stats.successes / stats.executions : 0,
      avgExecutionTimeMs: stats.executions > 0 ? stats.totalTimeMs / stats.executions : 0,
    };
  }
  
  // ============================================================================
  // 事件处理
  // ============================================================================
  
  /**
   * 处理能力更新事件
   */
  handleUpdateEvent(event: CapabilityUpdateEvent): void {
    switch (event.type) {
      case 'task_completed':
        this.handleTaskCompleted(event.taskId, event.success, event.latency);
        break;
      case 'metrics_changed':
        // 触发重新评估
        this.emit('capability:updated', this.localQuant!);
        break;
      case 'periodic_decay':
        this.decayScores(1);
        break;
      case 'peer_discovered':
        // 新节点发现，无需特殊处理
        break;
      case 'peer_disconnected':
        this.removePeerCapability(event.peerId);
        break;
    }
  }
  
  // ============================================================================
  // 私有方法
  // ============================================================================
  
  private async getDefaultMetrics(
    collector?: SystemMetricsCollector
  ): Promise<CapabilityMetrics> {
    if (collector) {
      return {
        computation: await collector.collectComputationMetrics(),
        storage: await collector.collectStorageMetrics(),
        network: await collector.collectNetworkMetrics(),
        skills: [],
        reputation: this.getDefaultReputationMetrics(),
      };
    }
    
    // 返回默认值
    return {
      computation: {
        cpuCores: 1,
        memoryMB: 1024,
        gpuAccelerated: false,
        concurrencyLimit: 1,
      },
      storage: {
        availableGB: 10,
        storageType: 'ssd',
        supportedFormats: [],
      },
      network: {
        bandwidthMbps: 10,
        stability: 0.5,
        directConnect: false,
      },
      skills: [],
      reputation: this.getDefaultReputationMetrics(),
    };
  }
  
  private getDefaultReputationMetrics(): ReputationMetrics {
    return {
      score: 50,
      level: 'novice',
      totalTasks: 0,
      successTasks: 0,
      failureTasks: 0,
      avgResponseTimeMs: 1000,
      nodeAgeDays: 0,
    };
  }
  
  private handleTaskCompleted(
    _taskId: string,
    success: boolean,
    latency: number
  ): void {
    if (!this.localQuant) return;
    
    // 更新信誉指标
    const rep = this.localQuant.metrics.reputation;
    const newRep: ReputationMetrics = {
      ...rep,
      totalTasks: rep.totalTasks + 1,
      successTasks: success ? rep.successTasks + 1 : rep.successTasks,
      failureTasks: success ? rep.failureTasks : rep.failureTasks + 1,
      avgResponseTimeMs: (rep.avgResponseTimeMs * rep.totalTasks + latency) / (rep.totalTasks + 1),
    };
    
    // 重新计算信誉评分
    const newRepScore = scoreReputation(newRep);
    
    // 更新维度评分
    const newDimensionScores = {
      ...this.localQuant.scores.dimensionScores,
      reputation: newRepScore,
    };
    
    // 更新能力评估
    this.localQuant = {
      ...this.localQuant,
      metrics: {
        ...this.localQuant.metrics,
        reputation: newRep,
      },
      scores: {
        dimensionScores: newDimensionScores,
        overallScore: calculateOverallScore(newDimensionScores, this.weights),
        capabilityVector: this.localQuant.scores.capabilityVector,
      },
      lastUpdated: Date.now(),
      version: this.localQuant.version + 1,
    };
    
    this.emit('capability:updated', this.localQuant);
  }
  
  private applyPeriodicDecay(): void {
    if (this.localQuant) {
      this.decayScores(1);
    }
    
    // 对所有远程节点也应用衰减
    for (const [peerId, quant] of this.peerQuants) {
      const decayedSkills = quant.metrics.skills.map(skill => ({
        ...skill,
        proficiency: decaySkillProficiency(skill.proficiency, this.strategy.decayRate, 1),
      }));
      
      const newSkillScore = scoreSkills(decayedSkills);
      const newDimensionScores = {
        ...quant.scores.dimensionScores,
        skill: newSkillScore,
      };
      
      this.peerQuants.set(peerId, {
        ...quant,
        metrics: {
          ...quant.metrics,
          skills: decayedSkills,
        },
        scores: {
          dimensionScores: newDimensionScores,
          overallScore: calculateOverallScore(newDimensionScores, this.weights),
          capabilityVector: quant.scores.capabilityVector,
        },
        lastUpdated: Date.now(),
        version: quant.version + 1,
      });
    }
  }
}