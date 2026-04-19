# P1-1: F2A 类拆分计划

## 当前状态
- **文件**: `packages/network/src/core/f2a.ts`
- **行数**: 1230 行
- **问题**: 单一类承担过多职责

---

## 职责分析

F2A 类当前承担以下职责：

| 职责 | 方法 | 行数占比 |
|------|------|---------|
| **生命周期管理** | start, stop, bindEvents | ~100行 |
| **工厂方法** | static create() | ~170行 |
| **Agent 发现** | discoverAgents, getConnectedPeers, getAllPeers | ~50行 |
| **任务委托** | delegateTask, sendTaskTo, respondToTask, handleTaskRequest | ~200行 |
| **消息通信** | sendMessage, sendMessageToPeer, handleFreeMessage | ~150行 |
| **身份管理** | exportNodeIdentity, exportAgentIdentity, renewAgentIdentity | ~100行 |
| **能力注册** | registerCapability, getCapabilities, updateAgentCapabilities | ~50行 |
| **委托方法** | useMiddleware, findPeerViaDHT 等 | ~50行 |
| **成员变量/接口** | | ~100行 |

---

## 拆分方案

### 模块 1: TaskService (任务委托服务)
**目标文件**: `packages/network/src/core/task-service.ts`
**行数**: ~250 行
**职责**: 
- 任务委托逻辑 (delegateTask)
- 任务发送 (sendTaskTo)
- 任务响应处理 (respondToTask)
- 任务请求处理 (handleTaskRequest)

**提取内容**:
```typescript
export class TaskService {
  private p2pNetwork: P2PNetwork;
  private agentRegistry?: AgentRegistry;
  private logger: Logger;

  async delegateTask(options: TaskDelegateOptions): Promise<Result<TaskDelegateResult>>;
  async sendTaskTo(peerId: string, taskType: string, ...): Promise<Result<unknown>>;
  async respondToTask(taskId: string, ...): Promise<void>;
  async handleTaskRequest(request: TaskRequest): Promise<void>;
}
```

**源文件对应方法**:
- Line 478-642: delegateTask
- Line 642-661: sendTaskTo
- Line 783-850: handleTaskRequest
- Line 915-940: respondToTask

---

### 模块 2: MessageService (消息服务)
**目标文件**: `packages/network/src/core/message-service.ts`
**行数**: ~150 行
**职责**:
- 消息发送 (sendMessage)
- Peer 消息发送 (sendMessageToPeer)
- 自由消息处理 (handleFreeMessage)

**提取内容**:
```typescript
export class MessageService extends EventEmitter<MessageServiceEvents> {
  private p2pNetwork: P2PNetwork;
  private messageRouter?: MessageRouter;
  private logger: Logger;

  async sendMessage(message: F2AMessage): Promise<Result<void>>;
  async sendMessageToPeer(peerId: string, ...): Promise<Result<void>>;
  async handleFreeMessage(message: F2AMessage): Promise<void>;
}
```

**源文件对应方法**:
- Line 1147-1230: sendMessage
- Line 661-693: sendMessageToPeer
- Line 850-915: handleFreeMessage

---

### 模块 3: IdentityService (身份服务)
**目标文件**: `packages/network/src/core/identity-service.ts`
**行数**: ~150 行
**职责**:
- Node 身份导出 (exportNodeIdentity)
- Agent 身份导出 (exportAgentIdentity)
- Agent 身份更新 (renewAgentIdentity)
- 身份初始化逻辑 (create 方法中的身份部分)

**提取内容**:
```typescript
export class IdentityService {
  private nodeIdentityManager?: NodeIdentityManager;
  private agentIdentityManager?: AgentIdentityManager;
  private identityDelegator?: IdentityDelegator;
  private ed25519Signer?: Ed25519Signer;
  private logger: Logger;

  async exportNodeIdentity(): Promise<Result<...>>;
  async exportAgentIdentity(): Promise<Result<ExportedAgentIdentity>>;
  async renewAgentIdentity(newExpiresAt: Date): Promise<Result<AgentIdentity>>;
  getSigner(): Ed25519Signer | undefined;
}
```

**源文件对应方法**:
- Line 1036-1058: exportNodeIdentity
- Line 1058-1086: exportAgentIdentity
- Line 1086-1147: renewAgentIdentity

---

### 模块 4: CapabilityService (能力服务)
**目标文件**: `packages/network/src/core/capability-service.ts`
**行数**: ~80 行
**职责**:
- 能力注册 (registerCapability)
- 能力查询 (getCapabilities)
- 能力更新 (updateAgentCapabilities)

