# F2A Identity System - Single Source of Truth

> **Last Updated**: 2026-04-24
> **Version**: 2.0
> **Related RFCs**: RFC007, RFC008, RFC011

---

## Overview

F2A 的身份系统是一个三层架构：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Identity Hierarchy                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Level 1: Node Identity                                                 │
│   ├── 持久化身份，代表物理设备/服务器                                      │
│   ├── libp2p PeerId + Ed25519 密钥对                                     │
│   ├── X25519 E2EE 密钥对                                                 │
│   └── 存储位置: ~/.f2a/node-identity.json                                │
│                                                                          │
│   Level 2: Agent Identity                                                │
│   ├── 由 Node 委派的身份，可迁移                                          │
│   ├── 自持 Ed25519 密钥对 (RFC008)                                       │
│   ├── AgentId = agent:<公钥指纹16位>                                     │
│   ├── Self-Signature (RFC011): 证明公钥所有权                            │
│   ├── Node-Signature (RFC011): 证明委派关系                              │
│   └── 存储位置: ~/.f2a/agents/<agent-id>.json                            │
│                                                                          │
│   Level 3: Authentication Token                                          │
│   ├── 短期会话凭证                                                        │
│   ├── Daemon 端：纯内存存储，重启后失效                                    │
│   ├── CLI 端：identity 文件存储 (权限 0o600)                              │
│   └── Challenge-Response 认证获取                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## RFC007: Token Storage Strategy

### Token 存储策略

| 位置 | 存储方式 | 持久性 | 安全等级 |
|------|----------|--------|----------|
| Daemon | 内存 `AgentRegistry` | 重启失效 | 最高 |
| CLI | `identity.json` (0o600) | 持久化 | 高 |

### Token 生命周期

```
1. Agent 初始化 → CLI 生成密钥对 + selfSignature
2. Agent 注册 → Daemon 验证 selfSignature → 生成 nodeSignature → 返回 Token
3. Challenge-Response → CLI 用 Agent 私钥签名 → Daemon 验证 → 授权会话
4. Agent 注销 → Daemon 删除 Token + CLI 删除 identity 文件
```

---

## RFC008: Agent Self-Identity

### AgentId 格式

```
AgentId = "agent:<16位公钥指纹>"
指纹 = Base64(SHA256(publicKey)[:8])
```

**示例**: `agent:ed2Le3CrW6Q=`

### 密钥管理

- **生成**: Agent 自己生成 Ed25519 密钥对
- **存储**: 私钥存储在本地 identity 文件
- **格式**: libp2p protobuf 格式 (64 字节扩展私钥)
- **签名**: Challenge-Response 使用 Agent 私钥签名

### AgentIdentity 数据结构

```typescript
interface AgentIdentity {
  agentId: string;           // "agent:<16位指纹>"
  name: string;              // Agent 名称 (1-64字符)
  publicKey: string;         // Ed25519 公钥 (base64)
  selfSignature: string;     // RFC011: 自签名
  capabilities: string[];    // 能力标签
  nodeId: string;            // 所属 Node ID
  signature: string;         // Node 签名 (base64)
  createdAt: string;         // ISO 时间戳
  expiresAt?: string;        // 可选过期时间
}
```

---

## RFC011: Agent Identity Verification Chain

### 签名验证链

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Verification Chain                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Step 1: Self-Signature Verification                                    │
│  ├── Payload: SHA256(agentId:publicKey)                                 │
│  ├── Signer: Agent Private Key                                          │
│  ├── Verifier: Agent Public Key                                         │
│  └── Purpose: 证明 Agent 拥有该公钥                                      │
│                                                                          │
│  Step 2: Node-Signature Verification                                    │
│  ├── Payload: SHA256(agentId:publicKey:nodeId)                          │
│  ├── Signer: Node Private Key                                           │
│  ├── Verifier: Node Public Key                                          │
│  └── Purpose: 证明 Node 委派了该 Agent                                   │
│                                                                          │
│  Step 3: Challenge-Response Verification                                │
│  ├── Challenge: {timestamp, nonce}                                      │
│  ├── Response: Ed25519.Sign(challenge, agentPrivateKey)                 │
│  ├── Verifier: Agent Public Key (from AgentIdentity)                    │
│  └── Purpose: 证明当前请求来自 Agent 拥有者                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 签名函数 API

```typescript
// 创建自签名
signSelfSignature(agentId, publicKeyBase64, privateKeySeedBase64): string

// 创建 Node 签名
signNodeSignature(agentId, publicKeyBase64, nodeId, nodePrivateKeySeedBase64): string

// 验证自签名
verifySelfSignature(agentId, publicKeyBase64, selfSignatureBase64): boolean

// 验证 Node 签名
verifyNodeSignature(agentId, publicKeyBase64, nodeId, nodeSignatureBase64, nodePublicKeyBase64): boolean

// 计算 AgentId
computeAgentId(publicKeyBase64): string  // → "agent:<16位指纹>"
```

