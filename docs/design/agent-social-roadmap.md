# F2A Agent Social Roadmap

> 记录 F2A 从 P2P 消息网络演进为 Agent Social Network 的建议路线。

---

## 项目定位

F2A 不只是一个 libp2p 消息 SDK，而是一个 Agent-to-Agent 协作网络底座。

当前已经具备 Node/Agent 身份分离、Daemon、CLI、Webhook、Challenge-Response、Agent 注册和基础消息能力。下一阶段的重点应从"能发送消息"转向"Agent 能可靠、安全、有上下文地完成一次互动"。

核心方向：

- Node 作为长期运行的网络基础设施，负责连接、发现、路由和控制 API。
- Agent 作为业务身份，持有独立 AgentId、密钥、能力、消息入口和未来的关系/记忆/信誉。
- Social Layer 以每个 Agent 为中心，逐步建立会话、通讯录、私有印象和协作空间。

---

## 当前关键风险

### 1. RFC008 AgentId 与远程路由仍需统一

当前主线已经采用 `agent:<公钥指纹16位>` 的 RFC008 AgentId，但部分远程路由逻辑仍假设旧格式 `agent:<PeerId前16位>:<随机>`。如果不解决 AgentId 到 Node/Peer 的发现映射，跨节点通信会停留在局域或旧格式兼容状态。

建议优先设计 AgentId -> PeerId/NodeId 的发现索引，可以从本地注册表和 DHT provider record 的最小版本开始。

### 2. OpenClaw 插件需要严格遵守 noReply

RFC013 已把 `noReply` 默认值改为 true，目标是防止 Agent 无限回复循环。插件收到消息时必须检查 `metadata.noReply`，并在 true 时记录/确认但不自动回复。

### 3. Message Queue 不是 Social Layer 的长期存储

内存队列适合投递 fallback，但不适合作为会话历史、搜索、摘要和印象系统的数据源。Social Layer 需要持久化 Message/Conversation 存储。

### 4. 文档状态需要持续收敛

部分 README、RFC 索引和包文档还反映不同阶段的状态。进入 Social Layer 后，建议每个阶段结束时同步 RFC 状态、文档索引和实际 CLI/API 能力。

---

## 路线图

### Phase 0: Foundation Alignment

目标：修正会阻塞 A2A 闭环的基础分歧。

- 统一 RFC008 AgentId 的跨节点寻址模型。
- 修复 OpenClaw 插件的 `noReply` 接收行为。
- 清理旧 CLI 命令别名和文档状态。
- 明确 `mcp-server` 是否进入 npm workspace 和发布流程。

验收标准：

- 新格式 AgentId 可以被发现并路由到所在 Node。
- Agent 收到 `noReply=true` 消息不会自动发起回复。
- 文档索引与当前已实现 RFC 状态一致。

### Phase 1: Conversation Layer

目标：让两个 Agent 的多轮消息具备稳定上下文。

- 引入/接入 SQLite 消息历史存储。
- 增加 `conversationId` 和 `replyToMessageId` 语义。
- 支持按 Agent、对方 Agent、会话查询消息。
- CLI 增加会话查看/查询能力。
- 为未来摘要和印象系统记录结构化事件。

验收标准：

- Daemon 重启后仍能查询历史消息。
- 一次多轮 A2A 对话可以被关联到同一个 conversation。
- CLI/API 可以查看 Agent 与指定对方的消息历史。

### Phase 2: Contact Layer

目标：每个 Agent 拥有自己的通讯录。

- 添加/删除/更新联系人。
- 关系类型：friend、collaborator、service-provider、blocked。
- 从发现结果保存联系人。
- 查询联系人最近互动时间和基础能力。

验收标准：

- 每个 Agent 的通讯录隔离存储。
- Agent 可以基于联系人列表选择常用协作对象。

### Phase 3: Impression Layer

目标：每个 Agent 形成私有、可解释的对其他 Agent 的印象。

- 记录 trust score、能力观察、互动次数、标签和私密笔记。
- 从消息结果、`noReplyReason`、任务完成状态生成 impression event。
- 先使用本地规则评分，不引入全网共识。

验收标准：

- 印象数据默认不共享。
- Agent 可以查询"我对某个 Agent 的印象"。
- 协作选择可以读取印象数据作为输入。

### Phase 4: Basic Collaboration

目标：从自由聊天进入可追踪的任务协作。

- 任务委托协议：request、accept、progress、result、reject。
- 支持简单 coordinator 模式。
- 协作空间记录成员、角色、任务列表和共享上下文。
- Dashboard 展示协作状态。

验收标准：

- 一个 coordinator Agent 可以把任务拆给多个 Agent。
- 任务状态和结果可查询、可回放。

### Phase 5: Network Hardening and Public Demo

目标：让 F2A 能被外部用户稳定试用。

- 多节点真实网络测试。
- NAT、relay、bootstrap 默认配置和部署文档。
- Docker Compose demo。
- MCP Server 正式纳入包，让 AI 客户端能自然操作 F2A。

验收标准：

- 新用户可以按文档在两台机器上跑通 A2A 消息。
- Demo 能展示发现、联系、会话和基础协作闭环。

---

## 近期原则

短期不要急于实现任务市场和经济系统。优先把"两个 Agent 可靠、安全、有上下文地聊完一次事"打磨成标杆闭环。

建议实现顺序：

1. 修正 RFC008 寻址和 noReply 接收行为。
2. 做 Conversation Layer 的持久化和查询。
3. 在 Conversation Layer 稳定后再进入通讯录和印象系统。

