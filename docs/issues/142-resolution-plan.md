# Issue #142 处理方案

> **Issue**: OpenClaw-F2A plugin doesn't initialize Agent Identity, Challenge-Response implementation doesn't comply with RFC008
> **Priority**: High (安全相关)
> **Created**: 2026-04-23
> **Status**: ✅ Resolved
> **Resolved Date**: 2026-04-23
> **Resolution Summary**: 完成 RFC008 合规性改造，Daemon AgentIdentity 结构已修复，Plugin 初始化流程和 Ed25519 签名已实现，所有验收标准已达成

---

## 问题分析

### RFC008 规范要求

根据 RFC008 Agent Self-Identity 规范：

1. **AgentId 格式**: `agent:<公钥指纹16位>` (从 Ed25519 公钥 SHA256 取前16位)
2. **身份文件结构**:
   ```json
   {
     "agentId": "agent:a3b2c1d4e5f67890",
     "publicKey": "Base64Ed25519PublicKey...",
     "privateKey": "Base64Ed25519PrivateKey...",
     "nodeSignature": "Node签发的归属证明(Base64)",
     "nodeId": "12D3KooW...",
     ...
   }
   ```
3. **Challenge-Response**: Agent 用自己的 Ed25519 私钥签名，不是 Node 的密钥

### 当前实现问题

#### 问题 1: Plugin 使用错误的密钥签名

**位置**: `packages/openclaw-f2a/src/plugin.ts:606-613`

```typescript
// ❌ 当前实现 - 使用 Node X25519 私钥
const nodePrivateKey = readNodePrivateKey();
const nonceSignature = signNonce(nonce, nodePrivateKey);  // HMAC-SHA256
```

**问题**:
- 使用 Node 的 X25519 密钥（E2EE 密钥）而非 Agent 的 Ed25519 密钥
- 使用 HMAC-SHA256 签名而非 Ed25519 签名
- RFC008 规定应使用 Agent 自己的 Ed25519 私钥签名

**正确做法**:
```typescript
// ✅ 应该使用 Agent Ed25519 私钥
const agentPrivateKey = identity.privateKey;  // 从 identity 文件读取
const signature = signChallenge(challenge, agentPrivateKey);  // Ed25519 签名
```

#### 问题 2: Plugin 缺少 Agent 初始化流程

**位置**: `packages/openclaw-f2a/src/plugin.ts`

**问题**: Plugin 启动时没有调用 `f2a agent init` 创建 Agent 密钥对

**当前流程**:
```
Plugin 启动 → readSavedAgentId() → 如果没有 identity 就失败
```

**正确流程**:
```
Plugin 启动 → 检查 ~/.f2a/agent-identities/ → 
  如果没有 identity → 调用 CLI 创建 Agent Ed25519 密钥对 → 
  保存 identity 文件 → 注册到 Daemon
```

#### 问题 3: Daemon AgentIdentity 结构不完整

**位置**: `packages/daemon/src/agent-identity-store.ts:32-51`

```typescript
// ❌ 当前结构
export interface AgentIdentity {
  agentId: string;
  name: string;
  peerId: string;
  signature: string;        // 应该叫 nodeSignature
  e2eePublicKey?: string;   // 这不是 Agent Ed25519 公钥
  // 缺少 publicKey, privateKey, nodeId
}
```

**RFC008 要求的结构**:
```typescript
// ✅ 正确结构
export interface AgentIdentity {
  agentId: string;
  publicKey: string;        // Agent Ed25519 公钥
  privateKey?: string;      // Agent Ed25519 私钥 (可选存储)
  nodeSignature?: string;   // Node 归属证明
  nodeId?: string;          // 签发 Node ID
  ...
}
```

#### 问题 4: Daemon 注册响应缺少字段

**位置**: `packages/daemon/src/handlers/agent-handler.ts:298-303`

```typescript
// ❌ 当前响应
res.end(JSON.stringify({
  success: true,
  agent: registration,
  token: agentToken,
}));
```

**RFC008 要求响应应包含**:
```typescript
// ✅ 应返回 nodeSignature 和 nodeId
res.end(JSON.stringify({
  success: true,
  agent: registration,
  nodeSignature: registration.nodeSignature,
  nodeId: registration.nodeId,
  token: agentToken,
}));
```

---

## 解决方案设计

### 总体思路

1. **先修复 Daemon** - 更新 AgentIdentity 结构，返回完整注册响应
2. **再修复 Plugin** - 添加初始化流程，使用正确的 Ed25519 签名
3. **更新测试** - 确保所有改动有完整测试覆盖

### 任务拆分（按依赖关系）

```
Task 1: Daemon AgentIdentity 结构修复
  ↓
Task 2: Daemon 注册响应补全
  ↓
Task 3: Plugin 初始化流程
  ↓  
Task 4: Plugin Challenge-Response Ed25519 签名
  ↓
Task 5: 集成测试与验证
```

---

## 详细任务说明

### Task 1: Daemon AgentIdentity 结构修复

**修改文件**:
- `packages/daemon/src/agent-identity-store.ts`

**改动点**:
1. 重命名 `signature` → `nodeSignature`
2. 添加 `publicKey` 字段 (Agent Ed25519 公钥)
3. 添加 `privateKey` 字段 (可选，Agent Ed25519 私钥)
4. 添加 `nodeId` 字段 (签发节点的 ID)
5. 移除 `e2eePublicKey`（那是 Node 的 E2EE 密钥，不是 Agent 的）
6. 更新注释说明新格式

**测试**:
- 更新 `tests/agent-identity-store.test.ts`
- 验证结构字段完整性

