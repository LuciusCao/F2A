/**
 * F2A P2P Serverless Module
 * 
 * 无 Server 模式，直接 P2P 连接
 * 支持 UDP 自动发现、手动连接、安全验证
 */

const EventEmitter = require('events');
const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Logger } = require('./logger');

// 配置常量
const DISCOVERY_PORT = 8767;
const DEFAULT_P2P_PORT = 9000;
const DISCOVERY_INTERVAL = 5000;
const DISCOVERY_TIMEOUT = 15000;

// 多播配置 (Multicast Discovery)
const MULTICAST_ADDR = '239.255.255.250';  // 多播组地址
const MULTICAST_PORT = 8768;                // 多播端口 (与广播端口分开，避免冲突)
const MULTICAST_TTL = 128;                  // 多播 TTL
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB 消息大小限制
const MAX_PROCESSED_MESSAGES = 5000; // 防重放缓存大小
const CLEANUP_INTERVAL = 60000; // 清理间隔

class ServerlessP2P extends EventEmitter {
  constructor(options = {}) {
    super();
    this.myAgentId = options.myAgentId;
    this.myPublicKey = options.myPublicKey;
    this.myPrivateKey = options.myPrivateKey;
    
    this.p2pPort = options.p2pPort || DEFAULT_P2P_PORT;
    this.discoveryPort = options.discoveryPort || DISCOVERY_PORT;
    
    // 初始化日志
    this.logger = new Logger({
      level: options.logLevel || 'INFO',  // 默认 INFO 级别
      enableConsole: true,
      enableFile: true
    });
    this.logger.info('ServerlessP2P initializing', { agentId: this.myAgentId, port: this.p2pPort });
    
    // 安全配置
    this.security = {
      level: options.security?.level || 'medium', // low | medium | high
      whitelist: new Set(options.security?.whitelist || []),
      blacklist: new Set(options.security?.blacklist || []),
      requireConfirmation: options.security?.requireConfirmation !== false,
      verifySignatures: options.security?.verifySignatures !== false,
      rateLimit: options.security?.rateLimit || { maxRequests: 10, windowMs: 60000 }
    };
    
    // 状态
    this.peers = new Map(); // peerId -> { socket, address, port, verified }
    this.discoveredAgents = new Map(); // agentId -> { address, port, lastSeen }
    this.pendingConnections = new Map(); // socket -> { challenge, timestamp }
    this.rateLimiter = new Map(); // peerId -> { count, resetTime }
    this.processedMessages = new Set(); // 防重放
    
    this.udpSocket = null;
    this.tcpServer = null;
    this.discoveryInterval = null;
    this.cleanupInterval = null;
    
    // 启动定期清理
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
   * 清理过期数据
   */
  _cleanup() {
    const now = Date.now();
    
    // 清理过期的 rateLimiter 记录
    for (const [key, record] of this.rateLimiter) {
      if (now > record.resetTime) {
        this.rateLimiter.delete(key);
      }
    }
    
    // 清理过期的 pendingConnections (超过 5 分钟)
    for (const [socket, pending] of this.pendingConnections) {
      if (pending.timestamp && now - pending.timestamp > 5 * 60 * 1000) {
        this.pendingConnections.delete(socket);
        try {
          socket.end();
        } catch (e) {}
      }
    }
    
    // 清理过期的 discoveredAgents
    for (const [agentId, info] of this.discoveredAgents) {
      if (now - info.lastSeen > DISCOVERY_TIMEOUT * 2) {
        this.discoveredAgents.delete(agentId);
      }
    }
  }

  /**
   * 启动无 Server 模式
   */
  async start() {
    // 启动 TCP 监听
    await this._startTCPListener();
    
    // 启动 UDP 发现
    await this._startUDPDiscovery();
    
    console.log(`[ServerlessP2P] Started on port ${this.p2pPort}`);
    console.log(`[ServerlessP2P] Security level: ${this.security.level}`);
    
    this.emit('started', { port: this.p2pPort });
    return this;
  }

  /**
   * 停止服务
   */
  stop() {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.udpSocket) {
      try {
        this.udpSocket.close();
      } catch (e) {
        // Ignore close errors
      }
      this.udpSocket = null;
    }
    
    if (this.tcpServer) {
      try {
        this.tcpServer.close();
      } catch (e) {
        // Ignore close errors
      }
      this.tcpServer = null;
    }
    
    for (const [peerId, peer] of this.peers) {
      try {
        peer.socket.end();
      } catch (e) {
        // Ignore close errors
      }
    }
    
    this.peers.clear();
    this.pendingConnections.clear();
    this.rateLimiter.clear();
    this.processedMessages.clear();
    this.emit('stopped');
  }

