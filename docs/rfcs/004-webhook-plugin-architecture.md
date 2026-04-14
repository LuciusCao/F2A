# RFC 004: OpenClaw F2A Webhook 插件架构

> **Status**: Draft
> **Created**: 2026-04-14
> **Author**: Discussion with user

---

## 问题背景

### 原计划：废弃 openclaw-f2a 插件

Phase 2 重构计划中，原打算：
- 发布 @f2a/cli, @f2a/daemon, f2a 统一安装包
- 用户全局安装 f2a，启动 daemon
- OpenClaw 通过技能调用 f2a CLI
- **废弃 @f2a/openclaw-f2a 插件**

### 发现的问题

**技能无法处理消息回调**：

场景：CatPi 发消息给 Mac mini → Mac mini 需要回复

```
CatPi Agent 发送消息
    ↓
f2a daemon (CatPi) 通过 P2P 发送
    ↓
f2a daemon (Mac mini) 收到消息
    ↓
webhook 转发给 OpenClaw Gateway
    ↓
??? → 谁来处理这个 webhook？
```

**技能的限制**：
| 特性 | 技能 | 插件 |
|------|------|------|
| 持久监听 | ❌ | ✅ |
| 注册工具 | ❌ | ✅ |
| 处理 webhook | ❌ | ✅ |
| 后台运行 | ❌ | ✅ |

**结论**：插件必须保留，但可以大大简化职责。

---

## 修正后的架构

### 架构图

```
┌─────────────────────────────────────┐
│  f2a daemon (全局后台服务)            │
│  - P2P 网络连接                       │
│  - 消息监听                           │
│  - ControlServer (9001)              │
│  - Webhook 配置                       │
└─────────────────────────────────────┘
              ↓ webhook (消息到达)
┌─────────────────────────────────────┐
│  openclaw-f2a-webhook 插件            │
│  - 接收 webhook 请求                  │
│  - 解析消息内容                       │
│  - 调用 Agent 生成回复                │
│  - 通过 f2a CLI 发送回复              │
└─────────────────────────────────────┘
              ↓ f2a send
┌─────────────────────────────────────┐
│  f2a daemon                          │
│  - 发送回复给原 Agent                 │
└─────────────────────────────────────┘
```

### 职责分离

| 组件 | 职责 | 安装方式 |
|------|------|----------|
| **f2a daemon** | P2P 网络、消息监听、转发 | `npm install -g f2a` |
| **@f2a/cli** | CLI 命令（send, status 等） | 作为 f2a 的依赖 |
| **@f2a/network** | 核心网络库 | 作为依赖 |
| **openclaw-f2a-webhook** | 处理消息回调 | OpenClaw 插件 |

---

## 简化的 Webhook 插件

### 原插件职责（过多）

```typescript
// packages/openclaw-f2a/src/plugin.ts (旧)
class F2APlugin {
  // 启动 P2P 网络
  // 管理 Agent 注册
  // 处理消息路由
  // 提供 15+ 工具
  // 管理身份
  // 管理信誉
  // ... (30+ 文件)
}
```

### 新插件职责（极简）

```typescript
// packages/openclaw-f2a-webhook/src/plugin.ts (新)
class F2AWebhookPlugin {
  // 只做一件事：接收 webhook，转发给 Agent
  
  register() {
    // 注册一个 webhook 接收服务
    // 端口：随机或配置
  }
  
  handleWebhook(message: F2AMessage) {
    // 1. 解析消息
    // 2. 调用 Agent.invokeAgent(message)
    // 3. 收到 Agent 回复
    // 4. 执行 f2a send --to <fromAgentId> --message <reply>
  }
}
```

### 代码量对比

| 版本 | 文件数 | 代码行数 |
|------|--------|----------|
| **旧插件** | 30+ | ~5000 |
| **新插件** | 3-5 | ~200 |

---

## 实现方案

### Phase 2（当前）

