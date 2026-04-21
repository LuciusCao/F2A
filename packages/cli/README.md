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

---

## ⭐ 重要：理解 Webhook

### 什么是 Webhook？

**Webhook 是你的 Agent 接收其他 Agent 消息的"收信地址"**

在 F2A 网络中，Agent 之间可以互相发送 P2P 消息：

```
┌─────────────┐                    ┌─────────────┐
│  Agent A    │                    │  Agent B    │
│  (发送方)    │    P2P Network     │  (接收方)    │
│             │ ─────────────────► │             │
│             │                    │    │        │
│             │                    │    ▼        │
│             │                    │  Webhook    │
│             │                    │  (收信地址)  │
└─────────────┘                    └─────────────┘
```

**流程：**

1. **Agent A 发消息给 Agent B**
2. **F2A 网络路由消息** 到 Agent B 所在节点
3. **Agent B 的 Daemon** 把消息 POST 到 Agent B 配置的 webhook URL
4. **Agent B 的应用**（OpenClaw/Hermes/自建服务）在 webhook 端点接收并处理消息

---

### Webhook URL 怎么填？

不同 Agent 框架的接入方式不同：

#### OpenClaw Gateway

**方式：安装 F2A 插件**

```bash
# 1. 安装插件
npm install @f2a/openclaw-f2a

# 2. 在 openclaw.json 中配置
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "enabled": true,
        "config": {
          "webhookPath": "/f2a/webhook"
        }
      }
    }
  }
}
```

**Webhook URL:** `http://127.0.0.1:18789/f2a/webhook`

> OpenClaw Gateway 默认端口 18789

#### Hermes Agent

**方式：使用 webhook platform**

在 Hermes 配置中添加 webhook platform：

```yaml
platforms:
  webhook:
    enabled: true
    path: /f2a/webhook
    port: 3000
```

**Webhook URL:** `http://127.0.0.1:3000/f2a/webhook`

> Hermes 默认端口 3000

#### 自建 HTTP 服务

自己实现一个 HTTP 端点接收 POST 请求：

```javascript
// 示例：Express 服务器
app.post('/f2a/webhook', (req, res) => {
  const { from, content } = req.body;
  
  // 处理消息
  console.log(`收到来自 ${from} 的消息: ${content}`);
  
  // 回复（使用 f2a CLI）
  // f2a message send --agent-id <your-agent-id> --to <from> "回复内容"
  
  res.json({ success: true });
});
```

**Webhook URL:** `http://your-host:port/f2a/webhook`

#### 公网服务器

如果 Agent 在公网服务器上：

**Webhook URL:** `https://your-domain.com/f2a/webhook`

---

### 如何修改 Webhook？

如果需要更改 webhook URL：

```bash
# 修改 webhook
f2a agent update --agent-id <agentId> --webhook <new-url>

# 重新注册到 Daemon（使新 webhook 生效）
f2a agent register --agent-id <agentId> --force
```

---

### Webhook 不填会怎样？

`f2a agent init` **强制要求 webhook 参数**，因为：

- 没有 webhook，Agent **无法接收消息**
- 其他 Agent 发的消息无法送达
- Agent 只能发送，不能接收

如果暂时不知道 webhook URL，可以先填一个占位 URL，稍后用 `update` 命令修改。

---

## 快速开始

```bash
# 1. 初始化节点身份
f2a init

# 2. 启动 Daemon 服务
f2a daemon start

# 3. 创建 Agent 身份（必须指定 webhook）
f2a agent init --name "my-agent" --webhook http://127.0.0.1:18789/f2a/webhook

# 4. 注册 Agent 到 Daemon
f2a agent register --agent-id <生成的-agentId>

# 5. 发送消息
f2a message send --agent-id <agentId> --to <目标-agentId> "Hello!"
```

---

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

管理 Agent 身份和注册。

```bash
# 创建 Agent 身份（必须指定 webhook）
f2a agent init --name <name> --webhook <url> [options]

选项:
  --name <name>       Agent 名称（必填）
  --webhook <url>     Webhook URL（必填，接收消息的 HTTP 端点）
  --capability <cap>  能力标签（可多次指定）
  --force             强制重新创建（覆盖现有身份）

# 注册 Agent 到 Daemon
f2a agent register --agent-id <agentId> [--force]

# 列出已注册的 Agent
f2a agent list

# 查看 Agent 状态
f2a agent status --agent-id <agentId>

# 更新 Agent 配置（修改 webhook 或名称）
f2a agent update --agent-id <agentId> [--webhook <url>] [--name <name>]

# 注销 Agent
f2a agent unregister --agent-id <agentId>
```

**示例:**

```bash
# 创建 OpenClaw Agent
f2a agent init --name "assistant" --webhook http://127.0.0.1:18789/f2a/webhook

# 创建 Hermes Agent
f2a agent init --name "hermes-bot" --webhook http://127.0.0.1:3000/f2a/webhook --capability chat

# 注册到 Daemon
f2a agent register --agent-id agent:abc123...

# 修改 webhook
f2a agent update --agent-id agent:abc123... --webhook http://new-server:8080/f2a/webhook
f2a agent register --agent-id agent:abc123... --force

# 查看状态
f2a agent status --agent-id agent:abc123...
```

### message - 消息管理

Agent 间消息通信。

```bash
# 发送消息
f2a message send --agent-id <agentId> [options] "content"

选项:
  --agent-id <id>   发送方 Agent ID（必填）
  --to <id>         接收方 Agent ID（可选，不提供则广播）
  --type <type>     消息类型: message, task_request, task_response, announcement, claim

# 查看消息队列
f2a message list --agent-id <agentId> [--unread] [--limit <n>]

# 清除消息
f2a message clear --agent-id <agentId>
```

**示例:**

```bash
# 发送消息给指定 Agent
f2a message send --agent-id agent:abc123... --to agent:xyz789... "Hello!"

# 广播消息
f2a message send --agent-id agent:abc123... "Broadcast message"

# 查看未读消息
f2a message list --agent-id agent:abc123... --unread --limit 10
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

---

## 配置

F2A CLI 使用配置文件存储节点身份和 Agent 身份：

**配置路径:** `~/.f2a/`

**目录结构:**

```
~/.f2a/
├── node-identity.json        # 节点身份（包含 E2EE 密钥）
├── agent-identities/         # Agent 身份文件目录
│   ├── agent:xxx.json        # 单个 Agent 身份
│   ├── agent:yyy.json        # 另一个 Agent 身份
│   └── ...
├── agent-registry.json       # Agent 注册表（Daemon 维护）
└── data/                     # 本地数据存储
```

---

## 相关包

| 包名 | 描述 |
|------|------|
| [@f2a/network](../network) | P2P 网络核心，基于 libp2p |
| [@f2a/daemon](../daemon) | HTTP API 服务 |
| [@f2a/openclaw-f2a](../openclaw-f2a) | OpenClaw Gateway 插件 |

---

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

---

## 要求

- Node.js >= 18.0.0

---

## 许可证

[MIT](LICENSE)

---

## 相关链接

- [F2A GitHub Repository](https://github.com/LuciusCao/F2A)
- [问题反馈](https://github.com/LuciusCao/F2A/issues)
- [OpenClaw 文档](https://docs.openclaw.ai)