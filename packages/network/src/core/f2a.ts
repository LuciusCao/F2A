/**
 * F2A 主类 - P2P 版本
 * 整合 P2P 网络、能力发现与任务委托
 * 
 * Phase 1: 集成 Node/Agent Identity 系统
 * - 使用 NodeIdentityManager 替代旧的 IdentityManager
 * - 使用 IdentityDelegator 创建和管理 Agent 身份
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { P2PNetwork } from './p2p-network.js';
import { IdentityManager } from './identity/index.js';
import { NodeIdentityManager } from './identity/node-identity.js';
import { AgentIdentityManager } from './identity/agent-identity.js';
import { IdentityDelegator } from './identity/delegator.js';
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
  MessageEvent,
  StructuredMessagePayload,
  MESSAGE_TOPICS,
  PeerDiscoveredEvent,
  PeerConnectedEvent,
  PeerDisconnectedEvent,
  RegisteredCapability,
  NetworkStartedEvent,
  success,
  failureFromError
} from '../types/index.js';
import type { ExportedAgentIdentity, AgentIdentity } from './identity/types.js';

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
  
  // Phase 1: 新的身份系统
  /** @deprecated 使用 nodeIdentityManager 替代 */
  private identityManager?: IdentityManager;
  private nodeIdentityManager?: NodeIdentityManager;
  private agentIdentityManager?: AgentIdentityManager;
  private identityDelegator?: IdentityDelegator;
  
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
   * 
   * Phase 1: 使用 Node/Agent Identity 系统
   * - NodeIdentityManager 管理物理节点身份
   * - IdentityDelegator 创建和管理 Agent 身份
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
      dataDir: options.dataDir || './f2a-data',
      messageHandlerUrl: options.messageHandlerUrl || ''
    };

    // Phase 1: 创建 NodeIdentityManager 并加载节点身份
    const dataDir = mergedOptions.dataDir;
    const nodeIdentityManager = new NodeIdentityManager({ dataDir });
    const nodeIdentityResult = await nodeIdentityManager.loadOrCreate();
    
    if (!nodeIdentityResult.success) {
      throw new Error(`Failed to load or create node identity: ${JSON.stringify(nodeIdentityResult.error)}`);
    }

    const nodeId = nodeIdentityManager.getNodeId();
    const nodePeerId = nodeIdentityManager.getPeerIdString();
    
    if (!nodeId || !nodePeerId) {
      throw new Error('Failed to get node ID or peer ID');
    }

    // Phase 1: 创建 IdentityDelegator（传入 dataDir）
    const identityDelegator = new IdentityDelegator(nodeIdentityManager, dataDir);

    // Phase 1: 创建或加载 Agent 身份
    const agentIdentityManager = new AgentIdentityManager(dataDir);
    let agentIdentity: ExportedAgentIdentity;
    
    // 尝试加载已有的 Agent 身份
    const loadResult = await agentIdentityManager.loadAgentIdentity();
    
    if (loadResult.success) {
      agentIdentity = loadResult.data;
    } else {
      // 创建新的 Agent 身份
      // Agent 名称只能包含字母、数字、下划线、连字符和冒号
      // 将 displayName 转换为有效的 Agent 名称
      let agentName = mergedOptions.displayName
        .replace(/[^a-zA-Z0-9_\-:]/g, '-')  // 替换无效字符为连字符
        .replace(/-+/g, '-')                 // 合并连续连字符
        .replace(/^-|-$/g, '')               // 移除首尾连字符
        .slice(0, 64);                       // 限制长度
      
      // 如果名称为空，使用默认名称
      if (!agentName) {
        agentName = `Agent-${nodeId.slice(0, 8)}`;
      }
      
      const createResult = await identityDelegator.createAgent({
        name: agentName,
        capabilities: []
      });
      
      if (!createResult.success) {
        throw new Error(`Failed to create agent identity: ${JSON.stringify(createResult.error)}`);
      }
      
      agentIdentity = {
        id: createResult.data.agentIdentity.id,
        name: createResult.data.agentIdentity.name,
        capabilities: createResult.data.agentIdentity.capabilities,
        nodeId: createResult.data.agentIdentity.nodeId,
        publicKey: createResult.data.agentIdentity.publicKey,
        signature: createResult.data.agentIdentity.signature,
        createdAt: createResult.data.agentIdentity.createdAt,
        expiresAt: createResult.data.agentIdentity.expiresAt,
        privateKey: createResult.data.agentPrivateKey
      };
      
      // IdentityDelegator.createAgent 会保存到文件，我们需要重新加载
      // 确保 agentIdentityManager 实例持有正确的身份
      const reloadResult = await agentIdentityManager.loadAgentIdentity();
      if (!reloadResult.success) {
        // 如果重新加载失败，记录警告但继续
        console.warn('Warning: Failed to reload agent identity after creation');
      }
    }

    // 创建 AgentInfo
    const agentInfo: AgentInfo = {
      peerId: '', // 启动后由 P2P 网络填充
      displayName: mergedOptions.displayName,  // 保留原始 displayName
      agentType: mergedOptions.agentType as AgentInfo['agentType'],
      version: F2A_VERSION,
      capabilities: [],
      protocolVersion: PROTOCOL_VERSION,
      lastSeen: Date.now(),
      multiaddrs: [],
      // Phase 1: 添加 Agent ID
      agentId: agentIdentity.id,
      // Phase 1 修复：添加加密公钥用于 E2EE
      encryptionPublicKey: agentIdentity.publicKey
    };

    // 创建 P2P 网络
    const p2pNetwork = new P2PNetwork(agentInfo, mergedOptions.network);
    
    // 注入 IdentityManager（使用 NodeIdentityManager 作为基础身份管理器）
    // NodeIdentityManager 继承自 IdentityManager，可以直接使用
    p2pNetwork.setIdentityManager(nodeIdentityManager);

    // 创建 CapabilityManager（智能调度）
    const capabilityManager = new CapabilityManager({
      peerId: nodePeerId,
      baseCapabilities: [],
    });

    // 创建实例
    const f2a = new F2A(agentInfo, p2pNetwork, mergedOptions, nodeIdentityManager, capabilityManager);
    
    // Phase 1: 设置新的身份管理组件
    f2a.nodeIdentityManager = nodeIdentityManager;
    f2a.agentIdentityManager = agentIdentityManager;
    f2a.identityDelegator = identityDelegator;

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
   * 发送自由消息给特定 Peer（Agent 协议层）
   * Agent 之间的自然语言通信
   */
  async sendMessageToPeer(
    peerId: string,
    content: string | Record<string, unknown>,
    topic?: string
  ): Promise<Result<void>> {
    return this.p2pNetwork.sendFreeMessage(peerId, content, topic);
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

    // 处理收到的 Agent 协议层消息
    this.p2pNetwork.on('message:received', async (message, peerId) => {
      if (message.type === 'MESSAGE') {
        const payload = message.payload as StructuredMessagePayload;
        
        // 根据 topic 分发处理
        if (payload.topic === MESSAGE_TOPICS.TASK_REQUEST) {
          // 任务请求
          const content = payload.content as {
            taskId: string;
            taskType: string;
            description: string;
            parameters?: Record<string, unknown>;
          };
          await this.handleTaskRequest(
            content.taskId,
            content.taskType,
            content.description,
            content.parameters,
            peerId
          );
        } else {
          // 其他消息：发出事件供上层处理
          this.emit('peer:message', {
            messageId: message.id,
            from: peerId,
            content: payload.content,
            topic: payload.topic,
            replyTo: payload.replyTo
          });
        }
      }
    });

    this.p2pNetwork.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * 处理收到的任务请求（MESSAGE + topic='task.request'）
   */
  private async handleTaskRequest(
    taskId: string,
    taskType: string,
    description: string,
    parameters: Record<string, unknown> | undefined,
    fromPeerId: string
  ): Promise<void> {
    this.logger.info('Received task request', {
      fromPeerId: fromPeerId.slice(0, 16),
      taskType,
      taskId
    });

    // 查找对应的能力处理器
    const capability = this.registeredCapabilities.get(taskType);

    if (!capability) {
      this.logger.warn('Capability not supported, rejecting task', {
        taskType,
        fromPeerId: fromPeerId.slice(0, 16)
      });
      // 拒绝任务
      await this.p2pNetwork.sendTaskResponse(
        fromPeerId,
        taskId,
        'rejected',
        undefined,
        `Capability not supported: ${taskType}`
      );
      return;
    }

    // 如果有注册 handler，自动执行任务并发送响应
    if (capability.handler) {
      try {
        const result = await capability.handler(parameters || {});
        await this.p2pNetwork.sendTaskResponse(
          fromPeerId,
          taskId,
          'success',
          result
        );
        this.logger.info('Task executed successfully', {
          taskId,
          fromPeerId: fromPeerId.slice(0, 16)
        });
      } catch (error) {
        this.logger.error('Task execution failed', {
          taskId,
          fromPeerId: fromPeerId.slice(0, 16),
          error: getErrorMessage(error)
        });
        await this.p2pNetwork.sendTaskResponse(
          fromPeerId,
          taskId,
          'error',
          undefined,
          getErrorMessage(error)
        );
      }
    }
  }

  /**
   * 处理收到的自由消息（MESSAGE + topic='chat' 或其他）
   * 如果配置了 messageHandlerUrl，调用该 URL 并发送响应
   */
  private async handleFreeMessage(
    fromPeerId: string,
    messageId: string,
    content: string | Record<string, unknown>,
    topic?: string
  ): Promise<void> {
    this.logger.info('Received free message', {
      from: fromPeerId.slice(0, 16),
      topic,
      contentLength: typeof content === 'string' ? content.length : 'object'
    });

    // 发出事件供上层监听
    this.emit('peer:message', {
      messageId,
      from: fromPeerId,
      content,
      topic
    });

    // 如果配置了 messageHandlerUrl，调用它
    const handlerUrl = this.options.messageHandlerUrl;
    if (handlerUrl) {
      try {
        const response = await fetch(handlerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromPeerId,
            content,
            topic,
            messageId
          })
        });

        if (response.ok) {
          const result = await response.json() as { response?: string; reply?: string };
          const replyContent = result.response || result.reply;
          
          if (replyContent) {
            // 发送响应回发送者
            await this.p2pNetwork.sendFreeMessage(fromPeerId, replyContent, topic);
            this.logger.info('Sent message response', {
              to: fromPeerId.slice(0, 16),
              content: replyContent.slice(0, 50)
            });
          }
        } else {
          this.logger.warn('Message handler returned error', {
            status: response.status,
            url: handlerUrl
          });
        }
      } catch (error) {
        this.logger.error('Failed to call message handler', {
          error: getErrorMessage(error),
          url: handlerUrl
        });
      }
    }
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
      // 事件已废弃，不再发出
    }

    return responseResult;
  }

  /**
   * 更新 AgentInfo 中的能力列表
   */
  private updateAgentCapabilities(): void {
    this._agentInfo.capabilities = this.getCapabilities();
  }

  // ========================================================================
  // Phase 1: Node/Agent Identity 方法
  // ========================================================================

  /**
   * 获取 Node ID
   * 
   * Node ID 是物理节点的持久化标识，存储在 ~/.f2a/node-identity.json
   */
  getNodeId(): string | null {
    return this.nodeIdentityManager?.getNodeId() || null;
  }

  /**
   * 简单签名方法（RFC 003: AgentId 签发）
   * 
   * 使用 E2EE 公钥的一部分作为签名标识
   * 后续可升级为私钥签名
   */
  signData(data: string): string {
    // 简化实现：使用 E2EE 公钥前缀作为签名标识
    // TODO: 升级为私钥签名
    const publicKey = this._agentInfo.encryptionPublicKey || '';
    const signaturePrefix = publicKey.slice(0, 32);
    const dataHash = Buffer.from(data).toString('base64').slice(0, 32);
    return `${signaturePrefix}:${dataHash}`;
  }

  /**
   * 获取 Agent ID
   * 
   * Agent ID 是 Agent 的独立标识，由 Node 签发
   */
  getAgentId(): string | null {
    return this.agentIdentityManager?.getAgentId() || null;
  }

  /**
   * 获取 Agent 名称
   */
  getAgentName(): string | null {
    return this.agentIdentityManager?.getAgentName() || null;
  }

  /**
   * 获取 Agent Identity（不包含私钥）
   */
  getAgentIdentity(): AgentIdentity | null {
    return this.agentIdentityManager?.getAgentIdentity() || null;
  }

  /**
   * 导出 Node Identity（用于备份/迁移）
   * 
   * WARNING: 返回敏感的私钥材料
   */
  async exportNodeIdentity(): Promise<Result<{ nodeId: string; peerId: string; privateKey: string }>> {
    if (!this.nodeIdentityManager) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Node identity manager not initialized');
    }

    try {
      const identity = this.nodeIdentityManager.exportIdentity();
      return success({
        nodeId: this.nodeIdentityManager.getNodeId() || '',
        peerId: identity.peerId,
        privateKey: identity.privateKey
      });
    } catch (error) {
      return failureFromError('EXPORT_FAILED', 'Failed to export node identity', error as Error);
    }
  }

  /**
   * 导出 Agent Identity（用于备份/迁移）
   * 
   * WARNING: 返回敏感的私钥材料
   */
  async exportAgentIdentity(): Promise<Result<ExportedAgentIdentity>> {
    if (!this.agentIdentityManager) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Agent identity manager not initialized');
    }

    try {
      const identity = this.agentIdentityManager.exportAgentIdentity();
      if (!identity) {
        return failureFromError('IDENTITY_NOT_FOUND', 'No agent identity found');
      }
      return success(identity);
    } catch (error) {
      return failureFromError('EXPORT_FAILED', 'Failed to export agent identity', error as Error);
    }
  }

  /**
   * 检查 Agent 身份是否过期
   */
  isAgentExpired(): boolean {
    return this.agentIdentityManager?.isExpired() || false;
  }

  /**
   * 续期 Agent 身份
   * 
   * @param newExpiresAt 新的过期时间
   */
  async renewAgentIdentity(newExpiresAt: Date): Promise<Result<AgentIdentity>> {
    if (!this.identityDelegator || !this.agentIdentityManager) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Identity system not initialized');
    }

    const currentIdentity = this.agentIdentityManager.getAgentIdentity();
    if (!currentIdentity) {
      return failureFromError('IDENTITY_NOT_FOUND', 'No current agent identity found');
    }

    const privateKey = this.nodeIdentityManager?.getPrivateKey();
    if (!privateKey) {
      return failureFromError('NODE_KEY_NOT_AVAILABLE', 'Node private key not available');
    }

    const signWithNodeKey = async (data: Uint8Array): Promise<Uint8Array> => {
      return await privateKey.sign(data);
    };

    return this.identityDelegator.renewAgent(currentIdentity, newExpiresAt, signWithNodeKey);
  }
}
