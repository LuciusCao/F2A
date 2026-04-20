# Identity 模块

身份管理模块，提供 Agent 和 Node 的身份认证、签名验证等功能。

## 模块概述

Identity 模块负责 F2A 网络中的身份管理，包括：

- AgentId 生成与验证
- 密钥对管理（Ed25519）
- 身份认证（Challenge-Response 协议）
- 跨节点身份验证
- 加密密钥存储

---

## RFC003 与 RFC008 关系说明

### RFC003 - Node 签发模式

AgentId 由 Node 的 PeerId 签发，Agent 本身没有密钥。

**格式**: `agent:<PeerId前16位>:<随机8位>`

示例: `agent:12D3KooWHxWdnxJa:abc12345`

**特点**:
- AgentId 包含 Node 的 PeerId 前缀
- 身份证明依赖 Node 签名
- 存在安全隐患：拥有 token 文件即可冒充身份

### RFC008 - Agent 自有密钥模式

Agent 拥有独立的 Ed25519 密钥对，AgentId 由公钥指纹生成。

**格式**: `agent:<公钥指纹16位>`

示例: `agent:a3b2c1d4e5f67890`

**特点**:
- AgentId = 公钥指纹（SHA256 前缀）
- Agent 持有私钥，通过签名证明身份
- Challenge-Response 认证机制防重放攻击
- 更安全：私钥签名证明身份，无法冒充

### 共存策略

RFC008 Supersedes RFC003（部分），但保持向后兼容：

| 特性 | RFC003 | RFC008 |
|------|--------|--------|
| AgentId 格式 | `agent:{PeerId}:{随机}` | `agent:{指纹}` |
| 密钥归属 | Node 持有 | Agent 持有 |
| 身份证明 | Node 签名 | Agent 私钥签名 |
| 安全性 | 较低 | 较高 |

**推荐**: 新注册 Agent 使用 RFC008 格式。

---

## 核心组件

### AgentId (agent-id.ts)

AgentId 格式解析与验证，支持新旧两种格式。

```typescript
import {
  generateAgentId,
  parseAgentId,
  validateAgentId,
  isNewFormat,
  isOldFormat
} from './index.js';

// 生成新格式 AgentId
const agentId = generateAgentId(publicKey);  // agent:a3b2c1d4e5f67890

// 解析 AgentId
const parsed = parseAgentId('agent:12D3KooWHxWdnxJa:abc12345');
// { format: 'old', valid: true, peerIdPrefix: '...', randomSuffix: '...' }

// 验证公钥指纹匹配（仅新格式）
const result = validateAgentId(agentId, publicKey);

// 判断格式
isNewFormat(agentId);  // true/false
isOldFormat(agentId);   // true/false
```

### AgentIdentityKeypair (agent-keypair.ts)

RFC008 密钥对管理，提供 Ed25519 密钥生成、签名、验证功能。

```typescript
import { AgentIdentityKeypair } from './index.js';

const keypair = new AgentIdentityKeypair();

// 生成密钥对
const keys = keypair.generateKeypair();
// { privateKey: '...', publicKey: '...' }

// 计算公钥指纹
const fingerprint = keypair.computeFingerprint(keys.publicKey);

// 生成 AgentId
const agentId = keypair.computeAgentId(keys.publicKey);

// 签名与验证
const signature = keypair.sign('data to sign', keys.privateKey);
const isValid = keypair.verify(signature, 'data to sign', keys.publicKey);
```

### Challenge (challenge.ts)

RFC008 Challenge-Response 认证协议，防重放攻击。

```typescript
import {
  generateChallenge,
  signChallenge,
  verifyChallengeResponse,
  ChallengeStore
} from './index.js';

// 服务端：生成 Challenge
const challenge = generateChallenge('send_message', 30);

// 客户端：签名 Challenge
const response = signChallenge(challenge, privateKey);

// 服务端：验证响应
const result = verifyChallengeResponse(agentId, challenge, response);

// 防重放：使用 ChallengeStore
const store = new ChallengeStore();
store.store(challenge);
const result = verifyChallengeResponseWithStore(store, agentId, challenge, response);
```

### Ed25519Signer (ed25519-signer.ts)

Ed25519 签名器，RFC003 签名实现，支持首次连接验证。

```typescript
import { Ed25519Signer } from './index.js';

// 创建签名器（生成新密钥对）
const signer = new Ed25519Signer();

// 或从私钥创建
const signer = new Ed25519Signer(existingPrivateKey);

// 或仅用公钥验证
const verifier = Ed25519Signer.fromPublicKey(publicKey);

// 签名与验证
const signature = signer.signSync('data');
const isValid = await signer.verify('data', signature);

// 静态验证方法
const isValid = await Ed25519Signer.verifyWithPublicKey(
  'data',
  signature,
  publicKey
);
```

### AgentIdentityVerifier (agent-identity-verifier.ts)

跨节点身份验证器，验证来自其他节点的 AgentId 签名，防止冒充攻击。

```typescript
import { AgentIdentityVerifier } from './index.js';

const verifier = new AgentIdentityVerifier(
  e2eeCrypto,
  peerTable,
  connectedPeers
);

// 验证 AgentId 签名（Ed25519 公钥验证）
const result = await verifier.verifyRemoteAgentId(
  agentId,
  signature,
  ed25519PublicKey,
  peerId
);

// 快速验证（仅格式检查）
const isValid = verifier.quickVerify(agentId, peerId);

// 批量验证
const results = await verifier.verifyBatch(
  agentIds,
  signatures,
  peerIds
);
```

---

## 文件列表

| 文件 | 用途 |
|------|------|
| `index.ts` | 模块导出入口 |
| `agent-id.ts` | AgentId 格式解析、验证（RFC008） |
| `agent-keypair.ts` | Ed25519 密钥对管理（RFC008） |
| `challenge.ts` | Challenge-Response 认证协议（RFC008） |
| `ed25519-signer.ts` | Ed25519 签名器（RFC003） |
| `agent-identity-verifier.ts` | 跨节点身份验证（RFC003） |
| `identity-manager.ts` | 统一身份管理器 |
| `agent-identity.ts` | Agent 身份管理 |
| `node-identity.ts` | Node 身份管理 |
| `delegator.ts` | 身份委托代理 |
| `encrypted-key-store.ts` | 加密密钥存储 |
| `types.ts` | 类型定义 |

---

## 参考

- [RFC003 - AgentId Issuance](../../../docs/rfcs/003-agentid-issuance.md)
- [RFC008 - Agent Self-Identity](../../../docs/rfcs/008-agent-self-identity.md)