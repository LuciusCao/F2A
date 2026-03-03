/**
 * OpenClaw F2A 适配器
 * 将 F2A P2P 网络集成到 OpenClaw
 * 
 * 使用方式:
 * ```typescript
 * const adapter = await OpenClawF2AAdapter.create(openclawSession);
 * await adapter.start();
 * 
 * // 委托任务给网络
 * const result = await adapter.delegateTask({
 *   capability: 'code-generation',
 *   description: 'Generate a Python function to calculate fibonacci'
 * });
 * ```
 */

import { F2A, AgentCapability, TaskDelegateOptions, TaskDelegateResult, AgentInfo } from '../index';
import type { F2AOptions, Result, TaskRequestEvent } from '../types';

// OpenClaw 会话接口（简化）
export interface OpenClawSession {
  execute: (task: string, options?: unknown) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface OpenClawF2AAdapterOptions {
  /** 节点显示名称 */
  displayName?: string;
  /** 监听端口（0表示随机） */
  listenPort?: number;
  /** 引导节点列表 */
  bootstrapPeers?: string[];
  /** 是否启用本地 MDNS 发现 */
  enableMDNS?: boolean;
  /** 能力处理器映射 */
  capabilityHandlers?: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
}

export class OpenClawF2AAdapter {
  private f2a: F2A;
  private openclaw: OpenClawSession;
  private options: Required<OpenClawF2AAdapterOptions>;
  private running: boolean = false;

  private constructor(f2a: F2A, openclaw: OpenClawSession, options: Required<OpenClawF2AAdapterOptions>) {
    this.f2a = f2a;
    this.openclaw = openclaw;
    this.options = options;
  }

  /**
   * 创建适配器实例
   */
  static async create(
    openclaw: OpenClawSession,
    options: OpenClawF2AAdapterOptions = {}
  ): Promise<OpenClawF2AAdapter> {
    const mergedOptions: Required<OpenClawF2AAdapterOptions> = {
      displayName: options.displayName || 'OpenClaw Agent',
      listenPort: options.listenPort || 0,
      bootstrapPeers: options.bootstrapPeers || [],
      enableMDNS: options.enableMDNS !== false,
      capabilityHandlers: options.capabilityHandlers || {}
    };

    // 创建 F2A 实例
    const f2aOptions: F2AOptions = {
      displayName: mergedOptions.displayName,
      agentType: 'openclaw',
      network: {
        listenPort: mergedOptions.listenPort,
        enableMDNS: mergedOptions.enableMDNS,
        bootstrapPeers: mergedOptions.bootstrapPeers
      }
    };

    const f2a = await F2A.create(f2aOptions);

    // 注册默认能力
    await this.registerDefaultCapabilities(f2a, openclaw, mergedOptions.capabilityHandlers);

    return new OpenClawF2AAdapter(f2a, openclaw, mergedOptions);
  }

  /**
   * 注册默认能力
   */
  private static async registerDefaultCapabilities(
    f2a: F2A,
    openclaw: OpenClawSession,
    customHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>
  ): Promise<void> {
    // 获取 OpenClaw 可用工具作为能力
    const capabilities = await this.detectOpenClawCapabilities(openclaw);

    for (const cap of capabilities) {
      const handler = customHandlers[cap.name] || this.createDefaultHandler(openclaw, cap);
      f2a.registerCapability(cap, handler);
    }
  }

  /**
   * 检测 OpenClaw 的能力
   */
  private static async detectOpenClawCapabilities(
    openclaw: OpenClawSession
  ): Promise<AgentCapability[]> {
    // 默认能力集
    const defaultCapabilities: AgentCapability[] = [
      {
        name: 'file-operation',
        description: 'Read and write files on the local system',
        tools: ['read', 'write', 'edit', 'list'],
        parameters: {
          action: {
            type: 'string',
            required: true,
            description: 'Action to perform: read, write, edit, list'
          },
          path: {
            type: 'string',
            required: true,
            description: 'File or directory path'
          },
          content: {
            type: 'string',
            required: false,
            description: 'Content for write operations'
          }
        }
      },
      {
        name: 'command-execution',
        description: 'Execute shell commands',
        tools: ['exec', 'bash'],
        parameters: {
          command: {
            type: 'string',
            required: true,
            description: 'Shell command to execute'
          },
          cwd: {
            type: 'string',
            required: false,
            description: 'Working directory'
          }
        }
      },
      {
        name: 'web-browsing',
        description: 'Browse web pages and fetch content',
        tools: ['browser', 'fetch'],
        parameters: {
          url: {
            type: 'string',
            required: true,
            description: 'URL to browse or fetch'
          },
          action: {
            type: 'string',
            required: false,
            description: 'Action: fetch, screenshot, click, type'
          }
        }
      },
      {
        name: 'code-generation',
        description: 'Generate code in various programming languages',
        tools: ['generate', 'refactor', 'explain'],
        parameters: {
          language: {
            type: 'string',
            required: true,
            description: 'Programming language'
          },
          description: {
            type: 'string',
            required: true,
            description: 'What the code should do'
          },
          context: {
            type: 'string',
            required: false,
            description: 'Additional context or requirements'
          }
        }
      },
      {
        name: 'task-delegation',
        description: 'Delegate tasks to other agents in the network',
        tools: ['delegate', 'discover'],
        parameters: {
          capability: {
            type: 'string',
            required: true,
            description: 'Required capability'
          },
          description: {
            type: 'string',
            required: true,
            description: 'Task description'
          }
        }
      }
    ];

    return defaultCapabilities;
  }

