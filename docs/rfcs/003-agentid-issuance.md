# RFC 003: AgentId 签发与验证机制

> **Status**: Implementation in Progress (签名已完成，验证待修复)
> **Created**: 2026-04-14
> **Updated**: 2026-04-18 (添加密钥分离架构说明)
> **Author**: Discussion with user

---

## 问题背景

### 当前实现的问题

用户可以随意定义 `agentId`，导致：
- ❌ 可能冒充其他 Agent
- ❌ 缺乏身份验证机制
- ❌ 格式混乱（有人用 UUID，有人用自定义字符串）
- ❌ 其他节点无法验证 AgentId 是否由声称的 PeerId 签发

### 需求

1. **AgentId 必须由节点签发**，不能由用户随意定义
2. **其他节点可以验证 AgentId**，验证不通过则拒绝通信
3. **一个节点可以注册多个 Agent**，每个 Agent 有独立的 AgentId
4. **AgentId 格式与 PeerId 区分**，便于识别

---

## 核心架构：双层身份 + 双套密钥

### 双层身份体系

F2A 采用两层身份架构：

```
┌─────────────────────────────────────────────────────────────┐
│                     Layer 1: Peer 层                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Node (物理设备)                    │    │
│  │                                                      │    │
│  │   PeerId (libp2p 身份)                               │    │
│  │   ├─ Ed25519 密钥对 (签名用)                          │    │
│  │   ├─ publicKey.raw (32 bytes) - Ed25519 公钥         │    │
│  │   ├─ privateKey.raw (64 bytes) - 扩展私钥            │    │
│  │   └──────────────────────────────────────────────────│    │
│  │                                                      │    │
│  │   一个 Node 可以运行多个 Agent                        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 同一个 Peer 上的多个 Agent
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Layer 2: Agent 层                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Agent A   │  │   Agent B   │  │   Agent C   │          │
│  │             │  │             │  │             │          │
│  │ AgentId:    │  │ AgentId:    │  │ AgentId:    │          │
│  │ agent:<P>:a │  │ agent:<P>:b │  │ agent:<P>:c │          │
│  │             │  │             │  │             │          │
│  │ signature:  │  │ signature:  │  │ signature:  │          │
│  │ Ed25519签名 │  │ Ed25519签名 │  │ Ed25519签名 │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                              │
│  <P> = PeerId 前 16 位，表示这些 Agent 都在同一 Node 上      │
└─────────────────────────────────────────────────────────────┘
```

### 双套密钥分离

| 密钥类型 | 算法 | 用途 | 所属层 | 存储位置 |
|---------|------|------|-------|---------|
| **Ed25519** | Ed25519 | 签名 AgentId | Peer | libp2p PeerId 内置 |
| **X25519** | X25519 | 加密消息内容 | 加密通道 | E2EECrypto 独立生成 |

**关键原则**：
- **签名 ≠ 加密**：Ed25519 签名验证身份，X25519 加密保护隐私，两者独立
- **AgentId 签名证明归属**：签名证明 AgentId 属于该 Peer，防止冒充
- **消息内容加密可选**：签名验证身份，加密保护内容，两者可独立使用

---

## ID 体系

|| 类型 | 特性 | 生成方式 | 格式 |
||------|------|----------|------|
|| **PeerId** | 节点唯一标识，不可改 | libp2p 签发 | `12D3KooW...` (32字符) |
|| **AgentId** | Agent 唯一标识，不可改 | **节点签发** | `agent:{PeerId前16位}:{随机8位}` |
|| **AgentName** | 显示名称，可改 | 用户定义 | 自定义字符串 |

### AgentId 格式

```
agent:<peerId_prefix>:<random_suffix>

示例:
- PeerId: 12D3KooWHxWdnxJaCMA4bVcnucEV35j2m6mYpNqZZbQW9zJ9nLVW
- AgentId: agent:12D3KooWHxWdn:abc12345
```

**设计说明**：
- `agent:` 前缀：与 PeerId 区分
- `PeerId前16位`：标识签发节点，用于快速定位
- `随机8位`：区分同一节点的多个 Agent

---

## 签发流程

