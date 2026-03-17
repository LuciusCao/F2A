/**
 * F2A 信誉系统
 * Phase 1: 基础信誉管理
 */

import { Logger } from '../utils/logger.js';

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
  decayRate: number;   // 衰减率（每日衰减百分比，如 0.01 表示每天衰减 1%）
  decayIntervalMs: number;  // 衰减检查间隔（毫秒）
  maxLatency: number;  // 最大可接受的延迟（毫秒）
}

// ============================================================================
// 持久化接口
// ============================================================================

/**
 * 持久化数据结构
 * P0-1/P1-1 修复：扩展接口支持 lastDecayTime
 */
export interface ReputationPersistedData {
  entries: Record<string, ReputationEntry>;
  lastDecayTime: number;
}

export interface ReputationStorage {
  save(data: ReputationPersistedData): Promise<void>;
  load(): Promise<ReputationPersistedData | null>;
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
  decayRate: 0.01,           // 每天衰减 1%
  decayIntervalMs: 24 * 60 * 60 * 1000,  // 每 24 小时检查一次
  maxLatency: 300000,        // 最大可接受延迟 5 分钟
};

// ============================================================================
// 信誉管理器
// ============================================================================

export class ReputationManager implements Disposable {
  private config: ReputationConfig;
  private entries: Map<string, ReputationEntry> = new Map();
  private logger: Logger;
  private decayTimer?: NodeJS.Timeout;
  private disposed: boolean = false;
  /** P1-7 修复：存储接口 */
  private storage?: ReputationStorage;
  /** P1-7 修复：上次衰减时间，用于持久化 */
  private lastDecayTime: number = 0;
  /** P1-2/P2-1 修复：初始化 Promise，用于等待异步加载完成 */
  private initPromise: Promise<void>;
  /** P2-1 修复：初始化状态标志 */
  private isReadyFlag: boolean = false;
  /** P2-3 修复：保存进行中标志，防止并发保存 */
  private saveInProgress: boolean = false;
  /** P2-1 修复：有待保存的更新标志 */
  private pendingSave: boolean = false;
  /** P2-2 修复：初始化错误状态 */
  private initError: Error | null = null;
  /** P2-1 修复：降级模式警告标志，防止日志泛滥 */
  private degradedWarned: boolean = false;
  /** P2-2 修复：重试计数器和退避策略 */
  private saveRetryCount: number = 0;
  private static readonly MAX_SAVE_RETRIES: number = 3;

  constructor(config: Partial<ReputationConfig> = {}, storage?: ReputationStorage) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new Logger({ component: 'Reputation' });
    this.storage = storage;
    
    // P1-1 修复：如果没有 storage，同步设置 isReadyFlag = true
    if (!storage) {
      this.isReadyFlag = true;
      this.initPromise = Promise.resolve();
      this.logger.info('ReputationManager initialized (no storage)');
    } else {
      // P1-2/P2-1 修复：保存初始化 Promise，允许外部等待初始化完成
      this.initPromise = this.loadPersistedData().then(() => {
        this.isReadyFlag = true;
        // P2-1 修复：如果有初始化错误，记录但不阻止启动
        if (this.initError) {
          this.logger.warn('ReputationManager initialized with load error, using defaults', { 
            error: this.initError.message 
          });
        } else {
          this.logger.info('ReputationManager initialized');
        }
      }).catch(error => {
        this.logger.warn('Failed to load persisted data during initialization', { error });
        // P2-1 修复：记录错误但不抛出，允许使用默认值
        this.initError = error instanceof Error ? error : new Error(String(error));
        this.isReadyFlag = true;
      });
    }
    