  /**
   * 启动 TCP 监听器
   */
  _startTCPListener() {
    return new Promise((resolve, reject) => {
      this.tcpServer = net.createServer((socket) => {
        this._handleIncomingConnection(socket);
      });
      
      this.tcpServer.on('error', (err) => {
        console.error('[ServerlessP2P] TCP server error:', err.message);
        reject(err);
      });
      
      this.tcpServer.listen(this.p2pPort, () => {
        console.log(`[ServerlessP2P] TCP listener on port ${this.p2pPort}`);
        resolve();
      });
    });
  }

  /**
   * 获取占用指定端口的进程 PID（跨平台）
   * @param {number} port - 端口号
   * @returns {number|null} - 进程 PID 或 null
   */
  _getProcessByPort(port) {
    try {
      const platform = os.platform();
      let result;

      if (platform === 'darwin' || platform === 'linux') {
        // macOS/Linux: 使用 lsof
        result = execSync(`lsof -t -i UDP:${port} 2>/dev/null`).toString().trim();
      } else if (platform === 'win32') {
        // Windows: 使用 netstat
        result = execSync(`netstat -ano | findstr :${port}`).toString().trim();
        const lines = result.split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            return parseInt(parts[4]);
          }
        }
        return null;
      }

      return result ? parseInt(result) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 验证进程是否是 F2A 进程
   * @param {number} pid - 进程 PID
   * @returns {boolean}
   */
  _isF2AProcess(pid) {
    try {
      const platform = os.platform();
      let cmdline;

      if (platform === 'linux') {
        // Linux: 读取 /proc/PID/cmdline
        cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      } else if (platform === 'darwin') {
        // macOS: 使用 ps
        cmdline = execSync(`ps -p ${pid} -o command= 2>/dev/null`).toString().trim();
      } else if (platform === 'win32') {
        // Windows: 使用 wmic
        cmdline = execSync(`wmic process where ProcessId=${pid} get CommandLine 2>nul`).toString().trim();
      }

      // 检查命令行是否包含 F2A 相关标识
      return cmdline && (
        cmdline.includes('f2a') ||
        cmdline.includes('start-daemon') ||
        cmdline.includes('serverless.js') ||
        cmdline.includes('F2A')
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * 检查端口占用并尝试释放（如果是 F2A 进程）
   */
  async _checkAndReleasePort(port) {
    // 先尝试绑定，如果失败则说明被占用
    const testSocket = dgram.createSocket('udp4');

    return new Promise((resolve) => {
      testSocket.on('error', (err) => {
        testSocket.close();

        if (err.code === 'EADDRINUSE') {
          this.logger.warn(`[PORT] Port ${port} is occupied, attempting to release...`);

          const pidFile = path.join(os.homedir(), '.f2a', 'daemon.pid');

          try {
            // 1. 获取真正占用端口的进程
            const actualPid = this._getProcessByPort(port);

            if (!actualPid) {
              this.logger.warn(`[PORT] Could not identify process using port ${port}`);
              resolve(false);
              return;
            }

            this.logger.info(`[PORT] Port ${port} is used by PID: ${actualPid}`);

            // 2. 验证该进程是否是 F2A
            if (!this._isF2AProcess(actualPid)) {
              this.logger.warn(`[PORT] Port ${port} is occupied by non-F2A process (PID: ${actualPid}), skipping cleanup`);
              resolve(false);
              return;
            }

            this.logger.info(`[PORT] Confirmed F2A process (PID: ${actualPid})`);

            // 3. 验证 PID 文件（如果存在）
            let pidFromFile = null;
            if (fs.existsSync(pidFile)) {
              pidFromFile = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
              this.logger.info(`[PORT] PID file content: ${pidFromFile}`);

              // 如果 PID 文件中的 PID 与实际占用者不同，发出警告
              if (pidFromFile !== actualPid) {
                this.logger.warn(`[PORT] PID mismatch: file=${pidFromFile}, actual=${actualPid}`);
                // 继续处理，因为实际占用者已确认是 F2A
              }
            }

            // 4. 使用实际占用的 PID 进行终止
            const targetPid = actualPid;

            try {
              // 检查进程是否存在
              process.kill(targetPid, 0);

              // 是 F2A 进程，优雅停止它
              this.logger.info(`[PORT] Stopping F2A process ${targetPid}...`);
              process.kill(targetPid, 'SIGTERM');

              // 等待进程退出
              let attempts = 0;
              const waitForExit = () => {
                attempts++;
                try {
                  process.kill(targetPid, 0);
                  if (attempts >= 10) {
                    // 强制终止
                    this.logger.warn(`[PORT] Force killing F2A process...`);
                    try {
                      process.kill(targetPid, 'SIGKILL');
                    } catch (e) {}
                    // 删除 PID 文件
                    try { fs.unlinkSync(pidFile); } catch (e) {}
                    resolve(true);
                  } else {
                    setTimeout(waitForExit, 300);
                  }
                } catch (e) {
                  // 进程已退出
                  this.logger.info(`[PORT] F2A process stopped successfully`);
                  try { fs.unlinkSync(pidFile); } catch (e) {}
                  resolve(true);
                }
              };
              setTimeout(waitForExit, 300);
            } catch (e) {
              // 进程不存在，删除过期的 PID 文件
              this.logger.info(`[PORT] Process ${targetPid} already exited`);
              try { fs.unlinkSync(pidFile); } catch (e) {}
              resolve(false);
            }
          } catch (e) {
            this.logger.error(`[PORT] Error releasing port: ${e.message}`);
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });

      testSocket.bind(port, () => {
        // 绑定成功，端口未被占用
        testSocket.close();
        this.logger.debug(`[PORT] Port ${port} is free`);
        resolve(false);
      });
    });
  }

  /**
   * 启动 UDP 发现服务
   * 支持多播 (Multicast) 和广播 (Broadcast) 两种模式
   */
  async _startUDPDiscovery() {
    const multicastPort = this.multicastPort || MULTICAST_PORT;
    
    // 检查并释放被占用的端口
    await this._checkAndReleasePort(multicastPort);
    
    return new Promise((resolve, reject) => {
      this.udpSocket = dgram.createSocket('udp4');
      
      this.udpSocket.on('message', (msg, rinfo) => {
        this._handleDiscoveryMessage(msg, rinfo);
      });
      
      this.udpSocket.on('error', (err) => {
        this.logger.error('[UDP] Error:', err.message);
        if (err.code === 'EADDRINUSE') {
          this.logger.warn('[UDP] Port still in use after cleanup, falling back to broadcast only');
          resolve();
        }
      });
      
      this.udpSocket.bind(multicastPort, '0.0.0.0', () => {
        try {
          this.udpSocket.addMembership(MULTICAST_ADDR);
          this.udpSocket.setMulticastTTL(MULTICAST_TTL);
          this.logger.info(`[UDP] Multicast joined: ${MULTICAST_ADDR}:${multicastPort}`);
        } catch (err) {
          this.logger.error('[UDP] Failed to join multicast:', err.message);
        }
        
        this.udpSocket.setBroadcast(true);
        this.logger.info('[UDP] Broadcast enabled');
        
        this._startDiscoveryBroadcast();
        resolve();
      });
    });
  }

  /**
   * 开始发现广播 (多播为主，广播为辅)
   */
  _startDiscoveryBroadcast() {
    const discoveryMessage = JSON.stringify({
      type: 'F2A_DISCOVER',
      agentId: this.myAgentId,
      publicKey: this.myPublicKey,
      port: this.p2pPort,
      timestamp: Date.now()
    });
    
    // 初始化广播计数器
    this._broadcastCounter = 0;
    this._lastBroadcastTime = 0;
    this._multicastFailed = false;
    
    this.discoveryInterval = setInterval(() => {
      // 更新消息时间戳
      const msg = JSON.stringify({
        type: 'F2A_DISCOVER',
        agentId: this.myAgentId,
        publicKey: this.myPublicKey,
        port: this.p2pPort,
        timestamp: Date.now()
      });
      
      // 1. 多播 (主要方式)
      this.udpSocket.send(msg, MULTICAST_PORT, MULTICAST_ADDR, (err) => {
        if (err) {
          this._multicastFailed = true;
          // 多播失败，立即发送广播（不受计数器限制）
          this._sendBroadcast(msg);
        } else {
          this._multicastFailed = false;
        }
      });
      
      // 2. 广播 (备用方式)
      // 如果多播正常，每 3 次才发一次广播
      // 如果多播失败，上面已经处理过了，这里不再重复
      if (!this._multicastFailed) {
        this._broadcastCounter++;
        if (this._broadcastCounter >= 3) {
          this._broadcastCounter = 0;
          this._sendBroadcast(msg);
        }
      }
    }, DISCOVERY_INTERVAL);
  }

  /**
   * 发送广播消息
   */
  _sendBroadcast(message) {
    const addresses = this._getBroadcastAddresses();
    for (const addr of addresses) {
      this.udpSocket.send(message, this.discoveryPort, addr, (err) => {
        // 忽略发送错误
      });
    }
  }

  /**
   * 处理发现消息 (支持多播和广播)
   */
  _handleDiscoveryMessage(msg, rinfo) {
    try {
      const data = JSON.parse(msg.toString());
      
      if (data.type === 'F2A_DISCOVER' && data.agentId !== this.myAgentId) {
        // 检查黑名单
        if (this.security.blacklist.has(data.agentId)) {
          return;
        }
        
        // 记录发现的 Agent
        this.discoveredAgents.set(data.agentId, {
          address: rinfo.address,
          port: data.port,
          publicKey: data.publicKey,
          lastSeen: Date.now()
        });
        
        this.emit('agent_discovered', {
          agentId: data.agentId,
          address: rinfo.address,
          port: data.port,
          publicKey: data.publicKey
        });
        
        // 自动连接（如果白名单或低安全等级）
        if (this.security.level === 'low' || this.security.whitelist.has(data.agentId)) {
          this.connectToAgent(data.agentId, rinfo.address, data.port)
            .catch(err => console.error(`[ServerlessP2P] Auto-connect failed for ${data.agentId}: ${err.message}`));
        }
      }
    } catch (err) {
      // 忽略无效消息
    }
  }

  /**
   * 连接到指定 Agent
   */
  async connectToAgent(agentId, address, port) {
    // 检查是否已连接
    if (this.peers.has(agentId)) {
      this.logger.info(`Already connected to ${agentId.slice(0, 12)}...`);
      return this.peers.get(agentId);
    }
    
    // 检查黑名单
    if (this.security.blacklist.has(agentId)) {
      this.logger.warn(`Rejected blacklisted agent: ${agentId}`);
      throw new Error('Agent is blacklisted');
    }
    
    this.logger.info(`Connecting to ${agentId.slice(0, 12)}... at ${address}:${port}`);
    
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let onVerified = null;
      let timeoutId = null;
      
      const cleanup = () => {
        if (onVerified) {
          this.off('peer_verified', onVerified);
          onVerified = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      
      socket.on('connect', () => {
        this.logger.info(`TCP connected to ${agentId.slice(0, 12)}... at ${address}:${port}`);
        
        // 发送身份挑战
        this.logger.protocol('SEND_CHALLENGE', agentId, { local: true });
        this._sendIdentityChallenge(socket, agentId);
        
        // 等待验证完成
        onVerified = (verifiedAgentId) => {
          if (verifiedAgentId === agentId) {
            this.logger.info(`Peer verified: ${agentId.slice(0, 12)}...`);
            cleanup();
            resolve(this.peers.get(agentId));
          }
        };
        
        this.on('peer_verified', onVerified);
        
        // 超时处理
        timeoutId = setTimeout(() => {
          this.logger.error(`Verification timeout for ${agentId.slice(0, 12)}...`);
          cleanup();
          if (!this.peers.has(agentId)) {
            socket.end();
            reject(new Error('Verification timeout'));
          }
        }, 30000);
      });
      
      socket.on('error', (err) => {
        this.logger.error(`Socket error for ${agentId.slice(0, 12)}...: ${err.message}`);
        cleanup();
        reject(err);
      });
      
      socket.connect(port, address);
      this._setupSocketHandlers(socket);
    });
  }

  /**
   * 处理传入连接
   */
  _handleIncomingConnection(socket) {
    const remoteAddress = socket.remoteAddress;
    const remotePort = socket.remotePort;
    
    this.logger.info(`[CONN] Incoming TCP connection from ${remoteAddress}:${remotePort}`);
    
    // 速率限制检查
    const clientKey = `${remoteAddress}:${remotePort}`;
    if (!this._checkRateLimit(clientKey)) {
      this.logger.warn(`[CONN] Rate limit exceeded for ${clientKey}`);
      socket.end();
      return;
    }
    
    // 发送身份挑战（被动连接方也需要验证对方身份）
    this.logger.protocol('SEND_CHALLENGE', 'unknown', { passive: true, from: `${remoteAddress}:${remotePort}` });
    this._sendIdentityChallenge(socket, null);
    
    this._setupSocketHandlers(socket);
  }

  /**
   * 设置 Socket 处理器
   */
  _setupSocketHandlers(socket) {
    let buffer = '';
    
    socket.on('data', (data) => {
      buffer += data.toString();
      
      // 处理完整的消息（假设以换行分隔）
      let lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的部分
      
      for (const line of lines) {
        if (line.trim()) {
          this._handleMessage(socket, line);
        }
      }
    });
    
    socket.on('close', () => {
      // 清理 peer 记录
      for (const [peerId, peer] of this.peers) {
        if (peer.socket === socket) {
          this.peers.delete(peerId);
          this.emit('peer_disconnected', { peerId });
          break;
        }
      }
    });
    
    socket.on('error', (err) => {
      console.error('[ServerlessP2P] Socket error:', err.message);
    });
  }

  /**
   * 发送身份挑战
   */
  _sendIdentityChallenge(socket, expectedAgentId) {
    const challenge = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();
    
    this.pendingConnections.set(socket, {
      challenge,
      timestamp,
      expectedAgentId
    });
    
    const message = JSON.stringify({
      type: 'identity_challenge',
      agentId: this.myAgentId,
      publicKey: this.myPublicKey,
      challenge,
      timestamp
    });
    
    this.logger.protocol('CHALLENGE_SENT', expectedAgentId || 'unknown', { 
      challenge: challenge.slice(0, 16) + '...',
      timestamp 
    });
    
    socket.write(message + '\n');
  }

  /**
   * 处理收到的消息
   */
  _handleMessage(socket, data) {
    // 消息大小限制
    if (data.length > MAX_MESSAGE_SIZE) {
      this.logger.warn(`Message too large (${data.length} bytes), ignoring`);
      return;
    }
    
    try {
      const message = JSON.parse(data);
      
      this.logger.debug('[MSG] Received:', { type: message.type, from: message.agentId?.slice(0, 12) });
      
      // 基本结构验证
      if (!message || typeof message !== 'object') {
        this.logger.warn('[MSG] Invalid message structure');
        return;
      }
      
      // 防重放检查
      if (message.id) {
        if (this.processedMessages.has(message.id)) {
          this.logger.debug('[MSG] Duplicate message ignored:', message.id);
          return;
        }
        this.processedMessages.add(message.id);
        
        // 清理旧消息ID (保持缓存大小)
        if (this.processedMessages.size > MAX_PROCESSED_MESSAGES) {
          const toDelete = this.processedMessages.size - MAX_PROCESSED_MESSAGES + 1000;
          const iterator = this.processedMessages.values();
          for (let i = 0; i < toDelete; i++) {
            this.processedMessages.delete(iterator.next().value);
          }
        }
      }
      
      this.logger.protocol('MSG_TYPE', message.agentId || 'unknown', { type: message.type });
      
      switch (message.type) {
        case 'identity_challenge':
          this.logger.protocol('RECV_CHALLENGE', message.agentId, { challenge: message.challenge?.slice(0, 16) });
          this._handleIdentityChallenge(socket, message);
          break;
        case 'identity_response':
          this.logger.protocol('RECV_RESPONSE', 'unknown', { agentId: message.agentId?.slice(0, 12) });
          this._handleIdentityResponse(socket, message);
          break;
        case 'confirmation_request':
          this._handleConfirmationRequest(socket, message);
          break;
        case 'confirmation_response':
          this._handleConfirmationResponse(socket, message);
          break;
        default:
          // 转发给应用层
          const peerId = this._getPeerIdBySocket(socket);
          if (peerId && this.peers.get(peerId)?.verified) {
            this.emit('message', { peerId, message });
          }
      }
    } catch (err) {
      this.logger.error('[MSG] Message handling error:', err.message);
    }
  }

  /**
   * 处理身份挑战
   */
  _handleIdentityChallenge(socket, message) {
    const { agentId, publicKey, challenge, timestamp } = message;
    
    // 检查时间戳（5分钟有效期）
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      console.log('[ServerlessP2P] Challenge expired');
      socket.end();
      return;
    }
    
    // 检查黑名单
    if (this.security.blacklist.has(agentId)) {
      console.log(`[ServerlessP2P] Rejected blacklisted agent: ${agentId}`);
      socket.end();
      return;
    }
    
    // 签名响应
    const sign = crypto.createSign('SHA256');
    sign.update(challenge + timestamp);
    sign.end();
    const signature = sign.sign(this.myPrivateKey, 'base64');
    
    const response = JSON.stringify({
      type: 'identity_response',
      agentId: this.myAgentId,
      publicKey: this.myPublicKey,
      signature
    });
    
    socket.write(response + '\n');
    
    // 保存对方信息
    this.pendingConnections.set(socket, {
      agentId,
      publicKey,
      verified: false
    });
  }

  /**
   * 处理身份响应
   */
  _handleIdentityResponse(socket, message) {
    const { agentId, publicKey, signature } = message;
    
    const pending = this.pendingConnections.get(socket);
    if (!pending) {
      console.log('[ServerlessP2P] No pending challenge for this socket');
      socket.end();
      return;
    }
    
    // 验证签名
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(pending.challenge + pending.timestamp);
      verify.end();
      
      const isValid = verify.verify(publicKey, signature, 'base64');
      if (!isValid) {
        console.log(`[ServerlessP2P] Invalid signature from ${agentId}`);
        socket.end();
        return;
      }
    } catch (err) {
      console.log(`[ServerlessP2P] Signature verification failed: ${err.message}`);
      socket.end();
      return;
    }
    
    // 检查白名单
    if (this.security.level === 'medium' && !this.security.whitelist.has(agentId)) {
      // 需要手动确认
      if (this.security.requireConfirmation) {
        this._requestConfirmation(socket, agentId, publicKey);
        return;
      }
    }
    
    // 验证通过
    this._verifyPeer(socket, agentId, publicKey);
  }

  /**
   * 请求手动确认
   */
  _requestConfirmation(socket, agentId, publicKey) {
    const confirmationId = crypto.randomUUID();
    
    this.pendingConnections.set(socket, {
      ...this.pendingConnections.get(socket),
      confirmationId,
      agentId,
      publicKey,
      waitingConfirmation: true
    });
    
    // 发送确认请求
    const request = JSON.stringify({
      type: 'confirmation_request',
      confirmationId,
      agentId: this.myAgentId
    });
    
    socket.write(request + '\n');
    
    // 触发事件，让 UI 层显示确认对话框
    this.emit('confirmation_required', {
      confirmationId,
      agentId,
      publicKey: publicKey.slice(0, 50) + '...',
      accept: () => this._confirmConnection(confirmationId, true),
      reject: () => this._confirmConnection(confirmationId, false)
    });
  }

  /**
   * 处理确认请求
   */
  _handleConfirmationRequest(socket, message) {
    // 自动接受（可以扩展为显示对话框）
    const response = JSON.stringify({
      type: 'confirmation_response',
      confirmationId: message.confirmationId,
      accepted: true
    });
    
    socket.write(response + '\n');
  }

  /**
   * 处理确认响应
   */
  _handleConfirmationResponse(socket, message) {
    const pending = this.pendingConnections.get(socket);
    if (!pending || pending.confirmationId !== message.confirmationId) {
      return;
    }
    
    if (message.accepted) {
      this._verifyPeer(socket, pending.agentId, pending.publicKey);
    } else {
      console.log(`[ServerlessP2P] Connection rejected by ${pending.agentId}`);
      socket.end();
    }
  }

  /**
   * 确认连接
   */
  _confirmConnection(confirmationId, accepted) {
    for (const [socket, pending] of this.pendingConnections) {
      if (pending.confirmationId === confirmationId) {
        if (accepted) {
          this._verifyPeer(socket, pending.agentId, pending.publicKey);
        } else {
          this.security.blacklist.add(pending.agentId);
          socket.end();
        }
        return;
      }
    }
  }

  /**
   * 验证 Peer
   */
  _verifyPeer(socket, agentId, publicKey) {
    // 添加到 peers
    this.peers.set(agentId, {
      socket,
      address: socket.remoteAddress,
      port: socket.remotePort,
      publicKey,
      verified: true,
      connectedAt: Date.now()
    });
    
    // 添加到白名单
    this.security.whitelist.add(agentId);
    
    // 清理 pending
    this.pendingConnections.delete(socket);
    
    console.log(`[ServerlessP2P] Peer verified: ${agentId}`);
    
    this.emit('peer_connected', { agentId, publicKey });
    this.emit('peer_verified', agentId);
  }

  /**
   * 发送消息给 Peer
   */
  sendToPeer(peerId, message) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.verified) {
      throw new Error(`Peer not connected or not verified: ${peerId}`);
    }
    
    const data = JSON.stringify(message);
    peer.socket.write(data + '\n');
  }

  /**
   * 广播消息给所有 Peers
   */
  broadcast(message) {
    for (const [peerId, peer] of this.peers) {
      if (peer.verified) {
        try {
          this.sendToPeer(peerId, message);
        } catch (err) {
          console.error(`[ServerlessP2P] Failed to send to ${peerId}:`, err.message);
        }
      }
    }
  }

  /**
   * 获取 Socket 对应的 Peer ID
   */
  _getPeerIdBySocket(socket) {
    for (const [peerId, peer] of this.peers) {
      if (peer.socket === socket) {
        return peerId;
      }
    }
    return null;
  }

  /**
   * 速率限制检查
   */
  _checkRateLimit(clientKey) {
    const now = Date.now();
    const limit = this.security.rateLimit;
    
    let record = this.rateLimiter.get(clientKey);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + limit.windowMs };
      this.rateLimiter.set(clientKey, record);
      return true;
    }
    
