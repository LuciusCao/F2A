/**
 * F2A 组件注册器
 * 
 * 负责管理所有 F2A 组件的懒加载和生命周期。
 * 从 connector.ts 拆分（Issue #106），遵循单一职责原则。
 * 
 * @module F2AComponentRegistry
 */

import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import type { 
  ApiLogger, 
  F2APluginConfig, 
  F2ANodeConfig, 
  OpenClawPluginApi,
  OpenClawConfig,
  F2ANetworkClientLike,
  ReputationSystemLike,
  NodeManagerLike,
  TaskQueueLike,
  AnnouncementQueueLike,
  ReviewCommitteeLike,
  ContactManagerLike,
  HandshakeProtocolLike,
  F2APublicInterface,
} from './types.js';
import { INTERNAL_REPUTATION_CONFIG } from './types.js';
import { F2ANodeManager } from './node-manager.js';
import { F2ANetworkClient } from './network-client.js';
import { ReputationSystem, ReputationManagerAdapter } from './reputation.js';
import { CapabilityDetector } from './capability-detector.js';
import { TaskQueue } from './task-queue.js';
import { AnnouncementQueue } from './announcement-queue.js';
import { ReviewCommittee, F2A } from '@f2a/network';
import { ContactManager } from './contact-manager.js';
import { HandshakeProtocol } from './handshake-protocol.js';
import { isPathSafe } from './connector-helpers.js';

/**
 * 组件注册器配置
 */
export interface ComponentRegistryConfig {
  /** 插件配置 */
  pluginConfig: F2APluginConfig;
  /** 节点配置 */
  nodeConfig: F2ANodeConfig;
  /** OpenClaw API */
  api?: OpenClawPluginApi;
  /** Logger */
  logger?: ApiLogger;
}

/**
 * 初始化标志（防止重复初始化）
 */
export interface InitializingFlags {
  nodeManager: boolean;
  taskQueue: boolean;
  contactManager: boolean;
  handshakeProtocol: boolean;
}

/**
 * F2A 组件注册器
 * 
 * 管理所有组件的懒加载：
 * - 核心组件：nodeManager, networkClient, taskQueue, announcementQueue
 * - 信誉系统：reputationSystem, reviewCommittee
 * - 能力检测：capabilityDetector
 * - 通讯录：contactManager, handshakeProtocol
 */
export class F2AComponentRegistry {
  // ========== 配置和依赖 ==========
  
  private config: F2APluginConfig;
  private nodeConfig: F2ANodeConfig;
  private api?: OpenClawPluginApi;
  private logger?: ApiLogger;

  // ========== 组件实例（懒加载） ==========

  private _nodeManager?: F2ANodeManager;
  private _networkClient?: F2ANetworkClient;
  private _reputationSystem?: ReputationSystem;
  private _capabilityDetector?: CapabilityDetector;
  private _taskQueue?: TaskQueue;
  private _announcementQueue?: AnnouncementQueue;
  private _reviewCommittee?: ReviewCommittee;
  private _contactManager?: ContactManager;
  private _handshakeProtocol?: HandshakeProtocol;

  // ========== 初始化标志 ==========

  private initializingFlags: InitializingFlags = {
    nodeManager: false,
    taskQueue: false,
    contactManager: false,
    handshakeProtocol: false,
  };

  // ========== F2A 实例引用 ==========

  /** F2A 实例（由外部设置，用于获取 peerId 等） */
  private _f2a?: F2A;

  constructor(config: ComponentRegistryConfig) {
    this.config = config.pluginConfig;
    this.nodeConfig = config.nodeConfig;
    this.api = config.api;
    this.logger = config.logger;
  }

  // ========== 配置访问 ==========

  /**
   * 获取插件配置
   */
  getConfig(): F2APluginConfig {
    return this.config;
  }

