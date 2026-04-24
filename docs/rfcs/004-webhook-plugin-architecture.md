# RFC 004: OpenClaw F2A Webhook 插件架构

> **Status**: Phase 4 Implementation Ready + Agent Webhook Design + Agent Identity Persistence Added
> **Created**: 2026-04-14
> **Updated**: 2026-04-15 22:22 (Agent Identity 持久化机制设计完成)
> **Author**: Discussion with user

---

## 现状评估 (2026-04-15)

### ✅ 已完成的改造

| 项目 | 改造前 | 改造后 | 状态 |
|------|--------|--------|------|
| **插件源码** | 30+ 文件, ~5000 行 | 3 文件, 708 行 | ✅ 已改造 |
| **plugin.ts** | 复杂（P2P + 路由 + 注册） | 简化（仅 webhook） | ✅ 226 行 |
| **package.json** | "OpenClaw F2A Plugin" | "Minimal webhook plugin" | ✅ 已更新 |
| **核心职责** | 启动 P2P、管理 Agent、路由消息 | 接收 webhook、调用 Agent | ✅ 已转变 |
| **消息发送** | 直接 P2P | 通过 `f2a CLI` | ✅ 已集成 |

### plugin.ts 核心流程

```typescript
// 1. register() - 同步注册
export default function register(api: OpenClawPluginApi) {
  // 只保存配置，不启动任何服务
}

// 2. startWebhookListener() - 异步监听
async function startWebhookListener(api, config) {
  // HTTP server 监听 9002 端口
  // 接收 POST /f2a/webhook
  // 验证 token
  // 解析 payload { from, content }
}

// 3. invokeAgent() - 调用 Agent
async function invokeAgent(api, from, message, timeout) {
  // 使用 subagent API
  // 等待 Agent 回复
  // 返回 reply
}

// 4. 发送回复
exec(`f2a send --to "${from}" --message "${reply}"`)
```

### ❌ 待清理的内容

| 项目 | 数量 | 说明 |
|------|------|------|
| **旧测试文件** | 49 个 | tests/*.ts（旧架构测试） |
| **旧文档** | ? | 可能有旧版文档引用旧架构 |

### 🟡 待验证的流程

| 场景 | 状态 | 说明 |
|------|------|------|
| Webhook 接收 | ⚠️ 未测试 | HTTP server 是否正常启动 |
| Agent 调用 | ⚠️ 未测试 | subagent API 是否可用 |
| CLI 发送回复 | ⚠️ 未测试 | `f2a send` 是否能正确发送 |

---

## 架构对比

### 改造前

```
Gateway 加载 openclaw-f2a 插件
    ↓
插件内部启动 P2PNetwork
    ↓
插件管理 AgentRegistry + MessageRouter
    ↓
插件提供 15+ 工具
    ↓
直接通过 P2P 发送消息
```

### 改造后

```
Gateway 加载 openclaw-f2a 插件
    ↓
插件只启动 HTTP webhook listener (9002)
    ↓
f2a daemon (独立进程) 管理 P2P + Agent
    ↓
daemon 收到消息 → webhook 转发给插件
    ↓
插件调用 Agent.invokeAgent()
    ↓
插件执行 f2a CLI 发送回复
```

---

## 职责分离

| 组件 | 职责 | 进程 |
|------|------|------|
| **f2a daemon** | P2P 网络、Agent 注册、消息路由 | 独立后台进程 |
| **openclaw-f2a 插件** | Webhook 接收、Agent 调用、回复发送 | Gateway 内 |

---

## OpenClaw 插件自动注册机制 (2026-04-15 新增)

### 背景

**问题发现**：OpenClaw 插件启动 webhook listener 后，**没有主动向 F2A Daemon 注册自己**。

**当前状态**：
```
Gateway 启动 → 加载 openclaw-f2a 插件
    ↓
插件启动 webhook listener (9002) ✅
    ↓
插件等待消息...
    ↓
❌ F2A Daemon 不知道这个 Agent 的存在
    ↓
其他 Agent 发消息 → F2A Daemon 找不到目标
```

**预期状态**：
```
Gateway 启动 → 加载 openclaw-f2a 插件
    ↓
插件启动 webhook listener (9002) ✅
    ↓
插件调用 POST /api/agents 注册自己 ✅
    ↓
F2A Daemon 知道这个 Agent 的 webhook URL
    ↓
其他 Agent 发消息 → F2A Daemon 正确转发
```

### 解决方案设计

**核心思路**：插件在 `startWebhookListener()` 成功后，自动调用 F2A Daemon 的注册 API。

**注册时机**：
1. Webhook listener 启动成功（端口绑定完成）
2. 检测到 F2A Daemon 正在运行
3. 获取必要的配置参数

**注册信息**：
```json
{
  "name": "OpenClaw Agent",
  "capabilities": ["chat", "task", "code"],
  "webhook": {
    "url": "http://127.0.0.1:9002/f2a/webhook",
    "token": "<webhook-token>"
  },
  "metadata": {
    "platform": "OpenClaw",
    "version": "2026.4.5"
  }
}
```

### 自动注册流程

```typescript
// plugin.ts 新增流程
async function startWebhookListener(api, config) {
  // 1. 启动 HTTP server
  const server = http.createServer(handler);
  server.listen(config.webhookPort, '127.0.0.1', () => {
    api.logger?.info('Webhook listener started');
    server.unref();
    
    // 2. 自动注册到 F2A Daemon（新增）
    setImmediate(async () => {
      try {
        await registerToDaemon(api, config);
      } catch (err) {
        api.logger?.warn('Failed to register to F2A daemon:', err);
      }
    });
  });
}

async function registerToDaemon(api, config) {
  // 检测 Daemon 是否运行
  const daemonRunning = await checkDaemonRunning(config.controlPort);
  if (!daemonRunning) {
    api.logger?.warn('F2A Daemon not running, skipping registration');
    return;
  }
  
  // 调用 POST /api/agents
  const response = await fetch(`http://127.0.0.1:${config.controlPort}/api/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-F2A-Token': config.webhookToken
    },
    body: JSON.stringify({
      name: config.agentName || 'OpenClaw Agent',
      capabilities: config.agentCapabilities || ['chat', 'task'],
      webhook: {
        url: `http://127.0.0.1:${config.webhookPort}${config.webhookPath}`,
        token: config.webhookToken
      },
      metadata: {
        platform: 'OpenClaw',
        version: api.version || 'unknown'
      }
    })
  });
  
  const result = await response.json();
  if (result.success) {
    api.logger?.info(`Registered to F2A: agentId=${result.agent.agentId}`);
    // 保存 agentId 用于后续注销
    config.agentId = result.agent.agentId;
  } else {
    api.logger?.error(`Registration failed: ${result.error}`);
  }
}
```

### 实现方案

**新增配置参数**（在 OpenClaw 插件配置中）：
```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "config": {
          "webhookPath": "/f2a/webhook",
          "webhookPort": 9002,
          "webhookToken": "<secret>",
          "controlPort": 9001,
          "agentTimeout": 60000,
          
          // 新增参数
          "agentName": "OpenClaw Agent",
          "agentCapabilities": ["chat", "task", "code"],
          "autoRegister": true,
          "registerRetryInterval": 5000,
          "registerMaxRetries": 3
        }
      }
    }
  }
}
```

> **注意**: webhook 配置在 Agent **register** 时设置，而非 init 时。
> 详见 [RFC 008: Agent Self-Identity](./008-agent-self-identity.md) 的 CLI 命令设计。
> - `f2a agent init` - 仅生成密钥对，不设置 webhook
> - `f2a agent register --webhook` - 注册到 Daemon 并设置 webhook

**完整实现代码**：

```typescript
/**
 * 自动注册到 F2A Daemon
 * 在 webhook listener 启动后执行
 */
