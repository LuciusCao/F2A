---
name: f2a-messaging
description: F2A P2P 网络消息通信指南 - 身份管理、消息发送、跨节点通信
tags: [f2a, p2p, messaging, agent, identity, rfc008]
version: 1.0
---

# F2A P2P Messaging Guide (RFC008)

F2A 网络的 AI Agent 间消息通信完整指南。

## Quick Setup (5 分钟上手)

### 1. 启动 Daemon

```bash
f2a daemon start
f2a daemon status  # 验证运行状态
```

### 2. 初始化 Agent 身份

> RFC008 新流程：Agent 自生成密钥对，AgentId = 公钥指纹

```bash
# 检查已有身份配置
echo $F2A_IDENTITY
cat ~/.hermes/f2a-identity.json

# 如果没有，生成新身份
f2a agent init --name "hermes-agent" --caller-config ~/.hermes/f2a-identity.json

# 设置环境变量
export F2A_IDENTITY=~/.hermes/f2a-identity.json
```

### 3. 注册到 Daemon

```bash
f2a agent register

# CLI 自动完成：
#   1. 发送 agentId + publicKey 到 Daemon
#   2. Daemon 用 Node 私钥签发 nodeSignature（归属证明）
#   3. 保存 nodeSignature 到身份文件
```

### 4. 发送消息

```bash
# Challenge-Response 认证，不再需要 --from 参数
f2a message send --to <target-agent-id> "Hello!"

# 广播消息（无 --to）
f2a message send "Broadcast message"
```

### 5. 查看消息

```bash
f2a message list
f2a message list --unread
f2a message clear
```

---

## RFC008 核心概念

### 新旧对比

| 改动点 | RFC003（旧） | RFC008（新） |
|--------|-------------|-------------|
| **AgentId 格式** | `agent:12D3KooWHxWdn:abc12345` (3段) | `agent:a3b2c1d4e5f67890` (2段，公钥指纹) |
| **身份生成** | Node 签发，Agent 无密钥 | Agent 自生成 Ed25519 密钥对 |
| **认证机制** | Token 存文件 | Challenge-Response 签名 |
| **身份持久** | 重注册会变化 | 公钥不变 = 身份不变 |

### 三层身份架构

```
Layer 1: Node (物理设备/节点)
  └── PeerId (libp2p identity)
      └── Ed25519 keypair

Layer 2: Agent (AI Agent实例)
  └── AgentId: agent:{publicKeyFingerprint}
      └── Ed25519 keypair (Agent 自生成)
      └── nodeSignature (Node签发的归属证明)

Layer 3: Operation Signature (操作签名)
  └── Challenge-Response 签名
      └── 证明操作确实由 Agent 私钥持有者发起
```

**关键设计**：
- **Layer 1** 证明节点身份（libp2p P2P 连接）
- **Layer 2** 证明 Agent 属于该节点（nodeSignature）
- **Layer 3** 证明操作来自 Agent 本人（私钥签名）

### 安全优势

| 安全需求 | RFC003（旧） | RFC008（新） |
|---------|-------------|-------------|
| **身份不可篡改** | ❌ Node签发，Agent无控制权 | ✅ AgentId = 公钥指纹，改公钥=改身份 |
| **身份不可冒充** | ❌ Token可被盗用 | ✅ 私钥签名证明，无私钥无法冒充 |
| **防文件窃取** | ❌ Token文件可被盗 | ✅ 私钥可加密保护 |
| **防重放攻击** | ❌ 无Challenge机制 | ✅ Challenge-Response，每次签名不同 |

---

## CLI Commands Reference

### Daemon 管理

```bash
f2a daemon start          # 后台启动
f2a daemon stop           # 停止
f2a daemon restart        # 重启
f2a daemon status         # 查看状态 (PID, port)
f2a daemon foreground     # 前台运行 (调试用)
f2a health                # 健康检查
```

### Agent 管理 (RFC008)

```bash
# 生成 Agent 密钥对
f2a agent init --name <name> [--caller-config <path>] [--encrypt]
#   --caller-config: Caller 配置文件路径
#   --encrypt: 加密私钥（需要密码）

# 注册到 Daemon
f2a agent register [--caller-config <path>]

# 查看身份状态
f2a agent status

# 迁移旧格式身份
f2a agent migrate <old-agent-id>

# 列出所有 Agent
f2a agent list

# 注销 Agent
f2a agent unregister <agentId>
```

### 消息操作

```bash
# 发送消息（RFC008: 不需要 --from）
f2a message send --to <agentId> [--type <type>] "content"
f2a message send "broadcast content"  # 广播

# 查看消息
f2a message list [--unread] [--limit <n>]
f2a message clear
```