**提取内容**:
```typescript
export class CapabilityService {
  private registeredCapabilities: Map<string, RegisteredCapability> = new Map();
  private p2pNetwork: P2PNetwork;
  private logger: Logger;

  registerCapability(capability: AgentCapability, handler: Function): void;
  getCapabilities(): AgentCapability[];
  updateAgentCapabilities(): void;
  getHandler(capabilityName: string): Function | undefined;
}
```

**源文件对应方法**:
- Line 394-426: registerCapability
- Line 426-438: getCapabilities
- Line 940-960: updateAgentCapabilities

---

### 模块 5: DiscoveryService (发现服务)
**目标文件**: `packages/network/src/core/discovery-service.ts`
**行数**: ~50 行
**职责**:
- Agent 发现 (discoverAgents)
- Peer 查询 (getConnectedPeers, getAllPeers)

**注意**: DiscoveryService 已在 P1-2 中从 P2PNetwork 提取，此处 F2A 的发现方法是委托给 P2PNetwork 的简单包装。

**处理方式**: 保留在 F2A 中作为 facade 方法，不单独提取。

---

### 模块 6: F2AFactory (工厂)
**目标文件**: `packages/network/src/core/f2a-factory.ts`
**行数**: ~180 行
**职责**:
- F2A 实例创建逻辑 (create 方法)
- 配置合并与验证
- 身份初始化流程

**提取内容**:
```typescript
export class F2AFactory {
  static async create(options: F2AOptions): Promise<F2A>;
  private static mergeOptions(options: F2AOptions): Required<F2AOptions>;
  private static initializeIdentity(options: Required<F2AOptions>): Promise<...>;
  private static createP2PNetwork(agentInfo: AgentInfo, options: ...): Promise<P2PNetwork>;
}
```

**源文件对应方法**:
- Line 168-338: static create()

---

## 执行顺序

```
Phase 1: TaskService 提取 + 测试
    ↓
Phase 2: MessageService 提取 + 测试
    ↓
Phase 3: IdentityService 提取 + 测试
    ↓
Phase 4: CapabilityService 提取 + 测试
    ↓
Phase 5: F2AFactory 提取 + 测试
    ↓
Phase 6: F2A 整合 + 验证现有测试
```

---

## 预估工作量（含测试）

| Phase | 任务 | 预估时间 | 复杂度 |
|-------|------|---------|--------|
| 1a | 提取 TaskService | 25分钟 | 中 |
| 1b | TaskService 测试 | 20分钟 | 中 |
| 2a | 提取 MessageService | 20分钟 | 中 |
| 2b | MessageService 测试 | 15分钟 | 中 |
| 3a | 提取 IdentityService | 20分钟 | 中 |
| 3b | IdentityService 测试 | 15分钟 | 中 |
| 4a | 提取 CapabilityService | 15分钟 | 低 |
| 4b | CapabilityService 测试 | 10分钟 | 低 |
| 5a | 提取 F2AFactory | 20分钟 | 中 |
| 5b | F2AFactory 测试 | 15分钟 | 中 |
| 6 | F2A 整合 + 验证 | 30分钟 | 中 |
| **总计** | | **2.5小时** | |

---

## 测试策略改进

**吸取 P1-2 的教训**，采用以下策略：

### 分离测试编写
- **代码提取**: Subagent 执行
- **测试编写**: 我直接审查 + 补充（或指定另一 subagent 专门写测试）

### 测试质量标准
每个服务测试必须包含：
1. **正常路径**: 至少 3 个具体值验证（不能只用 `.toBeDefined()`）
2. **错误路径**: 至少 2 个错误场景（参数缺失、异常状态）
3. **边界情况**: 至少 1 个边界测试（空值、极限值）
4. **状态验证**: 检查副作用（如能力注册后 list 包含它）

### 回归验证
- 现有 F2A 测试作为回归验证基准
- 新模块测试覆盖提取的功能
- 最终验证：现有测试 + 新测试都通过

---

## 最终目标结构

```
packages/network/src/
├── core/
│   ├── f2a.ts              (~300行，整合各服务)
│   ├── f2a-factory.ts      (~180行，创建逻辑)
│   ├── task-service.ts     (~250行)
│   ├── message-service.ts  (~150行)
│   ├── identity-service.ts (~150行)
│   ├── capability-service.ts (~80行)
│   └── p2p-network.ts      (已拆分，2128行)
```

---

## 决策点

1. **测试分离策略**: 是否需要单独的 subagent 写测试？
2. **Phase 顺序**: 是否按上述顺序执行，还是并行执行？
3. **DiscoveryService**: 是否保留在 F2A 中作为 facade？

---

请确认以上计划，或提出调整建议。