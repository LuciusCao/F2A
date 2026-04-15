# F2A 重构方案 - 统一包 + 技能模式

> **版本**: v1.0  
> **日期**: 2026-04-13  
> **状态**: 实施中

---

## 📋 背景

### 当前架构的问题

| 问题 | 说明 |
|------|------|
| 每个 Agent 平台一个插件 | OpenClaw、ZeroClaw、OpenFang 各需要一套插件代码 |
| 维护成本高 | 每个插件单独测试、发版、维护 |
| 功能不一致 | 不同平台的插件功能可能不同步 |
| 接入门槛高 | 新 Agent 平台需要等插件开发 |

### 目标架构

**统一安装包 + Agent 技能**：
- 一个 `f2a` 包包含所有核心组件（core、cli、daemon、dashboard）
- Agent 不需要插件，只需要在 skill 目录安装 F2A 技能脚本
- 新 Agent 平台接入零开发成本

---

## 📦 包结构

### Monorepo 结构

```
F2A/
├── packages/
│   ├── @f2a/network/          # 核心网络库（libp2p、加密、发现）
│   ├── @f2a/cli/              # CLI 工具（f2a 命令）
│   ├── @f2a/daemon/           # Daemon 服务（f2ad 后台服务）
│   ├── @f2a/dashboard/        # Web 面板（可视化）
│   └── f2a/                   # ⭐ 统一安装包（meta-package）
│                                依赖: network + cli + daemon + dashboard
│
├── skills/
│   └── f2a/                   # Agent 技能（通用）
│       ├── SKILL.md           # 技能描述
│       ├── install.sh         # 一键安装脚本
│       └── commands/          # 具体命令
│           ├── send.sh        # 发送消息
│           ├── messages.sh    # 查看消息
│           └── discover.sh    # 发现 Agent
│
├── docs/                      # 文档
│   ├── architecture.md        # 架构设计
│   ├── getting-started.md     # 快速开始
│   ├── api/                   # API 文档
│   └── guides/                # 使用指南
│
├── .github/workflows/         # CI/CD
│   ├── ci.yml                 # 持续集成
│   ├── publish-network.yml    # 发布 @f2a/network
│   ├── publish-cli.yml        # 发布 @f2a/cli
│   ├── publish-daemon.yml     # 发布 @f2a/daemon
│   └── publish-f2a.yml        # 发布 f2a 统一包
│
└── package.json               # 根 package.json
```

### 各包职责

| 包 | 职责 | 使用场景 | 版本 |
|----|------|----------|------|
| `@f2a/network` | P2P 网络、加密、发现、消息路由 | 其他包依赖的核心库 | 0.4.18 |
| `@f2a/cli` | `f2a` 命令（send/peers/agent...） | 用户手动执行或脚本调用 | 新包 |
| `@f2a/daemon` | `f2ad` 后台服务 | 系统服务，保持 P2P 连接 | 新包 |
| `@f2a/dashboard` | Web 可视化面板 | 监控网络状态 | 保留 |
| `f2a` | 统一安装包（meta-package） | 一次安装所有组件 | 新包 |

---

## 🔧 安装体验

### 普通用户

```bash
# 一次安装，包含所有组件
npm install -g f2a

# 或者用一键脚本
curl -sSf https://f2a.io/install.sh | sh

# 启动 Daemon
f2a daemon start

# 查看状态
f2a status
```

### Agent 集成（不需要插件！）

```bash
# 在 Agent 的 skill 目录安装 F2A 技能
cd ~/.openclaw/skills/
curl -sSf https://f2a.io/skill-install.sh | sh

# 技能目录结构
~/.openclaw/skills/f2a/
├── SKILL.md           # 技能描述
├── f2a.sh             # 主入口脚本
└── commands/          # 具体命令
    ├── send.sh        # f2a send
    ├── messages.sh    # f2a messages
    └── discover.sh    # f2a discover
```

