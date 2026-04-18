# P0-3: ControlServer 职责拆分

## 目标
将 `control-server.ts`（1495行）拆分为多个 Handler 类，每个文件 < 500 行。

## 架构设计

### 文件结构
```
packages/daemon/src/
├── control-server.ts           (~150行) - 路由分发、启动/停止
├── handlers/
│   ├── index.ts                (~20行)  - 统一导出
│   ├── agent-handler.ts        (~450行) - Agent CRUD + webhook + verify
│   ├── message-handler.ts      (~250行) - 消息发送/获取/清除
│   ├── system-handler.ts       (~200行) - status/peers/capability
│   └── p2p-handler.ts          (~150行) - discover/delegate/send
├── middleware/
│   ├── index.ts                (~10行)  - 统一导出
│   └── auth.ts                 (~80行)  - Token 验证中间件
└── types/
    └── handlers.ts             (~50行)  - 共享类型定义
```

### 依赖关系
```
ControlServer
    ├── AgentHandler
    │       ├── AgentRegistry (from F2A)
    │       ├── AgentIdentityManager
    │       ├── AgentTokenManager
    │       ├── E2EECrypto
    │       └── MessageRouter (for creating queue)
    ├── MessageHandler
    │       ├── MessageRouter
    │       ├── AgentRegistry
    │       └── F2A (for P2P send)
    ├── SystemHandler
    │       ├── F2A
    │       └── TokenManager
    ├── P2PHandler
    │       └── F2A
    └── AuthMiddleware
            └── TokenManager
```

---

## 执行任务

### Phase 1: 基础设施（无行为变更）

#### Task 1.1: 创建类型定义
**文件**: `packages/daemon/src/types/handlers.ts`

```typescript
// 需要定义的类型
export interface AuthContext {
  token: string;
  clientIp: string;
}

export interface HandlerDeps {
  logger: Logger;
}

export interface AgentHandlerDeps extends HandlerDeps {
  agentRegistry: AgentRegistry;
  identityManager: AgentIdentityManager;
  agentTokenManager: AgentTokenManager;
  e2eeCrypto: E2EECrypto;
  messageRouter: MessageRouter;
  pendingChallenges: Map<string, Challenge>;
}

export interface Challenge {
  nonce: string;
  webhook: { url: string };
  timestamp: number;
}

// ... 其他 Handler 依赖类型
```

**验证**: 类型编译通过

---

#### Task 1.2: 创建认证中间件
**文件**: `packages/daemon/src/middleware/auth.ts`

提取重复的 token 验证逻辑：
- `extractBearerToken()`
- `withAuth()` - 高阶函数，包装需要认证的 handler
- `withRateLimit()` - 速率限制包装器

**验证**: 导出函数签名正确

---

### Phase 2: Handler 提取（按依赖顺序）

#### Task 2.1: 创建 SystemHandler
**文件**: `packages/daemon/src/handlers/system-handler.ts`

提取端点：
- `GET /health` - 健康检查（无需认证）
- `GET /status` - 状态（需认证）
- `GET /peers` - 获取 peers（需认证）
- `POST /register-capability` - 注册能力（需认证）
- `POST /agent/update` - 更新 Agent 信息（需认证）
- `handleStatus()`, `handlePeers()`, `handleRegisterCapability()` 方法

**依赖**: F2A, TokenManager, Logger

**验证**: 单元测试通过

---

#### Task 2.2: 创建 P2PHandler
**文件**: `packages/daemon/src/handlers/p2p-handler.ts`

提取端点：
- `POST /control` → `discover` action
- `POST /control` → `delegate` action  
- `POST /control` → `send` action

提取方法：
- `handleDiscover()`
- `handleDelegate()`
- `handleSend()`

**依赖**: F2A, Logger

**验证**: 单元测试通过

---

#### Task 2.3: 创建 MessageHandler
**文件**: `packages/daemon/src/handlers/message-handler.ts`

提取端点：
- `POST /api/messages` - 发送消息
- `GET /api/messages/:agentId` - 获取消息队列
- `DELETE /api/messages/:agentId` - 清除消息

