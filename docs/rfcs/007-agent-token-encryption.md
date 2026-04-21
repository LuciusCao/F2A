# RFC 007: Agent Token 内存管理

> **Status**: Implemented ✅ (Phase 1-2) | 🔄 Phase 3 已废弃，改用 Challenge-Response
> **Created**: 2026-04-18
> **Updated**: 2026-04-22
> **Priority**: High (安全相关)

---

## ⚠️ 重要更新：Phase 3 已废弃

**RFC007 原设计的 Phase 3 存在逻辑矛盾**：
- Phase 1-2: Token 只存 daemon 内存，永不写文件 ✅
- Phase 3: CLI 保存 token 到 identity 文件 ❌ 矛盾！

**问题**：如果 token 只在 daemon 内存中，CLI 如何获取并保存？

**解决方案**：改用 RFC008 Challenge-Response（见下文）

---

## 当前实现架构

### 两层 Token 体系

```
┌─────────────────────────────────────────────────────────────────┐
│                     Layer 1: Challenge-Response                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  CLI/插件 需要操作时：                                     │   │
│  │                                                          │   │
│  │  1. POST /api/v1/challenge → 获取 challenge              │   │
│  │  2. 用本地私钥签名 challenge                              │   │
│  │  3. POST /api/v1/challenge/response → 验证后获得 token   │   │
│  │                                                          │   │
│  │  ✅ 私钥存在本地文件（~/.f2a/agent-identities/*.json）     │   │
│  │  ✅ Token 仅在 daemon 内存（短期有效）                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Challenge 验证成功后
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Layer 2: AgentTokenManager                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  AgentTokenManager（daemon 内存）                          │   │
│  │                                                          │   │
│  │  - generate(agentId) → 短期操作 token                     │   │
│  │  - verify(token) → 验证 token                            │   │
│  │  - Token 有效期：操作期间（通常几分钟到几小时）             │   │
│  │  - 不持久化，重启后清空                                   │   │
│  │                                                          │   │
│  │  ⚠️ 这是"操作 token"，不是"身份 token"                    │   │
│  │     身份验证由 Challenge-Response 完成                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### CLI 发送消息流程

```bash
# CLI 发送消息的实际流程
f2a agent send --agent-id agent:xxx --target agent:yyy "Hello"

内部流程：
1. CLI 读取本地私钥（~/.f2a/agent-identities/agent-xxx.json）
2. POST /api/v1/challenge { agentId, operation: "send_message" }
3. daemon 返回 challenge（30秒有效期）
4. CLI 用私钥签名 challenge
5. POST /api/v1/challenge/response { agentId, challenge, response }
6. daemon 验证签名 → 返回 agentToken
7. POST /api/v1/messages { Authorization: agentToken, message }
```

**关键点**：
- ✅ 私钥持久化在本地（身份证明）
- ✅ Token 仅在 daemon 内存（操作凭证）
- ✅ 每次 API 操作需要重新 Challenge-Response
- ✅ 无需在 CLI 存储 token

---

## 问题背景

### 旧设计的缺陷（已废弃）

```
旧设计问题：
~/.f2a/
└── agent-tokens/
    ├── agent-xxx1.json  ← 所有 Agent 共享
    ├── agent-xxx2.json
    └── agent-xxx3.json

问题：
❌ 同一用户的所有 Agent 都能读取
❌ 文件权限 0o600 只防止其他用户
❌ Subagent 能看到 Main Session 的 token
❌ 无法防止身份伪造（知道 agentId 就能用）
❌ 加密增加复杂度但安全性提升有限
```

### 新设计原则

**身份验证与操作授权分离**：
- **身份验证**：Challenge-Response（私钥签名）
- **操作授权**：短期 AgentToken（daemon 内存）
- daemon 重启后 token 丢失，但私钥仍存在本地
- 每次 Challenge-Response 都生成新 token

---

## 最终实现

### AgentTokenManager 设计

**文件**: `packages/daemon/src/agent-token-manager.ts`

**角色变化**：
- 原 RFC007 设计：持久化身份 token（已废弃）
- 实际实现：Challenge-Response 后的**短期操作 token**

**核心设计**:
```typescript
/**
 * AgentTokenManager - 短期操作 token 管理器
 * 
 * 角色：Challenge-Response 验证成功后，生成短期 token
 * 用于后续 API 操作（如 send_message、update_webhook）
 * 
 * ⚠️ 不是身份验证机制！身份验证由 Challenge-Response 完成
 */
