# RFC 008: Agent Self-Identity

> **Status**: Draft 📝
> **Created**: 2026-04-20
> **Priority**: High (身份安全核心)
> **Supersedes**: RFC003 部分（AgentId 格式变化）

---

## 问题背景

### RFC003 的设计局限

RFC003 定义了 Node 签发 AgentId 的机制：

```
Node (PeerId + Ed25519) → 签发 AgentId → Agent (无密钥，只有 Node 签名)
```

**问题**：
1. ❌ Agent **没有自己的密钥**，无法自证身份
2. ❌ Token 存文件，任何能读文件的人都能冒充
3. ❌ 按 name 匹配不可靠（name 可冲突、可修改）
4. ❌ 同一用户的多进程都能使用同一 token

类比：银行给你一张卡，但卡上没有你的指纹，谁捡到都能用。

### 需求

| 安全需求 | 当前状态 | 目标状态 |
|---------|---------|---------|
| **身份不可篡改** | ❌ AgentId 由 Node 生成，Agent 无控制权 | ✅ AgentId = 公钥指纹，改了就不是同一个 Agent |
| **身份不可冒充** | ❌ 有 token 文件就能冒充 | ✅ 私钥签名证明，没有私钥无法冒充 |
| **防文件窃取** | ❌ Token 文件可被盗用 | ✅ 私钥可加密保护（像 SSH 加密私钥） |
| **防重放攻击** | ❌ 无 Challenge 机制 | ✅ Challenge-Response，每次签名内容不同 |

---

## 核心设计：Agent 自有密钥

### 设计理念

类比 SSH/Git 的身份模型：

| SSH | F2A Agent Self-Identity |
|-----|------------------------|
| 用户生成密钥对 | Agent 生成密钥对 |
| 公钥指纹 = 身份标识 | 公钥指纹 = AgentId |
| 公钥放到 authorized_keys | 公钥注册到 Daemon |
| 私钥证明身份 | 私钥签名证明身份 |
| 私钥可加密保护 | 私钥可加密保护 |

### 三层身份体系

```
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 1: Node Identity (物理设备)               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Node (PeerId)                           │  │
│  │                                                            │  │
│  │   PeerId: 12D3KooW...                                      │  │
│  │   Ed25519 密钥对 (libp2p 内置)                              │  │
│  │   用途: 签发 Agent 归属证明                                 │  │
│  │                                                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 签发归属证明: nodeSignature
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 2: Agent Identity (AI Agent)             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Agent A   │  │   Agent B   │  │   Agent C   │              │
│  │             │  │             │  │             │              │
│  │ AgentId:    │  │ AgentId:    │  │ AgentId:    │              │
│  │ 公钥指纹    │  │ 公钥指纹    │  │ 公钥指纹    │              │
│  │             │  │             │  │             │              │
│  │ Ed25519     │  │ Ed25519     │  │ Ed25519     │              │
│  │ (自有密钥)  │  │ (自有密钥)  │  │ (自有密钥)  │              │
│  │             │  │             │  │             │              │
│  │ nodeSig:    │  │ nodeSig:    │  │ nodeSig:    │              │
│  │ 归属证明    │  │ 归属证明    │  │ 归属证明    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  每个 Agent 有独立的 Ed25519 密钥对                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 发消息时签名证明身份
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Layer 3: Operation Signature (操作证明)         │
│                                                                  │
│   发消息: agentSignature(message, privateKey)                   │
│   Daemon 验证: verify(message, signature, publicKey)            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## ID 格式变更

### AgentId 新格式

**旧格式 (RFC003)**:
```
agent:<PeerId前16位>:<随机8位>
示例: agent:12D3KooWHxWdn:abc12345
```

**新格式 (RFC008)**:
```
agent:<公钥指纹16位>
示例: agent:a3b2c1d4e5f67890
```

**公钥指纹计算**:
```typescript
// Ed25519 公钥 (32 bytes)
const publicKey = agentKeypair.getPublicKey();  // Uint8Array[32]