```
┌─────────────┐                 ┌─────────────┐
│   用户请求   │                 │    节点     │
│             │                 │             │
│ POST /agents│────────────────▶│             │
│ {           │                 │ 1. 验证请求  │
│   name,     │                 │ 2. 生成ID    │
│   capabili- │                 │ 3. Ed25519   │
│   ties,     │                 │    签名      │
│   webhook   │                 │ 4. 返回      │
│ }           │                 │             │
│             │◀────────────────│             │
│ {           │                 │             │
│   agentId,  │                 │             │
│   signature,│                 │             │
│   peerId    │                 │             │
│ }           │                 │             │
└─────────────┘                 └─────────────┘
```

### 签名实现

```typescript
// F2A.signData() - 使用 Peer 的 Ed25519 私钥签名
signData(data: string): string {
  // Ed25519Signer 从 libp2p PeerId.privateKey.raw 初始化
  // 注意：libp2p raw 是 64 字节扩展私钥，取前 32 字节作为 seed
  return this.ed25519Signer.signSync(data);
}

// AgentRegistry.register() - 签发 AgentId
async register(request: AgentRegistrationRequest): AgentRegistration {
  const agentId = `agent:${peerIdPrefix}:${randomSuffix}`;
  const signature = this.signData(agentId);  // Ed25519 签名
  
  return {
    agentId,
    signature,        // Base64 Ed25519 签名
    peerId,
    ...
  };
}
```

---

## 验证流程

