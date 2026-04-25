# Conversation Layer 实施计划

> **给 Agentic 工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或当前会话逐任务执行。步骤使用 checkbox（`- [x]`）语法跟踪。

**目标：** 为 F2A Phase 1 增加最小可用 Conversation Layer，让 Daemon API 发送链路和本地投递消息持久化到 SQLite，并通过 API/CLI 查询会话历史。

**架构：** 复用 `@f2a/network` 现有 `MessageStore`，通过幂等迁移扩展会话字段。`ControlServer` 创建并注入 `MessageStore` 到 `MessageHandler`，`MessageHandler` 在发送和查询路径中负责 conversationId 解析、历史写入和历史读取；CLI 增加 conversation/thread 查询命令和 send 参数。第一版覆盖 Daemon API 发送链路和本地投递历史，P2P 远程入站路径后续补齐。

**技术栈：** TypeScript、Node.js ESM、Vitest、better-sqlite3、现有 Daemon HTTP handler/CLI sendRequest 模式。

---

### Task 1: 扩展 MessageStore 会话 schema 和查询能力

**文件：**
- 修改: `packages/network/src/core/message-store.ts`
- 测试: `packages/network/src/core/message-store.test.ts`

- [x] **Step 1: 写失败测试 - 新字段写入与按会话查询**

在 `message-store.test.ts` 增加测试：

```ts
it('应该保存并按 conversationId 查询消息', async () => {
  await store.add(createMessageRecord(
    'msg-1',
    'agent:alice',
    'agent:bob',
    'message',
    Date.now(),
    'hello',
    { content: 'hello' },
    {
      conversationId: 'conv-1',
      replyToMessageId: undefined,
      direction: 'outbound',
      agentId: 'agent:alice',
      peerAgentId: 'agent:bob',
      metadata: { noReply: false }
    }
  ));

  const messages = await store.getByConversation('agent:alice', 'conv-1');

  expect(messages).toHaveLength(1);
  expect(messages[0].conversationId).toBe('conv-1');
  expect(messages[0].agentId).toBe('agent:alice');
  expect(messages[0].peerAgentId).toBe('agent:bob');
});
```

- [x] **Step 2: 运行测试确认失败**

运行: `npm test -w @f2a/network -- src/core/message-store.test.ts`

预期: FAIL，原因是 `createMessageRecord` 不接受第 8 个参数，`getByConversation` 不存在。

- [x] **Step 3: 写最小实现**

在 `MessageRecord` 增加字段：

```ts
conversationId?: string;
replyToMessageId?: string;
direction?: 'inbound' | 'outbound' | 'local';
agentId?: string;
peerAgentId?: string;
metadata?: string;
```

在 `initTables()` 中用 `ALTER TABLE ... ADD COLUMN` 包裹 try/catch 或查询 `PRAGMA table_info(messages)` 后补列：

```sql
conversation_id TEXT
reply_to_message_id TEXT
direction TEXT
agent_id TEXT
peer_agent_id TEXT
metadata TEXT
created_at INTEGER
```

更新 `add()` 写入新字段，增加：

```ts
getByConversation(agentId: string, conversationId: string, limit?: number): Promise<MessageRecord[]>
```

- [x] **Step 4: 运行测试确认通过**

运行: `npm test -w @f2a/network -- src/core/message-store.test.ts`

预期: PASS。

- [x] **Step 5: 写失败测试 - 会话摘要列表**

增加测试：

```ts
it('应该返回 Agent 的会话摘要列表', async () => {
  await store.add(createMessageRecord('msg-1', 'agent:alice', 'agent:bob', 'message', 1000, 'first', { content: 'first' }, {
    conversationId: 'conv-1',
    direction: 'outbound',
    agentId: 'agent:alice',
    peerAgentId: 'agent:bob'
  }));
  await store.add(createMessageRecord('msg-2', 'agent:bob', 'agent:alice', 'message', 2000, 'second', { content: 'second' }, {
    conversationId: 'conv-1',
    direction: 'inbound',
    agentId: 'agent:alice',
    peerAgentId: 'agent:bob'
  }));

  const conversations = await store.listConversations('agent:alice');

  expect(conversations).toEqual([
    {
      conversationId: 'conv-1',
      peerAgentId: 'agent:bob',
      lastMessageAt: 2000,
      messageCount: 2,
      lastSummary: 'second'
    }
  ]);
});
```

