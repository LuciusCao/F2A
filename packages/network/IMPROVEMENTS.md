# @f2a/network 包改进记录

## 本次改进概览 (2026-04-20)

### 代码规模变化

| 文件 | 改进前 | 改进后 | 变化 |
|------|--------|--------|------|
| p2p-network.ts | 2028 行 | 985 行 | -51% |
| message-router.ts | 1017 行 | 835 行 | -18% |
| **新增模块** | - | - | - |
| message-handler.ts | - | 593 行 | 新增 |
| event-handler-setup.ts | - | 275 行 | 新增 |
| message-sender.ts | - | 237 行 | 新增 |
| agent-discoverer.ts | - | 188 行 | 新增 |
| key-exchange-service.ts | - | 80 行 | 新增 |
| queue-manager.ts | - | 204 行 | 新增 |
| webhook-pusher.ts | - | 167 行 | 新增 |
| interfaces/index.ts | - | 117 行 | 新增 |

### 问题解决情况

| 优先级 | 问题 | 解决方案 |
|--------|------|----------|
| P0-1 | p2p-network.ts 2028行 | 拆分 6 个模块，降至 985 行 |
| P0-2 | AgentRegistry 同步 I/O | F2AFactory 使用异步工厂方法 |
| P1-1 | identity 模块文档缺失 | 创建 README.md 说明 RFC003/008 |
| P1-2 | message-router.ts 过长 | 拆分 QueueManager/WebhookPusher |
| P1-3 | 缺少接口抽象 | 创建 IAgentRegistry/IMessageRouter |
| P1-4 | 类型不严格 | 改进 rate-limiter.ts 类型 |
| P2 | 代码风格 | 整体良好，无需改进 |

---

## 测试覆盖率提升计划 (2026-04-20)

**目标: 100% 测试覆盖率**

**当前状态: 76.3%**
- 测试文件: 40 passed, 1 skipped
- 测试用例: 1010 passed, 23 skipped

### Phase 1: 0% 覆盖率文件（新建测试）

**优先级: P0 - 核心功能，必须完成**

| 文件 | 行数 | 当前覆盖率 | 未覆盖功能 | 测试策略 |
|------|------|-----------|-----------|----------|
| `src/utils/message-dispatcher.ts` | 440 | 0% | 全部 | 单元测试 + Mock |
| `src/utils/peer-table-manager.ts` | 460 | 0% | 全部 | 单元测试 + 并发测试 |
| `src/utils/middleware.ts` | 229 | 0% | 全部 | 单元测试 |
| `src/utils/benchmark.ts` | 237 | 0% | 全部 | 可选，低优先级 |

#### 1.1 message-dispatcher.ts 测试计划

**测试重点:**
- `handleMessage()` - 消息处理主流程
- `handleEncryptedMessage()` - 加密消息处理
- `verifySenderIdentity()` - 发送方身份验证
- `handleDiscoverMessage()` - DISCOVER 消息处理
- `handleDecryptFailedMessage()` - 解密失败处理
- 速率限制器测试

**测试用例估算: 25-30 个**

#### 1.2 peer-table-manager.ts 测试计划

**测试重点:**
- `upsertPeer()` / `updatePeer()` - 原子操作
- `cleanupStalePeers()` - 常规清理逻辑
- `cleanupStalePeersLocked()` - 激进清理逻辑
- `markConnected()` / `markDisconnected()` - 连接状态管理
- 信任白名单功能
- 高水位线检测

**测试用例估算: 20-25 个**

#### 1.3 middleware.ts 测试计划

**测试重点:**
- `MiddlewareManager.use()` / `remove()` / `list()` - 管理方法
- `MiddlewareManager.execute()` - 执行链
- `createMessageSizeLimitMiddleware()` - 大小限制中间件
- `createMessageTypeFilterMiddleware()` - 类型过滤中间件
- `createMessageLoggingMiddleware()` - 日志中间件
- `createMessageTransformMiddleware()` - 转换中间件
- essential/optional 中间件异常处理

**测试用例估算: 15-20 个**

---

### Phase 2: 低覆盖率文件（补充测试）

**优先级: P1 - 重要功能，应完成**

| 文件 | 行数 | 当前覆盖率 | 未覆盖行 | 测试策略 |
|------|------|-----------|---------|----------|
| `src/core/webhook.ts` | 465 | 21.7% | 366-458, 464-465 | 单元测试 + Mock HTTP |
| `src/core/message-router.ts` | 835 | 30.6% | 624-792, 804-835 | 单元测试 + 集成测试 |
| `src/core/identity/challenge.ts` | 489 | 44.7% | 439-441, 459-490 | 单元测试 |
| `src/core/agent-registry.ts` | 986 | 50.5% | 936-955, 962-982 | 单元测试 |
| `src/core/queue-manager.ts` | 204 | 50.7% | 161-178, 184-204 | 单元测试 |
| `src/core/webhook-pusher.ts` | 167 | 51.8% | 152-156, 162-167 | 单元测试 |

