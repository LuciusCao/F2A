/**
 * ChallengeHandler - RFC008 Challenge-Response 认证处理器
 * 
 * 用于 Daemon 处理 Challenge-Response 认证流程：
 * - Challenge 生成（256-bit 随机数据，30秒有效期）
 * - Challenge 签名验证
 * - 防重放攻击管理
 * 
 * 参考: RFC008 Agent Self-Identity (239-296行)
 */

import type { IncomingMessage, ServerResponse } from 'http';
import {
  Logger,
  getErrorMessage,
  generateChallenge,
  verifyChallengeResponse,
  verifyChallengeResponseWithStore,
  ChallengeStore,
  Challenge,
  ChallengeResponse,
  ChallengeVerificationResult,
  parseAgentId,
  isNewFormat,
  isOldFormat,
} from '@f2a/network';
import type { AgentRegistry, AgentRegistration } from '@f2a/network';
import type { AgentIdentityStore } from './agent-identity-store.js';
import type { AgentTokenManager } from './agent-token-manager.js';
import type { MessageRouter } from '@f2a/network';

/**
 * RFC008 Challenge-Response 认证请求
 */
interface ChallengeRequest {
  /** Agent ID */
  agentId: string;
  /** 操作类型: "send_message", "update_webhook", "verify_identity" */
  operation: string;
  /** 目标 Agent ID（send_message 操作时必需） */
  targetAgentId?: string;
  /** Webhook 配置（update_webhook 操作时必需） */
  webhook?: { url: string; token?: string };
}

/**
 * RFC008 Challenge-Response 提交
 */
interface ChallengeSubmit {
  /** Agent ID */
  agentId: string;
  /** Challenge 对象 */
  challenge: Challenge;
  /** Challenge Response（签名） */
  response: ChallengeResponse;
}

/**
 * ChallengeHandler 配置
 */
export interface ChallengeHandlerConfig {
  /** Agent 注册表 */
  agentRegistry: AgentRegistry;
  /** Agent 身份存储 */
  identityStore: AgentIdentityStore;
  /** Agent Token 管理器 */
  agentTokenManager: AgentTokenManager;
  /** 消息路由器 */
  messageRouter: MessageRouter;
  /** 日志器 */
  logger: Logger;
  /** Challenge 有效期（秒），默认 30 */
  challengeExpirySeconds?: number;
  /** 自动清理间隔（毫秒），默认 60000 */
  cleanupIntervalMs?: number;
}

/**
 * 挂起的 Challenge（用于兼容旧格式 token 认证）
 */
interface PendingChallenge {
  /** Challenge 对象 */
  challenge: Challenge;
  /** Agent ID */
  agentId: string;
  /** 操作类型 */
  operation: string;
  /** 目标 Agent ID */
  targetAgentId?: string;
  /** Webhook 配置 */
  webhook?: { url: string; token?: string };
  /** 创建时间戳 */
  createdAt: number;
}

/**
 * ChallengeHandler - RFC008 Challenge-Response 认证处理器
 */
export class ChallengeHandler {
  private agentRegistry: AgentRegistry;
  private identityStore: AgentIdentityStore;
  private agentTokenManager: AgentTokenManager;
  private messageRouter: MessageRouter;
  private logger: Logger;
  private challengeStore: ChallengeStore;
  private challengeExpirySeconds: number;
  
  // 挂起的 Challenge（包含操作参数）
  private pendingChallenges: Map<string, PendingChallenge> = new Map();
  
