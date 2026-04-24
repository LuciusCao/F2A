# RFC 011: Agent Identity Verification Chain

> **Status**: Draft 📝
> **Created**: 2026-04-24
> **Priority**: High (安全核心)
> **Depends-on**: RFC008 (Agent Self-Identity)
> 
> **Phase Status**:
> - Phase 1 (Self-Signature 设计): 📋 待实现
> - Phase 2 (Daemon 验证逻辑): 📋 待实现
> - Phase 3 (CLI 创建流程更新): 📋 待实现
> - Phase 4 (测试): 📋 待实现
> - Phase 5 (文档整理): 📋 待实现

---

## 问题背景

### 当前设计的漏洞

RFC008 实现了 Agent 自有密钥的身份体系，但存在一个关键漏洞：

```
~/.f2a/agent-identities/<agentId>.json
      ↓
   CLI AgentIdentityManager ← 读/写
      ↓
   Daemon AgentIdentityStore ← 读/写（无验证）
```

**问题**：Daemon 启动时 `loadAll()` 加载身份文件，但 **不验证文件完整性**。

### 攻击场景

```
1. Daemon 停止
2. 攻击者篡改 ~/.f2a/agent-identities/agent:xxx.json
   - 替换 publicKey（用自己的公钥）
   - 或删除 nodeSignature
3. Daemon 启动 → loadAll() 无验证加载
4. Agent 调用 CLI → 使用被篡改的身份文件
5. Challenge-Response 用篡改后的公钥验证 → 可能导致身份伪造
```

### 根本原因

| 问题 | 现状 | 风险 |
|------|------|------|
| Daemon 不验证 nodeSignature | `AgentIdentityStore` 构造函数没有传入 `verifySignatureFn` | 无法检测归属篡改 |
| 无 selfSignature | 文件中没有"我持有私钥"的证明 | 无法检测公钥替换攻击 |
| CLI/Daemon 共用文件 | 两个系统都信任同一文件 | 文件篡改影响两边 |

---

## 核心设计：双签名验证链

### 设计理念

借鉴 **did:key** 方法（W3C 标准）和 **SSH 密钥认证**：

| 系统 | 身份证明方式 |
|------|-------------|
| did:key | 标识符 = 公钥编码，无额外证明 |
| SSH | 公钥 + known_hosts 信任 |
| libp2p | Peer ID = 公钥哈希，连接时验证 |
| **F2A (本 RFC)** | 公钥 + selfSignature + nodeSignature |