// SHA256 哈希取前 16 位作为指纹
const fingerprint = sha256(publicKey).slice(0, 16).toHex();
// 结果: "a3b2c1d4e5f67890"

// AgentId
const agentId = `agent:${fingerprint}`;
```

### 为什么用公钥指纹？

| 属性 | 公钥指纹方案 | 随机 ID 方案 |
|------|-------------|-------------|
| **唯一性** | ✅ 公钥唯一，指纹唯一 | ⚠️ 随机，理论上可冲突 |
| **不可篡改** | ✅ 改公钥 = 改 AgentId | ❌ 与身份无关 |
| **自证明** | ✅ 有公钥就能验证 | ❌ 需额外存储公钥 |
| **可恢复** | ✅ 从公钥恢复 AgentId | ❌ 需查询注册表 |

---

## 身份文件结构

### 存储位置

```
~/.f2a/agents/
└── agent:{fingerprint}.json   ← Agent 身份文件
```

### 文件内容

```json
{
  "agentId": "agent:a3b2c1d4e5f67890",
  "publicKey": "Base64Ed25519PublicKey...",
  "privateKey": "Base64Ed25519PrivateKey...",  // 可选加密
  "privateKeyEncrypted": false,                 // 是否加密
  "nodeSignature": "Node签发的归属证明(Base64)",
  "nodePeerId": "12D3KooW...",
  "name": "猫咕噜",
  "capabilities": [
    { "name": "chat", "version": "1.0.0" }
  ],
  "createdAt": "2026-04-20T10:00:00.000Z",
  "lastActiveAt": "2026-04-20T15:00:00.000Z",
  "webhook": {
    "url": "http://127.0.0.1:9002/webhook"
  }
}
```

### 私钥加密（可选）

类似 SSH 加密私钥，用户可选择加密：

```bash
# 生成时设置密码
f2a agent init --encrypt

# 使用时输入密码
f2a message send --from agent:xxx "hello"
# Prompt: Enter passphrase for agent:xxx:
```

---

## 认证流程：Challenge-Response

### 为什么不用 Token？

Token 方案的问题：
- Token 存文件，可被盗用
- Token 与 AgentId 无绑定关系（任何进程都能用）
- Token 无时效性（除非手动过期）

Challenge-Response 的优势：
- 每次操作需要签名，无"静态凭证"
- 签名内容随机，防重放攻击
- 私钥不离开 Agent，更安全

### 流程设计

```
┌─────────────┐                              ┌─────────────┐
│   Agent     │                              │   Daemon    │
│  (CLI)      │                              │             │
└─────────────┘                              └─────────────┘
       │                                            │
       │  1. Request: 发消息请求                     │
       │  POST /api/messages                        │
       │  { fromAgentId, toAgentId, content }       │
       │───────────────────────────────────────────▶│
       │                                            │
       │  2. Challenge: Daemon 生成随机 Challenge    │
       │  { challenge: "random-256bit",             │
       │    timestamp: "...",                       │
       │    expires: "30s" }                        │
       │◀───────────────────────────────────────────│
       │                                            │
       │  3. Response: Agent 用私钥签名              │
       │  { challengeResponse:                      │
       │    signature: "Ed25519签名",                │
       │    publicKey: "Base64公钥" }               │
       │───────────────────────────────────────────▶│
       │                                            │
       │  4. 验证: Daemon 验证签名                   │
       │  - 检查 AgentId 与 publicKey 指纹匹配      │
       │  - 验证 Ed25519 签名                        │
       │  - 检查 Challenge 未过期                   │
       │                                            │
       │  5. 执行: 验证通过后执行操作                 │
       │  { success: true, messageId: "..." }       │
       │◀───────────────────────────────────────────│
       │                                            │
