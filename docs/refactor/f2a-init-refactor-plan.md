# f2a init 命令重构计划

> 创建时间：2026-04-20 17:09
> 最后更新：2026-04-20 17:14
> 状态：Draft - 已确认正确方向

---

## 背景

用户发现 CLI 设计存在以下问题：

1. `f2a init` 创建的 config.json 包含 `agentName`，但这只是 Node 初始化，不应该涉及 Agent
2. `nodeId` 和 `peerId` 概念混淆：当前 `nodeId = peerId[:16]`（截断），语义不清
3. `control-token` 用途没有文档说明

---

## 核心目标（已确认）

### 概念分层

```
┌─────────────────────────────────────────────┐
│  F2A 层（用户/API 对外）                    │
│  nodeId = Node 的标识                       │
│  值 = peerId 完整值（不截断）               │
└─────────────────────────────────────────────┘
                    ↓ 内部映射
┌─────────────────────────────────────────────┐
│  libp2p 层（实现细节）                      │
│  peerId = libp2p PeerId                     │
│  用于 P2P 网络通信（dial, DHT, mDNS）       │
└─────────────────────────────────────────────┘
```

### 关键原则

1. **node-identity.json 用 `nodeId` 字段名**（F2A 概念）
2. **libp2p 层还是用 PeerId**（实现细节，不暴露给用户）
3. **F2A 对外 API 用 nodeId**（getNodeId(), Agent.nodeId 等）
4. **Agent.nodeId = Node.nodeId**（完整值，不截断）

---

## 当前设计问题

### 问题 1：nodeId = peerId[:16] 截断

```typescript
// node-identity.ts 第 245 行
const generatedNodeId = peerIdString.slice(0, 16);
this.nodeId = generatedNodeId;
```

**问题**：
- 截断导致 nodeId 和 peerId 语义混乱
- 用户不理解为什么有两个概念
- 1023 处代码引用 nodeId/peerId，维护成本高

### 问题 2：config.json 含 agentName

```json
{
  "agentName": "user-hostname",  // ← Node init 时不应有这个
  "network": { ... }
}
```

**问题**：
- Node 和 Agent 层级混淆
- `f2a init` 只应初始化 Node Identity

### 问题 3：control-token 用途不清

当前没有文档说明 control-token 是用于 CLI ↔ Daemon 本地管理认证。

---

## 正确设计（已确认）

### 文件结构

```
~/.f2a/
├── node-identity.json    # Node Identity（F2A 概念）
│   {
│     "nodeId": "12D3KooW...",  // 完整 peerId 值，字段名是 nodeId
│     "e2eePublicKey": "...",
│     "e2eePrivateKey": "...",
│     "createdAt": "...",
│     "lastUsedAt": "..."
│   }
├── config.json           # Node 配置（移除 agentName）
├── control-token         # CLI ↔ Daemon 认证
└── agents/               # Agent 身份
    └── agent:{id}.json
        {
          "agentId": "agent:a1b2c3...",
          "nodeId": "12D3KooW...",  // 签发者的 nodeId，完整值
          ...
        }
```

### NodeIdentityManager API

```typescript
class NodeIdentityManager {
  // libp2p 内部用 peerId
  private peerId: PeerId | null;
  
  // F2A 对外 API 用 nodeId
  getNodeId(): string {
    return this.peerId?.toString() || this.nodeId;  // 完整值
  }
  
  // 内部方法，用于 libp2p 操作
  getPeerId(): PeerId | null {
    return this.peerId;
  }
  
  // 日志显示用截断版本（不影响存储）
  getShortNodeId(): string {
    return this.getNodeId().slice(0, 16);
  }
}
```

---

## 重构计划

### Phase 1: `f2a init` 命令重构（CLI 层，低风险）

#### 1.1 config.ts 改动

**移除 agentName 必填项**：

```typescript
// 当前 RequiredConfigSchema
const RequiredConfigSchema = z.object({
  agentName: z.string()...,  // ❌ 移除
  network: z.object(...),
  autoStart: z.boolean().default(false),
});

// 改为
const RequiredConfigSchema = z.object({
  network: z.object(...),
  autoStart: z.boolean().default(false),
});
```

#### 1.2 identity.ts initIdentity() 改动

**移除 agentName 生成逻辑**：

```typescript
// 当前：生成 defaultAgentName
const defaultAgentName = `${process.env.USER}-${hostnameShort}`;

// 改为：移除这段代码，config.json 不含 agentName
```

