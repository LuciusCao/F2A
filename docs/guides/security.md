# F2A 安全指南

> 安全配置最佳实践与威胁防护

---

## 概述

> **⚠️ 实验性质项目，安全实现仍在演进中。**

F2A 作为 P2P 网络协议，面临以下安全挑战：

- **网络层**：P2P 连接暴露公网，可能遭受 DDoS、中间人攻击
- **身份层**：Agent 私钥本地存储，存在泄露风险
- **应用层**：Webhook 推送可能遭受 SSRF、重放攻击

本文档提供各层的安全配置建议。

---

## 安全清单

### 生产环境必须项

- [ ] **设置强 Control Token** — `F2A_CONTROL_TOKEN` 至少 32 字节随机字符串
- [ ] **验证引导节点指纹** — 配置 `bootstrapPeerFingerprints` 防止中间人
- [ ] **启用签名验证** — `verifySignatures: true`
- [ ] **禁用本地 Webhook** — 生产环境 `F2A_ALLOW_LOCAL_WEBHOOK=false`
- [ ] **配置防火墙** — 仅开放必要端口，限制 Control Server 访问
- [ ] **启用速率限制** — 防止资源耗尽攻击
- [ ] **定期轮换密钥** — 定期重新生成 Agent 身份

### 建议配置

- [ ] **使用 HTTPS Webhook** — 避免明文传输
- [ ] **配置白名单** — 限制可连接的 Peer
- [ ] **启用审计日志** — 记录关键操作
- [ ] **监控异常流量** — 检测异常连接模式

---

## 身份安全

### Node 身份保护

`node-identity.json` 包含节点 Ed25519 私钥，泄露可导致：
- 节点身份被冒充
- P2P 网络被渗透

**保护措施：**

```bash
# 1. 设置严格的文件权限
chmod 600 ~/.f2a/node-identity.json

# 2. 定期备份到加密存储
gpg --symmetric --cipher-algo AES256 ~/.f2a/node-identity.json

# 3. 避免在共享环境运行
# 不要在多用户服务器上以 root 运行 F2A
```

### Agent 身份保护

Agent 私钥以明文 JSON 存储在 `~/.f2a/agent-identities/`：

```bash
# 查看身份文件
ls -la ~/.f2a/agent-identities/
# -rw------- 1 user user 1234 Apr 24 10:00 agent:16Qk:abcdef12.json
```

**风险：** 目前无硬件密钥集成，私钥可被任何有文件系统访问权限的进程读取。

**缓解措施：**
- 限制目录权限：`chmod 700 ~/.f2a/agent-identities/`
- 使用专用用户运行 F2A
- 考虑使用文件系统加密（如 LUKS、FileVault）

---

## 网络安全

### 引导节点指纹验证

防止中间人攻击的关键配置：

```typescript
const f2a = await F2A.create({
  network: {
    bootstrapPeers: [
      '/dns4/bootstrap.example.com/tcp/9000/p2p/12D3KooW...',
    ],
    // 必须配置指纹验证！
    bootstrapPeerFingerprints: {
      '/dns4/bootstrap.example.com/tcp/9000': '12D3KooW...',
    },
  },
});
```

### 连接安全级别

```typescript
// 高安全级别配置
const f2a = await F2A.create({
  security: {
    level: 'high',
    requireConfirmation: true,    // 新连接需确认
    verifySignatures: true,       // 强制验证签名
    whitelist: ['12D3KooW...'],   // 只允许白名单节点
    blacklist: ['12D3KooX...'],   // 拒绝黑名单节点
  },
});
```

### 防火墙规则

```bash
# 仅允许必要端口
iptables -A INPUT -p tcp --dport 9000 -j ACCEPT  # P2P
iptables -A INPUT -p tcp --dport 9001 -s 10.0.0.0/8 -j ACCEPT  # Control（仅限内网）
iptables -A INPUT -p tcp --dport 9001 -j DROP
```

---

## Webhook 安全

### SSRF 防护

生产环境默认启用 undici SSRF 保护：

```bash
# 开发环境可禁用（不推荐用于生产）
export F2A_ALLOW_LOCAL_WEBHOOK=true

# 生产环境必须保持默认值（false）
# 禁止 Webhook 指向：
# - 本地地址（127.0.0.1, localhost）
# - 内网地址（10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16）
```

### Webhook 认证

注册 Agent 时设置 Webhook Token：

```bash
f2a agent register \
  --agent-id agent:16Qk:xxx \
  --webhook https://your-app.com/webhook \
  --webhook-token your-secret-token
```

Webhook 接收方验证 Token：

