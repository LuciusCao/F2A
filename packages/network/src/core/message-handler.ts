/**
 * MessageHandler - P2P 消息处理器
 * 
 * 从 P2PNetwork 中提取的消息处理逻辑
 * 使用依赖注入模式，便于测试和维护
 */

import { randomUUID } from 'crypto';
import { multiaddr } from '@multiformats/multiaddr';

import type {
  F2AMessage,
  AgentInfo,
  StructuredMessagePayload,
  DiscoverPayload,
} from '../types/index.js';
import { MESSAGE_TOPICS as MSG_TOPICS } from '../types/index.js';
import type {
  MessageHandlerDeps,
  DecryptResult,
  SenderVerificationResult,
  MessageHandlerEvents
} from '../types/p2p-handlers.js';
import type { EncryptedMessage } from './e2ee-crypto.js';
import { validateF2AMessage, validateStructuredMessagePayload } from '../utils/validation.js';
import { isEncryptedMessage } from '../common/type-guards.js';

// 常量定义（从 p2p-network.ts 复制）
const PEER_TABLE_MAX_SIZE = 1000; // 最大peer数
const PEER_TABLE_HIGH_WATERMARK = 0.9; // 高水位线（90%触发主动清理）

/**
 * MessageHandler 类
 * 
 * 处理所有 P2P 消息的核心逻辑
 */
export class MessageHandler {
  private deps: MessageHandlerDeps;

  constructor(deps: MessageHandlerDeps) {
    this.deps = deps;
  }

  /**
   * 处理收到的消息
   */
  async handleMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 验证消息格式
    const validation = validateF2AMessage(message);
    if (!validation.success) {
      this.deps.logger.warn('Invalid message format', {
        errors: validation.error.errors,
        peerId: peerId.slice(0, 16)
      });
      return;
    }

    this.deps.logger.info('Received message', { type: message.type, peerId: peerId.slice(0, 16) });

    // 更新最后活跃时间
    const peerInfo = this.deps.peerManager.getPeerTable().get(peerId);
    if (peerInfo) {
      peerInfo.lastSeen = Date.now();
    }

    // 处理加密消息
    const decryptResult = await this.handleEncryptedMessage(message, peerId);
    if (decryptResult.action === 'return') {
      return;
    }
    message = decryptResult.message;

    // 执行中间件链
    const middlewareResult = await this.deps.middlewareManager.execute({
      message,
      peerId,
      agentInfo: peerInfo?.agentInfo,
      metadata: new Map()
    });

    if (middlewareResult.action === 'drop') {
      this.deps.logger.info('Message dropped by middleware', {
        reason: middlewareResult.reason,
        peerId: peerId.slice(0, 16)
      });
      return;
    }

    // 使用可能被中间件修改后的消息
    message = middlewareResult.context.message;

    // 根据消息类型分发处理
    await this.dispatchMessage(message, peerId);