提取方法：
- `handleSendMessage()`
- `handleGetMessages()`
- `handleClearMessages()`

**依赖**: MessageRouter, AgentRegistry, F2A, Logger

**验证**: 单元测试通过

---

#### Task 2.4: 创建 AgentHandler（最复杂）
**文件**: `packages/daemon/src/handlers/agent-handler.ts`

提取端点：
- `GET /api/agents` - 列出 Agents
- `POST /api/agents` - 注册 Agent
- `DELETE /api/agents/:agentId` - 注销 Agent
- `GET /api/agents/:agentId` - 获取 Agent 详情
- `PATCH /api/agents/:agentId/webhook` - 更新 webhook
- `POST /api/agents/verify` - Challenge-Response 验证

提取方法：
- `handleListAgents()`
- `handleRegisterAgent()`
- `handleUnregisterAgent()`
- `handleGetAgent()`
- `handleUpdateWebhook()`
- `handleVerifyAgent()`

**状态**: `pendingChallenges` Map 移入此类

**依赖**: AgentRegistry, AgentIdentityManager, AgentTokenManager, E2EECrypto, MessageRouter, Logger

**验证**: 单元测试通过

---

### Phase 3: 重构 ControlServer

#### Task 3.1: 简化 ControlServer
**文件**: `packages/daemon/src/control-server.ts`

修改：
1. 删除已提取的 handler 方法
2. 在构造函数中初始化各 Handler 实例
3. 简化 `handleRequest()` 为路由分发
4. 使用 AuthMiddleware 包装需认证的路由

**保留在 ControlServer**:
- 构造函数
- `start()`, `stop()` 方法
- CORS 配置验证
- `handleRequest()` 路由分发逻辑
- `getAgentRegistry()`, `getMessageRouter()` 访问器

**目标行数**: ~150-200 行

**验证**: 所有测试通过

---

### Phase 4: 测试与验证

#### Task 4.1: 更新现有测试
**文件**: `packages/daemon/src/control-server.test.ts`

修改 mock 以适应新架构（如果需要）

#### Task 4.2: 添加 Handler 单元测试
**文件**: `packages/daemon/src/handlers/__tests__/*.test.ts`

为每个 Handler 添加测试：
- `agent-handler.test.ts`
- `message-handler.test.ts`
- `system-handler.test.ts`
- `p2p-handler.test.ts`

#### Task 4.3: 集成测试
运行完整测试套件：
```bash
npm test
```

---

### Phase 5: 文档更新

#### Task 5.1: 更新架构文档
记录新的 Handler 架构和依赖关系

---

## 风险与缓解

| 餬险 | 缓解措施 |
|------|---------|
| 状态共享问题 | `pendingChallenges` 移入 AgentHandler，其他状态通过依赖注入 |
| 测试覆盖不足 | 每个 Handler 提取后立即添加测试 |
| 循环依赖 | Handler 只依赖 network 层，不依赖 ControlServer |
| 行为变更 | 逐步提取，每步验证测试通过 |

---

## 预期结果

| 文件 | 当前行数 | 目标行数 |
|------|---------|---------|
| control-server.ts | 1495 | ~150-200 |
| agent-handler.ts | - | ~400-450 |
| message-handler.ts | - | ~200-250 |
| system-handler.ts | - | ~150-200 |
| p2p-handler.ts | - | ~100-150 |
| auth.ts | - | ~60-80 |

**总行数**: 1495 → ~1100-1300（因增加 import、类型定义等略有增加，但职责更清晰）

---

## 执行顺序

```
Task 1.1 ──→ Task 1.2
              │
              ▼
Task 2.1 ──→ Task 2.2 ──→ Task 2.3 ──→ Task 2.4
              │
              ▼
           Task 3.1
              │
              ▼
Task 4.1 ──→ Task 4.2 ──→ Task 4.3
              │
              ▼
           Task 5.1
```

**预计总工时**: 4-6 小时