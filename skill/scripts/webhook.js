/**
 * F2A Webhook Bridge
 * 
 * 将 F2A 事件转发到 OpenClaw Webhook
 */

const http = require('http');

class WebhookBridge {
  constructor(options = {}) {
    this.openclawHost = options.openclawHost || 'localhost';
    this.openclawPort = options.openclawPort || 18789;
    this.token = options.token || '';
    this.hookPath = options.hookPath || '/hooks/f2a';
    this.verbose = options.verbose || false;
  }

  log(...args) {
    if (this.verbose) {
      console.log('[Webhook]', ...args);
    }
  }

  /**
   * 发送事件到 OpenClaw
   */
  async notify(event, data) {
    const url = `http://${this.openclawHost}:${this.openclawPort}${this.hookPath}`;
    
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data
    };

    return new Promise((resolve) => {
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': this.token ? `Bearer ${this.token}` : '',
            'X-F2A-Event': event
          }
        },
        (res) => {
          let responseData = '';
          res.on('data', chunk => responseData += chunk);
          res.on('end', () => {
            this.log(`Event ${event} sent, status: ${res.statusCode}`);
            resolve({ success: res.statusCode === 200, response: responseData });
          });
        }
      );

      req.on('error', (err) => {
        this.log(`Failed to send event ${event}:`, err.message);
        resolve({ success: false, error: err.message });
      });

      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  /**
   * 配对请求通知
   */
  async notifyPairRequest(peer, pairCode) {
    return this.notify('pair-request', {
      peer: {
        agentId: peer.agentId,
        metadata: peer.metadata
      },
      pairCode,
      message: `收到来自 ${peer.metadata?.name || peer.agentId} 的配对请求，配对码: ${pairCode}`
    });
  }

  /**
   * 配对成功通知
   */
  async notifyPairConnected(peer) {
    return this.notify('pair-connected', {
      peer: {
        agentId: peer.agentId,
        publicKey: peer.publicKey,
        metadata: peer.metadata,
        address: peer.address
      },
      message: `已与 ${peer.metadata?.name || peer.agentId} 建立连接`
    });
  }

  /**
   * 收到消息通知
   */
  async notifyMessage(peer, message) {
    return this.notify('message', {
      from: {
        agentId: peer.agentId,
        metadata: peer.metadata
      },
      message,
      messageTemplate: `收到来自 ${peer.metadata?.name || peer.agentId} 的消息: ${message}`
    });
  }

  /**
   * Peer 离线通知
   */
  async notifyPeerOffline(peer) {
    return this.notify('peer-offline', {
      peer: {
        agentId: peer.agentId,
        metadata: peer.metadata
      },
      message: `${peer.metadata?.name || peer.agentId} 已离线`
    });
  }

  /**
   * 更新可用通知
   */
  async notifyUpdateAvailable(currentVersion, newVersion) {
    return this.notify('update-available', {
      currentVersion,
      newVersion,
      message: `F2A Skill 有更新: ${newVersion} (当前: ${currentVersion})`
    });
  }
}

module.exports = { WebhookBridge };

// 直接运行测试
if (require.main === module) {
  const bridge = new WebhookBridge({
    openclawPort: 18789,
    token: process.env.F2A_WEBHOOK_TOKEN,
    verbose: true
  });

  // 测试发送
  bridge.notifyPairConnected({
    agentId: 'test-agent',
    metadata: { name: 'Test Agent' },
    publicKey: 'abc123'
  });
}
