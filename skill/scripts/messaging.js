/**
 * F2A Messaging Module
 * 
 * Agent 间消息通信模块
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class Messaging extends EventEmitter {
  constructor(options = {}) {
    super();
    this.peers = new Map(); // peerId -> connection
    this.pendingMessages = new Map(); // messageId -> { resolve, reject, timeout, createdAt }
    this.messageTimeout = options.messageTimeout || 30000; // 30秒超时
    this.cleanupInterval = null;
    
    // 启动定期清理
    this._startCleanupInterval();
  }

  /**
   * 启动定期清理任务
   */
  _startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this._cleanupPendingMessages();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 清理过期的 pending messages
   */
  _cleanupPendingMessages() {
    const now = Date.now();
    const timeout = this.messageTimeout * 2; // 2倍超时时间作为清理阈值
    
    for (const [id, pending] of this.pendingMessages) {
      if (pending.createdAt && now - pending.createdAt > timeout) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Message expired'));
        this.pendingMessages.delete(id);
      }
    }
  }

  /**
   * 停止清理任务
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    // 清理所有 pending messages
    for (const [id, pending] of this.pendingMessages) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Messaging stopped'));
    }
    this.pendingMessages.clear();
    this.disconnectAll();
  }

  /**
   * 注册 peer 连接
   */
  registerPeer(peerId, connection) {
    this.peers.set(peerId, connection);
    
    // 监听消息
    connection.on('message', (data) => {
      this._handleMessage(peerId, data);
    });
    
    // 监听断开
    connection.on('close', () => {
      // 检查是否已经被 disconnectPeer 处理过
      if (!this.peers.has(peerId)) {
        return; // 已被手动处理，跳过
      }
      this._cleanupPeerMessages(peerId);
      this.peers.delete(peerId);
      this.emit('peer_disconnected', { peerId });
    });
  }

  /**
   * 发送消息给指定 peer
   */
  async sendMessage(peerId, content, options = {}) {
    const connection = this.peers.get(peerId);
    if (!connection) {
      throw new Error(`Peer not connected: ${peerId}`);
    }

    const message = {
      type: 'message',
      id: crypto.randomUUID(),
      from: options.myAgentId,
      to: peerId,
      content,
      timestamp: Date.now(),
      requireAck: options.requireAck !== false
    };

    // 签名消息
    if (options.sign) {
      message.signature = this._signMessage(message, options.privateKey);
    }

    return new Promise((resolve, reject) => {
      // 发送消息
      connection.send(JSON.stringify(message));

      // 如果需要确认，设置超时并跟踪
      if (message.requireAck) {
        const timeout = setTimeout(() => {
          this.pendingMessages.delete(message.id);
          reject(new Error('Message timeout'));
        }, this.messageTimeout);
        
        this.pendingMessages.set(message.id, { 
          resolve, 
          reject, 
          timeout,
          createdAt: Date.now(),
          peerId // 记录 peerId 用于连接断开时清理
        });
      } else {
        // 不需要确认，直接 resolve
        resolve({ messageId: message.id, status: 'sent' });
      }
    });
  }

  /**
   * 广播消息给所有连接的 peers
   */
  async broadcast(content, options = {}) {
    const results = [];
    for (const [peerId] of this.peers) {
      try {
        const result = await this.sendMessage(peerId, content, options);
        results.push({ peerId, status: 'success', result });
      } catch (err) {
        results.push({ peerId, status: 'error', error: err.message });
      }
    }
    return results;
  }

  /**
   * 处理收到的消息
   */
  _handleMessage(peerId, data) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'message':
          this._handleChatMessage(peerId, message);
          break;
        case 'message_ack':
          this._handleMessageAck(message);
          break;
        case 'ping':
          this._handlePing(peerId);
          break;
        default:
          // 其他消息类型由上层处理
          this.emit('raw_message', { peerId, message });
      }
    } catch (err) {
      this.emit('error', { peerId, error: err.message });
    }
  }

  /**
   * 处理聊天消息
   */
  _handleChatMessage(peerId, message) {
    // 发送确认
    if (message.requireAck) {
      const ack = {
        type: 'message_ack',
        messageId: message.id,
        timestamp: Date.now()
      };
      const connection = this.peers.get(peerId);
      if (connection) {
        connection.send(JSON.stringify(ack));
      }
    }

    // 触发事件
    this.emit('message', {
      from: message.from,
      content: message.content,
      timestamp: message.timestamp,
      messageId: message.id
    });
  }

  /**
   * 处理消息确认
   */
  _handleMessageAck(message) {
    const pending = this.pendingMessages.get(message.messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMessages.delete(message.messageId);
      pending.resolve({
        messageId: message.messageId,
        status: 'delivered',
        deliveredAt: message.timestamp
      });
    }
  }

  /**
   * 处理心跳
   */
  _handlePing(peerId) {
    const connection = this.peers.get(peerId);
    if (connection) {
      connection.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  }

  /**
   * 签名消息
   * 支持 Ed25519 密钥 (使用 crypto.sign) 和 RSA 密钥 (使用 createSign)
   */
  _signMessage(message, privateKey) {
    const data = JSON.stringify({
      id: message.id,
      from: message.from,
      to: message.to,
      content: message.content,
      timestamp: message.timestamp
    });
    
    const privateKeyObj = crypto.createPrivateKey(privateKey);
    
    // Ed25519 需要 crypto.sign()，RSA 需要 createSign()
    // 通过密钥类型判断使用哪种方式
    if (privateKeyObj.asymmetricKeyType === 'ed25519') {
      const signature = crypto.sign(null, Buffer.from(data), privateKeyObj);
      return signature.toString('base64');
    } else {
      // RSA 或其他支持 createSign 的算法
      const sign = crypto.createSign('SHA256');
      sign.update(data);
      sign.end();
      return sign.sign(privateKey, 'base64');
    }
  }

  /**
   * 获取已连接 peers 列表
   */
  getConnectedPeers() {
    return Array.from(this.peers.keys());
  }

  /**
   * 断开指定 peer，并清理相关 pending 消息
   */
  disconnectPeer(peerId) {
    const connection = this.peers.get(peerId);
    if (!connection) return;
    
    // 从 peers 中移除（避免 'close' 事件再次处理）
    this.peers.delete(peerId);
    
    // 清理该 peer 相关的 pending messages
    this._cleanupPeerMessages(peerId);
    
    // 关闭连接（此时 'close' 事件不会重复处理，因为 peer 已从 map 中移除）
    connection.close();
    
    // 触发断开事件
    this.emit('peer_disconnected', { peerId });
  }

  /**
   * 清理指定 peer 相关的 pending messages
   */
  _cleanupPeerMessages(peerId) {
    for (const [id, pending] of this.pendingMessages) {
      if (pending.peerId === peerId) {
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.reject(new Error('Peer disconnected'));
        this.pendingMessages.delete(id);
      }
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll() {
    for (const [peerId] of this.peers) {
      this.disconnectPeer(peerId);
    }
  }
}

module.exports = { Messaging };
