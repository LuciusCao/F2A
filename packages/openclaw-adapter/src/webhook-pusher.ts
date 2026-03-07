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
  private readonly COOLDOWN_MS = 60000; // 1 分钟冷却

  constructor(config: WebhookPushConfig) {
    this.config = {
      timeout: 5000,
      enabled: true,
      ...config
    };
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
      return { success: false, error: 'In cooldown after consecutive failures' };
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
    return elapsed < this.COOLDOWN_MS;
  }

  /**
   * 记录失败
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      console.warn(`[WebhookPusher] 连续失败 ${this.consecutiveFailures} 次，进入 1 分钟冷却期`);
    }
  }

  /**
   * 获取状态
   */
  getStatus(): {
    enabled: boolean;
    consecutiveFailures: number;
    inCooldown: boolean;
  } {
    return {
      enabled: this.config.enabled ?? true,
      consecutiveFailures: this.consecutiveFailures,
      inCooldown: this.isInCooldown()
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<WebhookPushConfig>): void {
    this.config = { ...this.config, ...config };
  }
}