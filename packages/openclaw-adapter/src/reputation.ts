/**
 * 信誉系统
 * 管理 Peer 的信誉分数
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { IReputationManager, IReputationEntry } from '@f2a/network';
import type { 
  ReputationEntry, 
  ReputationEvent, 
  ReputationConfig,
  TaskResponse 
} from './types.js';
import { INTERNAL_REPUTATION_CONFIG } from './types.js';
import { pluginLogger as logger } from './logger.js';

/** 防抖保存配置 */
interface DebounceConfig {
  /** 防抖延迟时间（毫秒） */
  delayMs: number;
  /** 最大等待时间（毫秒） */
  maxWaitMs: number;
}

export class ReputationSystem {
  private config: ReputationConfig;
  private entries: Map<string, ReputationEntry> = new Map();
  private dataPath: string;
  
  // 防抖写入相关
  private savePending: boolean = false;
  private saveTimer?: NodeJS.Timeout;
  private lastSaveTime: number = Date.now();  // 初始化为当前时间，避免首次调用立即触发
  private debounceConfig: DebounceConfig = {
    delayMs: 100,    // 100ms 防抖延迟
    maxWaitMs: 1000  // 最多等待 1 秒
  };

  constructor(config: ReputationConfig, dataDir: string) {
    this.config = config;
    this.dataPath = join(dataDir, 'reputation.json');
    this.load();
  }

  /**
   * 获取 Peer 信誉
   */
  getReputation(peerId: string): ReputationEntry {
    if (!this.entries.has(peerId)) {
      this.entries.set(peerId, this.createDefaultEntry(peerId));
    }
    return this.entries.get(peerId)!;
  }

  /**
   * 记录任务成功
   */
  recordSuccess(peerId: string, taskId: string, latency: number): void {
    const entry = this.getReputation(peerId);
    
    entry.successfulTasks++;
    entry.totalTasks++;
    entry.score = Math.min(100, entry.score + 10);
    entry.avgResponseTime = this.updateAvgResponseTime(entry, latency);
    entry.lastInteraction = Date.now();
    
    entry.history.push({
      type: 'task_success',
      taskId,
      delta: +10,
      timestamp: Date.now()
    });

    this.trimHistory(entry);
    this.save();
  }

  /**
   * 记录任务失败
   */
  recordFailure(peerId: string, taskId: string, reason?: string): void {
    const entry = this.getReputation(peerId);
    
    entry.failedTasks++;
    entry.totalTasks++;
    entry.score = Math.max(0, entry.score - 20);
    entry.lastInteraction = Date.now();
    
    entry.history.push({
      type: 'task_failure',
      taskId,
      delta: -20,
      timestamp: Date.now(),
      reason
    });

    this.trimHistory(entry);
    this.save();
  }

  /**
   * 记录任务拒绝
   */
  recordRejection(peerId: string, taskId: string, reason?: string): void {
    const entry = this.getReputation(peerId);
    
    entry.totalTasks++;
    entry.score = Math.max(0, entry.score - 5);
    entry.lastInteraction = Date.now();
    
    entry.history.push({
      type: 'task_rejected',
      taskId,
      delta: -5,
      timestamp: Date.now(),
      reason
    });

    this.trimHistory(entry);
    this.save();
  }

  /**
   * 记录超时
   */
  recordTimeout(peerId: string, taskId: string): void {
    const entry = this.getReputation(peerId);
    
    entry.totalTasks++;
    entry.score = Math.max(0, entry.score - 15);
    entry.lastInteraction = Date.now();
    
    entry.history.push({
      type: 'timeout',
      taskId,
      delta: -15,
      timestamp: Date.now()
    });

    this.trimHistory(entry);
    this.save();
  }

  /**
   * 记录恶意行为
   */
  recordMalicious(peerId: string, reason: string): void {
    const entry = this.getReputation(peerId);
    
    entry.score = Math.max(0, entry.score - 50);
    entry.lastInteraction = Date.now();
    
    entry.history.push({
      type: 'malicious',
      delta: -50,
      timestamp: Date.now(),
      reason
    });

    this.trimHistory(entry);
    this.save();
  }

  /**
   * 检查是否允许服务
   */
  isAllowed(peerId: string): boolean {
    if (!INTERNAL_REPUTATION_CONFIG.enabled) return true;
    
    const entry = this.getReputation(peerId);
    return entry.score >= INTERNAL_REPUTATION_CONFIG.minScoreForService;
  }

