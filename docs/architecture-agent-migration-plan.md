# F2A Agent 架构改进计划

**版本**: 1.0  
**日期**: 2026-03-22  
**状态**: 规划中

---

## 目标

将 F2A 从 "1 Node = 1 Agent" 改进为 "1 Node = N Agents"，信誉从 PeerID 绑定改为 AgentID 绑定。

---

## Phase 1: 引入 AgentID (基础架构)

### 1.1 类型定义

**文件**: `packages/openclaw-f2a/src/types.ts`

```typescript
// 新增 AgentID 类型
export interface AgentIdentity {
  agentId: string;          // 格式: agent-{uuid}
  name: string;
  publicKey?: string;
  createdAt: number;
}

// 扩展 F2AConnector 配置
export interface F2AAdapterConfig {
  // ... 现有配置 ...
  
  // 新增 Agent 配置
  agent?: {
    id?: string;           // 可选，不提供则自动生成
    name?: string;         // 显示名称
    capabilities?: string[];
  };
}
```

### 1.2 AgentID 生成规则

```typescript
// 格式: agent-{timestamp}-{random}
// 示例: agent-20260322-abc123

function generateAgentId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('hex');
  return `agent-${timestamp}-${random}`;
}
```

### 1.3 任务清单

- [ ] 在 `types.ts` 中添加 `AgentIdentity` 类型
- [ ] 在 `F2AConnector` 中添加 `agentId` 字段
- [ ] 修改初始化逻辑，自动生成或加载 AgentID
- [ ] 持久化 AgentID 到 `f2a-data/agent.json`

---

## Phase 2: 信誉迁移到 AgentID

### 2.1 数据迁移

**当前**: `reputation.json`
```json
{
  "entries": {
    "12D3KooW...": { "score": 85, ... }
  }
}
```

**目标**: `reputation.json`
```json
{
  "entries": {
    "agent-20260322-abc123": { "score": 85, ... }
  },
  "legacyMapping": {
    "12D3KooW...": "agent-20260322-abc123"
  }
}
```

### 2.2 API 修改

**当前**:
```typescript
getReputation(peerId: string): ReputationEntry
recordSuccess(peerId: string, ...): void
```

**目标**:
```typescript
getReputation(agentId: string): ReputationEntry
recordSuccess(agentId: string, ...): void

// 兼容层（过渡期）
getReputationByPeerId(peerId: string): ReputationEntry
```

### 2.3 任务清单

- [ ] 修改 `ReputationSystem` 使用 AgentID 作为键
- [ ] 添加迁移逻辑：检测旧数据，迁移到新键
- [ ] 添加 `legacyMapping` 支持向后兼容
- [ ] 更新所有调用点

---

## Phase 3: 消息协议扩展

### 3.1 消息格式

**当前**:
```typescript
interface F2AMessage {
  from: string;    // PeerID
  to: string;      // PeerID
  // ...
}
```

**目标**:
```typescript
interface F2AMessage {
  from: string;           // PeerID (发送方 Node)
  fromAgent?: string;     // AgentID (发送方 Agent)
  to: string;             // PeerID (接收方 Node)
  toAgent?: string;       // AgentID (接收方 Agent)
  // ...
}
```

### 3.2 路由逻辑

```typescript
// Node 接收消息后
function routeMessage(message: F2AMessage): void {
  if (message.toAgent) {
    // 路由到指定 Agent
    const agent = this.agentRegistry.get(message.toAgent);
    if (agent) {
      agent.handleMessage(message);
    }
  } else {
    // 广播到所有 Agent（旧版兼容）
    for (const agent of this.agents) {
      agent.handleMessage(message);
    }
  }
}
```

### 3.3 任务清单

- [ ] 扩展消息格式，添加 `fromAgent`/`toAgent`
- [ ] 修改 `NetworkClient` 发送逻辑
- [ ] 修改消息处理逻辑，支持 Agent 路由
- [ ] 更新协议文档

---

## Phase 4: 多 Agent 注册

### 4.1 Agent Registry

**文件**: `packages/openclaw-f2a/src/agent-registry.ts`

