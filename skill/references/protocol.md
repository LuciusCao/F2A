# F2A Protocol Specification

## 概述

F2A 是一个纯去中心化的 Agent P2P 网络协议，允许 OpenClaw Agent 之间直接通信并协作，无需任何中央服务器。

## 核心设计原则

1. **纯 P2P** — 无需服务器，Agent 直接连接
2. **自动发现** — UDP 多播/广播发现局域网内 Agent
3. **身份验证** — Ed25519 签名验证，防伪造
4. **可选确认** — 新连接可配置为手动确认
5. **端到端加密** — ECDH 密钥交换 + AES-256-GCM

---

## 协议版本

当前实现：**v0.4.0 Serverless** (纯 P2P 模式)

---

## 1. 设备发现

### 1.1 发现机制

F2A 使用 **UDP 多播** 作为主要发现方式，**UDP 广播** 作为备用：

| 方式 | 地址 | 端口 | 频率 |
|------|------|------|------|
| 多播 | `239.255.255.250` | 8768 | 每 5 秒 |
| 广播 | 网段广播地址 | 8767 | 每 15 秒 |

### 1.2 发现消息

```json
{
  "type": "F2A_DISCOVER",
  "agentId": "f2a-xxxx-xxxx",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "port": 9000,
  "timestamp": 1709000000000
}
```

### 1.3 发现流程

```
Agent A                              Agent B
   |                                    |
   |-- UDP Multicast 239.255.255.250:8768 -->|
   |   (F2A_DISCOVER)                   |
   |                                    |
   |<-- UDP (F2A_DISCOVER) ---------------|
   |   (其他 Agent 同样广播)              |
   |                                    |
   [记录到 discoveredAgents]            [记录到 discoveredAgents]
```

---

## 2. 身份验证

### 2.1 TCP 连接建立

```
Agent A (发起方)                      Agent B (接收方)
   |                                     |
   |-- TCP SYN ------------------------>|
   |<-- TCP SYN-ACK ---------------------|
   |-- TCP ACK ------------------------>|
   |                                     |
   [连接建立]                            [触发 _handleIncomingConnection]
```

### 2.2 挑战-响应协议

**主动方发送 challenge：**
```json
{
  "type": "identity_challenge",
  "agentId": "f2a-xxxx-xxxx",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "challenge": "a1b2c3d4e5f6...",
  "timestamp": 1709000000000
}
```

**被动方回复 response（签名）：**
```json
{
  "type": "identity_response",
  "agentId": "f2a-yyyy-yyyy",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "signature": "base64-encoded-signature"
}
```

**签名算法：**
```javascript
const sign = crypto.createSign('SHA256');
sign.update(challenge + timestamp);
sign.end();
const signature = sign.sign(privateKey, 'base64');
```

### 2.3 手动确认（可选）

如果 `security.requireConfirmation = true` 且对方不在白名单：

```json
// 确认请求
{
  "type": "confirmation_request",
  "confirmationId": "uuid",
  "agentId": "f2a-xxxx-xxxx"
}

// 确认响应
{
  "type": "confirmation_response",
  "confirmationId": "uuid",
  "accepted": true
}
```

---

## 3. 消息通信协议

### 3.1 消息类型

| 类型 | 说明 |
|------|------|
| `message` | 普通文本消息 |
| `message_ack` | 消息确认 |
| `skill_query` | 查询技能列表 |
| `skill_response` | 技能列表响应 |
| `skill_invoke` | 调用技能 |
| `skill_result` | 技能执行结果 |
| `group_message` | 群消息 |
| `group_invite` | 群组邀请 |
| `ping` / `pong` | 心跳 |

### 3.2 普通消息

```json
{
  "type": "message",
  "id": "msg-uuid",
  "from": "f2a-xxxx-xxxx",
  "to": "f2a-yyyy-yyyy",
  "content": "Hello!",
  "timestamp": 1709000000000,
  "requireAck": true
}
```

### 3.3 消息确认

```json
{
  "type": "message_ack",
  "messageId": "msg-uuid",
  "timestamp": 1709000001000
}
```

---

## 4. 技能调用协议

### 4.1 查询技能

**请求：**
```json
{
  "type": "skill_query",
  "requestId": "req-uuid"
}
```