  /**
   * 检查节点是否具有指定权限
   * 基于信誉分数判断权限等级
   * 
   * 权限等级：
   * - restricted (0-20): 仅可执行
   * - novice (20-40): 可发布、可执行
   * - participant (40-60): 可发布、可执行、可评审
   * - contributor (60-80): 可发布、可执行、可评审，发布优先级更高
   * - core (80-100): 可发布、可执行、可评审，最高发布优先级
   * 
   * @param peerId - 节点的唯一标识符
   * @param permission - 要检查的权限类型：'publish'（发布）、'execute'（执行）、'review'（评审）
   * @returns 如果节点具有该权限则返回 true，否则返回 false
   */
  hasPermission(peerId: string, permission: 'publish' | 'execute' | 'review'): boolean {
    const entry = this.getReputation(peerId);
    const score = entry.score;
    
    // 根据分数确定权限
    switch (permission) {
      case 'publish':
        // 20分以上可发布
        return score >= 20;
      case 'execute':
        // 所有节点都可以执行
        return true;
      case 'review':
        // 40分以上可评审
        return score >= 40;
      default:
        return false;
    }
  }

  /**
   * 记录评审奖励
   * 当节点完成评审任务时调用，会提高信誉分数
   * @param peerId - 节点的唯一标识符
   * @param delta - 分数变化量，默认为 3
   */
  recordReviewReward(peerId: string, delta: number = INTERNAL_REPUTATION_CONFIG.reviewReward): void {
    const entry = this.getReputation(peerId);
    
    entry.score = Math.min(100, entry.score + delta);
    entry.lastInteraction = Date.now();
    
    entry.history.push({
      type: 'review_reward',
      delta,
      timestamp: Date.now()
    });

    this.trimHistory(entry);
    this.save();
  }

  /**
   * 记录评审惩罚
   * 当节点提供低质量评审或违规时调用，会降低信誉分数
   * @param peerId - 节点的唯一标识符
   * @param delta - 分数变化量，默认为 -5
   * @param reason - 可选的惩罚原因描述
   */
  recordReviewPenalty(peerId: string, delta: number = -INTERNAL_REPUTATION_CONFIG.reviewPenalty, reason?: string): void {
    const entry = this.getReputation(peerId);
    
    entry.score = Math.max(0, entry.score + delta);
    entry.lastInteraction = Date.now();
    
    entry.history.push({
      type: 'review_penalty',
      delta,
      timestamp: Date.now(),
      reason
    });

    this.trimHistory(entry);
    this.save();
  }

  /**
   * 获取所有信誉记录
   */
  getAllReputations(): ReputationEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * 清理过期记录
   */
  cleanup(maxAgeDays: number = 30): void {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    
    for (const [peerId, entry] of this.entries) {
      if (entry.lastInteraction < cutoff && entry.totalTasks === 0) {
        this.entries.delete(peerId);
      }
    }
    
    this.save();
  }

  /**
   * 获取高信誉节点
   */
  getHighReputationNodes(minScore: number): ReputationEntry[] {
    return Array.from(this.entries.values())
      .filter(entry => entry.score >= minScore);
  }

  /**
   * 创建默认条目
   */
  private createDefaultEntry(peerId: string): ReputationEntry {
    return {
      peerId,
      score: INTERNAL_REPUTATION_CONFIG.initialScore,
      successfulTasks: 0,
      failedTasks: 0,
      totalTasks: 0,
      avgResponseTime: 0,
      lastInteraction: 0,
      history: []
    };
  }

  /**
   * 更新平均响应时间
   */
  private updateAvgResponseTime(entry: ReputationEntry, newLatency: number): number {
    if (entry.avgResponseTime === 0) {
      return newLatency;
    }
    // 指数移动平均
    return entry.avgResponseTime * 0.7 + newLatency * 0.3;
  }

  /**
   * 修剪历史记录
   */
  private trimHistory(entry: ReputationEntry, maxSize: number = 100): void {
    if (entry.history.length > maxSize) {
      entry.history = entry.history.slice(-maxSize);
    }
  }

  /**
   * 加载数据
   */
  private load(): void {
    if (existsSync(this.dataPath)) {
      try {
        const data = JSON.parse(readFileSync(this.dataPath, 'utf-8'));
        for (const entry of data) {
          this.entries.set(entry.peerId, entry);
        }
        logger.info('加载了 %d 条信誉记录', this.entries.size);
      } catch (e) {
        logger.error('加载信誉数据失败: error=%s', e);
      }
    }
  }

