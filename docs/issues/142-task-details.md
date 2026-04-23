# Issue #142 开发任务详细说明

> 供 subagent 执行的详细任务描述

---

## Task 1: Daemon AgentIdentity 结构修复

### 目标
修复 `AgentIdentity` 接口，使其符合 RFC008 规范。

### 修改文件
- `packages/daemon/src/agent-identity-store.ts`
- `packages/daemon/tests/agent-identity-store.test.ts`

### 具体改动

1. **重命名字段**:
   - `signature` → `nodeSignature`

2. **添加字段**:
   - `publicKey: string` - Agent Ed25519 公钥 (Base64)
   - `privateKey?: string` - Agent Ed25519 私钥 (可选, Base64)
   - `nodeId?: string` - 签发节点 ID

3. **移除字段**:
   - `e2eePublicKey` - 这是 Node 的 E2EE 密钥，不应在 Agent identity 中

4. **更新注释**:
   ```typescript
   /** Agent 唯一标识符 格式: agent:<公钥指纹16位> */
   agentId: string;
   ```

### 新结构定义
```typescript
export interface AgentIdentity {
  /** Agent ID (格式: agent:<公钥指纹16位>) */
  agentId: string;
  /** Agent 显示名称 */
  name?: string;
  /** Agent Ed25519 公钥 (Base64) */
  publicKey: string;
  /** Agent Ed25519 私钥 (Base64, 可选存储) */
  privateKey?: string;
  /** Node 归属证明签名 (Base64) */
  nodeSignature?: string;
  /** 签发节点 ID */
  nodeId?: string;
  /** Webhook 配置 */
  webhook?: AgentWebhook;
  /** Agent 支持的能力列表 */
  capabilities?: AgentCapability[];
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
}
```

### 测试要求
- 更新 `tests/agent-identity-store.test.ts` 中所有涉及 AgentIdentity 的测试
- 验证新字段能正确保存和读取
- 至少 3 个具体值验证，不能用 `.toBeDefined()`

### 验收标准
- ✅ 结构定义包含所有必需字段
- ✅ 所有 daemon 测试通过
- ✅ 无 TypeScript 类型错误

---

## Task 2: Daemon 注册响应补全

### 目标
确保 Agent 注册响应包含 RFC008 规定的所有字段。

### 修改文件
- `packages/daemon/src/handlers/agent-handler.ts`
- `packages/daemon/src/handlers/agent-handler.test.ts`

### 具体改动

1. **注册响应添加字段** (line ~298-303):
   ```typescript
   res.end(JSON.stringify({
     success: true,
     restored: false,
     agent: registration,
     nodeSignature: registration.nodeSignature,
     nodeId: registration.nodeId,
     token: agentToken,
   }));
   ```

2. **确保 AgentRegistration 包含字段**:
   - 检查 `AgentRegistration` 接口是否有 `nodeSignature` 和 `nodeId`
   - 如果没有，需要在 `@f2a/network` 的 `agent-registry.ts` 中添加

### 测试要求
- 更新测试验证响应包含所有字段
- 至少验证 2 个具体场景:
  1. 新注册 Agent 返回完整字段
  2. 已注册 Agent 返回完整字段

### 验收标准
- ✅ 注册响应包含 nodeSignature 和 nodeId
- ✅ 所有 daemon handler 测试通过
- ✅ CLI 能正确读取响应并保存

---

## Task 3: Plugin 初始化流程

### 目标
Plugin 启动时能自动创建 Agent identity 文件（如果不存在）。

### 修改文件
- `packages/openclaw-f2a/src/plugin.ts`
- `packages/openclaw-f2a/tests/init.test.ts` (新建)

### 具体改动

1. **添加初始化函数**:
   ```typescript
   /**
    * 初始化 Agent Identity
    * 如果 identity 文件不存在，调用 CLI 创建
    */
   function initializeAgentIdentity(config: Required<WebhookConfig>): AgentIdentityFile | null {
     const agentIdentitiesDir = join(homedir(), '.f2a', 'agent-identities');
     
     // 检查是否存在 identity 文件
     const files = readdirSync(agentIdentitiesDir)
       .filter(f => f.endsWith('.json') && f.startsWith('agent:'));
     
     if (files.length > 0) {
       // 读取最新的 identity
       return readLatestIdentity(agentIdentitiesDir);
     }
     
     // 没有 identity，调用 CLI 创建
     try {
       const cmd = `f2a agent init --name "${config.agentName}"`;
       execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
       
       // 重新读取创建的 identity
       return readLatestIdentity(agentIdentitiesDir);
     } catch (err) {
       return null;
     }
   }
   ```