```typescript
export class AgentRegistry {
  private agents: Map<string, LocalAgent> = new Map();
  private defaultAgentId: string | null = null;

  register(agent: LocalAgent): void {
    this.agents.set(agent.id, agent);
    if (!this.defaultAgentId) {
      this.defaultAgentId = agent.id;
    }
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
    if (this.defaultAgentId === agentId) {
      this.defaultAgentId = this.agents.keys().next().value || null;
    }
  }

  get(agentId: string): LocalAgent | undefined {
    return this.agents.get(agentId);
  }

  getDefault(): LocalAgent | undefined {
    return this.defaultAgentId ? this.agents.get(this.defaultAgentId) : undefined;
  }

  list(): LocalAgent[] {
    return Array.from(this.agents.values());
  }
}

export interface LocalAgent {
  id: string;              // AgentID
  name: string;
  capabilities: string[];
  reputation: ReputationEntry;
}
```

### 4.2 配置示例

**openclaw.json**:
```json
{
  "plugins": {
    "openclaw-f2a": {
      "config": {
        "agents": [
          {
            "id": "agent-main",
            "name": "Main Agent",
            "capabilities": ["code-generation", "file-operation"]
          },
          {
            "id": "agent-test",
            "name": "Test Agent",
            "capabilities": ["testing", "review"]
          }
        ]
      }
    }
  }
}
```

### 4.3 任务清单

- [ ] 创建 `AgentRegistry` 类
- [ ] 修改 `F2AConnector` 使用 `AgentRegistry`
- [ ] 支持从配置加载多个 Agent
- [ ] 更新 Webhook 处理逻辑

---

## Phase 5: Agent 迁移 (可选高级特性)

### 5.1 迁移流程

```
┌─────────────┐                    ┌─────────────┐
│   Node A    │                    │   Node B    │
│             │                    │             │
│  Agent X    │ ── 迁移请求 ──────► │             │
│  ID: xxx    │                    │             │
│  Rep: 85    │ ◄─ 迁移确认 ─────── │             │
│             │                    │             │
│  1. 导出信誉 │                    │  4. 导入信誉 │
│  2. 签名证明 │ ── 带签名的信誉 ──► │  5. 验证签名 │
│  3. 注销    │                    │  6. 注册    │
└─────────────┘                    └─────────────┘
```

### 5.2 信誉证明

```typescript
interface ReputationProof {
  agentId: string;
  score: number;
  history: ReputationEvent[];
  signature: string;      // Node A 的签名
  timestamp: number;
  nodeId: string;         // Node A 的 PeerID
}

// 验证信誉证明
function verifyReputationProof(proof: ReputationProof, nodePublicKey: string): boolean {
  // 1. 验证签名
  // 2. 验证时间戳
  // 3. 验证 nodeId
  return true;
}
```

### 5.3 任务清单

- [ ] 实现 `exportReputation()` 方法
- [ ] 实现 `importReputation()` 方法
- [ ] 实现签名验证
- [ ] 添加 CLI 命令 `f2a agent migrate`

---

## 实施顺序

| Phase | 优先级 | 预计时间 | 依赖 |
|-------|--------|----------|------|
| Phase 1 | P0 | 1-2 天 | 无 |
| Phase 2 | P0 | 2-3 天 | Phase 1 |
| Phase 3 | P1 | 2-3 天 | Phase 2 |
| Phase 4 | P1 | 3-4 天 | Phase 3 |
| Phase 5 | P2 | 2-3 天 | Phase 4 |

---

## 向后兼容策略

1. **数据迁移**: 自动检测旧格式，迁移到新格式
2. **API 兼容**: 保留 `getReputation(peerId)` 作为别名
3. **消息兼容**: 不带 `toAgent` 的消息广播到所有 Agent
4. **配置兼容**: 不配置 `agents` 时，自动创建默认 Agent

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据迁移失败 | 高 | 备份 + 回滚机制 |
| 性能下降 | 中 | 懒加载 + 缓存 |
| 兼容性问题 | 中 | 渐进式迁移 + 兼容层 |

---

**文档结束**