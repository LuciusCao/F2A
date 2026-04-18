# RFC 007: Agent Token 加密保护

> **Status**: Planning
> **Created**: 2026-04-18
> **Priority**: High (安全相关)

---

## 问题背景

### 当前设计的缺陷

```
当前存储：
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
```

### 安全需求

1. **每个 Agent 独立存储** - 不能看到其他 Agent 的 token
2. **加密保护** - 即使文件被读取，没有密钥也无法解密
3. **API 验证** - 每次调用都验证 token 属于该 agent
4. **密钥隔离** - 每个 Agent 有独立的加密密钥

---

## 实现路线

### Phase 1: 存储结构改造 ✅ (已创建基础)

```
改造后的存储：
~/.f2a/
├── agents/
│   ├── agent:main:xxx/                 ← Main Session
│   │   ├── token-encryption.key        ← 🔒 加密密钥 (0o600)
│   │   └── tokens/
│   │       └── agent-token1.json       ← 🔒 加密存储
│   │
│   ├── agent:main:subagent:aaa/        ← Subagent 1
│   │   ├── token-encryption.key        ← 🔒 不同密钥
│   │   └── tokens/
│   │       └── agent-token2.json       ← 🔒 用不同密钥加密
│   │
│   └── agent:main:subagent:bbb/        ← Subagent 2
│       └── ...
```

### Phase 2: 加密模块实现 ✅ (已创建)

**文件**: `packages/daemon/src/token-encryption.ts`

| 功能 | 方法 | 状态 |
|------|------|------|
| 密钥管理 | `loadOrCreateKey()` | ✅ 已实现 |
| 加密 | `encrypt(plaintext)` | ✅ 已实现 |
| 解密 | `decrypt(encrypted)` | ✅ 已实现 |
| 清理 | `clearKey()` | ✅ 已实现 |

### Phase 3: AgentTokenManager 改造

| 任务 | 描述 | 优先级 |
|------|------|--------|
| **构造函数修改** | 添加 agentId 参数，按 agentId 分组 | P0 |
| **loadAll → loadForAgent** | 只加载指定 agent 的目录 | P0 |
| **saveToFile 加密** | Token 文件加密保存 | P0 |
| **loadFromFile 解密** | 加载时解密验证 | P0 |
| **verifyForAgent 增强** | 检查 token 属于该 agent | P0 |

### Phase 4: ControlServer 集成

| API | 改动 | 优先级 |
|------|------|--------|
| **handleVerifyAgent** | 生成并保存 token（之前没有保存） | P0 |
| **handleSendMessage** | 验证 Authorization header 中的 token | P0 |
| **handleUpdateAgent** | 验证 token 属于该 agent | P1 |
| **handleUpdateWebhook** | 验证 token 属于该 agent | P1 |

### Phase 5: API 客户端改造

| 任务 | 描述 | 优先级 |
|------|------|--------|
| **CLI 改造** | `f2a send` 等命令带上 token | P1 |
| **插件改造** | 保存 token 到 identity 文件 | P1 |
| **HTTP Header** | `Authorization: agent-{token}` | P0 |

### Phase 6: 测试改造

| 任务 | 描述 | 优先级 |
|------|------|--------|
| **测试文件更新** | 适配新的构造函数（带 agentId） | P0 |
| **加密测试** | 测试加密/解密流程 | P0 |
| **跨 Agent 测试** | 测试 Agent A 无法用 Agent B 的 token | P0 |

### Phase 7: 数据迁移

| 任务 | 描述 | 优先级 |
|------|------|--------|
| **迁移脚本** | 旧 token 文件迁移到新目录结构 | P2 |
| **兼容性处理** | 支持读取旧的未加密 token（过渡期） | P2 |

---

## 任务拆分

### Task 1: TokenEncryption 模块 ✅ 完成

- [x] 创建 `token-encryption.ts`
- [x] AES-256-GCM 加密实现
- [x] 密钥生成和保存
- [x] 加密/解密方法
- [x] 错误处理

### Task 2: AgentTokenManager 改造（开发）

**改动点**:

```typescript
// 旧设计
class AgentTokenManager {
  constructor(dataDir: string) {
    this.tokensDir = join(dataDir, 'agent-tokens');
    // ❌ 所有 agent 共享
  }
}

// 新设计
class AgentTokenManager {
  constructor(dataDir: string, agentId: string, options?: Options) {
    this.tokensDir = join(dataDir, 'agents', agentId, 'tokens');
    this.encryption = new TokenEncryption(dataDir, agentId);
    // ✅ 每个 agent 独立目录 + 加密
  }
  
  loadForAgent(): void {
    // ✅ 只加载当前 agent 的目录
  }
  
  saveToFile(tokenData): void {
    const encrypted = this.encryption.encrypt(JSON.stringify(tokenData));
    // ✅ 加密后保存
  }
}
```

### Task 3: AgentTokenManager 改造（测试）

- [ ] 更新测试构造函数
- [ ] 测试加密存储
- [ ] 测试跨 Agent 验证失败

### Task 4: ControlServer handleVerifyAgent 改造

**当前问题**:
```typescript
// 当前实现 (control-server.ts:1302)
const agentToken = this.generateAgentToken(); // ❌ 只是 randomBytes
// ❌ 没有保存到 AgentTokenManager
// ❌ 返回后丢失
```

**需要改动**:
```typescript
// 新实现
const agentToken = this.agentTokenManager.generateAndSave(data.agentId);
// ✅ Token 保存并绑定到 agentId
```

### Task 5: ControlServer handleSendMessage 改造

**当前问题**:
```typescript
// 当前实现 (control-server.ts:1015)
if (!this.agentRegistry.get(data.fromAgentId)) {
  // ❌ 只检查 agentId 是否注册
  // ❌ 没有验证 token
}
```

**需要改动**:
```typescript
// 新实现
const agentToken = req.headers['authorization']?.replace('agent-', '');
const verifyResult = this.agentTokenManager.verifyForAgent(agentToken, data.fromAgentId);
if (!verifyResult.valid) {
  res.writeHead(401);
  res.end(JSON.stringify({ error: verifyResult.error }));
  return;
}
// ✅ 验证 token 属于该 agent
```

### Task 6: CLI 和插件改造

**CLI (`@f2a/cli`)**:
- [ ] `f2a send` 带上 Authorization header
- [ ] `f2a messages` 带上 Authorization header
- [ ] 保存 token 到 identity 文件

**插件 (`@f2a/openclaw-f2a`)**:
- [ ] 读取 identity 文件中的 token
- [ ] API 调用时带上 Authorization header

---

## 安全保障矩阵

| 场景 | 文件权限 | 程序逻辑 | 加密保护 | 最终效果 |
|------|---------|---------|---------|---------|
| **正常使用** | ✅ Agent 只读自己的目录 | ✅ loadForAgent 限制 | ✅ 解密需要密钥 | 🔴🔴🔴 安全 |
| **代码篡改** | ✅ 同用户可读 | ❌ 可绕过读取 | ✅ 无密钥无法解密 | 🔴🔴 有保护 |
| **调试/逆向** | ✅ 同用户可读 | ❌ 可绕过 | ⚠️ 密钥在内存 | 🔴 基础保护 |
| **其他用户** | ✅ 0o600 防止 | ✅ 程序隔离 | ✅ 加密保护 | 🔴🔴🔴 最高 |

---

## 实施顺序

### Week 1: 核心改造 (P0)

1. ✅ TokenEncryption 模块创建
2. ⏳ AgentTokenManager 改造
3. ⏳ ControlServer handleVerifyAgent
4. ⏳ ControlServer handleSendMessage

### Week 2: 集成测试 (P0-P1)

5. ⏳ 测试文件更新
6. ⏳ CLI 改造
7. ⏳ 插件改造

### Week 3: 迁移和优化 (P2)

8. ⏳ 数据迁移脚本
9. ⏳ 兼容性处理

---

## 下一步行动

**立即执行**:
1. Task 2: AgentTokenManager 改造（开发 + 测试）
2. Task 4: ControlServer handleVerifyAgent 改造
3. Task 5: ControlServer handleSendMessage 改造

需要我按顺序执行这些任务吗？喵~ 🐱