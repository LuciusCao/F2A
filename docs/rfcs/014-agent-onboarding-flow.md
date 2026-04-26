# RFC 014: Agent Onboarding Flow

> **Status**: Draft (设计讨论)
> **Created**: 2026-04-26
> **Priority**: Core (Agent 初始化流程)
> **Related**: RFC008 (Self-Identity), RFC006 (Identity Philosophy), RFC011 (Verification Chain)

---

## 摘要

本文档定义 F2A Agent 的完整 Onboarding 流程，包括：
- 初始化（init）阶段
- 注册（register）阶段
- Caller（Hermes/OpenClaw）如何触发
- 安全验证机制
- 身份迁移流程
- 失败恢复策略

---

## 流程概览

### 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Agent Onboarding 流程                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   Caller    │───▶│    init     │───▶│   register  │───▶│   可用状态  │  │
│  │ (触发方)    │    │  (生成本地) │    │  (与Daemon) │    │  (正常使用) │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│         │                  │                  │                  │         │
│         │                  │                  │                  │         │
│         ▼                  ▼                  ▼                  ▼         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ Hermes CLI  │    │ 生成密钥对  │    │ Challenge-  │    │ 发送消息    │  │
│  │ OpenClaw    │    │ 计算AgentId │    │ Response    │    │ 接收消息    │  │
│  │ 手动 CLI    │    │ selfSignature│    │ nodeSignature│    │ 能力发现    │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  数据存储                                                            │   │
│  │                                                                      │   │
│  │  ~/.f2a/agent-identities/<agentId>.json                              │   │
│  │  ├── init 后: publicKey, privateKey, selfSignature                   │   │
│  │  └── register 后: + nodeSignature, nodeId, webhook                   │   │
│  │                                                                      │   │
│  │  ~/.hermes/f2a-identity.json (Caller 配置)                           │   │
│  │  └── agentId, callerName, callerType                                 │   │
│  │                                                                      │   │
│  │  Daemon 内存 (AgentRegistry)                                         │   │
│  │  └── 注册状态, webhook, capabilities                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Init（初始化）

### 1.1 命令

```bash
f2a agent init --name "猫咔啦" [--webhook <url>] [--force]
```

### 1.2 执行步骤

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  f2a agent init                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Step 1: 检查前置条件                                                        │
│  ├── Daemon 是否运行？ → 否则提示启动                                         │
│  └── Node 是否已初始化？ → ~/.f2a/node-identity.json 存在                    │
│                                                                              │
│  Step 2: 生成密钥对                                                          │
│  ├── keypair = AgentIdentityKeypair.generateKeypair()                       │
│  ├── privateKey: Ed25519 私钥（32字节种子）                                  │
│  └── publicKey: Ed25519 公钥（32字节）                                       │
│                                                                              │
│  Step 3: 计算 AgentId                                                        │
│  ├── fingerprint = sha256(publicKey)[:16]                                   │
│  └── agentId = "agent:" + fingerprint                                       │
│  └── 示例: agent:a3b2c1d4e5f67890                                            │
│                                                                              │
│  Step 4: 生成 selfSignature (RFC011)                                         │
│  ├── selfSignature = sign(publicKey, privateKey)                            │
│  └── 证明：这个公钥确实属于这个 Agent                                         │
│                                                                              │
│  Step 5: 创建身份文件                                                        │
│  ├── ~/.f2a/agent-identities/<agentId>.json                                 │
│  ├── 内容: agentId, publicKey, privateKey, selfSignature, name              │
│  ├── 权限: 600 (仅当前用户可读写)                                            │
│                                                                              │
│  Step 6: 输出结果                                                            │
│  ├── agentId: agent:a3b2c1d4e5f67890                                         │
│  ├── identityFile: ~/.f2a/agent-identities/agent:a3b2c1d4...json            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 身份文件结构

```json
// ~/.f2a/agent-identities/agent:a3b2c1d4e5f67890.json
{
  "agentId": "agent:a3b2c1d4e5f67890",
  "publicKey": "Base64Ed25519PublicKey...",
  "privateKey": "Base64Ed25519PrivateKey...",
  "privateKeyEncrypted": false,
  "selfSignature": "Base64Signature...",
  "nodeSignature": null,        // register 后填充
  "nodeId": null,               // register 后填充
  "name": "猫咔啦",
  "capabilities": [],
  "createdAt": "2026-04-26T10:00:00.000Z",
  "webhook": null               // register 后填充或 init 时可选设置
}
```

### 1.4 Caller 配置文件

```json
// ~/.hermes/f2a-identity.json (Caller 自己管理)
{
  "agentId": "agent:a3b2c1d4e5f67890",
  "callerName": "猫咔啦",
  "callerType": "hermes",
  "createdAt": "2026-04-26T10:00:00.000Z"
}
```

