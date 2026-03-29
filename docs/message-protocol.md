# F2A 消息协议

> 简化的两层协议设计，适合 AI-to-AI 对话

---

## 设计理念

F2A 协议采用**两层设计**，将网络基础设施与 Agent 语义分离：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: Agent 协议层（语义层）                                      │
│  - MESSAGE: 自由通信，AI-to-AI 对话                                   │
│  - SKILL_*: 技能交换（可选扩展）                                       │
│  职责：Agent 之间的语义交互，内容由 Agent 自由解释                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↑ 使用网络层传输
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1: 网络层协议（基础设施）                                       │
│  - DISCOVER / DISCOVER_RESP: Agent 发现                              │
│  - PING / PONG: 连接心跳                                             │
│  - DECRYPT_FAILED: 加密通道异常通知                                   │
│  职责：维护 P2P 网络连接、节点发现、基础健康检查                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 为什么两层？

**传统 RPC 模式的问题**：

- `TASK_REQUEST` / `TASK_RESPONSE` 是为人类 API 设计的
- 需要预定义 schema，AI Agent 之间难以灵活交互
- 协议扩展需要修改代码

**两层设计的优势**：

1. **网络层**：由 SDK 自动处理，Agent 无需关心
2. **Agent 层**：完全自由的消息格式，由 Agent 自己解释语义
3. **向后兼容**：旧的 `task.request` 等主题仍可通过 MESSAGE 传输

---

## Layer 1: 网络层协议

网络层协议由 F2A SDK 自动处理，Agent 通常不需要直接使用。

### DISCOVER / DISCOVER_RESP

**用途**：Agent 发现，节点之间交换身份信息

```typescript
// DISCOVER 广播
{
  id: "uuid",
  type: "DISCOVER",
  from: "12D3KooW...",
  timestamp: 1700000000000,
  payload: {
    agentInfo: {
      peerId: "12D3KooW...",
      displayName: "My Agent",
      capabilities: [...],
      ...
    }
  }
}

// DISCOVER_RESP 响应
{
  id: "uuid",
  type: "DISCOVER_RESP",
  from: "12D3KooW...",
  to: "12D3KooW...",  // 响应给特定的发现者
  timestamp: 1700000000000,
  payload: {
    agentInfo: { ... }
  }
}
```

**处理逻辑**：
- SDK 自动响应 DISCOVER，返回本地 Agent 信息
- 收到 DISCOVER_RESP 后，更新本地节点路由表
- 触发 `peer:discovered` 事件

### PING / PONG

**用途**：连接心跳，检测节点是否在线

```typescript
// PING
{
  id: "uuid",
  type: "PING",
  from: "12D3KooW...",
  timestamp: 1700000000000,
  payload: {}
}

// PONG
{
  id: "uuid",
  type: "PONG",
  from: "12D3KooW...",
  to: "12D3KooW...",
  timestamp: 1700000000001,
  payload: {}
}
```

**处理逻辑**：由 libp2p 自动处理

### DECRYPT_FAILED

**用途**：端到端加密失败通知

```typescript
{
  id: "uuid",
  type: "DECRYPT_FAILED",
  from: "12D3KooW...",
  to: "12D3KooW...",
  timestamp: 1700000000000,
  payload: {
    originalMessageId: "原消息ID",
    error: "DECRYPTION_FAILED",
    message: "Unable to decrypt message. Key exchange may be incomplete."
  }
}
```

**处理逻辑**：
- 收到后尝试重新建立加密通道
- 触发 `error` 事件通知上层

---

## Layer 2: Agent 协议层

Agent 协议层使用单一的 `MESSAGE` 类型，通过 `topic` 区分不同用途。

### MESSAGE

**用途**：Agent 之间的所有通信

```typescript
interface StructuredMessagePayload {
  /** 消息主题（区分消息类型），必须匹配 `/^[a-z0-9]+([.-][a-z0-9]+)*$/` 格式
   * - 只允许小写字母、数字、点号、连字符
   * - 不允许连续点号或连字符（如 `a..b` 或 `a--b`）
   * - 最大长度 256 字符
   */
  topic?: string;
  /** 消息内容（文本或结构化对象） */
  content: string | Record<string, unknown>;
  /** 引用的消息 ID（用于回复链） */
  replyTo?: string;
}

{
  id: "uuid",
  type: "MESSAGE",
  from: "12D3KooW...",
  to: "12D3KooW...",
  timestamp: 1700000000000,
  payload: {
    topic: "chat",  // 可选
    content: "你好，帮我写个函数",  // 可以是任意内容
    replyTo: "previous-message-id"  // 可选
  }
}
```

### 预定义 Topic

SDK 定义了一些常用的 topic 值，用于保持向后兼容：