async function registerToDaemon(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig> & {
    agentName?: string;
    agentCapabilities?: string[];
    autoRegister?: boolean;
    registerRetryInterval?: number;
    registerMaxRetries?: number;
  }
): Promise<void> {
  // 检查是否启用自动注册
  if (config.autoRegister === false) {
    api.logger?.info('[F2A] Auto-register disabled, skipping');
    return;
  }
  
  const controlPort = config.controlPort || 9001;
  const maxRetries = config.registerMaxRetries || 3;
  const retryInterval = config.registerRetryInterval || 5000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 检测 Daemon 是否运行
      const healthResponse = await fetch(`http://127.0.0.1:${controlPort}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      
      if (!healthResponse.ok) {
        api.logger?.warn(`[F2A] Daemon health check failed (attempt ${attempt}/${maxRetries})`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryInterval));
          continue;
        }
        return;
      }
      
      // 调用注册 API
      const registerResponse = await fetch(`http://127.0.0.1:${controlPort}/api/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-F2A-Token': config.webhookToken
        },
        body: JSON.stringify({
          name: config.agentName || 'OpenClaw Agent',
          capabilities: (config.agentCapabilities || ['chat', 'task']).map(name => ({
            name,
            version: '1.0.0'
          })),
          webhook: {
            url: `http://127.0.0.1:${config.webhookPort}${config.webhookPath}`,
            token: config.webhookToken
          },
          metadata: {
            platform: 'OpenClaw',
            autoRegistered: true
          }
        }),
        signal: AbortSignal.timeout(5000)
      });
      
      const result = await registerResponse.json() as { success: boolean; agent?: { agentId: string }; error?: string };
      
      if (result.success && result.agent) {
        api.logger?.info(`[F2A] Registered successfully: agentId=${result.agent.agentId}`);
        
        // 保存 agentId 用于注销（在插件停止时）
        // @ts-ignore - 动态添加属性
        config._registeredAgentId = result.agent.agentId;
        return;
      } else {
        api.logger?.error(`[F2A] Registration failed: ${result.error}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryInterval));
          continue;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      api.logger?.warn(`[F2A] Registration attempt ${attempt} failed: ${msg}`);
      
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryInterval));
        continue;
      }
    }
  }
  
  api.logger?.warn('[F2A] Auto-registration failed after max retries, will retry later');
  
  // 设置周期性重试（每 30 秒）
  const retryTimer = setInterval(async () => {
    try {
      await registerToDaemon(api, config);
      clearInterval(retryTimer);
    } catch (err) {
      // 继续重试
    }
  }, 30000);
  
  // @ts-ignore
  config._retryTimer = retryTimer;
}

/**
 * 注销 Agent（在插件停止时）
 */
async function unregisterFromDaemon(
  api: OpenClawPluginApi,
  config: Required<WebhookConfig>
): Promise<void> {
  // @ts-ignore
  const agentId = config._registeredAgentId;
  
  if (!agentId) {
    api.logger?.info('[F2A] No agentId to unregister');
    return;
  }
  
  // 清理重试 timer
  // @ts-ignore
  if (config._retryTimer) {
    clearInterval(config._retryTimer);
  }
  
  const controlPort = config.controlPort || 9001;
  
  try {
    const response = await fetch(`http://127.0.0.1:${controlPort}/api/agents/${agentId}`, {
      method: 'DELETE',
      headers: {
        'X-F2A-Token': config.webhookToken
      },
      signal: AbortSignal.timeout(5000)
    });
    
    const result = await response.json() as { success: boolean; error?: string };
    
    if (result.success) {
      api.logger?.info(`[F2A] Unregistered successfully: ${agentId}`);
    } else {
      api.logger?.warn(`[F2A] Unregister failed: ${result.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    api.logger?.warn(`[F2A] Unregister error: ${msg}`);
  }
}
```

### 错误处理

| 场景 | 处理方式 |
|------|----------|
| Daemon 未启动 | 重试 3 次，然后每 30 秒重试 |
| 注册失败 | 记录日志，设置周期性重试 |
| 网络错误 | 重试机制 |
| Token 无效 | 记录错误，提示用户检查配置 |
| 注销失败 | 记录警告，不影响插件停止 |

### 服务生命周期

```typescript
// register() - 同步注册插件
export default function register(api: OpenClawPluginApi) {
  api.registerService?.({
    id: 'f2a-webhook-service',
    start: async () => {
      // 启动 webhook listener
      await startWebhookListener(api, config);
      // 自动注册（内置在 startWebhookListener 中）
    },
    stop: async () => {
      // 注销 Agent
      await unregisterFromDaemon(api, config);
      // 关闭 HTTP server
    }
  });
}
```

### 实现优先级

| 优先级 | 任务 | 预估时间 |
|--------|------|----------|
| P0 | 实现 registerToDaemon() | 1h |
| P0 | 实现 unregisterFromDaemon() | 0.5h |
| P0 | 添加配置参数支持 | 0.5h |
| P1 | 添加周期性重试机制 | 0.5h |
| P1 | 添加健康检查 | 0.5h |
| P2 | 添加单元测试 | 1h |

**总预估时间**：3.5h

---

## Agent Identity 持久化机制 (2026-04-15 新增)

### 背景

**问题发现**：插件每次重启都会生成新的 AgentId，导致身份丢失。

**问题流程**：
```
插件第一次启动
    ↓
POST /api/agents { name: "OpenClaw Agent" }
    ↓
daemon 生成 AgentId: agent:12D3KooWabc:12345678
    ↓
插件收到 agentId，但没有保存
    ↓
插件重启
    ↓
POST /api/agents { name: "OpenClaw Agent" }  // 又注册一次
    ↓
daemon 生成新的 AgentId: agent:12D3KooWabc:87654321  ❌ 新 ID！
    ↓
身份丢失！之前建立的关系/信誉全部失效
```

### 解决方案对比

| 方案 | 实现方式 | 优点 | 缺点 |
|------|----------|------|------|
| **A: 插件保存 AgentId** | 插件文件存储 agentId | 简单、快 | 需改 daemon API |
| **B: name + peerId 查找** | daemon 查同名恢复 | 不需改插件 | name 可能冲突 |
| **C: Agent Identity 文件** | 独立身份文件系统 | 架构一致、安全 | 实现复杂 |

### 选择方案：方案 C（Agent Identity 文件）

**理由**：
1. **架构一致性**：与 Node Identity 设计一致
2. **多 Agent 支持**：天然支持多个 Agent
3. **安全性更好**：签名 + 可选加密
4. **便于备份迁移**：独立文件可单独备份

### Agent Identity 文件设计

**存储位置**：
```
~/.f2a/agent-identities/
  ├── agent:12D3KooWabc:12345678.json  # Agent A
  └── agent:12D3KooWabc:87654321.json  # Agent B
```

**文件内容**：
```json
{
  "agentId": "agent:12D3KooWabc:12345678",
  "name": "OpenClaw Agent",
  "peerId": "12D3KooWabc...",
  "signature": "base64-signature",
  "webhook": {
    "url": "http://127.0.0.1:9002/f2a/webhook",
    "token": "optional-token"
  },
  "capabilities": ["chat", "task"],
  "metadata": {
    "platform": "OpenClaw",
    "version": "2026.4.5"
  },
  "createdAt": "2026-04-15T14:00:00Z",
  "lastActiveAt": "2026-04-15T22:00:00Z"
}
```

**文件命名规则**：
- 文件名 = `agentId` + `.json`
- 自动从 agentId 提取（无需用户指定）

### 实现流程

#### 1. daemon 启动时加载 Agent Identity 文件

```typescript
// packages/daemon/src/agent-identity-store.ts

class AgentIdentityStore {
  private agentsDir: string;
  private agents: Map<string, AgentIdentity> = new Map();
  
  constructor(dataDir: string) {
    this.agentIdentitiesDir = join(dataDir, 'agent-identities');
  }
  
  /**
   * 启动时加载所有 Agent Identity 文件
   */
  async loadAll(): Promise<void> {
    if (!existsSync(this.agentsDir)) {
      mkdirSync(this.agentsDir, { recursive: true });
      return;
    }
    
    const files = readdirSync(this.agentsDir)
      .filter(f => f.endsWith('.json') && f.startsWith('agent:'));
    
    for (const file of files) {
      try {
        const content = readFileSync(join(this.agentsDir, file), 'utf-8');
        const identity = JSON.parse(content) as AgentIdentity;
        
        // 验证签名
        if (this.verifySignature(identity)) {
          this.agents.set(identity.agentId, identity);
          logger.info('Agent identity loaded', { agentId: identity.agentId });
        } else {
          logger.warn('Agent identity invalid, skipping', { file });
        }
      } catch (err) {
        logger.error('Failed to load agent identity', { file, error: err });
      }
    }
  }
  
  /**
   * 验证签名
   */
  verifySignature(identity: AgentIdentity): boolean {
    // 用节点的公钥验证签名
    // 签名内容 = agentId
    return verifySignature(identity.agentId, identity.signature, this.publicKey);
  }
  
  /**
   * 保存 Agent Identity 文件
   */
  async save(identity: AgentIdentity): Promise<void> {
    const filePath = join(this.agentsDir, `${identity.agentId}.json`);
    writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf-8');
    logger.info('Agent identity saved', { agentId: identity.agentId, path: filePath });
  }
  
  /**
   * 更新 webhook
   */
  async updateWebhook(agentId: string, webhook: AgentWebhook): Promise<void> {
    const identity = this.agents.get(agentId);
    if (!identity) {
      throw new Error('Agent not found');
    }
    identity.webhook = webhook;
    identity.lastActiveAt = new Date().toISOString();
    await this.save(identity);
  }
}
```

#### 2. daemon API 支持恢复身份

```typescript
// POST /api/agents
{
  name: "OpenClaw Agent",
  agentId?: "agent:xxx",  // 可选：已有 AgentId
  webhook: { url: "..." }
}

// daemon 处理逻辑
handleRegisterAgent(req, res) {
  const data = parseBody(req);
  
  // 如果提供了已有 agentId
  if (data.agentId) {
    const existing = this.identityManager.get(data.agentId);
    
    if (existing) {
      // 恢复身份：更新 webhook、活跃时间
      await this.identityManager.updateWebhook(data.agentId, data.webhook);
      
      // 同步到 AgentRegistry 和 MessageRouter
      this.agentRegistry.restore(existing);
      this.messageRouter.createQueue(data.agentId);
      
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, agent: existing }));
      return;
    }
  }
  
  // 没有提供或不存在 → 新注册
  const newAgent = this.agentRegistry.register({
    name: data.name,
    capabilities: data.capabilities,
    webhook: data.webhook,
    metadata: data.metadata
  });
  
  // 保存 Agent Identity 文件
  await this.identityManager.save({
    agentId: newAgent.agentId,
    name: newAgent.name,
    peerId: newAgent.peerId,
    signature: newAgent.signature,
    webhook: newAgent.webhook,
    capabilities: newAgent.capabilities,
    metadata: newAgent.metadata,
    createdAt: newAgent.registeredAt.toISOString(),
    lastActiveAt: new Date().toISOString()
  });
  
  res.writeHead(201);
  res.end(JSON.stringify({ success: true, agent: newAgent }));
}
```

#### 3. 插件保存 Agent Identity

```typescript
// packages/openclaw-f2a/src/agent-identity.ts

const F2A_AGENT_DIR = join(homedir(), '.f2a', 'agent-identities');

/**
 * 读取已保存的 Agent Identity
 */
function readAgentIdentity(): AgentIdentity | null {
  const files = readdirSync(F2A_AGENT_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('agent:'));
  
  // 找到属于当前节点的 Agent
  for (const file of files) {
    const content = readFileSync(join(F2A_AGENT_DIR, file), 'utf-8');
    const identity = JSON.parse(content);
    
    // 检查 metadata 是否匹配当前平台
    if (identity.metadata?.platform === 'OpenClaw') {
      return identity;
    }
  }
  
  return null;
}

/**
 * 自动注册或恢复 Agent
 */
async function registerOrRestore(api: OpenClawPluginApi, config: WebhookConfig): Promise<AgentIdentity> {
  // 检查是否有已保存的 Agent Identity
  const saved = readAgentIdentity();
  
  if (saved) {
    // 恢复身份
    const result = await registerToDaemon(api, config, saved.agentId);
    if (result.success) {
      api.logger?.info('[F2A] Agent identity restored', { agentId: saved.agentId });
      return result.agent;
    }
  }
  
  // 新注册
  const result = await registerToDaemon(api, config);
  if (result.success) {
    api.logger?.info('[F2A] New agent registered', { agentId: result.agent.agentId });
    return result.agent;
  }
  
  throw new Error('Failed to register agent');
}
```

### Agent Identity CLI 命令

```bash
# 导出 Agent Identity
f2a agent export <agentId> --output ~/backup/my-agent.json

# 导入 Agent Identity
f2a agent import ~/backup/my-agent.json

# 列出所有 Agent Identity
f2a agent list --with-identity

# 删除 Agent Identity
f2a agent delete <agentId>
```

### 安全考虑

| 场景 | 处理 |
|------|------|
| **身份文件被复制** | 签名验证失败（peerId 不匹配） |
| **daemon 重启** | 自动加载所有 identity 文件 |
| **插件重启** | Challenge-Response 验证后恢复 |
| **多 Agent 场景** | 每个 Agent 独立文件 |
| **备份迁移** | 导出单个 identity 文件 |

---

## Challenge-Response + Token 轮换机制 (2026-04-15 新增)

### 背景

**静态 token 的风险**：
- token 文件被复制 → 任何人都能冒充
- token 永不变化 → 泄露后永久有效
- 无法检测“真正的 Agent”

### 解决方案：Challenge-Response 验证

**核心设计**：类似 TLS session resumption 或 OAuth refresh token

**每次恢复身份时**：
1. daemon 发送随机 nonce（挑战）
2. Agent 用节点私钥签名 nonce（响应）
3. daemon 验证签名 → 确认是真正的 Agent
4. 生成新的 session token（轮换）

### Agent Identity 文件（增强版）

```json
{
  "agentId": "agent:12D3KooWabc:12345678",
  "name": "OpenClaw Agent",
  "peerId": "12D3KooWabc...",
  "signature": "base64-signature",
  
  // 🔑 E2EE 公钥（用于验证 Agent 的响应）
  "e2eePublicKey": "base64-public-key",
  
  "webhook": {
    "url": "http://127.0.0.1:9002/f2a/webhook"
  },
  
  // 🔑 Session token（每次恢复时轮换）
  "sessionToken": "current-session-token",
  "sessionCreatedAt": "2026-04-15T22:00:00Z",
  
  "capabilities": ["chat", "task"],
  "createdAt": "2026-04-15T14:00:00Z",
  "lastActiveAt": "2026-04-15T22:00:00Z"
}
```

### 实现流程

#### 1️⃣ 首次注册（生成 E2EE 公钥）

```typescript
// daemon: 首次注册
handleRegisterAgent(req, res) {
  const data = parseBody(req);
  
  // 生成 agentId
  const agentId = generateAgentId();
  
  // 签名 agentId
  const signature = sign(agentId, this.nodePrivateKey);
  
  // 🔑 获取节点的 E2EE 公钥（已有）
  const e2eePublicKey = this.e2eeCrypto.getPublicKey();
  
  const agent = {
    agentId,
    name: data.name,
    peerId: this.peerId,
    signature,
    e2eePublicKey,  // ← 包含在 identity 文件中
    webhook: { url: data.webhook.url },
    sessionToken: null  // 首次注册无 session token
  };1
  
  // 保存 identity 文件
  await saveIdentityFile(agent);
  
  res.end(JSON.stringify({ success: true, agent }));
}
```

#### 2️⃣ 重启恢复身份（请求挑战）

```typescript
// POST /api/agents（请求挑战）
handleRegisterAgent(req, res) {
  const data = parseBody(req);
  
  if (data.requestChallenge) {
    // 🔑 生成随机 nonce
    const nonce = generateNonce();  // 随机字符串，例如 UUID
    
    // 存储 nonce（等待响应）
    this.pendingChallenges.set(data.agentId, {
      nonce,
      webhook: data.webhook,
      timestamp: Date.now()
    });
    
    // 返回挑战
    res.end(JSON.stringify({ 
      challenge: true,
      nonce,
      expiresIn: 60  // 60 秒内必须响应
    }));
    return;
  }
  
  // 正常注册逻辑...
}
```

#### 3️⃣ 插件签名 nonce

```typescript
// 插件：读取 identity 文件
const identity = readIdentityFile();

// 请求恢复身份（请求挑战）
const challengeReq = await fetch('http://127.0.0.1:9001/api/agents', {
  method: 'POST',
  body: JSON.stringify({
    agentId: identity.agentId,
    webhook: { url: 'http://127.0.0.1:9002/f2a/webhook' },
    requestChallenge: true  // ← 告诉 daemon 发送 nonce
  })
});

// daemon 返回 nonce
const { nonce } = challengeReq;

// 🔑 用节点私钥签名 nonce
const nodePrivateKey = readNodePrivateKey();  // 从 ~/.f2a/node-identity.json
const nonceSignature = sign(nonce, nodePrivateKey);

// 发送响应（签名）
const responseReq = await fetch('http://127.0.0.1:9001/api/agents/verify', {
  method: 'POST',
  body: JSON.stringify({
    agentId: identity.agentId,
    nonce,
    nonceSignature,  // ← 签名证明“我是真正的 Agent”
    webhook: { url: '...' }
  })
});

// daemon 返回新 session token
const { sessionToken } = responseReq;
```

#### 4️⃣ daemon 验证签名

```typescript
// POST /api/agents/verify（验证响应）
handleVerifyAgent(req, res) {
  const data = parseBody(req);
  
  // 1️⃣ 检查 nonce 是否存在
  const pending = this.pendingChallenges.get(data.agentId);
  if (!pending || pending.nonce !== data.nonce) {
    return error('Invalid nonce');
  }
  
  // 2️⃣ 检查 nonce 是否过期
  if (Date.now() - pending.timestamp > 60000) {
    return error('Nonce expired');
  }
  
  // 3️⃣ 加载 identity 文件
  const identity = loadIdentityFile(data.agentId);
  if (!identity) {
    return error('Identity not found');
  }
  
  // 🔑 4️⃣ 验证 nonce 签名（用 E2EE 公钥）
  const isValid = verifySignature(
    data.nonce,
    data.nonceSignature,
    identity.e2eePublicKey  // ← identity 文件中的公钥
  );
  
  if (!isValid) {
    return error('Signature verification failed - not the same agent');
  }
  
  // ✅ 5️⃣ 验证通过：生成新 session token
  const sessionToken = generateToken();
  
  // 6️⃣ 更新 identity
  identity.sessionToken = sessionToken;
  identity.sessionCreatedAt = Date.now();
  identity.webhook = pending.webhook;
  identity.lastActiveAt = new Date();
  
  await saveIdentityFile(identity);
  
  // 7️⃣ 清理 pending challenge
  this.pendingChallenges.delete(data.agentId);
  
  // 8️⃣ 返回新 token
  res.end(JSON.stringify({
    success: true,
    verified: true,
    sessionToken,  // ← 新 token
    expiresIn: 3600  // token 有效期（可选）
  }));
}
```

### 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│ 首次注册                                                      │
└─────────────────────────────────────────────────────────────┘
        插件 → POST /api/agents { name, webhook }
                            ↓
        daemon 生成 agentId + signature + e2eePublicKey
                            ↓
        daemon 保存 identity 文件（含 E2EE 公钥）
                            ↓
        daemon 返回 { agentId }
                            ↓
        插件保存 identity 文件

┌─────────────────────────────────────────────────────────────┐
│ 重启恢复身份                                  │
└─────────────────────────────────────────────────────────────┘
        插件读取 identity 文件
                            ↓
        POST /api/agents { 
          agentId, 
          requestChallenge: true  ← 请求挑战
        }
                            ↓
        daemon 生成随机 nonce
                            ↓
        daemon 返回 { nonce, expiresIn: 60s }
                            ↓
        插件用节点私钥签名 nonce
                            ↓
        POST /api/agents/verify { 
          agentId, 
          nonce, 
          nonceSignature  ← 签名证明身份
        }
                            ↓
        daemon 用 E2EE 公钥验证签名
                            ↓
        ✅ 验证通过 → 生成新 session token
        ❌ 验证失败 → 拒绝（防止冒充）
                            ↓
        daemon 返回 { sessionToken }
                            ↓
        插件可选保存新 token
```

### 安全性对比

| 场景 | 静态 token | Challenge-Response + Token 轮换 |
|------|------------|--------------------------------|
| **token 文件被复制** | ❌ 任何人可冒充 | ✅ 需要私钥签名 nonce |
| **token 泄露** | ❌ 永久有效 | ✅ 下次恢复时生成新 token |
| **其他进程冒充** | ❌ 只要有 token | ✅ 需要节点私钥 |
| **中间人攻击** | ❌ 可能 | ✅ nonce 防重放 |
| **节点私钥泄露** | ❌ 全部失效 | ❌ 全部失效（这是根本） |

### Token 轮换机制

**session token 的作用**：
- 用于后续 API 调用（发送消息等）
- 每次恢复身份时重新生成
- 有效期可选（例如 1 小时）

**为什么不持久化 session token？**
- 每次重启都需要重新验证
- 类似登录：每次登录都生成新 session
- 即使 token 泄露，下次恢复时也会轮换

### 验证维度总结

| 验证项 | 内容 | 作用 |
|--------|------|------|
| **peerId 前缀** | agentId.peerIdPrefix === daemon.peerId | 确保是本节点签发 |
| **signature** | verify(agentId, signature, nodePublicKey) | 确保 identity 文件有效 |
| **nonce 签名** | verify(nonce, nonceSignature, e2eePublicKey) | 确保是真正的 Agent |
| **nonce 有效期** | timestamp < 60s | 防止重放攻击 |

### 实现优先级

| 优先级 | 任务 | 预估时间 |
|--------|------|----------|
| P0 | Challenge-Response API 实现 | 2h |
| P0 | nonce 签名验证 | 1h |
| P0 | 插件 Challenge-Response 流程 | 1h |
| P1 | session token 轮换 | 0.5h |
| P1 | token 有效期管理 | 0.5h |
| P2 | 完整安全测试 | 1h |

**Challenge-Response 总时间**：6h

### 实现优先级

| 优先级 | 任务 | 预估时间 |
|--------|------|----------|
| P0 | AgentIdentityStore 实现 | 2h |
| P0 | daemon API 支持恢复身份 | 1h |
| P0 | 插件保存/恢复 Agent Identity | 1h |
| P1 | Agent Identity CLI 命令 | 1h |
| P1 | 签名验证完善 | 0.5h |
| P2 | 导出/导入测试 | 0.5h |

**总预估时间**：6h

### 与 Node Identity 的对比

| 特性 | Node Identity | Agent Identity |
|------|---------------|----------------|
| 存储位置 | ~/.f2a/node-identity.json | ~/.f2a/agent-identities/*.json |
| 签发者 | libp2p | daemon（节点） |
| 签名内容 | peerId | agentId |
| 数量 | 每节点 1 个 | 每节点可多个 |
| 用途 | P2P 通信身份验证 | Agent 身份持久化 |

---

## Agent 级 Webhook 设计 (2026-04-15 新增)

### Webhook 设置时机说明

> **重要**: webhook 配置在 Agent **register** 时设置，而非 init 时。
> 此设计与 RFC008 的 Agent Self-Identity 模型一致。

**设置时机对比**:

| 阶段 | 操作 | 是否设置 webhook | 说明 |
|------|------|------------------|------|
| `f2a agent init` | 生成密钥对 | ❌ 不设置 | 仅创建身份，webhook 是运行时配置 |
| `f2a agent register` | 注册到 Daemon | ✅ 设置 webhook | 指定消息接收端点 |
| `f2a agent update` | 更新信息 | ❌ 不修改 webhook | 仅修改 name 等元数据 |

**与 RFC008 的关联**:

1. **身份生成与注册分离** (RFC008 核心):
   - init: Agent 生成自有密钥对，获得 AgentId（公钥指纹）
   - register: 向 Daemon 注册，设置 webhook URL

2. **webhook 是运行时配置**:
   - 不同环境可使用不同的 webhook URL
   - 同一 Agent 可在不同设备注册不同 webhook
   - webhook 变化不影响 AgentId（身份不变）

3. **CLI 命令示例** (RFC008 定义):
   ```bash
   # init 不设置 webhook
   f2a agent init --name "猫咕噜"
   # 输出: AgentId: agent:a3b2c1d4e5f67890 (公钥指纹)
   
   # register 设置 webhook
   f2a agent register --webhook "http://127.0.0.1:9002/webhook"
   ```

**RFC004 与 RFC008 的协作**:

- RFC004 定义了 webhook 的数据结构 (`AgentWebhook`) 和路由机制
- RFC008 定义了 webhook 的设置时机（register 时）和身份验证
- 两者共同构成了完整的 Agent webhook 架构

详见: [RFC 008: Agent Self-Identity](./008-agent-self-identity.md)

### 背景

**问题**：一个 f2a daemon 可以注册多个 agent，每个 agent 都应该有自己的 webhook

**当前设计（全局 webhook）**：
```
daemon 配置一个 webhook URL
所有消息 → 同一个 webhook → 插件统一处理
```

**问题**：
- 无法区分不同 agent
- 所有 agent 共用一个 webhook 入口

### 改进设计（方案 A：单端口 + Agent ID 路径）

```
每个 Agent 注册时配置自己的 webhook URL
daemon 根据 toAgentId 选择对应的 webhook
```

**架构变化**：

| 项目 | 当前 | 改进后 |
|------|------|--------|
| webhook 配置位置 | daemon 全局配置 | Agent 注册时携带 |
| webhook 数量 | 1 个 | 每个 Agent 1 个 |
| 转发逻辑 | 统一转发 | 按 AgentId 路由 |

### AgentWebhook 接口定义 (RFC 004 实现详情)

**AgentWebhook 接口** (定义于 `agent-registry.ts`):

```typescript
export interface AgentWebhook {
  /** Webhook URL - 推送消息的目标地址 */
  url: string;
  /** 认证 Token（可选）- 用于 webhook 请求的身份验证 */
  token?: string;
}
```

**AgentRegistration 结构** (包含 webhook 字段):

```typescript
export interface AgentRegistration {
  /** Agent 唯一标识符（节点签发）格式: agent:<PeerId前16位>:<随机8位> */
  agentId: string;
  /** Agent 显示名称 */
  name: string;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** 签发节点的 PeerId */
  peerId: string;
  /** AgentId 签名（Base64） */
  signature: string;
  /** 注册时间 */
  registeredAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** Webhook 配置（RFC 004: Agent 级 Webhook） */
  webhook?: AgentWebhook;
  /** 本地消息回调（用于直接推送消息给本地 Agent） */
  onMessage?: MessageCallback;
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
}
```

### API 变化记录

**1. AgentRegistration.webhookUrl → AgentRegistration.webhook**

```typescript
// 旧版本（已废弃）
interface AgentRegistration {
  webhookUrl?: string  // 单一 URL 字段
}

// 新版本（RFC 004）
interface AgentRegistration {
  webhook?: AgentWebhook  // 结构化配置对象
}
```

**2. register(agentId, name) → register(agentId, name, webhook?)**

```typescript
// 旧版本（已废弃）
register(agentId: string, name: string): Result<void>

// 新版本（RFC 004）
register(request: AgentRegistrationRequest): AgentRegistration
// AgentRegistrationRequest 包含可选的 webhook 参数
interface AgentRegistrationRequest {
  name: string;
  capabilities: AgentCapability[];
  webhook?: AgentWebhook;  // 可选
  onMessage?: MessageCallback;  // 可选
}
```

**3. route() → routeAsync()（推荐使用）**

```typescript
// 同步版本（不包含 webhook 转发）
route(message: RoutableMessage): boolean
// 仅支持本地回调 + 消息队列

// 异步版本（RFC 004 推荐）
async routeAsync(message: RoutableMessage): Promise<boolean>
// 支持完整路由优先级：本地回调 > Agent webhook > 消息队列
```

### routeAsync() 路由优先级说明 (RFC 004 实现详情)

**路由优先级**（定义于 `message-router.ts`）:

```typescript
/**
 * RFC 004: 路由消息到特定 Agent（异步版本）
 *
 * 路由优先级:
 * 1. 本地回调 - 最快，直接推送（同进程内 Agent）
 * 2. Agent webhook URL - 远程 Agent 立即推送（HTTP webhook）
 * 3. 消息队列 - HTTP 轮询方式（降级兜底）
 */
async routeAsync(message: RoutableMessage): Promise<boolean> {
  // 优先级 1: 本地回调
  if (targetAgent.onMessage) {
    try {
      targetAgent.onMessage({...message});
      return true; // 成功，无需后续处理
    } catch (err) {
      // 回调失败，继续尝试 webhook 或队列
    }
  }

  // 优先级 2: Agent webhook
  if (targetAgent.webhook?.url) {
    const result = await this.forwardToAgentWebhook(message, targetAgent);
    if (result.success) return true;
    // Webhook 失败，降级到队列
  }

  // 优先级 3: 消息队列
  const queue = this.queues.get(toAgentId);
  queue.messages.push(message);
  return true;
}
```

**为什么推荐使用 routeAsync():**

| 场景 | route() | routeAsync() |
|------|---------|--------------|
| 本地 Agent | ✅ 支持 | ✅ 支持 |
| 远程 Agent（webhook） | ❌ 不支持 | ✅ 支持 |
| Webhook 失败降级 | ❌ 不支持 | ✅ 自动降级 |
| 广播消息 | ✅ 同步 | ✅ 异步（含 webhook） |

**MessageRouter 转发逻辑**:

```typescript
// 同步版本（不包含 webhook）
route(message: RoutableMessage): boolean {
  // 仅处理本地回调 + 消息队列
}

// 异步版本（RFC 004 推荐）
async routeAsync(message: RoutableMessage): Promise<boolean> {
  const agent = this.registry.get(message.toAgentId);
  if (!agent) {
    return false; // AGENT_NOT_FOUND
  }

  // 按 AgentId 路由到对应的 webhook
  if (agent.webhook?.url) {
    await this.forwardToAgentWebhook(message, agent);
  }
}
```

### forwardToAgentWebhook() 降级逻辑说明 (RFC 004 实现详情)

**降级逻辑**（定义于 `message-router.ts`）:

```typescript
/**
 * RFC 004: Agent 级 Webhook 转发
 * 失败时自动降级到消息队列
 */
private async forwardToAgentWebhook(
  message: RoutableMessage,
  targetAgent: AgentRegistration
): Promise<{ success: boolean; error?: string }> {
  // 1. 检查 webhook 配置
  if (!targetAgent.webhook?.url) {
    return { success: false, error: 'Agent has no webhook URL configured' }; // 降级到队列
  }

  // 2. 构造 webhook 载荷
  const payload: AgentWebhookPayload = {
    messageId: message.messageId,
    fromAgentId: message.fromAgentId,
    toAgentId: message.toAgentId || '',
    content: message.content,
    type: message.type,
    createdAt: message.createdAt.toISOString(),
    metadata: message.metadata,
  };  

  // 3. 使用缓存的 WebhookService 实例
  let webhookService = this.webhookServices.get(targetAgent.agentId);
  if (!webhookService) {
    // 创建新的 WebhookService
    const webhookConfig: WebhookConfig = {
      url: targetAgent.webhook.url,
      token: targetAgent.webhook.token || targetAgent.agentId, // 默认使用 AgentId
      timeout: 5000,
      retries: 2,
      retryDelay: 500,
    };    
    webhookService = new WebhookService(webhookConfig);
    this.webhookServices.set(targetAgent.agentId, webhookService);
  }

  // 4. 发送消息到 webhook
  const result = await webhookService.send({...payload});
  if (!result.success) {
    // Webhook 失败，降级到消息队列
    this.logger.warn('Agent webhook forwarding failed, falling back to queue', {
      toAgentId,
      error: result.error,
    });
  }

  return result;
}
```

**降级场景说明**:

| 场景 | 处理方式 | 最终结果 |
|------|----------|----------|
| Webhook URL 未配置 | 直接跳过，进入队列 | 消息入队 |
| Webhook 请求超时 | 重试 2 次，失败后入队 | 消息入队 |
| Webhook 返回错误 | 记录日志，入队 | 消息入队 |
| Webhook URL 无效 | HTTP 错误，入队 | 消息入队 |
| Agent 不存在 | 返回 false | 路由失败 |

**降级保障机制**:

1. **队列溢出保护**: 队列满时移除最旧消息，防止内存溢出
2. **重试机制**: WebhookService 默认重试 2 次
3. **缓存管理**: Agent 注销时自动清理 webhook 缓存 (`clearWebhookCache()`)
4. **日志追踪**: 所有降级操作都有详细日志记录

### Webhook URL 安全验证说明 (RFC 004 实现详情)

**URL 格式验证**（推荐格式）:

```typescript
// 推荐 URL 格式
const webhookUrl = 'http://127.0.0.1:9002/f2a/webhook/agent:12D3KooWHxWdn';

// URL 组成部分
// - 协议: http/https
// - 地址: 127.0.0.1 或域名
// - 端口: 9002（默认）
// - 路径: /f2a/webhook/agent:<AgentId前16位>
```

**安全验证要点**:

1. **Token 认证**:
   ```typescript
   // Agent webhook 配置
   webhook: {
     url: 'http://127.0.0.1:9002/f2a/webhook/agent:abc123',
     token: 'webhook-token-abc123'  // 可选，用于身份验证
   }
   
   // WebhookService 使用 token
   // - 如果未配置 token，默认使用 AgentId 作为认证标识
   // - HTTP 请求携带 Authorization: Bearer <token>
   ```

2. **AgentId 格式验证**（`agent-registry.ts`）:
   ```typescript
   /**
    * 验证 AgentId 签名
    * 安全限制（当前实现）:
    * - 仅检查格式和 PeerId 前缀匹配
    * - 完整签名验证未实现（需要其他节点的公钥）
    * - 采用 fail-safe 策略：验证失败时拒绝，而非放行
    */
   verifySignature(agentId: string, signature: string, peerId: string): boolean {
     // 检查 AgentId 格式
     if (!agentId.startsWith('agent:')) {
       return false; // Invalid format
     }

     // 检查 PeerId 前缀匹配
     const peerIdPrefix = agentId.split(':')[1];
     if (peerId && !peerId.startsWith(peerIdPrefix)) {
       return false; // PeerId mismatch
     }

     // Fail-safe: 签名验证未完全实现，拒绝不可信的 AgentId
     return false; // 安全原则：fail safe, not fail open!
   }
   ```

3. **JSON.parse 安全防护**:
   ```typescript
   // 安全 JSON.parse：过滤危险 key，防止 prototype pollution
   JSON.parse(content, (key, value) => {
     if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
       return undefined; // Block dangerous keys
     }     
     return value;
   });
   ```

4. **WebhookService 缓存安全**:
   ```typescript
   // Agent 注销时清理缓存
   clearWebhookCache(agentId: string): void {
     this.webhookServices.delete(agentId);
   }
   ```

**安全建议**:

- 使用 HTTPS 协议（生产环境）
- 配置强 token（避免使用 AgentId 作为默认 token）
- 定期更新 webhook token
- 监控 webhook 失败日志
- 配置合理的 timeout（默认 5s）

### 配置示例 (RFC 004 使用指南)

**Agent 注册时配置 webhook**（完整示例）:

```typescript
// 方式 1: 使用 AgentRegistrationRequest 注册
import { AgentRegistry } from '@f2a/network';

const registry = new AgentRegistry(peerId, signFunction);

const registration = registry.register({
  name: '猫咕噜',
  capabilities: [{ name: 'chat', description: 'AI chat' }],
  webhook: {
    url: 'http://127.0.0.1:9002/f2a/webhook/agent:12D3KooWHxWdn',
    token: 'webhook-token-abc123', // 可选
  },
  metadata: { 
    version: '1.0',
    timeout: 60000, // webhook 超时时间（ms）
  },
});

console.log(`Agent registered: ${registration.agentId}`);
console.log(`Webhook URL: ${registration.webhook?.url}`);
console.log(`Token: ${registration.webhook?.token}`);
```

**CLI 注册示例**（带 webhook 参数）:

```bash
# f2a CLI 注册 Agent
f2a register --name "猫咕噜" \
  --capability "chat:AI chat" \
  --webhook-url "http://127.0.0.1:9002/f2a/webhook/agent:12D3KooWHxWdn" \
  --webhook-token "webhook-token-abc123"

# 输出
# Agent registered: agent:12D3KooWHxWdn:abc123
# Webhook URL: http://127.0.0.1:9002/f2a/webhook/agent:12D3KooWHxWdn
# Token: webhook-token-abc123
```

**Webhook 接收端配置**:

```typescript
// OpenClaw 插件 webhook 接收
// packages/openclaw-f2a/src/plugin.ts

async function startWebhookListener(api: OpenClawPluginApi, config: WebhookConfig) {
  // HTTP server 监听 9002 端口
  server.listen(config.webhookPort, '127.0.0.1');

  // 路由处理
  server.on('request', (req, res) => {
    // 解析路径：/f2a/webhook/agent:<id>
    const match = req.url.match(/^\/f2a\/webhook\/agent:([a-f0-9]+)$/);
    if (!match) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    // 验证 token
    const authHeader = req.headers['authorization'];
    if (!verifyToken(authHeader, config.webhookToken)) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    // 解析 payload
    const payload = JSON.parse(body);
    // payload 结构: { messageId, fromAgentId, toAgentId, content, type, createdAt }

    // 调用 Agent
    invokeAgent(api, sessionKey, payload.content, config.agentTimeout);
  });
}
```

### 降级场景说明 (RFC 004 故障处理)

**降级场景表格**:

| 场景 | 触发条件 | 处理流程 | 最终结果 |
|------|----------|----------|----------|
| **Webhook URL 未配置** | `agent.webhook?.url` 为空 | 直接跳过 webhook，消息入队 | 消息进入队列，等待 HTTP 轮询 |
| **Webhook 请求超时** | HTTP 请求超过 5s | 重试 2 次 → 失败 → 入队 | 消息入队，日志记录超时 |
| **Webhook 返回错误** | HTTP 4xx/5xx | 记录错误 → 入队 | 消息入队，日志记录错误码 |
| **Webhook URL 无效** | DNS 解析失败/连接失败 | HTTP 错误 → 重试 → 入队 | 消息入队，日志记录异常 |
| **Agent 不存在** | `toAgentId` 未注册 | 返回 `false` | 路由失败，消息丢弃 |
| **本地回调失败** | `onMessage` 抛出异常 | 捕获异常 → 尝试 webhook | Webhook 成功则投递，否则入队 |
| **队列溢出** | 队列已满（100 条） | 移除最旧消息 → 入队新消息 | 消息入队，最旧消息丢失 |

**降级日志示例**:

```typescript
// Webhook 失败降级日志
{
  level: 'WARN',
  message: 'Agent webhook forwarding failed, falling back to queue',
  toAgentId: 'agent:12D3KooWHxWdn:abc123',
  error: 'TimeoutError: Request timeout after 5000ms',
  queueSize: 42,
}

// 队列溢出日志
{
  level: 'WARN',
  message: 'Queue overflow, removed oldest message',
  toAgentId: 'agent:12D3KooWHxWdn:abc123',
  queueSize: 100,
  removedMessageId: 'msg-12345',
}
```

**故障恢复建议**:

1. **监控 webhook 失败率**: 设置告警阈值（如失败率 > 10%）
2. **定期清理过期消息**: 使用 `cleanupExpired(maxAgeMs)` 清理过期消息
3. **Agent 注销清理**: Agent 注销时自动清理队列和 webhook 缓存
4. **日志聚合分析**: 收集降级日志，分析故障模式

### 插件路由实现

**方案 A：单端口 + Agent ID 路径**

```typescript
// HTTP server 监听 9002
server.listen(9002, '127.0.0.1')

// 路由处理
server.on('request', (req, res) => {
  // 解析路径：/f2a/webhook/agent:<id>
  const match = req.url.match(/^\/f2a\/webhook\/agent:([a-f0-9]+)$/)
  if (!match) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  
  const agentIdPrefix = match[1]  // e.g., "abc123" (前16位)
  
  // 查找对应的 Agent session
  const sessionKey = `f2a-webhook-${agentIdPrefix}`
  
  // 调用 Agent
  invokeAgent(api, sessionKey, message)
})
```

**Webhook URL 格式**：
```
http://127.0.0.1:9002/f2a/webhook/agent:12D3KooWHxWdn  (AgentId 前16位)
```

### 优势

| 改进 | 好处 |
|------|------|
| Agent 独立 webhook | 每个 Agent 可配置不同的处理逻辑 |
| 灵活路由 | daemon 按 AgentId 自动转发 |
| 安全隔离 | 每个 Agent 可配置不同的 token |
| 扩展性好 | 新增 Agent 只需注册并配置 webhook |

### 实现计划

| 步骤 | 说明 | 预估时间 |
|------|------|----------|
| 1 | AgentRegistry.register() 添加 webhook 参数 | 0.5h |
| 2 | Agent 数据结构添加 webhook 字段 | 0.5h |
| 3 | MessageRouter 按 AgentId 路由 | 1h |
| 4 | 插件路由解析 Agent ID 路径 | 1h |
| 5 | 测试：Agent 注册 + webhook 配置 | 1h |
| 6 | 测试：daemon 转发到指定 Agent | 1h |
| **总计** | | **5h** |

---

---

## Phase 4 任务清单 (更新)

### 4.1 清理旧测试文件 ✅ 预估 0.5h

```bash
# 删除 49 个旧架构测试
rm packages/openclaw-f2a/tests/*.ts
rm packages/openclaw-f2a/tests/**/*.ts

# 只保留一个简单的 webhook 测试
# packages/openclaw-f2a/tests/webhook.test.ts
```

### 4.2 添加 Webhook 测试 ⚠️ 预估 1h

- 测试 HTTP server 启动
- 测试 token 验证
- 测试 payload 解析
- 测试 Agent 调用（mock）
- 测试 CLI 发送（mock）

### 4.3 验证完整流程 ⚠️ 预估 2h

1. 启动 Gateway + 插件
2. 启动 f2a daemon
3. 发送测试消息
4. 检查 webhook 是否收到
5. 检查 Agent 是否被调用
6. 检查回复是否发送成功

### 4.4 配置文档更新 ⚠️ 预估 0.5h

- 更新 README
- 添加 webhook 配置说明
- 添加 f2a daemon 配置说明

### 4.5 发布 ⚠️ 预估 0.5h

```bash
npm publish @f2a/openclaw-f2a@0.4.1
```

---

## 总时间估算

| 任务 | 预估 |
|------|------|
| **Phase 4: 清理与验证** |
| 4.1 清理旧测试 | 0.5h |
| 4.2 添加测试 | 1h |
| 4.3 验证流程 | 2h |
| 4.4 文档更新 | 0.5h |
| 4.5 发布 | 0.5h |
| **Phase 4 总计** | **4.5h** |
| |
| **Phase 5: 自动注册机制** |
| 5.1 registerToDaemon() 实现 | 1h |
| 5.2 unregisterFromDaemon() 实现 | 0.5h |
| 5.3 配置参数支持 | 0.5h |
| 5.4 周期性重试机制 | 0.5h |
| 5.5 健康检查 | 0.5h |
| 5.6 单元测试 | 1h |
| **Phase 5 总计** | **4h** |
| |
| **Phase 6: Agent Identity 持久化** |
| 6.1 AgentIdentityStore 实现 | 2h |
| 6.2 daemon API 支持恢复身份 | 1h |
| 6.3 插件保存/恢复 Agent Identity | 1h |
| 6.4 Agent Identity CLI 命令 | 1h |
| 6.5 签名验证完善 | 0.5h |
| 6.6 导出/导入测试 | 0.5h |
| **Phase 6 总计** | **6h** |
| |
| **Phase 7: Challenge-Response 验证** |
| 7.1 Challenge-Response API 实现 | 2h |
| 7.2 nonce 签名验证 | 1h |
| 7.3 插件 Challenge-Response 流程 | 1h |
| 7.4 session token 轮换 | 0.5h |
| 7.5 token 有效期管理 | 0.5h |
| 7.6 完整安全测试 | 1h |
| **Phase 7 总计** | **6h** |
| **所有 Phase 总计** | **20.5h** |

---

## 下一步行动

### Phase 4 (当前阶段)
1. ✅ **确认改造方向** - 已确认（改造而非新建）
2. ⚠️ **清理旧测试** - 待执行
3. ⚠️ **添加 webhook 测试** - 待执行
4. ⚠️ **验证完整流程** - 待执行
5. ⚠️ **更新文档并发布** - 待执行

### Phase 5 (自动注册机制)
1. ⚠️ **实现 registerToDaemon()** - daemon API + 插件调用
2. ⚠️ **实现 unregisterFromDaemon()** - 插件停止时注销
3. ⚠️ **添加周期性重试** - daemon 未启动时自动重试
4. ⚠️ **验证完整流程** - 插件重启后身份恢复

### Phase 6 (Agent Identity 持久化)
1. ⚠️ **实现 AgentIdentityStore** - daemon 加载/保存 identity 文件
2. ⚠️ **更新 daemon API** - 支持恢复已有 agentId
3. ⚠️ **更新插件** - 保存/读取 Agent Identity
4. ⚠️ **实现 CLI 命令** - export/import/list/delete
5. ⚠️ **验证多 Agent 场景** - 多个 identity 文件共存

### Phase 7 (Challenge-Response 验证)
1. ⚠️ **实现 Challenge API** - POST /api/agents 返回 nonce
2. ⚠️ **实现 Verify API** - POST /api/agents/verify 验证签名
3. ⚠️ **更新插件流程** - requestChallenge → 签名 nonce → verify
4. ⚠️ **实现 token 轮换** - 每次验证通过生成新 session token
5. ⚠️ **安全测试** - 验证冒充、重放攻击场景

---

## 关键发现

**插件改造已完成，但测试和验证缺失**

- 源码已简化为 708 行（原 5000+ 行）
- 核心流程已实现（webhook + Agent + CLI）
- 但有 49 个旧测试文件需要清理
- 新流程未经实际验证

---

## 配置示例

### f2a daemon 配置

```json
// ~/.f2a/config.json
{
  "webhook": {
    "url": "http://127.0.0.1:9002/f2a/webhook",
    "token": "<webhook-secret>"
  }
}
```

### OpenClaw 插件配置

```json
// openclaw.json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "config": {
          "webhookPath": "/f2a/webhook",
          "webhookPort": 9002,
          "webhookToken": "<webhook-secret>",
          "controlPort": 9001,
          "agentTimeout": 60000
        }
      }
    }
  }
}
```

---

## 参考资料

- [RFC 003: AgentId 签发机制](./003-agentid-issuance.md)
- [RFC 002: CLI Agent Architecture](./002-cli-agent-architecture.md)
- [消息协议](../protocols/message.md)