/**
 * P2P 消息分发器
 * 负责处理和分发 P2P 网络消息
 * 
 * 从 p2p-network.ts 提取，实现单一职责原则
 */

import { randomUUID } from 'crypto';
import type { 
  F2AMessage,
  DiscoverPayload,
  MessagePayload,
  AgentInfo
} from '../types/index.js';
import { E2EECrypto } from '../core/e2ee-crypto.js';
import { Logger } from './logger.js';
import { validateF2AMessage } from './validation.js';
import { RateLimiter } from './rate-limiter.js';
import { MiddlewareManager, Middleware, type MiddlewareResult } from './middleware.js';
import type { PeerTableManager } from './peer-table-manager.js';
import { isEncryptedMessage } from '../common/type-guards.js';

// F2A 协议标识
export const F2A_PROTOCOL = '/f2a/1.0.0';

// 加密消息处理结果
export interface DecryptResult {
  action: 'continue' | 'return';
  message: F2AMessage;
}

/**
 * 消息处理上下文（重导出 middleware 类型以兼容）
 */
export type { MiddlewareResult } from './middleware.js';

/**
 * 消息处理器接口
 */
export interface MessageHandler {
  type: string;
  handle(message: F2AMessage, peerId: string): Promise<void>;
}

/**
 * 消息分发器配置
 */
export interface MessageDispatcherConfig {
  /** 日志器 */
  logger?: Logger;
  /** 本地 Peer ID */
  localPeerId?: string;
}

/**
 * 消息分发器事件回调
 */
export interface MessageDispatcherCallbacks {
  /** 发现消息回调 */
  onDiscover?: (agentInfo: AgentInfo, peerId: string, shouldRespond: boolean) => Promise<void>;
  /** 解密失败回调 */
  onDecryptFailed?: (message: F2AMessage, peerId: string) => Promise<void>;
  /** 自由消息回调 */
  onFreeMessage?: (message: F2AMessage, peerId: string) => Promise<void>;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 发送消息回调 */
  sendMessage?: (peerId: string, message: F2AMessage, encrypt: boolean) => Promise<{ success: boolean; error?: { message: string } }>;
}

/**
 * P2P 消息分发器
 * 
 * 功能：
 * - 消息验证
 * - 加密消息处理
 * - 中间件执行
 * - 消息类型路由
 */
export class MessageDispatcher {
  private logger: Logger;
  private localPeerId?: string;
  private e2eeCrypto: E2EECrypto;
  private middlewareManager: MiddlewareManager;
  private peerTableManager?: PeerTableManager;
  
  /** 回调函数 */
  private callbacks: MessageDispatcherCallbacks = {};
  
  /** DISCOVER 消息速率限制器 */
  private discoverRateLimiter = new RateLimiter({
    maxRequests: 10,
    windowMs: 60 * 1000,
    burstMultiplier: 1.2
  });
  
  /** DECRYPT_FAILED 消息速率限制器 */
  private decryptFailedRateLimiter = new RateLimiter({
    maxRequests: 5,
    windowMs: 60 * 1000,
    burstMultiplier: 1.0
  });

  constructor(
    e2eeCrypto: E2EECrypto,
    config: MessageDispatcherConfig = {}
  ) {
    this.e2eeCrypto = e2eeCrypto;
    this.logger = config.logger || new Logger({ component: 'MessageDispatcher' });
    this.localPeerId = config.localPeerId;
    this.middlewareManager = new MiddlewareManager();
  }

  /**
   * 设置本地 Peer ID
   */
  setLocalPeerId(peerId: string): void {
    this.localPeerId = peerId;
  }

