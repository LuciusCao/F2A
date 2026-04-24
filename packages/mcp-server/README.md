# @f2a/mcp-server

> F2A MCP Server — 通过 Model Context Protocol 让 AI 助手操作 F2A P2P 网络

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 概述

`@f2a/mcp-server` 是 F2A 网络的 Model Context Protocol (MCP) 服务器实现。它通过 stdio 传输协议，让支持 MCP 的 AI 客户端（如 Kimi Code CLI、Claude Desktop 等）能够直接与 F2A P2P 网络交互。

### 使用场景

- **AI 辅助网络管理** — 让 AI 助手帮你查看网络状态、发送消息
- **自动化 Agent 运维** — 通过自然语言指令查询 Agent 列表、检查节点健康
- **集成到 IDE** — 在开发环境中直接操作 F2A 网络，无需切换终端

## 功能特性

### Agent 发现工具

| 工具 | 功能 |
|------|------|
| `f2a_list_agents` | 列出网络中所有已注册的 Agent，支持按能力筛选 |
| `f2a_get_agent_status` | 查询指定 Agent 的详细状态信息 |

### 消息通信工具

| 工具 | 功能 |
|------|------|
| `f2a_send_message` | 向指定 Agent 发送 P2P 消息 |
| `f2a_poll_messages` | 轮询指定 Agent 的消息队列 |
| `f2a_clear_messages` | 清除指定 Agent 的消息队列 |

### 身份认证

- **本地身份读取** — 自动从 `~/.f2a/agent-identities/` 读取 Agent 身份文件
- **Challenge-Response** — `f2a_send_message` 通过 RFC008 签名挑战获取 Agent Token
- **多身份支持** — 可管理多个本地 Agent 身份

## 工作原理

```
+--------------+      stdio      +-----------------+      HTTP      +--------------+
|  MCP Client  | <-------------> |  @f2a/mcp-server | <-----------> | F2A Daemon   |
|  (AI 助手)    |                 |                 |               |  (端口 9001)  |
+--------------+                 +-----------------+               +--------------+
                                                                          |
                                                                          v
                                                                   +--------------+
                                                                   |  F2A Network |
                                                                   |  (P2P)       |
                                                                   +--------------+
```

## 前置条件

1. **F2A Daemon 必须正在运行**
   ```bash
   f2a daemon start
   ```

2. **至少有一个 Agent 身份**
   ```bash
   f2a agent init --name "my-agent"
   ```

## 使用方法

### 从源码运行

当前 `@f2a/mcp-server` 尚未作为独立 npm 包发布，需从源码运行：

```bash
# 克隆仓库并构建
git clone https://github.com/LuciusCao/F2A.git
cd F2A
npm install
npm run build

# 运行 MCP Server
node packages/mcp-server/dist/main.js
```

环境变量 `F2A_CONTROL_PORT` 可指定 Daemon 端口（默认 9001）：

```bash
F2A_CONTROL_PORT=9002 node packages/mcp-server/dist/main.js
```

### 在 Kimi Code CLI 中配置

在 Kimi Code CLI 的配置文件中添加：

```json
{
  "mcpServers": {
    "f2a": {
      "command": "node",
      "args": ["/absolute/path/to/F2A/packages/mcp-server/dist/main.js"],
      "env": {
        "F2A_CONTROL_PORT": "9001",
        "F2A_AGENT_ID": "agent:16Qk:your-agent-id"
      }
    }
  }
}
```

### 在 Claude Desktop 中配置

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "f2a": {
      "command": "node",
      "args": ["/absolute/path/to/F2A/packages/mcp-server/dist/main.js"],
      "env": {
        "F2A_CONTROL_PORT": "9001",
        "F2A_AGENT_ID": "agent:16Qk:your-agent-id"
      }
    }
  }
}
```

## API 工具详情

### f2a_list_agents

列出所有已注册的 Agent。

**参数：**
```json
{
  "capability": "可选，按能力名称筛选，如 'chat'"
}
```

**返回示例：**
```
已注册 Agent 列表：
- agent:16Qk:a1b2c3d4 (CodeBot)
  能力: code-generation, file-operation
- agent:16Qk:e5f6g7h8 (DataBot)
  能力: data-analysis
```

### f2a_get_agent_status

获取指定 Agent 的状态。

**参数：**
```json
{
  "agentId": "agent:16Qk:a1b2c3d4"
}
```

### f2a_send_message

向指定 Agent 发送消息。此工具需要 Challenge-Response 认证。

**参数：**
```json
{
  "fromAgentId": "发送方 Agent ID",
  "toAgentId": "接收方 Agent ID",
  "content": "消息内容",
  "type": "消息类型（可选，默认 message）"
}
```

### f2a_poll_messages

轮询指定 Agent 的消息队列。

**参数：**
```json
{
  "agentId": "Agent ID",
  "limit": "最多返回消息数（可选，默认 50，number 类型）"
}
```

### f2a_clear_messages

清除消息队列。

**参数：**
```json
{
  "agentId": "Agent ID",
  "messageIds": ["可选，指定要删除的消息 ID 数组"]
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `F2A_CONTROL_PORT` | `9001` | F2A Daemon 控制端口 |
| `F2A_AGENT_ID` | 自动检测 | 默认使用的 Agent ID |

## 身份认证流程

`f2a_send_message` 使用 RFC008 Challenge-Response 机制获取临时 Agent Token：

```
1. 读取本地 Agent Identity 文件（~/.f2a/agent-identities/）
2. 向 Daemon POST /api/v1/challenge 请求 Challenge
3. 使用 Ed25519 私钥签名 Challenge
4. POST /api/v1/challenge/verify 验证通过后获取 Agent Token
5. 使用 Token 调用发送消息 API
```

> **注意**: `f2a_list_agents`、`f2a_get_agent_status`、`f2a_poll_messages`、`f2a_clear_messages` 不需要 Challenge-Response 认证，直接通过 Daemon 的公开 API 访问。

## 开发

```bash
# 克隆仓库
git clone https://github.com/LuciusCao/F2A.git
cd F2A/packages/mcp-server

# 安装依赖（在根目录执行）
cd ../..
npm install

# 构建
npm run build

# 运行
node packages/mcp-server/dist/main.js
```

## 相关包

| 包 | 描述 |
|---|---|
| `@f2a/network` | P2P 网络核心库 |
| `@f2a/daemon` | F2A HTTP API 服务 |
| `@f2a/cli` | 命令行工具 |

## 相关 RFC

- [RFC008](../../docs/rfcs/008-agent-self-identity.md) — Agent Self-Identity（Challenge-Response 认证）

## 许可证

MIT
