---
name: f2a-node
description: F2A 节点管理 - 初始化和状态检查
tags: [f2a, p2p, node, init]
version: 1.0
---

# F2A Node Management

F2A P2P 网络节点初始化和状态管理。

## Trigger

当用户要求：
- "初始化 F2A 节点"
- "创建 F2A 节点身份"
- "查看节点状态"
- "查看 P2P peers"
- "F2A 健康检查"

## Commands

### 1. 初始化节点

```bash
# 创建 Node Identity（首次使用）
f2a init

# 强制重新创建（覆盖现有）
f2a init --force
```

**结果**：
- 创建 `~/.f2a/node-identity.json`
- 生成 PeerId（libp2p 身份）

### 2. 查看节点状态

```bash
f2a status
```

**输出**：
- PeerId
- 节点运行状态
- Agent 数量
- P2P 连接数

### 3. 查看 P2P Peers

```bash
f2a peers
```

**输出**：已连接的其他 F2A 节点列表

### 4. 健康检查

```bash
f2a health
```

**检查项**：
- Daemon 运行状态
- P2P 连接状态
- Agent 注册状态

## Prerequisites

```bash
# 检查是否已初始化
cat ~/.f2a/node-identity.json

# 如果不存在，初始化
f2a init
```

## Common Issues

| 问题 | 解决方案 |
|-----|---------|
| "node-identity.json not found" | `f2a init` |
| "PeerId 需要重新生成" | `f2a init --force` |
| "无法连接 peers" | 检查网络，重启 daemon |

## Related Skills

- [f2a-agent](../f2a-agent/SKILL.md) - Agent 身份管理
- [f2a-messaging](../f2a-messaging/SKILL.md) - 消息发送
- [f2a-discover](../f2a-discover/SKILL.md) - Agent 发现