### 密钥格式转换

```
⚠️ 重要: libp2p vs @noble/curves 密钥格式差异

libp2p PrivateKey.raw = 64 bytes (扩展私钥: scalar + prefix)
@noble/curves 需要 = 32 bytes (seed)

转换: 取前 32 字节作为 seed
存储: 保持完整 64 字节格式 (兼容 privateKeyFromRaw)
签名: 使用前 32 字节 seed
```

---

## 验证流程图

### Agent 注册流程

```
CLI                                Daemon
 │                                   │
 │ 1. generateKeyPair()              │
 │ 2. computeAgentId(publicKey)      │
 │ 3. signSelfSignature()            │
 │                                   │
 │──── POST /api/v1/agents ─────────>│
 │   {agentId, publicKey,            │
 │    selfSignature, name}           │
 │                                   │
 │                   4. verifySelfSignature()
 │                   5. generate nodeSignature
 │                                   │
 │<─── Response {nodeSignature} ─────│
 │                                   │
 │ 6. save identity file             │
 │                                   │
```

### Agent 认证流程

```
CLI                                Daemon
 │                                   │
 │──── GET /api/v1/challenge ───────>│
 │   {agentId}                       │
 │                                   │
 │<─── Response {challenge} ─────────│
 │   {timestamp, nonce}              │
 │                                   │
 │ sign(challenge, agentPrivateKey)  │
 │                                   │
 │──── POST /api/v1/messages ───────>│
 │   {agentId, challenge, response}  │
 │                                   │
 │                   verify response
 │                   check AgentIdentity
 │                   verify selfSignature
 │                   verify nodeSignature
 │                                   │
 │<─── Response {authorized} ────────│
 │                                   │
```

---

## 安全性分析

### Self-Signature 防护

| 攻击场景 | 防护机制 |
|----------|----------|
| 篡改 publicKey | selfSignature 验证失败 |
| 篡改 agentId | selfSignature 包含 agentId，验证失败 |
| 重放攻击 | Challenge 包含 nonce 和 timestamp |

### Node-Signature 防护

| 攻击场景 | 防护机制 |
|----------|----------|
| 伪造 Agent | 需要 Node 私钥签名 |
| 迁移到未授权 Node | 需要 Challenge-Response 验证所有权 |
| 篡改 nodeId | nodeSignature 包含 nodeId |

### 密钥存储安全

| 密钥类型 | 存储位置 | 权限 | 加密 |
|----------|----------|------|------|
| Node 私钥 | ~/.f2a/node-identity.json | 0o600 | 可选密码加密 |
| Agent 私钥 | ~/.f2a/agents/*.json | 0o600 | 无（本地存储） |
| Token | Daemon 内存 / CLI 文件 | - | 无 |

---

## 代码位置索引

### 核心文件

| 文件 | 功能 | RFC |
|------|------|-----|
| `packages/network/src/core/identity/types.ts` | 类型定义 | 全部 |
| `packages/network/src/core/identity/identity-signature.ts` | 签名验证函数 | RFC011 |
| `packages/network/src/core/identity/agent-keypair.ts` | Agent 密钥管理 | RFC008 |
| `packages/network/src/core/identity/agent-id.ts` | AgentId 格式处理 | RFC008 |
| `packages/network/src/core/identity/challenge.ts` | Challenge-Response | RFC003 |
| `packages/network/src/core/identity/agent-identity.ts` | Agent Identity 管理 | RFC008+RFC011 |
| `packages/network/src/core/identity/delegator.ts` | 身份委派 | RFC008+RFC011 |

### Daemon 文件

| 文件 | 功能 | RFC |
|------|------|-----|
| `packages/daemon/src/agent-identity-store.ts` | Agent Identity 存储 | RFC011 |
| `packages/daemon/src/handlers/agent-handler.ts` | 注册 API | RFC011 |

### CLI 文件

| 文件 | 功能 | RFC |
|------|------|-----|
| `packages/cli/src/agents.ts` | Agent init/register 命令 | RFC011 |

---

## 测试覆盖

| 测试文件 | 测试数 | 覆盖 RFC |
|----------|--------|----------|
| `identity-signature.test.ts` | 30 | RFC011 |
| `agent-keypair.test.ts` | 15 | RFC008 |
| `agent-id.test.ts` | 12 | RFC008 |
| `challenge.test.ts` | 20 | RFC003 |
| `node-agent-identity.test.ts` | 52 | RFC008+RFC011 |

**总计**: 350+ 测试覆盖 identity 系统

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-04-18 | RFC007 Token 存储 |
| 1.5 | 2026-04-20 | RFC008 Agent Self-Identity |
| 2.0 | 2026-04-24 | RFC011 Verification Chain |