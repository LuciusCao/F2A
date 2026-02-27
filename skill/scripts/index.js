/**
 * F2A Main Module
 * 
 * 统一导出所有 F2A 功能模块
 */

const { Messaging } = require('./messaging');
const { SkillsManager } = require('./skills');
const { FileTransfer } = require('./files');
const { P2PManager } = require('./p2p');
const { WebRTCManager } = require('./webrtc');
const { E2ECrypto } = require('./crypto');
const { GroupChat } = require('./group');
const { autoDiscover } = require('./discover');
const { loadIdentity, savePeer } = require('./pair');

class F2A {
  constructor(options = {}) {
    this.options = options;
    this.myAgentId = null;
    this.identity = null;
    this.useWebRTC = options.useWebRTC !== false; // 默认启用 WebRTC
    this.useEncryption = options.useEncryption !== false; // 默认启用加密
    
    // 初始化各模块
    this.p2p = new P2PManager(options.p2p);
    this.webrtc = this.useWebRTC ? new WebRTCManager(options.webrtc) : null;
    this.crypto = this.useEncryption ? new E2ECrypto() : null;
    this.messaging = new Messaging(options.messaging);
    this.skills = new SkillsManager(options.skills);
    this.files = new FileTransfer(options.files);
    this.groups = new GroupChat({ myAgentId: this.myAgentId });
    
    // 连接类型: 'websocket' | 'webrtc'
    this.connectionTypes = new Map(); // peerId -> type
    
    // 绑定事件
    this._bindEvents();
  }

  /**
   * 初始化 F2A
   */
  async initialize() {
    // 加载身份
    this.identity = await loadIdentity();
    this.myAgentId = this.identity.agentId;
    
    // 初始化群聊
    this.groups.initialize(this.myAgentId);
    
    // 绑定群聊事件
    this._bindGroupEvents();
    
    // 初始化加密
    if (this.crypto) {
      this.crypto.loadKeyPair(
        Buffer.from(this.identity.publicKey, 'base64').toString('pem'),
        Buffer.from(this.identity.privateKey, 'base64').toString('pem')
      );
    }
    
    console.log(`[F2A] Initialized as ${this.myAgentId}`);
    console.log(`[F2A] WebRTC: ${this.useWebRTC ? 'enabled' : 'disabled'}`);
    console.log(`[F2A] E2E Encryption: ${this.useEncryption ? 'enabled' : 'disabled'}`);
    console.log(`[F2A] Group Chat: enabled`);
    return this;
  }

  /**
   * 绑定模块间事件
   */
  _bindEvents() {
    // WebSocket P2P 消息路由
    this.p2p.on('message', ({ peerId, data }) => {
      this._handleMessage(peerId, data);
    });

    // WebRTC 消息路由
    if (this.webrtc) {
      this.webrtc.on('message', ({ peerId, data }) => {
        this._handleMessage(peerId, data);
      });

      this.webrtc.on('connected', ({ peerId }) => {
        this.connectionTypes.set(peerId, 'webrtc');
        console.log(`[F2A] WebRTC connected to ${peerId}`);
        this.emit('connected', { peerId, type: 'webrtc' });
      });

      this.webrtc.on('disconnected', ({ peerId }) => {
        this.connectionTypes.delete(peerId);
        // 回退到 WebSocket
        if (this.p2p.isConnected(peerId)) {
          this.connectionTypes.set(peerId, 'websocket');
        }
      });
    }

    // 连接建立时注册到 messaging
    this.p2p.on('connected', ({ peerId }) => {
      if (!this.connectionTypes.has(peerId)) {
        this.connectionTypes.set(peerId, 'websocket');
      }
      const conn = this._getConnection(peerId);
      if (conn) {
        this.messaging.registerPeer(peerId, {
          send: (data) => this._sendRaw(peerId, data),
          on: (event, handler) => {},
          close: () => this.disconnect(peerId)
        });
      }
    });
  }