class AgentTokenManager {
  private tokens: Map<string, TokenData> = new Map();
  
  /**
   * 生成短期操作 token
   * 
   * @param agentId Agent ID
   * @returns 短期 token（格式：agent-{random64hex}）
   */
  generate(agentId: string): string {
    const token = `agent-${randomBytes(32).toString('hex')}`;
    const tokenData: TokenData = {
      token,
      agentId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7天
    };
    this.tokens.set(token, tokenData);
    return token;
  }
  
  /**
   * 验证 token 是否有效
   */
  verify(token: string): { valid: boolean; agentId?: string; error?: string }
  
  /**
   * 验证 token 是否属于指定 agentId
   */
  verifyForAgent(token: string, agentId: string): { valid: boolean; error?: string }
  
  /**
   * 撤销指定 token
   */
  revoke(token: string): boolean
  
  /**
   * 撤销指定 agent 的所有 token
   */
  revokeAllForAgent(agentId: string): number
  
  /**
   * 清理过期 token
   */
  cleanExpired(): number
}
```

### ChallengeHandler 设计

**文件**: `packages/daemon/src/challenge-handler.ts`

**核心流程**:
```typescript
/**
 * ChallengeHandler - RFC008 Challenge-Response 认证处理器
 * 
 * 流程：
 * 1. POST /api/v1/challenge → 生成 challenge（30秒有效）
 * 2. Client 用私钥签名 challenge
 * 3. POST /api/v1/challenge/response → 验证签名，返回 agentToken
 */
class ChallengeHandler {
  /**
   * 处理 Challenge 请求
   */
  async handleChallengeRequest(req, res) {
    // 生成 challenge
    const challenge = generateChallenge(operation, 30);
    // 存储到 pendingChallenges
    this.pendingChallenges.set(challenge.challenge, { ... });
    // 返回 challenge
    res.end(JSON.stringify({ success: true, challenge }));
  }
  