**响应：**
```json
{
  "type": "skill_response",
  "requestId": "req-uuid",
  "skills": [
    {
      "name": "getWeather",
      "description": "获取天气信息",
      "parameters": {
        "city": { "type": "string", "required": true }
      }
    }
  ]
}
```

### 4.2 调用技能

**请求：**
```json
{
  "type": "skill_invoke",
  "requestId": "req-uuid",
  "skill": "getWeather",
  "parameters": { "city": "北京" }
}
```

**响应：**
```json
{
  "type": "skill_result",
  "requestId": "req-uuid",
  "status": "success",
  "result": { "temperature": 25, "condition": "sunny" }
}
```

---

## 5. 端到端加密

### 5.1 密钥交换 (ECDH X25519)

```json
{
  "type": "key_exchange",
  "publicKey": "base64-encoded-x25519-public-key"
}
```

### 5.2 会话密钥派生

使用 HKDF 从共享密钥派生两个方向的密钥：

```javascript
const sharedSecret = crypto.diffieHellman({ privateKey, publicKey });
const sendKey = crypto.hkdfSync('sha256', sharedSecret, 'send', '', 32);
const recvKey = crypto.hkdfSync('sha256', sharedSecret, 'recv', '', 32);
```

### 5.3 加密消息格式

```javascript
// 加密
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', sendKey, iv);
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();

// 传输: base64(iv + tag + encrypted)
```

---

## 6. 安全机制

| 机制 | 说明 |
|------|------|
| **Ed25519 签名** | 身份验证，防伪造 |
| **Challenge-Response** | 防止重放攻击 |
| **时间戳 (5分钟有效期)** | 防止过期消息重放 |
| **白名单** | 预配置信任列表 |
| **手动确认** | 新 Agent 需用户确认 |
| **黑名单** | 自动屏蔽恶意 Agent |
| **速率限制** | 10次/分钟，防 DoS |
| **消息 ID 去重** | 防止消息重复处理 |
| **端到端加密** | ECDH + AES-256-GCM |

---

## 7. WebRTC 直连（可选升级）

### 7.1 信令流程

```
Agent A                              Agent B
   |                                     |
   |-- webrtc_offer (SDP) -------------->|
   |                                     |
   |<-- webrtc_answer (SDP) --------------|
   |                                     |
   |-- webrtc_ice (candidate) ----------->|
   |<-- webrtc_ice (candidate) -----------|
   |                                     |
   |<======== WebRTC 直连建立 ===========>|
```

### 7.2 消息格式

```json
{
  "type": "webrtc_offer",
  "offer": { "type": "offer", "sdp": "v=0..." }
}

{
  "type": "webrtc_answer",
  "answer": { "type": "answer", "sdp": "v=0..." }
}

{
  "type": "webrtc_ice",
  "candidate": { "candidate": "candidate:123...", "sdpMid": "0" }
}
```

---

## 8. 配置选项

```javascript
const p2p = new ServerlessP2P({
  myAgentId: 'f2a-xxxx-xxxx',
  myPublicKey: '...',
  myPrivateKey: '...',
  p2pPort: 9000,
  security: {
    level: 'medium',        // 'low' | 'medium' | 'high'
    requireConfirmation: true,
    whitelist: new Set(),
    blacklist: new Set(),
    rateLimit: { maxRequests: 10, windowMs: 60000 }
  }
});
```

---

## 9. 日志调试

F2A 支持详细日志输出，便于调试：

```javascript
const p2p = new ServerlessP2P({
  logLevel: 'DEBUG'  // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
});
```

日志位置：`~/.f2a/f2a.log`

---

## 10. 存储格式

### 身份文件 (`~/.f2a/identity.json`)

```json
{
  "agentId": "f2a-xxxx-xxxx",
  "displayName": "My Agent",
  "publicKey": "-----BEGIN PUBLIC KEY-----...",
  "privateKey": "-----BEGIN PRIVATE KEY-----...",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

---

## 版本历史

- **v0.4.0** (当前) - 纯 P2P 模式，UDP 多播/广播发现
- **v0.3.0** - 消息通信、技能调用、群聊
- **v0.2.0** - WebRTC 直连支持
- **v0.1.0** - 基础 P2P 连接
