# @f2a/openclaw-f2a

OpenClaw Gateway 的 F2A 插件，让 Agent 通过 OpenClaw 接收 F2A P2P 网络消息。

## 功能特性

- **Webhook 接收** - 通过 HTTP Webhook 接收来自 F2A 网络的消息
- **Agent 身份恢复** - 支持通过 Challenge-Response 验证恢复已有 Agent 身份
- **消息转发** - 自动将接收的消息转发给 OpenClaw Agent 处理
- **自动注册** - 启动时自动向 F2A Daemon 注册 Agent
- **身份持久化** - 保存 Agent Identity 和 Token，支持断线重连

## 安装

作为 OpenClaw Gateway 插件安装：

```bash
# 在 OpenClaw Gateway 目录下
npm install @f2a/openclaw-f2a
```

## 配置

在 OpenClaw Gateway 的 `openclaw.plugin.json` 中配置：

```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "config": {
          "webhookPath": "/f2a/webhook",
          "webhookPort": 9002,
          "webhookToken": "your-secure-token",
          "agentTimeout": 60000,
          "controlPort": 9001,
          "agentName": "OpenClaw Agent",
          "agentCapabilities": ["chat", "task"],
          "autoRegister": true,
          "registerRetryInterval": 5000,
          "registerMaxRetries": 3
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `webhookPath` | string | `/f2a/webhook` | Webhook 接收路径 |
| `webhookPort` | number | `9002` | Webhook 监听端口 |
| `webhookToken` | string | `''` | Webhook 认证 Token |
| `agentTimeout` | number | `60000` | Agent 响应超时时间（毫秒） |
| `controlPort` | number | `9001` | F2A Daemon 控制端口 |
| `agentName` | string | `'OpenClaw Agent'` | Agent 名称 |
| `agentCapabilities` | string[] | `['chat', 'task']` | Agent 能力列表 |
| `autoRegister` | boolean | `true` | 启动时自动注册到 Daemon |
| `registerRetryInterval` | number | `5000` | 注册重试间隔（毫秒） |
| `registerMaxRetries` | number | `3` | 最大注册重试次数 |

## 使用方式

### 1. 前置条件

确保 F2A Daemon 已运行：

```bash
# 启动 F2A Daemon（如果尚未启动）
f2a daemon start
```

### 2. 在 OpenClaw Gateway 中启用

插件会自动通过 OpenClaw Gateway 的插件系统加载。确保：

1. 插件已安装到 OpenClaw Gateway 的 `node_modules`
2. 配置已添加到 `openclaw.plugin.json`
3. 重启 OpenClaw Gateway

### 3. Webhook 端点

插件启动后会监听以下端点接收消息：

- **全局 Webhook**: `POST http://127.0.0.1:9002/f2a/webhook`
- **Agent 特定 Webhook**: `POST http://127.0.0.1:9002/f2a/webhook/agent:<id_prefix>`

### 4. 消息流程

```
F2A P2P Network → F2A Daemon → Webhook → OpenClaw F2A Plugin → OpenClaw Agent
                                     ↓
                              自动回复 → f2a send → F2A Daemon → P2P Network
```

## 工作原理

### Agent 身份恢复

插件会在 `~/.f2a/agents/` 目录查找已保存的 Agent Identity 文件。如果找到有效的 Identity 且包含 E2EE 公钥，会尝试通过 Challenge-Response 验证恢复身份：

1. 读取本地保存的 Agent Identity
2. 向 Daemon 发送验证请求
3. 使用私钥签名 Challenge
4. 验证成功后恢复会话

### 自动注册

当 `autoRegister` 为 `true` 时，插件会在 Webhook 服务启动后自动向 F2A Daemon 注册：

1. 检测 Daemon 健康状态
2. 尝试恢复已有身份（如果存在）
3. 如果无身份或恢复失败，注册新 Agent
4. 保存 Token 到 Identity 文件

### 消息处理

接收到的消息会通过 OpenClaw 的 Subagent API 转发给 Agent 处理：

1. 解析 Webhook Payload
2. 提取发送者和消息内容
3. 调用 `runtime.subagent.run()` 处理消息
4. 获取 Agent 回复并通过 `f2a send` 发送回发送者

## 相关包

- **@f2a/network** - F2A P2P 网络核心库
- **@f2a/daemon** - F2A HTTP API 服务和 Daemon

## 开发

```bash
# 构建
npm run build

# 测试
npm test

# 测试覆盖率
npm run test:coverage

# 代码检查
npm run lint

# 清理构建产物
npm run clean
```

## 许可证

MIT