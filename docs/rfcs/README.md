# F2A RFC 文档索引

> Request for Comments — F2A 协议与架构设计规范

---

## 概述

RFC（Request for Comments）文档记录 F2A 项目的重要架构决策、协议设计和实现规范。每个 RFC 都有唯一编号，按顺序递增。

---

## RFC 列表

| 编号 | 标题 | 状态 | 创建日期 | 说明 |
|------|------|------|----------|------|
| [RFC 001](001-reputation-system.md) | 去中心化信誉系统 | 搁置 (Shelved) | 2026-04 | 信誉评分与评审委员会机制 |
| [RFC 002](002-cli-agent-architecture.md) | CLI/Agent 架构分离 | 已实现 | 2026-04 | CLI 与 Agent 职责划分 |
| [RFC 003](003-agentid-issuance.md) | AgentId 签发与验证机制 | 已废弃 | 2026-04-14 | 被 RFC 008 取代 |
| [RFC 004](004-webhook-plugin-architecture.md) | Webhook 插件架构 | 已实现 | 2026-04-14 | OpenClaw Webhook 集成设计 |
| [RFC 005](005-architecture-unification.md) | 架构统一 — MessageRouter 提升到核心层 | 已完成 | 2026-04-15 | 核心层架构重构 |
| [RFC 006](006-agent-identity-philosophy.md) | Agent Identity Philosophy | Draft | 2026-04-26 | 身份本质、安全漏洞、信任模型 |
| [RFC 007](007-agent-token-encryption.md) | Agent Token 内存管理 | 已实现 (Phase 1-2) | 2026-04-18 | Token 加密与 Challenge-Response |
| [RFC 008](008-agent-self-identity.md) | Agent Self-Identity | 已实现 | 2026-04-20 | Agent 自持有 Ed25519 身份 |
| [RFC 009](009-plugin-skills-auto-loading.md) | Plugin Skills 自动加载机制 | 已实现 | 2026-04-21 | OpenClaw Skills 自动分发 |
| [RFC 010](010-cli-json-error-handling-research.md) | CLI JSON 错误处理研究 | 研究文档 | 2026-04 | JSON 输出与错误处理设计 |
| [RFC 011](011-agent-identity-verification-chain.md) | Agent Identity Verification Chain | 已实现 | 2026-04-24 | Agent 身份验证链 |
| [RFC 011-Impl](011-implementation-plan.md) | RFC 011 实现计划 | 计划文档 | 2026-04-24 | RFC 011 的详细实施步骤 |
| [RFC 012](012-self-send-protection.md) | Self-send Protection | 已实现 | 2026-04-24 | Self-send 防止无限循环 |
| [RFC 013](013-message-exit-mechanism.md) | Message Exit Mechanism | Draft | 2026-04-24 | 消息退出机制与 reason |
| [RFC 014](014-agent-onboarding-flow.md) | Agent Onboarding Flow | Draft | 2026-04-26 | Agent 初始化流程 |

---

## 状态说明

| 状态 | 含义 |
|------|------|
| 已实现 (Implemented) | 设计已完成并编码实现 |
| 已完成 (Completed) | 设计、实现、测试全部完成 |
| Draft | 草案阶段，正在讨论或实现中 |
| 研究文档 (Research) | 技术调研，不一定需要实现 |
| 已废弃 (Deprecated) | 被新的 RFC 取代，不再维护 |
| 搁置 (Shelved) | 暂停开发，未来可能重启 |

---

## 按主题分类

### 身份与认证

- [RFC 003](003-agentid-issuance.md) — AgentId 签发（已废弃）
- [RFC 006](006-agent-identity-philosophy.md) — 身份本质与信任模型
- [RFC 007](007-agent-token-encryption.md) — Token 加密管理
- [RFC 008](008-agent-self-identity.md) — Agent Self-Identity
- [RFC 011](011-agent-identity-verification-chain.md) — 身份验证链
- [RFC 014](014-agent-onboarding-flow.md) — Agent Onboarding 流程

### 架构与模块

- [RFC 002](002-cli-agent-architecture.md) — CLI/Agent 分离
- [RFC 005](005-architecture-unification.md) — 架构统一

### 集成与插件

- [RFC 004](004-webhook-plugin-architecture.md) — Webhook 插件
- [RFC 009](009-plugin-skills-auto-loading.md) — Skills 自动加载

### 系统机制

- [RFC 001](001-reputation-system.md) — 信誉系统
- [RFC 010](010-cli-json-error-handling-research.md) — CLI JSON 错误处理

---

## 如何提交新 RFC

1. 使用下一个可用编号（当前为 015）
2. 复制 [RFC 模板](#rfc-模板) 创建新文件
3. 在本文档索引中添加条目
4. 提交 PR

### RFC 模板

```markdown
# RFC-XXX: 标题

| 字段 | 值 |
|------|-----|
| 状态 | Draft |
| 创建日期 | YYYY-MM-DD |
| 作者 | 你的名字 |

## 摘要

简要描述本 RFC 的目的和范围。

## 动机

为什么需要这个 RFC？解决什么问题？

## 详细设计

### 方案概述

### 接口定义

### 数据流

## 兼容性

对现有系统的影响，如何迁移。

## 参考

相关文档、Issue 链接。
```

---

## 历史变更

- **2026-04-26** — 添加 RFC 006（Agent Identity Philosophy）、RFC 014（Agent Onboarding Flow）
- **2026-04-24** — 添加 RFC 011（Agent Identity Verification Chain）
- **2026-04-21** — 添加 RFC 009（Skills 自动加载），RFC 003 标记为废弃
- **2026-04-20** — 添加 RFC 008（Agent Self-Identity）
- **2026-04-18** — 添加 RFC 007（Agent Token 加密）
- **2026-04-15** — 添加 RFC 005（架构统一）
- **2026-04-14** — 添加 RFC 003、004
