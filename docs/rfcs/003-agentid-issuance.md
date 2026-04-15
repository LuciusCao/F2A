# RFC 003: AgentId 签发机制

> **Status**: Partial Implementation (核心签发机制已完成，签名验证待实现)
> **Created**: 2026-04-14
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

## 设计方案

### ID 体系

| 类型 | 特性 | 生成方式 | 格式 |
|------|------|----------|------|
| **PeerId** | 节点唯一标识，不可改 | libp2p 签发 | `12D3KooW...` (32字符) |
| **AgentId** | Agent 唯一标识，不可改 | **节点签发** | `agent:{PeerId前16位}:{随机8位}` |
| **AgentName** | 显示名称，可改 | 用户定义 | 自定义字符串 |

### AgentId 格式

```
agent:<peerId_prefix><random_suffix>

示例:
- PeerId: 12D3KooWHxWdnxJaCMA4bVcnucEV35j2m6mYpNqZZbQW9zJ9nLVW
- AgentId: agent:12D3KooWHxWdn:abc12345
```

**设计说明**：
- `agent:` 前缀：与 PeerId 区分
- `PeerId前16位`：标识签发节点
- `随机8位`：区分同一节点的多个 Agent

### 签发流程

```
┌─────────────┐                 ┌─────────────┐
│   用户请求   │                 │    节点     │
│             │                 │             │
│ POST /agents│────────────────▶│             │
│ {           │                 │ 1. 验证请求  │
│   name,     │                 │ 2. 生成ID    │
│   capabili- │                 │ 3. 签名      │
│   ties      │                 │ 4. 返回      │
│ }           │                 │             │
│             │◀────────────────│             │
│ {           │                 │             │
│   agentId,  │                 │             │
│   signature │                 │             │
│ }           │                 │             │
└─────────────┘                 └─────────────┘
```

### Agent 注册 API

**请求**：
```json
POST /api/agents
{
  "name": "猫咕噜",
  "capabilities": ["chat", "code-generation"]
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
    "signature": "base64-encoded-signature",
    "registeredAt": "2026-04-14T05:31:00.000Z"
  }
}
```

### 签名验证

**其他节点收到消息时**：
```
1. 解析 AgentId → 提取 PeerId前缀
2. 查找对应的 Peer 连接
3. 用 Peer 的公钥验证签名
4. 验证通过 → 接受消息
5. 验证失败 → 拒绝通信
```

**验证伪代码**：
```typescript
function verifyAgentId(agentId: string, signature: string): boolean {
  // 1. 解析 AgentId
  const prefix = agentId.split(':')[1]; // PeerId前16位
  
  // 2. 查找对应 Peer
  const peer = findPeerByPrefix(prefix);
  if (!peer) return false; // 未知节点
  
  // 3. 用 Peer 公钥验证签名
  const publicKey = peer.encryptionPublicKey;
  return verifySignature(agentId, signature, publicKey);
}
```

---

## 签名方案选择

### 方案 A：E2EE 密钥签名
- 使用现有的 E2EE 密钥对签名
- 复用现有基础设施
- 优点：实现简单
- 缺点：E2EE 密钥主要用于加密，签名用途不同

### 方案 B：独立的签名密钥
- 为每个 Agent 生成独立的签名密钥
- 更符合签名用途
- 缺点：需要额外密钥管理

**建议**：先用方案 A（复用 E2EE 密钥），后续可升级到方案 B

---

## 数据结构

### AgentRegistry 存储

```typescript
interface RegisteredAgent {
  agentId: string;        // 节点签发的 ID
  name: string;           // 用户定义的显示名称（可改）
  capabilities: string[]; // Agent 能力
  peerId: string;         // 签发节点的 PeerId
  signature: string;      // 签名（Base64）
  registeredAt: number;   // 注册时间戳
  lastActiveAt: number;   // 最后活跃时间
}
```

### 消息协议更新

```typescript
interface AgentMessage {
  fromAgentId: string;    // 签发的 AgentId
  fromSignature: string;  // AgentId 签名
  toAgentId: string;
  content: string;
  timestamp: number;
}
```

---

## 实现步骤

1. **Phase 1：格式调整**
   - 定义 AgentId 格式 `agent:<peerId_prefix>:<random>`
   - 节点生成 AgentId，不再接受用户自定义

2. **Phase 2：签名机制**
   - 节点用 E2EE 密钥签名 AgentId
   - 返回签名给用户
   - Agent 注册 API 返回完整签名信息

3. **Phase 3：验证机制**
   - 其他节点收到消息时验证签名
   - 验证失败拒绝通信
   - 记录验证失败的 AgentId

4. **Phase 4：AgentName 可改**
   - 添加 PATCH /api/agents/:agentId API
   - 只允许修改 name，不允许修改 agentId

---

## 安全考虑

1. **防止冒充**
   - AgentId 必须由节点签发
   - 其他节点验证签名
   - 验证失败拒绝通信

2. **密钥安全**
   - 签名密钥（E2EE）不能泄露
   - 签名只用于身份验证，不用于加密

3. **节点可信**
   - PeerId 是 libp2p 签发的，节点身份可信
   - AgentId 由 PeerId 签发，Agent 身份继承节点的可信性

---

## 讨论记录

**用户反馈 (2026-04-14)**：
- Q1: AgentId 需要能被其他节点验证 → ✅ 本 RFC 核心设计
- Q2: 一个节点能注册多个 Agent → ✅ 支持多个 AgentId
- Q3: AgentId 格式与 PeerId 区分 → ✅ 使用 `agent:` 前缀

---

## 参考资料

- [RFC 002: CLI Agent Architecture](./002-cli-agent-architecture.md)
- [libp2p PeerId 规范](https://docs.libp2p.io/concepts/fundamentals/peers)