**添加 control-token 文档注释**：

```typescript
// 创建 control-token
console.log('🔐 Control Token: ✅ Created');
console.log('   Path: ~/.f2a/control-token');
console.log('   用途: CLI ↔ Daemon 本地管理认证');
console.log('   注意: 不是 Agent P2P 认证（Agent 用 Challenge-Response）');
```

#### 1.3 输出改动

**当前输出**（错误）：
```
   Node ID: 12D3KooWEgL6G3   ← 截断版本
   ✅ Created with agentName: "user-hostname" ← 不应该有
```

**正确输出**：
```
   Node ID: 12D3KooWEgL6G3bkQAkMbwBC2w69QHPJNkbQ97Eg4sdTKdDL1MY7 ← 完整值
   Config: ✅ Created (无 agentName)
   下一步: f2a agent init --name <name> 创建 Agent 身份
```

#### 1.4 文件改动清单

| 文件 | 改动 | 影响范围 |
|------|------|----------|
| `config.ts` | RequiredConfigSchema 移除 agentName | 低 |
| `identity.ts` | initIdentity() 移除 agentName 逻辑 | 低 |
| `identity.ts` | 输出 nodeId = 完整值（临时改动，Phase 2 正式改） | 低 |
| `configure.ts` | 移除 agentName 配置项（交互式向导） | 低 |
| `configure.test.ts` | 移除 agentName 相关测试 | 低 |

**测试验证**：
- 运行 `f2a init`，检查 config.json 不含 agentName
- 运行测试确保无破坏性变更

---

### Phase 2: nodeId/peerId 统一（network 包 + CLI，高风险）

#### 2.1 核心改动：node-identity.ts

**nodeId = peerId 完整值（不截断）**：

```typescript
// 当前（错误）
const generatedNodeId = peerIdString.slice(0, 16);  // ❌ 截断

// 改为（正确）
const generatedNodeId = peerIdString;  // ✅ 完整值
```

#### 2.2 NodeIdentityManager API 改动

```typescript
class NodeIdentityManager {
  // 当前：nodeId 存储截断值
  private nodeId: string | null;  // "12D3KooWEgL6G3"
  
  // 改为：nodeId 存储完整值
  private nodeId: string | null;  // "12D3KooWEgL6G3bkQAkMbwBC2w69QHPJNkbQ97Eg4sdTKdDL1MY7"
  
  // 新增：日志显示用短版本
  getShortNodeId(): string {
    return (this.nodeId || '').slice(0, 16);
  }
}
```

#### 2.3 影响范围分析

**高优先级（必须改）**：

| 位置 | 改动 |
|------|------|
| `node-identity.ts` | nodeId = peerId 完整值 |
| `NodeIdentityManager.getNodeId()` | 返回完整值 |
| `identity.ts` 输出 | 完整 nodeId |
| Agent.nodeId 字段 | 写入完整值 |
| `nodeId` 格式验证 | 移除长度限制（允许完整 peerId） |

**中优先级（兼容处理）**：

| 位置 | 改动 |
|------|------|
| 日志输出 | 用 `.slice(0, 16)` 截断显示 |
| 错误消息 | 短 nodeId 显示 |
| `isValidNodeId()` | 允许完整 peerId 长度 |

**低优先级（可能不改）**：

| 位置 | 说明 |
|------|------|
| 外部 API | 如果已有用户依赖短 nodeId，需评估兼容 |
| 数据库存储 | 保持完整值（已经是完整值？需检查） |

#### 2.4 引用点统计

```
1023 处 nodeId/peerId 引用（需逐个检查）

分组策略：
  ├── packages/network/src/core/identity/  → 高优先级
  ├── packages/cli/src/                     → 高优先级
  ├── packages/daemon/src/                  → 中优先级
  └── packages/dashboard/src/               → 低优先级
```

#### 2.5 测试验证

- 运行完整测试套件
- 手动验证：`f2a init` 后 nodeId 是完整值
- 手动验证：Agent 注册后 Agent.nodeId 是完整值
- 检查 Daemon API 返回的 nodeId 格式

---

### Phase 3: 文件结构清理（中风险）

#### 3.1 node-identity.json 结构

**当前结构**（可能含冗余字段）:
```json
{
  "nodeId": "12D3KooW...",  // 截断值 ← Phase 2 已修复
  "peerId": "12D3KooW...",  // 冗余？
  ...
}
```

