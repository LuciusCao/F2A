/**
 * AgentHandler - Agent CRUD + webhook + verify 端点处理器
 * 
 * 从 control-server.ts 提取的 Agent 相关端点处理逻辑
 * 
 * P2-4: API 版本化端点:
 * - GET /api/v1/agents - 列出 Agents（无需认证）
 * - POST /api/v1/agents - 注册 Agent（无需认证，但有 webhook 验证）
 * - DELETE /api/v1/agents/:agentId - 注销 Agent（需认证）
 * - GET /api/v1/agents/:agentId - 获取 Agent 详情（无需认证）
 * - PATCH /api/v1/agents/:agentId/webhook - 更新 webhook（需认证）
 * - POST /api/v1/agents/verify - Challenge-Response 验证（无需认证）
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';
import { Logger, getErrorMessage, E2EECrypto } from '@f2a/network';
import type { AgentRegistry, AgentRegistration, MessageRouter, AgentCapability } from '@f2a/network';
import type { AgentIdentityStore, AgentIdentity } from '../agent-identity-store.js';
import type { AgentTokenManager } from '../agent-token-manager.js';
import type { AgentHandlerDeps, Challenge } from '../types/handlers.js';

/**
 * 注册 Agent 请求体类型
 */
interface RegisterAgentBody {
  /** Agent ID（恢复身份时提供） */
  agentId?: string;
  /** Agent 名称（新注册时必需） */
  name?: string;
  /** Agent 能力列表 */
  capabilities?: Array<string | AgentCapability>;
  /** Webhook 配置（HTTP API 注册时必需） */
  webhook?: { url: string; token?: string };
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
  /** 是否请求 Challenge（Phase 7） */
  requestChallenge?: boolean;
}

/**
 * 更新 Webhook 请求体类型
 */
interface UpdateWebhookBody {
  /** Webhook 配置 */
  webhook?: { url: string; token?: string };
  /** Webhook URL（旧格式兼容） */
  webhookUrl?: string;
  /** Webhook Token（旧格式兼容） */
  webhookToken?: string;
}

/**
 * Challenge-Response 验证请求体类型
 */
interface VerifyAgentBody {
  /** Agent ID */
  agentId: string;
  /** Challenge nonce */
  nonce: string;
  /** nonce 签名（Base64） */
  nonceSignature: string;
}

/**
 * Challenge 有效期（毫秒）
 */
const CHALLENGE_EXPIRY_MS = 60000; // 60 秒

export class AgentHandler {
  private agentRegistry: AgentRegistry;
  private identityStore: AgentIdentityStore;
  private agentTokenManager: AgentTokenManager;
  private e2eeCrypto: E2EECrypto;
  private messageRouter: MessageRouter;
  private logger: Logger;
  
  // 状态：pendingChallenges 移入此类
  private pendingChallenges: Map<string, Challenge> = new Map();
  // P2-2: 清理任务的定时器
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(deps: AgentHandlerDeps) {
    this.agentRegistry = deps.agentRegistry;
    this.identityStore = deps.identityStore;
    this.agentTokenManager = deps.agentTokenManager;
    this.e2eeCrypto = deps.e2eeCrypto;
    this.messageRouter = deps.messageRouter;
    this.logger = deps.logger;
  }