### 完整流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Agent 间消息完整流程                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  发送方 (Peer A, Agent X)                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Step 1: 签名 AgentId                                          │  │
│  │   signature = Ed25519.sign(agentId_X)                         │  │
│  │                                                                │  │
│  │ Step 2: 获取 Ed25519 公钥                                     │  │
│  │   ed25519PubKey = peerId_A.publicKey.raw → base64            │  │
│  │                                                                │  │
│  │ Step 3: 构造消息 payload                                      │  │
│  │   payload = {                                                 │  │
│  │     fromAgentId: "agent:<peerA_prefix>:xxx",                  │  │
│  │     fromSignature: signature,        ← 必须携带              │  │
│  │     fromEd25519PubKey: ed25519PubKey, ← 必须携带              │  │
│  │     toAgentId: "agent:<peerB_prefix>:yyy",                    │  │
│  │     content: "message content"                                │  │
│  │   }                                                           │  │
│  │                                                                │  │
│  │ Step 4: 加密消息 (可选)                                        │  │
│  │   encrypted = X25519.encrypt(payload, sharedSecret)          │  │
│  │                                                                │  │
│  │ Step 5: 发送                                                   │  │
│  │   P2PNetwork.send(peerB, encrypted || payload)               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│                              ▼                                      │
│                                                                     │
│  接收方 (Peer B, Agent Y)                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Step 6: 解密消息 (如果加密)                                    │  │
│  │   payload = X25519.decrypt(encrypted, sharedSecret')         │  │
│  │                                                                │  │
│  │ Step 7: 验证 PeerId 前缀匹配                                   │  │
│  │   agentId_X 的 peerId 前缀 == 消息来源 peerA 的前缀           │  │
│  │                                                                │  │
│  │ Step 8: 验证 Ed25519 签名                                      │  │
│  │   valid = Ed25519.verify(                                     │  │
│  │     agentId_X,           ← 签名数据                           │  │
│  │     fromSignature,       ← 携带的签名                         │  │
│  │     fromEd25519PubKey    ← 携带的公钥                         │  │
│  │   )                                                           │  │
│  │                                                                │  │
│  │ Step 9: 验证通过 → 处理消息                                    │  │
│  │   验证失败 → 拒绝消息，发出安全警告                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 验证伪代码

```typescript
function verifyAgentId(
  agentId: string, 
  signature: string, 
  ed25519PubKey: string,
  peerId: string
): boolean {
  // 1. 解析 AgentId 格式
  const parts = agentId.split(':');
  if (parts.length !== 3 || parts[0] !== 'agent') {
    return false;
  }
  
  // 2. 验证 PeerId 前缀匹配（防止冒充）
  const peerIdPrefix = parts[1];
  if (!peerId.startsWith(peerIdPrefix)) {
    // 消息来自 Peer C 却声称是 Peer A 的 Agent → 冒充攻击
    return false;
  }
  
  // 3. 用 Ed25519 公钥验证签名
  const dataBytes = Buffer.from(agentId, 'utf-8');
  const sigBytes = Buffer.from(signature, 'base64');
  const pubKeyBytes = Buffer.from(ed25519PubKey, 'base64');
  
  return ed25519.verify(sigBytes, dataBytes, pubKeyBytes);
}
```

### 为什么公钥必须在消息中携带？

远程节点没有发送方的 Ed25519 公钥：
- **Discovery 只交换 X25519 公钥**（用于加密），不交换 Ed25519 公钥
- **Ed25519 公钥可以从 PeerId 派生**，但需要完整 PeerId
- **AgentId 只包含 PeerId 前 16 位**，无法从 16 位恢复完整公钥

因此消息必须携带 `fromEd25519PubKey` 字段。

---

## Agent 注册 API

**请求**：
```json
POST /api/agents
{
  "name": "猫咕噜",
  "capabilities": ["chat", "code-generation"],
  "webhook": {
    "url": "http://127.0.0.1:8644/webhooks/f2a-message"
  }
}
```

**响应**（节点签发）：
```json
{
  "success": true,
  "agent": {
    "agentId": "agent:12D3KooWHxWdn:abc12345",
    "name": "猫咕噜",
    "capabilities": ["chat", "code-generation"],
    "peerId": "12D3KooWHxWdnxJa...",
    "signature": "base64-ed25519-signature",
    "registeredAt": "2026-04-14T05:31:00.000Z"
  }
}
```

---

## 数据结构

### AgentRegistration

```typescript
interface AgentRegistration {
  agentId: string;        // 节点签发的 ID: agent:<peerId_prefix>:<random>
  name: string;           // 用户定义的显示名称（可改）
  capabilities: string[]; // Agent 能力
  peerId: string;         // 签发节点的完整 PeerId
  signature: string;      // Ed25519 签名（Base64）
  registeredAt: Date;     // 注册时间
  lastActiveAt: Date;     // 最后活跃时间
  webhook?: AgentWebhook; // RFC 004: Agent 级 Webhook
  onMessage?: MessageCallback; // 本地消息回调
}
```

### AgentMessagePayload

```typescript
interface AgentMessagePayload {
  messageId: string;
  fromAgentId: string;         // 发送方 AgentId
  fromSignature: string;       // AgentId 的 Ed25519 签名
  fromEd25519PubKey: string;   // 发送方的 Ed25519 公钥（Base64）
  toAgentId: string;
  content: string;
  type: 'message' | 'task_request' | 'task_response';
  createdAt: string;
}
```

---

## 实现状态

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | AgentId 格式 `agent:<peerId_prefix>:<random>` | ✅ 完成 |
| Phase 2 | Ed25519 签名（F2A.signData, Ed25519Signer） | ✅ 完成 |
| Phase 3 | 消息携带签名和公钥 | ❌ 待修复 |
| Phase 4 | Ed25519 验证（P2PNetwork.handleAgentMessage） | ❌ 待修复 |

### 当前问题（P0-1）

1. **MessageRouter.routeRemote()** - payload 缺少 `fromSignature` 和 `fromEd25519PubKey`
2. **AgentIdentityVerifier.verifyRemoteAgentId()** - 调用时未传递 `ed25519PublicKey` 参数
3. **E2EECrypto.verifySignature()** - 使用 X25519 HMAC，不适用于 Ed25519 签名

---

## 安全考虑

1. **防止冒充**
   - AgentId 必须由节点签发
   - PeerId 前缀匹配验证
   - Ed25519 签名验证
   - 验证失败拒绝通信

2. **密钥分离**
   - Ed25519 只用于签名，不用于加密
   - X25519 只用于加密，不用于签名
   - 两者密钥独立，互不影响

3. **公钥传递**
   - 消息必须携带 Ed25519 公钥
   - 验证方使用携带的公钥验证
   - 不依赖预先存储的公钥

---

## 参考资料

- [RFC 004: Webhook Plugin Architecture](./004-webhook-plugin-architecture.md)
- [RFC 005: Architecture Unification](./005-architecture-unification.md)
- [libp2p PeerId 规范](https://docs.libp2p.io/concepts/fundamentals/peers)
- [Ed25519 签名算法](https://ed25519.cr.yp.to/)