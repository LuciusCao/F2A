# F2A

> **"En Taro Adun!"** 🚀
> 
> F2A = **F2** (选中所有单位) + **A** (A过去)
> 
> 灵感来自星际争霸中神族的"卡拉"心灵连接——让所有 Agent 像神族战士一样连接成一个整体，然后一起"A过去"解决问题！

**纯 P2P Agent 协作网络，无需服务器，局域网直连。**

[![AgentSkills](https://img.shields.io/badge/AgentSkills-Specification-blue)](https://agentskills.io/specification)

---

## 安装

### 一键安装 (推荐)

```bash
curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash
```

指定端口安装：

```bash
curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --port 9001
```

### 手动安装

```bash
git clone https://github.com/LuciusCao/F2A.git
cd F2A/skill
npm install
```

---

## 使用

### 启动

```bash
# 如果通过 install.sh 安装
f2a

# 或手动运行
cd F2A/skill/examples
node serverless-example.js
```

### 命令行交互

启动后会进入交互模式：

```
Commands:
  /list          - 列出发现的 Agents
  /peers         - 列出已连接的 Peers
  /connect <id>  - 连接到指定 Agent
  /msg <id> <text> - 发送消息
  /broadcast <text> - 广播消息
  /quit          - 退出
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