1. 发布 @f2a/cli, @f2a/daemon, f2a 到 NPM
2. 用户全局安装 f2a
3. 启动 `f2ad` 后台服务

### Phase 4（后续）

1. 创建 openclaw-f2a-webhook 插件（极简版）
2. 配置 f2a daemon 的 webhook URL
3. 测试消息回调流程
4. 废弃旧的 openclaw-f2a 插件

---

## Webhook 配置

### f2a daemon 配置

```json
// ~/.f2a/config.json
{
  "webhook": {
    "url": "http://127.0.0.1:18789/f2a/webhook",
    "token": "webhook-secret-token"
  }
}
```

### 插件注册 webhook 路由

```typescript
// 插件在 Gateway 上注册路由
gateway.registerRoute('/f2a/webhook', {
  handler: async (req, res) => {
    const message = await parseWebhook(req);
    const reply = await invokeAgent(message);
    await f2aSend(reply);
    res.json({ success: true });
  }
});
```

---

## 消息流详解

### 1. CatPi 发送消息

```bash
# CatPi 上执行
f2a send --to agent:12D3KooWHxWdn:abc123 \
  --message "你好，猫咕噜！"
```

### 2. f2a daemon 转发

```
f2a daemon (CatPi)
    ↓ P2P 网络
f2a daemon (Mac mini)
    ↓ 内部 webhook
http://127.0.0.1:18789/f2a/webhook
```

### 3. 插件处理 webhook

```typescript
// openclaw-f2a-webhook 插件
async handleWebhook(req) {
  const { fromAgentId, content } = req.body;
  
  // 调用 Agent 生成回复
  const reply = await this.agent.invoke({
    input: content,
    context: { fromAgentId }
  });
  
  // 发送回复
  await exec(`f2a send --to ${fromAgentId} --message "${reply}"`);
}
```

### 4. 回复发送

```
f2a CLI → f2a daemon → P2P → CatPi daemon → CatPi Agent
```

---

## 优势对比

### 旧架构

| 问题 | 影响 |
|------|------|
| 插件太重 | 30+ 文件，维护困难 |
| 职责不清 | P2P + 插件双重管理 |
| 版本耦合 | 插件和网络版本必须匹配 |
| 部署复杂 | 每个平台单独插件 |

### 新架构

| 改进 | 好处 |
|------|------|
| 插件极简 | 3-5 文件，维护简单 |
| 职责单一 | 只处理 webhook |
| 版本独立 | f2a 和插件独立升级 |
| 统一安装 | npm install -g f2a |

---

## 迁移计划

### Step 1：发布新包

```bash
npm publish @f2a/cli@0.5.0
npm publish @f2a/daemon@0.5.0
npm publish f2a@0.5.0
```

### Step 2：创建 webhook 插件

```bash
cd packages
mkdir openclaw-f2a-webhook
# 只需 3 个文件：
# - plugin.ts (核心)
# - webhook-handler.ts
# - package.json
```

### Step 3：配置 webhook

```bash
# 配置 f2a daemon
f2a config set webhook.url http://127.0.0.1:18789/f2a/webhook
f2a config set webhook.token <secret>
```

### Step 4：废弃旧插件

```bash
# 在 openclaw.json 中
{
  "plugins": {
    "entries": {
      "openclaw-f2a-webhook": { ... }  // 替换旧的
    }
  }
}
```

---

## 时间表

| Phase | 时间 | 内容 |
|-------|------|------|
| Phase 2 | Week 1-2 | 发布 CLI + Daemon 包 |
| Phase 3 | Week 3-4 | 创建 webhook 插件 |
| Phase 4 | Week 5-6 | 废弃旧插件，迁移用户 |

---

## 参考资料

- [RFC 003: AgentId 签发机制](./003-agentid-issuance.md)
- [RFC 002: CLI Agent Architecture](./002-cli-agent-architecture.md)
- [F2A Protocol](../F2A-PROTOCOL.md)