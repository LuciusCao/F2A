/**
 * MessageHandler - 消息处理器
 * 
 * 负责：
 * - 接收消息分发处理
 * - 各类型消息的 handle 方法
 * - 消息验证/解密
 * - 使用事件机制发送响应消息
 * 
 * Phase 3a+3b: 从 P2PNetwork 中提取为独立类
 */

import { EventEmitter } from 'eventemitter3';
import { randomUUID } from 'crypto';
import { PeerManager } from './peer-manager.js';
import { E2EECrypto, EncryptedMessage } from './e2ee-crypto.js';
import { Logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { validateStructuredMessagePayload } from '../utils/validation.js';
import { isEncryptedMessage } from '../common/type-guards.js';
import type {
  F2AMessage,
  StructuredMessagePayload,
  AgentInfo,
  AgentCapability,
  MESSAGE_TOPICS,
} from '../types/index.js';
import { MESSAGE_TOPICS as TOPICS } from '../types/index.js';

export interface MessageHandlerEvents {
  /** 需要发送消息给 peer */
  'send': (data: { peerId: string; message: F2AMessage; encrypt?: boolean }) => void;
  /** 收到消息事件 */
  'message:received': (data: { message: F2AMessage; peerId: string }) => void;
  /** 能力查询事件 */
  'capability:query': (data: { peerId: string; capabilities: string[] }) => void;
  /** 能力响应事件 */
  'capability:response': (data: { peerId: string; capabilities: string[]; agentInfo?: AgentInfo }) => void;
  /** 任务响应事件 */
  'task:response': (data: { taskId: string; status: string; result?: unknown; error?: string }) => void;
  /** 发现消息事件 */
  'peer:discovered': (data: { peerId: string; agentInfo: AgentInfo }) => void;
  /** 安全事件 */
  'security:invalid-signature': (data: { agentId: string; peerId: string; error?: string }) => void;
  /** 错误事件 */
  'error': (error: Error) => void;
}

/**
 * 解密处理结果
 */
interface DecryptResult {
  success: boolean;
  decryptedMessage?: F2AMessage;
}

/**
 * 消息处理器配置
 */
export interface MessageHandlerOptions {
  peerManager: PeerManager;
  e2eeCrypto: E2EECrypto;
  agentInfo: AgentInfo;
  /** 是否启用 AgentId 签名验证 */
  enableAgentIdVerification?: boolean;
  /** AgentId 签名验证器（可选） */
  agentIdentityVerifier?: {
    verifyRemoteAgentId: (
      agentId: string,
      signature: string,
      ed25519PublicKey: string,
      peerId: string
    ) => Promise<{ valid: boolean; matchedPeerId?: string; error?: string }>;
  };
}

/**
 * 消息处理器
 * 使用事件机制与 P2PNetwork 通信
 */
export class MessageHandler extends EventEmitter<MessageHandlerEvents> {
  private peerManager: PeerManager;
  private e2eeCrypto: E2EECrypto;
  private rateLimiter: RateLimiter;
  private discoverRateLimiter: RateLimiter;
  private decryptFailedRateLimiter: RateLimiter;
  private logger: Logger;
  private agentInfo: AgentInfo;
  private enableAgentIdVerification: boolean;
  private agentIdentityVerifier?: MessageHandlerOptions['agentIdentityVerifier'];

  constructor(options: MessageHandlerOptions) {
    super();
    this.peerManager = options.peerManager;
    this.e2eeCrypto = options.e2eeCrypto;
    this.agentInfo = options.agentInfo;
    this.enableAgentIdVerification = options.enableAgentIdVerification ?? false;
    this.agentIdentityVerifier = options.agentIdentityVerifier;

    // 初始化速率限制器
    this.rateLimiter = new RateLimiter({ maxRequests: 100, windowMs: 60 * 1000 });
    this.discoverRateLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60 * 1000 });
    this.decryptFailedRateLimiter = new RateLimiter({ maxRequests: 5, windowMs: 60 * 1000 });

    this.logger = new Logger({ component: 'MessageHandler' });
  }

  /**
   * 停止处理器，清理资源
   */
  stop(): void {
    this.rateLimiter.stop();
    this.discoverRateLimiter.stop();
    this.decryptFailedRateLimiter.stop();
    this.logger.info('MessageHandler stopped');
  }

  /**
   * 处理消息
   * 1. 解密（如果加密）
   * 2. 分发到具体处理器
   */
  async handle(message: F2AMessage, peerId: string): Promise<void> {
    // 速率限制检查
    if (!this.rateLimiter.allowRequest(peerId)) {
      this.logger.warn('Rate limit exceeded, ignoring message', {
        peerId: peerId.slice(0, 16),
        messageId: message.id,
      });
      return;
    }

    // 处理加密消息
    if (isEncryptedMessage(message)) {
      const result = await this.handleEncryptedMessage(message, peerId);
      if (!result.success) {
        this.emit('send', {
          peerId,
          message: this.createDecryptFailedResponse(message.id, peerId),
          encrypt: false,
        });
        return;
      }
      message = result.decryptedMessage!;
    }

    // 分发消息
    await this.dispatchMessage(message, peerId);
  }

  /**
   * 处理加密消息
   */
  private async handleEncryptedMessage(
    message: F2AMessage,
    peerId: string
  ): Promise<DecryptResult> {
    const encryptedPayload = message.payload as EncryptedMessage;

    try {
      const decrypted = this.e2eeCrypto.decrypt(encryptedPayload);
      if (!decrypted) {
        this.logger.error('Decryption failed', { peerId: peerId.slice(0, 16) });
        return { success: false };
      }

      const decryptedMessage = JSON.parse(decrypted) as F2AMessage;

      // 安全验证：验证解密后的消息发送方身份
      if (encryptedPayload.senderPublicKey) {
        const verificationResult = this.verifySenderIdentity(
          decryptedMessage,
          peerId,
          encryptedPayload.senderPublicKey
        );
        if (!verificationResult.valid) {
          return { success: false };
        }
      }

      return { success: true, decryptedMessage };
    } catch (error) {
      this.logger.error('Failed to parse decrypted message', { error });
      return { success: false };
    }
  }

  /**
   * 验证发送方身份
   */
  private verifySenderIdentity(
    message: F2AMessage,
    peerId: string,
    senderPublicKey: string
  ): { valid: boolean } {
    // 验证发送方公钥是否已注册且属于该 peerId
    const registeredKey = this.e2eeCrypto.getPeerPublicKey(peerId);
    if (registeredKey && registeredKey !== senderPublicKey) {
      this.logger.error('Sender identity verification failed: public key mismatch', {
        peerId: peerId.slice(0, 16),
        claimedKey: senderPublicKey.slice(0, 16),
        registeredKey: registeredKey.slice(0, 16),
      });
      return { valid: false };
    }

    // 如果发送方声称的身份与消息来源不匹配，拒绝处理
    if (message.from && message.from !== peerId) {
      this.logger.error('Sender identity verification failed: from field mismatch', {
        claimedFrom: message.from?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16),
      });
      return { valid: false };
    }

    return { valid: true };
  }

  /**
   * 创建解密失败响应
   */
  private createDecryptFailedResponse(originalMessageId: string, peerId: string): F2AMessage {
    return {
      id: randomUUID(),
      type: 'DECRYPT_FAILED',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: {
        originalMessageId,
        error: 'DECRYPTION_FAILED',
        message: 'Unable to decrypt message. Key exchange may be incomplete or keys mismatched.',
      },
    };
  }

  /**
   * 分发消息到具体处理器
   */
  private async dispatchMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 网络层消息处理
    switch (message.type) {
      case 'DISCOVER':
        await this.handleDiscoverMessage(message, peerId, true);
        break;

      case 'DISCOVER_RESP':
        await this.handleDiscoverMessage(message, peerId, false);
        break;

      case 'DECRYPT_FAILED':
        await this.handleDecryptFailedMessage(message, peerId);
        break;

      case 'KEY_EXCHANGE':
        await this.handleKeyExchange(message, peerId);
        break;

      case 'PING':
      case 'PONG':
        // 心跳消息由 libp2p 自动处理
        break;

      case 'MESSAGE':
        await this.handleAgentMessage(message, peerId);
        break;

      default:
        this.logger.warn('Unknown message type', { type: message.type, peerId: peerId.slice(0, 16) });
        // Unknown types still emit message:received for forward compatibility
        this.emit('message:received', { message, peerId });
    }
  }

  /**
   * 处理 Agent 协议层消息（MESSAGE）
   */
  private async handleAgentMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 验证 MESSAGE payload 格式
    const validation = validateStructuredMessagePayload(message.payload);
    if (!validation.success) {
      this.logger.warn('Invalid MESSAGE payload format', {
        errors: validation.error.errors,
        peerId: peerId.slice(0, 16),
      });
      return;
    }
    const payload = validation.data;
    const topic = payload.topic;

    // RFC 003: AgentId 签名验证
    if (this.enableAgentIdVerification && this.agentIdentityVerifier) {
      const agentPayload = payload as any;
      if (agentPayload.fromAgentId && agentPayload.fromSignature) {
        const verifyResult = await this.agentIdentityVerifier.verifyRemoteAgentId(
          agentPayload.fromAgentId,
          agentPayload.fromSignature,
          agentPayload.fromEd25519PublicKey,
          peerId
        );

        if (!verifyResult.valid) {
          this.logger.warn('Invalid AgentId signature, message rejected', {
            fromAgentId: agentPayload.fromAgentId,
            peerId: peerId.slice(0, 16),
            error: verifyResult.error,
          });

          this.emit('security:invalid-signature', {
            agentId: agentPayload.fromAgentId,
            peerId,
            error: verifyResult.error,
          });

          return;
        }

        this.logger.info('AgentId signature verified', {
          fromAgentId: agentPayload.fromAgentId,
          matchedPeerId: verifyResult.matchedPeerId?.slice(0, 16),
        });
      }
    }

    this.logger.info('Received MESSAGE', {
      from: peerId.slice(0, 16),
      topic,
      contentLength: typeof payload.content === 'string' ? payload.content.length : 'object',
    });

    // 根据 topic 处理不同类型的消息
    switch (topic) {
      case TOPICS.CAPABILITY_QUERY:
        await this.handleCapabilityQuery(payload as StructuredMessagePayload, peerId);
        break;
      case TOPICS.CAPABILITY_RESPONSE:
        await this.handleCapabilityResponse(payload as StructuredMessagePayload, peerId);
        break;
      case TOPICS.TASK_RESPONSE:
        this.handleTaskResponse(payload as StructuredMessagePayload);
        break;
      default:
        // 其他消息转发给上层（包括 TASK_REQUEST 和 FREE_CHAT）
        this.emit('message:received', { message, peerId });
    }
  }

  /**
   * 处理发现消息
   */
  private async handleDiscoverMessage(
    message: F2AMessage,
    peerId: string,
    shouldRespond: boolean
  ): Promise<void> {
    // 速率限制检查
    if (!this.discoverRateLimiter.allowRequest(peerId)) {
      this.logger.warn('DISCOVER rate limit exceeded', { peerId: peerId.slice(0, 16) });
      return;
    }

    const payload = message.payload as { agentInfo?: AgentInfo };
    if (!payload.agentInfo) {
      this.logger.warn('DISCOVER message missing agentInfo', { peerId: peerId.slice(0, 16) });
      return;
    }

    // 安全验证：确保 agentInfo.peerId 与发送方一致
    if (payload.agentInfo.peerId !== peerId) {
      this.logger.warn('Discovery message rejected: peerId mismatch', {
        claimedPeerId: payload.agentInfo.peerId?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16),
      });
      return;
    }

    // 更新 PeerManager
    await this.peerManager.upsertFromAgentInfo(payload.agentInfo, peerId);

    // 注册加密公钥
    if (payload.agentInfo.encryptionPublicKey) {
      this.e2eeCrypto.registerPeerPublicKey(peerId, payload.agentInfo.encryptionPublicKey);
      this.logger.info('Registered encryption key from DISCOVER', {
        peerId: peerId.slice(0, 16),
      });
    }

    // 发出发现事件
    this.emit('peer:discovered', { peerId, agentInfo: payload.agentInfo });

    // 仅对 DISCOVER 请求响应，避免发现响应循环
    if (shouldRespond) {
      this.emit('send', {
        peerId,
        message: this.createDiscoverResponse(peerId),
        encrypt: false,
      });
    }
  }

  /**
   * 创建发现响应
   */
  private createDiscoverResponse(peerId: string): F2AMessage {
    return {
      id: randomUUID(),
      type: 'DISCOVER_RESP',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: { agentInfo: this.agentInfo },
    };
  }

  /**
   * 处理能力查询
   */
  private async handleCapabilityQuery(
    payload: StructuredMessagePayload,
    peerId: string
  ): Promise<void> {
    const content = payload.content as { capabilityName?: string; toolName?: string };

    this.emit('capability:query', {
      peerId,
      capabilities: content.capabilityName ? [content.capabilityName] : [],
    });

    // 检查是否有匹配的能力
    const matches = !content.capabilityName || this.hasCapability(this.agentInfo, content.capabilityName);

    if (matches) {
      // 发送能力响应
      this.emit('send', {
        peerId,
        message: {
          id: randomUUID(),
          type: 'MESSAGE',
          from: this.agentInfo.peerId,
          to: peerId,
          timestamp: Date.now(),
          payload: {
            topic: TOPICS.CAPABILITY_RESPONSE,
            content: { agentInfo: this.agentInfo },
          } as StructuredMessagePayload,
        },
        encrypt: true,
      });
    }
  }

  /**
   * 检查是否具有指定能力
   */
  private hasCapability(agentInfo: AgentInfo, capabilityName: string): boolean {
    return agentInfo.capabilities.some(
      (cap: AgentCapability) => cap.name === capabilityName || cap.tools.includes(capabilityName)
    );
  }

  /**
   * 处理能力响应
   */
  private async handleCapabilityResponse(
    payload: StructuredMessagePayload,
    peerId: string
  ): Promise<void> {
    const content = payload.content as { agentInfo?: AgentInfo; capabilities?: string[] };

    if (content.agentInfo) {
      await this.peerManager.upsertFromAgentInfo(content.agentInfo, peerId);
    }

    this.emit('capability:response', {
      peerId,
      capabilities: content.capabilities || [],
      agentInfo: content.agentInfo,
    });
  }

  /**
   * 处理任务响应
   */
  private handleTaskResponse(payload: StructuredMessagePayload): void {
    const content = payload.content as {
      taskId: string;
      status: 'success' | 'error' | 'rejected' | 'delegated';
      result?: unknown;
      error?: string;
    };

    this.emit('task:response', {
      taskId: content.taskId,
      status: content.status,
      result: content.result,
      error: content.error,
    });
  }

  /**
   * 处理密钥交换消息
   */
  private async handleKeyExchange(message: F2AMessage, peerId: string): Promise<void> {
    const payload = message.payload as { publicKey?: string };

    if (!payload.publicKey) {
      this.logger.warn('KEY_EXCHANGE missing public key', { peerId: peerId.slice(0, 16) });
      return;
    }

    // 注册对方公钥
    this.e2eeCrypto.registerPeerPublicKey(peerId, payload.publicKey);
    this.logger.info('Peer public key registered', {
      peerId: peerId.slice(0, 16),
      publicKey: payload.publicKey.slice(0, 16),
    });

    // 如果还没有发送过公钥，回复自己的公钥
    if (!this.e2eeCrypto.canEncryptTo(peerId)) {
      await this.sendPublicKey(peerId);
    }
  }

  /**
   * 发送公钥给指定 Peer
   */
  async sendPublicKey(peerId: string): Promise<void> {
    const publicKey = this.e2eeCrypto.getPublicKey();
    if (!publicKey) {
      this.logger.warn('No public key available, skipping key exchange');
      return;
    }

    this.emit('send', {
      peerId,
      message: {
        id: randomUUID(),
        type: 'KEY_EXCHANGE',
        from: this.agentInfo.peerId,
        to: peerId,
        timestamp: Date.now(),
        payload: { publicKey },
      },
      encrypt: false,
    });
  }

  /**
   * 处理解密失败通知消息
   */
  private async handleDecryptFailedMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 速率限制检查
    if (!this.decryptFailedRateLimiter.allowRequest(peerId)) {
      this.logger.warn('DECRYPT_FAILED rate limit exceeded', { peerId: peerId.slice(0, 16) });
      return;
    }

    const payload = message.payload as {
      originalMessageId: string;
      error: string;
      message: string;
    };

    this.logger.error('Received decrypt failure notification', {
      peerId: peerId.slice(0, 16),
      originalMessageId: payload.originalMessageId,
      error: payload.error,
    });

    // 尝试重新注册公钥以重新建立加密通道
    const peerInfo = this.peerManager.get(peerId);
    if (peerInfo?.agentInfo?.encryptionPublicKey) {
      this.e2eeCrypto.registerPeerPublicKey(peerId, peerInfo.agentInfo.encryptionPublicKey);
      this.logger.info('Re-registered encryption key after decrypt failure', {
        peerId: peerId.slice(0, 16),
      });
    }

    // 发出错误事件
    this.emit(
      'error',
      new Error(`Decrypt failed for message ${payload.originalMessageId}: ${payload.message}`)
    );
  }

  /**
   * 更新 AgentInfo
   */
  updateAgentInfo(agentInfo: AgentInfo): void {
    this.agentInfo = agentInfo;
  }

  /**
   * 获取当前 AgentInfo
   */
  getAgentInfo(): AgentInfo {
    return this.agentInfo;
  }
}