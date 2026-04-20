# F2A 文档中心

> Friend-to-Agent P2P 网络协议文档

---

## 快速导航

| 类别 | 文档 | 说明 |
|------|------|------|
| **架构** | [架构概览](architecture/overview.md) | 四层架构、Node vs Agent 概念 |
| | [完整架构](architecture/complete.md) | 详细架构设计、RFC 实现 |
| | [Daemon 模块](architecture/daemon-modules.md) | Daemon 内部架构、handlers 目录 |
| **使用指南** | [API 参考](guides/api-reference.md) | 完整 API 文档、v0.6.0 新模块 |
| | [工具函数](guides/utils.md) | utils 目录工具使用说明 |
| | [类型定义](guides/types.md) | 核心类型定义说明 |
| | [中间件](guides/middleware.md) | 中间件系统使用指南 |
| **协议规格** | [消息协议](protocols/message.md) | 两层协议设计、消息类型定义 |
| | [mDNS 发现](protocols/mdns.md) | mDNS/DNS-SD 自动发现规格 |
| **设计参考** | [A2A 借鉴](design/a2a-lessons.md) | Google A2A 协议借鉴思路 |
| **RFC** | [RFC 目录](rfcs/) | 规范提案文档 |

---

## RFC 文档索引

| RFC | 标题 | 状态 |
|-----|------|------|
| [002](rfcs/002-cli-agent-architecture.md) | CLI/Agent 架构分离 | Draft |
| [003](rfcs/003-agentid-issuance.md) | AgentId 节点签发 | ✅ Implemented |
| [004](rfcs/004-webhook-plugin-architecture.md) | Webhook 插件架构 | ✅ Implemented |
| [005](rfcs/005-architecture-unification.md) | 架构统一 | ✅ Implemented |
| [007](rfcs/007-agent-token-encryption.md) | Agent Token 加密 | ✅ Implemented |
| [008](rfcs/008-agent-self-identity.md) | Agent Self-Identity | ✅ Implemented |

---

## 版本信息

- **当前版本**: v0.6.0
- **最后更新**: 2026-04-20
- **实现状态**: RFC 003/004/005/007/008 已完成

---

## 文档结构

```
docs/
├── README.md              # 本文档（导航索引）
├── architecture/          # 架构文档
│   ├── overview.md        # 架构概览
│   ├── complete.md        # 完整架构设计
│   └── daemon-modules.md  # Daemon 内部架构
├── guides/                # 使用指南
│   ├── api-reference.md   # API 参考
│   ├── utils.md           # 工具函数指南
│   ├── types.md           # 类型定义指南
│   └── middleware.md      # 中间件指南
├── protocols/             # 协议规格
│   ├── message.md         # 消息协议
│   ├── mdns.md            # mDNS 发现协议
├── design/                # 设计参考
│   └── a2a-lessons.md     # A2A 协议借鉴
├── rfcs/                  # RFC 规范文档
├── refactor/              # 重构计划（进行中）
│   └── f2a-init-refactor-plan.md
```