**关键**：Caller 配置只存 agentId，无私钥。私钥在身份文件中。

---

## Phase 2: Register（注册）

### 2.1 命令

```bash
f2a agent register --agent-id <agentId> --webhook <url> [--force]
```

### 2.2 执行步骤

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  f2a agent register                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Step 1: 读取身份文件                                                        │
│  ├── identity = readIdentityByAgentId(agentId)                              │
│  ├── 文件: ~/.f2a/agent-identities/<agentId>.json                           │
│  ├── 必须存在 publicKey, privateKey, selfSignature                          │
│                                                                              │
│  Step 2: 发送注册请求到 Daemon                                               │
│  ├── POST /api/agents/register                                              │
│  ├── Body: { agentId, publicKey, selfSignature, name, webhook }             │
│                                                                              │
│  Step 3: Daemon 验证 selfSignature (RFC011)                                  │
│  ├── agentIdFromPublicKey = computeAgentId(publicKey)                       │
│  ├── verifySelfSignature(agentId, publicKey, selfSignature)                 │
│  ├── 验证失败 → 拒绝注册                                                     │
│                                                                              │
│  Step 4: Daemon 检查是否已注册                                               │
│  ├── 已注册且 --force=false → 返回已存在状态                                 │
│  ├── 已注册且 --force=true → 重新注册                                        │
│                                                                              │
│  Step 5: Daemon 签发 nodeSignature (RFC008)                                  │
│  ├── nodeSignature = sign(agentId + publicKey, nodePrivateKey)              │
│  ├── nodeId = Node 的 PeerId                                                 │
│                                                                              │
│  Step 6: Daemon 保存注册状态                                                 │
│  ├── AgentRegistry.registerRFC008()                                         │
│  ├── AgentIdentityStore.save(identity)                                      │
│  ├── MessageRouter.createQueue(agentId)                                     │
│                                                                              │
│  Step 7: Daemon 返回结果                                                     │
│  ├── { success, agentId, nodeSignature, nodeId, token }                     │
│                                                                              │
│  Step 8: CLI 更新身份文件                                                    │
│  ├── 添加 nodeSignature, nodeId, webhook                                    │
│  ├── 保存到 ~/.f2a/agent-identities/<agentId>.json                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Daemon 验证逻辑

```typescript
// packages/daemon/src/handlers/agent-handler.ts

// RFC011: 验证 selfSignature
const agentIdFromPublicKey = computeAgentId(data.publicKey);
const selfSigValid = verifySelfSignature(
  agentIdFromPublicKey,
  data.publicKey,
  data.selfSignature
);

if (!selfSigValid) {
  return { error: 'Invalid selfSignature' };
}

// RFC008: 签发 nodeSignature
const registration = this.agentRegistry.registerRFC008({
  name: data.name,
  publicKey: data.publicKey,
  capabilities: data.capabilities,
  webhook: data.webhook,
});
// registration 包含 nodeSignature 和 nodeId
```

### 2.4 注册后的身份文件

```json
// ~/.f2a/agent-identities/agent:a3b2c1d4e5f67890.json
{
  "agentId": "agent:a3b2c1d4e5f67890",
  "publicKey": "Base64Ed25519PublicKey...",
  "privateKey": "Base64Ed25519PrivateKey...",
  "privateKeyEncrypted": false,
  "selfSignature": "Base64Signature...",
  "nodeSignature": "Base64NodeSignature...",  // ← 新增
  "nodeId": "12D3KooW...",                     // ← 新增
  "name": "猫咔啦",
  "capabilities": [],
  "createdAt": "2026-04-26T10:00:00.000Z",
  "lastActiveAt": "2026-04-26T10:05:00.000Z",
  "webhook": {                                 // ← 新增
    "url": "http://127.0.0.1:9002/webhook"
  }
}
```

---

## Phase 3: Caller 触发方式

