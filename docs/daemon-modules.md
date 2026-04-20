# F2A Daemon 内部架构

**版本**: 0.6.0  
**日期**: 2026-04-20  
**状态**: RFC 003/007/008 实现

---

## Daemon 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          F2A Daemon 架构                                     │
└─────────────────────────────────────────────────────────────────────────────┘

                        外部请求
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ControlServer                                        │
│                        (HTTP API 服务)                                        │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         路由层                                       │   │
│   │                                                                     │   │
│   │   /health          → 健康检查（无需认证）                            │   │
│   │   /status          → 状态查询                                        │   │
│   │   /peers           → 获取连接节点                                    │   │
│   │   /register-capability → 注册能力                                    │   │
│   │                                                                     │   │
│   │   /api/agents      → Agent 注册管理 (GET/POST/DELETE)                │   │
│   │   /api/messages    → 消息路由 (POST/GET/DELETE)                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         中间件层                                     │   │
│   │                                                                     │   │
│   │   TokenManager ──► 令牌验证                                         │   │
│   │   RateLimiter  ──► 速率限制（60 req/min）                           │   │
│   │   CORS         ──► 跨域控制                                         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└───────────────────────┬─────────────────────────┬───────────────────────────┘
                        │                         │
                        │ 管理                    │ 消息路由
                        ▼                         ▼
┌───────────────────────────────┐   ┌─────────────────────────────────────────┐
│        AgentRegistry          │   │            MessageRouter                 │
│      (Agent 注册管理)          │   │          (消息路由引擎)                  │
│                               │   │                                         │
│  ┌─────────────────────────┐  │   │  ┌─────────────────────────────────────┐│
│  │  Map<agentId, AgentReg> │  │   │  │      消息队列管理                    ││
│  │                         │  │   │  │                                     ││
│  │  - agentId              │◄─┼───┼──│  Map<agentId, MessageQueue>         ││
│  │  - name                 │  │   │  │                                     ││
│  │  - capabilities[]       │  │   │  │  每个队列:                          ││
│  │  - registeredAt         │  │   │  │  - maxSize: 100                     ││
│  │  - lastActiveAt         │  │   │  │  - messages: RoutableMessage[]      ││
│  │  - webhookUrl?          │  │   │  └─────────────────────────────────────┘│
│  │  - metadata?            │  │   │                                         │
│  └─────────────────────────┘  │   │  ┌─────────────────────────────────────┐│
│                               │   │  │      路由策略                        ││
│  功能:                        │   │  │                                     ││
│  ┌─────────────────────────┐  │   │  │  route(message):                    ││
│  │ register()              │  │   │  │    指定目标 → 单播                   ││
│  │ unregister()            │  │   │  │    未指定   → 广播                   ││
│  │ get()                   │  │   │  │                                     ││
│  │ list()                  │  │   │  │  broadcast(message):                 ││
│  │ findByCapability()      │  │   │  │    发送给所有 Agent（排除发送方）    ││
│  │ updateLastActive()      │  │   │  │                                     ││
│  │ cleanupInactive()       │  │   │  │  getMessages(agentId):              ││
│  │ getStats()              │  │   │  │    获取队列中的待处理消息            ││
│  └─────────────────────────┘  │   │  │                                     ││
│                               │   │  │  clearMessages(agentId):             ││
│  统计:                        │   │  │    清除已处理消息                    ││
│  ┌─────────────────────────┐  │   │  │                                     ││
│  │ total: count            │  │   │  │  cleanupExpired(maxAgeMs):          ││
│  │ capabilities: {         │  │   │  │    清理过期消息                    ││
│  │   "code-gen": 3,        │  │   │  │                                     ││
│  │   "data-analysis": 2    │  │   │  └─────────────────────────────────────┘│
│  │ }                       │  │   │                                         │
│  └─────────────────────────┘  │   │  消息类型:                              │
│                               │   │  ┌─────────────────────────────────────┐│
└───────────────────────────────┘   │  │ RoutableMessage:                    ││
                                    │  │  - messageId                        ││
                                    │  │  - fromAgentId                      ││
                                    │  │  - toAgentId?                       ││
                                    │  │  - content                          ││
                                    │  │  - type: message|task_request|...   ││
                                    │  │  - createdAt                        ││
                                    │  └─────────────────────────────────────┘│
                                    └─────────────────────────────────────────┘

                        共享引用
                    (AgentRegistry.list → MessageRouter)

                           │
                           │ 调用
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            F2A Core                                          │
│                        (P2P 网络与能力管理)                                    │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         P2PNetwork                                   │   │
│   │                                                                     │   │
│   │   - libp2p 连接管理                                                 │   │
│   │   - mDNS 节点发现                                                   │   │
│   │   - DHT 路由                                                        │   │
│   │   - 消息收发                                                        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         IdentityManager                              │   │
│   │                                                                     │   │
│   │   NodeIdentityManager ──► PeerID                                   │   │
│   │   AgentIdentityStore ──► AgentID                                 │   │
│   │   IdentityDelegator     ──► Agent 签发                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## AgentRegistry 详细说明