    // 启动衰减定时器
    if (this.config.decayRate > 0) {
      this.startDecayTimer();
    }
  }

  /**
   * P2-1 修复：检查初始化状态
   * 在关键公共方法开始时调用，确保系统已初始化
   * 如果存在初始化错误，会记录警告但不会阻止操作（降级模式）
   */
  private checkReady(): void {
    if (!this.isReadyFlag) {
      throw new Error('ReputationManager not initialized. Call ready() and await it before using this method.');
    }
    // P2-1 修复：只在首次时记录降级模式警告，防止日志泛滥
    // P3-2 修复：处理 initError.message 可能为空的情况
    if (this.initError && !this.degradedWarned) {
      this.degradedWarned = true;
      this.logger.warn('Operating in degraded mode due to initialization error', {
        error: this.initError.message || 'unknown error'
      });
    }
  }

  /**
   * P1-2/P2-1 修复：等待初始化完成
   * 调用者应使用 await manager.ready() 确保数据加载完成后再调用其他方法
   */
  async ready(): Promise<void> {
    await this.initPromise;
  }

  /**
   * P2-1 修复：检查是否已初始化完成
   */
  get isReady(): boolean {
    return this.isReadyFlag;
  }

  /**
   * P3-1 修复：暴露降级状态
   * 当初始化失败时返回 true，外部可用于监控或告警
   */
  get degraded(): boolean {
    return this.initError !== null;
  }

  /**
   * P0-1/P1-1 修复：从存储加载持久化数据（改为 async）
   */
  private async loadPersistedData(): Promise<void> {
    if (!this.storage) return;
    
    try {
      const data = await this.storage.load();
      if (data) {
        if (data.entries) {
          for (const [peerId, entry] of Object.entries(data.entries)) {
            this.entries.set(peerId, entry as ReputationEntry);
          }
        }
        this.lastDecayTime = data.lastDecayTime || 0;
        this.logger.info('Loaded persisted reputation data', {
          entriesCount: this.entries.size
        });
      }
    } catch (error) {
      this.logger.warn('Failed to load persisted reputation data', { error });
      // P2-2 修复：加载失败时设置错误状态
      this.initError = error instanceof Error ? error : new Error(String(error));
    }
  }
  
  /**
   * P1-2 修复：保存数据到存储
   * P2-1/P2-3 修复：添加并发保护，使用队列确保不丢失更新
   * P2-2 修复：添加重试计数器和最大重试次数限制
   */
  private async savePersistedData(): Promise<void> {
    if (!this.storage) return;
    
    // P2-1 修复：标记有待保存的更新
    this.pendingSave = true;
    
    // P2-3 修复：防止并发保存
    if (this.saveInProgress) {
      this.logger.debug('Save already in progress, will save after current save completes');
      return;
    }
    
    this.saveInProgress = true;
    try {
      // P2-1 修复：循环保存直到没有待处理的更新
      while (this.pendingSave) {
        this.pendingSave = false;
        const data: ReputationPersistedData = {
          entries: Object.fromEntries(this.entries),
          lastDecayTime: this.lastDecayTime
        };
        await this.storage.save(data);
        // P2-2 修复：保存成功后重置重试计数器
        this.saveRetryCount = 0;
      }
    } catch (error) {
      this.logger.warn('Failed to save reputation data', { error });
      // P2-2 修复：保存失败时检查重试次数，超过最大次数则放弃
      this.saveRetryCount++;
      if (this.saveRetryCount <= ReputationManager.MAX_SAVE_RETRIES) {
        // P2-2 修复：重新设置 pendingSave 触发重试
        this.pendingSave = true;
        this.logger.warn(`Save failed, will retry (attempt ${this.saveRetryCount}/${ReputationManager.MAX_SAVE_RETRIES})`);
      } else {
        // P2-2 修复：超过最大重试次数，记录错误并放弃
        this.logger.error(`Save failed after ${ReputationManager.MAX_SAVE_RETRIES} retries, giving up`, { error });
        this.saveRetryCount = 0; // 重置以便下次保存时重新开始
      }
    } finally {
      this.saveInProgress = false;
    }
  }

  /**
   * P1-2/P1-3 修复：Fire-and-forget 保存（重命名以明确语义）
   * 用于 stop() 时确保数据保存
   */
  private savePersistedDataFireAndForget(): void {
    if (!this.storage) return;
    
    try {
      const data: ReputationPersistedData = {
        entries: Object.fromEntries(this.entries),
        lastDecayTime: this.lastDecayTime
      };
      // 注意：这是 fire-and-forget 调用，不等待 Promise 完成
      // 在 stop 场景下，我们尽力而为
      this.storage.save(data).catch(error => {
        this.logger.warn('Failed to save reputation data on stop', { error });
      });
    } catch (error) {
      this.logger.warn('Failed to save reputation data on stop', { error });
    }
  }

  /**
   * 实现 Disposable 接口
   */
  [Symbol.dispose](): void {
    this.stop();
  }

  /**
   * 停止定时器和清理资源
   * P1-1/P1-2 修复：停止时始终保存数据，不跳过
   */
  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = undefined;
    }

    // P1-1/P1-2 修复：停止时保存数据（移除 saveInProgress 检查）
    // 使用重命名后的方法以明确语义
    this.savePersistedDataFireAndForget();
  }

  /**
   * 启动衰减定时器
   */
  private startDecayTimer(): void {
    this.decayTimer = setInterval(() => {
      this.applyDecay();
    }, this.config.decayIntervalMs);
  }

  /**
   * 应用信誉衰减
   * 每个节点的信誉分数按 decayRate 比例衰减
   */
  private applyDecay(): void {
    const decayFactor = 1 - this.config.decayRate;
    
    for (const [peerId, entry] of this.entries) {
      // 不衰减初始分数以下的值
      if (entry.score > this.config.initialScore) {
        const newScore = entry.score * decayFactor;
        // 确保不低于初始分数
        entry.score = Math.max(this.config.initialScore, newScore);
        entry.level = this.getTier(entry.score).level;
        entry.lastUpdated = Date.now();
      }
    }
    
    // P1-2 修复：更新衰减时间并保存
    this.lastDecayTime = Date.now();
    this.savePersistedData().catch(error => {
      this.logger.warn('Failed to save after decay', { error });
    });
    
    this.logger.debug('Applied reputation decay', { 
      decayRate: this.config.decayRate,
      entriesAffected: this.entries.size 
    });
  }

  /**
   * 获取节点信誉信息
   * 如果节点不存在，会自动创建一个带有初始分数的条目
   * @param peerId - 节点的唯一标识符
   * @returns 节点的信誉条目，包含分数、等级和历史记录
   */
  getReputation(peerId: string): ReputationEntry {
    // P2-2 修复：检查初始化状态，保持与其他公共方法一致
    this.checkReady();
    
    if (!this.entries.has(peerId)) {
      this.entries.set(peerId, this.createInitialEntry(peerId));
    }
    return this.entries.get(peerId)!;
  }

  /**
   * 获取信誉等级信息
   * 根据分数返回对应的信誉等级和权限配置
   * @param score - 信誉分数 (0-100)
   * @returns 对应的信誉等级配置
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
   * 检查节点是否具有指定权限
   * @param peerId - 节点的唯一标识符
   * @param permission - 要检查的权限类型：'publish'（发布）、'execute'（执行）、'review'（评审）
   * @returns 如果节点具有该权限则返回 true，否则返回 false
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
   * @param peerId 节点 ID
   * @param taskId 任务 ID
   * @param delta 分数变化量
   * @param latency 响应延迟（毫秒），可选，用于未来优化
   */
  recordSuccess(peerId: string, taskId: string, delta: number = 10, latency?: number): void {
    // P2-3 修复：检查初始化状态
    this.checkReady();
    
    // 验证 latency 参数
    if (latency !== undefined) {
      if (typeof latency !== 'number' || !Number.isFinite(latency)) {
        this.logger.warn('Invalid latency value, ignoring', { 
          peerId: peerId.slice(0, 16), 
          latency 
        });
        latency = undefined;
      } else if (latency < 0) {
        this.logger.warn('Negative latency value, treating as 0', { 
          peerId: peerId.slice(0, 16), 
          latency 
        });
        latency = 0;
      } else if (latency > this.config.maxLatency) {
        this.logger.warn('Latency exceeds max, capping', { 
          peerId: peerId.slice(0, 16), 
          latency,
          maxLatency: this.config.maxLatency 
        });
        latency = this.config.maxLatency;
      }
    }
    
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

    // 截断历史记录，防止无限增长
    if (entry.history.length > this.config.maxHistory) {
      entry.history = entry.history.slice(-this.config.maxHistory);
    }

    // P1-2 修复：保存数据
    this.savePersistedData().catch(error => {
      this.logger.warn('Failed to save after recordSuccess', { error });
    });

    this.logger.info('Reputation updated', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
      level: entry.level,
      latency
    });
  }

  /**
   * 记录任务失败
   * 会降低节点的信誉分数
   * @param peerId - 节点的唯一标识符
   * @param taskId - 失败任务的 ID
   * @param reason - 可选的失败原因描述
   * @param delta - 分数变化量，默认为 -20
   */
  recordFailure(peerId: string, taskId: string, reason?: string, delta: number = -20): void {
    // P2-3 修复：检查初始化状态
    this.checkReady();
    
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

    // 截断历史记录
    if (entry.history.length > this.config.maxHistory) {
      entry.history = entry.history.slice(-this.config.maxHistory);
    }

    // P1-2 修复：保存数据
    this.savePersistedData().catch(error => {
      this.logger.warn('Failed to save after recordFailure', { error });
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
   * 当节点拒绝接受任务时调用，会轻微降低信誉分数
   * @param peerId - 节点的唯一标识符
   * @param taskId - 被拒绝任务的 ID
   * @param reason - 可选的拒绝原因描述
   * @param delta - 分数变化量，默认为 -5
   */
  recordRejection(peerId: string, taskId: string, reason?: string, delta: number = -5): void {
    // P2-3 修复：检查初始化状态
    this.checkReady();
    
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

    // 截断历史记录
    if (entry.history.length > this.config.maxHistory) {
      entry.history = entry.history.slice(-this.config.maxHistory);
    }

    // P1-2 修复：保存数据
    this.savePersistedData().catch(error => {
      this.logger.warn('Failed to save after recordRejection', { error });
    });

    this.logger.info('Reputation updated (rejection)', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
    });
  }

  /**
   * 记录评审奖励
   * 当节点完成评审任务时调用，会提高信誉分数
   * @param peerId - 节点的唯一标识符
   * @param delta - 分数变化量，默认为 3
   */
  recordReviewReward(peerId: string, delta: number = 3): void {
    // P2-3 修复：检查初始化状态
    this.checkReady();
    
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

    // 截断历史记录
    if (entry.history.length > this.config.maxHistory) {
      entry.history = entry.history.slice(-this.config.maxHistory);
    }

    // P1-2 修复：保存数据
    this.savePersistedData().catch(error => {
      this.logger.warn('Failed to save after recordReviewReward', { error });
    });

    this.logger.info('Review reward', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
    });
  }

  /**
   * 记录评审惩罚
   * 当节点提供低质量评审或违规时调用，会降低信誉分数
   * @param peerId - 节点的唯一标识符
   * @param delta - 分数变化量，默认为 -5
   * @param reason - 可选的惩罚原因描述
   */
  recordReviewPenalty(peerId: string, delta: number = -5, reason?: string): void {
    // P2-3 修复：检查初始化状态
    this.checkReady();
    
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

    // 截断历史记录
    if (entry.history.length > this.config.maxHistory) {
      entry.history = entry.history.slice(-this.config.maxHistory);
    }

    // P1-2 修复：保存数据
    this.savePersistedData().catch(error => {
      this.logger.warn('Failed to save after recordReviewPenalty', { error });
    });

    this.logger.warn('Review penalty', {
      peerId: peerId.slice(0, 16),
      delta,
      newScore,
      reason,
    });
  }

  /**
   * 获取所有信誉条目
   * 返回按分数从高到低排序的所有节点信誉信息
   * @returns 排序后的信誉条目数组
   */
  getAllReputations(): ReputationEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * 获取高信誉节点
   * 返回分数达到指定阈值的节点列表，可用于评审任务分配
   * @param minScore - 最低信誉分数阈值，默认为 50
   * @returns 符合条件的信誉条目数组，按分数排序
   */
  getHighReputationNodes(minScore: number = 50): ReputationEntry[] {
    return this.getAllReputations().filter(e => e.score >= minScore);
  }

  /**
   * 获取节点的发布优先级
   * 优先级越高，任务分配时越优先被考虑
   * @param peerId - 节点的唯一标识符
   * @returns 发布优先级 (0-5)
   */
  getPublishPriority(peerId: string): number {
    const entry = this.getReputation(peerId);
    return this.getTier(entry.score).permissions.publishPriority;
  }

  /**
   * 获取节点的发布折扣
   * 高信誉节点可享受更低的服务费用折扣
   * @param peerId - 节点的唯一标识符
   * @returns 发布折扣率 (0.7-1.0，数值越小折扣越大)
   */
  getPublishDiscount(peerId: string): number {
    const entry = this.getReputation(peerId);
    return this.getTier(entry.score).permissions.publishDiscount;
  }

  /**
   * 设置节点的初始信誉分数
   * 用于邀请机制设置被邀请者的初始分数，可覆盖默认初始分数
   * @param peerId - 节点的唯一标识符
   * @param score - 要设置的分数 (0-100)，会自动限制在有效范围内
   */
  setInitialScore(peerId: string, score: number): void {
    // P2-3 修复：检查初始化状态
    this.checkReady();
    
    const entry = this.getReputation(peerId);
    const clampedScore = Math.max(this.config.minScore, Math.min(this.config.maxScore, score));
    entry.score = clampedScore;
    entry.level = this.getTier(clampedScore).level;
    entry.lastUpdated = Date.now();
    entry.history.push({
      type: 'initial',
      delta: clampedScore - this.config.initialScore,
      timestamp: Date.now(),
      reason: 'Set by invitation system'
    });

    // 截断历史记录
    if (entry.history.length > this.config.maxHistory) {
      entry.history = entry.history.slice(-this.config.maxHistory);
    }

    // P1-2 修复：保存数据
    this.savePersistedData().catch(error => {
      this.logger.warn('Failed to save after setInitialScore', { error });
    });

    this.logger.info('Initial score set', {
      peerId: peerId.slice(0, 16),
      score: clampedScore,
      level: entry.level
    });
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