/**
 * F2A 主类 - P2P 版本
 * 整合 P2P 网络、能力发现与任务委托
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { P2PNetwork } from './p2p-network.js';
import { IdentityManager } from './identity/index.js';
import { CapabilityManager } from './capability-manager.js';
import { SkillExchangeManager } from './skill-exchange-manager.js';
import { Logger } from '../utils/logger.js';
import { Middleware } from '../utils/middleware.js';
import { validateAgentCapability, validateTaskDelegateOptions } from '../utils/validation.js';
import { getErrorMessage } from '../utils/error-utils.js';
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
} from '../types/index.js';

// P1-1 修复：从 package.json 读取版本号
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');

let F2A_VERSION = '0.0.0';
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  F2A_VERSION = packageJson.version || '0.0.0';
} catch {
  // 如果无法读取 package.json，使用默认值
}
const PROTOCOL_VERSION = 'f2a/1.0';

export interface F2AInstance {
  readonly peerId: string;
  /** 获取 Agent 信息（延迟获取，确保 peerId 在 start() 后才有效） */
  readonly agentInfo: AgentInfo;
  start(): Promise<Result<void>>;
  stop(): Promise<void>;

  // 能力管理
  registerCapability(capability: AgentCapability, handler: (params: Record<string, unknown>) => Promise<unknown>): void;
  getCapabilities(): AgentCapability[];

  // 发现
  discoverAgents(capability?: string): Promise<AgentInfo[]>;
  getConnectedPeers(): AgentInfo[];
  getAllPeers(): AgentInfo[];

  // 任务委托
  delegateTask(options: TaskDelegateOptions): Promise<Result<TaskDelegateResult>>;

  // 直接通信
  sendTaskTo(peerId: string, taskType: string, description: string, parameters?: Record<string, unknown>): Promise<Result<unknown>>;

  // 中间件
  useMiddleware(middleware: Middleware): void;
  removeMiddleware(name: string): boolean;
  listMiddlewares(): string[];

  // DHT
  findPeerViaDHT(peerId: string): Promise<Result<string[]>>;
  getDHTPeerCount(): number;
  isDHTEnabled(): boolean;
}

export class F2A extends EventEmitter<F2AEvents> implements F2AInstance {
  private _agentInfo: AgentInfo;
  private p2pNetwork: P2PNetwork;
  private options: Required<F2AOptions>;
  private running: boolean = false;
  private registeredCapabilities: Map<string, RegisteredCapability> = new Map();
  private logger: Logger;
  private identityManager?: IdentityManager;
  private capabilityManager?: CapabilityManager;
  private skillExchangeManager?: SkillExchangeManager;

  private constructor(
    agentInfo: AgentInfo,
    p2pNetwork: P2PNetwork,
    options: Required<F2AOptions>,
    identityManager?: IdentityManager,
    capabilityManager?: CapabilityManager
  ) {
    super();
    this._agentInfo = agentInfo;
    this.p2pNetwork = p2pNetwork;
    this.options = options;
    this.identityManager = identityManager;
    this.capabilityManager = capabilityManager;
    
    // 初始化 logger，默认启用文件日志到 dataDir
    const dataDir = options.dataDir || join(homedir(), '.f2a');
    this.logger = new Logger({ 
      level: options.logLevel, 
      component: 'F2A',
      enableConsole: true,
      enableFile: true,
      filePath: join(dataDir, 'f2a.log')
    });

    this.bindEvents();
  }

  /**
   * 获取 Agent 信息
   * 使用 getter 延迟获取 peerId，避免在 start() 前读到空值
   */
  get agentInfo(): AgentInfo {
    // 返回一个代理对象，确保 peerId 始终从 p2pNetwork 获取最新值
    return {
      ...this._agentInfo,
      peerId: this.running ? this._agentInfo.peerId : ''
    };
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

    // 创建 IdentityManager 并加载身份
    const dataDir = mergedOptions.dataDir;
    const identityManager = new IdentityManager({ dataDir });
    const identityResult = await identityManager.loadOrCreate();
    
    if (!identityResult.success) {
      throw new Error(`Failed to load or create identity: ${JSON.stringify(identityResult.error)}`);
    }

    // 创建 P2P 网络
    const p2pNetwork = new P2PNetwork(agentInfo, mergedOptions.network);
    
    // 注入 IdentityManager（使用持久化的私钥）
    p2pNetwork.setIdentityManager(identityManager);

    // 创建 CapabilityManager（智能调度）
    const capabilityManager = new CapabilityManager({
      peerId: identityManager.getPeerIdString() || '',
      baseCapabilities: [],
    });

    // 创建实例
    const f2a = new F2A(agentInfo, p2pNetwork, mergedOptions, identityManager, capabilityManager);

    return f2a;
  }