**最终结构**:
```json
{
  "nodeId": "12D3KooW...",  // 完整值（F2A 概念）
  "e2eePublicKey": "...",
  "e2eePrivateKey": "...",
  "createdAt": "...",
  "lastUsedAt": "..."
  // peerId 字段移除（nodeId 就是 peerId）
}
```

#### 3.2 config.json 结构

**完整示例**：

```json
{
  "network": {
    "bootstrapPeers": [],
    "bootstrapPeerFingerprints": {},
    "enableMDNS": true,
    "enableDHT": false
  },
  "autoStart": false,
  "control": {
    "port": 9001
  },
  "logLevel": "INFO"
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `network.bootstrapPeers` | `string[]` | 否 | 引导节点 multiaddr 列表 |
| `network.bootstrapPeerFingerprints` | `Record<string, string>` | 否 | 引导节点指纹映射 |
| `network.enableMDNS` | `boolean` | 否 | 本地发现（默认 true） |
| `network.enableDHT` | `boolean` | 否 | DHT 发现（默认 false） |
| `autoStart` | `boolean` | 否 | 是否自动启动 daemon |
| `control.port` | `number` | 否 | Daemon 控制端口（默认 9001） |
| `logLevel` | `string` | 否 | 日志级别：DEBUG/INFO/WARN/ERROR |

**注意**：`agentName` 已移除（Phase 1），Agent 名称在 Agent 身份文件中管理。

---

## 任务拆解（可指派给 Subagent）

### Phase 1: CLI 层 agentName 移除（低风险）

#### Task 1.1: config.ts 移除 agentName 必填项

**改动文件**: `packages/cli/src/config.ts`

**改动内容**:
- `RequiredConfigSchema` 移除 `agentName` 字段
- `getDefaultConfig()` 移除 `agentName: "default"`
- `loadConfig()` 移除 `agentName` 默认值逻辑

**验收标准**:
- TypeScript 编译通过
- `F2AConfig` 类型不含 `agentName`

**测试文件**: `packages/cli/src/config.test.ts`
- 移除 `agentName` 相关测试
- 更新测试用例不含 `agentName`

---

#### Task 1.2: identity.ts initIdentity() 移除 agentName

**改动文件**: `packages/cli/src/identity.ts`

**改动内容**:
- 移除 `const defaultAgentName = ...` 变量定义
- 移除 `config.json` 中 `agentName` 字段写入
- 更新输出：移除 `agentName` 相关提示

**验收标准**:
- `f2a init` 创建的 config.json 不含 `agentName`
- TypeScript 编译通过

**测试文件**: `packages/cli/src/identity.test.ts`
- 更新 `initIdentity` 测试用例

---

#### Task 1.3: configure.ts 移除 agentName 配置项

**改动文件**: `packages/cli/src/configure.ts`

**改动内容**:
- 移除 `agentName` 交互式询问
- 移除 `agentName` 配置保存逻辑
- 更新配置摘要显示

**验收标准**:
- TypeScript 编译通过
- 交互式配置不含 `agentName`

**测试文件**: `packages/cli/src/configure.test.ts`
- 移除 `agentName` 相关测试用例

---

#### Task 1.4: Phase 1 验收测试

**验收标准**:
- 运行 `npm test` 全部通过
- 运行 `f2a init`，检查 `~/.f2a/config.json` 不含 `agentName`
- `f2a configure` 交互不含 `agentName`

**提交**: `fix(cli): 移除 config.json 中 agentName，明确 Node/Agent 分层`

---

### Phase 2: nodeId = peerId 完整值（高风险）

#### Task 2.1: node-identity.ts nodeId 生成逻辑

**改动文件**: `packages/network/src/core/identity/node-identity.ts`

**改动内容**:
- 第 245 行：`const generatedNodeId = peerIdString;`（移除 `.slice(0, 16)`）
- 第 347 行、393 行：同样移除截断

**验收标准**:
- TypeScript 编译通过
- `nodeId` 存储完整 peerId 值

---

#### Task 2.2: isValidNodeId 函数放宽长度限制

**改动文件**: `packages/network/src/core/identity/node-identity.ts`

**改动内容**:
- `NODE_ID_MAX_LENGTH` 从 64 改为适合 peerId 长度（约 128）
- 或移除长度限制，只验证格式

**验收标准**:
- 完整 peerId 值可通过 `isValidNodeId()` 验证

---

#### Task 2.3: NodeIdentityManager API 新增 getShortNodeId()

**改动文件**: `packages/network/src/core/identity/node-identity.ts`

**改动内容**:
- 新增 `getShortNodeId(): string` 方法
- 返回 `this.nodeId.slice(0, 16)` 用于日志显示

**验收标准**:
- TypeScript 编译通过
- 新方法可用

---

#### Task 2.4: CLI 层 nodeId 输出改为完整值

**改动文件**: `packages/cli/src/identity.ts`

**改动内容**:
- `initIdentity()` 输出完整 nodeId
- `showIdentityStatus()` 输出完整 nodeId
- 日志显示用 `nodeId.slice(0, 16)` 截断

**验收标准**:
- CLI 输出显示完整 nodeId
- TypeScript 编译通过

---

#### Task 2.5: Agent.nodeId 字段写入完整值

**改动文件**: `packages/cli/src/init.ts`（Agent 身份生成）

**改动内容**:
- `initAgentIdentity()` 中 `nodeId` 字段写入完整值

**验收标准**:
- Agent 身份文件 `nodeId` 是完整值

**测试文件**: `packages/cli/src/init.test.ts`（如存在）

---

#### Task 2.6: Phase 2 验收测试

**验收标准**:
- 运行 `npm run build --workspaces` 全部通过
- 运行 `npm test --workspaces` 全部通过
- 手动测试：`f2a init` 后 nodeId 是完整值
- 手动测试：`f2a agent init` 后 Agent.nodeId 是完整值

**提交**: `fix(network): nodeId = peerId 完整值，统一 F2A 标识符概念`

---

### Phase 3: node-identity.json 结构优化（低风险）

#### Task 3.1: node-identity.json 移除冗余 peerId 字段

**改动文件**: `packages/network/src/core/identity/node-identity.ts` + `types.ts`

**改动内容**:
- `PersistedNodeIdentity` 类型移除 `peerId` 字段
- 加载逻辑兼容旧文件（如有 peerId 字段则忽略）
- 保存逻辑只写 nodeId

**验收标准**:
- 新创建的 node-identity.json 只含 nodeId
- 可加载旧版文件（兼容）

**测试文件**: `packages/network/src/core/identity/node-identity.test.ts`（如存在）

---

#### Task 3.2: Phase 3 验收测试

**验收标准**:
- 运行测试全部通过
- node-identity.json 结构符合预期

**提交**: `refactor: 优化 node-identity.json 结构`

---

## 风险评估

| Phase | 风险 | 原因 | 缓解措施 |
|-------|------|------|---------|
| 1 | 低 | 只改 CLI 层配置，不影响网络协议 | 完整测试覆盖 |
| 2 | 高 | 1023 处引用，影响 Agent 签名、Daemon API | 分步改动，每步测试 |
| 3 | 低 | 文件结构优化，现有设备直接删除重建 | 无需迁移 |

---

## 下一步

按以下顺序执行任务（可指派给 subagent）：

```
Phase 1 (低风险):
  [Task 1.1] config.ts 移除 agentName → subagent-A
  [Task 1.2] identity.ts 移除 agentName → subagent-A
  [Task 1.3] configure.ts 移除 agentName → subagent-B
  [Task 1.4] Phase 1 验收测试 → 主 agent
  → 提交