### 职责

AgentRegistry 管理注册到 Daemon 的所有 Agent 实例，维护 Agent 的元数据和活跃状态。

### 数据结构

```typescript
interface AgentRegistration {
  agentId: string;          // Agent 唯一标识符 (RFC 003: 节点签发)
  name: string;             // Agent 显示名称
  capabilities: AgentCapability[];  // Agent 能力列表
  peerId: string;           // 签发节点 PeerId (RFC 003)
  signature: string;        // AgentId 签名 (RFC 003)
  publicKey?: string;       // Agent 公钥 (RFC 008)
  registeredAt: Date;       // 注册时间
  lastActiveAt: Date;       // 最后活跃时间
  webhook?: AgentWebhook;   // Webhook 配置 (RFC 004)
  onMessage?: MessageCallback;  // 本地回调
  metadata?: Record<string, unknown>;  // 自定义元数据
}

// RFC 004: Agent 级 Webhook
interface AgentWebhook {
  url: string;
  token?: string;
}

// RFC 007: Agent Token
type MessageCallback = (message: {
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  type: string;
  createdAt: Date;
}) => void;
```

### AgentId 格式 (RFC 003)

AgentId 由节点签发，用户不能自定义。格式: `agent:<PeerId前16位>:<随机8位>`。

```typescript
// 示例
agentId: "agent:16Qk5eA2xY:8f3a2b1c"
```
```

### 核心方法

| 方法 | 功能 | 说明 |
|------|------|------|
| `register(request)` | 注册 Agent | 节点签发 AgentId，创建 AgentRegistration |
| `registerRFC008(request)` | RFC 008 注册 | 使用公钥注册，支持签名验证 |
| `registerAuto(request)` | 自动选择格式 | 根据 publicKey 存在自动选择注册方式 |
| `unregister(agentId)` | 注销 Agent | 从注册表移除，返回是否成功 |
| `get(agentId)` | 获取 Agent | 返回 AgentRegistration 或 undefined |
| `getAgentFormat(agentId)` | 获取格式类型 | 返回 'old' | 'new' | 'invalid' |
| `list()` | 列出所有 Agent | 返回所有注册的 Agent 数组 |
| `findByCapability(name)` | 按能力查找 | 返回具备指定能力的 Agent 列表 |
| `getPublicKey(agentId)` | 获取公钥 | RFC 008: 返回 Agent 公钥 |
| `updateName(agentId, name)` | 更新名称 | 修改 Agent 显示名称 |
| `updateWebhook(agentId, webhook)` | 更新 Webhook | RFC 004: 配置/清除 Agent webhook |
| `updateLastActive(agentId)` | 更新活跃时间 | 每次消息交互后调用 |
| `verifySignature(...)` | 验证签名 | RFC 003/008: 验证 AgentId 签名 |
| `cleanupInactive(maxMs)` | 清理不活跃 Agent | 超时未活跃的 Agent 自动注销 |
| `getStats()` | 获取统计信息 | 返回总数和各能力的 Agent 数量 |

### 使用场景

```typescript
// 注册 Agent
const agent = registry.register({
  agentId: 'agent-001',
  name: 'CodeBot',
  capabilities: [{ name: 'code-generation', description: '...' }],
  webhookUrl: 'https://example.com/webhook',
});

