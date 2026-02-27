/**
 * F2A P2P Connection Manager
 * 
 * P2P 连接管理模块，管理 WebSocket/WebRTC 连接
 */

const EventEmitter = require('events');
const WebSocket = require('ws');

class P2PManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.connections = new Map(); // peerId -> connection
    this.heartbeatInterval = options.heartbeatInterval || 30000; // 30秒心跳
    this.heartbeatTimeout = options.heartbeatTimeout || 10000; // 10秒超时
    this.heartbeatTimers = new Map();
  }

  /**
   * 建立到 peer 的连接
   */
  async connect(peerId, peerAddress, options = {}) {
    // 如果已连接，返回现有连接
    if (this.connections.has(peerId)) {
      return this.connections.get(peerId);
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(peerAddress);
      
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('Connection timeout'));
      }, options.timeout || 10000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this._registerConnection(peerId, ws);
        resolve(ws);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * 注册连接
   */
  _registerConnection(peerId, ws) {
    this.connections.set(peerId, ws);
    
    // 监听消息
    ws.on('message', (data) => {
      this.emit('message', { peerId, data });
    });

    // 监听关闭
    ws.on('close', () => {
      this._cleanupConnection(peerId);
    });

    // 监听错误
    ws.on('error', (err) => {
      this.emit('error', { peerId, error: err });
    });

    // 启动心跳
    this._startHeartbeat(peerId);

    this.emit('connected', { peerId });
  }

  /**
   * 清理连接
   */
  _cleanupConnection(peerId) {
    this._stopHeartbeat(peerId);
    this.connections.delete(peerId);
    this.emit('disconnected', { peerId });
  }

  /**
   * 启动心跳
   */
  _startHeartbeat(peerId) {
    const timer = setInterval(() => {
      const ws = this.connections.get(peerId);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        this._cleanupConnection(peerId);
        return;
      }

      // 发送 ping
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      
      // 设置超时检测
      const timeout = setTimeout(() => {
        this.emit('heartbeat_timeout', { peerId });
        this.disconnect(peerId);
      }, this.heartbeatTimeout);
      
      this.heartbeatTimers.set(`${peerId}_timeout`, timeout);
    }, this.heartbeatInterval);

    this.heartbeatTimers.set(peerId, timer);
  }

  /**
   * 停止心跳
   */
  _stopHeartbeat(peerId) {
    const timer = this.heartbeatTimers.get(peerId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(peerId);
    }
    
    const timeout = this.heartbeatTimers.get(`${peerId}_timeout`);
    if (timeout) {
      clearTimeout(timeout);
      this.heartbeatTimers.delete(`${peerId}_timeout`);
    }
  }

  /**
   * 处理 pong 响应
   */
  handlePong(peerId) {
    const timeout = this.heartbeatTimers.get(`${peerId}_timeout`);
    if (timeout) {
      clearTimeout(timeout);
      this.heartbeatTimers.delete(`${peerId}_timeout`);
    }
  }

  /**
   * 发送消息给 peer
   */
  send(peerId, data) {
    const ws = this.connections.get(peerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Peer not connected: ${peerId}`);
    }
    
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    ws.send(message);
  }

  /**
   * 广播消息给所有连接的 peers
   */
  broadcast(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    for (const [peerId, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  /**
   * 断开指定 peer
   */
  disconnect(peerId) {
    const ws = this.connections.get(peerId);
    if (ws) {
      this._cleanupConnection(peerId);
      ws.close();
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll() {
    for (const peerId of this.connections.keys()) {
      this.disconnect(peerId);
    }
  }

  /**
   * 获取已连接 peers 列表
   */
  getConnectedPeers() {
    return Array.from(this.connections.keys());
  }

  /**
   * 检查 peer 是否已连接
   */
  isConnected(peerId) {
    const ws = this.connections.get(peerId);
    return ws && ws.readyState === WebSocket.OPEN;
  }
}

module.exports = { P2PManager };