    // 转发给上层处理
    this.deps.emitter.emit('message:received', message, peerId);
  }

  /**
   * 处理加密消息
   * @returns 处理结果，包含是否继续处理和解密后的消息
   */
  async handleEncryptedMessage(message: F2AMessage, peerId: string): Promise<DecryptResult> {
    if (!isEncryptedMessage(message)) {
      return { action: 'continue', message };
    }

    const encryptedPayload = message.payload as EncryptedMessage;
    const decrypted = this.deps.e2eeCrypto.decrypt(encryptedPayload);
    
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
        this.deps.logger.error('Failed to parse decrypted message', { error });
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
  verifySenderIdentity(
    message: F2AMessage, 
    peerId: string, 
    senderPublicKey: string
  ): SenderVerificationResult {
    // 验证发送方公钥是否已注册且属于该 peerId
    const registeredKey = this.deps.e2eeCrypto.getPeerPublicKey(peerId);
    if (registeredKey && registeredKey !== senderPublicKey) {
      this.deps.logger.error('Sender identity verification failed: public key mismatch', {
        peerId: peerId.slice(0, 16),
        claimedKey: senderPublicKey.slice(0, 16),
        registeredKey: registeredKey.slice(0, 16)
      });
      return { valid: false, reason: 'public key mismatch' };
    }
    
    // 如果发送方声称的身份与消息来源不匹配，拒绝处理
    if (message.from && message.from !== peerId) {
      this.deps.logger.error('Sender identity verification failed: from field mismatch', {
        claimedFrom: message.from?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16)
      });
      return { valid: false, reason: 'from field mismatch' };
    }
    
    return { valid: true };
  }

  /**
   * 发送解密失败响应
   */
  async sendDecryptFailureResponse(originalMessageId: string, peerId: string): Promise<void> {
    this.deps.logger.error('Failed to decrypt message', { peerId: peerId.slice(0, 16) });
    
    const decryptFailResponse: F2AMessage = {
      id: randomUUID(),
      type: 'DECRYPT_FAILED',
      from: this.deps.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: {
        originalMessageId,
        error: 'DECRYPTION_FAILED',
        message: 'Unable to decrypt message. Key exchange may be incomplete or keys mismatched.'
      }
    };
    
    try {
      await this.deps.sendMessage(peerId, decryptFailResponse, false);
    } catch (sendError) {
      this.deps.logger.error('Failed to send decrypt failure response', { 
        peerId: peerId.slice(0, 16),
        error: sendError 
      });
    }
  }

  /**
   * 根据消息类型分发处理
   * 网络层消息直接处理，Agent 协议层消息转发给上层
   */
  async dispatchMessage(message: F2AMessage, peerId: string): Promise<void> {
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

      case 'KEY_EXCHANGE':  // Phase 1: 处理公钥交换（委托给 P2PNetwork）
        await this.deps.onKeyExchange(message, peerId);
        break;

      case 'PING':
      case 'PONG':
        // 心跳消息由 libp2p 自动处理
        break;

      // Agent 协议层消息：MESSAGE 类型，根据 topic 分发
      case 'MESSAGE':
        await this.handleAgentMessage(message, peerId);
        break;
    }
  }

  /**
   * 处理 Agent 协议层消息（MESSAGE）
   * 根据 topic 区分不同类型的消息
   */
  async handleAgentMessage(message: F2AMessage, peerId: string): Promise<void> {
    // P0 修复：验证 MESSAGE payload 格式
    const validation = validateStructuredMessagePayload(message.payload);
    if (!validation.success) {
      this.deps.logger.warn('Invalid MESSAGE payload format', {
        errors: validation.error.errors,
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    // Zod validation ensures content is present, but TypeScript doesn't infer that
    // Use explicit cast to satisfy type checker
    const payload = validation.data as StructuredMessagePayload;
    const topic = payload.topic;

    // RFC 003: AgentId 签名验证
    // 如果 payload 中包含 AgentId 信息，验证签名
    if (this.deps.enableAgentIdVerification && this.deps.agentIdentityVerifier) {
      // 检查 payload 是否为 AgentMessagePayload 类型
      const agentPayload = payload as any;
      if (agentPayload.fromAgentId && agentPayload.fromSignature) {
        // RFC 003 P0-1 修复: 传递 Ed25519 公钥作为第3个参数，peerId 作为第4个参数
        const verifyResult = await this.deps.agentIdentityVerifier.verifyRemoteAgentId(
          agentPayload.fromAgentId,
          agentPayload.fromSignature,
          agentPayload.fromEd25519PublicKey, // Ed25519 公钥 (Base64)
          peerId // 发送方 PeerId (用于交叉验证)
        );
        
        if (!verifyResult.valid) {
          this.deps.logger.warn('[P2P] Invalid AgentId signature, message rejected', {
            fromAgentId: agentPayload.fromAgentId,
            peerId: peerId.slice(0, 16),
            error: verifyResult.error
          });
          
          // 发送安全事件
          this.deps.emitter.emit('security:invalid-signature', {
            agentId: agentPayload.fromAgentId,
            peerId,
            error: verifyResult.error
          });
          
          return; // 拒绝处理消息
        }
        
        this.deps.logger.info('[P2P] AgentId signature verified', {
          fromAgentId: agentPayload.fromAgentId,
          matchedPeerId: verifyResult.matchedPeerId?.slice(0, 16)
        });
      }
    }

    this.deps.logger.info('Received MESSAGE', {
      from: peerId.slice(0, 16),
      topic,
      contentLength: typeof payload.content === 'string' ? payload.content.length : 'object'
    });

    // 根据 topic 处理不同类型的消息
    if (topic === MSG_TOPICS.CAPABILITY_QUERY) {
      await this.handleCapabilityQuery(payload, peerId);
    } else if (topic === MSG_TOPICS.CAPABILITY_RESPONSE) {
      await this.handleCapabilityResponse(payload, peerId);
    } else if (topic === MSG_TOPICS.TASK_RESPONSE) {
      this.handleTaskResponse(payload);
    } else {
      // 其他消息（包括 task.request 和自由对话）转发给上层
      this.deps.emitter.emit('message:received', message, peerId);
    }
  }

  /**
   * 处理能力查询（MESSAGE + topic='capability.query'）
   */
  async handleCapabilityQuery(
    payload: StructuredMessagePayload,
    peerId: string
  ): Promise<void> {
    const content = payload.content as { capabilityName?: string; toolName?: string };
    const matches = !content.capabilityName || 
      this.hasCapability(this.deps.agentInfo, content.capabilityName);

    if (matches) {
      // 发送能力响应
      const responsePayload: StructuredMessagePayload = {
        topic: MSG_TOPICS.CAPABILITY_RESPONSE,
        content: { agentInfo: this.deps.agentInfo }
      };
      await this.deps.sendMessage(peerId, {
        id: randomUUID(),
        type: 'MESSAGE',
        from: this.deps.agentInfo.peerId,
        to: peerId,
        timestamp: Date.now(),
        payload: responsePayload
      });
    }
  }

  /**
   * 处理能力响应（MESSAGE + topic='capability.response'）
   */
  async handleCapabilityResponse(
    payload: StructuredMessagePayload,
    peerId: string
  ): Promise<void> {
    const content = payload.content as { agentInfo: AgentInfo };
    await this.upsertPeerFromAgentInfo(content.agentInfo, peerId);
  }

  /**
   * 处理任务响应（MESSAGE + topic='task.response'）
   * P0-1 修复：使用原子删除操作避免竞态条件
   */
  handleTaskResponse(payload: StructuredMessagePayload): void {
    const content = payload.content as {
      taskId: string;
      status: 'success' | 'error' | 'rejected' | 'delegated';
      result?: unknown;
      error?: string;
    };
    
    // P0-1 修复：先检查 resolved 标志
    const pending = this.deps.pendingTasks.get(content.taskId);
    if (!pending) {
      this.deps.logger.warn('Received response for unknown task', { taskId: content.taskId });
      return;
    }
    
    if (pending.resolved) {
      this.deps.logger.warn('Task already resolved, ignoring duplicate response', { taskId: content.taskId });
      return;
    }
    
    pending.resolved = true;
    this.deps.pendingTasks.delete(content.taskId);
    clearTimeout(pending.timeout);

    if (content.status === 'success') {
      pending.resolve(content.result);
    } else {
      pending.reject(content.error || 'Task failed');
    }
  }

  /**
   * 处理发现消息
   * P2-4 修复：添加速率限制，防止恶意节点大量发送 DISCOVER 消息
   */
  async handleDiscoverMessage(message: F2AMessage, peerId: string, shouldRespond: boolean): Promise<void> {
    // P2-4 修复：检查 DISCOVER 消息速率限制
    if (!this.deps.discoverRateLimiter.allowRequest(peerId)) {
      this.deps.logger.warn('DISCOVER message rate limit exceeded, ignoring', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    
    const payload = message.payload as DiscoverPayload;
    await this.handleDiscover(payload.agentInfo, peerId, shouldRespond);
  }

  /**
   * 处理解密失败通知消息（网络层协议）
   * P0-2 修复：添加速率限制，防止攻击者触发大量解密失败
   */
  async handleDecryptFailedMessage(message: F2AMessage, peerId: string): Promise<void> {
    // P0-2 修复：检查 DECRYPT_FAILED 消息速率限制
    if (!this.deps.decryptFailedRateLimiter.allowRequest(peerId)) {
      this.deps.logger.warn('DECRYPT_FAILED message rate limit exceeded, ignoring', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }
    
    const { originalMessageId, error, message: errorMsg } = message.payload as {
      originalMessageId: string;
      error: string;
      message: string;
    };
    
    this.deps.logger.error('Received decrypt failure notification', {
      peerId: peerId.slice(0, 16),
      originalMessageId,
      error,
      message: errorMsg
    });
    
    // 尝试重新注册公钥以重新建立加密通道
    const peerInfo = this.deps.peerManager.getPeerTable().get(peerId);
    if (peerInfo?.agentInfo?.encryptionPublicKey) {
      this.deps.e2eeCrypto.registerPeerPublicKey(peerId, peerInfo.agentInfo.encryptionPublicKey);
      this.deps.logger.info('Re-registered encryption key after decrypt failure', {
        peerId: peerId.slice(0, 16)
      });
    }
    
    // 发出事件通知上层应用
    this.deps.emitter.emit('error', new Error(`Decrypt failed for message ${originalMessageId}: ${errorMsg}`));
  }

  /**
   * 处理发现消息
   */
  async handleDiscover(agentInfo: AgentInfo, peerId: string, shouldRespond: boolean): Promise<void> {
    // 安全验证：确保 agentInfo.peerId 与发送方一致，防止伪造
    if (agentInfo.peerId !== peerId) {
      this.deps.logger.warn('Discovery message rejected: peerId mismatch', {
        claimedPeerId: agentInfo.peerId?.slice(0, 16),
        actualPeerId: peerId.slice(0, 16)
      });
      return;
    }

    // P1 修复：记录是否需要清理，在锁外执行
    let needsAggressiveCleanup = false;

    // 使用锁保护容量检查和创建操作的原子性
    // No longer needed - PeerManager handles locking internally
    // Old code used peerTableLock for atomic operations
    try {
      // 检查是否需要清理以腾出空间
      if (!this.deps.peerManager.getPeerTable().has(peerId)) {
        // 新 peer，需要检查容量
        const highWatermark = Math.floor(PEER_TABLE_MAX_SIZE * PEER_TABLE_HIGH_WATERMARK);
        if (this.deps.peerManager.getPeerTable().size >= highWatermark) {
          // P1 修复：不在锁内执行耗时清理，仅标记需要清理
          needsAggressiveCleanup = true;
        }
        
        if (this.deps.peerManager.getPeerTable().size >= PEER_TABLE_MAX_SIZE) {
          // 清理后仍无空间，拒绝新 peer
          this.deps.logger.warn('Peer table full, rejecting new peer', {
            peerId: peerId.slice(0, 16),
            currentSize: this.deps.peerManager.getPeerTable().size,
            maxSize: PEER_TABLE_MAX_SIZE
          });
          return;
        }
      }

      // 更新路由表
      const now = Date.now();
      const existing = this.deps.peerManager.getPeerTable().get(peerId);
      if (existing) {
        this.deps.peerManager.getPeerTable().set(peerId, {
          ...existing,
          agentInfo,
          lastSeen: now,
          multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma))
        });
      } else {
        this.deps.peerManager.getPeerTable().set(peerId, {
          peerId,
          agentInfo,
          multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma)),
          connected: false,
          reputation: 50,
          lastSeen: now
        });
      }
    } finally {
      // Lock no longer needed
    }

    // P1 修复：在锁外异步执行清理，避免阻塞并发操作
    if (needsAggressiveCleanup) {
      // 使用 setImmediate 异步执行，不阻塞当前操作
      setImmediate(() => {
        this.deps.peerManager.cleanupStale({ aggressive: true }).catch(err => {
          this.deps.logger.error('Background cleanup failed', { error: err });
        });
      });
    }

    // 注册对等方的加密公钥
    if (agentInfo.encryptionPublicKey) {
      this.deps.e2eeCrypto.registerPeerPublicKey(peerId, agentInfo.encryptionPublicKey);
      this.deps.logger.info('Registered encryption key', { peerId: peerId.slice(0, 16) });
    }

    // 仅对 DISCOVER 请求响应，避免发现响应循环
    if (shouldRespond) {
      this.deps.logger.info('Sending DISCOVER_RESP', { peerId: peerId.slice(0, 16) });
      
      try {
        await this.deps.sendMessage(peerId, {
          id: randomUUID(),
          type: 'DISCOVER_RESP',
          from: this.deps.agentInfo.peerId,
          to: peerId,
          timestamp: Date.now(),
          payload: { agentInfo: this.deps.agentInfo } as DiscoverPayload
        }, false); // DISCOVER_RESP 不需要加密

        this.deps.logger.info('Sent DISCOVER_RESP successfully', { peerId: peerId.slice(0, 16) });
      } catch (err) {
        this.deps.logger.error('Exception sending DISCOVER_RESP', {
          peerId: peerId.slice(0, 16),
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    this.deps.emitter.emit('peer:discovered', {
      peerId,
      agentInfo,
      multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma))
    });
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 检查 Agent 是否有特定能力
   */
  private hasCapability(agentInfo: AgentInfo, capabilityName: string): boolean {
    return agentInfo.capabilities.some(c => c.name === capabilityName);
  }

  /**
   * 将发现到的 Agent 信息更新到 Peer 表
   * P2-5 修复：改为 async/await 模式，确保锁正确等待
   */
  private async upsertPeerFromAgentInfo(agentInfo: AgentInfo, peerId: string): Promise<void> {
    // P2-5 修复：使用 async/await 确保锁正确等待
    // No longer needed - PeerManager handles locking internally
    // Old code used peerTableLock for atomic operations
    try {
      // 检查是否需要清理以腾出空间
      if (this.deps.peerManager.size() >= PEER_TABLE_MAX_SIZE && !this.deps.peerManager.get(peerId)) {
        this.deps.peerManager.cleanupStale({ aggressive: true }).catch(err => {
          this.deps.logger.error('Cleanup failed', { error: err });
        });
      }

      await this.deps.peerManager.upsert(peerId, {
        agentInfo,
        multiaddrs: agentInfo.multiaddrs.map(ma => multiaddr(ma)),
        connected: false,
        reputation: 50,
        lastSeen: Date.now()
      });
    } finally {
      // Lock no longer needed
    }

    // 注册对等方的加密公钥
    if (agentInfo.encryptionPublicKey) {
      this.deps.e2eeCrypto.registerPeerPublicKey(peerId, agentInfo.encryptionPublicKey);
      this.deps.logger.info('Registered encryption key', { peerId: peerId.slice(0, 16) });
    }
  }
}