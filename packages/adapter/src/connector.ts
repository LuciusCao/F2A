/**
 * F2A OpenClaw Connector Plugin
 * 主插件类 - 协调各模块完成 F2A 功能
 * 
 * Issue #106 重构：拆分并解耦
 * - F2ACore.ts - 核心生命周期管理
 * - F2AComponentRegistry.ts - 组件懒加载管理器
 * - F2AWebhookManager.ts - Webhook 处理逻辑
 * - F2AToolRegistry.ts - 工具注册和路由
 */

import { join } from 'path';
import { homedir } from 'os';
import type {
  OpenClawPlugin,
  OpenClawPluginApi,
  Tool,
  F2ANodeConfig,
  F2APluginConfig,
  AgentInfo,
  F2APluginPublicInterface,
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
import { ToolHandlers } from './tool-handlers.js';
import { ClaimHandlers } from './claim-handlers.js';
import { ContactToolHandlers } from './contact-tool-handlers.js';
import { taskGuard } from './task-guard.js';
import {
  isValidPeerId,
  extractErrorMessage,
  MAX_MESSAGE_LENGTH,
  MESSAGE_HASH_THRESHOLD,
  MAX_MESSAGE_HASH_CACHE_SIZE,
  computeMessageHash,
  isEchoMessageByMetadata,
  isEchoMessageByContent,
  cleanupMessageHashCache,
  isDuplicateMessage,
} from './connector-helpers.js';
import { F2ACore } from './F2ACore.js';
import { F2AComponentRegistry } from './F2AComponentRegistry.js';
import { F2AWebhookManager } from './F2AWebhookManager.js';
import { F2AToolRegistry } from './F2AToolRegistry.js';

export class F2APlugin implements OpenClawPlugin, F2APluginPublicInterface {
  name = 'f2a-openclaw-f2a';
  version = '0.3.0';

  // 核心模块
  private core?: F2ACore;
  private components?: F2AComponentRegistry;
  private webhookManager?: F2AWebhookManager;

  // 处理器实例（延迟初始化）
  private _toolHandlers?: ToolHandlers;
  private _claimHandlers?: ClaimHandlers;
  private _contactToolHandlers?: ContactToolHandlers;

  // 消息哈希去重缓存
  private _processedMessageHashes: Map<string, number> = new Map();

  // 配置
  private config!: F2APluginConfig;
  private nodeConfig!: F2ANodeConfig;
  private api?: OpenClawPluginApi;

  // ========== 处理器 Getter ==========

  private get toolHandlers(): ToolHandlers {
    if (!this._toolHandlers) this._toolHandlers = new ToolHandlers(this);
    return this._toolHandlers;
  }

  private get claimHandlers(): ClaimHandlers {
    if (!this._claimHandlers) this._claimHandlers = new ClaimHandlers(this);
    return this._claimHandlers;
  }

  private get contactToolHandlers(): ContactToolHandlers {
    if (!this._contactToolHandlers) this._contactToolHandlers = new ContactToolHandlers(this);
    return this._contactToolHandlers;
  }

  // ========== 消息处理 ==========

  private isEchoMessage(msg: {
    from: string;
    content: string;
    metadata?: Record<string, unknown>;
    messageId: string;
  }): boolean {
    const { metadata, content, from } = msg;
    if (isEchoMessageByMetadata(metadata)) return true;
    if (isEchoMessageByContent(content)) return true;
    
    const f2a = this.core?.getF2A();
    if (f2a && from === f2a.peerId) return true;

    if (content && content.length > MESSAGE_HASH_THRESHOLD) {
      const messageHash = computeMessageHash(from, content);
      const now = Date.now();
      if (isDuplicateMessage(this._processedMessageHashes, messageHash, now)) {
        return true;
      }
      this._processedMessageHashes.set(messageHash, now);
      if (this._processedMessageHashes.size > MAX_MESSAGE_HASH_CACHE_SIZE) {
        cleanupMessageHashCache(this._processedMessageHashes, now);
      }
    }
    return false;
  }

  private createF2AReplyDispatcher(fromPeerId: string, messageId?: string) {
    const sendReply = async (text: string) => {
      const f2a = this.core?.getF2A();
      if (!f2a || !text?.trim()) return;
      try {
        await (f2a as any).sendMessage(fromPeerId, text, { type: 'reply', replyTo: messageId });
        this.core?.getLogger()?.info('[F2A] 回复已发送', { to: fromPeerId.slice(0, 16) });
      } catch (err) {
        this.core?.getLogger()?.error('[F2A] 发送回复失败', { error: extractErrorMessage(err) });
      }
    };
    return {
      deliver: async (payload: { text?: string }) => {
        const text = payload.text ?? '';
        if (!text.trim()) return;
        for (let i = 0; i < text.length; i += 4000) await sendReply(text.slice(i, i + 4000));
      },
    };
  }

  private async invokeOpenClawAgent(fromPeerId: string, message: string, replyToMessageId?: string): Promise<string | undefined> {
    // SessionKey: subagent:f2a:<peerId>
    // 使用 subagent 前缀，禁用 MEMORY.md 加载（群聊记忆隔离）
    // 每个 peer 独立 session，支持跨对话记忆
    const sessionKey = `subagent:f2a:${fromPeerId}`;
    const logger = this.core?.getLogger();
    const f2aDispatcher = this.createF2AReplyDispatcher(fromPeerId, replyToMessageId);

    const debugLog = (msg: string) => {
      try {
        const fs = require('fs');
        fs.appendFileSync(join(homedir(), '.openclaw/logs/adapter-debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
      } catch {}
      logger?.info(msg);
    };

    debugLog(`[F2A] invokeOpenClawAgent: sessionKey=${sessionKey}`);

    // Channel API
    if (this.api?.channel?.reply?.dispatchReplyFromConfig) {
      try {
        const route = this.api.channel.routing.resolveAgentRoute({ peerId: sessionKey });
        const ctx = this.api.channel.reply.finalizeInboundContext({
          SessionKey: route.sessionKey, PeerId: sessionKey, Sender: 'F2P P2P',
          SenderId: fromPeerId, ChannelType: 'p2p', InboundId: fromPeerId,
        });
        await this.api.channel.reply.dispatchReplyFromConfig({ ctx, cfg: this.config, dispatcher: f2aDispatcher });
        return undefined;
      } catch (err) { debugLog(`[F2A] Channel API 失败: ${extractErrorMessage(err)}`); }
    }

    // Subagent API
    if (this.api?.runtime?.subagent?.run) {
      try {
        const idempotencyKey = `subagent:f2a:${fromPeerId}-${Date.now()}`;
        const runResult = await this.api.runtime.subagent.run({ sessionKey, message, deliver: false, idempotencyKey });
        const waitResult = await this.api.runtime.subagent.waitForRun({ runId: runResult.runId, timeoutMs: 60000 });
        
        if (waitResult.status === 'ok') {
          const messagesResult = await this.api.runtime.subagent.getSessionMessages({ sessionKey, limit: 1 });
          if (messagesResult.messages?.length > 0) {
            const lastMessage = messagesResult.messages[messagesResult.messages.length - 1] as any;
            const reply = Array.isArray(lastMessage?.content)
              ? lastMessage.content.find((b: any) => b.type === 'text')?.text || ''
              : lastMessage?.content || lastMessage?.text || '';
            if (reply) { await f2aDispatcher.deliver({ text: reply }); return undefined; }
          }
        }
      } catch (err) { debugLog(`[F2A] Subagent 失败: ${extractErrorMessage(err)}`); }
    }

    // 降级回复
    const fallbackReply = `收到你的消息："${message.slice(0, 30)}"。我是 ${this.config.agentName || 'OpenClaw Agent'}，很高兴与你交流！`;
    await f2aDispatcher.deliver({ text: fallbackReply });
    return undefined;
  }

  // ========== 插件生命周期 ==========

  async initialize(config: Record<string, unknown> & { _api?: OpenClawPluginApi }): Promise<void> {
    this.api = config._api;
    const logger = config._api?.logger;

    this.core = new F2ACore({ pluginConfig: {} as F2APluginConfig, nodeConfig: {} as F2ANodeConfig, api: this.api, logger });
    await this.core.initialize(config);
    this.config = this.core.getConfig();
    this.nodeConfig = this.core.getNodeConfig();

    this.components = new F2AComponentRegistry({ pluginConfig: this.config, nodeConfig: this.nodeConfig, api: this.api, logger });
    this.core.setComponentRegistry(this.components);

    logger?.info('[F2A] 插件初始化完成');
  }

  async enable(): Promise<void> {
    const logger = this.core?.getLogger();

    this.webhookManager = new F2AWebhookManager({
      config: this.config, capabilities: this.core?.getCapabilities() || [], logger,
      reputationSystem: this.components!.getReputationSystem(), taskQueue: this.components!.getTaskQueue(),
      webhookPusher: this.core?.getWebhookPusher(), api: this.api,
      invokeOpenClawAgent: (from, msg) => this.invokeOpenClawAgent(from, msg),
    });

    const onMessage = async (msg: { from: string; content: string; metadata?: Record<string, unknown>; messageId: string }) => {
      if (!isValidPeerId(msg.from)) { logger?.warn(`[F2A] 拒绝无效 PeerID: ${String(msg.from).slice(0, 20)}`); return; }
      if (msg.content?.length > MAX_MESSAGE_LENGTH) { logger?.warn(`[F2A] 消息过长，拒绝处理`); return; }
      
      logger?.info(`[F2A] 收到 P2P 消息: from=${msg.from.slice(0, 16)}, content=${msg.content?.slice(0, 50)}`);
      
      try {
        if (this.isEchoMessage(msg)) { logger?.info('[F2A] 跳过回声消息'); return; }
        const reply = await this.invokeOpenClawAgent(msg.from, msg.content, msg.messageId);
        const f2a = this.core?.getF2A();
        if (reply && f2a) {
          await (f2a as any).sendMessage(msg.from, reply, { type: 'reply', replyTo: msg.messageId });
          logger?.info('[F2A] 回复已发送', { to: msg.from.slice(0, 16) });
        }
      } catch (err) { logger?.error('[F2A] 处理消息失败', { error: extractErrorMessage(err) }); }
    };

    await this.core!.enable(this.webhookManager.createHandler(), onMessage);
    this.components!.getContactManager();
    try { this.components!.getHandshakeProtocol(); } catch {}

    logger?.info('[F2A] 适配器已启用');
  }

  async shutdown(): Promise<void> {
    await this.core?.shutdown();
    this._toolHandlers = undefined;
    this._claimHandlers = undefined;
    this._contactToolHandlers = undefined;
    this._processedMessageHashes.clear();
    taskGuard.shutdown();
    this.core?.getLogger()?.info('[F2A] 插件已关闭');
  }

  // ========== 工具注册 ==========

  getTools(): Tool[] {
    return new F2AToolRegistry({
      toolHandlers: this.toolHandlers, claimHandlers: this.claimHandlers, contactToolHandlers: this.contactToolHandlers,
    }).getTools();
  }

  // ========== Webhook 处理器（兼容性方法） ==========

  /**
   * 创建 Webhook 处理器
   * 兼容性方法，委托给 F2AWebhookManager
   */
  private createWebhookHandler() {
    // 如果 webhookManager 未初始化，创建一个临时的
    if (!this.webhookManager) {
      this.webhookManager = new F2AWebhookManager({
        config: this.config,
        capabilities: this.core?.getCapabilities() || [],
        logger: this.core?.getLogger(),
        reputationSystem: this.components!.getReputationSystem(),
        taskQueue: this.components!.getTaskQueue(),
        webhookPusher: this.core?.getWebhookPusher(),
        api: this.api,
        invokeOpenClawAgent: (from, msg) => this.invokeOpenClawAgent(from, msg),
      });
    }
    return this.webhookManager.createHandler();
  }

  /**
   * 注册到 F2A Node（兼容性方法）
   * @deprecated 已迁移到 F2ACore
   */
  private async registerToNode(): Promise<void> {
    // 已迁移到 F2ACore，此方法保留用于测试兼容性
    // 无操作
  }

  // ========== 兼容性属性（测试用） ==========

  // 测试用存储（允许测试覆盖）
  private __testTaskQueueOverride?: any;
  private __testWebhookServerOverride?: any;
  private __testReputationSystemOverride?: any;

  /** @deprecated 使用 getTaskQueue() 代替 */
  private get _taskQueue() {
    if (this.__testTaskQueueOverride !== undefined) return this.__testTaskQueueOverride;
    if (!this.components) return undefined;
    try { return this.components.getTaskQueue(); } catch { return undefined; }
  }

  private set _taskQueue(value: any) {
    this.__testTaskQueueOverride = value;
  }

  /** @deprecated 使用 core?.getWebhookUrl() 代替 */
  private get _webhookServer() {
    if (this.__testWebhookServerOverride !== undefined) return this.__testWebhookServerOverride;
    if (!this.core?.getWebhookUrl()) return undefined;
    return { getUrl: () => this.core!.getWebhookUrl()! };
  }

  private set _webhookServer(value: any) {
    this.__testWebhookServerOverride = value;
  }

  /** @deprecated 使用 getReputationSystem() 代替 */
  private get _reputationSystem() {
    if (this.__testReputationSystemOverride !== undefined) return this.__testReputationSystemOverride;
    if (!this.components) return undefined;
    try { return this.components.getReputationSystem(); } catch { return undefined; }
  }

  private set _reputationSystem(value: any) {
    this.__testReputationSystemOverride = value;
  }

  // ========== 公共接口实现 ==========

  isInitialized(): boolean { return this.core?.isInitialized() ?? false; }
  getF2AStatus(): { running: boolean; peerId?: string; uptime?: number } { return this.core?.getF2AStatus() ?? { running: false }; }
  getF2A(): F2APublicInterface | undefined { return this.core?.getF2A() as unknown as F2APublicInterface | undefined; }
  getConfig(): F2APluginConfig { return this.config; }
  getApi(): OpenClawPluginApi | undefined { return this.api; }
  getNetworkClient(): F2ANetworkClientLike { if (!this.components) throw new Error('Not initialized'); return this.components.getNetworkClient(); }
  getReputationSystem(): ReputationSystemLike { if (!this.components) throw new Error('Not initialized'); return this.components.getReputationSystem(); }
  getNodeManager(): NodeManagerLike { if (!this.components) throw new Error('Not initialized'); return this.components.getNodeManager(); }
  getTaskQueue(): TaskQueueLike { if (!this.components) throw new Error('Not initialized'); return this.components.getTaskQueue(); }
  getAnnouncementQueue(): AnnouncementQueueLike { if (!this.components) throw new Error('Not initialized'); return this.components.getAnnouncementQueue(); }
  getReviewCommittee(): ReviewCommitteeLike | undefined { return this.components?.getReviewCommittee(); }
  getContactManager(): ContactManagerLike { if (!this.components) throw new Error('Not initialized'); return this.components.getContactManager(); }
  getHandshakeProtocol(): HandshakeProtocolLike { 
    if (!this.components) return undefined as any;
    try { 
      return this.components.getHandshakeProtocol(); 
    } catch { 
      return undefined as any; 
    } 
  }

  // ========== 兼容性属性（供 AdapterInternalAccess 访问） ==========

  /** @internal 用于 tool-handlers 直接访问 */
  get taskQueue() { return this._taskQueue; }
  get networkClient() { return this.components?.getNetworkClient(); }
  get reputationSystem() { return this._reputationSystem; }
  get reviewCommittee() { return this.components?.getReviewCommittee(); }
  get config() { return this.getConfig(); }
  get api() { return this.getApi(); }

  async discoverAgents(capability?: string): Promise<{ success: boolean; data?: AgentInfo[]; error?: { message: string } }> {
    const f2a = this.core?.getF2A();
    if (!f2a) return { success: false, error: { message: 'F2A 实例未初始化' } };
    try { return { success: true, data: await f2a.discoverAgents(capability) }; }
    catch (err) { return { success: false, error: { message: extractErrorMessage(err) } }; }
  }

  async getConnectedPeers(): Promise<{ success: boolean; data?: unknown[]; error?: { message: string } }> {
    const f2a = this.core?.getF2A();
    if (!f2a) return { success: false, error: { message: 'F2A 实例未初始化' } };
    try { return { success: true, data: (f2a as any).p2pNetwork?.getConnectedPeers?.() || [] }; }
    catch (err) { return { success: false, error: { message: extractErrorMessage(err) } }; }
  }

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    const f2a = this.core?.getF2A();
    if (!f2a) return { success: false, error: 'F2A 实例未初始化' };
    try { await (f2a as any).sendMessage(to, content, metadata); return { success: true }; }
    catch (err) { return { success: false, error: extractErrorMessage(err) }; }
  }

  async sendFriendRequest(peerId: string, message?: string): Promise<string | null> {
    try { return this.components!.getHandshakeProtocol().sendFriendRequest(peerId, message); }
    catch { this.core?.getLogger()?.warn('[F2A] 握手协议未初始化'); return null; }
  }

  async acceptFriendRequest(requestId: string): Promise<boolean> {
    try { return this.components!.getHandshakeProtocol().acceptRequest(requestId); }
    catch { return false; }
  }

  async rejectFriendRequest(requestId: string, reason?: string): Promise<boolean> {
    try { return this.components!.getHandshakeProtocol().rejectRequest(requestId, reason); }
    catch { return false; }
  }

  get f2aClient() {
    return {
      discoverAgents: (capability?: string) => this.discoverAgents(capability),
      getConnectedPeers: () => this.getConnectedPeers(),
    };
  }
}

export default F2APlugin;
export { F2APlugin as F2AOpenClawAdapter };