/**
 * P2P Serverless 模块
 * 处理 TCP 连接、UDP 发现、身份验证
 */

import { EventEmitter } from 'eventemitter3';
import { createServer, Server, Socket } from 'net';
import { createSocket, Socket as DgramSocket } from 'dgram';
import { randomBytes, createSign, createVerify } from 'crypto';
import { networkInterfaces } from 'os';
import {
  ConnectionConfig,
  AgentIdentity,
  DiscoveredAgent,
  SecurityLevel,
  Result,
  F2AMessage,
  IdentityChallengeMessage,
  IdentityResponseMessage,
  ConnectionPendingMessage,
  ConfirmationResultMessage
} from '../types';
import { ConnectionManager } from './connection-manager';
import { validateMessage } from '../protocol/messages';

// 常量
const DEFAULT_P2P_PORT = 9000;
const DISCOVERY_PORT = 8767;
const MULTICAST_ADDR = '239.255.255.250';
const MULTICAST_PORT = 8768;
const DISCOVERY_INTERVAL = 15000;
const BROADCAST_INTERVAL = 60000;
const MAX_MESSAGE_SIZE = 1024 * 1024;
const CHALLENGE_TIMEOUT = 5 * 60 * 1000; // 5分钟

export interface ServerlessP2POptions {
  identity: AgentIdentity;
  config: ConnectionConfig;
  connectionManager: ConnectionManager;
}

export interface PeerInfo {
  socket: Socket;
  address: string;
  port: number;
  publicKey: string;
  verified: boolean;
  connectedAt: number;
}