  // 清理定时器
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ChallengeHandlerConfig) {
    this.agentRegistry = config.agentRegistry;
    this.identityStore = config.identityStore;
    this.agentTokenManager = config.agentTokenManager;
    this.messageRouter = config.messageRouter;
    this.logger = config.logger;
    this.challengeStore = new ChallengeStore();
    this.challengeExpirySeconds = config.challengeExpirySeconds ?? 30;

    // 启动自动清理
    if (config.cleanupIntervalMs !== 0) {
      this.startCleanup(config.cleanupIntervalMs ?? 60000);
    }
  }

  /**
   * 处理 Challenge 请求
   * 
   * POST /api/v1/challenge
   * 
   * 请求格式：
   * {
   *   agentId: "agent:xxx",
   *   operation: "send_message",
   *   targetAgentId: "agent:yyy"  // 可选
   * }
   * 
   * 响应格式：
   * {
   *   challenge: {
   *     challenge: "random-256bit",
   *     timestamp: "ISO-8601",
   *     expiresInSeconds: 30,
   *     operation: "send_message"
   *   }
   * }
   */
  async handleChallengeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data: ChallengeRequest = JSON.parse(body);

        // 验证 AgentId 格式
        const parsed = parseAgentId(data.agentId);
        if (!parsed.valid) {
          this.logger.warn('Invalid AgentId in challenge request', {
            agentId: data.agentId,
            error: parsed.error,
          });
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: `Invalid AgentId: ${parsed.error}`,
            code: 'INVALID_AGENT_ID',
          }));
          return;
        }

        // 检查 Agent 是否已注册（新格式必须在注册表中有 publicKey）
        const agent = this.agentRegistry.get(data.agentId);
        
        // RFC008 新格式：必须有 publicKey
        if (parsed.format === 'new') {
          if (!agent?.publicKey) {
            this.logger.warn('RFC008 Agent missing publicKey', {
              agentId: data.agentId,
              hasPublicKey: !!agent?.publicKey,
            });
            res.writeHead(400);
            res.end(JSON.stringify({
              success: false,
              error: 'RFC008 Agent must have publicKey registered. Please register first.',
              code: 'MISSING_PUBLIC_KEY',
            }));
            return;
          }
        }

        // 生成 Challenge
        const challenge = generateChallenge(data.operation, this.challengeExpirySeconds);

        // 存储 Challenge
        this.challengeStore.store(challenge);

        // 存储挂起的 Challenge（包含操作参数）
        this.pendingChallenges.set(challenge.challenge, {
          challenge,
          agentId: data.agentId,
          operation: data.operation,
          targetAgentId: data.targetAgentId,
          webhook: data.webhook,
          createdAt: Date.now(),
        });

        this.logger.info('Challenge generated', {
          agentId: data.agentId,
          operation: data.operation,
          challengeId: challenge.challenge.slice(0, 16) + '...',
          expirySeconds: this.challengeExpirySeconds,
          idFormat: parsed.format,
        });

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          challenge,
          // 对于新格式，返回已注册的公钥指纹验证提示
          idFormat: parsed.format,
        }));
      } catch (error) {
        this.logger.error('Challenge request parsing error', {
          error: getErrorMessage(error),
        });
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
   * 处理 Challenge-Response 提交
   * 
   * POST /api/v1/challenge/response
   * 
   * 请求格式：
   * {
   *   agentId: "agent:xxx",
   *   challenge: { challenge, timestamp, expiresInSeconds, operation },
   *   response: { signature, publicKey }
   * }
   * 
   * 响应格式：
   * {
   *   success: true,
   *   verified: true,
   *   agentToken: "agent-xxx",  // 用于后续操作的短期 token
   *   message: "Challenge verified"
   * }
   */
  async handleChallengeResponse(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data: ChallengeSubmit = JSON.parse(body);

        // 查找挂起的 Challenge
        const pending = this.pendingChallenges.get(data.challenge.challenge);
        
        if (!pending) {
          this.logger.warn('Challenge not found or expired', {
            agentId: data.agentId,
            challengeId: data.challenge.challenge.slice(0, 16) + '...',
          });
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'Challenge not found or expired',
            code: 'CHALLENGE_NOT_FOUND',
          }));
          return;
        }

        // 验证 AgentId 匹配
        if (pending.agentId !== data.agentId) {
          this.logger.warn('AgentId mismatch in challenge response', {
            pendingAgentId: pending.agentId,
            requestAgentId: data.agentId,
          });
          res.writeHead(400);
          res.end(JSON.stringify({
            success: false,
            error: 'AgentId mismatch',
            code: 'AGENT_ID_MISMATCH',
          }));
          return;
        }

        // RFC008 验证
        const result = verifyChallengeResponseWithStore(
          this.challengeStore,
          data.agentId,
          data.challenge,
          data.response
        );

        if (!result.valid) {
          this.logger.warn('Challenge response verification failed', {
            agentId: data.agentId,
            errorCode: result.errorCode,
            error: result.error,
          });
          res.writeHead(401);
          res.end(JSON.stringify({
            success: false,
            error: result.error,
            errorCode: result.errorCode,
            code: 'VERIFICATION_FAILED',
          }));
          return;
        }

        // 清理挂起的 Challenge
        this.pendingChallenges.delete(data.challenge.challenge);

        // 生成短期 Agent Token（用于后续操作）
        const agentToken = this.agentTokenManager.generate(data.agentId);

        this.logger.info('Challenge verified successfully', {
          agentId: data.agentId,
          operation: pending.operation,
          tokenPrefix: agentToken.slice(0, 8),
        });

        // 根据操作类型执行后续操作
        let operationResult: Record<string, unknown> = {};
        
        switch (pending.operation) {
          case 'verify_identity':
            // 仅验证身份，返回 token
            break;
            
          case 'update_webhook':
            // 更新 webhook
            if (pending.webhook) {
              const agent = this.agentRegistry.get(data.agentId);
              if (agent) {
                this.agentRegistry.updateWebhook(data.agentId, pending.webhook);
                operationResult = { webhook: pending.webhook };
              }
            }
            break;
            
          // send_message 操作需要单独处理，因为需要消息内容
          // 这里仅返回验证结果，客户端需要用 token 再请求 send_message
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          success: true,
          verified: true,
          agentToken,
          operation: pending.operation,
          operationResult,
        }));
      } catch (error) {
        this.logger.error('Challenge response parsing error', {
          error: getErrorMessage(error),
        });
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
   * 检查 Agent 是否支持 RFC008 Challenge-Response
   * 
   * @param agentId Agent ID
   * @returns 是否支持 RFC008 格式
   */
  supportsRFC008(agentId: string): boolean {
    // 新格式 AgentId 必须支持 Challenge-Response
    if (isNewFormat(agentId)) {
      return true;
    }
    
    // 旧格式：检查是否有 publicKey
    const agent = this.agentRegistry.get(agentId);
    return !!agent?.publicKey;
  }

  /**
   * 获取 Agent 的认证方式
   * 
   * @param agentId Agent ID
   * @returns 认证方式: 'rfc008' | 'rfc003_token' | 'unknown'
   */
  getAuthMethod(agentId: string): 'rfc008' | 'rfc003_token' | 'unknown' {
    const parsed = parseAgentId(agentId);
    
    if (!parsed.valid) {
      return 'unknown';
    }
    
    if (parsed.format === 'new') {
      return 'rfc008';
    }
    
    // 旧格式：检查是否有 publicKey（可能已迁移）
    const agent = this.agentRegistry.get(agentId);
    if (agent?.publicKey) {
      return 'rfc008';
    }
    
    return 'rfc003_token';
  }

  /**
   * 验证 Agent 身份（兼容新旧格式）
   * 
   * 对于新格式：使用 Challenge-Response
   * 对于旧格式：使用 Token
   * 
   * @param agentId Agent ID
   * @param auth 认证信息
   * @returns 验证结果
   */
  verifyIdentity(
    agentId: string,
    auth: {
      /** RFC008: Challenge Response */
      challenge?: Challenge;
      response?: ChallengeResponse;
      /** RFC003: Agent Token */
      token?: string;
    }
  ): { valid: boolean; error?: string; method?: 'rfc008' | 'rfc003_token' } {
    const authMethod = this.getAuthMethod(agentId);
    
    if (authMethod === 'unknown') {
      return { valid: false, error: 'Unknown AgentId format' };
    }
    
    if (authMethod === 'rfc008') {
      // RFC008 Challenge-Response 验证
      if (!auth.challenge || !auth.response) {
        return { valid: false, error: 'RFC008 requires challenge and response' };
      }
      
      const result = verifyChallengeResponse(
        agentId,
        auth.challenge,
        auth.response
      );
      
      return {
        valid: result.valid,
        error: result.error,
        method: 'rfc008',
      };
    }
    
    // RFC003 Token 验证
    if (!auth.token) {
      return { valid: false, error: 'RFC003 requires token' };
    }
    
    const tokenResult = this.agentTokenManager.verifyForAgent(auth.token, agentId);
    
    return {
      valid: tokenResult.valid,
      error: tokenResult.error,
      method: 'rfc003_token',
    };
  }

  /**
   * 启动 Challenge 清理定时器
   */
  private startCleanup(intervalMs: number): void {
    if (this.cleanupInterval) return;
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, intervalMs);
    
    this.logger.info('Challenge cleanup started', { intervalMs });
  }

  /**
   * 停止 Challenge 清理定时器
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.info('Challenge cleanup stopped');
    }
  }

  /**
   * 清理过期的 Challenge
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [challengeId, pending] of this.pendingChallenges.entries()) {
      const elapsedSeconds = (now - pending.createdAt) / 1000;
      if (elapsedSeconds > this.challengeExpirySeconds) {
        this.pendingChallenges.delete(challengeId);
        cleaned++;
      }
    }
    
    // 清理 ChallengeStore
    const storeCleaned = this.challengeStore.cleanupExpired();
    
    if (cleaned > 0 || storeCleaned > 0) {
      this.logger.debug('Cleaned up expired challenges', {
        pendingCleaned: cleaned,
        storeCleaned,
      });
    }
  }

  /**
   * 获取挂起的 Challenge 数量
   */
  getPendingCount(): number {
    return this.pendingChallenges.size;
  }

  /**
   * 获取 ChallengeStore 状态
   */
  getStoreSize(): number {
    return this.challengeStore.size();
  }
}