### 3.1 Hermes CLI

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Hermes Onboarding 触发                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  触发时机: 第一次使用 F2A 功能时                                             │
│                                                                              │
│  Step 1: 检查 Caller 配置                                                   │
│  ├── 文件: ~/.hermes/f2a-identity.json                                      │
│  ├── 存在 → 跳过 init，直接使用                                              │
│  ├── 不存在 → 执行 init                                                     │
│                                                                              │
│  Step 2: 执行 init (自动)                                                   │
│  ├── f2a agent init --name "<sessionName>"                                  │
│  ├── 获取 agentId                                                           │
│  ├── 保存到 ~/.hermes/f2a-identity.json                                     │
│                                                                              │
│  Step 3: 执行 register (自动)                                               │
│  ├── f2a agent register --agent-id <agentId> --webhook <url>                │
│  ├── webhook = Hermes 的消息接收端点                                         │
│                                                                              │
│  Step 4: 后续使用                                                            │
│  ├── 从 ~/.hermes/f2a-identity.json 读取 agentId                            │
│  ├── 自动处理 Challenge-Response                                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 OpenClaw 插件

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  OpenClaw Onboarding 触发                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  触发时机: 插件初始化时 (plugin.register())                                  │
│                                                                              │
│  Step 1: 检查 Caller 配置                                                   │
│  ├── 文件: ~/.openclaw/f2a-identity.json                                    │
│  ├── 存在 → 检查是否已注册到 Daemon                                          │
│  ├── 不存在 → 执行 init + register                                          │
│                                                                              │
│  Step 2: 执行 init + register                                               │
│  ├── 通过 exec() 调用 CLI                                                   │
│  ├── f2a agent init --name "<agentName>"                                    │
│  ├── f2a agent register --agent-id <agentId> --webhook <url>                │
│  ├── webhook = OpenClaw 的 webhook 端点                                     │
│                                                                              │
│  Step 3: 保存 Caller 配置                                                   │
│  ├── ~/.openclaw/f2a-identity.json                                          │
│                                                                              │
│  Step 4: 设置消息监听                                                        │
│  ├── api.registerService({ id: 'f2a-webhook', start, stop })                │
│  ├── webhook 接收消息 → 调用 subagent.run()                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 手动 CLI

```bash
# 用户手动执行（调试或特殊场景）

# 1. 初始化
f2a agent init --name "MyAgent"

# 输出：
# ✅ Agent identity created
#    AgentId: agent:a3b2c1d4e5f67890
#    Identity file: ~/.f2a/agent-identities/agent:a3b2c1d4...json

# 2. 注册
f2a agent register --agent-id agent:a3b2c1d4e5f67890 --webhook http://...

# 输出：
# ✅ Agent registered
#    NodeSignature: Base64...
#    NodeId: 12D3KooW...
```

---

## Phase 4: 安全验证机制

### 4.1 当前验证点

| 验证点 | 验证内容 | 实现状态 |
|--------|---------|---------|
| **init** | 无验证（本地生成） | ✅ 实现 |
| **register** | selfSignature 验证 | ✅ 实现 (RFC011) |
| **register** | nodeSignature 签发 | ✅ 实现 (RFC008) |
| **Daemon 启动** | nodeSignature 验证 | ❌ 未实现（安全漏洞） |

### 4.2 安全漏洞（RFC006）

**问题**：Daemon 启动时不验证身份文件的 nodeSignature

```
攻击场景：
1. Daemon 停止 → 攻击者修改 ~/.f2a/agent-identities/*.json
2. Daemon 启动 → 加载被篡改的文件（无验证）
3. CLI 使用 → 操作以攻击者的身份执行
```

**根因**：`AgentIdentityStore.loadAll()` 的 `verifySignatureFn` 未传入

### 4.3 解决方案（待决策）

引用 RFC006 的五种方案：

| 方案 | 改动量 | 安全效果 | 推荐场景 |
|------|--------|---------|---------|
| A: 签名链验证 | 低 | 中 | 快速修复 |
| B: CLI/Daemon 分离 | 中 | 高 | 企业环境 |
| C: 纯内存注册 | 中 | 最高 | 高安全需求 |
| D: 双签名验证 | 低 | 中-低 | 辅助防护 |
| E: 在线验证 | 高 | 高 | 公网环境 |

---

## Phase 5: 身份迁移

### 5.1 迁移场景

```
场景：Agent 从 Node A 迁移到 Node B

Node A:                         Node B:
├── Agent 注册                  ├── Agent 注册
├── nodeSignature_A             ├── nodeSignature_B (重新签发)
├── nodeId_A                    ├── nodeId_B
└── 信誉/历史                   └── 信誉继承？
```

### 5.2 迁移流程（草案）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Agent 迁移流程                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Step 1: 在 Node B 上执行 init（复用现有密钥）                               │
│  ├── 如果有身份文件 → 使用现有 publicKey/privateKey                          │
│  ├── 如果没有 → 需要从 Node A 导出                                           │
│                                                                              │
│  Step 2: 在 Node B 上执行 register                                           │
│  ├── Node B 签发新的 nodeSignature_B                                         │
│  ├── 获得新的 nodeId_B                                                       │
│                                                                              │
│  Step 3: 身份文件更新                                                        │
│  ├── nodeSignature = nodeSignature_B                                         │
│  ├── nodeId = nodeId_B                                                       │
│                                                                              │
│  Step 4: 信誉迁移（可选）                                                    │
│  ├── 如果有信誉系统 → 需要设计信誉携带机制                                   │
│  ├── 当前无信誉系统 → 暂不实现                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 迁移问题

