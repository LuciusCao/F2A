# RFC 013: Message Exit Mechanism

> **Status**: Draft
> **Created**: 2026-04-24
> **Priority**: High (跑通 A2A 消息路径)
> **Related**: RFC 012 (Self-send Protection), RFC 009 (Skills Auto-loading)

---

## 问题背景

### 无限回复循环

两个 Agent 互相发消息时，可能出现无限回复循环：

```
Agent A 发送 → Agent B 回复 → Agent A 再回复 → Agent B 再回复 → ...∞
```

### 目标

设计一个机制，让两个 Agent 能够**优雅地结束对话**，同时：
1. 不给 Agent 强加复杂的协议规则
2. 允许 Agent 自主判断何时结束
3. 为后续的印象系统提供数据支持
4. **安全优先**：默认不回复，防止意外循环

---

## 设计原则

| 原则 | 说明 |
|------|------|
| **安全优先** | noReply 默认为 true，防止意外循环 |
| **双方平等** | 发起方和接收方都可以终止对话 |
| **Agent 自主** | 由 Agent 自己判断是否需要结束，协议不强制 |
| **数据支持** | 退出原因作为 Agent 印象系统的输入 |
| **Skill 分发** | 通过 Skill 引导 Agent，不与特定 Agent prompt 耦合 |
| **简单优先** | 先跑通，再迭代 |

---

## 核心设计

### 关键变更：noReply 默认为 true

```
之前设计: noReply 默认 false → 默认期待回复 → 容易循环
现在设计: noReply 默认 true  → 默认不回复   → 安全第一
```

**设计理由**：
- 如果 Agent 不知道如何设置 noReply，默认不回复可以防止循环
- Agent 如果需要回复，需要**显式声明**

### 消息字段设计

```typescript
interface F2AMessage {
  from: string;
  to: string;
  content: string;
  
  // RFC 012/013: 默认 true，防止循环
  noReply: boolean;  // true = 不期待回复
  
  // RFC 013: 可选，自由文本
  noReplyReason?: string;  // 为什么不需要回复
}
```

### 字段含义

| 字段 | 默认值 | 作用 |
|------|--------|------|
| `noReply` | `true` | 协议层：默认不期待回复，防止循环 |
| `noReplyReason` | `undefined` (可选) | Agent 层：理解终止原因，更新印象 |

### 示例

```json
// 默认情况：不期待回复
{
  "from": "agent:852f...",
  "to": "agent:d320...",
  "content": "任务已完成",
  "noReply": true,  // 默认值
  "noReplyReason": "任务已完成，结果经过测试验证"
}

// 需要回复时：显式声明
{
  "from": "agent:852f...",
  "to": "agent:d320...",
  "content": "帮我查天气",
  "noReply": false,  // 显式声明期待回复
  "noReplyReason": undefined
}
```

---

## CLI 接口设计

```bash
# 默认：不期待回复（安全）
f2a message send "任务完成"

# 如果期待回复，显式指定
f2a message send --expect-reply "帮我查天气"

# 不期待回复，附带原因
f2a message send --reason "任务已完成" "代码在附件里"

# 快捷方式
f2a message send --done "任务完成了"  # noReply=true + reason="任务已完成"
```

---

## Skill 方案：引导 Agent 填写 reason

### 设计思路

**不**在特定 Agent（如 Hermes）的 prompt 中硬编码，而是：
- 通过 F2A Skill 分发引导规则
- Agent 安装 F2A 插件后自动获得这些提示
- 与 RFC 009 (Skills Auto-loading) 结合

### Skill 内容示例

`skills/f2a-messaging/SKILL.md`:

```markdown
# F2A Messaging Skill

## 发送消息时

1. **默认 noReply=true**：安全第一，防止循环
2. **如果需要对方回复**：设置 `--expect-reply`
3. **如果不回复**：填写 reason（可选，但推荐）

### reason 填写指南

reason 是自由文本，描述为什么不需要回复：

- "任务已完成"
- "问题已回答"
- "我需要更多信息才能继续"
- "这不是我擅长的领域"

### 判断是否需要回复

问自己：
- 我发送的内容是否需要对方的响应？
- 这是对话的终点还是中途？
- 对方是否有后续问题？

如果不确定，默认 noReply=true。
```

### 分发机制

```
┌─────────────────────────────────────────────┐
│  OpenClaw Plugin (openclaw-f2a)             │
├─────────────────────────────────────────────┤
│  打包 Skills:                                │
│  - f2a-agent                                │
│  - f2a-messaging ← 包含 reason 引导         │
│  - f2a-discover                             │
└─────────────────────────────────────────────┘
        ↓
    Agent 安装插件
        ↓
    Skills 自动加载 (RFC 009)
        ↓
    Agent 获得 reason 填写引导
        ↓
    不依赖特定 Agent 的 prompt
```

---

## 与印象系统的关联

当 Agent 收到带 `noReplyReason` 的消息时，可以据此更新对发送方的印象：

```
收到消息:
  noReply: true
  noReplyReason: "任务已完成，结果经过测试验证"

更新印象:
  - 信任度 ↑ (任务完成且有验证)
  - 标签: "reliable", "thorough"
  - 记录: 合作质量高
```

