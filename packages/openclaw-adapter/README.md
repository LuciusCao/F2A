# f2a-openclaw-adapter

OpenClaw 插件，用于集成 F2A P2P 网络。

## 功能

- 🔍 **发现 Agents** - 发现局域网或公网中的其他 Agents
- 📤 **委托任务** - 将任务委托给其他 Agent 执行
- 📢 **广播任务** - 并行委托给多个 Agents
- 🔐 **信誉系统** - 基于行为的 Peer 信誉评分
- 🛡️ **安全控制** - 白名单、黑名单、手动确认

## 安装

```bash
npm install f2a-openclaw-adapter
```

## 配置

在 OpenClaw 配置文件中添加：

```json
{
  "plugins": {
    "f2a-openclaw-adapter": {
      "enabled": true,
      "config": {
        "agentName": "My OpenClaw Agent",
        "f2aPath": "~/projects/F2A",
        "autoStart": true,
        "webhookPort": 9002,
        "controlPort": 9001,
        "p2pPort": 9000,
        "enableMDNS": true,
        "reputation": {
          "enabled": true,
          "initialScore": 50,
          "minScoreForService": 20
        },
        "security": {
          "requireConfirmation": false,
          "whitelist": [],
          "blacklist": []
        }
      }
    }
  }
}
```

## 使用

### 发现 Agents

```
用户: 帮我找一下网络里能写代码的 Agents

OpenClaw: [调用 f2a_discover capability=code-generation]

🔍 发现 2 个 Agents:

1. MacBook-Pro (信誉: 85)
   ID: f2a-a1b2-c3d4-e5f6...
   能力: code-generation, file-operation

2. RaspberryPi-4 (信誉: 72)
   ID: f2a-e5f6-g7h8-i9j0...
   能力: code-generation, data-analysis
```

### 委托任务

```
用户: 让 MacBook-Pro 帮我写一个斐波那契函数

OpenClaw: [调用 f2a_delegate agent="MacBook-Pro" task="写斐波那契函数"]

✅ MacBook-Pro 已完成任务:

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```

### 广播任务

```
用户: 让所有人帮我检查这段代码的 bug

OpenClaw: [调用 f2a_broadcast capability=code-generation task="检查代码bug"]

✅ 收到 2/2 个成功响应:

✅ MacBook-Pro (245ms)
   完成

✅ RaspberryPi-4 (312ms)
   完成
```

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Agent                        │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │     f2a-openclaw-adapter 插件                    │    │
│  │                                                  │    │
│  │  • 检测 OpenClaw 能力                            │    │
│  │  • 提供 f2a_* Tools                             │    │
│  │  • 通过 Webhook 接收任务                         │    │
│  │  • 调用 OpenClaw.execute() 执行远程任务          │    │
│  └─────────────────────────────────────────────────┘    │
│                              │                          │
│                              │ HTTP / WebSocket         │
│                              ▼                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              F2A Node (同机部署)                 │    │
│  │                                                  │    │
│  │  • P2P 网络连接 (libp2p)                        │    │
│  │  • mDNS 节点发现                                │    │
│  │  • 消息路由转发                                 │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                              │
                              │ P2P 网络
                              ▼
                    ┌─────────────────┐
                    │   其他 F2A 节点   │
                    └─────────────────┘
```

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 测试
npm test
```

## License

MIT