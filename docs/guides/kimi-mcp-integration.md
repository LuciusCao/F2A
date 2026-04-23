# kimi-code-cli 集成 F2A 指南

本文介绍如何将 F2A 网络与 kimi-code-cli 通过 MCP 协议集成，实现远程 Agent 与本地开发环境的协作。

## 适用场景

- 远程 OpenClaw Agent 需要委托本地 kimi-code-cli 执行代码任务
- 多 Agent 协作场景中，kimi-code-cli 作为其中一个"代码执行节点"
- 通过 F2A P2P 网络接收任务，本地处理后发回结果

## 前置条件

- Node.js >= 18
- F2A 项目已构建（`npm run build`）
- F2A Daemon 可正常启动
- 已安装 kimi-code-cli（支持 MCP）

## 部署步骤

### 1. 构建 MCP Server

```bash
cd /path/to/F2A
npm run build:mcp-server
```

### 2. 初始化并注册 Agent

```bash
# 创建一个专门用于 MCP 的 Agent 身份（纯消息队列模式，无 webhook）
node packages/cli/dist/main.js agent init --name KimiCoder --no-webhook

# 记录输出的 AgentId，然后注册到 Daemon
node packages/cli/dist/main.js agent register --agent-id <agent-id>
```

### 3. 配置 kimi-code-cli MCP

**方式 A：命令行添加**

```bash
kimi mcp add --transport stdio f2a \
  "node /path/to/F2A/packages/mcp-server/dist/main.js"
```

**方式 B：手动编辑配置文件**

编辑 `~/.kimi/mcp.json`：

```json
{
  "mcpServers": {
    "f2a": {
      "command": "node",
      "args": [
        "/path/to/F2A/packages/mcp-server/dist/main.js"
      ],
      "env": {
        "F2A_CONTROL_PORT": "9001"
      }
    }
  }
}
```

### 4. 启动并验证

```bash
# 1. 启动 F2A Daemon
node packages/cli/dist/main.js daemon foreground

# 2. 在另一个终端启动 kimi（会自动加载 MCP）
kimi

# 3. 在 kimi 中查看 MCP 工具
/mcp
```

## 典型工作流

### 工作流 1：接收并处理远程任务

```
[远程 Agent] 发送 task.request → [F2A P2P] → [本地 Daemon] → [消息队列]
                                                                      ↓
[kimi-code-cli] 调用 f2a_poll_messages ← [MCP Server] ←——— stdio ———┘
       ↓
[kimi-code-cli] 分析任务、修改代码、运行测试
       ↓
[kimi-code-cli] 调用 f2a_send_message 发送结果 → [Daemon] → [P2P] → [远程 Agent]
```

### 工作流 2：主动发现网络中的 Agent

```
[kimi-code-cli] 调用 f2a_list_agents
       ↓
发现具备 "code-review" 能力的 Agent
       ↓
[kimi-code-cli] 调用 f2a_send_message 发送代码审查请求
```

## 安全注意事项

1. **Agent Token 安全**：Token 存储在 `~/.f2a/agent-identities/` 下，权限为 600，请勿泄露
2. **生产环境必须设置 `F2A_CONTROL_TOKEN`**：防止未授权访问 Daemon HTTP API
3. **SSRF 保护**：默认禁止本地 IP webhook，本方案使用消息队列完全规避此问题

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| MCP 连接失败 | Daemon 未启动 | `f2a daemon foreground` |
| 发送消息失败 "Token 缺失" | Agent 未注册或注册未返回 token | 重新执行 `f2a agent register` |
|  poll_messages 为空 | 消息被 webhook 推送到其他端点 | 确认 Agent 是纯队列模式（无 webhook） |
| 无法发现远程 Agent | P2P 网络未连通 | 检查 `f2a peers` 和 bootstrap 配置 |

## 与其他方案对比

| 方案 | 实时性 | 复杂度 | 适用场景 |
|------|--------|--------|----------|
| **MCP + 消息队列（本方案）** | 轮询（秒级） | 低 | 人机协作、代码开发 |
| Webhook + OpenClaw Gateway | 实时 | 中 | 全自动 Agent 托管 |
| HTTP API 直接调用 | 实时 | 低 | 脚本自动化 |

## 参考

- [MCP 协议规范](https://modelcontextprotocol.io/)
- [kimi-code-cli MCP 文档](https://moonshotai.github.io/kimi-cli/zh/customization/mcp.html)
- [F2A 消息协议](../../protocols/message.md)
