# Changelog

> F2A 项目版本历史记录

所有 notable 变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### Added
- 新增 MCP Server 包 (`@f2a/mcp-server`)，支持通过 Model Context Protocol 让 AI 助手操作 F2A 网络
- RFC 011: Agent Identity Verification Chain — Agent 身份验证链机制
- 完善项目文档体系：配置指南、部署指南、故障排查、安全指南
- 新增 `packages/mcp-server/README.md` 和 `packages/dashboard/README.md`

### Changed
- 更新 `docs/README.md` RFC 索引，补充 RFC 001/009/010/011
- `packages/dashboard/README.md` 从英文重写为中文，补充详细功能说明

---

## [0.8.0] - 2026-04-23 (@f2a/network)

### Added
- RFC 008: Agent Self-Identity 完整实现
  - Agent 自持有 Ed25519 密钥对
  - AgentId = `agent:<公钥指纹16位>`
  - Challenge-Response 认证机制
- RFC 011: Agent Identity Verification Chain 草案
  - 自签名验证
  - Node 签发验证
  - 跨节点验证链

### Changed
- 身份系统重构：Agent 身份不再依赖 Node 签发
- CLI JSON 输出全面支持所有命令

---

## [0.16.0] - 2026-04-22 (@f2a/cli)

### Added
- CLI 全面支持 `--json` 输出模式
- 国际化帮助文本（英文）
- `f2a identity` 命令组：status / export / import

### Fixed
- 参数解析支持 `--key=value` 格式
- JSON 模式下错误信息正确序列化

---

## [0.7.5] - 2026-04-18 (@f2a/network)

### Added
- RFC 007: Agent Token 加密存储（Phase 1-2）
- 内存安全擦除 `secureWipe()` 工具函数

### Changed
- 认证机制从持久 Token 改为 Challenge-Response

---

## [0.9.0] - 2026-04-15 (@f2a/daemon)

### Added
- RFC 005: 架构统一 — MessageRouter/AgentRegistry 提升到核心层
- Relay 访问控制配置（白名单/黑名单/信誉限制）

### Changed
- 移除 Daemon 中重复的 AgentRegistry 和 MessageRouter
- 统一使用 `@f2a/network` 核心实现

---

## [0.5.0] - 2026-04-14 (@f2a/openclaw-f2a)

### Added
- RFC 004: Webhook 插件架构
- Agent 级 Webhook 配置
- Agent Identity 持久化机制

### Changed
- 移除自建 HTTP Server（不再监听 9002 端口）
- 使用 OpenClaw Gateway 的 `registerHttpRoute` API

---

## [0.1.0] - 2026-04-10 (@f2a/dashboard)

### Added
- F2A Dashboard 初始版本
- 网络拓扑可视化（SVG）
- 节点列表与状态监控
- 实时数据刷新（5秒间隔）
- Control Token 认证

---

## [0.6.0] - 2026-04-08

### Added
- 模块化组件拆分（v0.6.0+）
  - `MessageHandler` — P2P 消息处理
  - `MessageSender` — 消息发送与广播
  - `QueueManager` — 消息队列管理
  - `WebhookPusher` — Agent Webhook 转发
- 服务接口定义（`IAgentRegistry`, `IMessageRouter`）

### Changed
- 所有中间件相关模块导出到主包入口
- 类型定义统一从 `@f2a/network` 导入

---

## [0.5.0] - 2026-04-01

### Added
- mDNS 自动发现协议完整实现
- DHT 路由支持
- NAT 穿透（AutoNAT, DCUtR）
- Circuit Relay v2 支持

---

## [0.4.0] - 2026-03-25

### Added
- `@f2a/daemon` 包 — HTTP Control Server
- `@f2a/cli` 包 — 命令行工具
- Agent 注册/注销/发现功能
- 消息路由与队列管理

---

## [0.3.0] - 2026-03-15

### Added
- `@f2a/network` 包初始版本
- libp2p P2P 网络封装
- Node/Agent 双身份系统基础
- E2EE 加密支持

---

## [0.2.0] - 2026-03-01

### Added
- 项目初始架构设计
- Excalidraw 架构图
- RFC 001-002 草案

---

## [0.1.0] - 2026-02-20

### Added
- 项目初始化
- Monorepo 结构搭建
- 基础构建工具链

---

## 版本对照表

| 包 | 当前版本 | 状态 |
|---|---|---|
| `@f2a/network` | 0.8.0 | 活跃开发 |
| `@f2a/daemon` | 0.9.2 | 活跃开发 |
| `@f2a/cli` | 0.16.9 | 活跃开发 |
| `@f2a/openclaw-f2a` | 0.5.2 | 活跃开发 |
| `@f2a/dashboard` | 0.1.0 | 活跃开发 |
| `@f2a/mcp-server` | — | 新增 |

---

## 参考

- [完整 RFC 目录](docs/rfcs/)
- [GitHub Releases](https://github.com/LuciusCao/F2A/releases)
