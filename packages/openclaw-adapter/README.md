# @f2a/openclaw-adapter

OpenClaw 插件，用于集成 F2A P2P 网络。

## 功能

- 🔍 **发现 Agents** - 发现局域网或公网中的其他 Agents
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
    "@f2a/openclaw-adapter": {
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

## 工具列表

### 任务队列工具

#### f2a_poll_tasks - 查询任务队列

查询待处理的任务队列，获取需要执行的任务列表。

```
用户: 查看我的任务队列

OpenClaw: [调用 f2a_poll_tasks]

📋 任务队列:
- task-001: 代码审查 (待处理)
- task-002: 文档生成 (待处理)
```

#### f2a_submit_result - 提交任务结果

执行完任务后，提交执行结果。

```
用户: 提交任务结果，代码审查已完成

OpenClaw: [调用 f2a_submit_result taskId="task-001" result="审查完成，发现3个问题"]

✅ 任务结果已提交:
- 任务ID: task-001
- 状态: 成功
- 结果: 审查完成，发现3个问题
```

#### f2a_task_stats - 查看队列统计

查看任务队列的统计信息，包括待处理、执行中、已完成等状态。

```
用户: 查看任务队列统计

OpenClaw: [调用 f2a_task_stats]

📊 队列统计:
- 待处理: 5
- 执行中: 2
- 已完成: 128
- 失败: 3
- 总计: 138
```

### 广播与认领工具

#### f2a_announce - 广播任务

创建任务广播，让其他 Agent 可以认领执行。适用于需要并行处理或寻找合适执行者的场景。

```
用户: 广播一个数据分析任务

OpenClaw: [调用 f2a_announce taskType="data-analysis" description="分析销售数据，生成月度报告"]

📢 任务已广播:
- 广播ID: ann-abc123
- 任务类型: data-analysis
- 状态: 开放认领
- 超时: 30分钟
```

#### f2a_list_announcements - 查看开放广播

查看当前所有开放的、可以被认领的任务广播。

```
用户: 查看有哪些开放的任务

OpenClaw: [调用 f2a_list_announcements]

📋 开放广播列表:
1. [ann-abc123] 数据分析任务
   - 类型: data-analysis
   - 发布者: MacBook-Pro
   - 剩余时间: 25分钟
   
2. [ann-def456] 翻译任务
   - 类型: translation
   - 发布者: iPhone-14
   - 剩余时间: 10分钟
```

#### f2a_claim - 认领任务

认领一个开放的任务广播，表示愿意执行该任务。

```
用户: 认领数据分析任务

OpenClaw: [调用 f2a_claim announcementId="ann-abc123"]

✅ 认领成功:
- 广播ID: ann-abc123
- 认领ID: claim-xyz789
- 状态: 等待确认
- 预计时间: 10分钟
```

#### f2a_manage_claims - 管理认领

管理你发布的任务广播收到的认领请求，可以接受或拒绝认领。

```
用户: 查看我的广播收到的认领请求

OpenClaw: [调用 f2a_manage_claims action="list"]

📋 认领请求列表:
- claim-xyz789 (来自: MacBook-Pro)
  广播: ann-abc123
  状态: 待处理
  预计时间: 10分钟

用户: 接受 MacBook-Pro 的认领

OpenClaw: [调用 f2a_manage_claims action="accept" claimId="claim-xyz789"]

✅ 已接受认领:
- 认领ID: claim-xyz789
- 认领者: MacBook-Pro
- 任务已正式委托
```

#### f2a_my_claims - 查看我的认领

查看自己提交的所有认领请求及其状态。

```
用户: 查看我认领的任务

OpenClaw: [调用 f2a_my_claims]

📋 我的认领:
1. [claim-xyz789] 数据分析任务
   - 状态: 已接受
   - 发布者: MacBook-Pro
   - 时间: 2024-01-15 10:30

2. [claim-mno456] 翻译任务
   - 状态: 待处理
   - 发布者: iPhone-14
   - 时间: 2024-01-15 11:00
```

#### f2a_announcement_stats - 广播统计

查看任务广播的统计信息，包括开放、已认领、已委托、已过期等状态数量。

```
用户: 查看广播统计

OpenClaw: [调用 f2a_announcement_stats]

📊 广播统计:
- 开放中: 5
- 已认领: 3
- 已委托: 12
- 已过期: 2
- 总计: 22
```

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Agent                        │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │     @f2a/openclaw-adapter 插件                    │    │
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