Phase 2 (高风险):
  [Task 2.1] node-identity.ts nodeId 完整值 → subagent-C (network 专家)
  [Task 2.2] isValidNodeId 放宽限制 → subagent-C
  [Task 2.3] NodeIdentityManager API → subagent-C
  [Task 2.4] CLI nodeId 输出 → subagent-A
  [Task 2.5] Agent.nodeId 完整值 → subagent-A
  [Task 2.6] Phase 2 验收测试 → 主 agent
  → 提交

Phase 3 (低风险):
  [Task 3.1] node-identity.json 结构 → subagent-C
  [Task 3.2] Phase 3 验收测试 → 主 agent
  → 提交
```

---

## 重构完成后处理

重构完成后，需要清理现有设备上的旧文件：

### Mac mini

```bash
# 删除旧的 F2A 数据目录
rm -rf ~/.f2a/

# 重新初始化 Node Identity
f2a init

# 创建 Agent Identity
f2a agent init --name <agent-name>

# 注册到 Daemon
f2a agent register
```

### CatPi

```bash
# 同上，删除并重新初始化
rm -rf ~/.f2a/
f2a init
f2a agent init --name <agent-name>
f2a agent register
```

**注意**：删除后旧的 Agent 身份、注册信息都会丢失，需要重新注册。
```