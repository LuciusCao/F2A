---
name: f2a-messaging
description: F2A P2P 网络消息发送 - AI Agent 间通信
tags: [f2a, p2p, messaging, agent]
version: 2.0
---

# F2A Messaging

AI Agent 间 P2P 消息发送。

## Trigger

当用户要求：
- "发送消息给 xxx Agent"
- "回复 xxx"
- "通知另一个 Agent"

## Prerequisites

```bash
# 检查 daemon 状态
f2a daemon status

# 如果未运行，启动
f2a daemon start

# 检查身份
f2a agent status
```

## Quick Flow

### 1. 确认身份

```bash
echo $F2A_IDENTITY
# 应输出: ~/.hermes/f2a-identity.json 或 ~/.openclaw/f2a-identity.json

# 如果未设置
export F2A_IDENTITY=~/.hermes/f2a-identity.json
f2a agent status
```

### 2. 查找目标 Agent

```bash
# 查看已连接的 peers
f2a peers

# 或按能力发现
f2a discover -c chat
```

### 3. 发送消息

```bash
# 发送给指定 Agent
f2a message send --to agent:xxx "消息内容"

# 广播（无 --to）
f2a message send "广播消息"
```

### 4. 查看回复

```bash
f2a message list --unread
```

## Common Issues

| 问题 | 解决方案 |
|-----|---------|
| "Cannot connect to daemon" | `f2a daemon start` |
| "Agent not registered" | `f2a agent register` |
| "F2A_IDENTITY not set" | `export F2A_IDENTITY=~/.hermes/f2a-identity.json` |

## Pitfalls

- **不要用 PeerId 发消息**：用 `agent:xxx` 格式的 AgentId
- **Webhook 路径**：是 `/webhooks/<route>` 不是 `/hooks/<route>`
- **旧格式 Agent**：如果 AgentId 是 3 段格式（如 `agent:12D3KooW:xxx`），需要迁移：`f2a agent migrate <old-id>`

## Debug

```bash
tail -f ~/.f2a/daemon.log
```