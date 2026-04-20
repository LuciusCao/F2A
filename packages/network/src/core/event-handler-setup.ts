/**
 * EventHandlerSetupService - libp2p 事件处理器设置服务
 * 
 * 从 P2PNetwork 中提取的事件绑定逻辑
 * 使用依赖注入模式，便于测试和维护
 */

import type { Libp2p } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';
import type { PeerId } from '@libp2p/interface';
import type { AgentInfo, F2AMessage } from '../types/index.js';
import type {
  EventHandlerSetupDeps,
  MessageHandlerLike,
  BoundEventHandlers
} from '../types/p2p-handlers.js';
import { getErrorMessage } from '../utils/error-utils.js';

// F2A 协议标识
const F2A_PROTOCOL = '/f2a/1.0.0';

/**
 * EventHandlerSetupService
 * 
 * 处理 libp2p 事件监听器的设置和清理
 */
export class EventHandlerSetupService {
  private deps: EventHandlerSetupDeps;
  private boundHandlers: BoundEventHandlers = {
    peerDiscovery: undefined,
    peerConnect: undefined,
    peerDisconnect: undefined
  };

  constructor(deps: EventHandlerSetupDeps) {
    this.deps = deps;
  }

  /**
   * 设置 libp2p 事件处理
   */
  setup(): void {
    // P1 修复：创建绑定的监听器并保存引用，用于 stop() 中移除
    this.boundHandlers.peerDiscovery = async (evt) => {
      try {
        await this.handlePeerDiscovery(evt);
      } catch (error) {
        this.deps.logger.error('Error in peer:discovery handler', {
          error: getErrorMessage(error)
        });
      }
    };

    // 新连接
    this.boundHandlers.peerConnect = async (evt) => {
      try {
        await this.handlePeerConnect(evt);
      } catch (error) {
        this.deps.logger.error('Error in peer:connect handler', {
          error: getErrorMessage(error)
        });
      }
    };

    // 断开连接
    this.boundHandlers.peerDisconnect = async (evt) => {
      try {
        await this.handlePeerDisconnect(evt);
      } catch (error) {
        this.deps.logger.error('Error in peer:disconnect handler', {
          error: getErrorMessage(error)
        });
      }
    };

    // 注册事件监听器
    this.deps.node.addEventListener('peer:discovery', this.boundHandlers.peerDiscovery);
    this.deps.node.addEventListener('peer:connect', this.boundHandlers.peerConnect);
    this.deps.node.addEventListener('peer:disconnect', this.boundHandlers.peerDisconnect);

    // 处理传入的协议流 (libp2p v3 Stream API)
    this.deps.node.handle(F2A_PROTOCOL, async (stream, connection) => {
      try {
        await this.handleProtocolStream(stream, connection);
      } catch (error) {
        this.deps.logger.error('Error handling message', { error });
      }
    });
  }

  /**
   * 移除所有事件监听器
   */
  teardown(): void {
    if (typeof this.deps.node.removeEventListener === 'function') {
      if (this.boundHandlers.peerDiscovery) {
        this.deps.node.removeEventListener('peer:discovery', this.boundHandlers.peerDiscovery);
      }
      if (this.boundHandlers.peerConnect) {
        this.deps.node.removeEventListener('peer:connect', this.boundHandlers.peerConnect);
      }
      if (this.boundHandlers.peerDisconnect) {
        this.deps.node.removeEventListener('peer:disconnect', this.boundHandlers.peerDisconnect);
      }
    }
  }

  /**
   * 获取绑定的事件处理器引用
   */
  getBoundHandlers(): BoundEventHandlers {
    return this.boundHandlers;
  }

  /**
   * 处理 peer:discovery 事件
   */
  private async handlePeerDiscovery(evt: CustomEvent<{ id: PeerId; multiaddrs: Multiaddr[] }>): Promise<void> {
    const peerId = evt.detail.id.toString();
    const multiaddrs = evt.detail.multiaddrs.map(ma => ma.toString());
    
    this.deps.logger.info('mDNS peer discovered', { 
      peerId: peerId.slice(0, 16),
      multiaddrs: multiaddrs.length 
    });

    // 更新路由表（使用 PeerManager）
    const now = Date.now();
    await this.deps.peerManager.upsert(peerId, {
      multiaddrs: evt.detail.multiaddrs,
      connected: false,
      reputation: 25, // mDNS 发现的节点信誉初始化为 25，表示"未验证"状态
      lastSeen: now
    });

    // 触发发现事件
    // P2 修复：mDNS 发现的 AgentInfo 使用占位符标记为"待验证"
    const pendingAgentInfo: AgentInfo = {
      peerId,
      multiaddrs,
      capabilities: [],
      displayName: `[Pending] ${peerId.slice(0, 8)}`,
      agentType: 'custom' as const,
      version: '0.0.0-pending',
      protocolVersion: '1.0.0',
      lastSeen: now
    };

    this.deps.onPeerDiscovered({
      peerId,
      agentInfo: pendingAgentInfo,
      multiaddrs: evt.detail.multiaddrs
    });

    // P1 修复：mDNS 发现后尝试连接并发送 DISCOVER 消息获取真实 AgentInfo
    await this.deps.sendDiscoverMessage(peerId, evt.detail.multiaddrs);
  }

