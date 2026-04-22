---
name: f2a-agent
description: F2A Agent 身份管理 - 初始化、注册、状态查看
tags: [f2a, p2p, agent, identity]
version: 1.0
---

# F2A Agent Management

F2A Agent 身份初始化、注册和状态管理。

## Trigger

当用户要求：
- "创建一个 Agent"
- "初始化 Agent 身份"
- "注册 Agent 到 Daemon"
- "查看 Agent 状态"
- "注销 Agent"
- "更新 Agent webhook"

## Commands

### 1. 初始化 Agent（创建身份）

```bash
# 创建 Agent 密钥对和身份文件
f2a agent init --name "AgentName" --webhook "http://url/webhook"

# 可选：添加能力标签
f2a agent init --name "MyAgent" --webhook "http://url" --capability chat --capability task

# 强制重新创建（覆盖现有）
f2a agent init --name "MyAgent" --webhook "http://url" --force
```

**结果**：
- 生成 Ed25519 密钥对
- 计算 AgentId（公钥指纹）
- 保存到 `~/.f2a/agent-identities/<agentId>.json`

### 2. 注册 Agent 到 Daemon

```bash
# 注册（需要先 init）
f2a agent register --agent-id agent:abc123...

# 强制重新注册
f2a agent register --agent-id agent:abc123... --force
```

**注意**：需要 Daemon 运行 (`f2a daemon start`)

### 3. 查看 Agent 状态

```bash
f2a agent status --agent-id agent:abc123...

# 如果不知道 agentId，列出所有
f2a agent list
```

**输出**：
- AgentId
- 名称
- 能力列表
- Webhook URL
- 注册状态

### 4. 更新 Agent

```bash
# 更新 webhook
f2a agent update --agent-id agent:abc123... --webhook "http://new-url"

# 更新名称
f2a agent update --agent-id agent:abc123... --name "NewName"
```

### 5. 注销 Agent

```bash
f2a agent unregister --agent-id agent:abc123...
```

**结果**：从 Daemon 移除，但身份文件仍保留

### 6. 验证 Agent 身份

```bash
f2a agent verify --agent-id agent:abc123...
```

## Prerequisites

```bash
# 检查 Daemon 状态
f2a daemon status

# 如果未运行，启动
f2a daemon start

# 检查节点身份
f2a init  # 如果没有 node-identity.json
```

## AgentId Format

RFC008 新格式：
```
agent:<公钥指纹16位>
例如: agent:a3b2c1d4e5f67890
```

**不要使用 PeerId 格式**（RFC003 已废弃）：
```
agent:12D3KooW:xxx  ← 旧格式，避免使用
```

## Common Issues

| 问题 | 解决方案 |
|-----|---------|
| "Cannot connect to daemon" | `f2a daemon start` |
| "Agent not found" | `f2a agent init` 先创建 |
| "Already registered" | `--force` 强制重新注册 |
| "Webhook 验证失败" | 检查 webhook URL 是否可访问 |

## Workflow: 创建新 Agent

```bash
# 1. 确保 Daemon 运行
f2a daemon start

# 2. 创建 Agent 身份
f2a agent init --name "MyAgent" --webhook "http://localhost:18789/f2a/webhook"

# 3. 注册到 Daemon
f2a agent register --agent-id agent:abc...

# 4. 确认状态
f2a agent status --agent-id agent:abc...
```

## Related Skills

- [f2a-node](../f2a-node/SKILL.md) - 节点管理
- [f2a-messaging](../f2a-messaging/SKILL.md) - 消息发送
- [f2a-discover](../f2a-discover/SKILL.md) - Agent 发现