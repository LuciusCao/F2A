/**
 * MessageSender - P2P 消息发送器
 * 
 * 从 P2PNetwork 中提取的消息发送逻辑
 * 使用依赖注入模式，便于测试和维护
 */

import type { Libp2p } from '@libp2p/interface';
import type { F2AMessage } from '../types/index.js';
import type { MessageSenderDeps } from '../types/p2p-handlers.js';
import type { Result } from '../types/index.js';
import { success, failureFromError } from '../types/index.js';
import { getErrorMessage } from '../utils/error-utils.js';

// F2A 协议标识
const F2A_PROTOCOL = '/f2a/1.0.0';

/**
 * MessageSender
 * 
 * 处理 P2P 消息的发送和广播
 */
export class MessageSender {
  private deps: MessageSenderDeps;

  constructor(deps: MessageSenderDeps) {
    this.deps = deps;
  }

  /**
   * 向特定 Peer 发送消息
   * @param peerId 目标 Peer ID
   * @param message 消息内容
   * @param encrypt 是否启用 E2EE 加密（默认 false，发现类消息不需要加密）
   */
  async send(peerId: string, message: F2AMessage, encrypt: boolean = false): Promise<Result<void>> {
    if (!this.deps.node) {
      return failureFromError('NETWORK_NOT_STARTED', 'P2P network not started');
    }

    try {
      // 【关键修复】优先使用 connectedPeers 索引判断连接状态
      const isConnected = this.deps.peerManager.getConnectedPeersSet().has(peerId);
      
      let connection;
      if (isConnected) {
        // 连接索引显示已连接，获取连接对象
        const connections = this.deps.node.getConnections();
        connection = connections.find(c => c.remotePeer.toString() === peerId);
        
        if (!connection) {
          // 【防御性代码】索引有记录但 libp2p 没有 = 状态不一致
          // 清除索引，触发重新连接
          this.deps.logger.warn('Connection index inconsistent, clearing', {
            peerId: peerId.slice(0, 16)
          });
          this.deps.peerManager.getConnectedPeersSet().delete(peerId);
        }
      }
      
      if (!connection) {
        // 未连接，需要 dial
        const peerInfo = this.deps.peerManager.getPeerTable().get(peerId);
        if (!peerInfo || peerInfo.multiaddrs.length === 0) {
          return failureFromError('PEER_NOT_FOUND', `Peer ${peerId} not found`);
        }
        
        // 选择合适的 multiaddr（过滤掉 localhost）
        connection = await this.dialPeer(peerId, peerInfo.multiaddrs);
      }

      // 准备消息数据（根据是否启用 E2EE 加密）
      let data: Buffer | null = null;
      if (encrypt && this.deps.enableE2EE) {
        data = await this.encryptMessage(peerId, message);
        if (!data) {
          return failureFromError(
            'ENCRYPTION_FAILED',
            'Failed to encrypt message. Cannot proceed in secure mode.'
          );
        }
      } else {
        data = Buffer.from(JSON.stringify(message));
      }

      // 使用协议流发送消息 (libp2p v3 Stream API)
      const result = await this.sendViaStream(peerId, connection, data!);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return failureFromError('CONNECTION_FAILED', err.message, err);
    }
  }

