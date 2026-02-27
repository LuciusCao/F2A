---
name: f2a-network
description: F2A (Friend-to-Agent) pure P2P networking for OpenClaw Agent. Enables agents to discover and connect directly in LAN without servers, exchange public keys, and establish trusted peer relationships for messaging, skill invocation, file sharing, and group chat with end-to-end encryption (ECDH + AES-GCM) and Ed25519 identity verification.
---

# F2A

纯 P2P Agent 协作网络，无需服务器，局域网直连。

## 核心功能

- **自动发现** - UDP 广播自动发现局域网 Agent
- **端到端加密** - ECDH 密钥交换 + AES-256-GCM
- **身份验证** - Ed25519 签名验证
- **消息通信** - 1对1和群聊
- **技能调用** - 远程执行 peer 的 skills
- **文件分享** - 分块传输 + MD5 校验

## 快速开始

```javascript
const { ServerlessP2P } = require('./scripts/serverless');
const crypto = require('crypto');

// 生成身份
const keyPair = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// 创建 P2P 实例
const p2p = new ServerlessP2P({
  myAgentId: crypto.randomUUID(),
  myPublicKey: keyPair.publicKey,
  myPrivateKey: keyPair.privateKey,
  p2pPort: 9000,
  security: {
    level: 'medium',
    requireConfirmation: true
  }
});

// 启动
await p2p.start();

// 监听事件
p2p.on('agent_discovered', ({ agentId, address, port }) => {
  console.log(`Found: ${agentId.slice(0, 8)}... at ${address}:${port}`);
});

p2p.on('confirmation_required', ({ agentId, accept, reject }) => {
  // 显示确认对话框
  accept(); // 或 reject()
});

// 发送消息
p2p.sendToPeer('peer-uuid', { type: 'hello', content: 'Hi!' });
```

## 安全等级

| 等级 | 配置 | 场景 |
|------|------|------|
| low | 仅加密 | 家庭局域网 |
| medium | 加密 + 手动确认 | 办公室/共享网络 |
| high | 加密 + 白名单 + 签名 | 公共网络 |

## 详细参考

- [protocol.md](references/protocol.md) - 协议规范
- [security-design.md](../docs/security-design.md) - 安全设计

## 示例

```bash
node examples/serverless-example.js
```
