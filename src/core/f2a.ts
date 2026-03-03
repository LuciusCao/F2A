/**
 * F2A 主类 - P2P 版本
 * 整合 P2P 网络、能力发现与任务委托
 */

import { EventEmitter } from 'eventemitter3';
import { P2PNetwork } from './p2p-network';
import {
  F2AOptions,
  F2AEvents,
  AgentInfo,
  AgentCapability,
  Result,
  TaskDelegateOptions,
  TaskDelegateResult,
  TaskRequestEvent,
  TaskResponseEvent,
  PeerDiscoveredEvent,
  PeerConnectedEvent,
  PeerDisconnectedEvent,
  RegisteredCapability,
  NetworkStartedEvent,
  success,
  failureFromError
} from '../types';

// 版本号
const F2A_VERSION = '1.0.0';
const PROTOCOL_VERSION = 'f2a/1.0';

export interface F2AInstance {
  readonly peerId: string;
  readonly agentInfo: AgentInfo;
  start(): Promise<Result<void>>;
  stop(): Promise<void>;
  
  // 能力管理
  registerCapability(capability: AgentCapability, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  getCapabilities(): AgentCapability[];
  
  // 发现
  discoverAgents(capability?: string): Promise<AgentInfo[]>;
  getConnectedPeers(): AgentInfo[];
  
  // 任务委托
  delegateTask(options: TaskDelegateOptions): Promise<Result<TaskDelegateResult>>;
  
  // 直接通信
  sendTaskTo(peerId: string, taskType: string, description: string, parameters?: Record<string, unknown>): Promise<Result<unknown>>;
}

export class F2A extends EventEmitter<F2AEvents> implements F2AInstance {
  public readonly agentInfo: AgentInfo;
  private p2pNetwork: P2PNetwork;
  private options: Required<F2AOptions>;
  private running: boolean = false;
  private registeredCapabilities: Map<string, RegisteredCapability> = new Map();

  private constructor(
    agentInfo: AgentInfo,
    p2pNetwork: P2PNetwork,
    options: Required<F2AOptions>
  ) {
    super();
    this.agentInfo = agentInfo;
    this.p2pNetwork = p2pNetwork;
    this.options = options;

    this.bindEvents();
  }

  /**
   * 工厂方法：创建 F2A 实例
   */
  static async create(options: F2AOptions = {}): Promise<F2A> {
    // 默认配置
    const mergedOptions: Required<F2AOptions> = {
      displayName: options.displayName || 'F2A Agent',
      agentType: options.agentType || 'openclaw',
      network: {
        listenPort: 0,
        enableMDNS: true,
        enableDHT: false,
        ...options.network
      },
      security: {
        level: 'medium',
        requireConfirmation: true,
        verifySignatures: true,
        ...options.security
      },
      logLevel: options.logLevel || 'INFO',
      dataDir: options.dataDir || './f2a-data'
    };

    // 创建 AgentInfo
    const agentInfo: AgentInfo = {
      peerId: '', // 启动后由 P2P 网络填充
      displayName: mergedOptions.displayName,
      agentType: mergedOptions.agentType as AgentInfo['agentType'],
      version: F2A_VERSION,
      capabilities: [],
      protocolVersion: PROTOCOL_VERSION,
      lastSeen: Date.now(),
      multiaddrs: []
    };

    // 创建 P2P 网络
    const p2pNetwork = new P2PNetwork(agentInfo, mergedOptions.network);

    // 创建实例
    const f2a = new F2A(agentInfo, p2pNetwork, mergedOptions);

    return f2a;
  }

  /**
   * 启动 F2A
   */
  async start(): Promise<Result<void>> {
    if (this.running) {
      return failureFromError('NETWORK_ALREADY_RUNNING', 'F2A already running');
    }

    console.log(`[F2A] Starting ${this.agentInfo.displayName}...`);

    // 启动 P2P 网络
    const result = await this.p2pNetwork.start();
    if (!result.success) {
      return result;
    }

    // 更新 agentInfo
    this.agentInfo.peerId = result.data.peerId;
    this.agentInfo.multiaddrs = result.data.addresses;

    this.running = true;
    
    this.emit('network:started', {
      peerId: result.data.peerId,
      listenAddresses: result.data.addresses
    });

    console.log(`[F2A] Started with peerId: ${result.data.peerId.slice(0, 16)}...`);

    return { success: true, data: undefined };
  }

