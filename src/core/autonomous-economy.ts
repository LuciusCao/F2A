/**
 * F2A 自治经济系统
 * Phase 4: 信誉消耗、评审激励、优先级调度
 */

import { Logger } from '../utils/logger';
import { ReputationManager } from './reputation';
import { ReviewCommittee, ReviewResult } from './review-committee';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 任务请求
 */
export interface TaskRequest {
  taskId: string;
  requesterId: string;
  capability: string;
  description: string;
  parameters?: Record<string, unknown>;
  timeout?: number;
  estimatedComplexity?: number;
}

/**
 * 任务成本估算
 */
export interface TaskCost {
  baseCost: number;
  discount: number;
  finalCost: number;
  priority: number;
}

/**
 * 任务奖励
 */
export interface TaskReward {
  executorReward: number;
  reviewerReward: number;
  requesterRefund: number;
}

/**
 * 经济配置
 */
export interface EconomyConfig {
  /** 基础任务成本 */
  baseTaskCost: number;
  /** 复杂度系数 */
  complexityMultiplier: number;
  /** 执行者奖励比例 */
  executorRewardRate: number;
  /** 评审者奖励比例 */
  reviewerRewardRate: number;
  /** 任务超时惩罚 */
  timeoutPenalty: number;
  /** 拒绝任务惩罚 */
  rejectionPenalty: number;
}

/**
 * 优先级队列项
 */
export interface PriorityQueueItem {
  task: TaskRequest;
  priority: number;
  cost: number;
  deducted: boolean;
  timestamp: number;
}

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  taskId: string;
  executorId: string;
  status: 'success' | 'failure' | 'timeout' | 'rejected';
  result?: unknown;
  error?: string;
  reviewResult?: ReviewResult;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  baseTaskCost: 5,
  complexityMultiplier: 0.1,
  executorRewardRate: 0.5,
  reviewerRewardRate: 0.2,
  timeoutPenalty: 15,
  rejectionPenalty: 5,
};

// ============================================================================
// 自治经济管理器
// ============================================================================

export class AutonomousEconomy {
  private config: EconomyConfig;
  private reputationManager: ReputationManager;
  private reviewCommittee: ReviewCommittee;
  private taskQueue: PriorityQueueItem[] = [];
  private pendingTasks: Map<string, PriorityQueueItem> = new Map();
  private logger: Logger;

  constructor(
    reputationManager: ReputationManager,
    reviewCommittee: ReviewCommittee,
    config: Partial<EconomyConfig> = {}
  ) {
    this.config = { ...DEFAULT_ECONOMY_CONFIG, ...config };
    this.reputationManager = reputationManager;
    this.reviewCommittee = reviewCommittee;
    this.logger = new Logger({ component: 'AutonomousEconomy' });
  }

  /**
   * 提交任务（消耗信誉）
   */
  submitTask(task: TaskRequest): { success: boolean; cost?: TaskCost; error?: string } {
    // 检查发布权限
    if (!this.reputationManager.hasPermission(task.requesterId, 'publish')) {
      return { success: false, error: 'No permission to publish tasks' };
    }

    // 计算成本
    const cost = this.calculateTaskCost(task);

    // 检查信誉是否足够
    const reputation = this.reputationManager.getReputation(task.requesterId);
    if (reputation.score < cost.finalCost) {
      return {
        success: false,
        error: `Insufficient reputation: ${reputation.score.toFixed(1)} < ${cost.finalCost.toFixed(1)}`,
      };
    }

    // 预扣信誉
    this.reputationManager.recordFailure(
      task.requesterId,
      `task-submit-${task.taskId}`,
      'Task submission cost',
      -cost.finalCost
    );

    // 加入优先级队列
    const queueItem: PriorityQueueItem = {
      task,
      priority: cost.priority,
      cost: cost.finalCost,
      deducted: true,
      timestamp: Date.now(),
    };

    this.taskQueue.push(queueItem);
    this.taskQueue.sort((a, b) => b.priority - a.priority);
    this.pendingTasks.set(task.taskId, queueItem);

    this.logger.info('Task submitted', {
      taskId: task.taskId,
      requesterId: task.requesterId.slice(0, 16),
      cost: cost.finalCost,
      priority: cost.priority,
    });

    return { success: true, cost };
  }

  /**
   * 计算任务成本
   */
  calculateTaskCost(task: TaskRequest): TaskCost {
    const complexity = task.estimatedComplexity || 1;
    const baseCost = this.config.baseTaskCost * complexity;

    // 获取折扣
    const discount = this.reputationManager.getPublishDiscount(task.requesterId);
    const finalCost = Math.floor(baseCost * discount);

    // 获取优先级
    const priority = this.reputationManager.getPublishPriority(task.requesterId);

    return {
      baseCost,
      discount,
      finalCost,
      priority,
    };
  }

  /**
   * 分配任务给执行者
   */
  assignTask(taskId: string, executorId: string): boolean {
    const queueItem = this.pendingTasks.get(taskId);
    if (!queueItem) return false;

    // 检查执行者权限
    if (!this.reputationManager.hasPermission(executorId, 'execute')) {
      this.logger.warn('Executor lacks permission', { executorId: executorId.slice(0, 16) });
      return false;
    }

    this.logger.info('Task assigned', {
      taskId,
      executorId: executorId.slice(0, 16),
    });

    return true;
  }

