# Phase 1: Conversation Layer Design

> 状态：Draft，等待审阅批准后进入实施计划。

---

## 背景

F2A 已经具备基础消息投递能力：CLI 通过 Daemon 发送消息，Daemon 使用 MessageRouter 将消息投递到本地 callback、Agent webhook 或内存队列。RFC013 已把 `noReply` 默认设为 true，解决 A2A 无限回复循环的第一层安全问题。

下一步需要让 Agent 的多轮互动具备稳定上下文。没有 Conversation Layer，消息只能作为独立事件存在，后续的通讯录、印象系统、协作空间都缺少可靠数据源。

仓库中已经存在 `packages/network/src/core/message-store.ts`，基于 SQLite 和 `better-sqlite3` 实现了消息历史存储，但目前它还没有被 Daemon 消息链路系统性接入，也缺少会话维度字段。

---

## 目标

Phase 1 的目标是建立最小可用的会话层：

- 所有 Daemon 发送/接收的 Agent 消息可以持久化到 SQLite。
- 每条消息有可选 `conversationId` 和 `replyToMessageId`。
- Daemon API 可以按 Agent 和 conversation 查询历史消息。
- CLI 可以查看会话列表和某个会话的消息。
- 设计保留对未来摘要、印象和协作系统的扩展点。

---

## 非目标

Phase 1 不实现以下内容：

- 分布式消息同步或云端漫游。
- 复杂对话摘要。
- 自动信任评分或印象系统。
- 任务市场、竞标、经济系统。
- 全量 Dashboard 改造。

---

## 推荐方案

### 方案 A：接入现有 MessageStore 并增量扩展

复用现有 SQLite MessageStore，增加会话字段和查询方法，然后在 Daemon 的 MessageHandler/MessageRouter 链路中写入消息。

优点：

- 改动小，符合当前代码资产。
- 能快速跑通持久化历史查询。
- 测试可以集中在 Store、Handler、CLI 三层。

缺点：

- MessageStore 当前结构偏通用消息记录，后续可能需要再次演进 schema。

### 方案 B：新建 ConversationStore

新增独立 ConversationStore，专门管理 conversations/messages 两张表。

优点：

- 数据模型更干净，适合长期 Social Layer。
- Conversation 概念天然是一等对象。

缺点：

- 当前已有 MessageStore 会被边缘化，短期重复。
- 改动面更大。

### 方案 C：只扩展内存队列

在 QueueManager 中增加 conversation 字段和查询。

优点：

- 最快，改动最小。

缺点：

- Daemon 重启即丢失，不满足 Social Layer 的基础要求。
- 无法支撑搜索、印象和长期上下文。

推荐采用方案 A：先接入现有 MessageStore，并把字段设计成可迁移到 ConversationStore 的形态。

---

## 数据模型

### MessageRecord 扩展

建议在现有 `messages` 表基础上增加字段：

- `conversation_id TEXT`
- `reply_to_message_id TEXT`
- `direction TEXT`：`inbound`、`outbound`、`local`
- `agent_id TEXT`：本地视角 Agent。
- `peer_agent_id TEXT`：对方 Agent。
- `metadata TEXT`：JSON 序列化 metadata。
- `created_at INTEGER`：保留 timestamp 兼容，或逐步用 created_at 命名统一。

最小兼容策略：

- 保留现有 `id/from/to/type/timestamp/summary/payload`。
- 用 `ALTER TABLE ADD COLUMN` 做幂等迁移。
- 新字段可以为空，旧消息仍可查询。

### ConversationId 生成

规则：

- 如果请求显式携带 `conversationId`，直接使用。
- 如果携带 `replyToMessageId` 且能查到原消息，沿用原消息 conversationId。
- 否则新建 `conv-${randomUUID()}`。

这样既支持新 CLI/API，也兼容旧客户端。

---

## API 设计

### POST /api/v1/messages