// 查找具备特定能力的 Agent
const codeAgents = registry.findByCapability('code-generation');

// 清理超过 1 小时未活跃的 Agent
const cleaned = registry.cleanupInactive(60 * 60 * 1000);
```

---

## MessageRouter 详细说明

### 职责

MessageRouter 管理 Agent 之间的消息路由，每个 Agent 有独立的消息队列。

### 数据结构

```typescript
interface RoutableMessage {
  messageId: string;        // 消息唯一 ID
  fromAgentId: string;      // 发送方 Agent ID
  toAgentId?: string;       // 目标 Agent ID（可选）
  content: string;          // 消息内容
  metadata?: Record<string, unknown>;  // 元数据
  type: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  createdAt: Date;          // 创建时间
}

interface MessageQueue {
  agentId: string;          // Agent ID
  messages: RoutableMessage[];  // 消息列表
  maxSize: number;          // 最大队列大小（默认 100）
}
```

### 核心方法

| 方法 | 功能 | 说明 |
|------|------|------|
| `createQueue(agentId)` | 创建消息队列 | Agent 注册时自动调用 |
| `deleteQueue(agentId)` | 删除消息队列 | Agent 注销时自动调用 |
| `route(message)` | 路由消息 | 指定目标则单播，否则广播 |
| `broadcast(message)` | 广播消息 | 发送给所有 Agent（排除发送方） |
| `getMessages(agentId)` | 获取消息 | 返回 Agent 的待处理消息 |
| `clearMessages(agentId, ids?)` | 清除消息 | 清除已处理消息 |
| `cleanupExpired(maxAgeMs)` | 清理过期消息 | 移除超过指定时间的消息 |
| `getStats()` | 获取统计 | 返回队列数量和消息总数 |

### 路由策略

```
消息到达
    │
    ├── 有 toAgentId？
    │       │
    │       ├── YES → 验证目标已注册 → 加入目标队列
    │       │
    │       └── NO → 广播给所有 Agent（排除发送方）
    │
    └── 队列满？
            │
            ├── YES → 移除最旧消息，添加新消息
            │
            └── NO → 直接添加
```

---

## ControlServer 详细说明

### 职责

ControlServer 提供 HTTP API 接口，供 CLI 和第三方应用控制 Daemon。

### API 端点

| 端点 | 方法 | 认证 | 功能 |
|------|------|------|------|
| `/health` | GET | 无 | 健康检查 |
| `/status` | GET | Token | 获取 Daemon 状态 |
| `/peers` | GET | Token | 获取连接的 Peers |
| `/register-capability` | POST | Token | 注册能力 |
| `/agent/update` | POST | Token | 更新 Agent 信息 |
| `/api/agents` | GET | 无 | 列出所有 Agent |
| `/api/agents` | POST | 无 | 注册 Agent (RFC 003 自动签发 AgentId) |
| `/api/agents/:id` | GET | 无 | 获取 Agent 信息 |
| `/api/agents/:id` | DELETE | 无 | 注销 Agent |
| `/api/agents/:id/webhook` | PATCH | 无 | 更新 Agent Webhook (RFC 004) |
| `/api/messages` | POST | 无 | 发送消息 |
| `/api/messages/:id` | GET | 无 | 获取消息队列 |
| `/api/messages/:id` | DELETE | 无 | 清除消息 |

### 中间件

```
请求 → CORS → RateLimiter → TokenValidator → Handler
         │         │              │
         │         │              ├── 无效 → 401 Unauthorized
         │         │              └
         │         └── 超限 → 429 Too Many Requests
         │
         └── 验证 Origin → 允许/拒绝