### Task 2: Daemon 注册响应补全

**修改文件**:
- `packages/daemon/src/handlers/agent-handler.ts`

**改动点**:
1. 注册成功响应添加 `nodeSignature` 字段
2. 注册成功响应添加 `nodeId` 字段
3. 确保 AgentRegistration 包含这些字段

**测试**:
- 更新 `src/handlers/agent-handler.test.ts`
- 验证响应包含所有必需字段

### Task 3: Plugin 初始化流程

**修改文件**:
- `packages/openclaw-f2a/src/plugin.ts`

**改动点**:
1. 添加 `initializeAgentIdentity()` 函数
2. 在 `registerService()` 中调用初始化流程
3. 如果 identity 文件不存在，调用 CLI 创建：
   ```typescript
   // 调用 f2a agent init 创建 Agent 密钥对
   execSync('f2a agent init --name "OpenClaw Agent"', { encoding: 'utf-8' });
   ```
4. 读取创建的 identity 文件

**测试**:
- 添加新的测试文件 `tests/init.test.ts`
- 测试初始化流程的各个分支

### Task 4: Plugin Challenge-Response Ed25519 签名

**修改文件**:
- `packages/openclaw-f2a/src/plugin.ts`

**改动点**:
1. 移除 `signNonce()` 函数（HMAC-SHA256）
2. 使用 `@f2a/network` 的 `signChallenge()` 函数（Ed25519）
3. 从 identity 文件读取 Agent Ed25519 私钥
4. 用私钥签名 challenge

**代码示例**:
```typescript
import { signChallenge } from '@f2a/network';

// 读取 Agent Ed25519 私钥
const privateKeyBase64 = identity.privateKey;
const privateKey = Buffer.from(privateKeyBase64, 'base64');

// Ed25519 签名
const signature = signChallenge(challenge, privateKey);
```

**测试**:
- 更新 `tests/register.test.ts`
- 验证签名使用正确的密钥和算法

### Task 5: 集成测试与验证

**改动点**:
1. 运行完整测试套件
2. 手动测试 Plugin 注册流程
3. 验证 Challenge-Response 流程端到端工作

---

## 验收标准

1. ✅ Daemon AgentIdentity 结构包含: agentId, publicKey, privateKey?, nodeSignature, nodeId
2. ✅ Daemon 注册响应包含: success, agent, nodeSignature, nodeId, token
3. ✅ Plugin 能自动创建 Agent identity 文件（如果不存在）
4. ✅ Plugin Challenge-Response 使用 Agent Ed25519 私钥签名
5. ✅ 所有测试通过
6. ✅ 手动测试: Plugin → Daemon 注册 → Challenge-Response 验证 全流程成功

---

## 相关文件

| 文件 | 改动类型 |
|-----|---------|
| `packages/daemon/src/agent-identity-store.ts` | 结构修复 |
| `packages/daemon/src/handlers/agent-handler.ts` | 响应补全 |
| `packages/openclaw-f2a/src/plugin.ts` | 初始化+签名修复 |
|| `packages/network/src/core/identity/agent-keypair.ts` | 已完成 rename |
|| `docs/rfcs/008-agent-self-identity.md` | 参考（nodePeerId 已改名 nodeId） |

---

## 解决总结

### 所有 Task 完成状态

| Task | 描述 | 状态 |
|------|------|------|
| Task 1 | Daemon AgentIdentity 结构修复 | ✅ 已完成 |
| Task 2 | Daemon 注册响应补全 | ✅ 已完成 |
| Task 3 | Plugin 初始化流程 | ✅ 已完成 |
| Task 4 | Plugin Challenge-Response Ed25519 签名 | ✅ 已完成 |
| Task 5 | 集成测试与验证 | ✅ 已完成 |

### 验收标准达成情况

1. ✅ Daemon AgentIdentity 结构包含: agentId, publicKey, privateKey?, nodeSignature, nodeId
2. ✅ Daemon 注册响应包含: success, agent, nodeSignature, nodeId, token
3. ✅ Plugin 能自动创建 Agent identity 文件（如果不存在）
4. ✅ Plugin Challenge-Response 使用 Agent Ed25519 私钥签名
5. ✅ 所有测试通过
6. ✅ 手动测试: Plugin → Daemon 注册 → Challenge-Response 验证 全流程成功

### 额外完成的工作

#### Webhook 设计变更

在 Issue #142 解决过程中，对 Agent CLI 命令的 webhook 参数设计进行了优化：

**讨论日期**: 2026-04-23

**变更内容**:

| 命令 | Webhook 参数 | 说明 |
|------|-------------|------|
| `f2a agent init` | 不需要 | init 只创建本地密钥对，不涉及网络通信 |
| `f2a agent register` | 需要 `--webhook` | register 需要指定 daemon 地址进行注册 |
| `f2a agent update` | 不需要 | update 仅修改本地 identity 文件的 name 字段 |

**设计理由**:

1. **init 命令**: 纯本地操作，生成 Ed25519 密钥对并保存到 `~/.f2a/agent-identities/`，无需网络连接
2. **register 命令**: 需要与 daemon 通信，必须指定 `--webhook` 参数（格式: `http://host:port`）
3. **update 命令**: 仅修改本地 identity 文件的 name 字段，不涉及网络操作

**示例**:
```bash
# 初始化（无需 webhook）
f2a agent init --name "My Agent"

# 注册（需要 webhook）
f2a agent register --id agent:xxxx --webhook http://localhost:3003

# 更新名称（无需 webhook）
f2a agent update --id agent:xxxx --name "New Name"
```

---

**Issue #142 已于 2026-04-23 完成，所有验收标准已达成。**