  /**
   * 完成任务并结算
   */
  completeTask(result: TaskExecutionResult): TaskReward | null {
    const queueItem = this.pendingTasks.get(result.taskId);
    if (!queueItem) return null;

    const task = queueItem.task;
    let reward: TaskReward = {
      executorReward: 0,
      reviewerReward: 0,
      requesterRefund: 0,
    };

    switch (result.status) {
      case 'success':
        // 任务成功
        if (result.reviewResult) {
          reward = this.calculateRewardFromReview(
            task,
            result.executorId,
            result.reviewResult
          );
        } else {
          // 无评审结果，使用默认奖励
          reward.executorReward = queueItem.cost * this.config.executorRewardRate;
        }

        // 奖励执行者
        this.reputationManager.recordSuccess(
          result.executorId,
          result.taskId,
          reward.executorReward
        );

        // 部分返还请求者
        if (reward.requesterRefund > 0) {
          this.reputationManager.recordSuccess(
            task.requesterId,
            `refund-${result.taskId}`,
            reward.requesterRefund
          );
        }

        this.logger.info('Task completed successfully', {
          taskId: result.taskId,
          executorReward: reward.executorReward,
          requesterRefund: reward.requesterRefund,
        });
        break;

      case 'failure':
        // 任务失败
        this.reputationManager.recordFailure(
          result.executorId,
          result.taskId,
          result.error || 'Task failed'
        );
        this.logger.warn('Task failed', { taskId: result.taskId, error: result.error });
        break;

      case 'timeout':
        // 任务超时
        this.reputationManager.recordFailure(
          result.executorId,
          result.taskId,
          'Task timeout',
          -this.config.timeoutPenalty
        );
        this.logger.warn('Task timeout', { taskId: result.taskId });
        break;

      case 'rejected':
        // 任务被拒绝
        this.reputationManager.recordRejection(
          result.executorId,
          result.taskId,
          result.error || 'Task rejected'
        );
        break;
    }

    // 清理
    this.pendingTasks.delete(result.taskId);
    this.taskQueue = this.taskQueue.filter(item => item.task.taskId !== result.taskId);

    return reward;
  }

  /**
   * 从评审结果计算奖励
   */
  calculateRewardFromReview(
    task: TaskRequest,
    executorId: string,
    reviewResult: ReviewResult
  ): TaskReward {
    const { finalWorkload, finalValue } = reviewResult;
    
    // 执行者奖励 = 工作量 × 价值系数
    const valueFactor = (finalValue + 100) / 200; // 归一化到 0-1
    const executorReward = finalWorkload * valueFactor * this.config.executorRewardRate;

    // 评审者奖励（在 ReviewCommittee 中已处理）
    const reviewerReward = reviewResult.reviews.length * 3;

    // 请求者返还
    let requesterRefund = 0;
    if (finalValue > 0) {
      // 正价值任务，部分返还
      requesterRefund = finalWorkload * 0.1;
    }

    return {
      executorReward,
      reviewerReward,
      requesterRefund,
    };
  }

  /**
   * 获取下一个待处理任务
   */
  getNextTask(): PriorityQueueItem | null {
    return this.taskQueue.length > 0 ? this.taskQueue[0] : null;
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * 获取待处理任务
   */
  getPendingTask(taskId: string): PriorityQueueItem | null {
    return this.pendingTasks.get(taskId) || null;
  }

  /**
   * 取消任务（返还部分信誉）
   */
  cancelTask(taskId: string): boolean {
    const queueItem = this.pendingTasks.get(taskId);
    if (!queueItem) return false;

    // 返还部分信誉
    const refund = queueItem.cost * 0.5;
    this.reputationManager.recordSuccess(
      queueItem.task.requesterId,
      `cancel-${taskId}`,
      refund
    );

    // 清理
    this.pendingTasks.delete(taskId);
    this.taskQueue = this.taskQueue.filter(item => item.task.taskId !== taskId);

    this.logger.info('Task cancelled', {
      taskId,
      refund,
    });

    return true;
  }

  /**
   * 获取经济统计
   */
  getEconomyStats(): {
    pendingTasks: number;
    queueLength: number;
    totalCostDeducted: number;
  } {
    const totalCostDeducted = Array.from(this.pendingTasks.values())
      .filter(item => item.deducted)
      .reduce((sum, item) => sum + item.cost, 0);

    return {
      pendingTasks: this.pendingTasks.size,
      queueLength: this.taskQueue.length,
      totalCostDeducted,
    };
  }

  /**
   * 清理过期任务
   */
  cleanupExpiredTasks(maxAge: number = 24 * 60 * 60 * 1000): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [taskId, item] of this.pendingTasks) {
      if (now - item.timestamp > maxAge) {
        expired.push(taskId);
        this.cancelTask(taskId);
      }
    }

    if (expired.length > 0) {
      this.logger.info('Cleaned up expired tasks', { count: expired.length });
    }

    return expired;
  }
}

// 默认导出
export default AutonomousEconomy;