  /**
   * 处理收到的消息
   */
  _handleMessage(peerId, data) {
    try {
      // 如果启用了加密，先解密
      let plaintext = data;
      if (this.crypto && this.crypto.sessionKeys.has(peerId)) {
        try {
          plaintext = this.crypto.decrypt(peerId, data);
        } catch (err) {
          // 解密失败，可能是明文消息
          console.warn(`[F2A] Decryption failed for ${peerId}, treating as plaintext`);
        }
      }

      const message = JSON.parse(plaintext);
      
      // 处理密钥交换
      if (message.type === 'key_exchange') {
        this._handleKeyExchange(peerId, message);
        return;
      }
      
      // 处理 WebRTC 信令
      if (message.type === 'webrtc_offer' || message.type === 'webrtc_answer' || message.type === 'webrtc_ice') {
        this._handleWebRTCSignal(peerId, message);
        return;
      }

      // 路由到对应模块
      switch (message.type) {
        case 'message':
        case 'message_ack':
          this.messaging._handleMessage(peerId, plaintext);
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
          this.files.handleFileOffer(message, peerId, this._createConnectionProxy(peerId));
          break;
        case 'pong':
          this.p2p.handlePong(peerId);
          break;
      }
    } catch (err) {
      console.error('[F2A] Message routing error:', err.message);
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
   * 获取连接
   */
  _getConnection(peerId) {
    const type = this.connectionTypes.get(peerId);
    if (type === 'webrtc' && this.webrtc) {
      return this.webrtc;
    }
    return this.p2p.connections.get(peerId);
  }

  /**
   * 发送原始数据
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
      this.p2p.send(peerId, payload);
    }
  }

  /**
   * 执行密钥交换
   */
  async performKeyExchange(peerId) {
    if (!this.crypto) return;

    const publicKey = this.crypto.getPublicKey();
    this._sendRaw(peerId, JSON.stringify({
      type: 'key_exchange',
      publicKey: Buffer.from(publicKey).toString('base64')
    }));
  }

  /**
   * 处理密钥交换
   */
  _handleKeyExchange(peerId, message) {
    if (!this.crypto) return;

    const peerPublicKey = Buffer.from(message.publicKey, 'base64').toString('pem');
    this.crypto.deriveSessionKey(peerId, peerPublicKey);
    console.log(`[F2A] E2E encryption established with ${peerId}`);
  }

  /**
   * 升级到 WebRTC 连接
   */
  async upgradeToWebRTC(peerId) {
    if (!this.webrtc) return;

    const offer = await this.webrtc.createConnection(peerId);
    this._sendRaw(peerId, JSON.stringify({
      type: 'webrtc_offer',
      offer
    }));
  }

  /**
   * 处理 WebRTC 信令
   */
  async _handleWebRTCSignal(peerId, message) {
    if (!this.webrtc) return;

    switch (message.type) {
      case 'webrtc_offer':
        const answer = await this.webrtc.handleOffer(peerId, message.offer);
        this._sendRaw(peerId, JSON.stringify({
          type: 'webrtc_answer',
          answer
        }));
        break;
      case 'webrtc_answer':
        await this.webrtc.handleAnswer(peerId, message.answer);
        break;
      case 'webrtc_ice':
        await this.webrtc.addIceCandidate(peerId, message.candidate);
        break;
    }
  }

  /**
   * 连接到 peer
   */
  async connect(peerId, peerAddress) {
    await this.p2p.connect(peerId, peerAddress);
    
    // 执行密钥交换
    if (this.crypto) {
      await this.performKeyExchange(peerId);
    }
    
    // 尝试升级到 WebRTC
    if (this.webrtc) {
      setTimeout(() => {
        this.upgradeToWebRTC(peerId).catch(() => {
          console.log(`[F2A] WebRTC upgrade failed for ${peerId}, using WebSocket`);
        });
      }, 1000);
    }
    
    return this;
  }

  /**
   * 发送消息
   */
  async sendMessage(peerId, content) {
    return this.messaging.sendMessage(peerId, content, {
      myAgentId: this.myAgentId
    });
  }

  /**
   * 查询 peer 的技能
   */
  async querySkills(peerId) {
    const conn = this._getConnection(peerId);
    if (!conn) throw new Error(`Not connected to peer: ${peerId}`);
    return this.skills.querySkills(peerId, this._createConnectionProxy(peerId));
  }

  /**
   * 调用 peer 的技能
   */
  async invokeSkill(peerId, skillName, parameters) {
    const conn = this._getConnection(peerId);
    if (!conn) throw new Error(`Not connected to peer: ${peerId}`);
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
   * 发送文件
   */
  async sendFile(peerId, filePath) {
    const conn = this._getConnection(peerId);
    if (!conn) throw new Error(`Not connected to peer: ${peerId}`);
    return this.files.sendFile(peerId, filePath, this._createConnectionProxy(peerId));
  }

  // ==================== 群聊方法 ====================

  /**
   * 创建群组
   */
  createGroup(name, options = {}) {
    return this.groups.createGroup(name, options);
  }

  /**
   * 邀请成员加入群组
   */
  async inviteToGroup(groupId, peerId) {
    const invite = this.groups.inviteMember(groupId, peerId);
    
    // 发送邀请给 peer
    this._sendRaw(peerId, JSON.stringify(invite));
    
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

  /**
   * 获取我加入的群组
   */
  getMyGroups() {
    return this.groups.getMyGroups();
  }

  /**
   * 绑定群聊事件
   */
  _bindGroupEvents() {
    this.groups.on('group_message', (data) => {
      this.emit('group_message', data);
    });

    this.groups.on('group_invite_received', (data) => {
      this.emit('group_invite', data);
    });

    this.groups.on('group_created', (data) => {
      this.emit('group_created', data);
    });

    this.groups.on('group_joined', (data) => {
      this.emit('group_joined', data);
    });
  }

  /**
   * 获取已连接 peers
   */
  getConnectedPeers() {
    return Array.from(this.connectionTypes.keys());
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
    this.p2p.disconnect(peerId);
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
    this.p2p.disconnectAll();
    if (this.webrtc) {
      this.webrtc.closeAll();
    }
    if (this.crypto) {
      this.crypto.clearAllSessions();
    }
    this.messaging.disconnectAll();
  }
}

// 使 F2A 支持事件
const EventEmitter = require('events');
Object.setPrototypeOf(F2A.prototype, EventEmitter.prototype);

// 导出模块
module.exports = {
  F2A,
  Messaging,
  SkillsManager,
  FileTransfer,
  P2PManager,
  WebRTCManager,
  E2ECrypto,
  GroupChat,
  autoDiscover,
  loadIdentity,
  savePeer
};