请求体新增可选字段：

```json
{
  "conversationId": "conv-...",
  "replyToMessageId": "msg-..."
}
```

响应体返回：

```json
{
  "success": true,
  "messageId": "msg-...",
  "conversationId": "conv-..."
}
```

### GET /api/v1/messages/:agentId

保留现有接口，增加查询参数：

- `conversationId`
- `peerAgentId`
- `limit`

### GET /api/v1/conversations/:agentId

新增接口，返回某个 Agent 的会话摘要列表：

```json
{
  "success": true,
  "agentId": "agent:...",
  "conversations": [
    {
      "conversationId": "conv-...",
      "peerAgentId": "agent:...",
      "lastMessageAt": 1710000000000,
      "messageCount": 3,
      "lastSummary": "..."
    }
  ]
}
```

---

## CLI 设计

在 `f2a message` 下新增：

```bash
f2a message conversations --agent-id <agentId>
f2a message thread --agent-id <agentId> --conversation-id <conversationId>
```

发送消息时新增：

```bash
f2a message send --agent-id <agentId> --to <targetAgentId> --conversation-id <convId> "..."
f2a message send --agent-id <agentId> --to <targetAgentId> --reply-to <messageId> "..."
```

输出要求：

- 文本模式展示会话 ID、对方 Agent、最后消息时间和摘要。
- JSON 模式返回结构化字段，方便 MCP/Agent 调用。

---

## 写入位置

建议第一版在 Daemon `MessageHandler.handleSendMessage()` 中写 outgoing/local 持久化，因为这里已经拥有 from/to/content/type/metadata/noReply 的完整请求上下文。

同时要考虑 webhook/queue 的入站消息。远程入站消息进入本地 Agent 时，最终通过 MessageRouter 路由，也需要落库。第一版可以在 MessageRouter 增加可选 `messageStore` 依赖，路由成功前后记录 inbound/local 消息。

为了控制范围，实施可分两步：

1. 先记录通过 Daemon API 发出的消息和本地投递消息。
2. 再补齐 P2P 远程入站路径。

---

## 错误处理

- 消息投递成功但历史写入失败：发送接口不应直接失败，但需要记录日志，并在响应中可选返回 `historyPersisted: false`。
- 查询历史失败：返回 500 和稳定错误码 `MESSAGE_HISTORY_FAILED`。
- 无效 conversationId/replyTo：返回 400 和 `INVALID_CONVERSATION_REFERENCE`。

---

## 测试策略

### Store 单元测试

- schema migration 幂等。
- 新消息写入包含 conversationId/replyTo。
- 按 agent、peerAgent、conversation 查询。
- 旧记录缺少新字段时查询不崩溃。

### Daemon handler 测试

- POST /messages 返回 conversationId。
- replyTo 能沿用原 conversation。
- GET /messages 支持 conversationId 过滤。
- GET /conversations 返回摘要列表。

### CLI 测试

- `message send --conversation-id` 参数解析。
- `message send --reply-to` 参数解析。
- `message conversations` 和 `message thread` JSON/文本输出。

---

## 验收标准

- Daemon 重启后仍能查询历史消息。
- 一次多轮 A2A 对话可以关联到同一个 conversation。
- CLI/API 可以查看 Agent 与指定对方的会话历史。
- 旧消息接口保持兼容，不破坏现有 `message list/clear/send`。

---

## 开放问题

1. Phase 1 是否要求一次性覆盖 P2P 远程入站路径，还是先覆盖 Daemon API 发送链路？
2. 是否要把 `conversationId` 提升到 `RoutableMessage` 顶层字段，还是第一版继续放在 metadata 中并由 MessageStore 解析？

推荐答案：

- 第一版先覆盖 Daemon API 发送链路和本地投递，再补 P2P 入站路径。
- `conversationId` 应提升为 `RoutableMessage` 顶层字段，metadata 只保留扩展信息。

