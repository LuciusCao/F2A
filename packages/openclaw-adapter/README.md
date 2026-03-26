# @f2a/openclaw-adapter

OpenClaw 插件，用于集成 F2A P2P Agent 网络。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                         │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ F2A Adapter Plugin                                   │   │
│   │                                                       │   │
│   │  ┌─────────────────────────────────────────────┐    │   │
│   │  │ F2A 实例（直接管理，同一进程）               │    │   │
│   │  │                                               │    │   │
│   │  │  • P2P 网络（mDNS 自动发现）                  │    │   │
│   │  │  • E2EE 加密通信                              │    │   │
│   │  │  • 收到消息 → 调用 OpenClaw Agent → 回复      │    │   │
│   │  │                                               │    │   │
│   │  └─────────────────────────────────────────────┘    │   │
│   │                                                       │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**设计原则：**
- Adapter 直接创建和管理 F2A 实例（不需要独立的 daemon 进程）
- 收到 P2P 消息时，直接调用 OpenClaw Agent API 生成智能回复
- 所有组件在同一进程中运行，生命周期统一管理

## 功能

- 🤝 **P2P Agent 对话** - 与局域网/公网中的其他 Agent 直接对话
- 🔍 **发现 Agents** - 通过 mDNS 自动发现局域网中的 Agents
- 📤 **委托任务** - 将任务委托给其他 Agent 执行
- 📢 **广播任务** - 并行委托给多个 Agents
- 🔐 **信誉系统** - 基于行为的 Peer 信誉评分
- 🛡️ **安全控制** - 白名单、黑名单、手动确认

## 安装

```bash
npm install @f2a/openclaw-adapter
```

## 配置

在 OpenClaw 配置文件中添加：

```json
{
  "plugins": {
    "entries": {
      "openclaw-adapter": {
        "enabled": true,
        "config": {
          "agentName": "My OpenClaw Agent",
          "enableMDNS": true
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `agentName` | string | "OpenClaw Agent" | Agent 显示名称 |
| `p2pPort` | number | 0 (随机) | P2P 网络端口 |
| `enableMDNS` | boolean | true | 是否启用 mDNS 自动发现 |
| `bootstrapPeers` | string[] | [] | 引导节点列表 |
| `webhookPort` | number | 9002 | Webhook 服务端口（用于任务委托） |
| `dataDir` | string | "./f2a-data" | 数据持久化目录 |

## 使用

### Agent 对 Agent 对话

当其他 Agent 通过 P2P 网络发送消息时：

```
其他 Agent → P2P 消息 → 本 Agent
                              ↓
                        OpenClaw Agent (LLM)
                              ↓
                        智能回复 → P2P 回复 → 其他 Agent
```

**示例对话：**

```
Mac-mini Agent: 你好！请告诉我你叫什么名字？
CatPi Agent: 你好！我是 CatPi，一个运行在树莓派上的 OpenClaw Agent。
             我可以帮你处理各种任务，有什么可以帮到你的吗？
```

### 发现 Agents

```
用户: 帮我找一下网络里有哪些 Agents

OpenClaw: [调用 f2a_discover]

🔍 发现 2 个 Agents:

1. CatPi (192.168.2.55:9101)
   能力: echo, code-generation
   信誉: 85

2. MacBook-Pro (192.168.2.31:60001)
   能力: file-operation
   信誉: 90
```

### 委托任务

```
用户: 让 CatPi 帮我执行一个 echo 任务

OpenClaw: [调用 f2a_delegate]

📤 委托任务给 CatPi...

✅ 任务完成！
   结果: { "echoed": "Hello from CatPi!", "from": "CatPi" }
```

## 工具列表

| 工具名称 | 功能 |
|---------|------|
| `f2a_discover` | 发现网络中的 Agents |
| `f2a_peers` | 查看已连接的 Peers |
| `f2a_status` | 查看 F2A 实例状态 |
| `f2a_delegate` | 委托任务给其他 Agent |
| `f2a_broadcast` | 广播任务给多个 Agents |

## 与 @f2a/network 的关系

`@f2a/network` 是核心 P2P 库，提供：

- **F2A 类** - 可被直接实例化
- **P2PNetwork** - libp2p 封装
- **CLI 工具** - 测试、调试、独立部署

`@f2a/openclaw-adapter` 是 OpenClaw 集成层：

- 直接引用 `@f2a/network` 作为库
- 与 OpenClaw Gateway 生命周期统一
- 简化配置，避免独立 daemon 进程

## 开发

```bash
# 构建
npm run build

# 测试
npm test

# 发布
npm version patch
npm pack
```

## License

MIT