### 双签名机制

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent Identity File                           │
│                                                                  │
│  {                                                               │
│    "agentId": "agent:abc123",      // 公钥指纹                   │
│    "publicKey": "...",             // Ed25519 公钥               │
│                                                                  │
│    // ===== 签名 1: Self-Signature =====                         │
│    // 证明: "持有私钥的人签过这个公钥"                            │
│    // 签名内容: SHA256(agentId + publicKey)                      │
│    // 签名密钥: Agent Ed25519 Private Key                        │
│    "selfSignature": "...",                                       │
│                                                                  │
│    // ===== 签名 2: Node-Signature =====                         │
│    // 证明: "这个 Node 认领过这个 Agent"                          │
│    // 签名内容: SHA256(agentId + publicKey + nodeId)             │
│    // 签名密钥: Node Ed25519 Private Key                         │
│    "nodeId": "node:xyz",                                         │
│    "nodeSignature": "...",                                       │
│                                                                  │
│    // ===== 元数据 =====                                         │
│    "name": "agent-name",                                         │
│    "capabilities": [...],                                        │
│    "createdAt": "..."                                            │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 签名生成流程

```
创建 Agent Identity 时 (CLI):

Step 1: 生成 Agent Ed25519 密钥对
  → privateKey (保密), publicKey

Step 2: 计算 AgentId
  → agentId = "agent:" + SHA256(publicKey)[:16]

Step 3: 生成 Self-Signature
  → payload = SHA256(agentId + publicKey)
  → selfSignature = Ed25519Sign(privateKey, payload)

Step 4: 请求 Node 签名
  → 发送 (agentId, publicKey) 给 Daemon
  → Daemon 用 Node 私钥签名
  → 返回 nodeId + nodeSignature

Step 5: 组装并保存
  → 写入 ~/.f2a/agent-identities/<agentId>.json
```

### 验证流程

```
Daemon 启动时:

Step 1: 加载 Node Identity
  → 获取 Node 公钥 (用于验证 nodeSignature)

Step 2: loadAll() 每个 Agent Identity

Step 3: 验证 Self-Signature
  → payload = SHA256(agentId + publicKey)
  → valid = Ed25519Verify(publicKey, payload, selfSignature)
  → 失败: publicKey 被篡改，跳过加载，记录警告

Step 4: 验证 Node-Signature
  → payload = SHA256(agentId + publicKey + nodeId)
  → valid = Ed25519Verify(nodePublicKey, payload, nodeSignature)
  → 失败: Agent 不属于此 Node，跳过加载

Step 5: 通过验证
  → 加入内存 AgentRegistry
  → 创建消息队列
```

### 安全性分析

| 攻击场景 | 防护机制 | 结果 |
|----------|----------|------|
| 篡改 publicKey | selfSignature 用原私钥签名，新公钥验证失败 | ❌ 拒绝 |
| 替换整个文件（自己的密钥对） | nodeSignature 是 Node 签名原公钥 | ❌ 拒绝 |
| 窃取 Node 私钥 | 可以伪造 nodeSignature，但 selfSignature 需要 Agent 私钥 | ⚠️ 部分防护 |
| 窃取 Agent + Node 私钥 | 可以伪造一切 | ✅ 这是唯一成功路径 |
| 删除 selfSignature | 验证失败（签名缺失） | ❌ 拒绝 |

---

## 详细设计

### Phase 1: Self-Signature 数据结构

#### 1.1 AgentIdentity 结构更新

```typescript
// packages/network/src/core/identity/types.ts

export interface AgentIdentity {
  /** Agent ID (格式: agent:<公钥指纹16位>) */
  agentId: string;
  /** Agent 显示名称 */
  name: string;
  /** Agent Ed25519 公钥 (Base64) */
  publicKey: string;
  
  // ===== RFC011: 新增签名字段 =====
  
  /** Self-Signature: Agent 私钥对 (agentId + publicKey) 的签名 */
  selfSignature: string;
  
  /** Node ID */
  nodeId: string;
  /** Node Signature: Node 私钥对 (agentId + publicKey + nodeId) 的签名 */
  nodeSignature: string;
  
  // ===== 元数据 =====
  
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后活跃时间（ISO 8601） */
  lastActiveAt: string;
}
```

#### 1.2 签名内容定义

```typescript
// Self-Signature payload
function createSelfSignaturePayload(agentId: string, publicKey: string): Uint8Array {
  // SHA256(agentId + publicKey) - 固定格式，防止篡改
  const payload = `${agentId}:${publicKey}`;
  return sha256(Buffer.from(payload, 'utf-8'));
}

// Node-Signature payload
function createNodeSignaturePayload(agentId: string, publicKey: string, nodeId: string): Uint8Array {
  // SHA256(agentId + publicKey + nodeId) - 固定格式
  const payload = `${agentId}:${publicKey}:${nodeId}`;
  return sha256(Buffer.from(payload, 'utf-8'));
}
```

### Phase 2: Daemon 验证逻辑

#### 2.1 AgentIdentityStore 验证增强

```typescript
// packages/daemon/src/agent-identity-store.ts

export class AgentIdentityStore {
  private nodePublicKey: Uint8Array | null = null;
  
  constructor(
    dataDir: string,
    nodePublicKey?: Uint8Array  // RFC011: 传入 Node 公钥
  ) {
    this.nodePublicKey = nodePublicKey;
  }
  
  loadAll(): void {
    // ...
    for (const file of files) {
      const identity = JSON.parse(content) as AgentIdentity;
      
      // RFC011: 验证 selfSignature
      if (!this.verifySelfSignature(identity)) {
        this.logger.warn('Self-signature invalid, skipping', { agentId: identity.agentId });
        continue;
      }
      
      // RFC011: 验证 nodeSignature
      if (!this.verifyNodeSignature(identity)) {
        this.logger.warn('Node-signature invalid, skipping', { agentId: identity.agentId });
        continue;
      }
      
      this.identities.set(identity.agentId, identity);
    }
  }
  
  private verifySelfSignature(identity: AgentIdentity): boolean {
    if (!identity.selfSignature) {
      this.logger.warn('Missing selfSignature', { agentId: identity.agentId });
      return false;
    }
    
    const payload = createSelfSignaturePayload(identity.agentId, identity.publicKey);
    const signature = Buffer.from(identity.selfSignature, 'base64');
    const publicKey = Buffer.from(identity.publicKey, 'base64');
    
    return ed25519.verify(payload, signature, publicKey);
  }
  
  private verifyNodeSignature(identity: AgentIdentity): boolean {
    if (!identity.nodeSignature || !identity.nodeId) {
      this.logger.warn('Missing nodeSignature or nodeId', { agentId: identity.agentId });
      return false;
    }
    
    if (!this.nodePublicKey) {
      this.logger.warn('Node public key not available for verification');
      return false;
    }
    
    const payload = createNodeSignaturePayload(identity.agentId, identity.publicKey, identity.nodeId);
    const signature = Buffer.from(identity.nodeSignature, 'base64');
    
    return ed25519.verify(payload, signature, this.nodePublicKey);
  }
}
```

#### 2.2 ControlServer 启动时传入 Node 公钥

```typescript
// packages/daemon/src/control-server.ts

constructor(f2a: F2A, port: number, options?: ControlServerOptions) {
  // ...
  
  // RFC011: 加载 Node 公钥用于验证
  let nodePublicKey: Uint8Array | null = null;
  const nodeIdentityPath = join(this.dataDir, 'node-identity.json');
  if (existsSync(nodeIdentityPath)) {
    const nodeIdentity = JSON.parse(readFileSync(nodeIdentityPath, 'utf-8'));
    if (nodeIdentity.publicKey) {
      nodePublicKey = Buffer.from(nodeIdentity.publicKey, 'base64');
    }
  }
  
  // RFC011: 传入 Node 公钥
  this.identityStore = new AgentIdentityStore(this.dataDir, nodePublicKey);
  this.identityStore.loadAll();
}
```

### Phase 3: CLI 创建流程更新

#### 3.1 Agent 创建时生成 selfSignature

```typescript
// packages/cli/src/agents.ts

async function initAgent(options: { name: string }): Promise<void> {
  // 生成密钥对
  const privateKey = await generateKeyPair('Ed25519');
  const publicKey = privateKey.publicKey.raw;
  const privateKeyBytes = privateKey.raw;
  
  // 计算 AgentId
  const agentId = 'agent:' + sha256(publicKey).slice(0, 16);
  
  // RFC011: 生成 selfSignature
  const selfPayload = createSelfSignaturePayload(agentId, publicKey);
  const selfSignature = ed25519.sign(selfPayload, privateKeyBytes.slice(0, 32));
  
  // 注册到 Daemon，获取 nodeSignature
  const response = await registerWithDaemon({
    agentId,
    publicKey,
    selfSignature,  // RFC011: 附带 selfSignature
    name: options.name
  });
  
  // 组装完整的 Identity
  const identity = {
    agentId,
    publicKey,
    selfSignature,
    nodeId: response.nodeId,
    nodeSignature: response.nodeSignature,
    name: options.name,
    capabilities: [],
    createdAt: new Date().toISOString()
  };
  
  // 保存（CLI 存私钥，Daemon 存公钥+签名）
  await saveAgentIdentity(identity, privateKeyBytes);
}
```

### Phase 4: 测试用例

#### 4.1 签名验证测试

```typescript
// packages/daemon/src/agent-identity-store.test.ts

describe('RFC011: Self-Signature Verification', () => {
  it('should reject identity with tampered publicKey', () => {
    // 创建合法 identity
    const identity = createValidIdentity();
    
    // 篡改 publicKey
    identity.publicKey = 'tampered-public-key';
    
    // 验证应该失败
    expect(store.verifySelfSignature(identity)).toBe(false);
  });
  
  it('should reject identity without selfSignature', () => {
    const identity = createValidIdentity();
    identity.selfSignature = undefined;
    
    expect(store.verifySelfSignature(identity)).toBe(false);
  });
  
  it('should accept valid identity', () => {
    const identity = createValidIdentity();
    
    expect(store.verifySelfSignature(identity)).toBe(true);
    expect(store.verifyNodeSignature(identity)).toBe(true);
  });
});
```

---

## 演进路径

### Phase 1: 本地验证（本 RFC）

```
Agent Identity File
    ↓ selfSignature 验证（证明私钥存在）
    ↓ nodeSignature 验证（证明 Node 归属）
Daemon 内存
```

**覆盖**: 防止文件篡改攻击

### Phase 2: 跨 Node 验证（未来 RFC）

```
Node A 发消息 → 附带 Agent Identity (含签名)
    ↓
Node B 收消息 → 验证 selfSignature + nodeSignature
    ↓ 查询 Node A 公钥（通过 P2P 网络）
    ↓ 多节点返回 Node A 公钥，比对一致性
```

**覆盖**: 防止恶意 Node 伪造 Agent

### Phase 3: 网络共识（未来 RFC）

```
恶意 Node 行为 → 其他节点检测
    ↓ 广播恶意标记
    ↓ 投票排除
信任网络
```

**覆盖**: 拜占庭容错

---

## 实施计划

### 任务拆分

| 任务 ID | 任务名称 | 依赖 | 预估工时 |
|---------|----------|------|----------|
| T1 | 定义 AgentIdentity 新结构（selfSignature 字段） | 无 | 1h |
| T2 | 实现签名 payload 生成函数 | T1 | 1h |
| T3 | 更新 CLI agent init 命令（生成 selfSignature） | T2 | 2h |
| T4 | 更新 Daemon register API（接收并验证 selfSignature） | T2 | 2h |
| T5 | 更新 AgentIdentityStore 验证逻辑 | T2 | 2h |
| T6 | 更新 ControlServer 启动逻辑（传入 Node 公钥） | T5 | 1h |
| T7 | 编写单元测试 | T1-T6 | 2h |
| T8 | 集成测试（完整流程） | T7 | 2h |
| T9 | 更新 RFC008 文档 | T1-T8 | 1h |
| T10 | 创建 Identity Single Source of Truth 文档 | T9 | 2h |

### 依赖关系图

```
T1 (类型定义)
  ↓
T2 (签名函数)
  ↓
  ├── T3 (CLI) ──→ T7 (单元测试) ──→ T8 (集成测试)
  └── T4 (Daemon API) ──→ T7
        ↓
      T5 (验证逻辑) ──→ T7
        ↓
      T6 (启动逻辑) ──→ T7
                              ↓
                            T8 ──→ T9 ──→ T10
```

---

## 验收标准

1. ✅ Daemon 启动时验证所有 Agent Identity 的 selfSignature 和 nodeSignature
2. ✅ 篡改 publicKey 的 identity 被拒绝加载
3. ✅ 缺少签名的 identity 被拒绝加载
4. ✅ CLI 创建 Agent 时自动生成 selfSignature
5. ✅ 所有测试通过
6. ✅ Identity 文档整理完成

---

## 参考文档

- [did:key Method (W3C)](https://w3c-ccg.github.io/did-key-spec/) - 标识符包含公钥的思路
- [libp2p Peer ID](https://docs.libp2p.io/concepts/fundamentals/peer-id) - 公钥哈希作为标识符
- [RFC008](./008-agent-self-identity.md) - Agent 自有密钥体系（前置依赖）
- [RFC007](./007-agent-token-encryption.md) - Token 存储策略

---

## 附录

### A. 为什么不用简单的文件校验？

**方案**: 文件内容 SHA256 校验，存一个 checksum 文件

**问题**:
- checksum 文件同样可被篡改
- 不提供"私钥存在"的证明
- 不解决身份归属问题

**结论**: 密码学签名是唯一可靠方案

### B. 为什么 selfSignature 签名内容是 SHA256(agentId + publicKey)？

**考虑**:
- agentId 本身是 publicKey 的 SHA256[:16]，所以理论上签名 publicKey 就够了
- 但加上 agentId 可以防止"用别的 identity 的签名"攻击
- SHA256 确保固定长度，便于 Ed25519 签名

### C. Node 私钥泄露的影响

**如果 Node 私钥泄露**:
- 可以伪造 nodeSignature（归属证明）
- 但无法伪造 selfSignature（需要 Agent 私钥）
- 攻击者可以：
  - 创建新 Agent（用自己的密钥）
  - 声称这些 Agent 属于被攻陷的 Node
- 但不能：
  - 窃取已有 Agent 的身份（没有 Agent 私钥）

**结论**: Node 私钥泄露只影响"创建新 Agent"，不影响"已存在 Agent"