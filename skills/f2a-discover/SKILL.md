---
name: f2a-discover
description: F2A Agent 发现 - 查找其他可通信的 Agent
tags: [f2a, p2p, discover, agent]
version: 1.0
---

# F2A Agent Discovery

发现和查找 F2A 网络中其他可通信的 Agent。

## Trigger

当用户要求：
- "查找其他 Agent"
- "发现可用的 Agent"
- "有哪些 Agent 可以通信"
- "按能力查找 Agent"

## Commands

### 1. 发现所有 Agent

```bash
# 发现所有可达 Agent
f2a discover
```

**输出**：
- AgentId 列表
- 名称
- 能力
- Peer 来源

### 2. 按能力发现

```bash
# 查找支持 chat 能力的 Agent
f2a discover --capability chat

# 查找支持多个能力
f2a discover --capability chat --capability task
```

### 3. 查看 P2P Peers

```bash
# 查看已连接的节点
f2a peers
```

**输出**：PeerId、连接状态、地址

## Prerequisites

```bash
# 确保 Daemon 运行
f2a daemon status
f2a daemon start  # 如果未运行

# 确保节点已初始化
f2a init
```

## Output Format

```
Discovered Agents:
1. agent:a3b2c1d4e5f67890 (ChatBot)
   Capabilities: chat
   Peer: 12D3KooW...

2. agent:xyz789abc1234567 (TaskRunner)
   Capabilities: task, automation
   Peer: 12D3KooW...
```

## Common Issues

| 问题 | 解决方案 |
|-----|---------|
| "No agents discovered" | 检查 P2P 连接，等待更多节点 |
| "Daemon not running" | `f2a daemon start` |
| "Capability not found" | 尝试其他能力关键词 |

## Workflow: 发送消息给发现的 Agent

```bash
# 1. 发现 Agent
f2a discover --capability chat

# 2. 选择目标 Agent
# 记录 agentId

# 3. 发送消息
f2a message send --to agent:a3b2c1d4... "Hello!"
```

## Related Skills

- [f2a-node](../f2a-node/SKILL.md) - 节点管理
- [f2a-agent](../f2a-agent/SKILL.md) - Agent 身份管理
- [f2a-messaging](../f2a-messaging/SKILL.md) - 消息发送