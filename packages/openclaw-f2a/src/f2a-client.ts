/**
 * F2A Client
 * OpenClaw 插件通过此客户端与 F2A Daemon 通信
 * 
 * Phase 3: 插件变成轻量客户端
 */

import type { ApiLogger } from './types.js';
import type { AgentCapability, AgentInfo, PeerInfo } from '@f2a/network';

/**
 * 简单 Logger 实现
 */
class SimpleLogger {
  constructor(private component: string) {}
  
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`[${this.component}] ${message}`, meta || '');
  }
  
  debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.DEBUG) {
      console.debug(`[${this.component}] ${message}`, meta || '');
    }
  }
  
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[${this.component}] ${message}`, meta || '');
  }
  
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[${this.component}] ${message}`, meta || '');
  }
}

/**
 * F2AClient 配置
 */
export interface F2AClientConfig {
  /** Daemon URL */
  daemonUrl: string;
  /** 当前 Agent ID */
  agentId: string;
  /** Agent 名称 */
  agentName: string;
  /** Agent 能力列表 */
  capabilities?: AgentCapability[];
  /** Webhook URL（用于接收消息推送） */
  webhookUrl?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
}

/**
 * Agent 注册请求
 */
export interface AgentRegisterRequest {
  agentId: string;
  name: string;
  capabilities: AgentCapability[];
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 消息发送请求
 */
export interface MessageSendRequest {
  fromAgentId: string;
  toAgentId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
}

/**
 * 路由消息
 */
export interface RoutableMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  type: string;
  createdAt: string;
}

/**
 * Daemon 响应
 */
export interface DaemonResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * F2A Daemon 客户端
 */
export class F2AClient {
  private config: Required<F2AClientConfig>;
  private logger: SimpleLogger;
  private registered: boolean = false;
  private abortController?: AbortController;

  constructor(config: F2AClientConfig) {
    this.config = {
      daemonUrl: config.daemonUrl || 'http://localhost:7788',
      agentId: config.agentId,
      agentName: config.agentName,
      capabilities: config.capabilities || [],
      webhookUrl: config.webhookUrl,
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 1000,
    };
    this.logger = new SimpleLogger('F2AClient');
  }

