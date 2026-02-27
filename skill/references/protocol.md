# F2A Protocol Specification

## 概述

F2A 是一个去中心化的 Agent P2P 网络协议，允许 OpenClaw Agent 之间建立信任关系并协作。

## 核心设计原则

1. **去中心化** — 不依赖中心化服务，仅使用 rendezvous server 辅助发现
2. **最小信任** — 配对码一次性使用，公钥验证身份
3. **渐进式连接** — 先通过 rendezvous 交换信息，再建立直接连接

## 协议流程

### 1. 配对建立

```
┌─────────┐                    ┌─────────────────┐                    ┌─────────┐
│ Agent A │                    │ Rendezvous Srv  │                    │ Agent B │
└────┬────┘                    └────────┬────────┘                    └────┬────┘
     │                                   │                                  │
     │ WS /register                      │                                  │
     ├──────────────────────────────────>│                                  │
     │                                   │                                  │
     │ { type: "pair_code", code: "X7K9M2" }                           │
     │<──────────────────────────────────┤                                  │
     │                                   │                                  │
     │ { type: "identity", agentId, publicKey }                          │
     ├──────────────────────────────────>│                                  │
     │                                   │                                  │
     │                                   │ WS /pair/X7K9M2                 │
     │                                   │<─────────────────────────────────┤
     │                                   │                                  │
     │                                   │ { type: "identity", ... }        │
     │                                   │<─────────────────────────────────┤
     │                                   │                                  │
     │ { type: "peer_connected", peer: B }│ { type: "peer_connected", peer: A }│
     │<──────────────────────────────────┤─────────────────────────────────>│
     │                                   │                                  │
```

### 2. 消息格式

#### Pair Code Response (Server -> Agent A)
```json
{
  "type": "pair_code",
  "code": "A3B7C9",
  "ttl": 300000,
  "expiresAt": 1709000000000
}
```

#### Identity Message (Agent -> Server)
```json
{
  "type": "identity",
  "agentId": "uuid-v4-string",
  "publicKey": "base64-encoded-ed25519-public-key",
  "metadata": {
    "name": "Agent Name",
    "hostname": "server-name",
    "version": "0.1.0"
  }
}
```

#### Peer Connected (Server -> Both Agents)
```json
{
  "type": "peer_connected",
  "peer": {
    "agentId": "uuid-v4-string",
    "publicKey": "base64-encoded-public-key",
    "metadata": { ... }
  },
  "peerAddress": "192.168.1.100"
}
```

## 安全考虑

### 配对码安全
- 6位大写字母数字，36^6 = 2,176,782,336 种组合
- 5分钟过期，暴力破解窗口极短
- 一次性使用，防止重放攻击

### 身份验证
- 使用 Ed25519 公钥加密
- 公钥指纹用于唯一标识 Agent
- 私钥本地存储，永不传输

