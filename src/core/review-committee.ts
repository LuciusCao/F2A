/**
 * F2A 评审系统
 * Phase 2: 评审机制
 */

import { Logger } from '../utils/logger.js';
import { ReputationManager } from './reputation.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 评审维度
 */
export interface ReviewDimensions {
  /** 工作量评估 (0-100) */
  workload: number;
  /** 价值分 (-100 ~ 100) */
  value: number;
}

/**
 * 风险标记
 */
export type RiskFlag = 'dangerous' | 'malicious' | 'spam' | 'invalid';

/**
 * 任务评审
 */
export interface TaskReview {
  taskId: string;
  reviewerId: string;
  dimensions: ReviewDimensions;
  riskFlags?: RiskFlag[];
  comment?: string;
  timestamp: number;
}

/**
 * 评审结果
 */
export interface ReviewResult {
  taskId: string;
  requesterId: string;
  executorId?: string;
  finalWorkload: number;
  finalValue: number;
  reviews: TaskReview[];
  outliers: TaskReview[];
  timestamp: number;
}

/**
 * 评审委员会配置
 */
export interface ReviewCommitteeConfig {
  /** 最小评审人数 */
  minReviewers: number;
  /** 最大评审人数 */
  maxReviewers: number;
  /** 评审资格最低信誉分 */
  minReputation: number;
  /** 评审超时（毫秒） */
  reviewTimeout: number;
  /** 偏离检测阈值（标准差倍数） */
  outlierThreshold: number;
}

/**
 * 待评审任务
 */
export interface PendingReview {
  taskId: string;
  requesterId: string;
  executorId?: string;
  taskDescription: string;
  taskParameters?: Record<string, unknown>;
  createdAt: number;
  reviews: TaskReview[];
  requiredReviewers: number;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_COMMITTEE_CONFIG: ReviewCommitteeConfig = {
  minReviewers: 1,
  maxReviewers: 7,
  minReputation: 50,
  reviewTimeout: 5 * 60 * 1000, // 5 分钟
  outlierThreshold: 2, // 2 个标准差
};

// ============================================================================
// 评审委员会
// ============================================================================

export class ReviewCommittee {
  private config: ReviewCommitteeConfig;
  private reputationManager: ReputationManager;
  private pendingReviews: Map<string, PendingReview> = new Map();
  private logger: Logger;

  constructor(
    reputationManager: ReputationManager,
    config: Partial<ReviewCommitteeConfig> = {}
  ) {
    this.reputationManager = reputationManager;
    this.config = { ...DEFAULT_COMMITTEE_CONFIG, ...config };
    this.logger = new Logger({ component: 'ReviewCommittee' });
  }

  /**
   * 根据网络规模计算需要的评审人数
   */
  getRequiredReviewers(networkSize: number): number {
    if (networkSize < 10) return 1;
    if (networkSize < 50) return 3;
    return 5;
  }

  /**
   * 获取可用的评审者
   */
  getAvailableReviewers(excludeIds: string[] = []): string[] {
    const highRepNodes = this.reputationManager.getHighReputationNodes(
      this.config.minReputation
    );
    
    return highRepNodes
      .map(e => e.peerId)
      .filter(id => !excludeIds.includes(id));
  }

  /**
   * 提交任务进行评审
   */
  submitForReview(
    taskId: string,
    requesterId: string,
    taskDescription: string,
    taskParameters?: Record<string, unknown>,
    executorId?: string
  ): PendingReview {
    const networkSize = this.reputationManager.getAllReputations().length;
    const requiredReviewers = Math.min(
      this.config.maxReviewers,
      Math.max(this.config.minReviewers, this.getRequiredReviewers(networkSize))
    );

    const pending: PendingReview = {
      taskId,
      requesterId,
      executorId,
      taskDescription,
      taskParameters,
      createdAt: Date.now(),
      reviews: [],
      requiredReviewers,
    };

    this.pendingReviews.set(taskId, pending);
    
    this.logger.info('Task submitted for review', {
      taskId,
      requesterId: requesterId.slice(0, 16),
      requiredReviewers,
    });

    return pending;
  }

  /**
   * 提交评审
   */
  submitReview(review: TaskReview): { success: boolean; message: string } {
    const pending = this.pendingReviews.get(review.taskId);
    
    if (!pending) {
      return { success: false, message: 'Task not found or already completed' };
    }

    // 验证评审者资格
    if (!this.reputationManager.hasPermission(review.reviewerId, 'review')) {
      return { success: false, message: 'Reviewer does not have permission' };
    }

    // 验证评审者不是请求者或执行者
    if (review.reviewerId === pending.requesterId || 
        review.reviewerId === pending.executorId) {
      return { success: false, message: 'Cannot review own task' };
    }

    // 检查是否已经评审过
    if (pending.reviews.some(r => r.reviewerId === review.reviewerId)) {
      return { success: false, message: 'Already reviewed this task' };
    }

    // 验证评审维度
    if (!this.validateReviewDimensions(review.dimensions)) {
      return { success: false, message: 'Invalid review dimensions' };
    }

    pending.reviews.push(review);
    
    this.logger.info('Review submitted', {
      taskId: review.taskId,
      reviewerId: review.reviewerId.slice(0, 16),
      workload: review.dimensions.workload,
      value: review.dimensions.value,
    });

    return { success: true, message: 'Review submitted' };
  }