  /**
   * 停止 F2A
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('[F2A] Stopping...');

    await this.p2pNetwork.stop();

    this.running = false;
    this.emit('network:stopped');

    console.log('[F2A] Stopped');
  }

  /**
   * 注册能力
   */
  registerCapability(
    capability: AgentCapability,
    handler: (params: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.registeredCapabilities.set(capability.name, {
      ...capability,
      handler
    });

    // 更新 agentInfo
    this.updateAgentCapabilities();

    console.log(`[F2A] Registered capability: ${capability.name}`);
  }

  /**
   * 获取已注册的能力
   */
  getCapabilities(): AgentCapability[] {
    return Array.from(this.registeredCapabilities.values()).map(c => ({
      name: c.name,
      description: c.description,
      tools: c.tools,
      parameters: c.parameters
    }));
  }

  /**
   * 发现网络中的 Agents
   */
  async discoverAgents(capability?: string): Promise<AgentInfo[]> {
    return this.p2pNetwork.discoverAgents(capability);
  }

  /**
   * 获取已连接的 Peers
   */
  getConnectedPeers(): AgentInfo[] {
    return this.p2pNetwork.getConnectedPeers()
      .filter(p => p.agentInfo)
      .map(p => p.agentInfo!);
  }

  /**
   * 委托任务给网络
   */
  async delegateTask(options: TaskDelegateOptions): Promise<Result<TaskDelegateResult>> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    console.log(`[F2A] Delegating task: ${options.description.slice(0, 50)}...`);

    // 1. 发现有能力执行任务的 Agents
    const agents = await this.discoverAgents(options.capability);
    
    if (agents.length === 0) {
      return failureFromError(
        'CAPABILITY_NOT_SUPPORTED',
        `No agent found with capability: ${options.capability}`
      );
    }

    console.log(`[F2A] Found ${agents.length} agents with capability: ${options.capability}`);

    // 2. 发送任务请求
    const timeout = options.timeout || 30000;
    const results: TaskDelegateResult['results'] = [];

    if (options.parallel) {
      // 并行发送给多个 Agents
      const minResponses = options.minResponses || 1;
      
      const promises = agents.map(async (agent) => {
        const startTime = Date.now();
        const result = await this.p2pNetwork.sendTaskRequest(
          agent.peerId,
          options.capability,
          options.description,
          options.parameters,
          timeout
        );
        const latency = Date.now() - startTime;

        return {
          peerId: agent.peerId,
          status: result.success ? 'success' as const : 'error' as const,
          result: result.success ? result.data : undefined,
          error: result.success ? undefined : (result.error?.message || String(result.error)),
          latency
        };
      });

      // 等待至少 minResponses 个响应
      const settled = await Promise.allSettled(promises);
      
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
        }
      }

      // 检查是否达到最小响应数
      const successCount = results.filter(r => r.status === 'success').length;
      if (successCount < minResponses) {
        return failureFromError(
          'TASK_FAILED',
          `Only ${successCount} successful responses, required ${minResponses}`
        );
      }
    } else {
      // 串行发送，取第一个成功的
      for (const agent of agents) {
        const startTime = Date.now();
        const result = await this.p2pNetwork.sendTaskRequest(
          agent.peerId,
          options.capability,
          options.description,
          options.parameters,
          timeout
        );
        const latency = Date.now() - startTime;

        results.push({
          peerId: agent.peerId,
          status: result.success ? 'success' : 'error',
          result: result.success ? result.data : undefined,
          error: result.success ? undefined : (result.error?.message || String(result.error)),
          latency
        });

        if (result.success) {
          break; // 第一个成功就停止
        }
      }

      // 检查是否有成功结果
      if (!results.some(r => r.status === 'success')) {
        return failureFromError('TASK_FAILED', 'All agents failed to execute the task');
      }
    }

    return success({ taskId, results });
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
    return this.p2pNetwork.sendTaskRequest(
      peerId,
      taskType,
      description,
      parameters,
      30000
    );
  }

  /**
   * 获取 PeerID
   */
  get peerId(): string {
    return this.agentInfo.peerId;
  }

  /**
   * 绑定内部事件
   */
  private bindEvents(): void {
    // 转发 P2P 网络事件
    this.p2pNetwork.on('peer:discovered', (event) => {
      this.emit('peer:discovered', event);
    });

    this.p2pNetwork.on('peer:connected', (event) => {
      this.emit('peer:connected', event);
    });

    this.p2pNetwork.on('peer:disconnected', (event) => {
      this.emit('peer:disconnected', event);
    });

    // 处理收到的任务请求
    this.p2pNetwork.on('message:received', async (message, peerId) => {
      if (message.type === 'TASK_REQUEST') {
        await this.handleTaskRequest(message.payload as TaskRequestEvent, peerId);
      }
    });

    this.p2pNetwork.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * 处理收到的任务请求
   */
  private async handleTaskRequest(
    request: TaskRequestEvent,
    fromPeerId: string
  ): Promise<void> {
    console.log(`[F2A] Received task request from ${fromPeerId.slice(0, 16)}...: ${request.taskType}`);

    // 查找对应的能力处理器
    const capability = this.registeredCapabilities.get(request.taskType);
    
    if (!capability) {
      // 拒绝任务
      await this.p2pNetwork.sendTaskResponse(
        fromPeerId,
        request.taskId,
        'rejected',
        undefined,
        `Capability not supported: ${request.taskType}`
      );
      return;
    }

    // 触发事件，让上层（OpenClaw）处理
    this.emit('task:request', request);

    // 注意：实际的任务执行由 OpenClaw 完成，然后通过 sendTaskResponse 返回结果
    // 这里只是触发事件，不直接执行
  }

  /**
   * 发送任务响应（供 OpenClaw 调用）
   */
  async respondToTask(
    peerId: string,
    taskId: string,
    status: 'success' | 'error' | 'rejected',
    result?: unknown,
    error?: string
  ): Promise<Result<void>> {
    const responseResult = await this.p2pNetwork.sendTaskResponse(
      peerId,
      taskId,
      status,
      result,
      error
    );

    if (responseResult.success) {
      this.emit('task:response', {
        taskId,
        from: this.peerId,
        status,
        result,
        error
      });
    }

    return responseResult;
  }

  /**
   * 更新 AgentInfo 中的能力列表
   */
  private updateAgentCapabilities(): void {
    this.agentInfo.capabilities = this.getCapabilities();
  }
}
