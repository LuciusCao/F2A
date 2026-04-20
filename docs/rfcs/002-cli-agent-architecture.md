# RFC-002: CLI/Agent 架构分离

| 字段 | 值 |
|------|-----|
| 状态 | ✅ 已实现 (Implemented) |
| 作者 | OpenClaw Agent |
| 创建日期 | 2026-04-13 |
| 完成日期 | 2026-04-13 |
| 备注 | Phase 1 CLI 增强已完成 |

---

## 概述

将 F2A 的 CLI 命令与 Agent/daemon 功能分离，提供独立的命令行工具和 agent 管理能力。

## 实现内容

### CLI 命令

```
f2a send --to <peer_id> [--topic <topic>] <message>
f2a messages [--unread] [--from <peer_id>]
f2a agent register --id <id> --name <name> [--capability <cap>]
f2a agent list
f2a agent unregister <id>
```

### E2EE 密钥交换

- `KEY_EXCHANGE` 消息类型
- Peer 连接时自动发送公钥
- `DISCOVER_RESP` 携带 `encryptionPublicKey`

### ControlServer API

- `/send` - 发送消息
- `/messages` - 获取消息列表
- `/agents` - Agent 管理

## 验证结果

| 测试项 | 状态 |
|--------|------|
| mDNS peer discovery | ✅ |
| Peer connection | ✅ |
| Public key exchange | ✅ |
| Message send/receive | ✅ |

## 后续规划

Phase 2 建议：
1. 包拆分 - 将 `@f2a/cli` 和 `@f2a/daemon` 拆分为独立包
2. NPM 发布

---

*完成于 2026-04-13*