/**
 * 信誉系统
 * 管理 Peer 的信誉分数
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { 
  ReputationEntry, 
  ReputationEvent, 
  ReputationConfig,
  TaskResponse 
} from './types.js';

export class ReputationSystem {
  private config: ReputationConfig;
  private entries: Map<string, ReputationEntry> = new Map();
  private dataPath: string;

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
    if (!this.config.enabled) return true;
    
    const entry = this.getReputation(peerId);
    return entry.score >= this.config.minScoreForService;
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
      score: this.config.initialScore,
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
        console.log(`[F2A Reputation] 加载了 ${this.entries.size} 条记录`);
      } catch (e) {
        console.error('[F2A Reputation] 加载失败:', e);
      }
    }
  }

  /**
   * 保存数据（原子写入）
   * 先写入临时文件，再重命名为目标文件，确保数据完整性
   */
  private save(): void {
    const tempPath = `${this.dataPath}.tmp`;
    
    try {
      const data = Array.from(this.entries.values());
      const jsonContent = JSON.stringify(data, null, 2);
      
      // 1. 写入临时文件
      writeFileSync(tempPath, jsonContent, { encoding: 'utf-8' });
      
      // 2. 原子重命名（在 POSIX 系统上是原子操作）
      renameSync(tempPath, this.dataPath);
    } catch (e) {
      console.error('[F2A Reputation] 保存失败:', e);
      
      // 清理临时文件（如果存在）
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