```

### Challenge 结构

```typescript
interface Challenge {
  challenge: string;      // 256-bit 随机数据 (Base64)
  timestamp: string;      // ISO 8601 时间戳
  expiresInSeconds: 30;   // 有效期 30 秒
  operation: string;      // 操作类型: "send_message", "update_webhook"
}
```

### Response 结构

```typescript
interface ChallengeResponse {
  signature: string;      // Ed25519签名 (Base64)
  publicKey: string;      // Agent 的 Ed25519 公钥 (Base64)
}
```

### 验证逻辑

```typescript
function verifyChallengeResponse(
  agentId: string,
  challenge: Challenge,
  response: ChallengeResponse,
  nodeSignature: string,    // Agent 的 Node 归属证明
  nodePeerId: string
): boolean {
  // 1. 验证 AgentId 与公钥指纹匹配
  const fingerprint = sha256(response.publicKey).slice(0, 16).toHex();
  if (agentId !== `agent:${fingerprint}`) {
    return false;  // 公钥与 AgentId 不匹配
  }
  
  // 2. 验证 Challenge 未过期
  const now = Date.now();
  const challengeTime = new Date(challenge.timestamp).getTime();
  if (now - challengeTime > challenge.expiresInSeconds * 1000) {
    return false;  // Challenge 已过期
  }
  
  // 3. 验证 Ed25519 签名
  const challengeData = `${challenge.challenge}:${challenge.timestamp}:${challenge.operation}`;
  const valid = ed25519.verify(
    response.signature,
    challengeData,
    response.publicKey
  );
  if (!valid) {
    return false;  // 签名无效
  }
  
  // 4. 验证 Node 归属证明 (可选，用于跨节点场景)
  // ...
  
  return true;
}
```

---

## Agent 注册流程

### 新流程

```
┌─────────────┐                              ┌─────────────┐
│   Agent     │                              │   Daemon    │
│  (CLI)      │                              │             │
└─────────────┘                              └─────────────┘
       │                                            │
       │  1. Init: Agent 生成密钥对                  │
       │  f2a agent init --name "猫咕噜"            │
       │  → 生成 Ed25519 密钥对                     │
       │  → 计算 AgentId (公钥指纹)                 │
       │                                            │
       │  2. Register: 提交公钥 + Node 签名请求      │
       │  POST /api/agents                          │
       │  {                                         │
       │    agentId: "agent:fingerprint",           │
       │    publicKey: "Base64...",                 │
       │    name: "猫咕噜",                         │
       │    capabilities: [...]                     │
       │  }                                         │
       │───────────────────────────────────────────▶│
       │                                            │
       │  3. NodeSignature: Daemon 签发归属证明      │
       │  - 用 Node 的 Ed25519 私钥签名             │
       │  - 签名内容: agentId + publicKey           │
       │                                            │
       │  4. Response: 返回完整身份                  │
       │  {                                         │
       │    agentId: "agent:fingerprint",           │
       │    nodeSignature: "...",                   │
       │    nodePeerId: "12D3KooW...",              │
       │    registeredAt: "..."                     │
       │  }                                         │
       │◀───────────────────────────────────────────│
       │                                            │
       │  5. Store: CLI 保存身份文件                 │
       │  ~/.f2a/agents/agent:fingerprint.json      │
       │  (含 privateKey + publicKey + nodeSig)     │
       │                                            │
```

### CLI 命令设计

```bash
# 生成 Agent 密钥对（类似 ssh-keygen）
f2a agent init --name "猫咕噜" [--encrypt]
# 输出: AgentId, 公钥指纹

# 注册到 Daemon（获取 Node 签名）
f2a agent register
# 自动读取 init 生成的密钥对

# 查看身份状态
f2a agent status
# 输出: AgentId, 公钥, Node 签名状态

# 发送消息（自动 Challenge-Response）
f2a message send --to agent:xxx "hello"
# CLI 自动处理 Challenge-Response
```

---

## Caller 身份存储机制

### 问题场景

```
~/.f2a/agents/
├── agent:a3b2c1d4e5f67890.json  ← 猫咔啦的身份（公钥指纹）
└── agent:b7c8d9e0f1a23456.json  ← 猫咕噜的身份（公钥指纹）

