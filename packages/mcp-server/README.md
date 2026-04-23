# @f2a/mcp-server

F2A 的 Model Context Protocol (MCP) 桥接服务器。

通过 MCP 协议暴露 F2A 网络能力，让 MCP 客户端（如 **kimi-code-cli**、Claude Desktop、Cursor 等）能够：
- 发现 F2A 网络中的 Agent
- 接收远程 Agent 发来的消息和任务
- 发送回复和结果到指定 Agent

## 架构

```
远程 Agent (P2P) → 本地 F2A Daemon (9001) → 消息队列 → @f2a/mcp-server (stdio MCP) → MCP 客户端
```

## Quick Start

### 1. 构建

```bash
npm run build:mcp-server
```

### 2. 注册 MCP Agent（纯消息队列模式）

```bash
# 初始化 Agent 身份（无需 webhook）
f2a agent init --name KimiCoder --no-webhook

# 注册到本地 Daemon
f2a agent register --agent-id <your-agent-id>
```

### 3. 在 kimi-code-cli 中添加 MCP 服务器

```bash
kimi mcp add --transport stdio f2a "node packages/mcp-server/dist/main.js"
```

或在 `~/.kimi/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "f2a": {
      "command": "node",
      "args": ["/path/to/F2A/packages/mcp-server/dist/main.js"]
    }
  }
}
```

### 4. 使用

在 kimi-code-cli 会话中：

```
/mcp
# 查看已加载的 F2A 工具

请检查 F2A 消息队列
# kimi 会自动调用 f2a_poll_messages

回复远程 Agent：我已经完成了代码重构
# kimi 会自动调用 f2a_send_message
```

## MCP Tools 列表

| Tool | 描述 |
|------|------|
| `f2a_poll_messages` | 从指定 Agent 的消息队列拉取待处理消息 |
| `f2a_send_message` | 发送消息/回复到指定 F2A Agent |
| `f2a_clear_messages` | 清除 Agent 的消息队列 |
| `f2a_list_agents` | 列出 F2A 网络中已注册的 Agent（可按能力过滤） |
| `f2a_get_agent_status` | 获取指定 Agent 的详情和消息队列状态 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `F2A_CONTROL_PORT` | 9001 | F2A Daemon HTTP 控制端口 |
| `F2A_AGENT_ID` | - | 默认使用的 Agent ID（可选，未设置时自动查找第一个本地身份） |

## 故障排查

**问题：kimi mcp add 后连接失败**
- 确保 F2A Daemon 已启动：`f2a daemon status`
- 检查端口：`F2A_CONTROL_PORT` 是否与 Daemon 实际端口一致

**问题：f2a_send_message 提示 "无法获取 Token"**
- 确认 Agent 已注册：`f2a agent status --agent-id <id>`
- 确认身份文件包含 `token` 字段（注册成功后 Daemon 会返回 token 并写入文件）

**问题：f2a_poll_messages 返回空**
- 确认远程 Agent 发送的消息目标 `toAgentId` 正确
- 确认消息未被 webhook 推送到其他端点（纯队列模式无 webhook）

## 开发

```bash
cd packages/mcp-server
npm run build
npm test
```
