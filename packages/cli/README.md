# @f2a/cli

> F2A CLI - 命令行工具，Friend-to-Agent P2P 网络的统一入口

[![npm version](https://img.shields.io/npm/v/@f2a/cli.svg)](https://www.npmjs.com/package/@f2a/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 概述

`@f2a/cli` 是 F2A (Friend-to-Agent) 网络的命令行工具，提供统一的入口来管理节点身份、注册 Agent、发送消息、发现其他 Agent 以及管理后台 Daemon 服务。

## 功能特性

- 🔑 **身份管理** - 创建和管理节点身份（Node Identity）
- 🤖 **Agent 注册** - 注册、注销和管理 Agent
- 📨 **消息通信** - Agent 间点对点消息发送
- 🔍 **Agent 发现** - 发现网络中的其他 Agent（支持能力筛选）
- 🖥️ **Daemon 管理** - 后台服务启动、停止和状态监控
- 🔄 **身份导入导出** - 支持身份备份和迁移

## 安装

```bash
# 全局安装
npm install -g @f2a/cli

# 或使用 pnpm
pnpm add -g @f2a/cli

# 或使用 yarn
yarn global add @f2a/cli
```

## 快速开始

```bash
# 1. 初始化节点身份
f2a init

# 2. 启动 Daemon 服务
f2a daemon start

# 3. 注册 Agent
f2a agent register --name "my-agent" --capability "chat"

# 4. 发现其他 Agent
f2a discover

# 5. 发送消息
f2a message send --from my-agent --to other-agent "Hello!"
```

## 命令使用

### 全局命令

```bash
f2a --help        # 显示帮助
f2a --version     # 显示版本
```

### init - 初始化节点

创建 F2A 节点身份和基础配置文件。

```bash
f2a init           # 创建身份
f2a init --force   # 强制重新创建（覆盖现有身份）
```

### agent - Agent 管理

管理 Agent 注册。

```bash
# 列出已注册的 Agent
f2a agent list

# 注册新 Agent
f2a agent register --name <name> [options]

选项:
  --name <name>         Agent 名称（必填）
  --id <id>             Agent ID（可选，不提供则自动生成）
  --capability <cap>    能力标签（可多次指定）
  --webhook <url>       Webhook URL（可选）

# 注销 Agent
f2a agent unregister <agent_id>

# 验证 Agent
f2a agent verify <agent_id>
```

**示例:**

```bash
f2a agent register --name "assistant" --capability "chat" --capability "task"
f2a agent register --name "webhook-agent" --capability "notify" --webhook "https://example.com/hook"
f2a agent unregister agent-123
```

### message - 消息管理

Agent 间消息通信。

```bash
# 发送消息
f2a message send --from <agent_id> [options] "content"

选项:
  --from <agent_id>   发送方 Agent ID（必填）
  --to <agent_id>     接收方 Agent ID（可选，不提供则广播）
  --type <type>       消息类型: message, task_request, task_response, announcement, claim

# 查看消息队列
f2a message list [options]

选项:
  --agent <agent_id>   Agent ID（默认 'default'）
  --unread              只显示未读消息
  --limit <n>           限制显示数量

# 清除消息
f2a message clear --agent <agent_id>
```

**示例:**

```bash
f2a message send --from agent-123 --to agent-456 "Hello, World!"
f2a message send --from agent-123 "Broadcast message"
f2a message list --agent agent-123 --unread --limit 10
```

### daemon - Daemon 管理

管理 F2A 后台服务。

```bash
# 后台启动 Daemon
f2a daemon start

# 停止 Daemon
f2a daemon stop

# 查看 Daemon 状态
f2a daemon status

# 前台启动 Daemon（用于调试）
f2a daemon foreground
```

### identity - 身份管理

管理节点身份。

```bash
# 查看身份状态
f2a identity status

# 导出身份到文件（用于备份/迁移）
f2a identity export [output_file.json]

# 从文件导入身份（用于恢复/迁移）
f2a identity import <input_file.json>
```

**示例:**

```bash
f2a identity status
f2a identity export ./backup-2024-01-15.json
f2a identity import ./backup-2024-01-15.json
```

### discover - 发现 Agent

发现网络中的其他 Agent。

```bash
# 发现所有 Agent
f2a discover

# 按能力筛选
f2a discover --capability "chat"
f2a discover --capability "task"
```

### 系统状态命令

```bash
# 查看系统状态
f2a status

# 查看 P2P peers
f2a peers

# 健康检查
f2a health
```

## 配置

F2A CLI 使用配置文件存储节点身份和设置：

**配置路径:** `~/.f2a/config.json`

**配置结构:**

```json
{
  "nodeId": "node-xxx",
  "privateKey": "...",
  "agents": [
    {
      "id": "agent-xxx",
      "name": "my-agent",
      "capabilities": ["chat", "task"]
    }
  ]
}
```

**目录结构:**

```
~/.f2a/
├── config.json      # 主配置文件
├── identity.json    # 身份信息
└── data/            # 本地数据存储
```

## 相关包

| 包名 | 描述 |
|------|------|
| [@f2a/network](../network) | P2P 网络核心，基于 libp2p |
| [@f2a/daemon](../daemon) | HTTP API 服务 |

## 开发

```bash
# 克隆仓库
git clone https://github.com/LuciusCao/F2A.git
cd F2A/packages/cli

# 安装依赖
pnpm install

# 构建
pnpm build

# 运行测试
pnpm test

# 测试覆盖率
pnpm test:coverage
```

## 要求

- Node.js >= 18.0.0

## 许可证

[MIT](LICENSE)

## 相关链接

- [F2A GitHub Repository](https://github.com/LuciusCao/F2A)
- [问题反馈](https://github.com/LuciusCao/F2A/issues)