### 通信安全
- WebSocket 建议配合 TLS (wss://)
- 配对完成后，双方可建立加密通道

## 存储格式

### peers.json
```json
{
  "myAgentId": "uuid-v4",
  "myKeyPair": {
    "publicKey": "base64",
    "privateKey": "base64"
  },
  "peers": [
    {
      "agentId": "uuid-v4",
      "publicKey": "base64",
      "metadata": {},
      "connectedAt": "ISO-8601",
      "lastSeenAt": "ISO-8601"
    }
  ]
}
```

## 扩展方向

### v0.2: 直接连接 ✅ 已实现
- 配对后尝试 WebRTC 直连
- 失败时回退到 relay

### v0.3: Agent 协作网络 🚧 开发中
- **消息通信** - 实时文本消息
- **技能调用** - 查询和远程执行 peer 的 skills
- **文件分享** - 安全文件传输

### v0.4: 代码审查工作流 (未来扩展)

结构化的代码审查流程，支持逐行评论和审查结论。

**审查请求**:
```json
{
  "type": "review_request",
  "reviewId": "review-uuid",
  "title": "优化 utils.js",
  "description": "重构日期处理函数",
  "files": [
    {
      "path": "src/utils.js",
      "content": "...base64...",
      "language": "javascript"
    }
  ]
}
```

**添加评论**:
```json
{
  "type": "review_comment",
  "reviewId": "review-uuid",
  "file": "src/utils.js",
  "line": 23,
  "comment": "这里应该用 === 而不是 ==",
  "severity": "error"
}
```

**审查结论**:
```json
{
  "type": "review_conclusion",
  "reviewId": "review-uuid",
  "status": "changes_requested",
  "score": 4,
  "summary": "整体不错，需要修复2个问题"
}
```

> 注：v0.3 阶段使用普通消息通信进行代码讨论，v0.4 再实现结构化审查。

### v0.5: 多跳网络
- 通过已知 peer 发现新 peer
- 构建去中心化网络拓扑

---

## v0.3 协议扩展

### 消息类型

```javascript
const MessageType = {
  // 基础协议
  IDENTITY: 'identity',
  PEER_CONNECTED: 'peer_connected',
  
  // 消息通信
  MESSAGE: 'message',
  MESSAGE_ACK: 'message_ack',
  
  // 技能调用
  SKILL_QUERY: 'skill_query',
  SKILL_RESPONSE: 'skill_response',
  SKILL_INVOKE: 'skill_invoke',
  SKILL_RESULT: 'skill_result',
  
  // 文件传输
  FILE_OFFER: 'file_offer',
  FILE_ACCEPT: 'file_accept',
  FILE_REJECT: 'file_reject',
  FILE_CHUNK: 'file_chunk',
  FILE_COMPLETE: 'file_complete',
  
  // 心跳
  PING: 'ping',
  PONG: 'pong'
};
```

### 消息通信协议

#### 发送消息
```json
{
  "type": "message",
  "id": "msg-uuid",
  "from": "agent-a-uuid",
  "to": "agent-b-uuid",
  "content": "消息内容",
  "timestamp": 1709000000000,
  "requireAck": true
}
```

#### 消息确认
```json
{
  "type": "message_ack",
  "messageId": "msg-uuid",
  "timestamp": 1709000001000
}
```

### 技能调用协议

#### 查询技能
```json
// 请求
{
  "type": "skill_query",
  "requestId": "req-uuid"
}

// 响应
{
  "type": "skill_response",
  "requestId": "req-uuid",
  "skills": [
    {
      "name": "weather",
      "description": "获取天气信息",
      "parameters": {
        "location": { "type": "string", "required": true }
      }
    }
  ]
}
```

#### 调用技能
```json
// 请求
{
  "type": "skill_invoke",
  "requestId": "req-uuid",
  "skill": "weather",
  "parameters": { "location": "北京" }
}

// 响应
{
  "type": "skill_result",
  "requestId": "req-uuid",
  "status": "success",
  "result": { "temperature": 25, "condition": "sunny" }
}
```

### 文件传输协议

#### 文件传输流程
```
1. 发送方: 发送 file_offer (文件名、大小、MD5、分块数)
2. 接收方: 回复 file_accept 或 file_reject
3. 发送方: 分块发送 file_chunk
4. 接收方: 校验 MD5，回复 file_complete
```

#### 文件 Offer
```json
{
  "type": "file_offer",
  "fileId": "file-uuid",
  "filename": "document.pdf",
  "size": 1048576,
  "md5": "d41d8cd98f00b204e9800998ecf8427e",
  "chunks": 10
}
```

#### 文件块
```json
{
  "type": "file_chunk",
  "fileId": "file-uuid",
  "chunkIndex": 0,
  "data": "base64-encoded-data",
  "isLast": false
}
```

---

## v0.3.3 协议扩展：群聊

### 群组管理

群组由创建者管理，成员通过邀请加入。

#### 创建群组
```json
{
  "type": "group_create",
  "groupId": "group-uuid",
  "name": "开发讨论组",
  "creator": "agent-a-uuid",
  "members": ["agent-a-uuid"]
}
```

#### 邀请成员
```json
{
  "type": "group_invite",
  "groupId": "group-uuid",
  "groupName": "开发讨论组",
  "creator": "agent-a-uuid",
  "members": ["agent-a-uuid", "agent-b-uuid"]
}
```

#### 群消息
```json
{
  "type": "group_message",
  "messageId": "msg-uuid",
  "groupId": "group-uuid",
  "from": "agent-a-uuid",
  "content": "大家好！",
  "timestamp": 1709000000000
}
```

### 群聊流程

```
Agent A (创建者)          Agent B          Agent C
     |                       |                 |
     |-- group_create ------>|                 |
     |                       |                 |
     |-- group_invite ------>|                 |
     |-- group_invite ------------------------>|
     |                       |                 |
     |                       |-- 接受邀请 ---->|
     |                       |                 |
     |<-- group_message -----|                 |
     |<-- group_message ----------------------|
     |                       |                 |
     |-- group_message ---------------------->|
     |-- group_message ----->|                 |
```

---

## v0.3.1 协议扩展：端到端加密

### 密钥交换

使用 ECDH (X25519) 进行密钥交换，派生 AES-256-GCM 会话密钥。

#### 密钥交换消息
```json
{
  "type": "key_exchange",
  "publicKey": "base64-encoded-x25519-public-key"
}
```

### 加密消息格式

加密后的消息使用 base64 编码，格式：
- IV (16 bytes) + Auth Tag (16 bytes) + Ciphertext

```javascript
// 加密前
const plaintext = JSON.stringify({ type: "message", content: "Hello" });

// 加密后 (base64)
const encrypted = "...base64-encoded-encrypted-data...";
```

---

## v0.3.2 协议扩展：WebRTC 直连

### WebRTC 信令流程

```
Agent A                              Agent B
   |                                     |
   |-- WebSocket 连接建立 -------------->|
   |                                     |
   |-- webrtc_offer (SDP) -------------->|
   |                                     |
   |<-- webrtc_answer (SDP) -------------|
   |                                     |
   |-- webrtc_ice (candidate) ---------->|
   |<-- webrtc_ice (candidate) ----------|
   |                                     |
   |<======== WebRTC 直连建立 ==========>|
   |                                     |
   |-- 关闭 WebSocket (可选) ------------>|
```

### 信令消息

#### Offer
```json
{
  "type": "webrtc_offer",
  "offer": {
    "type": "offer",
    "sdp": "v=0\no=- 123..."
  }
}
```

#### Answer
```json
{
  "type": "webrtc_answer",
  "answer": {
    "type": "answer",
    "sdp": "v=0\no=- 456..."
  }
}
```

#### ICE Candidate
```json
{
  "type": "webrtc_ice",
  "candidate": {
    "candidate": "candidate:123...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### 连接回退

如果 WebRTC 连接失败，自动回退到 WebSocket 连接。