2. **在 registerService 中调用**:
   ```typescript
   start() {
     // 先初始化 identity
     const identity = initializeAgentIdentity(this.config);
     if (!identity) {
       this.logger.error('[F2A] Failed to initialize Agent identity');
       return;
     }
     
     // 然后注册到 Daemon
     registerWithDaemon(identity, this.config);
   }
   ```

### 测试要求
- 新建 `tests/init.test.ts`
- 测试场景:
  1. 已有 identity 文件时，直接读取
  2. 没有 identity 文件时，调用 CLI 创建
  3. CLI 创建失败时的错误处理

### 验收标准
- ✅ Plugin 能自动创建 Agent identity
- ✅ 所有 openclaw-f2a 测试通过
- ✅ 手动测试: 删除 identity 文件后重启 Plugin 能自动创建

---

## Task 4: Plugin Challenge-Response Ed25519 签名

### 目标
使用 Agent Ed25519 私钥签名 Challenge，而不是 Node X25519 密钥。

### 修改文件
- `packages/openclaw-f2a/src/plugin.ts`
- `packages/openclaw-f2a/tests/register.test.ts`

### 具体改动

1. **移除错误的签名逻辑** (line ~606-613):
   ```typescript
   // ❌ 删除这段代码
   const nodePrivateKey = readNodePrivateKey();
   const nonceSignature = signNonce(nonce, nodePrivateKey);  // HMAC-SHA256
   ```

2. **使用正确的 Ed25519 签名**:
   ```typescript
   import { signChallenge } from '@f2a/network';
   
   // 读取 Agent Ed25519 私钥
   const privateKeyBase64 = identity.privateKey;
   if (!privateKeyBase64) {
     this.logger.error('[F2A] No Agent private key found');
     return { success: false };
   }
   
   const privateKey = Buffer.from(privateKeyBase64, 'base64');
   
   // Ed25519 签名 Challenge
   const signature = signChallenge(challenge.nonce, privateKey);
   ```

3. **发送正确的响应格式**:
   ```typescript
   const verifyReq = await fetch(`http://127.0.0.1:${controlPort}/api/v1/agents/verify`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       agentId: identity.agentId,
       challenge: challenge,
       response: {
         signature: signature.toString('base64'),
         publicKey: identity.publicKey
       }
     }),
   });
   ```

### 测试要求
- 更新 `tests/register.test.ts`
- 验证签名使用 Ed25519 算法
- 验证使用 Agent privateKey 而非 nodePrivateKey
- 至少 2 个错误场景:
  1. privateKey 不存在时返回失败
  2. 签名验证失败时的错误处理

### 验收标准
- ✅ 使用 Agent Ed25519 私钥签名
- ✅ 不使用 Node X25519/HMAC-SHA256
- ✅ 所有 openclaw-f2a 测试通过
- ✅ 与 daemon Challenge 验证兼容

---

## Task 5: 集成测试与验证

### 目标
验证端到端流程正常工作。

### 执行步骤

1. **运行全量测试**:
   ```bash
   cd ~/projects/F2A
   pnpm vitest run --reporter=verbose
   ```

2. **手动测试流程**:
   ```bash
   # 1. 清理现有 identity
   rm -rf ~/.f2a/agent-identities/
   
   # 2. 启动 daemon
   f2a daemon start
   
   # 3. 创建 Agent identity
   f2a agent init --name "Test Agent"
   
   # 4. 注册到 daemon
   f2a agent register --agent-id <从init输出的agentId>
   
   # 5. 验证 Challenge-Response
   f2a agent verify --agent-id <agentId>
   ```

3. **验证 Plugin 流程** (如果 OpenClaw 环境可用):
   - 删除 identity 文件
   - 重启 OpenClaw + Plugin
   - 验证 Plugin 自动创建 identity
   - 验证 Plugin 自动注册到 daemon

### 验收标准
- ✅ network 包所有测试通过
- ✅ daemon 包所有测试通过  
- ✅ cli 包所有测试通过
- ✅ openclaw-f2a 包所有测试通过
- ✅ 手动测试端到端流程成功