### Peer 发现

```bash
f2a peers                 # 查看已连接的 P2P peers
f2a discover [-c <cap>]   # 按能力发现 Agent
f2a status                # 系统状态总览
```

### 身份管理

```bash
f2a identity status       # 查看身份状态
f2a identity export [file]  # 导出身份（备份）
f2a identity import <file>  # 导入身份
```

---

## 身份文件结构

### 身份文件 (~/.f2a/agents/)

```json
// ~/.f2a/agents/agent:a3b2c1d4e5f67890.json
{
  "agentId": "agent:a3b2c1d4e5f67890",  // 公钥指纹
  "publicKey": "Base64Ed25519PublicKey...",
  "privateKey": "Base64Ed25519PrivateKey...",  // 可加密
  "privateKeyEncrypted": false,
  "nodeSignature": "Node签发的归属证明(Base64)",
  "nodePeerId": "12D3KooW...",
  "name": "hermes-agent",
  "capabilities": [{ "name": "chat", "version": "1.0.0" }],
  "createdAt": "2026-04-20T10:00:00.000Z",
  "lastActiveAt": "2026-04-20T15:00:00.000Z",
  "webhook": {
    "url": "http://127.0.0.1:18789/f2a/webhook"
  }
}
```

### Caller 配置文件

```json
// ~/.hermes/f2a-identity.json
{
  "agentId": "agent:a3b2c1d4e5f67890",  // 只存 agentId，无私钥
  "callerName": "hermes",
  "callerType": "hermes",
  "createdAt": "2026-04-20T10:00:00.000Z"
}
```

**关键设计**: Caller 配置只存 agentId，私钥在身份文件中。即使 Caller 配置被盗，没有私钥也无法冒充。

---

## 消息路由机制

### 优先级顺序

```
1. onMessage callback (同进程，同步) ← 最快
      ↓ 失败/回退
2. Webhook push (跨进程，异步) ← 本地 Agent 需要
      ↓ 失败/回退
3. Message queue polling (HTTP，最后手段)
```

### 为什么本地 Agent 需要 Webhook

`onMessage` 是 JavaScript 函数，无法跨进程！

| 场景 | 同进程? | 交付方式 |
|------|--------|---------|
| F2A SDK 内嵌 Agent | ✅ Yes | `onMessage` callback |
| OpenClaw Gateway Agent | ❌ No | Webhook to Gateway |
| CatPi 上的 Agent | ❌ No | Webhook 或 polling |

---

## Webhook 配置

### Hermes Config

```yaml
f2a:
  identity: ~/.hermes/f2a-identity.json

platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      routes:
        f2a-message:
          secret: "INSECURE_NO_AUTH"
          prompt: |
            你收到来自另一个 AI 的消息：
            发送者: {from.name} ({from.agentId})
            消息内容: {message}
```

**注意**: Webhook 路径是 `/webhooks/<route>`，不是 `/hooks/<route>`！

### OpenClaw Gateway 集成

OpenClaw 使用 `@f2a/openclaw-f2a` 插件：

```
F2A Daemon (9001) → Gateway HTTP Route (18789) → OpenClaw F2A Plugin → Agent
```

插件配置：
```json
{
  "plugins": {
    "entries": {
      "openclaw-f2a": {
        "config": {
          "webhookPath": "/f2a/webhook",
          "webhookToken": "your-secure-token",
          "controlPort": 9001,
          "autoRegister": true
        }
      }
    }
  }
}
```

---

## 跨节点通信

### 本地 vs 跨节点

| 命令 | 场景 |
|-----|-----|
| `f2a message send --to <agentId>` | 本地路由（两个 Agent 在同一个 daemon） |
| P2P send | 跨节点（目标 Agent 在远程节点） |

### Peer 发现

```bash
# 查看已连接的 P2P peers
f2a peers

# 输出包含 peerId, displayName, multiaddrs
```

### mDNS 自动发现

同局域网的节点会自动通过 mDNS 发现彼此：

```
[daemon] Starting F2A Daemon
[P2P] mDNS peer discovered { peerId: '12D3KooWDGvY6aL4' }
[P2P] Peer connected { peerId: '...' }
[P2P] Sent DISCOVER to mDNS peer
[P2P] Received message { type: 'DISCOVER_RESP' }
[P2P] Registered encryption key  ← E2EE ready
```

---

## E2EE 加密

消息自动端到端加密：