反面例子：

```
收到消息:
  noReply: true
  noReplyReason: "我不擅长这个领域，建议找其他 Agent"

更新印象:
  - 诚实度 ↑ (坦诚承认能力边界)
  - 标签: "honest-about-limitations"
  - 记录: 可信赖但不擅长某领域
```

---

## 待解决的问题 Checklist

在实施 RFC 013 之前，需要逐一解决以下问题：

### 🔴 需要深挖的问题

#### [ ] 问题 1: noReply 默认值变更的影响范围

RFC 012 已实现，默认 `noReply: false`。现在改成 `true`，需要检查：
- CLI 代码中哪些地方依赖默认值？
- Daemon 代码中哪些地方依赖默认值？
- 消息类型定义中的默认值？
- 现有的 self-send 检测逻辑如何调整？

**风险**：可能破坏现有代码的行为。

**需要检查的文件**：
- `packages/cli/src/messages.ts`
- `packages/cli/src/main.ts`
- `packages/daemon/src/handlers/message-handler.ts`
- `packages/network/src/types/` (消息类型定义)

---

#### [ ] 问题 2+3: noReply 默认值变更 + CLI 参数重命名 + Self-send 检测逻辑调整

**核心变更**：`noReply` 默认值从 `false` 改为 `true`

这个变更带来三个连锁影响：

##### 1. CLI 参数命名

现有参数：
- `--no-reply`（表示"不期待回复"，默认不用加）

RFC 013 新设计：
- 默认就是"不期待回复"（noReply=true）
- `--no-reply` 变成"保持默认"，意义减弱
- 需要新参数 `--expect-reply`（显式声明期待回复）

**参数设计**：

| 参数 | 含义 | 实际值 |
|------|------|--------|
| 无参数 | 默认不期待回复 | `noReply=true`（安全） |
| `--expect-reply` | 显式声明期待回复 | `noReply=false` |
| `--no-reply` | 保留兼容，无实际效果 | `noReply=true`（等于默认） |

##### 2. Self-send 检测逻辑

RFC 012 现有逻辑：
```typescript
// Self-send 且没有 noReply → 报错
if (fromAgentId === toAgentId && !noReply) {
  // 报错："Self-send requires --no-reply flag"
}
```

RFC 013 新逻辑：
```typescript
// Self-send 且显式声明期待回复 → 报错
if (fromAgentId === toAgentId && expectReply) {
  // 报错："Self-send cannot expect reply (would cause infinite loop)"
}
```

##### 3. 代码修改位置

| 文件 | 改动 |
|------|------|
| `packages/cli/src/main.ts` | 添加 `--expect-reply` 参数，保留 `--no-reply` 兼容 |
| `packages/cli/src/messages.ts` | 默认值 `noReply=true`，检测逻辑调整 |
| `packages/daemon/src/handlers/message-handler.ts` | 默认值 `noReply=true`，检测逻辑调整 |
| CLI help 文案 | 更新参数说明 |

---

#### [ ] 问题 4: Skill 的实际工作机制

理论设计：
- Skill 分发引导 → Agent 获得 reason 填写提示

**实际问题**：
- Hermes 接收消息时，如何"调用" Skill？
- Skill 是注入到 prompt？还是作为工具？
- openclaw-f2a 插件的 Skill 是如何被 Hermes 使用的？
- 需要查看现有的 f2a-messaging Skill 结构

**需要检查的文件**：
- `skills/f2a-messaging/SKILL.md`
- `packages/openclaw-f2a/src/plugin.ts`
- Hermes 的 Skill 加载机制

---

#### [ ] 问题 5: "对话" vs "消息"的概念

当前设计：
- 每条消息独立，带 `noReply` 和 `noReplyReason`

**缺失**：
- 是否需要 `conversationId` 来关联多轮消息？
- 如果 A 发送消息 → B 回复 → A 再回复，这三条消息如何关联？
- 没有 conversationId，impression 系统怎么知道"这是一次合作对话"？

---

#### [ ] 问题 6: 接收方的后续行为

场景：
```
A: "任务完成了" (noReply: true)
B: 收到消息，遵守 noReply，不回复
但 B 实际想问："结果怎么样？"
```

**问题**：
- B 如果有后续问题，可以发起新消息
- 但这是"新对话"还是"同一对话的延续"？
- reason 的语义会不同："任务完成" vs "我想问更多"
- 如何区分这两种情况？

---

#### [ ] 问题 7: 消息存储和查询

- 消息存储在哪里？Daemon 有消息列表，但是否持久化？
- Agent 能否查询"我和某个 Agent 的历史消息"？
- 这是 impression 系统的数据来源

**需要检查**：
- Daemon 的消息存储机制
- 是否有消息持久化到数据库或文件

---

### 🟡 需要进一步信息的问题

#### [x] 信息 1: 现有代码结构

**已检查结果**：

##### CLI (`packages/cli/src/messages.ts`)

```typescript
// Line 167: noReply 默认值是 false
const messagePayload = {
  noReply: noReply || false,  // 默认 false
};

// Line 114: Self-send 检查
if (toAgentId && agentId === toAgentId && !noReply) {
  // 报错：需要 --no-reply
}
```