Caller A (Hermes "猫咔啦") 要发消息：
→ 怎么知道用 agent:a3b2c1... 而不是 agent:b7c8d9...？

问题：文件名是公钥指纹，Caller 不知道自己的指纹是多少！
```

### 解决方案：Caller 自己存储 agentId

**核心思路**：第一次 `init` 后，Caller 记住自己的 agentId，后续直接使用。

```
┌─────────────────────────────────────────────────────────────────┐
│                      Caller 持有身份                             │
│                                                                  │
│   Caller A (Hermes session "猫咔啦")                             │
│   └── 配置: ~/.hermes/f2a-identity.json                         │
│   └── 内容: { agentId: "agent:a3b2c1d4..." }                    │
│   └── 身份文件: ~/.f2a/agents/agent:a3b2c1d4...json ← 私钥在此  │
│                                                                  │
│   Caller B (OpenClaw agent "猫咕噜")                             │
│   └── 配置: ~/.openclaw/f2a-identity.json                       │
│   └── 内容: { agentId: "agent:b7c8d9e0..." }                    │
│   └── 身份文件: ~/.f2a/agents/agent:b7c8d9e0...json ← 私钥在此  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 两层分离

| 文件 | 内容 | 管理者 | 用途 |
|------|------|--------|------|
| **Caller 配置** | agentId（公钥指纹） | Caller 自己 | Caller 找到自己的身份 |
| **身份文件** | agentId + publicKey + privateKey | CLI (f2a) | 存储密钥，签名证明 |

**关键**：Caller 配置只存 agentId，无私钥。私钥在身份文件中。

### Caller 配置文件格式

```json
// ~/.hermes/f2a-identity.json
{
  "agentId": "agent:a3b2c1d4e5f67890",
  "callerName": "猫咔啦",
  "callerType": "hermes",
  "createdAt": "2026-04-20T10:00:00.000Z"
}

// ~/.openclaw/f2a-identity.json
{
  "agentId": "agent:b7c8d9e0f1a23456",
  "callerName": "猫咕噜",
  "callerType": "openclaw",
  "createdAt": "2026-04-20T10:00:00.000Z"
}
```

### CLI 命令更新

```bash
# 生成身份 + 存储到 Caller 配置
f2a agent init --name "猫咔啦" --caller-config ~/.hermes/f2a-identity.json

# 输出：
# ✅ Agent identity created
#    AgentId: agent:a3b2c1d4e5f67890
#    Caller config: ~/.hermes/f2a-identity.json
#    Identity file: ~/.f2a/agents/agent:a3b2c1d4e5f67890.json

# 发消息时指定 Caller 配置
f2a message send --caller-config ~/.hermes/f2a-identity.json --to agent:xxx "hello"

# 或：使用环境变量（推荐）
export F2A_IDENTITY=~/.hermes/f2a-identity.json
f2a message send --to agent:xxx "hello"
```

### 身份查找流程

