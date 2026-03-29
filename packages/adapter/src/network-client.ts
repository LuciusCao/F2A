/**
 * F2A Network Client
 * 与 F2A Node 的 HTTP API 通信
 */

import type { 
  F2ANodeConfig, 
  AgentInfo, 
  PeerInfo, 
  TaskRequest, 
  TaskResponse,
  DelegateOptions
} from './types.js';
import { Result, failure, success, createError } from './types.js';
import { ensureError, getErrorMessage } from '@f2a/network';
// P1-8 修复：统一使用 logger.ts 的 Logger 接口
import type { Logger } from './logger.js';

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30000;

/** 默认重试配置 */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/** 可重试的错误码 */
const RETRYABLE_ERROR_CODES = [
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN'
];

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUS_CODES = [502, 503, 504, 429];

export class F2ANetworkClient {
  private baseUrl: string;
  private token: string;
  private timeoutMs: number;
  private maxRetries: number;
  private baseDelayMs: number;
  private logger: Logger;

  constructor(config: F2ANodeConfig, logger?: Logger) {
    this.baseUrl = `http://localhost:${config.controlPort}`;
    this.token = config.controlToken;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = config.retryDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.logger = logger || console;
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      // 网络错误
      if (RETRYABLE_ERROR_CODES.some(code => error.message.includes(code))) {
        return true;
      }
      // 超时错误
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return true;
      }
    }
    return false;
  }

  /**
   * 计算重试延迟（指数退避 + 抖动）
   */
  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * this.baseDelayMs * 0.5;
    return Math.min(exponentialDelay + jitter, 30000); // 最大 30 秒
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async request<T>(
    method: string, 
    path: string, 
    body?: unknown
  ): Promise<Result<T>> {
    // P1 修复：初始化 lastError 为有意义的默认值，避免 null 问题
    let lastError: Error = new Error('Request failed before any attempt');

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // 使用 AbortController 设置超时
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });

        if (!response.ok) {
          const errorText = await response.text();
          
          // 检查是否是可重试的 HTTP 错误
          if (RETRYABLE_STATUS_CODES.includes(response.status) && attempt < this.maxRetries) {
            lastError = new Error(`HTTP ${response.status}: ${errorText}`);
            const delayMs = this.calculateDelay(attempt);
            this.logger.info(`[F2A:Network] Retrying request to ${path} after ${delayMs}ms (attempt ${attempt + 1}/${this.maxRetries})`);
            clearTimeout(timeoutId);
            await this.delay(delayMs);
            continue;
          }
          
          return failure(createError(
            'CONNECTION_FAILED',
            `HTTP ${response.status}: ${errorText}`
          ));
        }

        const data = await response.json() as T;
        return success(data);

      } catch (error) {
        // 处理超时错误
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt < this.maxRetries) {
            const delayMs = this.calculateDelay(attempt);
            this.logger.info(`[F2A:Network] Retrying request to ${path} after timeout (${delayMs}ms, attempt ${attempt + 1}/${this.maxRetries})`);
            clearTimeout(timeoutId);
            await this.delay(delayMs);
            continue;
          }
          // 所有重试都因超时失败
          return failure(createError(
            'CONNECTION_FAILED',
            `Request timed out after ${this.timeoutMs}ms`
          ));
        }
        
        // 检查是否可重试
        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          lastError = ensureError(error);
          const delayMs = this.calculateDelay(attempt);
          this.logger.info(`[F2A:Network] Retrying request to ${path} after ${delayMs}ms (attempt ${attempt + 1}/${this.maxRetries})`);
          clearTimeout(timeoutId);
          await this.delay(delayMs);
          continue;
        }
        
        // P1 修复：确保返回有意义的错误信息
        const errorMessage = getErrorMessage(error);
        lastError = ensureError(error);
        
        return failure(createError(
          'CONNECTION_FAILED',
          errorMessage
        ));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // 所有重试都失败了
    // P1 修复：lastError 此时一定有值，不再需要 optional chaining
    return failure(createError(
      'CONNECTION_FAILED',
      lastError.message
    ));
  }

  /**
   * 发现网络中的 Agents
   */
  async discoverAgents(capability?: string): Promise<Result<AgentInfo[]>> {
    return this.request<AgentInfo[]>('POST', '/discover', { capability });
  }

  /**
   * 获取已连接的 Peers
   */
  async getConnectedPeers(): Promise<Result<PeerInfo[]>> {
    return this.request<PeerInfo[]>('GET', '/peers');
  }

  /**
   * 委托任务给特定 Peer
   */
  async delegateTask(options: DelegateOptions): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/delegate', options);
  }

  /**
   * 发送任务响应
   */
  async sendTaskResponse(
    peerId: string, 
    response: TaskResponse
  ): Promise<Result<void>> {
    return this.request<void>('POST', '/task/response', {
      peerId,
      ...response
    });
  }

  /**
   * 注册 Webhook
   */
  async registerWebhook(webhookUrl: string): Promise<Result<void>> {
    return this.request<void>('POST', '/webhook/register', { 
      url: webhookUrl,
      events: ['discover', 'delegate', 'status']
    });
  }

  /**
   * 更新 Agent 信息
   */
  async updateAgentInfo(agentInfo: Partial<AgentInfo>): Promise<Result<void>> {
    return this.request<void>('POST', '/agent/update', agentInfo);
  }

  /**
   * 获取待处理任务
   */
  async getPendingTasks(): Promise<Result<TaskRequest[]>> {
    return this.request<TaskRequest[]>('GET', '/tasks/pending');
  }

  /**
   * 确认连接请求
   */
  async confirmConnection(peerId: string): Promise<Result<void>> {
    return this.request<void>('POST', '/connection/confirm', { peerId });
  }

  /**
   * 拒绝连接请求
   */
  async rejectConnection(peerId: string, reason?: string): Promise<Result<void>> {
    return this.request<void>('POST', '/connection/reject', { peerId, reason });
  }
}