- [x] **Step 6: 运行测试确认失败**

运行: `npm test -w @f2a/network -- src/core/message-store.test.ts`

预期: FAIL，原因是 `listConversations` 不存在。

- [x] **Step 7: 写最小实现**

新增类型：

```ts
export interface ConversationSummary {
  conversationId: string;
  peerAgentId: string;
  lastMessageAt: number;
  messageCount: number;
  lastSummary?: string;
}
```

新增方法：

```ts
listConversations(agentId: string, limit?: number): Promise<ConversationSummary[]>
```

SQL 按 `agent_id/conversation_id/peer_agent_id` 聚合，按最新时间倒序。

- [x] **Step 8: 运行测试确认通过**

运行: `npm test -w @f2a/network -- src/core/message-store.test.ts`

预期: PASS。

### Task 2: MessageHandler 接入 MessageStore 并返回 conversationId

**文件：**
- 修改: `packages/daemon/src/types/handlers.ts`
- 修改: `packages/daemon/src/handlers/message-handler.ts`
- 修改: `packages/daemon/src/control-server.ts`
- 测试: `packages/daemon/src/handlers/message-handler.test.ts`

- [x] **Step 1: 写失败测试 - 发送消息返回 conversationId 并写历史**

在 `message-handler.test.ts` 增加测试，构造带 `add/getByConversation` spy 的 fake messageStore：

```ts
it('发送消息时应该生成 conversationId 并持久化历史', async () => {
  const messageStore = {
    add: vi.fn().mockResolvedValue(undefined),
    getByConversation: vi.fn(),
    getByMessageId: vi.fn(),
    listConversations: vi.fn(),
    getByAgent: vi.fn(),
  };
  const handler = createMessageHandler({ messageStore });

  const { resBody } = await postMessage(handler, {
    fromAgentId: 'agent:alice',
    toAgentId: 'agent:bob',
    content: 'hello'
  });

  expect(resBody.success).toBe(true);
  expect(resBody.conversationId).toMatch(/^conv-/);
  expect(messageStore.add).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: resBody.conversationId,
    agentId: 'agent:alice',
    peerAgentId: 'agent:bob'
  }));
});
```

- [x] **Step 2: 运行测试确认失败**

运行: `npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts`

预期: FAIL，原因是 handler deps 不接受 `messageStore`，响应没有 `conversationId`。

- [x] **Step 3: 写最小实现**

在 `MessageHandlerDeps` 增加：

```ts
messageStore?: MessageStore;
```

`ControlServer` 构造：

```ts
this.messageStore = new MessageStore({
  dbPath: join(this.dataDir, 'messages.db')
});
```

并注入 `MessageHandler`。

`SendMessageBody` 增加：

```ts
conversationId?: string;
replyToMessageId?: string;
```

发送时计算：

```ts
const conversationId = data.conversationId ?? `conv-${randomUUID()}`;
```

持久化 `createMessageRecord(...)`，响应包含 `conversationId` 和 `historyPersisted`。

- [x] **Step 4: 运行测试确认通过**

运行: `npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts`

预期: PASS。

- [x] **Step 5: 写失败测试 - replyTo 沿用原 conversation**

增加测试：

```ts
it('replyToMessageId 命中历史时应该沿用原 conversationId', async () => {
  const messageStore = {
    add: vi.fn().mockResolvedValue(undefined),
    getByMessageId: vi.fn().mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-existing'
    }),
    listConversations: vi.fn(),
    getByConversation: vi.fn(),
    getByAgent: vi.fn(),
  };
  const handler = createMessageHandler({ messageStore });

  const { resBody } = await postMessage(handler, {
    fromAgentId: 'agent:bob',
    toAgentId: 'agent:alice',
    content: 'reply',
    replyToMessageId: 'msg-original'
  });

  expect(resBody.conversationId).toBe('conv-existing');
});
```