| 问题 | 当前状态 | 需要 |
|------|---------|------|
| 密钥复用 | ✅ 可以 | 手动导出导入 |
| nodeSignature 更新 | ✅ 可以 | register 自动签发 |
| 信誉携带 | ❌ 无设计 | 需要 RFC001 实现 |
| 历史追溯 | ❌ 无设计 | 需要验证链 |

---

## Phase 6: 失败恢复

### 6.1 常见失败场景

| 场景 | 原因 | 恢复策略 |
|------|------|---------|
| **Daemon 未启动** | register 需要 Daemon | 提示启动 Daemon |
| **身份文件损坏** | 文件被修改/删除 | 重新 init |
| **注册失败** | selfSignature 无效 | 检查身份文件 |
| **nodeSignature 丢失** | Daemon 重启未恢复 | 重新 register |
| **Caller 配置丢失** | 文件被删除 | 从身份文件重建 |

### 6.2 恢复流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  失败恢复流程                                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  情况 1: Caller 配置丢失，身份文件存在                                       │
│  ├── 解决: 从 ~/.f2a/agent-identities/ 读取 agentId                         │
│  ├── 手动重建 ~/.hermes/f2a-identity.json                                   │
│                                                                              │
│  情况 2: 身份文件丢失，Caller 配置存在                                       │
│  ├── 解决: 无法恢复（私钥丢失）                                              │
│  ├── 必须重新 init + register                                               │
│  ├── 获得新的 agentId                                                       │
│                                                                              │
│  情况 3: nodeSignature 丢失                                                  │
│  ├── 解决: 重新 register                                                    │
│  ├── Daemon 重新签发 nodeSignature                                          │
│                                                                              │
│  情况 4: Daemon 重启后注册状态丢失                                            │
│  ├── 当前行为: 自动从 identityStore 恢复                                     │
│  ├── 如果 identityStore 被篡改 → 安全漏洞                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 7: Webhook 配置时机

### 7.1 两种方式对比

| 方式 | init 时配置 | register 时配置 |
|------|------------|-----------------|
| **优点** | 一次完成 | 更灵活，可更改 |
| **缺点** | 无法动态更改 | 需要两步 |
| **当前实现** | 可选 | 必须（Issue #143） |

### 7.2 当前决策

```bash
# init 时 webhook 可选（仅保存到身份文件）
f2a agent init --name "MyAgent" [--webhook <url>]

# register 时 webhook 必须（实际生效）
f2a agent register --agent-id <agentId> --webhook <url>
```

**原因**：
- init 是本地生成，不与 Daemon 交互
- register 是实际注册，webhook 必须

---

## 设计决策问题

以下问题需要明确决策：

### Q1: 安全漏洞修复方案？

引用 RFC006 Q2：
- [ ] P0: 方案 A（签名链验证）
- [ ] P1: 方案 B/C（存储分离或纯内存）
- [ ] P2: 方案 E（在线验证）

### Q2: Caller 自动触发时机？

- [ ] 第一次使用 F2A 功能时自动 init + register
- [ ] Caller 启动时检查并自动补全
- [ ] 手动触发（用户显式命令）

### Q3: 身份迁移是否支持？

- [ ] 暂不支持（每个 Node 创建新 Agent）
- [ ] 支持（设计导出/导入流程）
- [ ] 支持 + 信誉携带

### Q4: Daemon 启动恢复行为？

- [ ] 自动从 identityStore 恢复（当前行为）
- [ ] 验证 nodeSignature 后恢复（方案 A）
- [ ] 不恢复，需要重新 register（方案 C）

---

## 附录

### A. 相关 RFC

| RFC | 内容 | 关系 |
|-----|------|------|
| RFC006 | Identity Philosophy | 安全漏洞分析、五种方案 |
| RFC008 | Self-Identity | 密钥生成、nodeSignature |
| RFC011 | Verification Chain | selfSignature |
| RFC004 | Webhook Plugin | OpenClaw 集成 |

### B. 关键文件

| 文件 | 作用 |
|------|------|
| `packages/cli/src/init.ts` | init 命令实现 |
| `packages/cli/src/agents.ts` | register 命令实现 |
| `packages/daemon/src/handlers/agent-handler.ts` | Daemon 注册处理 |
| `packages/daemon/src/agent-identity-store.ts` | 身份文件持久化 |
| `packages/network/src/core/identity/agent-keypair.ts` | 密钥生成 |

### C. 状态检查命令

```bash
# 检查身份状态
f2a agent status --agent-id <agentId>

# 输出：
# AgentId: agent:a3b2c1d4...
# Name: 猫咔啦
# PublicKey: Base64...
# NodeSignature: ✅ Valid
# NodeId: 12D3KooW...
# Webhook: http://127.0.0.1:9002/webhook
# Registered: 2026-04-26T10:00:00
```

---

## 变更历史

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-04-26 | 0.1 | 初始草案：完整流程图、各阶段设计、安全验证、迁移恢复 |