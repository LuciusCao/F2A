/**
 * F2A Connection Manager
 * 
 * 管理待确认连接请求，支持：
 * - 1小时有效期
 * - 同一 Agent 去重（保留最新）
 * - 查询待确认列表
 * - 通过序号或 ID 确认/拒绝
 */

const crypto = require('crypto');
const EventEmitter = require('events');

// 常量
const PENDING_TIMEOUT = 60 * 60 * 1000; // 1小时
const CLEANUP_INTERVAL = 60 * 1000; // 每分钟清理一次

class ConnectionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 待确认连接: confirmationId -> { agentId, socket, publicKey, address, port, timestamp, expiresAt }
    this.pendingConnections = new Map();
    
    // Agent ID -> confirmationId 映射（用于去重）
    this.agentToConfirmation = new Map();
    
    // 序号计数器
    this.indexCounter = 1;
    
    // 启动清理定时器
    this._startCleanup();
  }
  
  /**
   * 启动定期清理任务
   */
  _startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this._cleanup();
    }, CLEANUP_INTERVAL);
  }
  
  /**
   * 清理过期连接
   */
  _cleanup() {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [confirmationId, pending] of this.pendingConnections) {
      if (now > pending.expiresAt) {
        // 关闭 socket
        try {
          pending.socket.end();
        } catch (e) {}
        
        // 清理映射
        this.agentToConfirmation.delete(pending.agentId);
        this.pendingConnections.delete(confirmationId);
        expiredCount++;
        
        this.emit('expired', { confirmationId, agentId: pending.agentId });
      }
    }
    
    if (expiredCount > 0) {
      console.log(`[ConnectionManager] 清理 ${expiredCount} 个过期连接`);
    }
  }
  
  /**
   * 添加待确认连接
   * @param {string} agentId - Agent ID
   * @param {net.Socket} socket - TCP socket
   * @param {string} publicKey - Agent 公钥
   * @param {string} address - 远程地址
   * @param {number} port - 远程端口
   * @returns {Object} { confirmationId, isDuplicate, existingId }
   */
  addPending(agentId, socket, publicKey, address, port) {
    // 检查是否已有同一 Agent 的待确认请求
    const existingId = this.agentToConfirmation.get(agentId);
    if (existingId) {
      const existing = this.pendingConnections.get(existingId);
      if (existing) {
        // 关闭旧的 socket
        try {
          existing.socket.end();
        } catch (e) {}
        
        // 删除旧的记录
        this.pendingConnections.delete(existingId);
        console.log(`[ConnectionManager] 更新 ${agentId.slice(0, 16)}... 的连接请求（去重）`);
      }
    }
    
    const confirmationId = crypto.randomUUID();
    const now = Date.now();
    
    const pending = {
      confirmationId,
      agentId,
      socket,
      publicKey,
      address,
      port,
      timestamp: now,
      expiresAt: now + PENDING_TIMEOUT,
      index: this._getNextIndex()
    };
    
    this.pendingConnections.set(confirmationId, pending);
    this.agentToConfirmation.set(agentId, confirmationId);
    
    this.emit('pending_added', {
      confirmationId,
      agentId,
      address,
      port,
      index: pending.index
    });
    
    return {
      confirmationId,
      isDuplicate: !!existingId,
      existingId
    };
  }
  
  /**
   * 获取下一个序号
   */
  _getNextIndex() {
    // 找到当前最大序号
    let maxIndex = 0;
    for (const pending of this.pendingConnections.values()) {
      if (pending.index > maxIndex) {
        maxIndex = pending.index;
      }
    }
    return maxIndex + 1;
  }
  
  /**
   * 获取待确认连接列表
   * @returns {Array} 待确认连接列表
   */
  getPendingList() {
    const now = Date.now();
    const list = [];
    
    for (const pending of this.pendingConnections.values()) {
      const remainingMs = pending.expiresAt - now;
      const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60000));
      
      list.push({
        index: pending.index,
        confirmationId: pending.confirmationId,
        shortId: pending.confirmationId.slice(0, 8),
        agentId: pending.agentId,
        agentIdShort: pending.agentId.slice(0, 16) + '...',
        address: pending.address,
        port: pending.port,
        remainingMinutes,
        requestedAt: pending.timestamp
      });
    }
    
    // 按序号排序
    return list.sort((a, b) => a.index - b.index);
  }
  
  /**
   * 通过序号查找待确认连接
   * @param {number} index - 序号
   * @returns {Object|null}
   */
  getByIndex(index) {
    for (const pending of this.pendingConnections.values()) {
      if (pending.index === index) {
        return pending;
      }
    }
    return null;
  }
  
  /**
   * 通过 ID 查找待确认连接
   * @param {string} confirmationId - 完整 ID 或短 ID（前8位）
   * @returns {Object|null}
   */
  getById(confirmationId) {
    // 完整匹配
    if (this.pendingConnections.has(confirmationId)) {
      return this.pendingConnections.get(confirmationId);
    }
    
    // 短 ID 匹配（前8位）
    for (const [id, pending] of this.pendingConnections) {
      if (id.startsWith(confirmationId)) {
        return pending;
      }
    }
    
    return null;
  }
  
  /**
   * 确认连接
   * @param {string|number} idOrIndex - 完整 ID、短 ID 或序号
   * @returns {Object} { success, pending, error }
   */
  confirm(idOrIndex) {
    let pending = null;
    
    if (typeof idOrIndex === 'number') {
      pending = this.getByIndex(idOrIndex);
    } else {
      pending = this.getById(idOrIndex);
    }
    
    if (!pending) {
      return { success: false, error: '连接请求不存在或已过期' };
    }
    
    // 清理记录
    this.pendingConnections.delete(pending.confirmationId);
    this.agentToConfirmation.delete(pending.agentId);
    
    this.emit('confirmed', {
      confirmationId: pending.confirmationId,
      agentId: pending.agentId,
      socket: pending.socket,
      publicKey: pending.publicKey
    });
    
    return { success: true, pending };
  }
  
  /**
   * 拒绝连接
   * @param {string|number} idOrIndex - 完整 ID、短 ID 或序号
   * @param {string} reason - 拒绝原因
   * @returns {Object} { success, pending, error }
   */
  reject(idOrIndex, reason = '用户拒绝') {
    let pending = null;
    
    if (typeof idOrIndex === 'number') {
      pending = this.getByIndex(idOrIndex);
    } else {
      pending = this.getById(idOrIndex);
    }
    
    if (!pending) {
      return { success: false, error: '连接请求不存在或已过期' };
    }
    
    // 关闭 socket
    try {
      pending.socket.end();
    } catch (e) {}
    
    // 清理记录
    this.pendingConnections.delete(pending.confirmationId);
    this.agentToConfirmation.delete(pending.agentId);
    
    this.emit('rejected', {
      confirmationId: pending.confirmationId,
      agentId: pending.agentId,
      reason
    });
    
    return { success: true, pending };
  }
  
  /**
   * 获取待确认数量
   */
  getPendingCount() {
    return this.pendingConnections.size;
  }
  
  /**
   * 检查 Agent 是否有待确认请求
   */
  hasPendingForAgent(agentId) {
    return this.agentToConfirmation.has(agentId);
  }
  
  /**
   * 停止管理器
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // 关闭所有待确认连接
    for (const pending of this.pendingConnections.values()) {
      try {
        pending.socket.end();
      } catch (e) {}
    }
    
    this.pendingConnections.clear();
    this.agentToConfirmation.clear();
  }
}

module.exports = { ConnectionManager };