  /**
   * 启动 F2A
   */
  async start(): Promise<Result<void>> {
    if (this.running) {
      return failureFromError('NETWORK_ALREADY_RUNNING', 'F2A already running');
    }

    this.logger.info('Starting agent', { displayName: this.agentInfo.displayName });

    // 启动 P2P 网络
    const result = await this.p2pNetwork.start();
    if (!result.success) {
      return result;
    }

    // 更新 agentInfo
    this._agentInfo.peerId = result.data.peerId;
    this._agentInfo.multiaddrs = result.data.addresses;

    this.running = true;

    this.emit('network:started', {
      peerId: result.data.peerId,
      listenAddresses: result.data.addresses
    });

    this.logger.info('Started', { peerId: result.data.peerId.slice(0, 16) });

    return { success: true, data: undefined };
  }

  /**
   * 停止 F2A
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.logger.info('Stopping');

    await this.p2pNetwork.stop();

    this.running = false;
    this.emit('network:stopped');

    this.logger.info('Stopped');
  }

  /**
   * 注册能力
   * P3.3 修复：返回 Result 类型，统一错误处理
   */
  registerCapability(
    capability: AgentCapability,
    handler: (params: Record<string, unknown>) => Promise<unknown>
  ): Result<void> {
    // 验证能力定义
    const validation = validateAgentCapability(capability);
    if (!validation.success) {
      this.logger.error('Invalid capability definition', {
        errors: validation.error.errors
      });
      return failureFromError(
        'INVALID_PARAMS',
        `Invalid capability: ${validation.error.errors.map(e => e.message).join(', ')}`
      );
    }

    this.registeredCapabilities.set(capability.name, {
      ...capability,
      handler
    });

    // 更新 agentInfo
    this.updateAgentCapabilities();

    this.logger.info('Registered capability', { name: capability.name });
    
    return success(undefined);
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
   * 获取所有已知的 Peers（包括已断开但已发现的）
   */
  getAllPeers(): AgentInfo[] {
    // 返回所有已知节点，包括还没有交换 agentInfo 的
    // 如果 agentInfo 不存在，创建一个基本的 AgentInfo
    return this.p2pNetwork.getAllPeers()
      .map(p => {
        if (p.agentInfo) {
          return p.agentInfo;
        }
        // 创建基本的 AgentInfo
        return {
          peerId: p.peerId,
          capabilities: [],
          multiaddrs: p.multiaddrs.map(m => m.toString()),
          lastSeen: p.lastSeen,
          agentType: 'custom' as const,
          version: '0.0.0',
          protocolVersion: '1.0.0'
        };
      });
  }

  /**
   * 委托任务给网络
   */
  async delegateTask(options: TaskDelegateOptions): Promise<Result<TaskDelegateResult>> {
    // 验证任务委托选项
    const validation = validateTaskDelegateOptions(options);
    if (!validation.success) {
      this.logger.error('Invalid task delegate options', {
        errors: validation.error.errors
      });
      return failureFromError(
        'INVALID_OPTIONS',
        `Invalid options: ${validation.error.errors.map(e => e.message).join(', ')}`
      );
    }

    // P3.1 修复：使用 randomUUID() 替代 Math.random()
    const taskId = `task-${randomUUID()}`;

    this.logger.info('Delegating task', {
      taskId,
      capability: options.capability,
      description: options.description.slice(0, 50)
    });

    // 可配置的重试选项
    const retryOptions = {
      maxRetries: options.retryOptions?.maxRetries ?? 3,
      retryDelayMs: options.retryOptions?.retryDelayMs ?? 1000,
      discoverTimeoutMs: options.retryOptions?.discoverTimeoutMs ?? 5000
    };

    // 1. 发现有能力执行任务的 Agents（带重试）
    let agents: AgentInfo[] = [];
    let lastError: string | undefined;
    
    for (let attempt = 0; attempt <= retryOptions.maxRetries; attempt++) {
      agents = await this.discoverAgents(options.capability);
      
      if (agents.length > 0) {
        break;
      }
      
      if (attempt < retryOptions.maxRetries) {
        this.logger.warn(`No agents found, retrying (${attempt + 1}/${retryOptions.maxRetries})`, {
          capability: options.capability
        });
        await new Promise(resolve => setTimeout(resolve, retryOptions.retryDelayMs));
      }
    }

    if (agents.length === 0) {
      this.logger.warn('No agents found with capability after retries', {
        capability: options.capability,
        retries: retryOptions.maxRetries
      });
      return failureFromError(
        'CAPABILITY_NOT_SUPPORTED',
        `No agent found with capability: ${options.capability} (after ${retryOptions.maxRetries} retries)`
      );
    }

    this.logger.info('Found agents with capability', {
      count: agents.length,
      capability: options.capability
    });

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
      // 串行发送，优先发送给最佳节点
      // 使用 CapabilityManager 进行智能调度（如果可用）
      let sortedAgents = agents;
      if (this.capabilityManager) {
        const bestPeerId = this.capabilityManager.selectBestPeerForCapability(options.capability);
        if (bestPeerId) {
          // 将最佳节点排在第一位
          sortedAgents = [
            agents.find(a => a.peerId === bestPeerId)!,
            ...agents.filter(a => a.peerId !== bestPeerId)
          ].filter(Boolean);
          this.logger.info('Using smart scheduling', {
            bestPeer: bestPeerId.slice(0, 16),
            capability: options.capability
          });
        }
      }
      
      for (const agent of sortedAgents) {
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
   * 注册中间件
   */
  useMiddleware(middleware: Middleware): void {
    this.p2pNetwork.useMiddleware(middleware);
  }

  /**
   * 移除中间件
   */
  removeMiddleware(name: string): boolean {
    return this.p2pNetwork.removeMiddleware(name);
  }

  /**
   * 获取已注册中间件列表
   */
  listMiddlewares(): string[] {
    return this.p2pNetwork.listMiddlewares();
  }

  /**
   * 通过 DHT 查找节点
   */
  async findPeerViaDHT(peerId: string): Promise<Result<string[]>> {
    return this.p2pNetwork.findPeerViaDHT(peerId);
  }

  /**
   * 获取 DHT 路由表大小
   */
  getDHTPeerCount(): number {
    return this.p2pNetwork.getDHTPeerCount();
  }

  /**
   * 检查 DHT 是否启用
   */
  isDHTEnabled(): boolean {
    return this.p2pNetwork.isDHTEnabled();
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
    this.logger.info('Received task request', {
      fromPeerId: fromPeerId.slice(0, 16),
      taskType: request.taskType,
      taskId: request.taskId
    });

    // 查找对应的能力处理器
    const capability = this.registeredCapabilities.get(request.taskType);

    if (!capability) {
      this.logger.warn('Capability not supported, rejecting task', {
        taskType: request.taskType,
        fromPeerId: fromPeerId.slice(0, 16)
      });
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

    // 触发事件，让上层（OpenClaw）可以拦截或监控
    this.emit('task:request', request);

    // 如果有注册 handler，自动执行任务并发送响应
    if (capability.handler) {
      try {
        const result = await capability.handler(request.parameters || {});
        await this.p2pNetwork.sendTaskResponse(
          fromPeerId,
          request.taskId,
          'success',
          result
        );
        this.logger.info('Task executed successfully', {
          taskId: request.taskId,
          fromPeerId: fromPeerId.slice(0, 16)
        });
      } catch (error) {
        this.logger.error('Task execution failed', {
          taskId: request.taskId,
          fromPeerId: fromPeerId.slice(0, 16),
          error: getErrorMessage(error)
        });
        await this.p2pNetwork.sendTaskResponse(
          fromPeerId,
          request.taskId,
          'error',
          undefined,
          getErrorMessage(error)
        );
      }
    }
    // 如果没有 handler，依赖上层通过 respondToTask 手动响应
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
    this._agentInfo.capabilities = this.getCapabilities();
  }
}