  /**
   * 创建默认能力处理器
   */
  private static createDefaultHandler(
    openclaw: OpenClawSession,
    capability: AgentCapability
  ): (params: Record<string, unknown>) => Promise<unknown> {
    return async (params: Record<string, unknown>) => {
      // 构建任务描述
      const taskDescription = this.buildTaskDescription(capability.name, params);
      
      // 调用 OpenClaw 执行
      const result = await openclaw.execute(taskDescription, {
        capability: capability.name,
        parameters: params
      });

      return result;
    };
  }

  /**
   * 构建任务描述
   */
  private static buildTaskDescription(capabilityName: string, params: Record<string, unknown>): string {
    const paramStr = Object.entries(params)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');
    
    return `[F2A Task] ${capabilityName}: ${paramStr}`;
  }

  /**
   * 启动适配器
   */
  async start(): Promise<Result<void>> {
    if (this.running) {
      return { success: false, error: 'Adapter already running' };
    }

    // 启动 F2A
    const result = await this.f2a.start();
    if (!result.success) {
      return result;
    }

    // 绑定任务请求处理
    this.f2a.on('task:request', async (event: TaskRequestEvent) => {
      await this.handleTaskRequest(event);
    });

    this.running = true;
    console.log(`[OpenClawF2A] Adapter started with peerId: ${this.f2a.peerId.slice(0, 16)}...`);

    return { success: true, data: undefined };
  }

  /**
   * 停止适配器
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    await this.f2a.stop();
    this.running = false;

    console.log('[OpenClawF2A] Adapter stopped');
  }

  /**
   * 处理收到的任务请求
   */
  private async handleTaskRequest(event: TaskRequestEvent): Promise<void> {
    console.log(`[OpenClawF2A] Handling task request: ${event.taskType}`);

    try {
      // 构建任务描述
      const taskDescription = `[F2A Remote Task from ${event.from.slice(0, 16)}...] ${event.description}`;
      
      // 调用 OpenClaw 执行
      const result = await this.openclaw.execute(taskDescription, {
        taskType: event.taskType,
        parameters: event.parameters,
        remote: true,
        from: event.from
      });

      // 发送成功响应
      await this.f2a.respondToTask(
        event.from,
        event.taskId,
        'success',
        result
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[OpenClawF2A] Task execution failed:`, errorMsg);

      // 发送错误响应
      await this.f2a.respondToTask(
        event.from,
        event.taskId,
        'error',
        undefined,
        errorMsg
      );
    }
  }

  /**
   * 委托任务给网络中的其他 Agent
   */
  async delegateTask(options: TaskDelegateOptions): Promise<Result<TaskDelegateResult>> {
    return this.f2a.delegateTask(options);
  }

  /**
   * 发现网络中的 Agents
   */
  async discoverAgents(capability?: string): Promise<AgentInfo[]> {
    return this.f2a.discoverAgents(capability);
  }

  /**
   * 直接发送任务给特定 Peer
   */
  async sendTaskTo(
    peerId: string,
    taskType: string,
    description: string,
    parameters?: Record<string, unknown>
  ): Promise<Result<unknown>> {
    return this.f2a.sendTaskTo(peerId, taskType, description, parameters);
  }

  /**
   * 获取本节点信息
   */
  getAgentInfo(): AgentInfo {
    return this.f2a.agentInfo;
  }

  /**
   * 获取已连接的 Peers
   */
  getConnectedPeers(): AgentInfo[] {
    return this.f2a.getConnectedPeers();
  }

  /**
   * 注册新能力
   */
  registerCapability(
    capability: AgentCapability,
    handler: (params: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.f2a.registerCapability(capability, handler);
  }

  /**
   * 获取 PeerID
   */
  get peerId(): string {
    return this.f2a.peerId;
  }
}

// 默认导出
export default OpenClawF2AAdapter;