  /**
   * 列出所有注册的 Agent
   * GET /api/v1/agents（无需认证）
   */
  handleListAgents(res: ServerResponse): void {
    const agents = this.agentRegistry.list();
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agents: agents.map(a => ({
        agentId: a.agentId,
        name: a.name,
        capabilities: a.capabilities,
        registeredAt: a.registeredAt,
        lastActiveAt: a.lastActiveAt,
        webhook: a.webhook,
      })),
      stats: this.agentRegistry.getStats(),
    }));
  }

  /**
   * 注册 Agent（RFC 003: AgentId 由节点签发）
   * Phase 6: 支持恢复已有身份
   * POST /api/v1/agents（无需认证，但有 webhook 验证）
   * 
   * - 如果提供了 agentId 且存在对应 identity 文件，恢复身份
   * - 否则注册新 Agent（节点签发 AgentId）
   * - Phase 7: 支持 Challenge-Response 验证
   */
  async handleRegisterAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data: RegisterAgentBody = JSON.parse(body);
        
        // 🔑 Phase 7: Challenge-Response - 如果请求挑战
        if (data.requestChallenge) {
          const nonce = this.generateNonce();
          
          this.pendingChallenges.set(data.agentId!, {
            nonce,
            webhook: data.webhook!,
            timestamp: Date.now()
          });
          
          this.logger.info('Challenge requested for agent', {
            agentId: data.agentId?.slice(0, 16),
            noncePrefix: nonce.slice(0, 8)
          });
          
          res.writeHead(200);
          res.end(JSON.stringify({
            challenge: true,
            nonce,
            expiresIn: 60  // 60 秒有效期
          }));
          return;
        }
        
        // 🔑 Phase 6: 如果提供了已有 agentId，尝试恢复身份
        if (data.agentId) {
          let existingIdentity = this.identityStore.get(data.agentId);
          
          if (existingIdentity) {
            // 恢复身份：更新 webhook
            if (data.webhook) {
              const updated = await this.identityStore.updateWebhook(data.agentId, data.webhook);
              if (!updated) {
                this.logger.warn('Failed to update webhook in identity file', { agentId: data.agentId });
                // 可以继续，因为 webhook 不是必需的
              }
              
              // 重新加载 identity（包含新 webhook）
              const newIdentity = this.identityStore.get(data.agentId);
              if (newIdentity) {
                existingIdentity = newIdentity;  // 使用新数据
              }
            }
            
            // 同步到 AgentRegistry
            const restored = this.agentRegistry.restore(existingIdentity);
            
            // 创建消息队列
            this.messageRouter.createQueue(data.agentId);
            
            // Phase 4: 生成 agent token
            const agentToken = this.agentTokenManager.generate(existingIdentity.agentId);
            
            this.logger.info('Agent identity restored', {
              agentId: existingIdentity.agentId,
              name: existingIdentity.name,
              peerId: existingIdentity.peerId,
              tokenPrefix: agentToken.slice(0, 8),
            });
            
            res.writeHead(200);
            res.end(JSON.stringify({
              success: true,
              restored: true,
              agent: restored,
              token: agentToken,
            }));
            return;
          }
        }
        
        // RFC 003: 新注册必须提供 name
        if (!data.name) {
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Missing required field: name',
            code: 'INVALID_REQUEST',
          }));
          return;
        }

        // RFC 004: 通过 HTTP API 注册的 Agent 必须提供 webhook
        // 原因：HTTP API 是跨进程调用，无法传递 onMessage 函数回调
        // 只有 webhook 才能让 daemon 推送消息给 agent
        if (!data.webhook?.url) {
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Missing required field: webhook.url - Agents registered via HTTP API must provide a webhook endpoint for message delivery',
            code: 'INVALID_REQUEST',
            hint: 'Example: {"webhook": {"url": "http://127.0.0.1:9002/f2a/webhook"}}',
          }));
          return;
        }

        // 转换 capabilities 格式（补充默认值以满足 AgentCapability 类型要求）
        const capabilities: AgentCapability[] = (data.capabilities || []).map((cap: string | AgentCapability) => {
          if (typeof cap === 'string') {
            // 字符串格式转换为完整 AgentCapability
            return { 
              name: cap, 
              description: `${cap} capability`, 
              tools: [] 
            };
          }
          // 如果已是 AgentCapability 但缺少必需字段，补充默认值
          return {
            name: cap.name,
            description: cap.description || `${cap.name} capability`,
            tools: cap.tools || [],
            parameters: cap.parameters,
          };
        });

        // 注册新 Agent（节点签发 AgentId）
        const registration = this.agentRegistry.register({
          name: data.name,
          capabilities,
          webhook: data.webhook,
          metadata: data.metadata,
        });

        // 🔑 Phase 6: 保存 identity 文件
        const identity: AgentIdentity = {
          agentId: registration.agentId,
          name: registration.name,
          peerId: registration.peerId || '',
          signature: registration.signature || '',
          // e2eePublicKey: TODO - 需要从 F2A 获取
          webhook: registration.webhook,
          capabilities: registration.capabilities,
          metadata: registration.metadata,
          createdAt: registration.registeredAt.toISOString(),
          lastActiveAt: new Date().toISOString(),
        };
        await this.identityStore.save(identity);

        // 创建消息队列
        this.messageRouter.createQueue(registration.agentId);

        // Phase 4: 生成 agent token
        const agentToken = this.agentTokenManager.generate(registration.agentId);
        
        this.logger.info('Agent registered via API (node-issued)', {
          agentId: registration.agentId,
          name: registration.name,
          peerId: registration.peerId,
          tokenPrefix: agentToken.slice(0, 8),
        });

        res.writeHead(201);
        res.end(JSON.stringify({
          success: true,
          restored: false,
          agent: registration,
          token: agentToken,
        }));
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON',
          code: 'INVALID_JSON',
        }));
      }
    });
  }

  /**
   * 注销 Agent（需要删除持久化文件）
   * DELETE /api/v1/agents/:agentId（需认证）
   */
  async handleUnregisterAgent(agentId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // === RFC 007: Token 验证 ===
    // 从 Authorization header 获取 agent token
    const authHeader = req.headers['authorization'] as string;
    const agentToken = authHeader?.startsWith('agent-') 
      ? authHeader.slice(6)  // 去掉 'agent-' 前缀
      : undefined;

    if (!agentToken) {
      this.logger.warn('UnregisterAgent request missing Authorization header', {
        agentIdPrefix: agentId?.slice(0, 16),
      });
      res.writeHead(401);
      res.end(JSON.stringify({
        success: false,
        error: 'Missing Authorization header. Expected format: Authorization: agent-{token}',
        code: 'MISSING_TOKEN',
      }));
      return;
    }

    // 使用全局 AgentTokenManager 验证 token 属于该 agentId
    const verifyResult = this.agentTokenManager.verifyForAgent(agentToken, agentId);
    if (!verifyResult.valid) {
      this.logger.warn('UnregisterAgent token verification failed', {
        agentIdPrefix: agentId?.slice(0, 16),
        error: verifyResult.error,
      });
      res.writeHead(401);
      res.end(JSON.stringify({
        success: false,
        error: verifyResult.error || 'Invalid token',
        code: 'TOKEN_INVALID',
      }));
      return;
    }

    const removed = this.agentRegistry.unregister(agentId);
    
    if (removed) {
      // 删除消息队列
      this.messageRouter.deleteQueue(agentId);

      // 撤销该 Agent 的所有 token
      this.agentTokenManager.revokeAllForAgent(agentId);

      // RFC 004 Phase 6: 删除持久化身份文件
      await this.identityStore.delete(agentId);

      // 同步注册表到消息路由器（P1-1: MessageRouter 直接引用 AgentRegistry，无需同步）
      
      this.logger.info('Agent unregistered via API', { agentId });
      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        message: 'Agent unregistered',
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({
        success: false,
        error: 'Agent not found',
        code: 'AGENT_NOT_FOUND',
      }));
    }
  }

  /**
   * 获取 Agent 详情
   * GET /api/v1/agents/:agentId（无需认证）
   */
  handleGetAgent(agentId: string, res: ServerResponse): void {
    const agent = this.agentRegistry.get(agentId);
    
    if (!agent) {
      res.writeHead(404);
      res.end(JSON.stringify({
        success: false,
        error: 'Agent not found',
        code: 'AGENT_NOT_FOUND',
      }));
      return;
    }

    // 获取消息队列统计
    const queue = this.messageRouter.getQueue(agentId);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      agent: {
        agentId: agent.agentId,
        name: agent.name,
        capabilities: agent.capabilities,
        registeredAt: agent.registeredAt,
        lastActiveAt: agent.lastActiveAt,
        webhook: agent.webhook,
        metadata: agent.metadata,
      },
      queue: queue ? {
        size: queue.messages.length,
        maxSize: queue.maxSize,
      } : null,
    }));
  }

  /**
   * 更新 Agent webhook（RFC 004: Agent 级 Webhook）
   * PATCH /api/v1/agents/:agentId/webhook（需认证）
   */
  async handleUpdateWebhook(agentId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data: UpdateWebhookBody = JSON.parse(body);
        
        // === RFC 007: Token 验证 ===
        // 从 Authorization header 获取 agent token
        const authHeader = req.headers['authorization'] as string;
        const agentToken = authHeader?.startsWith('agent-') 
          ? authHeader.slice(6)  // 去掉 'agent-' 前缀
          : undefined;

        if (!agentToken) {
          this.logger.warn('UpdateWebhook request missing Authorization header', {
            agentIdPrefix: agentId?.slice(0, 16),
          });
          res.writeHead(401);
          res.end(JSON.stringify({
            success: false,
            error: 'Missing Authorization header. Expected format: Authorization: agent-{token}',
            code: 'MISSING_TOKEN',
          }));
          return;
        }

        // 使用全局 AgentTokenManager 验证 token 属于该 agentId
        const verifyResult = this.agentTokenManager.verifyForAgent(agentToken, agentId);
        if (!verifyResult.valid) {
          this.logger.warn('UpdateWebhook token verification failed', {
            agentIdPrefix: agentId?.slice(0, 16),
            error: verifyResult.error,
          });
          res.writeHead(401);
          res.end(JSON.stringify({
            success: false,
            error: verifyResult.error || 'Invalid token',
            code: 'TOKEN_INVALID',
          }));
          return;
        }

        const agent = this.agentRegistry.get(agentId);
        if (!agent) {
          res.writeHead(404);
          res.end(JSON.stringify({
            success: false,
            error: 'Agent not found',
            code: 'AGENT_NOT_FOUND',
          }));
          return;
        }

        // RFC 004: 构建 webhook 对象
        const webhook = data.webhook || (data.webhookUrl ? { url: data.webhookUrl, token: data.webhookToken } : undefined);
        
        // 先持久化文件，再更新内存（避免持久化失败导致数据丢失）
        const identityUpdated = await this.identityStore.updateWebhook(agentId, webhook);
        if (!identityUpdated) {
          res.writeHead(500);
          res.end(JSON.stringify({
            success: false,
            error: 'Failed to persist webhook',
            code: 'PERSIST_FAILED',
          }));
          return;
        }

        // 文件持久化成功后，更新内存
        const registryUpdated = this.agentRegistry.updateWebhook(agentId, webhook);
        if (registryUpdated) {
          this.logger.info('Agent webhook updated via API', { agentId, webhookUrl: webhook?.url });
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            agentId,
            webhook,
          }));
        } else {
          // 内存更新失败（罕见），但文件已持久化，可恢复
          this.logger.warn('Registry update failed after persistence succeeded', { agentId });
          res.writeHead(500);
          res.end(JSON.stringify({
            success: false,
            error: 'Failed to update registry',
            code: 'REGISTRY_FAILED',
          }));
        }
      } catch (error) {
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON',
          code: 'INVALID_JSON',
        }));
      }
    });
  }

  /**
   * Challenge-Response 验证（签名验证）
   * POST /api/v1/agents/verify（无需认证）
   * Phase 7: 验证 Challenge-Response
   */
  async handleVerifyAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data: VerifyAgentBody = JSON.parse(body);
        
        // 1️⃣ 检查 nonce 是否存在
        const pending = this.pendingChallenges.get(data.agentId);
        if (!pending || pending.nonce !== data.nonce) {
          this.logger.warn('Invalid nonce for agent verification', {
            agentId: data.agentId?.slice(0, 16),
            hasPending: !!pending
          });
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Invalid nonce', code: 'INVALID_NONCE' }));
          return;
        }
        
        // 2️⃣ 检查 nonce 是否过期（60秒有效期）
        const pendingTimestampNum = typeof pending.timestamp === 'number' 
          ? pending.timestamp 
          : typeof pending.timestamp === 'string' 
            ? new Date(pending.timestamp).getTime() 
            : 0;
        if (Date.now() - pendingTimestampNum > CHALLENGE_EXPIRY_MS) {
          this.pendingChallenges.delete(data.agentId);
          this.logger.warn('Nonce expired for agent verification', {
            agentId: data.agentId?.slice(0, 16),
            elapsedMs: Date.now() - pendingTimestampNum
          });
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Nonce expired', code: 'NONCE_EXPIRED' }));
          return;
        }
        
        // 3️⃣ 加载 identity 文件
        const identity = this.identityStore.get(data.agentId);
        if (!identity) {
          this.logger.warn('Identity not found for agent verification', {
            agentId: data.agentId?.slice(0, 16)
          });
          res.writeHead(404);
          res.end(JSON.stringify({ success: false, error: 'Identity not found', code: 'IDENTITY_NOT_FOUND' }));
          return;
        }
        
        // 🔑 4️⃣ 验证 nonce 签名
        if (!identity.e2eePublicKey) {
          this.logger.error('Identity missing e2eePublicKey, cannot verify signature', {
            agentId: data.agentId?.slice(0, 16)
          });
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'Identity missing e2eePublicKey', code: 'MISSING_PUBLIC_KEY' }));
          return;
        }
        
        const isValid = this.e2eeCrypto.verifySignature(
          data.nonce,
          data.nonceSignature,
          identity.e2eePublicKey
        );
        
        if (!isValid) {
          this.logger.error('Signature verification failed - agent identity mismatch', {
            agentId: data.agentId?.slice(0, 16),
            noncePrefix: data.nonce?.slice(0, 8)
          });
          res.writeHead(401);
          res.end(JSON.stringify({
            success: false,
            error: 'Signature verification failed - not the same agent',
            code: 'SIGNATURE_VERIFICATION_FAILED'
          }));
          return;
        }
        
        // ✅ 5️⃣ 验证通过：生成新 session token
        // Phase 1: 使用全局 AgentTokenManager 生成 token（纯内存版本）
        try {
          const agentToken = this.agentTokenManager.generate(data.agentId);
          
          this.logger.info('Agent token generated', {
            agentId: data.agentId?.slice(0, 16),
            tokenPrefix: agentToken.slice(0, 8),
          });
          
          // 6️⃣ 更新 identity
          identity.webhook = pending.webhook;
          identity.lastActiveAt = new Date().toISOString();
          await this.identityStore.save(identity);
          
          // 7️⃣ 清理 pending challenge
          this.pendingChallenges.delete(data.agentId);
          
          // 8️⃣ 同步到 AgentRegistry
          const restored = this.agentRegistry.restore(identity);
          this.messageRouter.createQueue(data.agentId);
          
          this.logger.info('Agent identity verified successfully', {
            agentId: identity.agentId?.slice(0, 16),
            name: identity.name,
            agentTokenPrefix: agentToken.slice(0, 8)
          });
          
          // 9️⃣ 返回新 token
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            verified: true,
            agentToken,
            agent: restored
          }));
        } catch (tokenError) {
          this.logger.error('Failed to generate or save agent token', {
            agentId: data.agentId?.slice(0, 16),
            error: tokenError instanceof Error ? tokenError.message : String(tokenError)
          });
          res.writeHead(500);
          res.end(JSON.stringify({
            success: false,
            error: 'Failed to generate agent token',
            code: 'TOKEN_GENERATION_FAILED'
          }));
          return;
        }
      } catch (error) {
        this.logger.error('Error in agent verification', {
          error: error instanceof Error ? error.message : String(error)
        });
        res.writeHead(400);
        res.end(JSON.stringify({
          success: false,
          error: 'Invalid JSON',
          code: 'INVALID_JSON'
        }));
      }
    });
  }

  // ========== 辅助方法 ==========

  /**
   * 生成随机 nonce
   * @returns 32 位随机十六进制字符串
   */
  private generateNonce(): string {
    return randomBytes(16).toString('hex');  // 32 位随机字符串
  }

  // ========== P2-2: 清理机制 ==========

  /**
   * 启动过期 challenge 清理任务
   * 每隔 30 秒扫描一次，删除超过 60 秒的 challenge
   */
  startCleanupTask(): void {
    if (this.cleanupInterval) return; // 防止重复启动
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredChallenges();
    }, 30000); // 每 30 秒
    
    this.logger.info('Challenge cleanup task started', { intervalMs: 30000 });
  }

  /**
   * 停止清理任务
   */
  stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.info('Challenge cleanup task stopped');
    }
  }

  /**
   * 清理过期的 challenge
   * @private
   */
  private cleanupExpiredChallenges(): void {
    const now = Date.now();
    let cleaned = 0;
    
    // 使用 forEach 避免 downlevelIteration 问题
    this.pendingChallenges.forEach((challenge, agentId) => {
      const challengeTimestamp = typeof challenge.timestamp === 'number'
        ? challenge.timestamp
        : typeof challenge.timestamp === 'string'
          ? new Date(challenge.timestamp).getTime()
          : 0;
      if (now - challengeTimestamp > CHALLENGE_EXPIRY_MS) {
        this.pendingChallenges.delete(agentId);
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      this.logger.info('Cleaned up expired challenges', { count: cleaned });
    }
  }
}