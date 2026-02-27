# F2A

> **"En Taro Adun!"** 🚀
> 
> F2A = **F2** (选中所有单位) + **A** (A过去)
> 
> 灵感来自星际争霸中神族的"卡拉"心灵连接——让所有 Agent 像神族战士一样连接成一个整体，然后一起"A过去"解决问题！

**纯 P2P Agent 协作网络，无需服务器，局域网直连。**

## 项目结构

```
F2A/
├── skill/              # F2A Skill (OpenClaw Agent)
│   ├── scripts/
│   │   ├── serverless.js    # 无 Server P2P 核心
│   │   ├── crypto.js        # 端到端加密
│   │   ├── webrtc.js        # WebRTC 直连
│   │   ├── messaging.js     # 消息通信
│   │   ├── skills.js        # 技能管理
│   │   ├── files.js         # 文件传输
│   │   ├── group.js         # 群聊
│   │   └── ...
│   ├── tests/               # 测试代码
│   ├── examples/            # 使用示例
│   ├── references/
│   │   └── protocol.md      # 协议规范
│   ├── SKILL.md             # 技能文档
│   └── package.json
│
└── docs/
    ├── v0.3-roadmap.md      # 功能路线图
    └── security-design.md   # 安全设计
```

## 核心特性

### 🔍 自动发现
UDP 广播自动发现局域网内的 Agent，无需配置。

### 🔐 端到端加密
- ECDH (X25519) 密钥交换
- AES-256-GCM 对称加密
- Ed25519 身份签名验证

### 🔗 WebRTC 直连
- NAT 穿透
- 失败自动回退到 TCP

### 💬 消息通信
- 1对1私聊
- 群聊广播
- 消息送达确认

### 🛠️ 技能调用
- 查询 peer 的可用 skills
- 远程执行 skill
- 参数类型验证

### 📁 文件分享
- 分块传输
- MD5 完整性校验
- 传输进度追踪

### 👥 群聊
- 创建群组
- 邀请成员
- 消息广播

### 🛡️ 安全防护
- 白名单机制
- 手动确认新连接
- 黑名单屏蔽
- 速率限制防 DoS
- 消息防重放

## 快速开始

### 一键安装 (推荐)

使用 curl 一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash
```

指定 P2P 端口安装：

```bash
curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --port 9001
```

### 手动安装

```bash
git clone https://github.com/LuciusCao/F2A.git
cd F2A/skill
npm install
```

### 使用无 Server 模式

```javascript
const { ServerlessP2P } = require('./scripts/serverless');
const crypto = require('crypto');

// 生成身份
const keyPair = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const myAgentId = crypto.randomUUID();

// 创建 P2P 实例
const p2p = new ServerlessP2P({
  myAgentId,
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
  console.log(`🔍 Found: ${agentId.slice(0, 8)}... at ${address}:${port}`);
});

p2p.on('confirmation_required', ({ agentId, accept, reject }) => {
  console.log(`⚠️  Connection request from: ${agentId.slice(0, 8)}...`);
  // 显示确认对话框，用户选择允许或拒绝
  accept(); // 或 reject()
});

p2p.on('peer_connected', ({ agentId }) => {
  console.log(`✅ Connected: ${agentId.slice(0, 8)}...`);
});

// 发送消息
p2p.sendToPeer('peer-uuid', { type: 'hello', content: 'Hi!' });
```

### 运行示例

```bash
# 如果通过 install.sh 安装
f2a

# 或手动运行
cd F2A/skill/examples
node serverless-example.js
```

## 安全等级

| 等级 | 配置 | 适用场景 |
|------|------|----------|
| **Low** | 仅加密 | 完全信任的家庭局域网 |
| **Medium** | 加密 + 手动确认 | 办公室/共享网络 |
| **High** | 加密 + 白名单 + 签名 | 公共网络/高安全需求 |

## 协议流程

### 无 Server 连接流程

```
Agent A (已知)                           Agent B (新加入)
     |                                         |
     | 1. UDP 广播发现                         |
     |<-------- 发现 A ------------------------|
     |                                         |
     | 2. TCP 直接连接                         |
     |<-------- 连接 A:9000 -------------------|
     |                                         |
     | 3. 身份挑战                             |
     |-------- identity_challenge ------------>|
     |                                         |
     | 4. 身份响应                             |
     |<------- identity_response --------------|
     |                                         |
     | 5. 验证签名                             |
     |   - 验证 challenge 签名                 |
     |   - 检查白名单/黑名单                   |
     |                                         |
     | 6. 手动确认 (如果需要)                   |
     |-------- confirmation_request ---------->|
     |<------- confirmation_response ----------|
     |                                         |
     |<======== 验证通过，建立连接 ===========>|
     |                                         |
     | 7. 加密通信                             |
     |-------- ECDH 密钥交换 ----------------->|
     |<------- AES-GCM 加密通信 -------------->|
```

## 测试

```bash
# 运行所有测试
npm test

# 运行单个模块测试
npm run test:crypto
npm run test:group
npm run test:skills
```

## 文档

- [SKILL.md](skill/SKILL.md) - 详细使用文档
- [protocol.md](skill/references/protocol.md) - 协议规范
- [security-design.md](docs/security-design.md) - 安全设计
- [v0.3-roadmap.md](docs/v0.3-roadmap.md) - 功能路线图

## License

MIT — "En Taro Adun!"
