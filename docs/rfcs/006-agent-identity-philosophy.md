# RFC 006: Agent Identity Philosophy

> **Status**: Draft (设计讨论)
> **Created**: 2026-04-26
> **Priority**: Core (身份系统核心定义)
> **Related**: RFC008 (Self-Identity), RFC011 (Verification Chain), RFC001 §8 (局限性分析)

---

## 摘要

本文档探讨 F2A 网络中 Agent 身份的本质定义、安全边界和信任模型。这不是一个实现规范，而是身份系统的哲学基础文档，用于指导后续安全设计决策。

---

## 核心问题：Agent 身份是什么？

### 问题起源

在讨论 Agent Onboarding 安全问题时，我们发现一个根本性问题：

```
AgentId = agent:<公钥指纹16位>
Agent 拥有 Ed25519 密钥对

但问题是：这定义了 Agent 的什么？
```

### 四种可能的定义

| 定义 | 身份 = | 证明方式 | 优缺点 |
|------|--------|---------|--------|
| **A: 纯密码学** | 公钥指纹 + 私钥 | 签名验证 | ✅ 简单可靠 ❌ 无法证明"是谁创建" |
| **B: Node 背书** | Node 签发的归属证明 | nodeSignature | ✅ 有物理归属 ❌ Node 文件也可被篡改 |
| **C: 注册状态** | Daemon 内存中的注册记录 | API 查询 | ✅ 最权威 ❌ 重启后丢失 |
| **D: 组合定义** | 以上三者组合 | 多层验证 | ✅ 最安全 ❌ 复杂度高 |

### 当前实现的状态

