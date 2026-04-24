# RFC011 Implementation Plan

> **Created**: 2026-04-24
> **RFC**: 011-agent-identity-verification-chain.md
> **Total Tasks**: 10
> **Parallel Groups**: 3

---

## Task Overview

```
Group A (基础设施): T1 → T2
Group B (实现): T3, T4, T5, T6 (依赖 T2)
Group C (验证): T7 → T8 (依赖 Group B)
Group D (文档): T9 → T10 (依赖 Group C)
```

---

## Task Details

### Group A: 基础设施（串行）

#### T1: 更新 AgentIdentity 类型定义

**Package**: `@f2a/network`
**File**: `packages/network/src/core/identity/types.ts`

**工作内容**:
1. 在 `AgentIdentity` 接口中添加 `selfSignature: string` 字段
2. 确保字段为必需字段（非 optional）
3. 更新相关的类型导出

**验收标准**:
- 类型定义编译通过
- 字段顺序符合 RFC011 规定

---

#### T2: 实现签名 Payload 生成函数

**Package**: `@f2a/network`
**File**: `packages/network/src/core/identity/signature-utils.ts` (新建)

**工作内容**:
```typescript
// 新建文件，包含以下函数：

/**
 * 创建 Self-Signature payload
 * RFC011: SHA256(agentId + publicKey)
 */
export function createSelfSignaturePayload(agentId: string, publicKeyBase64: string): Uint8Array;

/**
 * 创建 Node-Signature payload
 * RFC011: SHA256(agentId + publicKey + nodeId)
 */
export function createNodeSignaturePayload(agentId: string, publicKeyBase64: string, nodeId: string): Uint8Array;

/**
 * 验证 Self-Signature
 */
export function verifySelfSignature(agentId: string, publicKeyBase64: string, signatureBase64: string): boolean;

/**
 * 验证 Node-Signature
 */
export function verifyNodeSignature(agentId: string, publicKeyBase64: string, nodeId: string, signatureBase64: string, nodePublicKey: Uint8Array): boolean;
```

**验收标准**:
- 使用 `@noble/curves/ed25519` 和 `@noble/hashes/sha256`
- 函数签名符合上述定义
- 导出到 `packages/network/src/index.ts`

---

### Group B: 实现（依赖 T2，可并行）

#### T3: 更新 CLI agent init 命令

**Package**: `@f2a/cli`
**File**: `packages/cli/src/agents.ts`

**工作内容**:
1. 在 `initAgent` 函数中生成 selfSignature
2. 使用 `createSelfSignaturePayload` 和 `ed25519.sign`
3. 注册 API 调用时附带 selfSignature
4. CLI 端保存 identity 文件时包含 selfSignature

**关键代码位置**:
- `packages/cli/src/agents.ts` - init 命令
- `packages/cli/src/identity.ts` - identity 文件保存

---

#### T4: 更新 Daemon Agent 注册 API

**Package**: `@f2a/daemon`
**File**: `packages/daemon/src/handlers/agent-handler.ts`

**工作内容**:
1. `POST /api/v1/agents` 接收 selfSignature 参数
2. 验证 selfSignature 是否有效
3. 生成 nodeSignature（如果 selfSignature 验证通过）
4. 返回 nodeSignature 给 CLI

**API 变化**:
```typescript
// Request body 新增字段
{
  agentId: string;
  publicKey: string;
  selfSignature: string;  // RFC011: 新增
  name: string;
  capabilities?: string[];
}

// Response body 新增字段
{
  agentId: string;
  nodeId: string;
  nodeSignature: string;  // RFC011: Node 签名
}
```

---

#### T5: 更新 AgentIdentityStore 验证逻辑

**Package**: `@f2a/daemon`
**File**: `packages/daemon/src/agent-identity-store.ts`

**工作内容**:
1. 构造函数接收 `nodePublicKey` 参数
2. `loadAll()` 中调用 `verifySelfSignature` 和 `verifyNodeSignature`
3. 验证失败 → skip 加载，记录 warning
4. 更新 `save()` 方法确保 selfSignature 字段存在

---

#### T6: 更新 ControlServer 启动逻辑

**Package**: `@f2a/daemon`
**File**: `packages/daemon/src/control-server.ts`

**工作内容**:
1. 启动时从 `node-identity.json` 加载 Node 公钥
2. 构造 `AgentIdentityStore` 时传入 Node 公钥
3. 确保 Node 公钥加载失败时的处理（warning log，继续启动但验证可能失败）

---

### Group C: 测试（依赖 Group B）

#### T7: 单元测试

**Package**: `@f2a/network`, `@f2a/daemon`

**文件**:
- `packages/network/src/core/identity/signature-utils.test.ts` (新建)
- `packages/daemon/src/agent-identity-store.test.ts` (更新)