#### 2.1 webhook.ts 测试计划

**未覆盖功能:**
- `sendRequest()` - HTTP 请求发送（DNS 解析、私有 IP 检测、IPv6 处理）
- DNS 重绑定攻击防护
- TOCTOU 漏洞防护

**测试用例估算: 10-15 个**

#### 2.2 message-router.ts 测试计划

**未覆盖功能:**
- `routeIncoming()` - 入站路由逻辑
- `routeOutbound()` - 出站路由逻辑
- 路由优先级处理
- Webhook 推送失败重试

**测试用例估算: 15-20 个**

#### 2.3 challenge.ts 测试计划

**未覆盖功能:**
- `computeChallengeId()` - Challenge ID 计算
- `verifyChallengeResponseWithStore()` - 使用 Store 的完整验证

**测试用例估算: 5-8 个**

#### 2.4 agent-registry.ts 测试计划

**未覆盖功能:**
- 边缘情况处理（空 Agent、重复注册）
- 持久化边缘情况

**测试用例估算: 8-10 个**

#### 2.5 queue-manager.ts 测试计划

**未覆盖功能:**
- 队列持久化边缘情况
- 队列清理逻辑

**测试用例估算: 5-8 个**

#### 2.6 webhook-pusher.ts 测试计划

**未覆盖功能:**
- 推送失败重试逻辑
- 批量推送边缘情况

**测试用例估算: 5-8 个**

---

### Phase 3: 中等覆盖率文件（边缘情况）

**优先级: P2 - 提升覆盖率，可选完成**

| 文件 | 当前覆盖率 | 需补充 |
|------|-----------|--------|
| `src/core/e2ee-crypto.ts` | 90.4% | 错误路径、解密失败 |
| `src/core/identity/delegator.ts` | 83.7% | 异常情况 |
| `src/core/event-handler-setup.ts` | 86.9% | 分支覆盖 |
| `src/core/p2p-network.ts` | 80.4% | 停止流程边缘情况 |
| `src/core/message-handler.ts` | 84.0% | 边缘分支 |
| `src/utils/logger.ts` | 80.2% | 日志级别边缘情况 |

---

### Phase 4: 已达高覆盖率文件（维持）

**优先级: P3 - 无需改动**

| 文件 | 覆盖率 | 状态 |
|------|--------|------|
| `src/common/type-guards.ts` | 100% | ✅ 完成 |
| `src/config/defaults.ts` | 100% | ✅ 完成 |
| `src/types/*.ts` | 100% | ✅ 完成 |
| `src/core/capability-service.ts` | 100% | ✅ 完成 |
| `src/core/identity/agent-id.ts` | 100% | ✅ 完成 |
| `src/core/identity/encrypted-key-store.ts` | 100% | ✅ 完成 |

---

### 实施顺序

```
Phase 1 (P0): message-dispatcher → peer-table-manager → middleware
Phase 2 (P1): webhook → message-router → challenge → agent-registry → queue-manager → webhook-pusher
Phase 3 (P2): e2ee-crypto → delegator → event-handler-setup → p2p-network → message-handler → logger
Phase 4 (P3): 维持现有覆盖率
```

### 验收标准

- 所有 Phase 1 文件达到 95%+ 覆盖率
- 所有 Phase 2 文件达到 90%+ 覆盖率
- 总体覆盖率达到 95%+（Phase 3 完成后达到 100%）

### 工作量估算

| Phase | 测试文件数 | 测试用例数 | 预估时间 |
|-------|-----------|-----------|----------|
| Phase 1 | 3-4 | 60-75 | 2-3 天 |
| Phase 2 | 6 | 48-66 | 1-2 天 |
| Phase 3 | 6 | 20-30 | 0.5-1 天 |

**总计: 4-6 天工作量**

---

## 未来改进建议

1. **为新模块补充边缘情况测试**
   - MessageHandler 的身份伪造检测
   - MessageSender 的 E2EE 加密路径

2. **接口实际应用**
   - 让 MessageHandler/MessageSender 实现 IAgentRegistry/IMessageRouter
   - 在测试中使用接口 mock

3. **持续监控代码规模**
   - 新模块保持 < 600 行
   - 定期 review 是否需要继续拆分