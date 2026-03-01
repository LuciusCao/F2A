/**
 * F2A Main Module - 统一入口
 * 
 * 整合所有 F2A 功能模块 (纯 P2P 无 Server 版本)
 * 支持 TCP/UDP 直连、WebRTC 升级、E2E 加密
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const { Messaging } = require('./messaging');
const { SkillsManager } = require('./skills');
const { FileTransfer } = require('./files');
const { P2PManager } = require('./p2p');
const { WebRTCManager } = require('./webrtc');
const { E2ECrypto } = require('./crypto');
const { GroupChat } = require('./group');
const { ServerlessP2P } = require('./serverless');
const { IdentityManager } = require('./identity');

class F2A extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = options;
    
    // 使用传入的身份信息（由 start-daemon.js 提供）
    this.myAgentId = options.myAgentId;
    this.myPublicKey = options.myPublicKey;
    this.myPrivateKey = options.myPrivateKey;
    this._identityInfo = {
      agentId: this.myAgentId,
      isPersistent: true
    };
    
    // 功能开关
    this.useWebRTC = options.useWebRTC !== false;
    this.useEncryption = options.useEncryption !== false;
    
    // 连接类型追踪: 'tcp' | 'webrtc'
    this.connectionTypes = new Map();
    
    // 初始化 Serverless P2P (TCP/UDP)
    this.p2p = new ServerlessP2P({
      myAgentId: this.myAgentId,
      myPublicKey: this.myPublicKey,
      myPrivateKey: this.myPrivateKey,
      p2pPort: options.p2pPort || 9000,
      security: options.security
    });
    
    // 初始化 WebRTC (可选)
    this.webrtc = this.useWebRTC ? new WebRTCManager({
      iceServers: options.iceServers
    }) : null;
    
    // 初始化 E2E 加密 (可选)
    this.crypto = this.useEncryption ? new E2ECrypto() : null;
    if (this.crypto && this.myPublicKey && this.myPrivateKey) {
      this.crypto.loadKeyPair(this.myPublicKey, this.myPrivateKey);
    }
    
    // 初始化功能模块
    this.messaging = new Messaging(options.messaging);
    this.skills = new SkillsManager(options.skills);
    this.files = new FileTransfer(options.files);
    this.groups = new GroupChat({ myAgentId: this.myAgentId });
    
    // 绑定事件
    this._bindEvents();
  }

  /**
   * 启动 F2A
   */
  async start() {
    this.groups.initialize(this.myAgentId);
    await this.p2p.start();
    
    console.log(`[F2A] Started as ${this.myAgentId}`);
    console.log(`[F2A] WebRTC: ${this.useWebRTC ? 'enabled' : 'disabled'}`);
    console.log(`[F2A] E2E Encryption: ${this.useEncryption ? 'enabled' : 'disabled'}`);
    
    return this;
  }

  /**
   * 停止 F2A
   */
  stop() {
    this.p2p.stop();
    this.messaging.stop();
    this.skills.stop();
    if (this.webrtc) {
      this.webrtc.closeAll();
    }
    if (this.crypto) {
      this.crypto.clearAllSessions();
    }
    this.emit('stopped');
  }

  /**
   * 绑定模块间事件
   */
  _bindEvents() {
    // TCP P2P 消息路由
    this.p2p.on('message', ({ peerId, message }) => {
      this._handleMessage(peerId, message);
    });

    this.p2p.on('peer_connected', ({ agentId }) => {
      this.connectionTypes.set(agentId, 'tcp');
      
      // 执行密钥交换
      if (this.crypto) {
        this._performKeyExchange(agentId);
      }
      
      this.emit('connected', { peerId: agentId, type: 'tcp' });
    });

    this.p2p.on('peer_disconnected', ({ peerId }) => {
      this.connectionTypes.delete(peerId);
      if (this.crypto) {
        this.crypto.clearSession(peerId);
      }
      this.emit('disconnected', { peerId });
    });

    // WebRTC 消息路由
    if (this.webrtc) {
      this.webrtc.on('message', ({ peerId, data }) => {
        this._handleMessage(peerId, data);
      });

      this.webrtc.on('connected', ({ peerId }) => {
        this.connectionTypes.set(peerId, 'webrtc');
        console.log(`[F2A] Upgraded to WebRTC: ${peerId}`);
        this.emit('connected', { peerId, type: 'webrtc' });
      });

      this.webrtc.on('disconnected', ({ peerId }) => {
        // 回退到 TCP
        if (this.p2p.getConnectedPeers().includes(peerId)) {
          this.connectionTypes.set(peerId, 'tcp');
          console.log(`[F2A] Fell back to TCP: ${peerId}`);
        }
      });
    }

    // 群聊事件转发
    this.groups.on('group_message', (data) => {
      this.emit('group_message', data);
    });

    this.groups.on('group_invite_received', (data) => {
      this.emit('group_invite', data);
    });
  }

  /**
   * 处理消息 (统一入口)
   */
  _handleMessage(peerId, message) {
    // 消息类型检查
    if (!message || typeof message !== 'object') {
      return;
    }

    // 处理密钥交换
    if (message.type === 'key_exchange') {
      this._handleKeyExchange(peerId, message);
      return;
    }
    
    // 处理 WebRTC 信令
    if (this.webrtc && (
      message.type === 'webrtc_offer' || 
      message.type === 'webrtc_answer' || 
      message.type === 'webrtc_ice'
    )) {
      this._handleWebRTCSignal(peerId, message);
      return;
    }

    // 路由到对应模块
    switch (message.type) {
      case 'message':
      case 'message_ack':
        this.messaging._handleMessage(peerId, JSON.stringify(message));
        break;
        
      case 'group_message':
        this.groups.handleGroupMessage(message);
        break;
        
      case 'group_invite':
        this.groups.handleGroupInvite(message);
        break;
        
      case 'skill_query':
        this.skills.handleSkillQuery(message.requestId, this._createConnectionProxy(peerId));
        break;
        
      case 'skill_response':
        this.skills.handleSkillResponse(message.requestId, message.skills);
        break;
        
      case 'skill_invoke':
        this.skills.handleSkillInvoke(
          message.requestId,
          message.skill,
          message.parameters,
          this._createConnectionProxy(peerId),
          { authorized: true }
        );
        break;
        
      case 'skill_result':
        this.skills.handleSkillResult(message.requestId, message.status, message.result, message.error);
        break;
        
      case 'file_offer':
      case 'file_accept':
      case 'file_chunk':
      case 'file_complete':
        // 文件传输功能 (WIP)
        this.emit('file_event', { peerId, message });
        break;
    }
  }

  /**
   * 创建连接代理
   */
  _createConnectionProxy(peerId) {
    return {
      send: (data) => this._sendRaw(peerId, data)
    };
  }

  /**
   * 发送原始数据 (根据连接类型选择通道)
   */
  _sendRaw(peerId, data) {
    // 如果启用了加密且已有会话密钥，加密发送
    let payload = data;
    if (this.crypto && this.crypto.sessionKeys.has(peerId)) {
      payload = this.crypto.encrypt(peerId, data);
    }

    const type = this.connectionTypes.get(peerId);
    if (type === 'webrtc' && this.webrtc) {
      this.webrtc.send(peerId, payload);
    } else {
      this.p2p.sendToPeer(peerId, JSON.parse(data));
    }
  }

  /**
   * 执行密钥交换
   */
  _performKeyExchange(peerId) {
    if (!this.crypto) return;

    const publicKey = this.crypto.getPublicKey();
    this.p2p.sendToPeer(peerId, {
      type: 'key_exchange',
      publicKey: Buffer.from(publicKey).toString('base64')
    });
  }

  /**
   * 处理密钥交换
   */
  _handleKeyExchange(peerId, message) {
    if (!this.crypto) return;

    try {
      const peerPublicKey = Buffer.from(message.publicKey, 'base64').toString('pem');
      this.crypto.deriveSessionKey(peerId, peerPublicKey);
      console.log(`[F2A] E2E encryption established with ${peerId.slice(0, 8)}...`);
    } catch (err) {
      console.error(`[F2A] Key exchange failed: ${err.message}`);
    }
  }

  /**
   * 升级到 WebRTC 连接
   */
  async upgradeToWebRTC(peerId) {
    if (!this.webrtc) return;

    try {
      const offer = await this.webrtc.createConnection(peerId);
      this.p2p.sendToPeer(peerId, {
        type: 'webrtc_offer',
        offer
      });
    } catch (err) {
      console.log(`[F2A] WebRTC upgrade failed for ${peerId}: ${err.message}`);
    }
  }

  /**
   * 处理 WebRTC 信令
   */
  async _handleWebRTCSignal(peerId, message) {
    if (!this.webrtc) return;

    try {
      switch (message.type) {
        case 'webrtc_offer':
          const answer = await this.webrtc.handleOffer(peerId, message.offer);
          this.p2p.sendToPeer(peerId, {
            type: 'webrtc_answer',
            answer
          });
          break;
          
        case 'webrtc_answer':
          await this.webrtc.handleAnswer(peerId, message.answer);
          break;
          
        case 'webrtc_ice':
          await this.webrtc.addIceCandidate(peerId, message.candidate);
          break;
      }
    } catch (err) {
      console.error(`[F2A] WebRTC signaling error: ${err.message}`);
    }
  }

  // ==================== 公开 API ====================

  /**
   * 连接到指定 Agent
   */
  async connectToAgent(agentId, address, port) {
    await this.p2p.connectToAgent(agentId, address, port);
    
    // 尝试升级到 WebRTC
    if (this.webrtc) {
      setTimeout(() => {
        this.upgradeToWebRTC(agentId).catch(() => {});
      }, 1000);
    }
    
    return this;
  }

  /**
   * 发送消息
   */
  sendMessage(peerId, content) {
    return this.p2p.sendToPeer(peerId, {
      type: 'message',
      id: crypto.randomUUID(),
      from: this.myAgentId,
      to: peerId,
      content,
      timestamp: Date.now()
    });
  }

  /**
   * 查询 peer 的技能
   */
  async querySkills(peerId) {
    return this.skills.querySkills(peerId, this._createConnectionProxy(peerId));
  }

  /**
   * 调用 peer 的技能
   */
  async invokeSkill(peerId, skillName, parameters) {
    return this.skills.invokeSkill(peerId, skillName, parameters, this._createConnectionProxy(peerId));
  }

  /**
   * 注册本地技能
   */
  registerSkill(name, definition) {
    this.skills.registerSkill(name, definition);
    return this;
  }

  /**
   * 发送文件 (WIP - 功能开发中)
   */
  async sendFile(peerId, filePath) {
    console.warn('[F2A] File transfer is still in development');
    return this.files.sendFile(peerId, filePath, this._createConnectionProxy(peerId));
  }

  // ==================== 群聊 API ====================

  /**
   * 创建群组
   */
  createGroup(name, options = {}) {
    return this.groups.createGroup(name, options);
  }

  /**
   * 邀请成员加入群组
   */
  inviteToGroup(groupId, peerId) {
    const invite = this.groups.inviteMember(groupId, peerId);
    this.p2p.sendToPeer(peerId, invite);
    return invite;
  }

  /**
   * 发送群消息
   */
  sendGroupMessage(groupId, content) {
    return this.groups.sendGroupMessage(groupId, content, (peerId, message) => {
      this._sendRaw(peerId, JSON.stringify(message));
    });
  }

  /**
   * 离开群组
   */
  leaveGroup(groupId) {
    this.groups.leaveGroup(groupId);
  }

  /**
   * 获取群组信息
   */
  getGroupInfo(groupId) {
    return this.groups.getGroupInfo(groupId);
  }

  /**
   * 获取所有群组
   */
  getAllGroups() {
    return this.groups.getAllGroups();
  }

  // ==================== 状态查询 API ====================

  /**
   * 获取发现的 Agents
   */
  getDiscoveredAgents() {
    return this.p2p.getDiscoveredAgents();
  }

  /**
   * 获取已连接 Peers
   */
  getConnectedPeers() {
    return this.p2p.getConnectedPeers();
  }

  /**
   * 获取连接类型
   */
  getConnectionType(peerId) {
    return this.connectionTypes.get(peerId);
  }

  /**
   * 断开连接
   */
  disconnect(peerId) {
    this.p2p.blacklist(peerId);
    if (this.webrtc) {
      this.webrtc.close(peerId);
    }
    if (this.crypto) {
      this.crypto.clearSession(peerId);
    }
    this.connectionTypes.delete(peerId);
    return this;
  }

  /**
   * 关闭所有连接
   */
  close() {
    this.stop();
  }
}

// 导出模块
module.exports = {
  F2A,
  ServerlessP2P,
  Messaging,
  SkillsManager,
  FileTransfer,
  GroupChat,
  E2ECrypto,
  P2PManager,
  WebRTCManager,
  IdentityManager
};