```javascript
app.post('/webhook', (req, res) => {
  const token = req.headers['x-f2a-webhook-token'];
  if (token !== process.env.F2A_WEBHOOK_TOKEN) {
    return res.status(401).send('Unauthorized');
  }
  // 处理消息...
});
```

---

## 速率限制

### 配置建议

```typescript
const f2a = await F2A.create({
  security: {
    rateLimit: {
      maxRequests: 100,           // 每分钟最多 100 请求
      windowMs: 60000,            // 1 分钟窗口
      burstMultiplier: 1.5,       // 允许突发 150 请求
      skipSuccessfulRequests: false,
    },
    maxTasksPerMinute: 60,        // 每分钟最多 60 任务
  },
});
```

### Relay 访问控制

如果启用 Relay 服务器，必须配置访问控制：

```typescript
const f2a = await F2A.create({
  network: {
    enableRelayServer: true,
    relayWhitelist: ['12D3KooW...'],      // 只允许特定节点
    relayBlacklist: [],
    relayMinReputation: 50,                // 最低信誉分 50
    relayMaxPerMinute: 10,                 // 每节点每分钟最多 10 次
    relayMaxReservations: 50,              // 最大预留数
    relayMaxCircuits: 100,                 // 最大线路数
  },
});
```

---

## 消息安全

### 端到端加密

F2A 支持基于 X25519 的 E2EE：

```typescript
import { E2EECrypto } from '@f2a/network';

const crypto = new E2EECrypto();

// 加密发送
const encrypted = await crypto.encrypt(message, recipientPublicKey);
await f2a.sendMessage(peerId, encrypted);
```

**注意：** E2EE 需要双方提前交换公钥。

### 签名验证

```typescript
const f2a = await F2A.create({
  security: {
    verifySignatures: true,  // 验证所有消息签名
  },
});
```

---

## 安全事件响应

### 私钥泄露

如果怀疑私钥泄露：

```bash
# 1. 立即停止服务
systemctl stop f2a-daemon

# 2. 重新生成身份
f2a node init --force

# 3. 重新注册所有 Agent
f2a agent init --name "new-agent"

# 4. 通知网络中的信任节点更新指纹
```

### 恶意节点

```bash
# 将恶意节点加入黑名单
# 在配置中添加：
security: {
  blacklist: ['12D3KooWBadNode...']
}

# 重启生效
f2a daemon restart
```

---

## 审计与监控

### 关键审计事件

| 事件 | 日志级别 | 说明 |
|------|----------|------|
| 新 Peer 连接 | INFO | 记录 PeerID 和地址 |
| Agent 注册 | INFO | 记录 AgentID 和注册信息 |
| 消息发送 | DEBUG | 记录消息元数据（不含内容） |
| 签名验证失败 | WARN | 可能遭受攻击 |
| 速率限制触发 | WARN | 可能遭受 DDoS |
| 配置变更 | INFO | 记录变更内容和操作者 |

### 安全监控指标

```bash
# 监控异常连接数
watch -n 5 'f2a peers | wc -l'

# 监控错误日志
tail -f ~/.f2a/f2a.log | grep -E 'ERROR|WARN'

# 监控认证失败
grep "Unauthorized" ~/.f2a/f2a.log | wc -l
```

---

## 安全配置模板

### 最小安全模板（开发）

```typescript
export const devSecurity = {
  level: 'low',
  verifySignatures: false,
  requireConfirmation: false,
};
```

### 标准安全模板（测试）

```typescript
export const stagingSecurity = {
  level: 'medium',
  verifySignatures: true,
  requireConfirmation: true,
  rateLimit: {
    maxRequests: 200,
    windowMs: 60000,
  },
};
```

### 高安全模板（生产）

```typescript
export const prodSecurity = {
  level: 'high',
  verifySignatures: true,
  requireConfirmation: true,
  whitelist: ['trusted-peer-1', 'trusted-peer-2'],
  rateLimit: {
    maxRequests: 50,
    windowMs: 60000,
    burstMultiplier: 1.2,
  },
  maxTasksPerMinute: 30,
};
```

---

## 已知限制

> **⚠️ 当前版本的安全限制：**

1. **Agent 私钥明文存储** — 暂无硬件密钥或密钥管理服务集成
2. **无内置 TLS** — Control Server 默认 HTTP，建议通过反向代理添加 TLS
3. **信誉系统中心化** — 信誉分数本地存储，尚无分布式验证
4. **无自动密钥轮换** — 需要手动重新初始化身份

---

## 相关文档

- [配置指南](configuration.md) — 完整配置参考
- [部署指南](deployment.md) — 生产环境部署
- [故障排查](troubleshooting.md) — 安全问题排查
- [API 参考](api-reference.md) — HTTP API 文档
