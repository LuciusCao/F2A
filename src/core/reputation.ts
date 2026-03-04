/**
 * F2A 信誉系统
 * Phase 1: 基础信誉管理
 */

import { Logger } from '../utils/logger';

// ============================================================================
// 类型定义
// ============================================================================

export type ReputationLevel = 'restricted' | 'novice' | 'participant' | 'contributor' | 'core';

export interface ReputationTier {
  min: number;
  max: number;
  level: ReputationLevel;
  title: string;
  permissions: {
    canPublish: boolean;
    canExecute: boolean;
    canReview: boolean;
    publishPriority: number;
    publishDiscount: number;
  };
}

export interface ReputationEntry {
  peerId: string;
  score: number;
  level: ReputationLevel;
  lastUpdated: number;
  history: ReputationEvent[];
}

export interface ReputationEvent {
  type: 'task_success' | 'task_failure' | 'task_rejected' | 'review_given' | 'review_penalty' | 'initial';
  delta: number;
  timestamp: number;
  reason?: string;
  taskId?: string;
}

export interface ReputationConfig {
  initialScore: number;
  alpha: number;  // EWMA 平滑系数
  minScore: number;
  maxScore: number;
  maxHistory: number;  // 历史记录上限
}

// ============================================================================
// 持久化接口
// ============================================================================

export interface ReputationStorage {
  save(entries: Map<string, ReputationEntry>): Promise<void>;
  load(): Promise<Map<string, ReputationEntry>>;
}

// ============================================================================
// 信誉等级定义
// ============================================================================

export const REPUTATION_TIERS: ReputationTier[] = [
  {
    min: 0,
    max: 20,
    level: 'restricted',
    title: '受限者',
    permissions: {
      canPublish: false,
      canExecute: true,
      canReview: false,
      publishPriority: 0,
      publishDiscount: 1.0,
    },
  },
  {
    min: 20,
    max: 40,
    level: 'novice',
    title: '新手',
    permissions: {
      canPublish: true,
      canExecute: true,
      canReview: false,
      publishPriority: 1,
      publishDiscount: 1.0,
    },
  },
  {
    min: 40,
    max: 60,
    level: 'participant',
    title: '参与者',
    permissions: {
      canPublish: true,
      canExecute: true,
      canReview: true,
      publishPriority: 2,
      publishDiscount: 1.0,
    },
  },
  {
    min: 60,
    max: 80,
    level: 'contributor',
    title: '贡献者',
    permissions: {
      canPublish: true,
      canExecute: true,
      canReview: true,
      publishPriority: 3,
      publishDiscount: 0.9,
    },
  },
  {
    min: 80,
    max: 100,
    level: 'core',
    title: '核心成员',
    permissions: {
      canPublish: true,
      canExecute: true,
      canReview: true,
      publishPriority: 5,
      publishDiscount: 0.7,
    },
  },
];

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: ReputationConfig = {
  initialScore: 70,
  alpha: 0.3,
  minScore: 0,
  maxScore: 100,
  maxHistory: 100,
};

// ============================================================================
// 信誉管理器
// ============================================================================

export class ReputationManager {
  private config: ReputationConfig;
  private entries: Map<string, ReputationEntry> = new Map();
  private logger: Logger;

  constructor(config: Partial<ReputationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new Logger({ component: 'Reputation' });
  }

  /**
   * 获取节点信誉
   */
  getReputation(peerId: string): ReputationEntry {
    if (!this.entries.has(peerId)) {
      this.entries.set(peerId, this.createInitialEntry(peerId));
    }
    return this.entries.get(peerId)!;
  }

  /**
   * 获取信誉等级
   */
  getTier(score: number): ReputationTier {
    for (const tier of REPUTATION_TIERS) {
      if (score >= tier.min && score < tier.max) {
        return tier;
      }
    }
    return REPUTATION_TIERS[REPUTATION_TIERS.length - 1]; // core
  }

  /**
   * 检查权限
   */
  hasPermission(peerId: string, permission: 'publish' | 'execute' | 'review'): boolean {
    const entry = this.getReputation(peerId);
    const tier = this.getTier(entry.score);

    switch (permission) {
      case 'publish':
        return tier.permissions.canPublish;
      case 'execute':
        return tier.permissions.canExecute;
      case 'review':
        return tier.permissions.canReview;
    }
  }