| Topic | 用途 | content 结构 |
|-------|------|-------------|
| `task.request` | 任务请求 | `{ taskId, taskType, description, parameters }` |
| `task.response` | 任务响应 | `{ taskId, status, result, error }` |
| `capability.query` | 能力查询 | `{ capabilityName }` |
| `capability.response` | 能力响应 | `{ agentInfo }` |
| `chat` | 自由对话 | 任意文本或对象 |

### 自由对话示例

```typescript
// Agent A 发送消息
await f2a.sendMessageToPeer(peerIdB, "你能帮我分析这段代码吗？", "chat");

// Agent B 回复
await f2a.sendMessageToPeer(peerIdA, "当然可以，请把代码发给我", "chat");
```

### 结构化任务请求示例

```typescript
// 发送任务请求
await f2a.p2pNetwork.sendFreeMessage(peerId, {
  topic: MESSAGE_TOPICS.TASK_REQUEST,
  content: {
    taskId: "task-uuid",
    taskType: "code-generation",
    description: "写一个斐波那契函数",
    parameters: { language: "python" }
  }
});

// 收到请求后处理
f2a.on('peer:message', async (event) => {
  if (event.topic === 'task.request') {
    const { taskId, taskType, description, parameters } = event.content;
    // 执行任务...
    const result = await executeTask(taskType, parameters);
    
    // 发送响应
    await f2a.sendMessageToPeer(event.from, {
      topic: MESSAGE_TOPICS.TASK_RESPONSE,
      content: { taskId, status: 'success', result },
      replyTo: event.messageId
    });
  }
});
```

---

## 最佳实践

### 1. 优先使用 MESSAGE

新代码应该使用 `MESSAGE` 类型：

```typescript
// ✅ 推荐
await f2a.sendMessageToPeer(peerId, content, topic);

// ❌ 旧方式（兼容支持但不推荐）
await f2a.delegateTask({ capability, description, parameters });
```

### 2. Agent 自定义语义

Agent 可以定义自己的 topic 和 content 结构：

```typescript
// 定义自己的协议
const MY_TOPIC = "my-agent.custom-protocol";

await f2a.sendMessageToPeer(peerId, {
  topic: MY_TOPIC,
  content: {
    action: "analyze",
    data: { ... },
    options: { ... }
  }
});
```

### 3. 错误处理

使用 MESSAGE 发送错误响应：

```typescript
await f2a.sendMessageToPeer(peerId, {
  topic: 'task.response',
  content: {
    taskId,
    status: 'error',
    error: '具体错误信息'
  },
  replyTo: originalMessageId
});
```

---

## 迁移指南

### 从 TASK_REQUEST 迁移

```typescript
// 旧代码
const message = {
  type: 'TASK_REQUEST',
  payload: { taskId, taskType, description, parameters }
};

// 新代码
const message = {
  type: 'MESSAGE',
  payload: {
    topic: 'task.request',
    content: { taskId, taskType, description, parameters }
  }
};
```

### 从 CAPABILITY_QUERY 迁移

```typescript
// 旧代码
const message = {
  type: 'CAPABILITY_QUERY',
  payload: { capabilityName: 'code-generation' }
};

// 新代码
const message = {
  type: 'MESSAGE',
  payload: {
    topic: 'capability.query',
    content: { capabilityName: 'code-generation' }
  }
};
```

---

## 事件变更

### 新增事件

```typescript
// peer:message - 通用消息事件
f2a.on('peer:message', (event) => {
  console.log(`Message from ${event.from}:`, event.content);
  console.log(`Topic: ${event.topic}`);
});
```

### 废弃事件

以下事件仍支持但不推荐：

- `task:request` → 使用 `peer:message` + `topic === 'task.request'`
- `task:response` → 使用 `peer:message` + `topic === 'task.response'`

---

## 类型定义参考

```typescript
// 网络层消息类型
export type NetworkMessageType = 
  | 'DISCOVER'
  | 'DISCOVER_RESP'
  | 'PING'
  | 'PONG'
  | 'DECRYPT_FAILED';

// Agent 协议层消息类型
export type AgentMessageType = 
  | 'MESSAGE';

// 消息主题常量
export const MESSAGE_TOPICS = {
  TASK_REQUEST: 'task.request',
  TASK_RESPONSE: 'task.response',
  CAPABILITY_QUERY: 'capability.query',
  CAPABILITY_RESPONSE: 'capability.response',
  FREE_CHAT: 'chat',
} as const;

// 结构化消息载荷
export interface StructuredMessagePayload {
  /** 消息主题，必须匹配 `/^[a-z0-9]+([.-][a-z0-9]+)*$/` 格式
   * - 只允许小写字母、数字、点号、连字符
   * - 不允许连续点号或连字符
   * - 最大长度 256 字符
   */
  topic?: string;
  content: string | Record<string, unknown>;
  /** 引用的消息 ID，最大长度 128 字符 */
  replyTo?: string;
}

// 消息事件
export interface MessageEvent {
  messageId: string;
  from: string;
  content: string | Record<string, unknown>;
  topic?: string;
  replyTo?: string;
}
```