  /**
   * 广播消息到全网
   */
  async broadcast(message: F2AMessage): Promise<void> {
    if (!this.deps.node) return;

    // 使用 connectedPeers 而非 node.getPeers()
    const connectedPeerIds = Array.from(this.deps.peerManager.getConnectedPeersSet());
    
    if (connectedPeerIds.length === 0) {
      this.deps.logger.debug('No connected peers to broadcast to');
      return;
    }
    
    const results = await Promise.allSettled(
      connectedPeerIds.map(peerId => this.send(peerId, message))
    );

    // 记录发送失败的情况（包含详细错误信息）
    const failures: Array<{ peerId: string; error: string }> = [];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failures.push({
          peerId: connectedPeerIds[index].toString().slice(0, 16),
          error: result.reason?.message || String(result.reason)
        });
      } else if (!result.value.success) {
        failures.push({
          peerId: connectedPeerIds[index].toString().slice(0, 16),
          error: result.value.error?.message || 'Unknown error'
        });
      }
    });

    if (failures.length > 0) {
      this.deps.logger.warn('Broadcast failed to some peers', {
        failed: failures.length,
        total: connectedPeerIds.length,
        details: failures
      });
    }
  }

  /**
   * Dial 到指定 peer
   */
  private async dialPeer(peerId: string, multiaddrs: unknown[]): Promise<unknown> {
    // 【关键修复】选择合适的 multiaddr（过滤掉 localhost）
    const localhostPatterns = [/127\.0\.0\.1/, /0\.0\.0\.0/, /::1/, /localhost/];
    const isLocalhost = (addr: unknown) => 
      typeof addr === 'object' && addr !== null && 
      localhostPatterns.some(p => p.test(String(addr)));
    
    const nonLocalhostAddrs = multiaddrs.filter(addr => !isLocalhost(addr));
    
    // 优先使用非 localhost 地址，如果没有则使用 localhost（本地测试场景）
    const targetAddr = nonLocalhostAddrs.length > 0 
      ? nonLocalhostAddrs[0] 
      : multiaddrs[0];
    
    this.deps.logger.debug('Dialing peer', {
      peerId: peerId.slice(0, 16),
      targetAddr: String(targetAddr).slice(0, 50),
      totalAddrs: multiaddrs.length,
      nonLocalhostAddrs: nonLocalhostAddrs.length
    });
    
    return await this.deps.node.dial(targetAddr as any);
  }

  /**
   * 加密消息
   */
  private async encryptMessage(peerId: string, message: F2AMessage): Promise<Buffer | null> {
    // 检查是否有共享密钥
    if (!this.deps.e2eeCrypto.canEncryptTo(peerId)) {
      return null;
    }

    // 加密消息内容
    const encrypted = this.deps.e2eeCrypto.encrypt(peerId, JSON.stringify(message));
    if (!encrypted) {
      return null;
    }

    return Buffer.from(JSON.stringify({
      ...message,
      encrypted: true,
      payload: encrypted
    }));
  }

  /**
   * 通过 stream 发送数据
   */
  private async sendViaStream(peerId: string, connection: any, data: Buffer): Promise<Result<void>> {
    let stream;
    try {
      stream = await connection.newStream(F2A_PROTOCOL);
    } catch (newStreamError) {
      // newStream 失败可能是连接已关闭，尝试重新 dial
      this.deps.logger.warn('Failed to create stream, reconnecting', {
        peerId: peerId.slice(0, 16),
        error: getErrorMessage(newStreamError)
      });
      
      // 清除连接索引
      this.deps.peerManager.getConnectedPeersSet().delete(peerId);
      
      const peerInfo = this.deps.peerManager.getPeerTable().get(peerId);
      if (peerInfo && peerInfo.multiaddrs.length > 0) {
        try {
          connection = await this.dialPeer(peerId, peerInfo.multiaddrs);
          stream = await connection.newStream(F2A_PROTOCOL);
        } catch (dialError) {
          return failureFromError('CONNECTION_FAILED', `Failed to reconnect: ${getErrorMessage(dialError)}`);
        }
      } else {
        return failureFromError('CONNECTION_FAILED', getErrorMessage(newStreamError));
      }
    }
    
    try {
      await stream.send(data);
      // 发送后关闭写入端，让接收方知道数据发送完毕
      await (stream as any).sendCloseWrite?.();
    } catch (streamError) {
      // 发送失败，清除连接索引
      this.deps.peerManager.getConnectedPeersSet().delete(peerId);
      // 发送失败时确保 stream 被关闭
      try { await stream.close(); } catch {}
      throw streamError;
    }

    return success(undefined);
  }

  /**
   * 更新节点引用（用于节点启动后）
   */
  setNode(node: Libp2p): void {
    this.deps = { ...this.deps, node };
  }
}