  /**
   * 检查评审是否完成
   */
  isReviewComplete(taskId: string): boolean {
    const pending = this.pendingReviews.get(taskId);
    if (!pending) return false;
    return pending.reviews.length >= pending.requiredReviewers;
  }

  /**
   * 结算评审
   */
  finalizeReview(taskId: string): ReviewResult | null {
    const pending = this.pendingReviews.get(taskId);
    if (!pending) return null;

    if (pending.reviews.length < pending.requiredReviewers) {
      this.logger.warn('Not enough reviews', {
        taskId,
        current: pending.reviews.length,
        required: pending.requiredReviewers,
      });
      return null;
    }

    const { finalWorkload, finalValue, outliers } = this.aggregateReviews(
      pending.reviews
    );

    const result: ReviewResult = {
      taskId,
      requesterId: pending.requesterId,
      executorId: pending.executorId,
      finalWorkload,
      finalValue,
      reviews: pending.reviews,
      outliers,
      timestamp: Date.now(),
    };

    // 移除待评审任务
    this.pendingReviews.delete(taskId);

    // 更新评审者信誉
    this.updateReviewerReputations(pending.reviews, outliers);

    this.logger.info('Review finalized', {
      taskId,
      finalWorkload,
      finalValue,
      outliers: outliers.length,
    });

    return result;
  }

  /**
   * 聚合评审结果
   */
  aggregateReviews(reviews: TaskReview[]): {
    finalWorkload: number;
    finalValue: number;
    outliers: TaskReview[];
  } {
    if (reviews.length === 0) {
      return { finalWorkload: 0, finalValue: 0, outliers: [] };
    }
    
    if (reviews.length === 1) {
      return {
        finalWorkload: reviews[0].dimensions.workload,
        finalValue: reviews[0].dimensions.value,
        outliers: [],
      };
    }

    // P1-1 修复：当 reviews.length === 2 时，slice(1, -1) 返回空数组
    // 修复：2个或更少评审时直接取平均值，不进行修剪
    if (reviews.length === 2) {
      const workloads = reviews.map(r => r.dimensions.workload);
      const values = reviews.map(r => r.dimensions.value);
      
      const avgWorkload = this.average(workloads);
      const avgValue = this.average(values);
      const stdDevWorkload = this.stdDev(workloads, avgWorkload);
      const stdDevValue = this.stdDev(values, avgValue);
      
      // 识别偏离者
      const outliers = reviews.filter(r => 
        Math.abs(r.dimensions.workload - avgWorkload) > this.config.outlierThreshold * stdDevWorkload ||
        Math.abs(r.dimensions.value - avgValue) > this.config.outlierThreshold * stdDevValue
      );
      
      return { finalWorkload: avgWorkload, finalValue: avgValue, outliers };
    }

    // 计算平均值和标准差
    const workloads = reviews.map(r => r.dimensions.workload);
    const values = reviews.map(r => r.dimensions.value);

    const avgWorkload = this.average(workloads);
    const avgValue = this.average(values);
    const stdDevWorkload = this.stdDev(workloads, avgWorkload);
    const stdDevValue = this.stdDev(values, avgValue);

    // 去掉最高和最低
    const sortedWorkloads = [...workloads].sort((a, b) => a - b);
    const sortedValues = [...values].sort((a, b) => a - b);

    const trimmedWorkloads = sortedWorkloads.slice(1, -1);
    const trimmedValues = sortedValues.slice(1, -1);

    const finalWorkload = this.average(trimmedWorkloads);
    const finalValue = this.average(trimmedValues);

    // 识别偏离者
    const outliers = reviews.filter(r => 
      Math.abs(r.dimensions.workload - avgWorkload) > this.config.outlierThreshold * stdDevWorkload ||
      Math.abs(r.dimensions.value - avgValue) > this.config.outlierThreshold * stdDevValue
    );

    return { finalWorkload, finalValue, outliers };
  }

  /**
   * 获取待评审任务列表
   */
  getPendingReviews(): PendingReview[] {
    return Array.from(this.pendingReviews.values());
  }

  /**
   * 获取特定任务的评审状态
   */
  getReviewStatus(taskId: string): PendingReview | null {
    return this.pendingReviews.get(taskId) || null;
  }

  /**
   * 清理超时的待评审任务
   */
  cleanupExpiredReviews(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [taskId, pending] of this.pendingReviews) {
      if (now - pending.createdAt > this.config.reviewTimeout) {
        expired.push(taskId);
        this.pendingReviews.delete(taskId);
      }
    }

    if (expired.length > 0) {
      this.logger.info('Cleaned up expired reviews', { count: expired.length });
    }

    return expired;
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private validateReviewDimensions(dimensions: ReviewDimensions): boolean {
    const { workload, value } = dimensions;
    
    // 工作量范围检查
    if (workload < 0 || workload > 100) return false;
    
    // 价值分范围检查
    if (value < -100 || value > 100) return false;
    
    return true;
  }

  private updateReviewerReputations(
    reviews: TaskReview[],
    outliers: TaskReview[]
  ): void {
    for (const review of reviews) {
      if (outliers.includes(review)) {
        // 偏离评审 → 惩罚
        this.reputationManager.recordReviewPenalty(
          review.reviewerId,
          -5,
          'Outlier review'
        );
      } else {
        // 正常评审 → 奖励
        this.reputationManager.recordReviewReward(review.reviewerId, 3);
      }
    }
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private stdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(this.average(squaredDiffs));
  }
}

// 默认导出
export default ReviewCommittee;