  /**
   * 处理 peer:connect 事件
   */
  private async handlePeerConnect(evt: CustomEvent<PeerId>): Promise<void> {
    const peerId = evt.detail.toString();
    this.deps.logger.info('Peer connected', { peerId: peerId.slice(0, 16) });

    this.deps.onPeerConnected({
      peerId,
      direction: 'inbound'
    });

    // 从连接获取远程 multiaddr
    let multiaddrs: Multiaddr[] = [];
    try {
      const connections = this.deps.node.getConnections();
      const conn = connections.find(c => c.remotePeer.toString() === peerId);
      if (conn && conn.remoteAddr) {
        multiaddrs = [conn.remoteAddr];
      }
    } catch {
      // 无法获取 multiaddrs，使用空数组
    }

    // P2.4 修复：使用 PeerManager 更新路由表和连接索引
    const now = Date.now();
    await this.deps.peerManager.upsert(peerId, {
      multiaddrs,
      connected: true,
      connectedAt: now,
      lastSeen: now
    });
    
    // P2.4 修复：维护连接索引
    this.deps.peerManager.getConnectedPeersSet().add(peerId);
    
    // Phase 1 修复：连接建立后自动交换公钥
    if (this.deps.enableE2EE && this.deps.e2eeCrypto && this.deps.agentInfo.encryptionPublicKey) {
      try {
        await this.deps.keyExchangeService.sendPublicKey(peerId);
        this.deps.logger.info('Public key sent', { peerId: peerId.slice(0, 16) });
      } catch (err) {
        this.deps.logger.warn('Failed to send public key', { 
          peerId: peerId.slice(0, 16),
          error: getErrorMessage(err)
        });
      }
    }
  }

  /**
   * 处理 peer:disconnect 事件
   */
  private async handlePeerDisconnect(evt: CustomEvent<PeerId>): Promise<void> {
    const peerId = evt.detail.toString();
    this.deps.logger.info('Peer disconnected', { peerId: peerId.slice(0, 16) });

    this.deps.onPeerDisconnected({ peerId });

    // P2.4 修复：从连接索引中移除
    this.deps.peerManager.getConnectedPeersSet().delete(peerId);

    // P1-2 修复：清理对等方的加密资源
    this.deps.e2eeCrypto.unregisterPeer(peerId);

    // 使用 PeerManager 更新路由表（如果存在）
    const peer = this.deps.peerManager.get(peerId);
    if (peer) {
      await this.deps.peerManager.upsert(peerId, {
        connected: false,
        lastSeen: Date.now()
      });
    } else {
      // Peer 不在路由表中，记录警告但不创建条目（已断开）
      this.deps.logger.warn('Peer disconnected but not in routing table', { 
        peerId: peerId.slice(0, 16) 
      });
    }
  }

  /**
   * 处理 F2A 协议流
   */
  private async handleProtocolStream(
    stream: AsyncIterable<Uint8Array | { subarray(): Uint8Array }>,
    connection: { remotePeer: PeerId }
  ): Promise<void> {
    // 读取数据 - 使用异步迭代器
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      // chunk 可能是 Uint8Array 或 Uint8ArrayList
      const data = chunk instanceof Uint8Array 
        ? chunk 
        : new Uint8Array((chunk as { subarray(): Uint8Array }).subarray());
      chunks.push(data);
    }
    
    const data = Buffer.concat(chunks);
    
    // 安全解析 JSON，捕获解析错误
    let message: F2AMessage;
    try {
      message = JSON.parse(data.toString());
    } catch (parseError) {
      this.deps.logger.error('Failed to parse message JSON', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        dataSize: data.length,
        peerId: connection.remotePeer.toString().slice(0, 16)
      });
      return;
    }
    
    const peerId = connection.remotePeer.toString();

    // Phase 2: 使用 MessageHandler 处理消息
    await this.deps.messageHandler.handleMessage(message, peerId);
  }
}