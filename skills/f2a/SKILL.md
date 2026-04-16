---
name: f2a
description: F2A P2P 网络通信技能。可以发送消息、接收消息、发现网络中的 Agent。
---

# F2A P2P Network

## 命令

### f2a send
发送消息给指定 Agent

**参数**:
- `--to <peer_id>`: 目标 Agent 的 Peer ID
- `--topic <topic>`: 消息主题（默认: chat）
- `<message>`: 消息内容

**示例**:
```bash
f2a send --to 12D3KooWxxx --topic chat "Hello!"
f2a send --to 12D3KooWxxx --topic task.request "帮我写代码"
```

### f2a messages
查看收到的消息

**参数**:
- `--unread`: 只显示未读消息
- `--from <peer_id>`: 只显示来自指定 Agent 的消息
- `--limit <n>`: 显示消息数量（默认: 50）

**示例**:
```bash
f2a messages
f2a messages --unread
f2a messages --from 12D3KooWxxx
```

### f2a discover
发现网络中的 Agent

**参数**:
- `-c <capability>`: 按能力过滤

**示例**:
```bash
f2a discover
f2a discover -c code-generation
```

### f2a agent
管理已注册的 Agent

**子命令**:
- `f2a agent register --id <id> --name <name>`: 注册 Agent
- `f2a agent list`: 列出已注册的 Agent
- `f2a agent unregister <id>`: 注销 Agent

### f2a daemon
管理后台服务

**子命令**:
- `f2a daemon start`: 启动 Daemon
- `f2a daemon stop`: 停止 Daemon
- `f2a daemon status`: 查看 Daemon 状态

## 配置

配置文件: `~/.f2a/config.json`

```json
{
  "agentName": "my-agent",
  "enableMDNS": true,
  "dataDir": "~/.f2a"
}
```