    record.count++;
    if (record.count > limit.maxRequests) {
      return false;
    }
    
    return true;
  }

  /**
   * 获取广播地址列表
   */
  _getBroadcastAddresses() {
    const addresses = ['255.255.255.255'];
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          // 计算广播地址
          const parts = iface.address.split('.');
          const netmask = iface.netmask.split('.');
          const broadcast = parts.map((part, i) => {
            return (parseInt(part) | (255 - parseInt(netmask[i]))).toString();
          }).join('.');
          
          if (!addresses.includes(broadcast)) {
            addresses.push(broadcast);
          }
        }
      }
    }
    
    return addresses;
  }

  /**
   * 获取发现的 Agents
   */
  getDiscoveredAgents() {
    const now = Date.now();
    const result = [];
    
    for (const [agentId, info] of this.discoveredAgents) {
      // 过滤超时的
      if (now - info.lastSeen < DISCOVERY_TIMEOUT) {
        result.push({ agentId, ...info });
      }
    }
    
    return result;
  }

  /**
   * 获取已连接的 Peers
   */
  getConnectedPeers() {
    return Array.from(this.peers.keys()).filter(id => this.peers.get(id).verified);
  }

  /**
   * 添加到黑名单
   */
  blacklist(agentId) {
    this.security.blacklist.add(agentId);
    
    // 断开现有连接
    const peer = this.peers.get(agentId);
    if (peer) {
      peer.socket.end();
      this.peers.delete(agentId);
    }
  }

  /**
   * 从白名单移除
   */
  removeFromWhitelist(agentId) {
    this.security.whitelist.delete(agentId);
  }
}

module.exports = { ServerlessP2P };
