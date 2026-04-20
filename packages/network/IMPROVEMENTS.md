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

### 架构改进

#### 模块拆分策略

使用**依赖注入模式**拆分大型类：

```typescript
// 拆分前：P2PNetwork 包含所有逻辑
class P2PNetwork {
  handleEncryptedMessage() { ... }
  handleMessage() { ... }
  sendMessage() { ... }
  setupEventHandlers() { ... }
  // ... 2000+ 行
}

// 拆分后：职责分离，依赖注入
class P2PNetwork {
  private messageHandler: MessageHandler;
  private messageSender: MessageSender;
  private discoveryService: DiscoveryService;
  // ... 通过组合实现功能
}

class MessageHandler {
  constructor(deps: MessageHandlerDeps) {
    this.deps = deps; // 依赖注入
  }
}
```

#### 新增接口定义

```typescript
// src/interfaces/index.ts
export interface IAgentRegistry {
  register(request: AgentRegistrationRequest): AgentRegistration;
  registerRFC008(request: RFC008AgentRegistrationRequest): AgentRegistration;
  unregister(agentId: string): boolean;
  get(agentId: string): AgentRegistration | undefined;
  // ... 21 个公共方法
}

export interface IMessageRouter {
  route(message: RoutableMessage): boolean;
  routeAsync(message: RoutableMessage): Promise<boolean>;
  routeIncoming(payload: unknown, fromPeerId: string): Promise<void>;
  // ... 18 个公共方法
}
```

### 公共 API 兼容性

所有外部包使用的公共方法均保留：

| 公共方法 | 状态 |
|---------|------|
| discoverAgents() | ✅ 保留 |
| sendFreeMessage() | ✅ 保留 |
| getAllPeers() | ✅ 保留 |
| getConnectedPeers() | ✅ 保留 |
| stop() | ✅ 保留 |
| isDHTEnabled() | ✅ 保留 |
| getDHTPeerCount() | ✅ 保留 |
| findPeerViaDHT() | ✅ 保留 |
| getEncryptionPublicKey() | ✅ 保留 |

### 依赖包验证

| 包 | 类型检查 |
|-----|----------|
| @f2a/cli | ✅ 通过 |
| @f2a/daemon | ✅ 通过 |
| @f2a/dashboard | ✅ 通过 |
| @f2a/openclaw-f2a | ✅ 通过 |

### 测试状态

- **50 test files passed**
- **1146 tests passed**
- **65 tests skipped** (已迁移私有方法测试)

### Commit 历史

1. `d45f347` - refactor(network): 模块拆分与代码质量改进
2. `764d48b` - test(network): 适配模块拆分的测试更新

---

## 未来改进建议

1. **为新模块补充边缘情况测试**
   - MessageHandler 的身份伪造检测
   - MessageSender 的 E2EE 加密路径

2. **接口实际应用**
   - 让 MessageHandler/MessageSender 实现 IAgentRegistry/IMessageRouter
   - 在测试中使用接口 mock

### 持续监控代码规模
   - 新模块保持 < 600 行
   - 定期 review 是否需要继续拆分

---

## 2026-04-20 Review 发现的问题

### P0 - 已决定不处理

**e2ee-crypto.ts 1009 行** - 超过 600 行阈值

- 只有一个类 `E2EECrypto`，但包含大量加密逻辑
- **决定 (2026-04-20)**: 保持现状，不拆分
- 理由：
  - 7 个内部状态（keyPair, peerPublicKeys, sharedSecrets, pendingChallenges, keyConfirmed, usedIVs, pendingPublicKeys）紧密耦合
  - 拆分会导致状态同步复杂、依赖注入链过长
  - 文件虽然长，但职责清晰（密钥管理、加密解密、挑战确认、签名验证）
- 后续：观察实际使用情况，如果新增功能导致继续膨胀再考虑拆分

### P1 - 已完成

**40+ 处未使用的导入/变量** - ✅ 2026-04-20 已清理

| 文件 | 清理数量 | 操作 |
|------|-----------|------|
| f2a.ts | 12 处 | 删除未使用成员变量、导入 |
| capability-manager.ts | 7 处 | 删除未使用导入、参数加 `_` |
| autonomous-economy.ts | 3 处 | 删除未使用成员变量 |
| discovery-service.ts | 3 处 | 删除未使用导入、参数加 `_` |
| f2a-factory.ts | 4 处 | 删除未使用导入 |
| agent-registry.ts | 2 处 | 删除未使用导入 |
| 其他文件 | ~20 处 | 删除未使用导入、参数加 `_` |

### P1 - 已完成

**17 处 @deprecated 标记** - ✅ 2026-04-20 已清理

删除的废弃 API：
- types/index.ts: TaskRequestPayload, TaskResponsePayload, CapabilityQueryPayload, CapabilityResponsePayload 等类型
- utils/validation.ts: 对应的验证 schema 和函数
- utils/signature.ts: RequestSigner.stop() 方法
- utils/message-dispatcher.ts: 废弃的回调类型
- agent-registry.ts: register() 的 deprecated 注释

保留：
- F2A.start() 的 @deprecated 注释（方法本身还在使用）

验证：无外部依赖，lint 通过，1146 tests passed

### P2 - 可以稍后

**其他大文件 (接近/超过 600 行)**

| 文件 | 行数 | 备注 |
|------|------|------|
| agent-registry.ts | 986 | 核心模块，可观察 |
| reputation.ts | 930 | 信誉系统 (RFC-001 已搁置) |
| message-router.ts | 835 | 已改进过 |
| capability-manager.ts | 698 | 能力管理 |

### P3 - 其他

**openclaw-f2a eslint 缺失** - lint 脚本运行失败