```

### 安全机制

| 机制 | 配置 | 说明 |
|------|------|------|
| **Token 验证** | `X-F2A-Token` 或 `Authorization: Bearer` | Daemon 启动时生成随机 Token |
| **速率限制** | 60 req/min | 防止 API 滥用 |
| **CORS** | `allowedOrigins` | 生产环境强制验证 |
| **请求大小限制** | 1MB | 防止大请求攻击 |

---

## 模块协作方式

### 初始化流程

```
F2ADaemon.start()
    │
    ├── 1. F2A.create(options)
    │       │
    │       ├── NodeIdentityManager.loadOrCreate() → 加载/创建 Node 身份
    │       ├── AgentIdentityStore.loadAgentIdentity() → 加载 Agent 身份
    │       ├── P2PNetwork 创建
    │       └── CapabilityManager 创建
    │
    ├── 2. F2A.start()
    │       │
    │       └── P2PNetwork.start() → 启动 libp2p
    │
    └── 3. ControlServer.start()
            │
            ├── AgentRegistry 初始化
            ├── MessageRouter 初始化
            └── HTTP Server 监听
```

### Agent 注册流程

```
POST /api/agents
    │
    ├── ControlServer.handleRegisterAgent()
    │       │
    │       ├── 验证参数（agentId, name）
    │       ├── 检查是否已存在
    │       │       ├── YES → updateLastActive()
    │       │       └── NO → AgentRegistry.register()
    │       │
    │       ├── MessageRouter.createQueue(agentId)
    │       └── syncAgentRegistryToRouter()
    │
    └── 返回 AgentRegistration
```

### 消息路由流程

```
POST /api/messages
    │
    ├── ControlServer.handleSendMessage()
    │       │
    │       ├── 验证发送方已注册
    │       ├── 验证接收方已注册（如果指定）
    │       ├── 创建 RoutableMessage
    │       │
    │       ├── 有 toAgentId？
    │       │       ├── YES → MessageRouter.route()
    │       │       └── NO → MessageRouter.broadcast()
    │
    └── 返回 messageId
```

---

## 消息流转图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           消息流转完整流程                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐                                     ┌─────────────┐
│  Agent A    │                                     │  Agent B    │
│ (发送方)    │                                     │ (接收方)    │
└──────┬──────┘                                     └──────┬──────┘
       │                                                   │
       │ 1. 发送消息请求                                   │
       │    POST /api/messages                             │
       │    { fromAgentId: "A", toAgentId: "B", content }  │
       │                                                   │
       ▼                                                   │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ControlServer                                       │
│                                                                             │
│   2. 验证发送方                                                            │
│      AgentRegistry.get("A") → 存在?                                        │
│                                                                             │
│   3. 验证接收方                                                            │
│      AgentRegistry.get("B") → 存在?                                        │
│                                                                             │
│   4. 创建消息                                                              │
│      messageId = randomUUID()                                              │
│      createdAt = new Date()                                                │
│                                                                             │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │
                        │ 5. 路由消息
                        │    MessageRouter.route(message)
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MessageRouter                                       │
│                                                                             │
│   6. 获取目标队列                                                          │
│      queues.get("B") → MessageQueue                                        │
│                                                                             │
│   7. 队列检查                                                              │
│      queue.length >= maxSize?                                              │
│          ├── YES → 移除最旧消息                                            │
│          └── NO → 直接添加                                                 │
│                                                                             │
│   8. 添加消息                                                              │
│      queue.messages.push(message)                                          │
│                                                                             │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │
                        │ 消息入队
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Agent B 的消息队列                                      │
│                                                                             │
│   messages: [                                                               │
│     { messageId, fromAgentId: "A", content, createdAt },                   │
│     ...                                                                     │
│   ]                                                                         │
│                                                                             │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │
                        │ 9. Agent B 获取消息
                        │    GET /api/messages/B
                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ControlServer                                       │
│                                                                             │
│   10. 验证 Agent                                                           │
│       AgentRegistry.get("B") → 存在?                                       │
│                                                                             │
│   11. 更新活跃时间                                                         │
│       AgentRegistry.updateLastActive("B")                                  │
│                                                                             │
│   12. 获取消息                                                             │
│       MessageRouter.getMessages("B") → messages[]                          │
│                                                                             │
└───────────────────────┬─────────────────────────────────────────────────────┘
                        │
                        │ 返回消息列表
                        ▼
┌─────────────┐                                     ┌─────────────┐
│  Agent A    │                                     │  Agent B    │
│             │                                     │ 收到消息    │
│             │                                     │ 处理消息    │
└─────────────┘                                     └──────┬──────┘
                                                           │
                                                           │ 13. 确认处理
                                                           │    DELETE /api/messages/B
                                                           │    { messageIds: [...] }
                                                           │
                                                           ▼
                                                   ┌─────────────┐
                                                   │ 清除已处理  │
                                                   │ 消息        │
                                                   └─────────────┘
```