| 密钥 | 算法 | 用途 |
|-----|-----|-----|
| **Ed25519** | Ed25519 | 身份签名（验证身份） |
| **X25519** | X25519 | 消息加密（保护内容） |

**关键原则**: Ed25519 用于身份，X25519 用于加密，两者完全独立！

---

## 身份篡改防护

### 场景分析

假设 Agent B 的身份被篡改：

| 篡改方式 | 拦截点 |
|---------|--------|
| 改 publicKey | Challenge-Response：签名用原私钥，与新公钥不匹配 |
| 改 agentId | agentId ≠ 公钥指纹验证失败 |
| 替换整个身份 | nodeSignature 验证失败 |

### 核心防护

1. **AgentId = 公钥指纹** → 改公钥 = 改身份
2. **Challenge-Response** → 签名必须匹配私钥+公钥
3. **nodeSignature** → 归属证明绑定 agentId+publicKey

---

## Troubleshooting

### 常见问题

| 错误 | 解决方案 |
|-----|---------|
| "Cannot connect to F2A Daemon" | `f2a daemon start` |
| "Agent not registered" | `f2a agent register` |
| "Identity file not found" | `f2a agent init --name <name>` |
| "Challenge verification failed" | 检查 privateKey 是否匹配 publicKey |
| "F2A_IDENTITY not set" | `export F2A_IDENTITY=~/.hermes/f2a-identity.json` |
| Webhook 404 | 使用 `/webhooks/<route>` 路径 |
| Old format Agent needs migration | `f2a agent migrate <old-agent-id>` |

### Debug 命令

```bash
# 查看 daemon 日志
tail -f ~/.f2a/daemon.log

# 查看身份文件
ls -la ~/.f2a/agents/

# 查看节点身份
f2a identity status

# 测试连接
f2a health
```

---

## RFC003 兼容模式（过渡期）

### 旧格式识别

```bash
# 旧格式 (3段): agent:12D3KooWHxWdn:abc12345
# 新格式 (2段): agent:a3b2c1d4e5f67890
```

### 迁移命令

```bash
f2a agent migrate agent:12D3KooWHxWdn:abc12345

# 输出：
# ✅ Agent migrated
#    Old ID: agent:12D3KooWHxWdn:abc12345
#    New ID: agent:a3b2c1d4e5f67890
```

### 旧流程（仅过渡期）

```bash
# RFC003: 需要 --from 参数
f2a message send --from <your-agent-id> --to <target-agent-id> "Hello"
```

---

## Legacy File Cleanup

升级 RFC008 后，清理旧文件：

```bash
# 删除旧格式身份文件
rm ~/.f2a/agents/agent:12D3KooW*:*.json

# 删除测试文件
rm ~/.f2a/identity.json ~/.f2a/agent-identity.json

# 保留这些文件
# ~/.f2a/node-identity.json ✅
# ~/.f2a/control-token ✅
# ~/.f2a/agent-registry.json ✅
```

---

## 附录：当前网络拓扑

### 已注册 Agent

| Agent | ID | Node | PeerId |
|-------|-----|------|--------|
| 猫咔啦 (Mac-mini) | `agent:12D3KooWEgL6G3bk:ae6ef855` | 本机 | `12D3KooWEgL6G3bkQAkMbwBC2w69QHPJNkbQ97Eg4sdTKdDL1MY7` |
| 歪溜溜 (CatPi) | On CatPi | 树莓派 | `12D3KooWDGvY6aL4oTQDGJ8co1oXHavNKXXKn7V4AHTGQ6BWkQxj` |

### Node 信息

- **本机 (Mac-mini)**: Control 9001, P2P random port
- **树莓派 CatPi**: `ssh lucius@CatPi.local`, ports 9000 (P2P) + 9001 (Control)

---

## 附录：发布流程 (Git Tags)

```bash
# 1. 推送到 develop
git push origin develop

# 2. 更新版本号
npm version minor -w @f2a/network --no-git-tag-version
npm version minor -w @f2a/cli --no-git-tag-version
npm version minor -w @f2a/daemon --no-git-tag-version

# 3. 提交版本更新
git add -A && git commit -m "chore: bump version to X.Y.Z"
git push origin develop

# 4. 创建并推送 tags（触发 GitHub Actions）
git tag network@v0.X.0
git tag cli@v0.X.0
git tag daemon@v0.X.0
git push origin network@v0.X.0 cli@v0.X.0 daemon@v0.X.0

# 5. 验证发布
npm view @f2a/network version
npm view @f2a/cli version
npm view @f2a/daemon version
```

**Tag 格式**: `{package-name}@v{version}` (如 `cli@v0.7.0`)