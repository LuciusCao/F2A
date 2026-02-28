# F2A (Friend-to-Agent)

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
├── scripts/          # 核心模块
├── examples/         # 使用示例
└── references/       # 协议规范
```

### 手动安装（开发/测试）

```bash
git clone https://github.com/LuciusCao/F2A.git
cd F2A/skill
npm install
```

### 给其他 Agent 一键安装

其他 OpenClaw Agent 可以通过 curl 直接安装到本机 skills 目录：

```bash
# 安装到默认 skills 目录 (~/.openclaw/workspace/skills/f2a-network)
curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash

# 或指定自定义路径
curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --dir /path/to/skills/f2a-network
```

安装后，Agent 会自动读取 `SKILL.md` 并获取 F2A 网络能力。

---

## 使用

### Agent 如何使用

Agent 读取 `skill/SKILL.md` 后，会获得以下能力：

1. **发现** — 扫描局域网内的其他 F2A Agent
2. **配对** — 与其他 Agent 建立加密连接
3. **通信** — 发送点对点消息或广播
4. **协作** — 调用其他 Agent 的技能

### 人类开发者测试

如需手动测试网络功能：

```bash
cd F2A/skill/examples
node serverless-example.js
```

测试命令：
```
/list          - 列出发现的 Agents
/peers         - 列出已连接的 Peers
/connect <id>  - 连接到指定 Agent
/msg <id> <text> - 发送消息
/broadcast <text> - 广播消息
/quit          - 退出
```

### 启动后台服务（推荐）

让 F2A 作为后台服务持续运行：

```bash
cd F2A/skill

# 启动后台服务
nohup node start-daemon.js start > /dev/null 2>&1 &

# 或使用环境变量指定配置
F2A_AGENT_ID="my-agent" F2A_PORT=9000 nohup node start-daemon.js start > /dev/null 2>&1 &

# 查看状态
node start-daemon.js status

# 停止服务
node start-daemon.js stop
```

或使用 npm 命令：

```bash
npm run daemon:start   # 启动（需要配合 nohup 使用）
npm run daemon:status  # 查看状态
npm run daemon:stop    # 停止
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `F2A_AGENT_ID` | Agent 唯一标识 | 随机生成 |
| `F2A_PORT` | P2P 监听端口 | 9000 |
| `F2A_SECURITY_LEVEL` | 安全等级 | medium |

---

## 安全特性

- 🔐 **端到端加密** - ECDH + AES-256-GCM
- 🛡️ **身份验证** - Ed25519 签名
- ✋ **手动确认** - 新连接需要确认
- 🚫 **黑白名单** - 可配置信任/屏蔽列表
- ⏱️ **速率限制** - 防 DoS 攻击

---

## 项目结构

```
F2A/
├── skill/              # Agent Skill
│   ├── SKILL.md        # Agent 使用指南
│   ├── scripts/        # 核心模块
│   ├── examples/       # 使用示例
│   └── references/     # 协议规范
├── docs/               # 文档
└── install.sh          # 安装脚本
```

---

## 文档

- [SKILL.md](skill/SKILL.md) - Agent 使用指南 (符合 [AgentSkills Specification](https://agentskills.io/specification))
- [protocol.md](skill/references/protocol.md) - 协议规范
- [security-design.md](docs/security-design.md) - 安全设计

---

## 规范合规

本项目遵循 [AgentSkills Specification](https://agentskills.io/specification)：
- ✅ SKILL.md 包含 YAML frontmatter
- ✅ 渐进式披露设计
- ✅ 资源分离: scripts/, references/, examples/

---

## License

MIT — "En Taro Adun!"
