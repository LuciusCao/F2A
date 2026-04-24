# @f2a/openclaw-f2a

OpenClaw Gateway 的 F2A 插件，让 Agent 通过 OpenClaw 接收 F2A P2P 网络消息。

## 功能特性

- **Webhook 接收** - 通过 OpenClaw Gateway 的 HTTP 路由接收来自 F2A 网络的消息
- **Agent 身份恢复** - 支持通过 Challenge-Response 验证恢复已有 Agent 身份
- **消息转发** - 自动将接收的消息转发给 OpenClaw Agent 处理
- **自动注册** - 启动时自动向 F2A Daemon 注册 Agent
- **身份持久化** - 保存 Agent Identity 和 Token，支持断线重连
- **Skills 自动加载** - 插件携带 F2A 相关 Skills，安装后自动可用

## 安装

作为 OpenClaw Gateway 插件安装：

```bash
# 在 OpenClaw Gateway 目录下
npm install @f2a/openclaw-f2a
```

## 配置

在 OpenClaw Gateway 的配置文件中配置插件（配置项位于 `plugins.entries['openclaw-f2a'].config` 下）：

```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "config": {
          "webhookPath": "/f2a/webhook",
          "webhookToken": "your-secure-token",
          "agentTimeout": 60000,
          "controlPort": 9001,
          "agentName": "OpenClaw Agent",
          "agentCapabilities": ["chat", "task"],
          "autoRegister": true
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `webhookPath` | string | `/f2a/webhook` | Webhook 接收路径（由 OpenClaw Gateway 处理） |
| `webhookToken` | string | `''` | Webhook 认证 Token |
| `agentTimeout` | number | `60000` | Agent 响应超时时间（毫秒） |
| `controlPort` | number | `9001` | F2A Daemon 控制端口 |
| `agentName` | string | `'OpenClaw Agent'` | Agent 名称 |
| `agentCapabilities` | string[] | `['chat', 'task']` | Agent 能力列表 |
| `autoRegister` | boolean | `true` | 启动时自动注册到 Daemon |

> **注意**: 自 v0.5.0 起，插件不再使用单独的 HTTP 端口，而是通过 OpenClaw Gateway 的 `registerHttpRoute` API 注册 HTTP 路由。Webhook URL 默认为 `http://127.0.0.1:18789/f2a/webhook`（Gateway 默认端口）。

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
2. 配置已添加到 Gateway 配置文件
3. 重启 OpenClaw Gateway

### 3. Webhook 端点

插件通过 OpenClaw Gateway 的 HTTP 路由接收消息：

- **全局 Webhook**: `POST http://127.0.0.1:18789/f2a/webhook`
- **Agent 特定 Webhook**: `POST http://127.0.0.1:18789/f2a/webhook/agent:<id_prefix>`

Gateway 自动处理：
- Rate limiting
- Auth validation
- Request deduplication

### 4. 消息流程

```
F2A P2P Network → F2A Daemon → Gateway Webhook → OpenClaw F2A Plugin → OpenClaw Agent
                                      ↓
                               自动回复 → f2a send → F2A Daemon → P2P Network
```

## Skills 自动加载

插件安装后，以下 Skills 会自动加载到 OpenClaw Agent：

- **f2a-agent** - Agent 身份管理
- **f2a-node** - 节点管理
- **f2a-messaging** - F2A P2P 网络消息发送
- **f2a-discover** - Agent 发现

Skills 存储在插件的 `skills/` 目录，无需手动复制。

## 工作原理

### HTTP Route 注册 (v0.5.0+)

插件使用 OpenClaw Gateway 的 `registerHttpRoute` API 注册 HTTP 路由：

```typescript
api.registerHttpRoute({
  path: '/f2a/webhook',
  auth: 'plugin',  // 插件处理自己的 token 验证
  handler: (req, res) => handleWebhookRequest(api, config, req, res)
});
```

Gateway 负责基础的 HTTP 处理，插件只处理 F2A 特有的业务逻辑。

### Agent 身份恢复

插件会在 `~/.f2a/agent-identities/` 目录查找已保存的 Agent Identity 文件。如果找到有效的 Identity 且包含私钥，会尝试通过 Challenge-Response 验证恢复身份：

1. 读取本地保存的 Agent Identity
2. 向 Daemon 发送验证请求
3. 使用私钥签名 Challenge
4. 验证成功后恢复会话

### 自动注册

当 `autoRegister` 为 `true` 时，插件会在启动后自动向 F2A Daemon 注册：

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

## 相关 RFC

- [RFC003](../../docs/rfcs/003-agentid-issuance.md) - Agent ID 发行机制
- [RFC004](../../docs/rfcs/004-webhook-plugin-architecture.md) - Webhook 插件架构
- [RFC007](../../docs/rfcs/007-agent-token-encryption.md) - Agent Token 加密存储
- [RFC008](../../docs/rfcs/008-agent-self-identity.md) - Agent 自签名身份验证
- [RFC009](../../docs/rfcs/009-plugin-skills-auto-loading.md) - Plugin Skills 自动加载机制
- [RFC011](../../docs/rfcs/011-agent-identity-verification-chain.md) - Agent 身份验证链（selfSignature）

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

# 准备发布（会同步 skills）
npm run prepack
```

## 版本历史

### v0.5.0 (Issue #140)

- 移除自建 HTTP Server（不再监听 9002 端口）
- 使用 OpenClaw Gateway 的 `registerHttpRoute` API
- Gateway 自动处理 Rate limiting、Auth、Deduplication
- 移除 `webhookPort` 配置项
- 添加 Skills 自动加载支持

## 许可证

MIT
