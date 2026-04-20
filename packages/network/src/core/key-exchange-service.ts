/**
 * KeyExchangeService - E2EE 密钥交换服务
 * 
 * 处理 P2P 网络中的公钥交换：
 * - sendPublicKey: 发送本地公钥给 peer
 * - handleKeyExchange: 接收 peer 公钥并注册
 */

import { randomUUID } from 'crypto';
import type { F2AMessage, AgentInfo } from '../types/index.js';
import type { KeyExchangeServiceDeps } from '../types/p2p-handlers.js';

/**
 * KeyExchangeService - E2EE 密钥交换服务
 */
export class KeyExchangeService {
  private deps: KeyExchangeServiceDeps;
  private agentInfo: AgentInfo;

  constructor(deps: KeyExchangeServiceDeps, agentInfo: AgentInfo) {
    this.deps = deps;
    this.agentInfo = agentInfo;
  }

  /**
   * 发送本地公钥给 peer
   * 
   * @param peerId 目标 peer ID
   */
  async sendPublicKey(peerId: string): Promise<void> {
    if (!this.agentInfo.encryptionPublicKey) {
      this.deps.logger.warn('No public key available, skipping key exchange');
      return;
    }

    const keyExchangeMessage: F2AMessage = {
      id: randomUUID(),
      type: 'KEY_EXCHANGE',
      from: this.agentInfo.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: {
        publicKey: this.agentInfo.encryptionPublicKey
      }
    };

    await this.deps.sendMessage(peerId, keyExchangeMessage);
  }

  /**
   * 处理公钥交换消息
   * 
   * 接收 peer 的公钥并注册到 E2EECrypto
   * 如果本地尚未发送公钥，自动回复
   * 
   * @param message KEY_EXCHANGE 消息
   * @param peerId 发送方 peer ID
   */
  async handleKeyExchange(message: F2AMessage, peerId: string): Promise<void> {
    const { publicKey } = message.payload as { publicKey?: string };
    
    if (!publicKey) {
      this.deps.logger.warn('Received KEY_EXCHANGE without public key', {
        peerId: peerId.slice(0, 16)
      });
      return;
    }

    // 注册对方公钥
    this.deps.e2eeCrypto.registerPeerPublicKey(peerId, publicKey);
    this.deps.logger.info('Peer public key registered', {
      peerId: peerId.slice(0, 16),
      publicKey: publicKey.slice(0, 16)
    });

    // 如果还没有发送过公钥，回复自己的公钥
    if (!this.deps.e2eeCrypto.canEncryptTo(peerId)) {
      await this.sendPublicKey(peerId);
    }
  }
}