**测试用例**:
```typescript
// signature-utils.test.ts
describe('RFC011: Signature Utils', () => {
  it('should create correct self-signature payload');
  it('should create correct node-signature payload');
  it('should verify valid self-signature');
  it('should reject invalid self-signature');
  it('should reject tampered publicKey in self-signature');
});

// agent-identity-store.test.ts
describe('RFC011: Identity Verification', () => {
  it('should load valid identity with both signatures');
  it('should reject identity without selfSignature');
  it('should reject identity with tampered publicKey');
  it('should reject identity with invalid nodeSignature');
  it('should accept identity with valid signatures');
});
```

---

#### T8: 集成测试

**Package**: 跨包测试

**测试场景**:
1. CLI 创建 Agent → Daemon 注册 → 验证 identity 文件完整性
2. Daemon 启动 → 加载 identity → Challenge-Response 认证成功
3. 篡改 identity 文件 → Daemon 启动 → 被拒绝加载 → 认证失败

---

### Group D: 文档（依赖 Group C）

#### T9: 更新 RFC008 和相关文档

**工作内容**:
1. 在 RFC008 中添加对 RFC011 的引用
2. 更新 AGENTS.md 中的身份系统说明
3. 确保文档一致性

---

#### T10: 创建 Identity SSOT 文档

**File**: `docs/identity-system.md` (新建)

**内容**:
- 概述：Node Identity + Agent Identity 的三层体系
- RFC008: Agent Self-Identity（自有密钥）
- RFC011: Verification Chain（双签名验证）
- RFC007: Token 存储策略
- 数据结构汇总
- 验证流程图
- 安全性分析

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Task Dependencies                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   T1 ─────→ T2                                                          │
│   (类型)    (签名函数)                                                    │
│              │                                                           │
│              ├────────────┬────────────┬────────────┐                   │
│              │            │            │            │                   │
│              ↓            ↓            ↓            ↓                   │
│             T3           T4           T5           T6                   │
│           (CLI)      (Daemon API)  (验证逻辑)   (启动逻辑)               │
│              │            │            │            │                   │
│              └────────────┴────────────┴────────────┘                   │
│                              │                                           │
│                              ↓                                           │
│                             T7                                           │
│                        (单元测试)                                         │
│                              │                                           │
│                              ↓                                           │
│                             T8                                           │
│                        (集成测试)                                         │
│                              │                                           │
│                              ↓                                           │
│                             T9                                           │
│                        (更新文档)                                         │
│                              │                                           │
│                              ↓                                           │
│                            T10                                           │
│                     (SSOT 文档)                                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Execution Strategy

### Parallel Execution

由于用户要求使用 subagent 并行执行，采用以下策略：

**Batch 1** (T1-T2): 基础设施，必须串行
- Subagent A: 完成 T1 和 T2

**Batch 2** (T3-T6): 实现层，可并行
- Subagent B: T3-T4 (CLI + Daemon API)
- Subagent C: T5-T6 (验证逻辑 + 启动逻辑)

**Batch 3** (T7-T8): 测试层，串行（需要实现完成）
- Subagent D: 完成所有测试

**Batch 4** (T9-T10): 文档，串行
- Subagent E: 完成所有文档工作

---

## Acceptance Criteria

### Code Level

1. 所有 TypeScript 编译通过（`npm run lint`）
2. 所有单元测试通过（`npm run test:unit`）
3. selfSignature 和 nodeSignature 验证逻辑完整

### Integration Level

1. CLI `f2a agent init` 生成的 identity 包含 selfSignature
2. Daemon 启动时验证 identity 文件完整性
3. 篡改的 identity 文件被拒绝加载

### Documentation Level

1. RFC011 与 RFC008 内容一致
2. Identity SSOT 文档完整
3. 所有相关代码有 RFC011 注释标记

---

## Risk Assessment

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Node 公钥加载失败 | 低 | 中 | 允许启动但 warning，不影响其他功能 |
| 旧 identity 文件无 selfSignature | 中 | 高 | 兼容处理：无签名视为无效，需要重新 init |
| 签名函数实现错误 | 低 | 高 | T7 单元测试覆盖边界情况 |

---

## Timeline Estimate

| Batch | Tasks | 预估时间 | 并行度 |
|-------|-------|----------|--------|
| Batch 1 | T1-T2 | 2h | 串行 |
| Batch 2 | T3-T6 | 4h | 2 并行 |
| Batch 3 | T7-T8 | 4h | 串行 |
| Batch 4 | T9-T10 | 3h | 串行 |
| **Total** | | **13h** | |

考虑到 subagent 并行执行，实际时间约为 **8-10h**。