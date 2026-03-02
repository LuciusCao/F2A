# F2A

> **Agent 专用的 P2P 协作网络协议** 🚀
> 
> 灵感来自星际争霸中神族的"卡拉"心灵连接——让多个 OpenClaw Agent 像神族战士一样直接通信，无需服务器协调。

**这不是给人类用的工具 — 这是 Agent 之间的通信协议。**

- ✅ **Agent 开发者** — 让多个 Agent 实例互相发现并协作
- ✅ **多 Agent 系统** — 构建去中心化的 Agent 网络
- ❌ **普通用户** — 你不会直接运行这个

---

**核心特性：纯 P2P、端到端加密、无需中央服务器**

[![AgentSkills](https://img.shields.io/badge/AgentSkills-Specification-blue)](https://agentskills.io/specification)

---

## 安装

### 给 Agent 开发者

F2A 是一个 OpenClaw Agent Skill。Agent 通过读取 `SKILL.md` 来了解如何使用。

```
skill/
├── SKILL.md          # Agent 使用指南
├── f2a.js            # CLI 入口
├── daemon.js         # Daemon 实现
├── scripts/          # 核心模块
└── references/       # 协议规范
```

### 手动安装（开发/测试）

```bash
git clone https://github.com/LuciusCao/F2A.git
cd F2A/skill
npm install
```

### 启动后台服务

让 F2A 作为后台服务持续运行：

```bash
cd F2A/skill

# 后台启动（推荐）
node f2a.js start -D

# 后台启动 + DEBUG 日志
node f2a.js start -D --debug

# 自定义端口和名称
node f2a.js start -D -p 9001 -n "MyAgent"

# 查看状态
node f2a.js status

# 停止服务
node f2a.js stop
```

### 连接确认管理

当其他 Agent 请求连接时，F2A 支持手动确认：

```bash
# 查看待确认连接
node f2a.js pending

# 确认连接（通过序号或ID）
node f2a.js confirm 1
node f2a.js confirm abc-123

# 拒绝连接（可选原因）
node f2a.js reject 2 --reason "不认识该Agent"
```

**工作流程：**
1. Agent A 请求连接到 Agent B
2. Agent B 的 Daemon 发送通知到 OpenClaw
3. 用户在聊天窗口看到通知
4. 用户回复 "f2a 允许 abc-123"
5. Agent B 确认连接，双方建立通信

### OpenClaw 集成

配置 OpenClaw Webhook 接收连接通知：

```bash
# 1. 在 ~/.openclaw/config.json 中启用 webhook
{
  "hooks": {
    "enabled": true,
    "token": "your-secret-token"
  }
}

# 2. 设置环境变量
export OPENCLAW_HOOK_TOKEN="your-secret-token"

# 3. 启动 F2A Daemon
node f2a.js start -D
```

或使用 npm 命令：

```bash
npm run daemon:start   # 启动
npm run daemon:status  # 查看状态
npm run daemon:stop    # 停止
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `F2A_AGENT_ID` | Agent 唯一标识 | 随机生成 |
| `F2A_PORT` | P2P 监听端口 | 9000 |
| `F2A_SECURITY_LEVEL` | 安全等级 (low/medium/high) | medium |
| `F2A_DATA_DIR` | 数据目录 | ~/.f2a |
| `OPENCLAW_HOOK_TOKEN` | OpenClaw Webhook Token | - |
| `OPENCLAW_HOOK_URL` | OpenClaw Webhook URL | http://127.0.0.1:18789/hooks/agent |

---

## 安全特性

- 🔐 **端到端加密** - ECDH + AES-256-GCM
- 🛡️ **身份验证** - Ed25519 签名
- ✋ **手动确认** - 新连接需要用户确认（1小时有效期，自动去重）
- 🚫 **黑白名单** - 可配置信任/屏蔽列表
- ⏱️ **速率限制** - 防 DoS 攻击
- 📱 **OpenClaw 集成** - 通过 Webhook 接收连接通知

---

## 项目结构

```
F2A/
├── skill/              # Agent Skill
│   ├── SKILL.md        # Agent 使用指南
│   ├── f2a.js          # CLI 入口
│   ├── daemon.js       # Daemon 实现
│   ├── scripts/        # 核心模块
│   └── references/     # 协议规范
├── docs/               # 文档
└── install.sh          # 安装脚本
```

---

## 文档

- [SKILL.md](skill/SKILL.md) - Agent 使用指南 (符合 [AgentSkills Specification](https://agentskills.io/specification))
- [protocol.md](skill/references/protocol.md) - 协议规范
- [security-design.md](docs/security-design.md) - 安全设计
- [a2a-lessons.md](docs/a2a-lessons.md) - 借鉴 A2A 协议的设计改进

---

## 规范合规

本项目遵循 [AgentSkills Specification](https://agentskills.io/specification)：
- ✅ SKILL.md 包含 YAML frontmatter
- ✅ 渐进式披露设计
- ✅ 资源分离: scripts/, references/

---

## License

MIT — "En Taro Adun!"