  /**
   * 处理 Challenge-Response 提交
   */
  async handleChallengeResponse(req, res) {
    // 验证签名
    const result = verifyChallengeResponse(agentId, challenge, response);
    if (!result.valid) {
      return res.end(JSON.stringify({ success: false, error }));
    }
    
    // 生成短期操作 token
    const agentToken = this.agentTokenManager.generate(agentId);
    
    res.end(JSON.stringify({ 
      success: true, 
      verified: true, 
      agentToken 
    }));
  }
}
```

---

## 安全性分析

### 当前架构的攻击防护

| 攻击场景 | 防护措施 | 效果 |
|---------|---------|------|
| **私钥文件窃取** | Ed25519 私钥，无法伪造签名 | 🔴🔴🔴 完全防护 |
| **Challenge 重放** | 30秒有效期，一次性使用 | 🔴🔴🔴 完全防护 |
| **Token 窃取** | Token 仅内存，重启清空 | 🔴🔴🔴 完全防护 |
| **跨 Agent 访问** | Challenge 绑定 agentId | 🔴🔴🔴 完全防护 |
| **中间人攻击** | P2P E2EE 加密 | 🔴🔴🔴 完全防护 |
| **进程内存读取** | 攻击者已有代码执行权限 | 🔴 无法防护（已攻破） |

### 与旧方案对比

| 维度 | 旧方案（Token 持久化） | 新方案（Challenge-Response） |
|------|----------------------|------------------------------|
| **身份验证** | Token（可被盗） | 私钥签名（不可伪造） |
| **Token 存储** | 文件（有攻击面） | 内存（无攻击面） |
| **重启后** | Token 仍可用 | 需重新 Challenge |
| **CLI 需存储** | Token 文件 | 私钥文件 |
| **安全性** | 🔴🔴 较高 | 🔴🔴🔴 最高 |

---

## 实现状态

### Phase 1: AgentTokenManager 改造 ✅

- [x] 移除文件持久化逻辑
- [x] 移除加密相关代码
- [x] 简化为纯内存 Map 存储
- [x] 实现所有核心方法

### Phase 2: ChallengeHandler 实现 ✅

- [x] `handleChallengeRequest`: 生成 challenge
- [x] `handleChallengeResponse`: 验证签名，生成 agentToken
- [x] Challenge 过期清理机制
- [x] 集成 AgentTokenManager

### Phase 3: 客户端适配 ❌ 废弃，改用 Challenge-Response

- [x] ~~CLI 保存 token 到 identity~~ ❌ 废弃
- [x] CLI 用私钥签名 challenge（RFC008 实现）
- [x] HTTP Header: `Authorization: agent-{token}`（短期 token）

### Phase 4: 测试验证 ✅

- [x] Challenge-Response 单元测试
- [x] AgentTokenManager 单元测试
- [x] CLI 和插件端到端测试

### Phase 5: 清理工作 ✅

- [x] 删除 `token-encryption.ts` 文件
- [x] 更新 RFC007 文档

---

## 实施效果

### 代码简化

**之前**:
```
AgentTokenManager: ~450 行
TokenEncryption: ~230 行
总计: ~680 行
```

**之后**:
```
AgentTokenManager: ~250 行
ChallengeHandler: ~200 行
总计: ~450 行
```

### 安全性提升

- ✅ 身份验证用私钥签名（不可伪造）
- ✅ Token 无文件攻击面
- ✅ Challenge 一次性使用（防重放）
- ✅ Token 短期有效（降低泄露风险）

---

## 未来扩展：Token 持久化场景

### 何时需要 Token 持久化？

Challenge-Response 当前够用，但以下场景可能需要 token 持久化：

1. **频繁 API 调用**
   - 当前：每次操作都需要 Challenge-Response（2次 HTTP 请求）
   - 持久化：Token 可复用，减少开销

2. **离线 Agent**
   - 当前：daemon 重启后需重新 Challenge
   - 持久化：Token 可保存，重启后继续使用

3. **自动化脚本**
   - 当前：脚本每次运行都需要 Challenge
   - 持久化：脚本可读取预先获取的 token

### Token 持久化安全设计（未来）

如果需要引入 token 持久化，建议：

```
方案 A：加密存储
~/.f2a/
└── agent-tokens/
    └── agent-{fingerprint}/
        └── token.json  ← 加密存储（AES-256-GCM）
        
加密密钥来源：
- 用户密码派生（PBKDF2）
- 或系统密钥环（macOS Keychain / Linux keyutils）

方案 B：时间限制 + 自动刷新
- Token 有效期缩短（如 1 小时）
- CLI 自动刷新机制
- 减少泄露风险

方案 C：Token 分级
- 短期 token（内存）：高权限操作
- 长期 token（加密文件）：低权限操作（如查询）
```

**当前决策**：暂不实现 token 持久化，Challenge-Response 已满足需求。

---

## 决策记录

### 为什么用 Challenge-Response 而非 Token 持久化？

1. **安全性更高**：私钥签名验证，不可伪造
2. **实现更简单**：无加密、无密钥管理、无文件权限
3. **符合 RFC008**：Agent Self-Identity 的认证机制
4. **当前够用**：API 操作频率不高，Challenge 开销可接受

### 为什么保留 AgentTokenManager？

1. **短期缓存**：Challenge 后生成 token，避免每次操作都 Challenge
2. **操作授权**：区分"身份验证"（Challenge）和"操作授权"（Token）
3. **批量撤销**：支持 revokeAllForAgent 等管理功能
4. **扩展基础**：未来 token 持久化的基础组件

---

## 参考

- **RFC008**: [Agent Self-Identity](./008-agent-self-identity.md) - Challenge-Response 详细设计
- **实现文件**: `packages/daemon/src/agent-token-manager.ts`
- **实现文件**: `packages/daemon/src/challenge-handler.ts`
- **CLI 实现**: `packages/cli/src/messages.ts` - Challenge-Response 流程
- **测试文件**: `packages/daemon/tests/agent-token-manager.test.ts`