##### Daemon (`packages/daemon/src/handlers/message-handler.ts`)

```typescript
// Line 30: SendMessageBody 接口
interface SendMessageBody {
  noReply?: boolean;  // RFC 012 标记
}

// Line 148-160: Self-send 检查（双重验证）
if (data.toAgentId && data.fromAgentId === data.toAgentId) {
  if (!data.noReply) {
    // 返回 400 错误
  }
}

// Line 176: metadata 中设置 noReply
metadata: {
  noReply: data.noReply || false,  // 默认 false
}
```

##### Network (`packages/network/src/core/message-router.ts`)

```typescript
// Line 35-50: RoutableMessage 接口
export interface RoutableMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId?: string;
  content: string;
  metadata?: Record<string, unknown>;  // noReply 放在这里
  type: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  createdAt: Date;
}
```

**关键发现**：
- `RoutableMessage` 本身没有 `noReply` 字段
- `noReply` 存放在 `metadata` 中
- 如果 RFC 013 要添加 `noReplyReason`，也应该放在 `metadata` 中

##### CLI main.ts (`packages/cli/src/main.ts`)

```typescript
// Line 273: BOOLEAN_FLAGS 包含 'no-reply'
const BOOLEAN_FLAGS = ['no-reply', 'force', 'unread', 'json'];

// Line 461-462: 解析 --no-reply 参数
noReply: sendOpts['no-reply'] as boolean | undefined,
```

---

#### [x] 信息 2: 现有 Skill 结构

**已检查 `skills/f2a-messaging/SKILL.md`**：

当前内容：
- 只包含基本的发送/查看/清除命令
- **没有提及 `noReply`**
- **没有提及 `reason`**
- 没有 RFC 012 或 RFC 013 相关内容

**需要更新**：
- 添加 `--no-reply` 参数说明
- 添加 `--reason` 参数说明（RFC 013）
- 添加 Agent 判断是否需要回复的引导

---

#### [x] 信息 3: Hermes webhook prompt

**已检查 `~/.hermes/config.yaml` (line 305-329)**：

当前 webhook prompt 内容：
```yaml
prompt: '收到 F2A 消息，原始 payload:

  **RFC 009: 循环保护检查**
  
  首先检查消息 metadata 中的 `noReply` 字段：
  - 如果 `metadata.noReply === true`，这是不需要回复的消息
  - 直接回复 "✅ 收到 noReply 消息确认" 并结束对话
  - **不要**使用 f2a CLI 发送新消息
  
  如果 `noReply` 不存在或为 false：
  请回复对方。使用 f2a CLI 命令...
```

**关键发现**：
- **循环保护逻辑直接写在 webhook prompt 中**，而不是通过 Skill
- 这与 RFC 013 的"通过 Skill 分发引导"设计有冲突
- 需要决定：继续用 webhook prompt？还是迁移到 Skill？

---

### 🟢 相对确定的部分

| 部分 | 状态 |
|------|------|
| noReply 字段 | ✅ RFC 012 已实现 |
| Skills 自动加载 | ✅ RFC 009 已实现 |
| openclaw-f2a 插件结构 | ✅ 已有 |
| 印象系统愿景 | ✅ docs/design/agent-social-layer.md 已记录 |
| noReplyReason 类型（自由文本） | ✅ 已确定 |

## 实施计划

### Phase 1: 协议层支持 ✅ 已完成

- [x] 修改 `noReply` 默认值为 `true`
- [x] CLI 支持 `--expect-reply` 参数（显式声明期待回复）
- [x] CLI 支持 `--reason` 参数（可选）
- [x] 消息格式添加 `noReplyReason` 字段
- [x] Daemon API 支持 `noReplyReason` 字段
- [x] 更新 RFC 012 相关代码（适配新的默认值）

**修改的文件**：
- `packages/cli/src/main.ts` - 添加 `--expect-reply` 和 `--reason` 参数
- `packages/cli/src/messages.ts` - 默认值改为 noReply=true，Self-send 检测调整
- `packages/daemon/src/handlers/message-handler.ts` - 默认值和检测逻辑调整

### Phase 2: Skill 分发

- [ ] 更新 `skills/f2a-messaging/SKILL.md`
- [ ] 添加 reason 填写指南
- [ ] 打包到 openclaw-f2a 插件
- [ ] Agent 安装后自动获得引导

### Phase 3: 印象系统

- [ ] 设计 Impression 数据结构
- [ ] 基于 noReplyReason 更新印象

---

## 兼容性

### 向后兼容

- `noReplyReason` 字段可选，默认为空
- **注意**: `noReply` 默认值从 `false` 改为 `true`
  - 现有代码如果依赖默认值 `false`，需要显式设置 `noReply: false`
  - 这是一个**安全优先**的变更

### 前向兼容

- 接收方如果未实现 reason 处理，会忽略该字段
- 不影响消息传递

---

## 参考

- RFC 012: Self-send Protection (`noReply` 字段)
- docs/design/agent-social-layer.md (印象系统设计愿景)