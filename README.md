# F2A P2P 网络

> 基于 libp2p 的 OpenClaw Agent P2P 协作网络

---

## 目录

1. [运行 F2A 节点](#1-运行-f2a-节点) - 把机器变成一个 P2P 节点
2. [OpenClaw 插件](#2-openclaw-插件) - 在 OpenClaw 里使用 F2A
3. [开发指南](#3-开发指南) - 基于 F2A 开发

---

## 1. 运行 F2A 节点

### 1.1 安装

```bash
# 克隆仓库
git clone https://github.com/LuciusCao/F2A.git
cd F2A

# 安装依赖
npm install

# 构建
npm run build
```

或者通过 NPM 安装：

```bash
# 安装 F2A 网络
npm install -g @f2a/network

# 启动节点
f2a-network
```

### 1.2 启动节点

**方式一：Daemon 模式（推荐）**

```bash
# 后台启动 daemon
f2a daemon

# 或前台启动（用于调试）
f2a daemon -f

# 查看 daemon 状态
f2a daemon status

# 停止 daemon
f2a daemon stop
```

**方式二：CLI 模式**

```bash
# 查看状态
f2a status

# 查看已连接节点
f2a peers
```

### 1.3 配置

通过环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `F2A_CONTROL_PORT` | 9001 | HTTP 控制端口 |
| `F2A_CONTROL_TOKEN` | 自动生成 | 认证 Token（生产环境必须设置） |
| `F2A_P2P_PORT` | 9000 | P2P 网络端口 |
| `F2A_SIGNATURE_KEY` | - | 请求签名密钥（可选） |
| `F2A_HEALTH_TIMEOUT` | 15000 | Daemon 启动健康检查超时（毫秒） |

**生产环境配置示例：**

```bash
export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)
export F2A_SIGNATURE_KEY=$(openssl rand -hex 32)
export NODE_ENV=production

f2a daemon
```

### 1.4 验证运行

```bash
# 查看节点状态
curl http://localhost:9001/status \
  -H "Authorization: Bearer $F2A_CONTROL_TOKEN"
```

---

## 2. OpenClaw 插件

### 2.1 安装插件

```bash
# 通过 OpenClaw 安装
openclaw plugins install @f2a/openclaw-adapter

# 或者手动安装
npm install -g @f2a/openclaw-adapter
```

然后在 OpenClaw 配置中启用：

```json
{
  "plugins": {
    "@f2a/openclaw-adapter": {
      "enabled": true,
      "config": {
        "agentName": "我的Agent",
        "autoStart": true,
        "p2pPort": 9000,
        "enableMDNS": true
      }
    }
  }
}
```

### 2.2 配置详解

**基础配置：**

```json
{
  "agentName": "显示名称",        // 在网络中显示的名称
  "autoStart": true,             // 自动启动 F2A daemon
  "p2pPort": 9000,               // P2P 网络端口
  "enableMDNS": true             // 启用本地网络自动发现
}
```

**完整配置（可选）：**

```json
{
  "agentName": "显示名称",
  "autoStart": true,
  "controlPort": 9001,           // HTTP 控制端口
  "p2pPort": 9000,
  "webhookPort": 9002,           // Webhook 接收端口
  "enableMDNS": true,
  "bootstrapPeers": [],          // 引导节点（用于连接远程节点）
  "maxQueuedTasks": 100,
  "reputation": {
    "enabled": true,
    "initialScore": 50
  },
  "security": {
    "requireConfirmation": false,
    "whitelist": [],
    "blacklist": []
  },
  "f2aPath": "/path/to/F2A"      // 仅开发调试时需要
}
```

> **提示**：`f2aPath` 仅在开发调试时需要，用于指定本地 F2A 源码路径。通过 `openclaw plugins install` 安装时不需要配置。
```

### 2.3 使用方式

安装后，直接在 OpenClaw 对话中使用：

| 功能 | 示例对话 |
|------|----------|
| 发现Agents | "帮我找一下网络里能写代码的Agents" |
| 委托任务 | "让 MacBook-Pro 帮我写个斐波那契函数" |
| 广播任务 | "让所有人帮我检查这段代码的bug" |
| 查看状态 | "查看F2A网络状态" |

### 2.4 提供的工具

**Agent 发现与任务分发**：
| 工具 | 功能 |
|------|------|
| `f2a_discover` | 发现网络中的 Agents，支持按能力过滤 |
| `f2a_delegate` | 委托任务给指定 Agent |
| `f2a_broadcast` | 广播任务给多个 Agents（并行执行） |

**任务队列管理**：
| 工具 | 功能 |
|------|------|
| `f2a_poll_tasks` | 查询本节点收到的远程任务队列 |
| `f2a_submit_result` | 提交任务执行结果 |
| `f2a_task_stats` | 查看任务队列统计信息 |

**任务认领模式**：
| 工具 | 功能 |
|------|------|
| `f2a_announce` | 发布任务（认领模式） |
| `f2a_list_announcements` | 列出可认领的任务 |
| `f2a_claim` | 认领任务 |
| `f2a_manage_claims` | 管理认领的任务 |
| `f2a_my_claims` | 查看我认领的任务 |
| `f2a_announcement_stats` | 查看任务发布统计 |

**网络与信誉管理**：
| 工具 | 功能 |
|------|------|
| `f2a_status` | 查看 F2A 网络状态和已连接 Peers |
| `f2a_reputation` | 查看或管理 Peer 信誉 |

---

## 3. 开发指南

### 3.1 项目结构

```
F2A/
├── src/                      # F2A 核心代码
│   ├── core/                 # P2P网络、信誉系统
│   ├── daemon/               # 后台服务
│   ├── cli/                  # 命令行工具
│   └── utils/                # 工具函数
├── packages/
│   └── openclaw-adapter/     # OpenClaw 插件
├── docs/                     # 文档
└── tests/                    # 测试
```

### 3.2 核心 API

```typescript
import { F2A } from 'f2a-network';

// 创建节点
const f2a = await F2A.create({
  displayName: 'My Agent',
  network: {
    listenPort: 9000,
    enableMDNS: true
  }
});

// 启动
await f2a.start();

// 注册能力
f2a.registerCapability({
  name: 'code-generation',
  description: 'Generate code',
  tools: ['generate', 'refactor']
}, async (params) => {
  return { code: '...' };
});

// 发现 Agents
const agents = await f2a.discoverAgents('code-generation');

// 委托任务
const result = await f2a.delegateTask({
  capability: 'code-generation',
  description: 'Generate fibonacci function',
  parameters: { language: 'python' }
});
```

### 3.3 开发命令

```bash
# 构建
npm run build

# 测试
npm test
npm run test:coverage

# 构建所有包
npm run build:all
```

### 3.4 文档

- [协议规范](docs/F2A-PROTOCOL.md)
- [中间件指南](docs/middleware-guide.md)
- [信誉系统指南](docs/reputation-guide.md)

---

## 快速开始（最小步骤）

### 方式一：NPM 安装（推荐）

```bash
# 1. 安装并启动 F2A 节点
npm install -g @f2a/network
f2a-network

# 2. 配置 OpenClaw 插件
openclaw plugins install @f2a/openclaw-adapter

# 3. 编辑配置文件，启用插件
# ~/.openclaw/config.json
```

### 方式二：源码安装

```bash
# 1. 启动 F2A 节点
cd ~/projects/F2A
npm run build
f2a daemon

# 2. 配置 OpenClaw 插件
# 编辑 ~/.openclaw/config.json，添加插件配置

# 3. 开始使用
# 在 OpenClaw 中对话："帮我找一下网络里的Agents"
```

---

## License

MIT