export class ServerlessP2P extends EventEmitter<{
  'agent_discovered': (agent: DiscoveredAgent) => void;
  'peer_connected': (info: { peerId: string; publicKey: string }) => void;
  'peer_disconnected': (info: { peerId: string }) => void;
  'message': (info: { peerId: string; message: F2AMessage }) => void;
  'started': (info: { port: number }) => void;
  'stopped': () => void;
  'error': (error: Error) => void;
}> {
  private identity: AgentIdentity;
  private config: ConnectionConfig;
  private connectionManager: ConnectionManager;
  
  private tcpServer?: Server;
  private udpSocket?: DgramSocket;
  private peers: Map<string, PeerInfo> = new Map();
  private discoveredAgents: Map<string, DiscoveredAgent> = new Map();
  private pendingChallenges: Map<Socket, { challenge: string; timestamp: number; expectedAgentId?: string }> = new Map();
  private rateLimiter: Map<string, { count: number; resetTime: number }> = new Map();
  
  private discoveryInterval?: NodeJS.Timeout;
  private broadcastInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: ServerlessP2POptions) {
    super();
    this.identity = options.identity;
    this.config = options.config;
    this.connectionManager = options.connectionManager;
  }

  /**
   * 启动 P2P 服务
   */
  async start(): Promise<Result<void>> {
    try {
      // 启动 TCP 监听
      await this.startTCPListener();
      
      // 启动 UDP 发现
      await this.startUDPDiscovery();
      
      // 启动清理定时器
      this.startCleanup();
      
      console.log(`[ServerlessP2P] Started on port ${this.config.p2pPort}`);
      this.emit('started', { port: this.config.p2pPort });
      
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to start: ${message}` };
    }
  }

  /**
   * 停止 P2P 服务
   */
  stop(): void {
    // 清除定时器
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    if (this.broadcastInterval) clearInterval(this.broadcastInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    // 关闭 UDP
    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = undefined;
    }

    // 关闭 TCP 服务器
    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = undefined;
    }

    // 断开所有 Peer
    for (const peer of this.peers.values()) {
      this.closeSocket(peer.socket);
    }
    this.peers.clear();

    this.emit('stopped');
  }

  /**
   * 连接到指定 Agent
   */
  async connectToAgent(agentId: string, address: string, port: number): Promise<Result<void>> {
    // 检查是否已连接
    if (this.peers.has(agentId)) {
      return { success: false, error: 'Already connected' };
    }

    // 检查黑名单
    if (this.config.security.blacklist?.has(agentId)) {
      return { success: false, error: 'Agent is blacklisted' };
    }

    return new Promise((resolve) => {
      const socket = new Socket();
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        socket.removeAllListeners();
      };

      socket.on('connect', () => {
        console.log(`[ServerlessP2P] Connected to ${agentId.slice(0, 16)}...`);
        this.sendIdentityChallenge(socket, agentId);
        
        // 等待验证完成
        const checkVerified = () => {
          const peer = this.peers.get(agentId);
          if (peer?.verified) {
            cleanup();
            resolve({ success: true, data: undefined });
          } else {
            setTimeout(checkVerified, 100);
          }
        };
        checkVerified();
      });

      socket.on('error', (err) => {
        cleanup();
        resolve({ success: false, error: err.message });
      });

      timeoutId = setTimeout(() => {
        cleanup();
        socket.destroy();
        resolve({ success: false, error: 'Connection timeout' });
      }, 30000);

      socket.connect(port, address);
      this.setupSocketHandlers(socket);
    });
  }

  /**
   * 发送消息给 Peer
   */
  sendToPeer(peerId: string, message: F2AMessage): Result<void> {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.verified) {
      return { success: false, error: 'Peer not connected or not verified' };
    }

    try {
      const data = JSON.stringify(message);
      peer.socket.write(data + '\n');
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * 获取已连接的 Peers
   */
  getConnectedPeers(): string[] {
    return Array.from(this.peers.entries())
      .filter(([_, peer]) => peer.verified)
      .map(([id, _]) => id);
  }

  /**
   * 获取发现的 Agents
   */
  getDiscoveredAgents(): DiscoveredAgent[] {
    const now = Date.now();
    return Array.from(this.discoveredAgents.values())
      .filter(agent => now - agent.lastSeen < 30000);
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 启动 TCP 监听器
   */
  private startTCPListener(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tcpServer = createServer((socket) => {
        this.handleIncomingConnection(socket);
      });

      this.tcpServer.on('error', (err) => {
        console.error('[ServerlessP2P] TCP server error:', err.message);
        reject(err);
      });

      this.tcpServer.listen(this.config.p2pPort, () => {
        console.log(`[ServerlessP2P] TCP listener on port ${this.config.p2pPort}`);
        resolve();
      });
    });
  }

  /**
   * 启动 UDP 发现
   */
  private startUDPDiscovery(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.udpSocket = createSocket('udp4');

      this.udpSocket.on('message', (msg, rinfo) => {
        this.handleDiscoveryMessage(msg, rinfo);
      });

      this.udpSocket.on('error', (err) => {
        console.error('[ServerlessP2P] UDP error:', err.message);
        if (err.message.includes('EADDRINUSE')) {
          console.warn('[ServerlessP2P] UDP port in use, continuing without discovery');
          resolve();
        } else {
          reject(err);
        }
      });

      this.udpSocket.bind(MULTICAST_PORT, '0.0.0.0', () => {
        try {
          this.udpSocket!.addMembership(MULTICAST_ADDR);
          this.udpSocket!.setMulticastTTL(128);
          console.log(`[ServerlessP2P] Multicast joined: ${MULTICAST_ADDR}:${MULTICAST_PORT}`);
        } catch (err) {
          console.error('[ServerlessP2P] Failed to join multicast:', err);
        }

        this.udpSocket!.setBroadcast(true);
        console.log('[ServerlessP2P] Broadcast enabled');

        this.startDiscoveryBroadcast();
        resolve();
      });
    });
  }

  /**
   * 开始发现广播
   */
  private startDiscoveryBroadcast(): void {
    // 多播（主要方式）
    this.discoveryInterval = setInterval(() => {
      const msg = JSON.stringify({
        type: 'F2A_DISCOVER',
        agentId: this.identity.agentId,
        publicKey: this.identity.publicKey,
        port: this.config.p2pPort,
        timestamp: Date.now()
      });

      this.udpSocket?.send(msg, MULTICAST_PORT, MULTICAST_ADDR);
    }, DISCOVERY_INTERVAL);

    // 广播（备用方式）
    this.broadcastInterval = setInterval(() => {
      const msg = JSON.stringify({
        type: 'F2A_DISCOVER',
        agentId: this.identity.agentId,
        publicKey: this.identity.publicKey,
        port: this.config.p2pPort,
        timestamp: Date.now()
      });

      const addresses = this.getBroadcastAddresses();
      for (const addr of addresses) {
        this.udpSocket?.send(msg, DISCOVERY_PORT, addr);
      }
    }, BROADCAST_INTERVAL);
  }

  /**
   * 处理发现消息
   */
  private handleDiscoveryMessage(msg: Buffer, rinfo: { address: string; port: number }): void {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type !== 'F2A_DISCOVER') return;
      if (data.agentId === this.identity.agentId) return;

      // 检查黑名单
      if (this.config.security.blacklist?.has(data.agentId)) return;

      // 记录发现的 Agent
      const isNew = !this.discoveredAgents.has(data.agentId);
      this.discoveredAgents.set(data.agentId, {
        agentId: data.agentId,
        address: rinfo.address,
        port: data.port,
        publicKey: data.publicKey,
        lastSeen: Date.now()
      });

      if (isNew) {
        console.log(`[ServerlessP2P] Discovered: ${data.agentId.slice(0, 16)}...`);
        this.emit('agent_discovered', {
          agentId: data.agentId,
          address: rinfo.address,
          port: data.port,
          publicKey: data.publicKey,
          lastSeen: Date.now()
        });
      }

      // 自动连接（低安全等级或白名单）
      if (this.config.security.level === 'low' || 
          this.config.security.whitelist?.has(data.agentId)) {
        this.connectToAgent(data.agentId, rinfo.address, data.port)
          .catch(err => console.error('[ServerlessP2P] Auto-connect failed:', err.message));
      }
    } catch {
      // 忽略无效消息
    }
  }

  /**
   * 处理传入连接
   */
  private handleIncomingConnection(socket: Socket): void {
    const remoteAddress = socket.remoteAddress;
    const remotePort = socket.remotePort;

    if (!remoteAddress || !remotePort) {
      socket.end();
      return;
    }

    // 速率限制检查
    const clientKey = `${remoteAddress}:${remotePort}`;
    if (!this.checkRateLimit(clientKey)) {
      console.warn(`[ServerlessP2P] Rate limit exceeded for ${clientKey}`);
      socket.end();
      return;
    }

    console.log(`[ServerlessP2P] Incoming connection from ${remoteAddress}:${remotePort}`);
    
    // 发送身份挑战
    this.sendIdentityChallenge(socket);
    this.setupSocketHandlers(socket);
  }

  /**
   * 设置 Socket 处理器
   */
  private setupSocketHandlers(socket: Socket): void {
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.handleSocketMessage(socket, line);
        }
      }
    });

    socket.on('close', () => {
      this.handleSocketClose(socket);
    });

    socket.on('error', (err) => {
      console.error('[ServerlessP2P] Socket error:', err.message);
    });
  }

  /**
   * 处理 Socket 消息
   */
  private handleSocketMessage(socket: Socket, data: string): void {
    // 消息大小限制
    if (data.length > MAX_MESSAGE_SIZE) {
      console.warn('[ServerlessP2P] Message too large');
      return;
    }

    try {
      const parsed = JSON.parse(data);
      const validation = validateMessage(parsed);
      
      if (!validation.success) {
        console.warn('[ServerlessP2P] Invalid message:', validation.error);
        return;
      }

      const message = validation.data;

      switch (message.type) {
        case 'identity_challenge':
          this.handleIdentityChallenge(socket, message);
          break;
        case 'identity_response':
          this.handleIdentityResponse(socket, message);
          break;
        case 'confirmation_result':
          this.handleConfirmationResult(socket, message);
          break;
        default:
          // 转发给应用层
          const peerId = this.getPeerIdBySocket(socket);
          if (peerId && this.peers.get(peerId)?.verified) {
            this.emit('message', { peerId, message });
          }
      }
    } catch {
      // 忽略解析错误
    }
  }

  /**
   * 发送身份挑战
   */
  private sendIdentityChallenge(socket: Socket, expectedAgentId?: string): void {
    const challenge = randomBytes(32).toString('hex');
    const timestamp = Date.now();

    this.pendingChallenges.set(socket, {
      challenge,
      timestamp,
      expectedAgentId
    });

    const message: IdentityChallengeMessage = {
      type: 'identity_challenge',
      agentId: this.identity.agentId,
      publicKey: this.identity.publicKey,
      challenge,
      timestamp
    };

    socket.write(JSON.stringify(message) + '\n');
  }

  /**
   * 处理身份挑战
   */
  private handleIdentityChallenge(socket: Socket, message: IdentityChallengeMessage): void {
    // 检查时间戳
    if (Date.now() - message.timestamp > CHALLENGE_TIMEOUT) {
      console.log('[ServerlessP2P] Challenge expired');
      socket.end();
      return;
    }

    // 检查黑名单
    if (this.config.security.blacklist?.has(message.agentId)) {
      console.log(`[ServerlessP2P] Rejected blacklisted agent: ${message.agentId}`);
      socket.end();
      return;
    }

    // 签名响应
    const sign = createSign('SHA256');
    sign.update(message.challenge + message.timestamp);
    sign.end();
    const signature = sign.sign(this.identity.privateKey, 'base64');

    const response: IdentityResponseMessage = {
      type: 'identity_response',
      agentId: this.identity.agentId,
      publicKey: this.identity.publicKey,
      signature,
      timestamp: Date.now()
    };

    socket.write(JSON.stringify(response) + '\n');

    // 保存对方信息
    this.pendingChallenges.set(socket, {
      challenge: '',
      timestamp: Date.now(),
      expectedAgentId: message.agentId
    });
  }

  /**
   * 处理身份响应
   */
  private handleIdentityResponse(socket: Socket, message: IdentityResponseMessage): void {
    const pending = this.pendingChallenges.get(socket);
    if (!pending || !pending.challenge) {
      console.log('[ServerlessP2P] No pending challenge');
      socket.end();
      return;
    }

    // 验证签名
    try {
      const verify = createVerify('SHA256');
      verify.update(pending.challenge + pending.timestamp);
      verify.end();

      const isValid = verify.verify(message.publicKey, message.signature, 'base64');
      if (!isValid) {
        console.log(`[ServerlessP2P] Invalid signature from ${message.agentId}`);
        socket.end();
        return;
      }
    } catch (err) {
      console.log('[ServerlessP2P] Signature verification failed');
      socket.end();
      return;
    }

    // 检查是否需要确认
    if (this.config.security.level === 'medium' && 
        !this.config.security.whitelist?.has(message.agentId)) {
      if (this.config.security.requireConfirmation) {
        this.requestConfirmation(socket, message.agentId, message.publicKey);
        return;
      }
    }

    // 验证通过
    this.verifyPeer(socket, message.agentId, message.publicKey);
  }

  /**
   * 请求确认
   */
  private requestConfirmation(socket: Socket, agentId: string, publicKey: string): void {
    const result = this.connectionManager.addPending(
      agentId,
      socket,
      publicKey,
      socket.remoteAddress || 'unknown',
      socket.remotePort || 0
    );

    // 发送 pending 状态
    const pending: ConnectionPendingMessage = {
      type: 'connection_pending',
      confirmationId: result.confirmationId,
      message: '等待用户确认',
      timeout: 60 * 60 * 1000,
      timestamp: Date.now()
    };
    socket.write(JSON.stringify(pending) + '\n');
  }

  /**
   * 处理确认结果
   */
  private handleConfirmationResult(socket: Socket, message: ConfirmationResultMessage): void {
    // 这里处理 A 端收到 B 的确认结果
    // 实际逻辑在 ConnectionManager 中处理
  }

  /**
   * 验证 Peer
   */
  private verifyPeer(socket: Socket, agentId: string, publicKey: string): void {
    this.peers.set(agentId, {
      socket,
      address: socket.remoteAddress || 'unknown',
      port: socket.remotePort || 0,
      publicKey,
      verified: true,
      connectedAt: Date.now()
    });

    this.config.security.whitelist?.add(agentId);
    this.pendingChallenges.delete(socket);

    console.log(`[ServerlessP2P] Peer verified: ${agentId}`);
    this.emit('peer_connected', { peerId: agentId, publicKey });
  }

  /**
   * 处理 Socket 关闭
   */
  private handleSocketClose(socket: Socket): void {
    for (const [peerId, peer] of this.peers) {
      if (peer.socket === socket) {
        this.peers.delete(peerId);
        this.emit('peer_disconnected', { peerId });
        break;
      }
    }
    this.pendingChallenges.delete(socket);
  }

  /**
   * 获取 Socket 对应的 Peer ID
   */
  private getPeerIdBySocket(socket: Socket): string | null {
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
  private checkRateLimit(clientKey: string): boolean {
    const now = Date.now();
    const limit = this.config.security.rateLimit || { maxRequests: 10, windowMs: 60000 };

    let record = this.rateLimiter.get(clientKey);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + limit.windowMs };
      this.rateLimiter.set(clientKey, record);
      return true;
    }

    record.count++;
    return record.count <= limit.maxRequests;
  }

  /**
   * 获取广播地址列表
   */
  private getBroadcastAddresses(): string[] {
    const addresses: string[] = ['255.255.255.255'];
    const interfaces = networkInterfaces();

    for (const iface of Object.values(interfaces)) {
      if (!iface) continue;
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          const parts = info.address.split('.');
          const netmask = info.netmask.split('.');
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
   * 启动清理定时器
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      // 清理过期的 rate limit 记录
      const now = Date.now();
      for (const [key, record] of this.rateLimiter) {
        if (now > record.resetTime) {
          this.rateLimiter.delete(key);
        }
      }

      // 清理过期的 challenges
      for (const [socket, pending] of this.pendingChallenges) {
        if (now - pending.timestamp > CHALLENGE_TIMEOUT) {
          this.pendingChallenges.delete(socket);
          this.closeSocket(socket);
        }
      }
    }, 60000);
  }

  /**
   * 安全关闭 Socket
   */
  private closeSocket(socket: Socket): void {
    try {
      socket.end();
    } catch {
      // 忽略错误
    }
  }
}