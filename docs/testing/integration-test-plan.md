# F2A 集成测试方案

> 状态：当前分支基线方案。重点覆盖 Phase 1 Conversation Layer，并为后续 P2P、CLI、OpenClaw 插件集成留出分层入口。

## 背景

当前分支的目标是让 Agent 间消息具备可查询、可持久化的会话历史。相关实现跨越 `@f2a/daemon` 的 HTTP API、`MessageHandler`、`MessageRouter`，以及 `@f2a/network` 的 `MessageStore` SQLite 存储。

已有测试以单元测试为主，`packages/network/tests/integration/` 中的测试依赖外部运行节点和 `RUN_INTEGRATION_TESTS=true`，适合作为环境级验证，但不适合作为每次开发都能快速执行的最小集成基线。因此需要把集成测试拆成可本地快速运行的“进程内集成”和需要多节点环境的“系统集成”两层。

## 测试分层

| 层级 | 目标 | 运行方式 | 是否默认运行 |
|------|------|----------|--------------|
| 进程内集成 | 覆盖真实模块协作，不启动真实 P2P 多节点 | Vitest 启动真实 `ControlServer`，使用临时 `dataDir` 和 SQLite | 建议默认或 PR 必跑 |
| 本地多进程集成 | 覆盖 CLI ↔ Daemon ↔ HTTP API 生命周期 | 启动 daemon 子进程，CLI 通过 HTTP 调用 | 手动或 nightly |
| 多节点 P2P 集成 | 覆盖 libp2p 发现、连接、远程消息 | `RUN_INTEGRATION_TESTS=true` + Docker 或本地多节点 | CI 分阶段或手动 |
| E2E 场景 | 覆盖完整用户流程和回归场景 | `packages/network/tests/e2e/scenarios` | 发布前 |

## 当前分支最小验收链路

Conversation Layer 的最小集成验证应覆盖以下链路：

1. 启动真实 `ControlServer`，使用独立临时 `dataDir`。
2. 通过 `POST /api/v1/agents` 注册两个 Agent，并拿到 agent token。
3. 通过 `POST /api/v1/messages` 从 Agent A 发送消息给 Agent B，携带显式 `conversationId`。
4. 通过 `GET /api/v1/conversations/:agentId` 查询 Agent A 和 Agent B 的会话摘要。
5. 通过 `GET /api/v1/messages/:agentId?conversationId=...` 查询双方视角下的会话消息。
6. 停止并重启 `ControlServer`，复用同一个 `dataDir`。
7. 再次查询会话消息，确认 SQLite 历史仍可读。

该测试不启动真实 P2P 网络。它验证的是当前分支最关键的跨模块契约：HTTP API、Agent 注册、Agent Token、MessageRouter 本地投递、MessageStore 持久化，以及 Daemon 重启后的历史读取。

## 历史写入失败语义

`POST /api/v1/messages` 的主职责是投递消息，历史持久化是附加能力。当前约定是：消息已经成功路由，但 SQLite 历史写入失败时，接口仍返回 `success: true`，同时返回 `historyPersisted: false`。

调用方看到 `historyPersisted: false` 时应将消息视为“已投递但不可保证可回放”。CLI 或上层 Agent 应提示用户会话历史可能缺失，并可按业务需要重试发送、记录本地补偿日志，或稍后通过 `GET /api/v1/messages/:agentId?conversationId=...` 确认历史是否可查。

## 建议测试文件布局

```text
packages/daemon/tests/
  conversation-history.integration.test.ts

packages/network/tests/integration/
  p2p-connection.test.ts
  message-passing.test.ts
  ...
```

`packages/daemon/tests/*.integration.test.ts` 用于快速、确定性的进程内集成。`packages/network/tests/integration/` 继续保留需要外部节点或 Docker 的网络级集成。

## 后续扩展

- CLI 集成：使用真实 daemon，覆盖 `f2a message conversations`、`f2a message thread` 和 `f2a message send --conversation-id`。
- P2P 入站历史：启动两个 F2A 节点，验证远程 `agent.message` 经 `message:received` 事件落入接收方会话历史。
- 兼容性迁移：准备旧版 `messages.db` fixture，验证 `MessageStore` 幂等迁移不会破坏历史记录。
- 失败路径：验证历史写入失败时发送 API 返回 `historyPersisted: false` 且投递不被阻断。

## 当前最小验证命令

```bash
npm test -w @f2a/daemon -- tests/conversation-history.integration.test.ts
```