- [x] **Step 6: 运行测试确认失败**

运行: `npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts`

预期: FAIL，原因是 `replyToMessageId` 未查询历史。

- [x] **Step 7: 写最小实现**

在 `MessageStore` 增加并导出：

```ts
getByMessageId(messageId: string): Promise<MessageRecord | undefined>
```

`MessageHandler` 中按优先级解析 conversation：

1. `data.conversationId`
2. `data.replyToMessageId` 命中历史的 `conversationId`
3. 新建 `conv-${randomUUID()}`

- [x] **Step 8: 运行测试确认通过**

运行:

```bash
npm test -w @f2a/network -- src/core/message-store.test.ts
npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts
```

预期: PASS。

### Task 3: 增加历史查询 API

**文件：**
- 修改: `packages/daemon/src/handlers/message-handler.ts`
- 修改: `packages/daemon/src/control-server.ts`
- 测试: `packages/daemon/src/handlers/message-handler.test.ts`
- 测试: `packages/daemon/src/control-server.test.ts`

- [x] **Step 1: 写失败测试 - GET messages 支持 conversationId 过滤**

增加测试：

```ts
it('GET messages 应该优先返回指定 conversation 的历史消息', () => {
  const messageStore = {
    getByConversation: vi.fn().mockResolvedValue([{ id: 'msg-1', conversationId: 'conv-1' }]),
    getByAgent: vi.fn(),
    listConversations: vi.fn(),
  };
  const handler = createMessageHandler({ messageStore });

  handler.handleGetMessages('agent:alice', mockReq('/api/v1/messages/agent%3Aalice?conversationId=conv-1'), res);

  expect(messageStore.getByConversation).toHaveBeenCalledWith('agent:alice', 'conv-1', 50);
});
```

- [x] **Step 2: 运行测试确认失败**

运行: `npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts`

预期: FAIL，原因是当前 GET 只读内存队列。

- [x] **Step 3: 写最小实现**

把 `handleGetMessages` 改为 async 或内部 async IIFE：

- 有 `conversationId`：调用 `messageStore.getByConversation(agentId, conversationId, limit)`。
- 有 `peerAgentId`：调用 `messageStore.getByAgent(agentId, limit)` 后过滤。
- 无历史查询参数：保持现有队列行为，避免破坏 `message list` 语义。

- [x] **Step 4: 运行测试确认通过**

运行: `npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts`

预期: PASS。

- [x] **Step 5: 写失败测试 - 新 conversations 路由**

在 `control-server.test.ts` 增加测试：

```ts
it('应该路由 GET /api/v1/conversations/:agentId 到 MessageHandler', async () => {
  const res = await request(server).get('/api/v1/conversations/agent%3Aalice');
  expect(res.status).not.toBe(405);
});
```

在 handler 测试增加：

```ts
it('应该返回 Agent 的会话摘要列表', async () => {
  const messageStore = {
    listConversations: vi.fn().mockResolvedValue([{ conversationId: 'conv-1', peerAgentId: 'agent:bob', lastMessageAt: 1, messageCount: 1 }])
  };
  const handler = createMessageHandler({ messageStore });

  await handler.handleListConversations('agent:alice', mockReq('/api/v1/conversations/agent%3Aalice'), res);

  expect(json(res).conversations).toHaveLength(1);
});
```

- [x] **Step 6: 运行测试确认失败**

运行:

```bash
npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts
npm test -w @f2a/daemon -- src/control-server.test.ts
```

预期: FAIL，原因是路由和 handler 方法不存在。

- [x] **Step 7: 写最小实现**

新增路由：

```ts
const conversationsMatch = req.url?.match(/^\/api\/v1\/conversations\/([^\/?]+)(?:\?|$)/);
```

新增 handler：

```ts
handleListConversations(agentId: string, req: IncomingMessage, res: ServerResponse): void
```

读取 `limit`，调用 `messageStore.listConversations(agentId, limit)`。

- [x] **Step 8: 运行测试确认通过**

运行:

```bash
npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts
npm test -w @f2a/daemon -- src/control-server.test.ts
```