  /**
   * 获取 OpenClaw API
   */
  getApi(): OpenClawPluginApi | undefined {
    return this.api;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<F2APluginConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ========== 数据目录 ==========

  /**
   * 获取默认的 F2A 数据目录
   * 
   * 优先级：
   * 1. config.dataDir（用户显式配置）
   * 2. workspace/.f2a（agent workspace 目录）
   * 3. ~/.f2a（兼容旧版本）
   */
  getDefaultDataDir(): string {
    // 优先使用用户配置的 dataDir
    if (this.config?.dataDir) {
      return this.config.dataDir;
    }

    // 默认：使用 agent workspace 目录
    const workspace = (this.api?.config as OpenClawConfig)?.agents?.defaults?.workspace;

    // 验证 workspace 路径安全性
    if (isPathSafe(workspace)) {
      return join(workspace, '.f2a');
    }

    // 兼容旧版本
    return join(homedir(), '.f2a');
  }

  // ========== 核心组件 ==========

  /**
   * 获取节点管理器（懒加载）
   */
  get nodeManager(): F2ANodeManager {
    if (!this._nodeManager && !this.initializingFlags.nodeManager) {
      this.initializingFlags.nodeManager = true;
      try {
        this._nodeManager = new F2ANodeManager(this.nodeConfig, this.logger);
      } finally {
        this.initializingFlags.nodeManager = false;
      }
    }
    // P1-4 修复：添加 undefined 检查替代非空断言
    if (!this._nodeManager) {
      throw new Error('F2ANodeManager 初始化失败');
    }
    return this._nodeManager;
  }

  /**
   * 获取网络客户端（懒加载）
   */
  get networkClient(): F2ANetworkClient {
    if (!this._networkClient) {
      this._networkClient = new F2ANetworkClient(this.nodeConfig, this.logger);
    }
    return this._networkClient;
  }

  /**
   * 获取任务队列（懒加载）
   */
  get taskQueue(): TaskQueue {
    if (!this._taskQueue && !this.initializingFlags.taskQueue) {
      this.initializingFlags.taskQueue = true;
      try {
        const dataDir = this.getDefaultDataDir();
        this._taskQueue = new TaskQueue({
          maxSize: this.config.maxQueuedTasks || 100,
          maxAgeMs: 24 * 60 * 60 * 1000, // 24小时
          persistDir: dataDir,
          persistEnabled: true,
          logger: this.logger
        });
        this.logger?.info('[F2A] TaskQueue 已初始化（懒加载）');
      } finally {
        this.initializingFlags.taskQueue = false;
      }
    }
    // P1-4 修复：添加 undefined 检查替代非空断言
    if (!this._taskQueue) {
      throw new Error('TaskQueue 初始化失败');
    }
    return this._taskQueue;
  }

  /**
   * 获取公告队列（懒加载）
   */
  get announcementQueue(): AnnouncementQueue {
    if (!this._announcementQueue) {
      this._announcementQueue = new AnnouncementQueue({
        maxSize: 50,
        maxAgeMs: 30 * 60 * 1000, // 30分钟
        logger: this.logger
      });
    }
    return this._announcementQueue;
  }

  // ========== 信誉系统 ==========

  /**
   * 获取信誉系统（懒加载）
   */
  get reputationSystem(): ReputationSystem {
    if (!this._reputationSystem) {
      this._reputationSystem = new ReputationSystem(
        {
          enabled: INTERNAL_REPUTATION_CONFIG.enabled,
          initialScore: INTERNAL_REPUTATION_CONFIG.initialScore,
          minScoreForService: INTERNAL_REPUTATION_CONFIG.minScoreForService,
          decayRate: INTERNAL_REPUTATION_CONFIG.decayRate,
        },
        this.getDefaultDataDir()
      );
    }
    return this._reputationSystem;
  }

  /**
   * 获取评审委员会（懒加载）
   */
  get reviewCommittee(): ReviewCommittee {
    if (!this._reviewCommittee) {
      const reputationAdapter = new ReputationManagerAdapter(this.reputationSystem);
      this._reviewCommittee = new ReviewCommittee(reputationAdapter, {
        minReviewers: 1,
        maxReviewers: 5,
        minReputation: INTERNAL_REPUTATION_CONFIG.minScoreForReview,
        reviewTimeout: 5 * 60 * 1000 // 5 分钟
      });
    }
    return this._reviewCommittee;
  }

  // ========== 能力检测 ==========

  /**
   * 获取能力检测器（懒加载）
   */
  get capabilityDetector(): CapabilityDetector {
    if (!this._capabilityDetector) {
      this._capabilityDetector = new CapabilityDetector();
    }
    return this._capabilityDetector;
  }

  // ========== 通讯录和握手 ==========

  /**
   * 获取联系人管理器（延迟初始化）
   */
  get contactManager(): ContactManager {
    if (!this._contactManager && !this.initializingFlags.contactManager) {
      this.initializingFlags.contactManager = true;
      try {
        const dataDir = this.getDefaultDataDir();
        this._contactManager = new ContactManager(dataDir, this.logger);
        this.logger?.info('[F2A] ContactManager 已初始化');
      } finally {
        this.initializingFlags.contactManager = false;
      }
    }
    // P1-4 修复：添加 undefined 检查替代非空断言
    if (!this._contactManager) {
      throw new Error('ContactManager 初始化失败');
    }
    return this._contactManager;
  }

  /**
   * 获取握手协议处理器（延迟初始化）
   * 依赖 F2A 实例和 ContactManager
   */
  get handshakeProtocol(): HandshakeProtocol {
    if (!this._handshakeProtocol && !this.initializingFlags.handshakeProtocol && this._f2a && this._contactManager) {
      this.initializingFlags.handshakeProtocol = true;
      try {
        this._handshakeProtocol = new HandshakeProtocol(
          this._f2a,
          this._contactManager,
          this.logger,
          this.config.handshake  // 传递配置
        );
        this.logger?.info('[F2A] HandshakeProtocol 已初始化');
      } finally {
        this.initializingFlags.handshakeProtocol = false;
      }
    }
    // P1-4 修复：添加 undefined 检查替代非空断言
    if (!this._handshakeProtocol) {
      throw new Error('HandshakeProtocol 初始化失败（可能 F2A 或 ContactManager 未就绪）');
    }
    return this._handshakeProtocol;
  }

  // ========== F2A 实例管理 ==========

  /**
   * 设置 F2A 实例
   */
  setF2A(f2a: F2A | undefined): void {
    this._f2a = f2a;
  }

  // ========== Logger 管理 ==========

  /**
   * 更新 Logger
   */
  updateLogger(logger: ApiLogger | undefined): void {
    this.logger = logger;
  }

  // ========== 公共接口 getter（F2APluginPublicInterface 实现） ==========
  // P2-1 修复：返回简化接口类型，使用类型断言避免严格的类型匹配问题

  /**
   * 获取网络客户端（公共接口）
   * @throws Error 如果组件初始化失败
   */
  getNetworkClient(): F2ANetworkClientLike {
    return this.networkClient as unknown as F2ANetworkClientLike;
  }

  /**
   * 获取信誉系统（公共接口）
   * @throws Error 如果组件初始化失败
   */
  getReputationSystem(): ReputationSystemLike {
    return this.reputationSystem as unknown as ReputationSystemLike;
  }

  /**
   * 获取节点管理器（公共接口）
   * @throws Error 如果组件初始化失败
   */
  getNodeManager(): NodeManagerLike {
    return this.nodeManager as unknown as NodeManagerLike;
  }

  /**
   * 获取任务队列（公共接口）
   * @throws Error 如果组件初始化失败
   */
  getTaskQueue(): TaskQueueLike {
    return this.taskQueue as unknown as TaskQueueLike;
  }

  /**
   * 获取公告队列（公共接口）
   * @throws Error 如果组件初始化失败
   */
  getAnnouncementQueue(): AnnouncementQueueLike {
    return this.announcementQueue as unknown as AnnouncementQueueLike;
  }

  /**
   * 获取评审委员会（公共接口）
   * 触发懒加载
   */
  getReviewCommittee(): ReviewCommitteeLike | undefined {
    // 触发懒加载
    return this.reviewCommittee as unknown as ReviewCommitteeLike | undefined;
  }

  /**
   * 获取联系人管理器（公共接口）
   * @throws Error 如果组件初始化失败
   */
  getContactManager(): ContactManagerLike {
    return this.contactManager as unknown as ContactManagerLike;
  }

  /**
   * 获取握手协议处理器（公共接口）
   * @throws Error 如果 F2A 或 ContactManager 未就绪
   */
  getHandshakeProtocol(): HandshakeProtocolLike {
    return this.handshakeProtocol as unknown as HandshakeProtocolLike;
  }

  /**
   * 获取 F2A 状态（公共接口）
   */
  getF2AStatus(): { running: boolean; peerId?: string; uptime?: number } {
    if (!this._f2a) {
      return { running: false };
    }
    return {
      running: true,
      peerId: this._f2a.peerId,
    };
  }

  /**
   * 获取 F2A 实例（公共接口）
   * 返回 F2A 公共接口供需要直接访问的场景使用。
   * 注意：返回 undefined 表示 F2A 实例未初始化。
   */
  getF2A(): F2APublicInterface | undefined {
    return this._f2a as unknown as F2APublicInterface | undefined;
  }

  // ========== 清理 ==========

  /**
   * 清理所有组件（用于 shutdown）
   */
  async cleanup(): Promise<void> {
    // TaskQueue 需要关闭持久化
    if (this._taskQueue) {
      this._taskQueue.close?.();
      this._taskQueue = undefined;
    }

    // 清空其他组件引用
    this._nodeManager = undefined;
    this._networkClient = undefined;
    this._reputationSystem = undefined;
    this._capabilityDetector = undefined;
    this._announcementQueue = undefined;
    this._reviewCommittee = undefined;
    this._contactManager = undefined;
    this._handshakeProtocol = undefined;
    this._f2a = undefined;

    // 重置初始化标志
    this.initializingFlags = {
      nodeManager: false,
      taskQueue: false,
      contactManager: false,
      handshakeProtocol: false,
    };
  }
}