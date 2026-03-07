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

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30000;

export class F2ANetworkClient {
  private baseUrl: string;
  private token: string;
  private timeoutMs: number;

  constructor(config: F2ANodeConfig) {
    this.baseUrl = `http://localhost:${config.controlPort}`;
    this.token = config.controlToken;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    method: string, 
    path: string, 
    body?: unknown
  ): Promise<Result<T>> {
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
        return failure(createError(
          'TIMEOUT',
          `Request timed out after ${this.timeoutMs}ms`
        ));
      }
      
      return failure(createError(
        'CONNECTION_FAILED',
        error instanceof Error ? error.message : String(error)
      ));
    } finally {
      clearTimeout(timeoutId);
    }
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