```
┌─────────────────────────────────────────────────────────────────┐
│                  身份查找流程                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. CLI 接收命令                                                 │
│     f2a message send --to agent:xxx "hello"                     │
│                                                                  │
│  2. 读取 Caller 配置                                             │
│     F2A_IDENTITY 环境变量 或 --caller-config 参数               │
│     → ~/.hermes/f2a-identity.json                               │
│     → { agentId: "agent:a3b2c1d4..." }                          │
│                                                                  │
│  3. 读取身份文件                                                 │
│     ~/.f2a/agents/agent:a3b2c1d4...json                         │
│     → { publicKey, privateKey, nodeSignature, ... }             │
│                                                                  │
│  4. Challenge-Response                                           │
│     用 privateKey 签名 → 证明身份                                │
│                                                                  │
│  5. 发送消息                                                     │
│     Daemon 验证签名 → 确认是 agent:a3b2c1d4... → 执行操作        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 安全性分析

| 攻击场景 | 防护措施 | 效果 |
|---------|---------|------|
| **误用他人身份** | Caller 配置指定自己的 agentId | 🔴🔴🔴 Caller 不会找错 |
| **Caller 配置被盗** | 配置只存 agentId，无私钥 | 🔴🔴🔴 无私钥无法签名 |
| **Caller 配置被篡改** | 改成别人的 agentId | 🔴🔴🔴 Challenge 失败（私钥不匹配） |
| **身份文件被盗** | 私钥可加密保护 | 🔴🔴🔴 无密码无法使用 |

**关键防护**：即使有人篡改 Caller 配置指向其他 agentId，Challenge-Response 验证时会失败（因为没有对应的 privateKey）。

### 默认行为

**单 Caller 场景**（简化）：

```bash
# 不指定 --caller-config，默认存到 ~/.f2a/current-agent.json
f2a agent init --name "猫咔啦"
# → Caller 配置: ~/.f2a/current-agent.json
# → 身份文件: ~/.f2a/agents/agent:a3b2c1d4...json

# 发消息时自动读取默认配置
f2a message send --to agent:xxx "hello"
# → 自动从 ~/.f2a/current-agent.json 读 agentId
```

---

## 与现有系统的兼容

### 兼容策略

**过渡期：同时支持新旧格式**

```typescript
function parseAgentId(agentId: string): { format: 'old' | 'new', data: any } {
  const parts = agentId.split(':');
  
  if (parts.length === 3) {
    // 旧格式: agent:<peerIdPrefix>:<randomSuffix>
    return { format: 'old', data: { peerIdPrefix: parts[1], randomSuffix: parts[2] } };
  }
  
  if (parts.length === 2) {
    // 新格式: agent:<fingerprint>
    return { format: 'new', data: { fingerprint: parts[1] } };
  }
  
  throw new Error('Invalid AgentId format');
}
```

### 迁移路径

| 阶段 | 支持情况 |
|------|---------|
| **Phase 4** | Daemon 同时接受新旧格式注册 |
| **Phase 5** | 新注册默认用新格式 |
| **Phase 6** | 旧格式 Agent 需迁移（重新 init） |
| **Phase 7** | 废弃旧格式支持 |

### 迁移命令

```bash
# 迁移旧 Agent 到新格式
f2a agent migrate <old-agent-id>
# 生成新密钥对，保留 name/capabilities
```

---

## 安全性分析

### 攻击防护矩阵

| 攻击场景 | 防护措施 | 效果 |
|---------|---------|------|
| **身份冒充** | AgentId = 公钥指纹 | 🔴🔴🔴 改公钥 = 改身份，无法冒充 |
| **文件窃取** | 私钥可加密保护 | 🔴🔴🔴 无密码无法使用私钥 |
| **重放攻击** | Challenge-Response | 🔴🔴🔴 每次签名内容不同 |
| **中间人攻击** | NodeSignature 验证 | 🔴🔴🔴 验证 Agent 归属于 Node |
| **Token 泄露** | 不再使用 Token | 🔴🔴🔴 移除 Token 攻击面 |

### 与 RFC003 的安全对比

| 安全属性 | RFC003 (Node 签发) | RFC008 (Agent 自有密钥) |
|---------|-------------------|------------------------|
| Agent 身份证明 | ❌ Node 签名证明归属 | ✅ Agent 私钥签名证明身份 |
| 文件窃取防护 | ❌ Token 可被盗用 | ✅ 私钥可加密 |
| 跨 Agent 冒充 | ❌ 同进程可冒充 | ✅ 私钥签名必须匹配 |
| 身份持久性 | ⚠️ Node 重签发变化 | ✅ 公钥不变 = 身份不变 |

---

## 实现计划

### Phase 1: 核心组件 (Week 1)

| Task | 文件 | 输出 |
|------|------|------|
| AgentIdentityKeypair | `network/identity/agent-keypair.ts` | Ed25519 密钥管理 |
| AgentId 新格式 | `network/identity/agent-id.ts` | 公钥指纹计算与验证 |
| Challenge-Response | `network/auth/challenge.ts` | 认证协议 |

### Phase 2: CLI 改动 (Week 2)

| Task | 文件 | 输出 |
|------|------|------|
| `f2a agent init` | `cli/agents.ts` | 密钥生成命令 |
| `f2a agent register` | `cli/agents.ts` | 新注册流程 |
| `f2a message send` | `cli/messages.ts` | Challenge-Response |

### Phase 3: Daemon 改动 (Week 2)

| Task | 文件 | 输出 |
|------|------|------|
| AgentRegistry 改造 | `network/agent-registry.ts` | 存公钥而非随机 ID |
| Challenge Handler | `daemon/handlers/challenge.ts` | 生成 Challenge |
| 验证 Handler | `daemon/handlers/auth.ts` | 验证签名 |

### Phase 4: 迁移与兼容 (Week 3)

| Task | 输出 |
|------|------|
| 兼容层 | 同时支持新旧 AgentId |
| 迁移脚本 | `f2a agent migrate` |
| 文档更新 | Skills 更新 |

### Phase 5: 测试与发布 (Week 3)

| Task | 输出 |
|------|------|
| 单元测试 | `*.test.ts` |
| 集成测试 | CLI + Daemon 全流程 |
| 发布 | @f2a/cli @f2a/network 新版本 |

---

## 依赖关系

```
RFC008 (规范定义)
    │
    ▼
