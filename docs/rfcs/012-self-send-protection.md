# RFC 012: Self-send Protection

> **Status**: Implemented ✅
> **Created**: 2026-04-24
> **Priority**: High (防止无限循环)
> **Related**: RFC 008 (Agent Identity)

---

## 问题背景

### 无限循环场景

当 Agent 发送消息给自己（self-send）时，如果 Hermes 自动回复机制生效，会产生无限循环：

```
Agent A 发消息给 Agent A (自己)
    ↓
Hermes 收到消息，自动回复
    ↓
Agent A 收到回复，再次回复
    ↓
Hermes 收到回复，再次回复
    ↓
... 无限循环
```

### 影响范围

1. **资源浪费**：无限循环消耗 CPU、内存、网络带宽
2. **消息队列拥堵**：大量重复消息占用存储
3. **日志污染**：无限循环产生海量日志
4. **系统不稳定**：可能导致 Daemon 崩溃

---

## 解决方案

### 双重保护机制

```
┌─────────────────────────────────────────────────────────────────┐
│                    Self-send Protection                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────────┐          ┌──────────────────┐            │
│   │   CLI Layer      │          │   Daemon Layer   │            │
│   │                  │          │                  │            │
│   │  检查:           │          │  检查:           │            │
│   │  from === to     │          │  from === to     │            │
│   │  && !noReply     │          │  && !noReply     │            │
│   │      ↓           │          │      ↓           │            │
│   │  拒绝发送        │          │  拒绝处理        │            │
│   │  要求 --no-reply │          │  要求 noReply    │            │
│   │                  │          │                  │            │
│   └──────────────────┘          └──────────────────┘            │
│                                                                  │
│   层级保护:                                                      │
│   - CLI 层: 第一道防线，在命令行直接拦截                          │
│   - Daemon 层: 第二道防线，防止绕过 CLI 的 API 调用               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 详细设计

### 1. CLI 层保护

**位置**: `packages/cli/src/messages.ts`

**逻辑**:
```typescript
// RFC 012: Self-send protection
if (toAgentId && agentId === toAgentId && !noReply) {
  console.error('❌ Error: Self-send requires --no-reply flag.');
  console.error('   This prevents infinite message loops.');
  process.exit(1);
}
```

**命令行参数**:
```bash
# 普通消息（允许自动回复）
f2a message send --agent-id agent:abc123 --to agent:def456 "hello"

# Self-send（必须加 --no-reply）
f2a message send --agent-id agent:abc123 --to agent:abc123 --no-reply "ping test"
```

**错误码**: `SELF_SEND_NO_REPLY_REQUIRED`

### 2. Daemon 层保护

**位置**: `packages/daemon/src/handlers/message-handler.ts`

**逻辑**:
```typescript
// RFC 012: Self-send 保护（Daemon 层双重验证）
if (data.toAgentId && data.fromAgentId === data.toAgentId) {
  if (!data.noReply) {
    res.writeHead(400);
    res.end(JSON.stringify({
      success: false,
      error: 'Self-send requires noReply=true to prevent infinite loops',
      code: 'SELF_SEND_NO_REPLY_REQUIRED',
    }));
    return;
  }
}
```

**API 请求体**:
```json
{
  "fromAgentId": "agent:abc123",
  "toAgentId": "agent:abc123",
  "content": "ping test",
  "noReply": true
}
```

### 3. 消息元数据标记

**位置**: 消息的 `metadata.noReply` 字段

**设计**:
```typescript
const message: RoutableMessage = {
  messageId: randomUUID(),
  fromAgentId: data.fromAgentId,
  toAgentId: data.toAgentId,
  content: data.content,
  metadata: {
    ...data.metadata,
    noReply: data.noReply || false,  // RFC 012: 标记消息不需要回复
  },
  type: data.type || 'message',
  createdAt: new Date(),
};
```

**用途**:
- 接收方（Hermes）检测 `metadata.noReply === true`
- 如果为 true，跳过自动回复逻辑
- 即使 Agent 代码有回复意图，也不执行

### 4. Hermes Prompt 检测

**推荐实现**:

在 Hermes 的系统提示中添加检测逻辑：

```
当收到消息时，检查 message.metadata.noReply 字段：
- 如果 noReply === true，不要回复该消息
- 这是为了防止 self-send 导致的无限循环
```

---

## 类型定义

### SendMessageBody

```typescript
interface SendMessageBody {
  fromAgentId?: string;
  toAgentId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  /** RFC 012: 标记消息不需要回复 (self-send 必须为 true) */
  noReply?: boolean;
}
```

### SendMessageOptions

```typescript
interface SendMessageOptions {
  agentId: string;
  toAgentId?: string;
  content: string;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
  /** RFC 012: Mark message as not expecting reply (required for self-send) */
  noReply?: boolean;
}
```

### RoutableMessage (扩展)

```typescript
interface RoutableMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId?: string;
  content: string;
  type: string;
  createdAt: Date;
  metadata: {
    // ... 其他字段
    /** RFC 012: 消息不需要回复 */
    noReply?: boolean;
  };
}
```

---

## 安全性分析

| 攻击/错误场景 | 保护层 | 结果 |
|--------------|--------|------|
| 用户忘记 `--no-reply` 执行 self-send | CLI 层 | ❌ 被拦截，提示错误 |
| 用户通过 curl 调用 API 执行 self-send | Daemon 层 | ❌ 被拦截，返回 400 |
| 用户正确使用 `--no-reply` | 两层都通过 | ✅ 消息发送成功 |
| 绕过 CLI 直接调用 API（恶意） | Daemon 层 | ❌ 被拦截 |

---

## 使用场景

### 1. Loopback 测试

测试 Agent 消息收发功能：

```bash
# 发送测试消息给自己
f2a message send \
  --agent-id agent:abc123 \
  --to agent:abc123 \
  --no-reply \
  "loopback test: checking message system"
```

### 2. 状态通知

Agent 给自己发送状态更新通知（不需要回复）：

```bash
# 发送状态更新通知
f2a message send \
  --agent-id agent:abc123 \
  --to agent:abc123 \
  --no-reply \
  --type announcement \
  '{"status": "task_completed", "taskId": "xxx"}'
```

### 3. 任务队列

Agent 给自己发送异步任务：

```bash
# 发送延迟任务
f2a message send \
  --agent-id agent:abc123 \
  --to agent:abc123 \
  --no-reply \
  --type task_request \
  '{"action": "cleanup", "delay": "1h"}'
```

---

## 实现清单

### ✅ 已完成

- [x] CLI `--no-reply` 参数
- [x] CLI 层 self-send 检测
- [x] Daemon API `noReply` 字段
- [x] Daemon 层 self-send 检测
- [x] 消息 metadata.noReply 标记
- [x] 错误码 `SELF_SEND_NO_REPLY_REQUIRED`

### 📋 待实现

- [ ] Hermes prompt 检测 `metadata.noReply` 字段
- [ ] 文档更新（API 文档、用户指南）

---

## 兼容性

### 向后兼容

- `noReply` 字段默认为 `false`
- 现有消息发送流程不受影响
- 只有显式设置 `noReply: true` 才会改变行为

### 前向兼容

- 接收方如果未实现 `noReply` 检测，会正常处理消息
- 但可能触发自动回复，导致无限循环（发送方需要知道此风险）

---

## 参考代码

- `packages/cli/src/messages.ts` - CLI 层 self-send 检测
- `packages/cli/src/main.ts` - `--no-reply` 参数解析
- `packages/daemon/src/handlers/message-handler.ts` - Daemon 层验证