```
┌─────────────────────────────────────────────────────────────┐
│  F2A 当前身份系统 (RFC008/011)                               │
│                                                              │
│  Agent Identity File (~/.f2a/agent-identities/*.json)       │
│  ├── agentId: "agent:<公钥指纹>"        ← 密码学身份        │
│  ├── publicKey: Ed25519 公钥             ← 密码学身份        │
│  ├── privateKey: Ed25519 私钥            ← 密码学身份        │
│  ├── selfSignature: Agent 签自己         ← 自证明 (RFC011)  │
│  ├── nodeSignature: Node 签 Agent        ← Node 背书         │
│  ├── nodeId: Node 的 PeerId              ← Node 背书         │
│  └── ...                                                    │
│                                                              │
│  但问题：这些数据存储在文件中，谁控制文件？                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 身份的三个层次

### Layer 0: 密码学身份（已实现）

**定义**：Agent = 公钥指纹 + 私钥签名能力

```
AgentId = sha256(publicKey)[:16]
证明 = sign(message, privateKey)
```

**能力**：
- ✅ 证明消息来自持有私钥的实体
- ✅ 身份不可篡改（改公钥 = 改 AgentId）
- ✅ 操作不可伪造

**局限**：
- ❌ 不知道 Agent 是谁创建的（人类？AI？脚本？）
- ❌ 不知道 Agent 的"真实性"
- ❌ name 只是 label，没有背书

**类比**：像 Bitcoin 地址 —— **谁有钱包就是谁**

---

### Layer 1: Node 背书（已实现，但存在安全漏洞）

**定义**：Node 签发 nodeSignature，证明 Agent "归属于" 该 Node

```
nodeSignature = sign(agentId + publicKey, nodePrivateKey)
```

**能力**：
- ✅ Agent 有物理归属（运行在哪个 Node 上）
- ✅ 可以追溯 Node 责任

**局限**：
- ❌ Node 身份文件本身也可能被篡改
- ❌ 一个 Node 可以签发任意数量的 Agent（Sybil 风险）

**当前安全漏洞**（见 §3）：
- Daemon 启动时不验证 nodeSignature
- CLI/Daemon 共享同一身份文件目录

---

### Layer 2: 信任网络（未实现）

**定义**：高信誉 Agent 邀请新 Agent，建立信任链

```
invitationSignature = sign(newAgentId, inviterPrivateKey)
连带责任 = inviter 承担新 Agent 作恶的部分惩罚
```

**能力**：
- ✅ Sybil 防护（创建 Agent 需要邀请或消耗信誉）
- ✅ 信誉洗白防护（新 Agent 初始信誉低）
- ✅ 建立信任网络

**局限**：
- ❌ 需要维护邀请关系和连带责任机制
- ❌ 实现复杂度高

---

### Layer 3: 人类/实体背书（未实现，可选）

**定义**：人类或组织用自己的密钥签名 Agent

```
humanSignature = sign(agentPublicKey, humanPrivateKey)
socialBinding = 验证社交账号（Twitter/GitHub/etc）
```

**能力**：
- ✅ Agent 可以证明"我属于某个人类/组织"
- ✅ 可追溯、可问责
- ✅ 防冒充攻击

**局限**：
- ❌ 复杂度高
- ❌ 涉及社交平台验证
- ❌ 隐私问题

---

## 当前安全漏洞分析

### 漏洞描述

CLI 和 Daemon 共享同一身份文件目录 (`~/.f2a/agent-identities/`)：

```
攻击场景：
┌─────────────────────────────────────────────────────────────┐
│  1. Daemon 停止运行                                          │
│                                                              │
│  2. 攻击者修改 ~/.f2a/agent-identities/*.json               │
│     - 替换 publicKey                                         │
│     - 替换 nodeSignature                                     │
│     - 替换 privateKey                                        │
│                                                              │
│  3. Daemon 启动                                              │
│     - AgentIdentityStore.loadAll() 加载文件                  │
│     - ❌ verifySignatureFn 未传入，签名验证被跳过            │
│                                                              │
│  4. CLI 发消息                                               │
│     - 使用被污染的身份文件                                   │
│     - 操作以"攻击者的 AgentId" 执行                          │
└─────────────────────────────────────────────────────────────┘
```

### 根因

```typescript
// packages/daemon/src/control-server.ts:142-143
this.identityStore = new AgentIdentityStore(this.dataDir);  // ❌ 没有传入 verifySignatureFn
this.identityStore.loadAll();  // 加载但不验证

// packages/daemon/src/agent-identity-store.ts:116-118
// 验证代码存在但从未执行：
if (this.verifySignatureFn && identity.nodeSignature && 
    !this.verifySignatureFn(identity.agentId, identity.nodeSignature, identity.nodeId)) {
  this.logger.warn('Agent identity signature invalid, skipping');
  continue;  // 这行代码永远不会执行，因为 verifySignatureFn 是 undefined
}
```

---

## 五种防护方案

### 方案 A: 签名链验证（最小改动）

**原理**：Daemon 启动时验证 nodeSignature

```typescript
// 修改 control-server.ts
const nodeIdentity = await NodeIdentityManager.load();
this.identityStore = new AgentIdentityStore(
  this.dataDir,
  (agentId, signature, nodeId) => {
    return verifyNodeSignature(agentId, signature, nodeIdentity.publicKey);
  }
);
this.identityStore.loadAll();  // 现在会验证每个文件的 nodeSignature
```

**效果**：
- ✅ 改动小，基于现有机制
- ✅ Daemon 启动时验证身份文件

**局限**：
- ❌ Node 身份文件 (`~/.f2a/node-identity.json`) 本身也可能被篡改
- ❌ 如果攻击者同时篡改 Node 文件和 Agent 文件，验证会通过

---

### 方案 B: CLI/Daemon 存储分离

**原理**：CLI 存储完整身份（含 privateKey），Daemon 只存储 publicKey + 注册状态

```
~/.f2a/agent-identities/        ← CLI 使用（含 privateKey）
~/.f2a/daemon-agent-registry/   ← Daemon 使用（只有 publicKey + 注册信息）
```

**流程**：
```
CLI:
1. f2a agent init → 生成密钥对 → 存到 ~/.f2a/agent-identities/
2. f2a agent register → 发送 publicKey 到 Daemon → Daemon 存到自己的目录

Daemon:
1. 启动 → 加载 ~/.f2a/daemon-agent-registry/（无私钥，篡改无意义）
2. 接收注册 → 验证 Challenge-Response → 存 publicKey
```

**效果**：
- ✅ Daemon 从不接触 privateKey
- ✅ 篡改 Daemon 目录不影响 CLI 身份

**局限**：
- ❌ 两个系统，复杂度高
- ❌ 注册流程变复杂
- ❌ Daemon 目录被篡改可能导致注册状态丢失

---

### 方案 C: 注册中心（纯内存）

**原理**：Daemon 不持久化 Agent 身份，每次启动重新注册

```
Daemon:
1. 启动 → AgentRegistry 清空（内存）
2. Agent 需要重新 register
3. register 时验证 Challenge-Response
```

**流程**：
```
每次 Daemon 启动后：
1. CLI 发送 register 请求（带 agentId + publicKey + Challenge Response）
2. Daemon 验证签名 → 签发新的 nodeSignature → 存入内存
3. Agent 可以正常使用
```

**效果**：
- ✅ 最安全：Daemon 不信任任何文件
- ✅ 篡改文件无效（Daemon 不读取）

**局限**：
- ❌ 每次 Daemon 重启都需要重新注册
- ❌ Webhook 配置需要重新设置
- ❌ 对用户体验有影响

---

### 方案 D: 双签名验证

**原理**：Agent 文件需要 nodeSignature + selfSignature 双验证

```
selfSignature = sign(publicKey, agentPrivateKey)  // RFC011 已实现
nodeSignature = sign(agentId + publicKey, nodePrivateKey)
```

**验证逻辑**：
```typescript
// Daemon 启动时验证：
1. 验证 selfSignature：确认 publicKey 属于该 Agent
2. 验证 nodeSignature：确认 Node 签发了该 Agent
3. 两者都通过才加载
```

**效果**：
- ✅ 防公钥替换攻击：
  - 攻击者替换 publicKey → selfSignature 失败（旧签名不匹配新公钥）
  - 攻击者替换 selfSignature → 需要新私钥（攻击者没有）
- ✅ 基于 RFC011 已有机制

**局限**：
- ❌ 攻击者同时替换 publicKey + privateKey + selfSignature → 可以绕过
- ❌ 需要攻击者没有 privateKey（但 privateKey 也存在同一目录）

---

### 方案 E: 在线验证（网络依赖）

**原理**：身份 = publicKey，通过 P2P 网络查询验证

```
Agent 身份：
- publicKey 是唯一标识
- AgentId = sha256(publicKey)[:16]
- 身份验证：向网络查询该 publicKey 的注册状态
```

**流程**：
```
CLI 发消息：
1. CLI 用 privateKey 签名消息
2. Daemon 收到消息 → 用 publicKey 验证签名
3. Daemon 通过 P2P 网络查询该 publicKey 的信誉/注册状态
4. 验证通过 → 执行操作
```

**效果**：
- ✅ 身份完全由密钥控制，不依赖文件
- ✅ 本地文件篡改无效（网络验证）

**局限**：
- ❌ 需要网络连接
- ❌ 需要设计网络查询协议
- ❌ 新 Agent 无网络历史，如何验证？

---

### 方案对比

| 方案 | 改动量 | 安全效果 | 用户体验 | 推荐场景 |
|------|--------|---------|---------|---------|
| **A: 签名链** | 低 | 中 | 无影响 | 快速修复 |
| **B: 存储分离** | 中 | 高 | 注册变复杂 | 企业环境 |
| **C: 纯内存** | 中 | 最高 | 每次重启需注册 | 高安全需求 |
| **D: 双签名** | 低 | 中-低 | 无影响 | 辅助防护 |
| **E: 在线验证** | 高 | 高 | 需网络 | 公网环境 |

---

## 设计决策问题

以下问题需要明确决策，才能指导后续实现：

### Q1: Agent 身份的定义是什么？

- [ ] A: 纯密码学身份（公钥+私钥）
- [ ] B: 密码学身份 + Node 背书
- [ ] C: 密码学身份 + 注册状态
- [ ] D: 以上三者组合

### Q2: 安全漏洞优先级？

- [ ] P0: 立即修复（选择方案 A 或 D）
- [ ] P1: 短期修复（选择方案 B 或 C）
- [ ] P2: 长期规划（选择方案 E）

### Q3: 是否需要 Layer 2/3？

- [ ] 暂不需要（当前可信环境足够）
- [ ] 需要 Layer 2（邀请制，防 Sybil）
- [ ] 需要 Layer 3（人类背书，问责）

---

## 附录

### A. 相关 RFC

| RFC | 内容 | 关系 |
|-----|------|------|
| RFC008 | Agent Self-Identity 核心设计 | 本文档的密码学基础 |
| RFC011 | Verification Chain (selfSignature) | 本文档的双签名基础 |
| RFC001 §8 | 身份局限性分析 | 本文档的问题背景 |
| RFC001 §8.5 | 可能的解决方案 | 本文档的 Layer 2/3 设计参考 |

### B. 参考模型

**SSH/Git 身份模型**：
```
用户生成密钥对 → 公钥指纹 = 身份 → 公钥放到 authorized_keys → 私钥签名证明
```

类比 F2A：
```
Agent 生成密钥对 → 公钥指纹 = AgentId → 公钥注册到 Daemon → 私钥签名证明
```

区别：SSH 的 authorized_keys 由用户控制，F2A 的注册由 Daemon 控制。

**Bitcoin 身份模型**：
```
私钥 → 公钥 → 地址 → 谁有钱包 = 谁
```

类比 F2A：
```
privateKey → publicKey → AgentId → 联有私钥 = 谁
```

区别：Bitcoin 有区块链记录历史，F2A 没有。

---

## 变更历史

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-04-26 | 0.1 | 初始草案：身份定义、安全漏洞、五种方案 |