┌─────────────────────────────────────┐
│         Phase 1 (并行)               │
│  AgentKeypair  AgentId格式  Challenge│
└─────────────────────────────────────┘
    │
    ├────────────┬────────────┐
    ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│Phase 2  │ │Phase 3  │ │Phase 4  │
│CLI改动  │ │Daemon   │ │迁移兼容 │
└─────────┘ └─────────┘ └─────────┘
    │            │            │
    └────────────┴────────────┘
                 ▼
          Phase 5: 测试发布
```

---

## 决策记录

### 为什么选择公钥指纹作为 AgentId？

1. **自证明**：有公钥就能验证，无需查询注册表
2. **不可篡改**：公钥变 = 身份变，天然防冒充
3. **与 SSH 一致**：用户熟悉的身份模型

### 为什么选择 Challenge-Response 而非 Token？

1. **无静态凭证**：每次操作需签名，无"永久 Token"
2. **防重放**：Challenge 随机 + 时效性
3. **私钥不离开 Agent**：更安全的认证模型

### 为什么保留 NodeSignature？

1. **跨节点验证**：远程节点可验证 Agent 归属
2. **双层签名**：Node 签归属 + Agent 签操作
3. **与 RFC003 兼容**：保留 PeerId 前缀定位能力

---

## Skills 改动指南

RFC008 的实现需要同步更新相关 Skills 文档。以下是改动指南：

### 需要更新的 Skills

| Skill | 路径 | 改动程度 |
|-------|------|---------|
| f2a-agent-messaging | `devops/f2a-agent-messaging/SKILL.md` | 🔴🔴🔴 重写核心流程 |
| f2a-p2p-messaging | `devops/f2a-p2p-messaging/SKILL.md` | 🔴🔴🔴 重写核心流程 |

### Skill 改动要点

#### 1. 身份初始化流程变化

**旧流程**：
```yaml
1. f2a agent list → 查找已有 agent
2. 如果有 → 使用已有 agentId
3. 如果没有 → f2a agent register --name <name>
```

**新流程**：
```yaml
1. 检查 F2A_IDENTITY 环境变量 或 Caller 配置文件
2. 如果有 → 直接使用，跳过初始化
3. 如果没有 → f2a agent init --name <name> --caller-config <path>
4. 环境变量设置：export F2A_IDENTITY=<caller-config-path>
```

#### 2. 发送消息流程变化

**旧流程**：
```yaml
f2a message send --from <agentId> --to <agentId> "content"
# CLI 从 ~/.f2a/agents/{agentId}.json 读取 token
# Authorization: agent-{token}
```

**新流程**：
```yaml
f2a message send --to <agentId> "content"
# CLI 自动：
#   1. 从 F2A_IDENTITY 环境变量读取 agentId
#   2. 从 ~/.f2a/agents/{agentId}.json 读取 privateKey
#   3. Challenge-Response 认证
#   4. 签名发送
```

#### 3. AgentId 格式变化说明

需要在 Skill 中说明 AgentId 格式变化：

```markdown
### AgentId 格式说明

