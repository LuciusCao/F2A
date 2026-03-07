/**
 * F2A Webhook Pusher
 * 优先使用 webhook 推送任务到 OpenClaw，失败时退化为轮询
 */

import type { QueuedTask } from './task-queue.js';

export interface WebhookPushConfig {
  /** OpenClaw webhook URL */
  url: string;
  /** Webhook 认证 token */
  token: string;
  /** 推送超时（毫秒） */
  timeout?: number;
  /** 是否启用 webhook 推送 */
  enabled?: boolean;
}

export interface WebhookPushResult {
  success: boolean;
  error?: string;
  latency?: number;
}

export class WebhookPusher {
  private config: WebhookPushConfig;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  
  // 连续失败后暂停推送一段时间
  private readonly FAILURE_THRESHOLD = 3;
  private readonly BASE_COOLDOWN_MS = 10000; // 基础冷却期 10 秒
  private readonly MAX_COOLDOWN_MS = 300000; // 最大冷却期 5 分钟

  constructor(config: WebhookPushConfig) {
    this.config = {
      timeout: 5000,
      enabled: true,
      ...config
    };
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
    
    console.log(`[WebhookPusher] 冷却期计算: 失败次数=${this.consecutiveFailures}, 冷却期=${Math.round(cooldown / 1000)}秒`);
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
      return { 
        success: false, 
        error: `In cooldown (${Math.round(remainingMs / 1000)}s remaining)` 
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
        // 成功，重置失败计数
        this.consecutiveFailures = 0;
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
      
      // 如果进入冷却期，停止推送
      if (this.isInCooldown()) {
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
    
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      const cooldownSec = Math.round(this.getCooldownMs() / 1000);
      console.warn(`[WebhookPusher] 连续失败 ${this.consecutiveFailures} 次，进入 ${cooldownSec} 秒冷却期`);
    }
  }

  /**
   * 获取状态
   */
  getStatus(): {
    enabled: boolean;
    consecutiveFailures: number;
    inCooldown: boolean;
    currentCooldownMs: number;
  } {
    return {
      enabled: this.config.enabled ?? true,
      consecutiveFailures: this.consecutiveFailures,
      inCooldown: this.isInCooldown(),
      currentCooldownMs: this.isInCooldown() ? this.getCooldownMs() : 0
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<WebhookPushConfig>): void {
    this.config = { ...this.config, ...config };
  }
}