预期: PASS。

### Task 4: CLI 支持 send conversation 参数和查询命令

**文件：**
- 修改: `packages/cli/src/main.ts`
- 修改: `packages/cli/src/messages.ts`
- 测试: `packages/cli/src/messages.test.ts`
- 测试: `packages/cli/src/main.test.ts`

- [x] **Step 1: 写失败测试 - send 传递 conversation 参数**

在 `messages.test.ts` 增加：

```ts
it('send 应该传递 conversationId 和 replyToMessageId', async () => {
  await sendMessage({
    agentId: 'agent:alice',
    toAgentId: 'agent:bob',
    content: 'hello',
    conversationId: 'conv-1',
    replyToMessageId: 'msg-1'
  });

  expect(sendRequest).toHaveBeenCalledWith(
    'POST',
    '/api/v1/messages',
    expect.objectContaining({
      conversationId: 'conv-1',
      replyToMessageId: 'msg-1'
    }),
    expect.any(Object)
  );
});
```

- [x] **Step 2: 运行测试确认失败**

运行: `npm test -w @f2a/cli -- src/messages.test.ts`

预期: FAIL，原因是 `sendMessage` options 不支持新字段。

- [x] **Step 3: 写最小实现**

`sendMessage` options 增加：

```ts
conversationId?: string;
replyToMessageId?: string;
```

payload 传递两个字段。`main.ts` parse send options：

```ts
conversationId: sendOpts['conversation-id'] as string | undefined,
replyToMessageId: sendOpts['reply-to'] as string | undefined,
```

- [x] **Step 4: 运行测试确认通过**

运行: `npm test -w @f2a/cli -- src/messages.test.ts`

预期: PASS。

- [x] **Step 5: 写失败测试 - conversations/thread 命令**

在 `messages.test.ts` 增加：

```ts
it('listConversations 应该调用 conversations API', async () => {
  await listConversations({ agentId: 'agent:alice', limit: 20 });
  expect(sendRequest).toHaveBeenCalledWith('GET', '/api/v1/conversations/agent:alice?limit=20');
});

it('getThread 应该调用 messages conversation 查询', async () => {
  await getThread({ agentId: 'agent:alice', conversationId: 'conv-1', limit: 20 });
  expect(sendRequest).toHaveBeenCalledWith('GET', '/api/v1/messages/agent:alice?limit=20&conversationId=conv-1');
});
```

- [x] **Step 6: 运行测试确认失败**

运行: `npm test -w @f2a/cli -- src/messages.test.ts`

预期: FAIL，原因是 `listConversations/getThread` 不存在。

- [x] **Step 7: 写最小实现**

在 `messages.ts` 新增导出：

```ts
export async function listConversations(options: { agentId: string; limit?: number }): Promise<void>
export async function getThread(options: { agentId: string; conversationId: string; limit?: number }): Promise<void>
```

`main.ts` 的 `handleMessageCommand` 增加子命令：

- `conversations`
- `thread`

更新 `showMessageHelp()` 文案。

- [x] **Step 8: 运行测试确认通过**

运行:

```bash
npm test -w @f2a/cli -- src/messages.test.ts
npm test -w @f2a/cli -- src/main.test.ts
```

预期: PASS。

### Task 5: 集成类型检查和目标测试

**文件：**
- 修改: `docs/superpowers/plans/2026-04-25-conversation-layer.md` 勾选实际完成步骤

- [x] **Step 1: 运行目标包测试**

运行:

```bash
npm test -w @f2a/network -- src/core/message-store.test.ts
npm test -w @f2a/daemon -- src/handlers/message-handler.test.ts
npm test -w @f2a/daemon -- src/control-server.test.ts
npm test -w @f2a/cli -- src/messages.test.ts
npm test -w @f2a/cli -- src/main.test.ts
```

预期: PASS。

- [x] **Step 2: 运行类型检查**

运行: `npm run lint`

预期: PASS。

- [x] **Step 3: 检查工作区和总结**

运行:

```bash
git status --short
git diff --stat
```

预期: 只包含 Phase 1 相关代码、测试和计划文档。