### Agent 侧 SKILL.md

```markdown
---
name: f2a
description: F2A P2P 网络通信技能。可以发送消息、接收消息、发现网络中的 Agent。
---

# F2A P2P Network

## 命令

### f2a send
发送消息给指定 Agent
- `--to <peer_id>`: 目标 Agent
- `--topic <topic>`: 消息主题
- `<message>`: 消息内容

### f2a messages
查看收到的消息

### f2a discover
发现网络中的 Agent
```

Agent 执行时直接调用：
```bash
f2a send --to 12D3KooWxxx --topic chat "Hello!"
```

---

## 🚀 实施计划

### Phase 1: 包拆分（2 周）

| 任务 | 工作量 | 状态 |
|------|--------|------|
| 创建 @f2a/cli 包 | 1 天 | 待开始 |
| 创建 @f2a/daemon 包 | 1 天 | 待开始 |
| 更新 tsconfig 依赖 | 1 天 | 待开始 |
| 配置 build 流程 | 1 天 | 待开始 |
| 发布到 NPM | 0.5 天 | 待开始 |

### Phase 2: 技能脚本（1 周）

| 任务 | 工作量 | 状态 |
|------|--------|------|
| 创建 skills/ 目录 | 0.5 天 | 待开始 |
| 编写 SKILL.md | 1 天 | 待开始 |
| 编写 install.sh | 1 天 | 待开始 |
| 测试技能安装 | 1 天 | 待开始 |

### Phase 3: 文档更新（1 周）

| 任务 | 工作量 | 状态 |
|------|--------|------|
| 更新 README.md | 1 天 | 待开始 |
| 编写 getting-started.md | 1 天 | 待开始 |
| 编写 architecture.md | 1 天 | 待开始 |
| 清理历史文档 | 1 天 | 待开始 |

### Phase 4: Webhook 插件（RFC 004）- 保留简化版

> **⚠️ 重要更新**: 插件不能完全废弃，需要保留简化版处理消息回调

| 任务 | 工作量 | 状态 |
|------|--------|------|
| 创建 openclaw-f2a-webhook 插件（极简版） | 2 天 | 待开始 |
| 实现 webhook 接收 handler | 1 天 | 待开始 |
| 集成 f2a CLI 发送回复 | 1 天 | 待开始 |
| 测试端到端消息流程 | 1 天 | 待开始 |
| 废弃旧的 openclaw-f2a 插件 | 0.5 天 | 待开始 |

**详细设计**: 见 [RFC 004: Webhook 插件架构](./rfcs/004-webhook-plugin-architecture.md)

---

## 📊 对比

| 维度 | 之前（插件模式） | 现在（技能模式） |
|------|------------------|------------------|
| **安装** | 每个 Agent 单独写插件 | 一次安装，所有 Agent 通用 |
| **维护** | N 个插件要维护 | 只维护一套技能 |
| **更新** | 每个插件单独发版 | `npm update -g f2a` 即可 |
| **接入** | 新 Agent 平台等插件开发 | 直接装技能就能用 |
| **升级** | 需要重新发版插件 | 技能自动调用最新版 CLI |

---

## ✅ 当前状态

- ✅ Phase 1 CLI 增强完成（send/messages/agent 命令）
- ✅ E2EE 密钥交换完成
- ✅ Mac-mini ↔ CatPi 消息通信测试通过
- ✅ NPM 发布（@f2a/network@0.4.18, @f2a/openclaw-f2a@0.3.14）
- ✅ Phase 2 包拆分完成（@f2a/cli, @f2a/daemon, f2a 统一包）
- ⏳ RFC 005 架构统一进行中

## ⚠️ 修订记录

**2026-04-15**: Phase 4 从"废弃插件"改为"Webhook 插件"，详见 RFC 004

---

*方案创建于 2026-04-13 18:50 (Asia/Shanghai)*
