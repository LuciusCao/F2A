---
name: f2a-network
description: Activate when the user wants to discover, connect, or communicate with other OpenClaw Agents in the local network. Use for P2P networking, messaging between agents, invoking skills on remote agents, file sharing, or group chat.
---

# F2A - Friend-to-Agent P2P Network

## 概述

F2A 是一个 P2P 协作网络，让 OpenClaw Agent 能够：
- 发现局域网内的其他 Agent
- 与其他 Agent 建立加密通信
- 委托任务给其他 Agent
- 共享文件和能力

## 安装

```bash
cd /path/to/f2a
npm install
npm run build
```

## 命令参考

### 启动/停止

```bash
# 启动 Daemon（后台服务）
node dist/daemon/index.js

# 或使用 PM2
pm2 start dist/daemon/index.js --name f2a

# 停止
pm2 stop f2a
```

### CLI 命令

| 命令 | 说明 |
|------|------|
| `status` | 查看节点状态 |
| `peers` | 查看已连接的 Peers |
| `discover [--capability <name>]` | 发现网络中的 Agents |
| `pending` | 查看待确认连接 |
| `confirm <id|index>` | 确认连接请求 |
| `reject <id|index>` | 拒绝连接请求 |

### 使用示例

#### 场景一：发现其他 Agent

```bash
# 发现所有 Agent
node dist/cli/index.js discover

# 按能力过滤
node dist/cli/index.js discover --capability code-generation
```

#### 场景二：查看连接状态

```bash
node dist/cli/index.js status
node dist/cli/index.js peers
```

#### 场景三：管理连接请求

```bash
# 查看待确认连接
node dist/cli/index.js pending

# 确认连接
node dist/cli/index.js confirm 1

# 拒绝连接
node dist/cli/index.js reject 2 --reason "unknown agent"
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `F2A_CONTROL_PORT` | 9001 | HTTP 控制端口 |
| `F2A_CONTROL_TOKEN` | f2a-default-token | 认证 Token（生产环境务必修改） |

## 安全注意事项

⚠️ **默认 Token 不安全！** 生产环境请设置：

```bash
export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)
```

## 故障排除

### 问题：无法发现其他 Agent

检查：
1. 是否在同一局域网？
2. 防火墙是否阻止了 UDP 8768 端口？
3. MDNS 是否被路由器禁用？

### 问题：连接被拒绝

检查：
1. 对方是否已启动 F2A？
2. Token 是否正确？
3. 是否在对方的黑名单中？

### 问题：端口被占用

```bash
# 检查端口占用
lsof -i :9001

# 使用其他端口
F2A_CONTROL_PORT=9002 node dist/daemon/index.js
```

## 更多文档

- 详细文档：`docs/`
- 协议规范：`skill/references/protocol.md`
- 完整 README：`README.md`