  /**
   * 检查 Daemon 是否可用
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.fetch('/health', {
        method: 'GET',
      });
      return response.success;
    } catch {
      return false;
    }
  }

  /**
   * 注册 Agent 到 Daemon
   */
  async registerAgent(): Promise<DaemonResponse<AgentRegisterRequest>> {
    const request: AgentRegisterRequest = {
      agentId: this.config.agentId,
      name: this.config.agentName,
      capabilities: this.config.capabilities,
      webhookUrl: this.config.webhookUrl,
      metadata: {
        registeredAt: new Date().toISOString(),
      },
    };

    try {
      const response = await this.fetch('/api/agents', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      if (response.success) {
        this.registered = true;
        this.logger.info('Agent registered to Daemon', {
          agentId: this.config.agentId,
          daemonUrl: this.config.daemonUrl,
        });
      }

      return response as DaemonResponse<AgentRegisterRequest>;
    } catch (error) {
      this.logger.error('Failed to register agent', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'REGISTER_FAILED',
      };
    }
  }

  /**
   * 注销 Agent
   */
  async unregisterAgent(): Promise<DaemonResponse> {
    if (!this.registered) {
      return { success: true };
    }

    try {
      const response = await this.fetch(`/api/agents/${this.config.agentId}`, {
        method: 'DELETE',
      });

      if (response.success) {
        this.registered = false;
        this.logger.info('Agent unregistered from Daemon', {
          agentId: this.config.agentId,
        });
      }

      return response;
    } catch (error) {
      this.logger.error('Failed to unregister agent', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'UNREGISTER_FAILED',
      };
    }
  }

  /**
   * 发送消息给其他 Agent
   */
  async sendMessage(
    to: string,
    content: string,
    metadata?: Record<string, unknown>,
    type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim'
  ): Promise<DaemonResponse<{ messageId: string }>> {
    const request: MessageSendRequest = {
      fromAgentId: this.config.agentId,
      toAgentId: to,
      content,
      metadata,
      type: type || 'message',
    };

    try {
      const response = await this.fetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      return response as DaemonResponse<{ messageId: string }>;
    } catch (error) {
      this.logger.error('Failed to send message', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'SEND_FAILED',
      };
    }
  }

  /**
   * 广播消息给所有 Agent
   */
  async broadcastMessage(
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<DaemonResponse<{ messageId: string; broadcasted: number }>> {
    const request: MessageSendRequest = {
      fromAgentId: this.config.agentId,
      content,
      metadata,
      type: 'announcement',
    };

    try {
      const response = await this.fetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      return response as DaemonResponse<{ messageId: string; broadcasted: number }>;
    } catch (error) {
      this.logger.error('Failed to broadcast message', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'BROADCAST_FAILED',
      };
    }
  }

  /**
   * 获取本 Agent 的消息队列
   */
  async getMessages(limit?: number): Promise<DaemonResponse<{ messages: RoutableMessage[]; count: number }>> {
    const params = limit ? `?limit=${limit}` : '';
    
    try {
      const response = await this.fetch(`/api/messages/${this.config.agentId}${params}`, {
        method: 'GET',
      });

      return response as DaemonResponse<{ messages: RoutableMessage[]; count: number }>;
    } catch (error) {
      this.logger.error('Failed to get messages', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'GET_MESSAGES_FAILED',
      };
    }
  }

  /**
   * 清除已处理的消息
   */
  async clearMessages(messageIds?: string[]): Promise<DaemonResponse<{ cleared: number }>> {
    const body = messageIds ? JSON.stringify({ messageIds }) : '';
    
    try {
      const response = await this.fetch(`/api/messages/${this.config.agentId}`, {
        method: 'DELETE',
        body,
      });

      return response as DaemonResponse<{ cleared: number }>;
    } catch (error) {
      this.logger.error('Failed to clear messages', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'CLEAR_MESSAGES_FAILED',
      };
    }
  }

  /**
   * 获取所有注册的 Agent
   */
  async getAgents(): Promise<DaemonResponse<{ agents: AgentRegisterRequest[]; stats: { total: number; capabilities: Record<string, number> } }>> {
    try {
      const response = await this.fetch('/api/agents', {
        method: 'GET',
      });

      return response as DaemonResponse<{ agents: AgentRegisterRequest[]; stats: { total: number; capabilities: Record<string, number> } }>;
    } catch (error) {
      this.logger.error('Failed to get agents', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'GET_AGENTS_FAILED',
      };
    }
  }

  /**
   * 发现具备特定能力的 Agent
   */
  async discoverAgentsByCapability(capability: string): Promise<DaemonResponse<{ agents: AgentRegisterRequest[] }>> {
    try {
      // 先获取所有 Agent
      const response = await this.getAgents();
      
      if (!response.success || !response.data) {
        return response as DaemonResponse<{ agents: AgentRegisterRequest[] }>;
      }

      // 过滤具备指定能力的 Agent
      const agents = response.data.agents.filter(agent =>
        agent.capabilities.some(cap => cap.name === capability)
      );

      return {
        success: true,
        data: { agents },
      };
    } catch (error) {
      this.logger.error('Failed to discover agents by capability', {
        error: error instanceof Error ? error.message : String(error),
        capability,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'DISCOVER_FAILED',
      };
    }
  }

  /**
   * 获取 Daemon 状态
   */
  async getDaemonStatus(): Promise<DaemonResponse<{ peerId: string; agentInfo: AgentInfo }>> {
    try {
      const response = await this.fetch('/status', {
        method: 'GET',
      });

      return response as DaemonResponse<{ peerId: string; agentInfo: AgentInfo }>;
    } catch (error) {
      this.logger.error('Failed to get daemon status', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'GET_STATUS_FAILED',
      };
    }
  }

  /**
   * 获取 P2P 网络 Peers
   */
  async getPeers(): Promise<DaemonResponse<PeerInfo[]>> {
    try {
      const response = await this.fetch('/peers', {
        method: 'GET',
      });

      return response as DaemonResponse<PeerInfo[]>;
    } catch (error) {
      this.logger.error('Failed to get peers', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        code: 'GET_PEERS_FAILED',
      };
    }
  }

  /**
   * 是否已注册
   */
  isRegistered(): boolean {
    return this.registered;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<F2AClientConfig> {
    return this.config;
  }

  /**
   * 关闭客户端
   */
  async close(): Promise<void> {
    if (this.registered) {
      await this.unregisterAgent();
    }
    
    if (this.abortController) {
      this.abortController.abort();
    }
    
    this.logger.info('F2AClient closed');
  }

  // ========== 内部方法 ==========

  /**
   * 发送 HTTP 请求到 Daemon
   */
  private async fetch(path: string, options: {
    method: 'GET' | 'POST' | 'DELETE';
    body?: string;
  }): Promise<DaemonResponse> {
    const url = `${this.config.daemonUrl}${path}`;
    
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        this.abortController = new AbortController();
        
        const response = await global.fetch(url, {
          method: options.method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: options.body,
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          try {
            const data = JSON.parse(text);
            return data as DaemonResponse;
          } catch {
            return {
              success: false,
              error: text,
              code: `HTTP_${response.status}`,
            };
          }
        }

        const data = await response.json() as DaemonResponse;
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.config.retries - 1) {
          this.logger.debug('Retry attempt', {
            attempt: attempt + 1,
            retries: this.config.retries,
            error: lastError.message,
          });
          
          await this.sleep(this.config.retryDelay);
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      code: 'REQUEST_FAILED',
    };
  }

  /**
   * 等待指定时间
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}