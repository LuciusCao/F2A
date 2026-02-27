# F2A

> **"En Taro Adun!"** 🚀
> 
> F2A = **F2** (选中所有单位) + **A** (A过去)
> 
> 灵感来自星际争霸中神族的"卡拉"心灵连接——让所有 Agent 像神族战士一样连接成一个整体，然后一起"A过去"解决问题！

## 项目结构

```
F2A/
├── server/          # F2A 服务端
│   ├── server.js    # 会合服务器 + Skill 更新服务
│   ├── package.json
│   └── README.md
│
└── skill/           # F2A Skill (OpenClaw Agent)
    ├── scripts/
    │   ├── discover.js    # 自动发现 + 更新检测
    │   ├── pair.js        # 配对逻辑
    │   ├── peers.js       # Peer 管理
    │   └── update.js      # 自更新
    ├── references/
    │   └── protocol.md    # 协议规范
    ├── SKILL.md
    └── package.json
```

## 功能特性

### 1. 自动发现 🔍

局域网内 Agent 自动发现 F2A Server，无需手动配置：

```
Agent A                    局域网广播                    F2A Server
   |                           |                              |
   |-- "F2A_DISCOVER" -------->|                              |
   |                           |---- "发现请求" -------------->|
   |                           |                              |
   |                           |<--- {"type":"F2A_HERE", -----|
   |                           |      "server":"ws://...",     |
   |                           |      "skillVersion":"1.0.1"}  |
   |<-- 自动连接服务器 ----------|                              |
```

### 2. 自动更新 📦

Agent 发现 Server 后自动检测并下载 Skill 更新：

```bash
# 发现服务器时
🔍 正在搜索 F2A Server...
✅ 发现服务器: ws://192.168.1.100:8765
📦 Update available: 1.0.1 (current: 1.0.0)
⬇️  Downloading update...
✅ Update saved to ./f2a-skill-update.tar.gz
```

### 3. P2P 配对 🔗

- 生成限时配对码（5分钟）
- 交换公钥和身份信息
- 建立信任关系
- 直接 P2P 连接

## 快速开始

### 部署 Server

```bash
cd F2A/server
npm install
npm start

# 输出:
# [F2A Server] Running on port 8765
# [Discovery] UDP service running on port 8766
```

### 打包 Skill

```bash
cd F2A/skill
tar -czf ../server/f2a-skill.tar.gz .
```

### Agent 使用

```bash
# 自动发现、更新、配对
node scripts/discover.js
```

## API 端点

| 端点 | 说明 |
|------|------|
| `WS /register` | 注册配对码 |
| `WS /pair/:code` | 加入配对 |
| `GET /health` | 健康检查 |
| `GET /skill/info` | Skill 版本信息 |
| `GET /skill/download` | 下载 Skill 包 |
| `UDP 8766` | 自动发现服务 |

## 端口说明

| 端口 | 协议 | 用途 |
|------|------|------|
| 8765 | TCP/WebSocket | 配对服务 |
| 8766 | UDP | 自动发现 |

## 环境变量

```bash
# Server
PORT=8765                    # WebSocket 端口
DISCOVERY_PORT=8766          # UDP 发现端口
SKILL_PACKAGE_PATH=./f2a-skill.tar.gz  # Skill 包路径

# Skill
F2A_RENDEZVOUS=ws://localhost:8765    # 指定服务器
F2A_AUTO_UPDATE=true                  # 自动更新
```

## 部署场景

### 场景 1：NAS + 花生壳（推荐）

```
你的 NAS (家里)
├── 花生壳客户端 (内网穿透)
├── F2A Server
│   ├── WebSocket 8765
│   ├── UDP 8766 (发现)
│   └── f2a-skill.tar.gz (Skill 包)
└── 其他服务

Agent (任何地方)
├── 自动发现 NAS
├── 下载最新 Skill
└── 连接配对
```

### 场景 2：本地局域网

```
电脑 A (运行 F2A Server)
电脑 B (OpenClaw + F2A Skill)
手机 C (OpenClaw + F2A Skill)

同一 WiFi 下自动发现，零配置！
```

## 更新流程

```
1. 开发者更新 skill/ 代码
        ↓
2. 打包: tar -czf f2a-skill.tar.gz skill/
        ↓
3. 放到 server/ 目录
        ↓
4. Agent 发现 Server
        ↓
5. 检测到新版本
        ↓
6. 自动下载更新
        ↓
7. 应用更新，重启 Agent
```

## 协议流程

```
Agent A                              F2A Server                              Agent B
   |                                         |                                       |
   |-- UDP "F2A_DISCOVER" ------------------>|                                       |
   |<-- {"server":"ws://...", "skillVersion"} |                                       |
   |                                         |                                       |
   |-- GET /skill/info --------------------->|                                       |
   |<-- {"version":"1.0.1", "downloadUrl"}    |                                       |
   |                                         |                                       |
   |-- GET /skill/download ----------------->|                                       |
   |<-- [f2a-skill.tar.gz]                   |                                       |
   |                                         |                                       |
   |-- WS /register ------------------------>|                                       |
   |<-- {"type":"pair_code", "code":"X7K9M2"}  |                                       |
   |                                         |                                       |
   |                                         |<-- WS /pair/X7K9M2 --------------------|
   |                                         |<-- {"type":"identity", ...} ------------|
   |                                         |                                       |
   |<-- {"type":"peer_connected", peer: B} ---|--> {"type":"peer_connected", peer: A} ->|
   |                                         |                                       |
   |<=================== 建立 P2P 连接 ============================================>|
```

## License

MIT — "En Taro Adun!"
