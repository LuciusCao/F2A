/**
 * F2A Webhook Pusher
 * 优先使用 webhook 推送任务到 OpenClaw，失败时退化为轮询
 */

import type { QueuedTask } from './task-queue.js';
import type { WebhookPushConfig } from './types.js';

/** Logger 接口 */
interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

export interface WebhookPushResult {
  success: boolean;
  error?: string;
  latency?: number;
  /** 是否处于降级模式（冷却期但允许轮询） */
  degraded?: boolean;
}

export class WebhookPusher {
  private config: WebhookPushConfig;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private degradedMode = false;
  private logger: Logger;
  
  // 连续失败后暂停推送一段时间
  private readonly FAILURE_THRESHOLD = 3;
  private readonly BASE_COOLDOWN_MS = 10000; // 基础冷却期 10 秒
  private readonly MAX_COOLDOWN_MS = 300000; // 最大冷却期 5 分钟

  constructor(config: WebhookPushConfig, logger?: Logger) {
    this.config = {
      timeout: 5000,
      enabled: true,
      ...config
    };
    this.logger = logger || console;
  }

  /**
   * 计算当前冷却期（指数退避）
   */
  private getCooldownMs(): number {
    if (this.consecutiveFailures <= this.FAILURE_THRESHOLD) {
      return this.BASE_COOLDOWN_MS;
    }
    
    // 指数退避：冷却期随失败次数增加，但有上限
    const multiplier = Math.pow(2, this.consecutiveFailures - this.FAILURE_THRESHOLD);
    const cooldown = Math.min(this.BASE_COOLDOWN_MS * multiplier, this.MAX_COOLDOWN_MS);
    
    this.logger.debug?.(`[F2A:Pusher] 冷却期计算: 失败次数=${this.consecutiveFailures}, 冷却期=${Math.round(cooldown / 1000)}秒`);
    return cooldown;
  }

  /**
   * 推送任务到 OpenClaw webhook
   */
  async pushTask(task: QueuedTask): Promise<WebhookPushResult> {
    if (!this.config.enabled) {
      return { success: false, error: 'Webhook push disabled' };
    }

    // 检查是否在冷却期
    if (this.isInCooldown()) {
      const remainingMs = this.getCooldownMs() - (Date.now() - this.lastFailureTime);
      
      // 降级机制：冷却期内仍返回特殊结果，让调用方知道可以通过轮询处理
      // 返回 degraded: true 表示处于降级模式，任务需要通过轮询机制处理
      return { 
        success: false, 
        error: `In cooldown (${Math.round(remainingMs / 1000)}s remaining)`,
        degraded: true
      };
    }

    const start = Date.now();

    try {
      const response = await fetch(`${this.config.url}/hooks/agent`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `F2A 远程任务: ${task.taskType || 'unknown'}`,
          name: 'F2A',
          sessionKey: `f2a:${task.taskId}`,
          wakeMode: 'now',
          deliver: false,
          timeoutSeconds: 120
        }),
        signal: AbortSignal.timeout(this.config.timeout!)
      });

      const latency = Date.now() - start;

      if (response.ok || response.status === 202) {
        // 成功，重置失败计数和降级模式
        this.consecutiveFailures = 0;
        this.degradedMode = false;
        return { success: true, latency };
      }

      // 失败
      this.recordFailure();
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${response.statusText}`,
        latency 
      };
    } catch (error) {
      this.recordFailure();
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        latency: Date.now() - start
      };
    }
  }

  /**
   * 批量推送任务
   */
  async pushTasks(tasks: QueuedTask[]): Promise<Map<string, WebhookPushResult>> {
    const results = new Map<string, WebhookPushResult>();

    for (const task of tasks) {
      const result = await this.pushTask(task);
      results.set(task.taskId, result);
      
      // 如果进入冷却期，停止推送但标记剩余任务为可轮询
      if (result.degraded) {
        // 剩余任务标记为需要轮询
        const remainingTasks = tasks.filter(t => !results.has(t.taskId));
        for (const remaining of remainingTasks) {
          results.set(remaining.taskId, { 
            success: false, 
            error: 'Skipped due to cooldown', 
            degraded: true 
          });
        }
        break;
      }
    }

    return results;
  }

  /**
   * 检查是否在冷却期
   */
  private isInCooldown(): boolean {
    if (this.consecutiveFailures < this.FAILURE_THRESHOLD) {
      return false;
    }
    
    const elapsed = Date.now() - this.lastFailureTime;
    const cooldownMs = this.getCooldownMs();
    return elapsed < cooldownMs;
  }

  /**
   * 记录失败
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.degradedMode = true;
    
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      const cooldownSec = Math.round(this.getCooldownMs() / 1000);
      this.logger.warn(`[F2A:Pusher] 连续失败 ${this.consecutiveFailures} 次，进入 ${cooldownSec} 秒冷却期（降级模式启用）`);
    }
  }

  /**
   * 手动重置冷却期（用于外部干预）
   */
  resetCooldown(): void {
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.degradedMode = false;
    this.logger.info('[F2A:Pusher] 冷却期已手动重置');
  }

  /**
   * 获取状态
   */
  getStatus(): {
    enabled: boolean;
    consecutiveFailures: number;
    inCooldown: boolean;
    currentCooldownMs: number;
    degradedMode: boolean;
  } {
    return {
      enabled: this.config.enabled ?? true,
      consecutiveFailures: this.consecutiveFailures,
      inCooldown: this.isInCooldown(),
      currentCooldownMs: this.isInCooldown() ? this.getCooldownMs() : 0,
      degradedMode: this.degradedMode
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<WebhookPushConfig>): void {
    this.config = { ...this.config, ...config };
  }
}