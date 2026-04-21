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

**当前状态: 78.5%** (从 76.3% 提升)
- 测试文件: 42 passed, 1 skipped (增加 2 个新测试文件)
- 测试用例: 1094 passed, 23 skipped (增加 84 个新测试用例)

### Phase 1: 0% 覆盖率文件（新建测试）

**优先级: P0 - 核心功能，必须完成**

**进度: 2/3 完成**

| 文件 | 行数 | 当前覆盖率 | 状态 | 测试数 | 备注 |
|------|------|-----------|------|--------|------|
| `src/utils/middleware.ts` | 229 | ~95% | ✅ 完成 | 33 | 所有测试通过 |
| `src/utils/peer-table-manager.ts` | 460 | ~95% | ✅ 完成 | 51 | 所有测试通过 |
| `src/utils/message-dispatcher.ts` | 440 | 0% | ⏸️ 搁置 | - | Mock 复杂度过高，需重新设计测试策略 |
| `src/utils/benchmark.ts` | 237 | 0% | ⏭️ 可选 | - | 低优先级，非核心功能 |

#### 1.1 middleware.ts 测试（已完成）

**实际完成: 33 个测试用例**

测试覆盖:
- ✅ `MiddlewareManager.use()` / `remove()` / `list()` / `clear()` - 管理方法
- ✅ `MiddlewareManager.execute()` - 执行链（essential/optional、顺序、异常）
- ✅ `createMessageSizeLimitMiddleware()` - 大小限制中间件
- ✅ `createMessageTypeFilterMiddleware()` - 类型过滤中间件
- ✅ `createMessageLoggingMiddleware()` - 日志中间件
- ✅ `createMessageTransformMiddleware()` - 转换中间件
- ✅ essential 中间件异常处理
- ✅ 性能统计功能

#### 1.2 peer-table-manager.ts 测试（已完成）

**实际完成: 51 个测试用例**

测试覆盖:
- ✅ `upsertPeer()` / `updatePeer()` - 原子操作
- ✅ `cleanupStalePeers()` - 常规清理逻辑
- ✅ `cleanupStalePeersLocked()` - 激进清理逻辑
- ✅ `markConnected()` / `markDisconnected()` - 连接状态管理
- ✅ 信任白名单功能
- ✅ 高水位线检测
- ✅ 并发安全测试（锁机制）
- ✅ PeerInfo 查询方法

#### 1.3 message-dispatcher.ts 测试（搁置）

**搁置原因:**
1. **Mock 复杂度过高** - 依赖 E2EECrypto, PeerTableManager, Logger 等多个模块
2. **类型匹配困难** - `F2AMessageType` 类型定义复杂，加密消息格式需要精确匹配
3. **测试超时** - 初版测试文件导致测试运行超时

**建议的解决方案:**
- 创建专门的测试工具类封装 mock 设置
- 使用集成测试方式，而非纯单元测试
- 或等待其他模块测试稳定后再处理

**估算测试用例: 25-30 个**

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
Phase 1 (P0): ✅ middleware → ✅ peer-table-manager → ⏸️ message-dispatcher (搁置)
Phase 2 (P1): webhook → message-router → challenge → agent-registry → queue-manager → webhook-pusher
Phase 3 (P2): e2ee-crypto → delegator → event-handler-setup → p2p-network → message-handler → logger
Phase 4 (P3): 维持现有覆盖率
```

### 验收标准

- 所有 Phase 1 文件达到 95%+ 覆盖率 (当前: 2/3 完成)
- 所有 Phase 2 文件达到 90%+ 覆盖率
- 总体覆盖率达到 95%+（Phase 3 完成后达到 100%）

### 工作量估算

| Phase | 测试文件数 | 测试用例数 | 预估时间 | 实际完成 |
|-------|-----------|-----------|----------|----------|
| Phase 1 | 3-4 | 60-75 | 2-3 天 | 84 用例，2 文件完成 |
| Phase 2 | 6 | 48-66 | 1-2 天 | - |
| Phase 3 | 6 | 20-30 | 0.5-1 天 | - |

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

---

## 测试质量改进 (2026-04-21)

### 薄弱断言改进

**目标**: 将 `.toBeDefined()` 等薄弱断言替换为具体值验证

**改进的文件**:

| 文件 | 改进断言数 | 改进内容 |
|------|-----------|----------|
| `src/config/index.test.ts` | 12 | 默认配置值验证具体数值 |
| `src/index.test.ts` | 4 | 签名结果验证格式和长度 |
| `src/utils/signature.test.ts` | 3 | 签名字段验证正则格式 |
| `src/core/e2ee-crypto.test.ts` | 15 | 加密密钥/挑战/响应验证具体格式 |

**改进示例**:

```typescript
// 改进前（薄弱）
expect(DEFAULT_P2P_NETWORK_CONFIG.listenPort).toBeDefined();

// 改进后（具体）
expect(DEFAULT_P2P_NETWORK_CONFIG.listenPort).toBe(0);
expect(DEFAULT_P2P_NETWORK_CONFIG.bootstrapPeers).toEqual([]);
expect(DEFAULT_P2P_NETWORK_CONFIG.enableMDNS).toBe(true);

// 改进前（薄弱）
expect(signed.signature).toBeDefined();

// 改进后（具体）
expect(signed.signature).toMatch(/^[a-f0-9]{64}$/); // HMAC-SHA256 = 64 hex chars
expect(signed.timestamp).toBeGreaterThan(0);
expect(signed.nonce.length).toBe(32);
```

**验证标准**:
- 正常路径: 至少 3 个具体值验证
- 格式验证: 使用正则匹配验证 base64/hex 格式
- 数值验证: 验证具体值而非仅检查存在

### 跳过测试修复

**目标**: 启用 `.skip()` 测试并补充具体验证

| 文件 | 测试 | 问题 | 解决方案 |
|------|------|------|----------|
| `node-agent-identity.test.ts` | revokeAgent | 未传 dataDir 导致文件找不到 | 传入 `tempDir` 并验证文件删除 |

**改进内容**:
- Line 1275: `new IdentityDelegator(nodeManager)` → `new IdentityDelegator(nodeManager, tempDir)`
- 新增文件存在性验证（创建后存在，撤销后不存在）

### getAllInvitations 断言补充

**目标**: 补充邀请记录的具体字段验证

| 文件 | 改进断言数 | 改进内容 |
|------|-----------|----------|
| `reputation-security.test.ts` | 12 | 验证 inviterId/inviteeId/签名格式/timestamp |

**验证内容**:
- `inviterId`, `inviteeId` 具体值匹配
- `invitationSignature` 正则验证 SHA256 格式 (`/^[a-f0-9]{64}$/`)
- `timestamp` 数值验证 (> 0)
- 签名唯一性验证（两条邀请签名不同）

---

## 测试改进总结

**改进统计**:
- 薄弱断言替换: 约 50 处 `.toBeDefined()` → 具体值验证
- 跳过测试启用: 1 个 (revokeAgent)
- 断言补充: 12 处 (getAllInvitations)

**测试通过率**: 全部通过 (156 + 52 + 31 = 239 tests)

---

## Step 2 测试改进 ✅ (2026-04-21)

**f2a.test.ts**: ~25 处薄弱断言替换为具体验证（签名/公钥格式、服务接口方法、peer 结构）
**node-identity.test.ts**: 新增错误密码/空密码解密失败测试

**测试结果**: 1504 passed | 22 skipped (3.54s)

---

## 未来改进建议