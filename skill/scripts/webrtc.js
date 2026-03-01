/**
 * F2A WebRTC Module
 * 
 * WebRTC P2P 连接模块，支持 NAT 穿透
 */

const EventEmitter = require('events');

// WebRTC 适配（Node.js 环境使用 wrtc 包，浏览器环境使用原生 RTCPeerConnection）
let RTCPeerConnection, RTCSessionDescription, RTCIceCandidate;
let hasWebRTC = false;

try {
  const wrtc = require('wrtc');
  RTCPeerConnection = wrtc.RTCPeerConnection;
  RTCSessionDescription = wrtc.RTCSessionDescription;
  RTCIceCandidate = wrtc.RTCIceCandidate;
  hasWebRTC = true;
} catch {
  // 浏览器环境
  if (typeof global !== 'undefined' && global.RTCPeerConnection) {
    RTCPeerConnection = global.RTCPeerConnection;
    RTCSessionDescription = global.RTCSessionDescription;
    RTCIceCandidate = global.RTCIceCandidate;
    hasWebRTC = true;
  }
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

class WebRTCManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.iceServers = options.iceServers || ICE_SERVERS;
    this.connections = new Map(); // peerId -> RTCPeerConnection
    this.dataChannels = new Map(); // peerId -> RTCDataChannel
    this.pendingCandidates = new Map(); // peerId -> candidates[]
  }

  /**
   * 创建 WebRTC 连接（作为发起方）
   */
  async createConnection(peerId) {
    try {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.connections.set(peerId, pc);

      // 创建数据通道
      const dataChannel = pc.createDataChannel('f2a', {
        ordered: true,
        maxRetransmits: 3
      });
      this._setupDataChannel(peerId, dataChannel);

      // 监听 ICE 候选
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.emit('ice_candidate', {
            peerId,
            candidate: event.candidate
          });
        }
      };

      // 监听连接状态
      pc.onconnectionstatechange = () => {
        this.emit('connection_state', {
          peerId,
          state: pc.connectionState
        });

        if (pc.connectionState === 'connected') {
          this.emit('connected', { peerId });
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this.emit('disconnected', { peerId });
        }
      };

      // 创建 offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      return {
        type: 'offer',
        sdp: offer.sdp
      };
    } catch (err) {
      // 清理失败的连接
      this.close(peerId);
      throw new Error(`Failed to create WebRTC connection: ${err.message}`);
    }
  }

  /**
   * 处理收到的 offer（作为应答方）
   */
  async handleOffer(peerId, offer) {
    try {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.connections.set(peerId, pc);

      // 监听数据通道
      pc.ondatachannel = (event) => {
        const dataChannel = event.channel;
        this._setupDataChannel(peerId, dataChannel);
      };

      // 监听 ICE 候选
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.emit('ice_candidate', {
            peerId,
            candidate: event.candidate
          });
        }
      };

      // 监听连接状态
      pc.onconnectionstatechange = () => {
        this.emit('connection_state', {
          peerId,
          state: pc.connectionState
        });
      };

      // 设置 remote description
      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: offer.sdp
      }));

      // 创建 answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      return {
        type: 'answer',
        sdp: answer.sdp
      };
    } catch (err) {
      // 清理失败的连接
      this.close(peerId);
      throw new Error(`Failed to handle WebRTC offer: ${err.message}`);
    }
  }

  /**
   * 处理收到的 answer
   */
  async handleAnswer(peerId, answer) {
    try {
      const pc = this.connections.get(peerId);
      if (!pc) {
        throw new Error(`No connection found for peer: ${peerId}`);
      }

      await pc.setRemoteDescription(new RTCSessionDescription({
        type: 'answer',
        sdp: answer.sdp
      }));

      // 添加缓存的候选
      const candidates = this.pendingCandidates.get(peerId) || [];
      for (const candidate of candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      this.pendingCandidates.delete(peerId);
    } catch (err) {
      // 清理失败的连接
      this.close(peerId);
      throw new Error(`Failed to handle WebRTC answer: ${err.message}`);
    }
  }

  /**
   * 添加 ICE 候选
   */
  async addIceCandidate(peerId, candidate) {
    const pc = this.connections.get(peerId);
    if (!pc) {
      // 缓存候选，等待连接建立
      if (!this.pendingCandidates.has(peerId)) {
        this.pendingCandidates.set(peerId, []);
      }
      this.pendingCandidates.get(peerId).push(candidate);
      return;
    }

    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * 设置数据通道
   */
  _setupDataChannel(peerId, dataChannel) {
    this.dataChannels.set(peerId, dataChannel);

    dataChannel.onopen = () => {
      this.emit('data_channel_open', { peerId });
    };

    dataChannel.onclose = () => {
      this.emit('data_channel_close', { peerId });
    };

    dataChannel.onmessage = (event) => {
      this.emit('message', {
        peerId,
        data: event.data
      });
    };

    dataChannel.onerror = (error) => {
      this.emit('error', { peerId, error });
    };
  }

  /**
   * 发送消息
   */
  send(peerId, data) {
    const dataChannel = this.dataChannels.get(peerId);
    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error(`Data channel not open for peer: ${peerId}`);
    }

    const message = typeof data === 'string' ? data : JSON.stringify(data);
    dataChannel.send(message);
  }

  /**
   * 关闭连接
   */
  close(peerId) {
    const dataChannel = this.dataChannels.get(peerId);
    if (dataChannel) {
      dataChannel.close();
      this.dataChannels.delete(peerId);
    }

    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }

    this.pendingCandidates.delete(peerId);
  }

  /**
   * 关闭所有连接
   */
  closeAll() {
    for (const peerId of this.connections.keys()) {
      this.close(peerId);
    }
  }

  /**
   * 获取连接状态
   */
  getConnectionState(peerId) {
    const pc = this.connections.get(peerId);
    return pc ? pc.connectionState : 'closed';
  }

  /**
   * 检查是否已连接
   */
  isConnected(peerId) {
    const dataChannel = this.dataChannels.get(peerId);
    return dataChannel && dataChannel.readyState === 'open';
  }
}

module.exports = { WebRTCManager };