---

## 统计与监控

### AgentRegistry 统计

```typescript
registry.getStats() = {
  total: 5,                      // 注册 Agent 总数
  capabilities: {
    'code-generation': 3,        // 具备此能力的 Agent 数
    'data-analysis': 2,
    'testing': 1,
  },
};
```

### MessageRouter 统计

```typescript
router.getStats() = {
  queues: 5,                     // 活跃队列数
  totalMessages: 12,             // 所有队列消息总数
  queueStats: {
    'agent-001': { size: 3, maxSize: 100 },
    'agent-002': { size: 5, maxSize: 100 },
    ...
  },
};
```

### ControlServer 状态

```typescript
GET /status = {
  success: true,
  peerId: '12D3KooW...',
  agentInfo: {
    agentId: 'agent-xxx',
    displayName: 'My Agent',
    capabilities: [...],
  },
};
```

---

## v0.6.0 模块总结

| 组件 | 功能 |
|------|------|
| **AgentRegistry** | Agent 注册 (RFC 003/008)、注销、查找、签名验证 |
| **MessageRouter** | 消息队列、路由、广播、Webhook 推送 (RFC 004) |
| **ControlServer** | Agent API、消息 API、CORS 安全 |
| **AgentTokenManager** | RFC 007: Agent Token 管理 |
| **ChallengeHandler** | RFC 008: Challenge-Response 签名验证 |
| **AuthMiddleware** | Token 验证中间件 |
| **Handlers** | 系统消息、消息路由、Agent管理、P2P通信处理器 |

---

## 新增模块 (v0.6.0)

### Handlers 目录

ControlServer 使用 handler 模块处理不同类型的请求：

```
src/handlers/
├── system-handler.ts    # 系统状态、健康检查
├── message-handler.ts   # 消息路由、消息队列
├── agent-handler.ts     # Agent 注册、注销、更新
├── p2p-handler.ts       # P2P 连接、发送命令
└── index.ts             # 统一导出
```

### Middleware 目录

```
src/middleware/
├── auth.ts              # Token 验证中间件
└── index.ts             # 统一导出
```

### AgentTokenManager

RFC 007 实现，管理 Agent Token：

```typescript
import { AgentTokenManager } from '@f2a/daemon';

const tokenManager = new AgentTokenManager();
const token = tokenManager.generateToken(agentId);
const isValid = tokenManager.validateToken(token, agentId);
```

### ChallengeHandler

RFC 008 实现，Challenge-Response 签名验证：

```typescript
import { ChallengeHandler } from '@f2a/daemon';

const challengeHandler = new ChallengeHandler({
  agentRegistry,
  logger,
});

// 创建 Challenge
const challenge = challengeHandler.createChallenge(agentId);

// 验证 Response
const result = challengeHandler.verifyResponse(agentId, response);
```

---

## RFC 实现状态

| RFC | 状态 | 说明 |
|-----|------|------|
| RFC 003 | ✅ 已实现 | AgentId 节点签发、签名验证 |
| RFC 004 | ✅ 已实现 | Agent 级 Webhook |
| RFC 005 | ✅ 已实现 | 架构统一、MessageRouter 移入核心 |
| RFC 007 | ✅ 已实现 | Agent Token |
| RFC 008 | ✅ 已实现 | Agent Identity 公钥注册 |

---

**文档结束**