RFC008 后，AgentId 格式发生变化：

| 格式 | 版本 | 示例 |
|------|------|------|
| **旧格式** | RFC003 | `agent:12D3KooWHxWdn:abc12345` |
| **新格式** | RFC008 | `agent:a3b2c1d4e5f67890` |

**识别方法**：
- 旧格式：3段，以 PeerId 前缀开头
- 新格式：2段，以公钥指纹开头

**迁移**：
- 旧格式 agent 需运行 `f2a agent migrate` 重新初始化
```

#### 4. 新增 CLI 命令文档

需要在 Skill 中补充新命令：

```markdown
### 身份管理命令

```bash
# 初始化身份（生成密钥对）
f2a agent init --name <name> --caller-config <path>

# 查看身份状态
f2a agent status

# 迁移旧格式身份
f2a agent migrate <old-agent-id>

# 环境变量设置
export F2A_IDENTITY=~/.hermes/f2a-identity.json
```

#### 5. Hermes 集成配置

需要在 Skill 中说明 Hermes 的 Caller 配置：

```yaml
# ~/.hermes/config.yaml
f2a:
  identity: ~/.hermes/f2a-identity.json  # Caller 身份配置路径
```

或者环境变量方式：

```bash
# Hermes 启动时设置
export F2A_IDENTITY=~/.hermes/f2a-identity.json
```

### Skill 示例改动

**f2a-agent-messaging/SKILL.md 核心流程改动**：

```markdown
## Quick Setup

### 1. 初始化身份（首次使用）

```bash
# 检查是否已有身份配置
if [ -z "$F2A_IDENTITY" ]; then
  # 生成新身份
  f2a agent init --name "hermes-agent" --caller-config ~/.hermes/f2a-identity.json
  export F2A_IDENTITY=~/.hermes/f2a-identity.json
fi

# 查看当前身份
f2a agent status
```

### 2. 发送消息

```bash
# 自动使用 F2A_IDENTITY 中的身份
f2a message send --to <target-agent-id> "Hello!"

# Challenge-Response 自动处理，无需手动指定 --from
```

### 3. 接收消息（Webhook）

配置与之前相同，但收到消息时验证发送方签名：

```bash
# 消息中包含：
# - fromAgentId: 发送方身份
# - fromSignature: Ed25519 签名
# - fromPublicKey: 发送方公钥
# 
# 验证签名后处理消息
```
```

### 改动时间点

| Phase | Skill 改动 |
|-------|-----------|
| **Phase 4** | 更新 Skills 文档，标记新流程为"推荐" |
| **Phase 5** | Skills 默认使用新流程，旧流程标记为"兼容模式" |
| **Phase 7** | 移除旧流程文档 |

---

## 参考资料

- [RFC 003: AgentId 签发与验证机制](./003-agentid-issuance.md)
- [RFC 007: Agent Token 内存管理](./007-agent-token-encryption.md)
- [Ed25519 签名算法](https://ed25519.cr.yp.to/)
- [SSH 公钥认证原理](https://www.ssh.com/academy/ssh/public-key-authentication)