  /**
   * 记录任务成功
   */
  recordSuccess(peerId: string, taskId: string, delta: number = 10): void {
    const entry = this.getReputation(peerId);
    const newScore = this.updateScoreEWMA(entry.score, delta);

    entry.score = newScore;
    entry.level = this.getTier(newScore).level;
    entry.lastUpdated = Date.now();
    entry.history.push({
      type: 'task_success',
      delta,
      timestamp: Date.now(),
      taskId,
    });

    this.logger.info('Reputation updated', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
      level: entry.level,
    });
  }

  /**
   * 记录任务失败
   */
  recordFailure(peerId: string, taskId: string, reason?: string, delta: number = -20): void {
    const entry = this.getReputation(peerId);
    const newScore = this.updateScoreEWMA(entry.score, delta);

    entry.score = newScore;
    entry.level = this.getTier(newScore).level;
    entry.lastUpdated = Date.now();
    entry.history.push({
      type: 'task_failure',
      delta,
      timestamp: Date.now(),
      reason,
      taskId,
    });

    this.logger.warn('Reputation decreased', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
      level: entry.level,
      reason,
    });
  }

  /**
   * 记录任务拒绝
   */
  recordRejection(peerId: string, taskId: string, reason?: string, delta: number = -5): void {
    const entry = this.getReputation(peerId);
    const newScore = this.updateScoreEWMA(entry.score, delta);

    entry.score = newScore;
    entry.level = this.getTier(newScore).level;
    entry.lastUpdated = Date.now();
    entry.history.push({
      type: 'task_rejected',
      delta,
      timestamp: Date.now(),
      reason,
      taskId,
    });

    this.logger.info('Reputation updated (rejection)', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
    });
  }

  /**
   * 记录评审奖励
   */
  recordReviewReward(peerId: string, delta: number = 3): void {
    const entry = this.getReputation(peerId);
    const newScore = this.updateScoreEWMA(entry.score, delta);

    entry.score = newScore;
    entry.level = this.getTier(newScore).level;
    entry.lastUpdated = Date.now();
    entry.history.push({
      type: 'review_given',
      delta,
      timestamp: Date.now(),
    });

    this.logger.info('Review reward', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
    });
  }

  /**
   * 记录评审惩罚
   */
  recordReviewPenalty(peerId: string, delta: number = -5, reason?: string): void {
    const entry = this.getReputation(peerId);
    const newScore = this.updateScoreEWMA(entry.score, delta);

    entry.score = newScore;
    entry.level = this.getTier(newScore).level;
    entry.lastUpdated = Date.now();
    entry.history.push({
      type: 'review_penalty',
      delta,
      timestamp: Date.now(),
      reason,
    });

    this.logger.warn('Review penalty', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
      reason,
    });
  }

  /**
   * 获取所有信誉条目（按分数排序）
   */
  getAllReputations(): ReputationEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * 获取高信誉节点（可用于评审）
   */
  getHighReputationNodes(minScore: number = 50): ReputationEntry[] {
    return this.getAllReputations().filter(e => e.score >= minScore);
  }

  /**
   * 计算发布优先级
   */
  getPublishPriority(peerId: string): number {
    const entry = this.getReputation(peerId);
    return this.getTier(entry.score).permissions.publishPriority;
  }

  /**
   * 计算发布折扣
   */
  getPublishDiscount(peerId: string): number {
    const entry = this.getReputation(peerId);
    return this.getTier(entry.score).permissions.publishDiscount;
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 创建初始信誉条目
   */
  private createInitialEntry(peerId: string): ReputationEntry {
    return {
      peerId,
      score: this.config.initialScore,
      level: this.getTier(this.config.initialScore).level,
      lastUpdated: Date.now(),
      history: [
        {
          type: 'initial',
          delta: 0,
          timestamp: Date.now(),
        },
      ],
    };
  }

  /**
   * EWMA 分数更新
   * newScore = α * observation + (1 - α) * currentScore
   */
  private updateScoreEWMA(currentScore: number, delta: number): number {
    const observation = currentScore + delta;
    const newScore = this.config.alpha * observation + (1 - this.config.alpha) * currentScore;
    return Math.max(this.config.minScore, Math.min(this.config.maxScore, newScore));
  }
}

// 默认导出
export default ReputationManager;