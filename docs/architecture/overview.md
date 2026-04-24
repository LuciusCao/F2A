# F2A 架构图

> Friend-to-Agent P2P 网络架构可视化文档

## 架构概览图

**在线查看**: [Excalidraw 链接](https://excalidraw.com/#json=dNafkEJjLqwgUWFkN-k1r,tz-dMt00PnlR8yNRSk6nyw)

本地文件: `docs/F2A-ARCHITECTURE.excalidraw`（可拖拽到 [excalidraw.com](https://excalidraw.com) 编辑）

---

## 四层架构

| 层级 | 职责 | 关键组件 |
|------|------|----------|
| **应用层** | 用户交互入口 | OpenClaw UI、CLI Client、Third-party Apps |
| **Agent 层** | 业务实体管理 | Agent Registry、Message Router、Agent 实例 |
| **Node 层** | 网络基础设施 | F2A Daemon、P2P Network、ControlServer |
| **网络层** | 跨节点通信 | libp2p Mesh、mDNS Discovery、DHT Routing |

---

## 核心概念

### Node vs Agent

```
┌─────────────────────────────────────────────────────────────┐
│  Node                          Agent                        │
│  ────                          ─────                        │
│  • PeerID (libp2p 身份)        • AgentId (节点签发)         │
│  • 网络连接                     • 任务执行                   │
│  • 消息路由                     • 能力管理                   │
│  • 节点发现                     • 信誉积累 ⭐                │
│  • 不处理业务                   • 可迁移到其他 Node          │
│  • 长期运行                     • 生命周期可独立             │
└─────────────────────────────────────────────────────────────┘
```

### AgentId 格式

支持两种格式（向后兼容）：

**旧格式 (RFC 003, 已废弃)**:
```
agent:<PeerId前16位>:<随机8位>

示例: agent:12D3KooWabcd:1a2b3c4d
```

**新格式 (RFC 008, 推荐)**:
```
agent:<公钥指纹16位>

示例: agent:a3b2c1d4e5f67890
```

- 旧格式由节点签发，无法自证身份
- 新格式基于 Agent 自有 Ed25519 公钥指纹，Agent 可独立签名证明身份
- 新格式是当前默认格式，旧格式仍被解析但不再用于新注册

---

## 数据流

### 消息投递优先级

```
1. onMessage 本地回调 (同进程 Agent，同步)
      ↓ 失败则降级
2. Agent Webhook 推送 (向 Agent 配置的 URL 发送 HTTP 请求)
      ↓ 失败则降级
3. 消息队列 (HTTP 轮询，fallback)
```

### 任务委托流程

```
Agent A ──► Node 1 ──► P2P Network ──► Node 2 ──► Agent B
   │           │            │            │           │
   │ 创建任务   │ 查找目标   │ 路由消息   │ 分发到    │ 执行任务
   │ 签名请求   │ 建立连接   │           │ Agent     │ 返回结果
   │           │           │            │           │ 更新信誉
```

---

## 端口用途

| 端口 | 服务 | 说明 |
|------|------|------|
| **9000** | P2P Network | libp2p 监听端口 |
| **9001** | ControlServer | HTTP API (Agent 注册/消息发送) |

> **注意**: 端口 9002 曾是 openclaw-f2a 插件自建 Webhook Server 的默认端口，已于 Issue #140 移除。插件现通过 Gateway URL 接收消息，不再占用独立端口。Agent 的 webhook URL 由用户自行配置，可使用任意端口。

---

## Monorepo 结构

```
packages/
├── network/      # P2P 网络核心 (F2A, P2PNetwork, IdentityManager)
├── daemon/       # 后台服务 (AgentRegistry, MessageRouter, ControlServer)
├── cli/          # 命令行工具 (f2a command)
├── openclaw-f2a/ # OpenClaw 插件集成
├── dashboard/    # Web 管理界面
└── mcp-server/   # MCP 服务器集成
```

---

## 更多文档

- [完整架构设计](./complete.md)
- [API 参考](../guides/api-reference.md)
- [RFC 文档](./rfcs/)
- [快速开始](../../QUICKSTART.md)