  /**
   * 保存数据（防抖 + 异步写入）
   * 
   * P0 修复：使用防抖机制避免高并发下的阻塞问题
   * - 短时间内多次调用只触发一次实际写入
   * - 使用异步写入避免阻塞主线程
   * - 原子写入保证数据完整性
   */
  private save(): void {
    // 标记有待保存的数据
    this.savePending = true;
    
    // 如果已有定时器，先清除
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    
    const now = Date.now();
    const timeSinceLastSave = now - this.lastSaveTime;
    
    // 如果距离上次保存超过 maxWaitMs，立即保存
    if (timeSinceLastSave >= this.debounceConfig.maxWaitMs) {
      this.doSave();
      return;
    }
    
    // 否则设置防抖定时器
    this.saveTimer = setTimeout(() => {
      if (this.savePending) {
        this.doSave();
      }
    }, this.debounceConfig.delayMs);
  }
  
  /**
   * 执行实际的保存操作（异步）
   */
  private doSave(): void {
    this.savePending = false;
    this.saveTimer = undefined;
    this.lastSaveTime = Date.now();
    
    const tempPath = `${this.dataPath}.tmp`;
    
    // 使用 setImmediate 将文件操作移到下一个事件循环
    // 避免阻塞当前操作
    setImmediate(() => {
      try {
        const data = Array.from(this.entries.values());
        const jsonContent = JSON.stringify(data, null, 2);
        
        // 1. 写入临时文件
        writeFileSync(tempPath, jsonContent, { encoding: 'utf-8' });
        
        // 2. 原子重命名（在 POSIX 系统上是原子操作）
        renameSync(tempPath, this.dataPath);
      } catch (e) {
        logger.error('保存信誉数据失败: error=%s', e);
        
        // 清理临时文件（如果存在）
        try {
          if (existsSync(tempPath)) {
            unlinkSync(tempPath);
          }
        } catch {
          // 忽略清理错误
        }
      }
    });
  }
  
  /**
   * 强制同步保存（用于关闭时）
   */
  flush(): void {
    // 清除防抖定时器
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    
    // 如果有待保存的数据，立即同步保存
    if (this.savePending) {
      this.savePending = false;
      this.doSaveSync();
    }
  }
  
  /**
   * 同步保存操作（用于关闭时确保数据持久化）
   */
  private doSaveSync(): void {
    const tempPath = `${this.dataPath}.tmp`;
    
    try {
      const data = Array.from(this.entries.values());
      const jsonContent = JSON.stringify(data, null, 2);
      
      writeFileSync(tempPath, jsonContent, { encoding: 'utf-8' });
      renameSync(tempPath, this.dataPath);
    } catch (e) {
      logger.error('同步保存信誉数据失败: error=%s', e);
      
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // 忽略清理错误
      }
    }
  }
}

/**
 * ReputationManager 适配器
 * 
 * 将 ReputationSystem 包装为 ReviewCommittee 所需的 IReputationManager 接口。
 * 用于解决 ReviewCommittee (src/core/) 依赖 IReputationManager 接口，
 * 而 adapter 使用的是 ReputationSystem 的问题。
 */
export class ReputationManagerAdapter implements IReputationManager {
  private reputationSystem: ReputationSystem;

  constructor(reputationSystem: ReputationSystem) {
    this.reputationSystem = reputationSystem;
  }

  /**
   * 检查节点是否具有指定权限
   */
  hasPermission(peerId: string, permission: 'publish' | 'execute' | 'review'): boolean {
    return this.reputationSystem.hasPermission(peerId, permission);
  }

  /**
   * 获取高信誉节点
   */
  getHighReputationNodes(minScore: number): IReputationEntry[] {
    return this.reputationSystem.getHighReputationNodes(minScore);
  }

  /**
   * 获取所有信誉记录
   */
  getAllReputations(): IReputationEntry[] {
    return this.reputationSystem.getAllReputations();
  }

  /**
   * 记录评审惩罚
   */
  recordReviewPenalty(peerId: string, delta: number, reason?: string): void {
    this.reputationSystem.recordReviewPenalty(peerId, delta, reason);
  }

  /**
   * 记录评审奖励
   */
  recordReviewReward(peerId: string, delta: number): void {
    this.reputationSystem.recordReviewReward(peerId, delta);
  }
}