  /**
   * 设置回调函数
   */
  setCallbacks(callbacks: MessageDispatcherCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * 设置 Peer 表管理器
   */
  setPeerTableManager(manager: PeerTableManager): void {
    this.peerTableManager = manager;
  }

  /**
   * 停止速率限制器
   */
  stop(): void {
    this.discoverRateLimiter.stop();
    this.decryptFailedRateLimiter.stop();
  }

  // ========== 中间件管理 ==========

  /**
   * 注册中间件
   */
  useMiddleware(middleware: Middleware): void {
    this.middlewareManager.use(middleware);
  }

  /**
   * 移除中间件
   */
  removeMiddleware(name: string): boolean {
    return this.middlewareManager.remove(name);
  }

  /**
   * 列出中间件
   */
  listMiddlewares(): string[] {
    return this.middlewareManager.list();
  }

  // ========== 消息处理主流程 ==========

  /**
   * 处理收到的消息
   */
  async handleMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 1. 验证消息格式
    const validation = validateF2AMessage(message);
    if (!validation.success) {
      this.logger.warn('Invalid message format', {
        errors: validation.error.errors,
        peerId: peerId.slice(0, 16)
      });
      return;
    }

    this.logger.info('Received message', { type: message.type, peerId: peerId.slice(0, 16) });

    // 2. 更新 Peer 最后活跃时间
    if (this.peerTableManager) {
      const peerInfo = this.peerTableManager.getPeer(peerId);
      if (peerInfo) {
        peerInfo.lastSeen = Date.now();
      }
    }

    // 3. 处理加密消息
    const decryptResult = await this.handleEncryptedMessage(message, peerId);
    if (decryptResult.action === 'return') {
      return;
    }
    message = decryptResult.message;

    // 4. 执行中间件链
    const middlewareResult = await this.executeMiddleware(message, peerId);
    if (middlewareResult.action === 'drop') {
      this.logger.info('Message dropped by middleware', {
        reason: middlewareResult.reason,
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    message = middlewareResult.context.message;

    // 5. 根据消息类型分发处理
    await this.dispatchMessage(message, peerId);
  }

  /**
   * 执行中间件链
   */
  private async executeMiddleware(message: F2AMessage, peerId: string): Promise<MiddlewareResult> {
    const peerInfo = this.peerTableManager?.getPeer(peerId);
    
    return this.middlewareManager.execute({
      message,
      peerId,
      agentInfo: peerInfo?.agentInfo,
      metadata: new Map()
    });
  }

  // ========== 加密消息处理 ==========

  /**
   * 处理加密消息
   */
  private async handleEncryptedMessage(message: F2AMessage, peerId: string): Promise<DecryptResult> {
    if (!isEncryptedMessage(message)) {
      return { action: 'continue', message };
    }

    const encryptedPayload = message.payload;
    const decrypted = this.e2eeCrypto.decrypt(encryptedPayload);
    
    if (decrypted) {
      try {
        const decryptedMessage = JSON.parse(decrypted);
        
        // 安全验证：验证解密后的消息发送方身份
        if (encryptedPayload.senderPublicKey) {
          const verificationResult = this.verifySenderIdentity(
            decryptedMessage, 
            peerId, 
            encryptedPayload.senderPublicKey
          );
          if (!verificationResult.valid) {
            return { action: 'return', message };
          }
        }
        
        return { action: 'continue', message: decryptedMessage };
      } catch (error) {
        this.logger.error('Failed to parse decrypted message', { error });
        return { action: 'return', message };
      }
    }

    // 解密失败，通知发送方
    await this.sendDecryptFailureResponse(message.id, peerId);
    return { action: 'return', message };
  }

  /**
   * 验证发送方身份
   */
  private verifySenderIdentity(
    message: F2AMessage, 
    peerId: string, 
    senderPublicKey: string
  ): { valid: boolean } {
    const registeredKey = this.e2eeCrypto.getPeerPublicKey(peerId);
    if (registeredKey && registeredKey !== senderPublicKey) {
      this.logger.error('Sender identity verification failed: public key mismatch', {
        peerId: peerId.slice(0, 16),
        claimedKey: senderPublicKey.slice(0, 16),
        registeredKey: registeredKey.slice(0, 16)
      });
      return { valid: false };
    }
    
    if (message.from && message.from !== peerId) {
      this.logger.error('Sender identity verification failed: from field mismatch', {
        claimedFrom: message.from?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16)
      });
      return { valid: false };
    }
    
    return { valid: true };
  }

  /**
   * 发送解密失败响应
   */
  private async sendDecryptFailureResponse(originalMessageId: string, peerId: string): Promise<void> {
    this.logger.error('Failed to decrypt message', { peerId: peerId.slice(0, 16) });
    
    const decryptFailResponse: F2AMessage = {
      id: randomUUID(),
      type: 'DECRYPT_FAILED',
      from: this.localPeerId || '',
      to: peerId,
      timestamp: Date.now(),
      payload: {
        originalMessageId,
        error: 'DECRYPTION_FAILED',
        message: 'Unable to decrypt message. Key exchange may be incomplete or keys mismatched.'
      }
    };
    
    if (this.callbacks.sendMessage) {
      try {
        await this.callbacks.sendMessage(peerId, decryptFailResponse, false);
      } catch (sendError) {
        this.logger.error('Failed to send decrypt failure response', { 
          peerId: peerId.slice(0, 16),
          error: sendError 
        });
      }
    }
  }

  // ========== 消息分发 ==========

  /**
   * 根据消息类型分发处理
   */
  private async dispatchMessage(message: F2AMessage, peerId: string): Promise<void> {
    switch (message.type) {
      case 'DISCOVER':
        await this.handleDiscoverMessage(message, peerId, true);
        break;

      case 'DISCOVER_RESP':
        await this.handleDiscoverMessage(message, peerId, false);
        break;

      // CAPABILITY_QUERY, CAPABILITY_RESPONSE, TASK_RESPONSE 已废弃
      // 现在使用 MESSAGE 类型 + topic 字段区分
      // 参见 MESSAGE_TOPICS 常量

      case 'DECRYPT_FAILED':
        await this.handleDecryptFailedMessage(message, peerId);
        break;

      case 'MESSAGE':
        await this.handleFreeMessage(message, peerId);
        break;

      default:
        this.logger.warn('Unknown message type', { type: message.type, peerId: peerId.slice(0, 16) });
    }
  }

  // ========== 具体消息处理 ==========

  /**
   * 处理发现消息
   */
  private async handleDiscoverMessage(message: F2AMessage, peerId: string, shouldRespond: boolean): Promise<void> {
    // 速率限制检查
    if (!this.discoverRateLimiter.allowRequest(peerId)) {
      this.logger.warn('DISCOVER message rate limit exceeded, ignoring', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    
    const payload = message.payload as DiscoverPayload;
    
    if (this.callbacks.onDiscover) {
      await this.callbacks.onDiscover(payload.agentInfo, peerId, shouldRespond);
    }
  }

  /**
   * 处理解密失败通知消息
   */
  private async handleDecryptFailedMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 速率限制检查
    if (!this.decryptFailedRateLimiter.allowRequest(peerId)) {
      this.logger.warn('DECRYPT_FAILED message rate limit exceeded, ignoring', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    
    const { originalMessageId, error, message: errorMsg } = message.payload as {
      originalMessageId: string;
      error: string;
      message: string;
    };
    
    this.logger.error('Received decrypt failure notification', {
      peerId: peerId.slice(0, 16),
      originalMessageId,
      error,
      message: errorMsg
    });
    
    // 尝试重新注册公钥
    if (this.peerTableManager) {
      const peerInfo = this.peerTableManager.getPeer(peerId);
      if (peerInfo?.agentInfo?.encryptionPublicKey) {
        this.e2eeCrypto.registerPeerPublicKey(peerId, peerInfo.agentInfo.encryptionPublicKey);
        this.logger.info('Re-registered encryption key after decrypt failure', {
          peerId: peerId.slice(0, 16)
        });
      }
    }
    
    if (this.callbacks.onDecryptFailed) {
      await this.callbacks.onDecryptFailed(message, peerId);
    } else if (this.callbacks.onError) {
      this.callbacks.onError(new Error(`Decrypt failed for message ${originalMessageId}: ${errorMsg}`));
    }
  }

  /**
   * 处理自由消息
   */
  private async handleFreeMessage(message: F2AMessage, peerId: string): Promise<void> {
    const payload = message.payload as MessagePayload;
    this.logger.info('Received free message', {
      fromPeerId: peerId.slice(0, 16),
      contentLength: payload.content?.length || 0
    });

    if (this.callbacks.onFreeMessage) {
      await this.callbacks.onFreeMessage(message, peerId);
    }
  }
}

export default MessageDispatcher;