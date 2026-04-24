# F2A 故障排查指南

> 常见问题诊断与解决方案

---

## 概述

本文档汇总 F2A 使用过程中的常见问题及其解决方案。如果此处未涵盖你的问题，请：

1. 查看 [GitHub Issues](https://github.com/LuciusCao/F2A/issues)
2. 开启 `F2A_DEBUG=1` 获取详细日志
3. 提交新的 Issue 并附上日志

---

## 快速诊断流程

```
遇到问题
    │
    ▼
┌─────────────────┐
│ 1. 检查 Daemon  │
│    运行状态     │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
  正常      异常
    │         │
    ▼         ▼
┌─────────┐ ┌─────────┐
│ 2. 检查 │ │ 查看日志 │
│ 网络连接 │ │ 重启服务 │
└────┬────┘ └─────────┘
     │
┌────┴────┐
▼         ▼
正常      异常
 │         │
 ▼         ▼
┌─────────┐ ┌─────────┐
│ 3. 检查 │ │ 检查    │
│ Agent   │ │ 防火墙  │
│ 注册状态 │ │ 配置    │
└────┬────┘ └─────────┘
     │
     ▼
┌─────────┐
│ 4. 查看 │
│ 消息路由 │
└─────────┘
```

---

## Daemon 相关问题

### Daemon 无法启动

**现象：**
```bash
f2a daemon start
# Error: Failed to start daemon
```

**排查步骤：**

1. **检查端口占用**
   ```bash
   lsof -i :9000  # P2P 端口
   lsof -i :9001  # Control Server 端口
   ```
   **解决：** 修改端口或停止占用进程
   ```bash
   export F2A_P2P_PORT=9002
   export F2A_CONTROL_PORT=9003
   ```

2. **检查权限**
   ```bash
   ls -la ~/.f2a/
   ```
   **解决：** 确保有写入权限
   ```bash
   mkdir -p ~/.f2a
   chmod 755 ~/.f2a
   ```

3. **查看详细日志**
   ```bash
   F2A_DEBUG=1 f2a daemon foreground
   ```

### Daemon 启动后立即退出

**现象：** 进程启动后几秒退出

**常见原因：**

| 原因 | 日志特征 | 解决 |
|------|----------|------|
| 身份文件损坏 | `Failed to load identity` | 重新初始化 `f2a node init --force` |
| 磁盘空间不足 | `ENOSPC` | 清理磁盘 |
| 内存不足 | `ENOMEM` | 增加内存或降低配置 |

---

## 网络连接问题

### 无法发现其他节点

**现象：** `f2a peers` 返回空列表

**排查步骤：**

1. **检查 mDNS 是否启用**
   ```bash
   f2a status
   # 查看 enableMDNS: true
   ```

2. **检查网络环境**
   ```bash
   # mDNS 仅在同网段有效
   # 确认节点在同一局域网
   ping <其他节点IP>
   ```

3. **跨网段/公网环境使用 DHT**
   ```bash
   # 配置引导节点
   export BOOTSTRAP_PEERS=/dns4/bootstrap.example.com/tcp/9000/p2p/12D3KooW...
   ```

4. **检查防火墙**
   ```bash
   # Linux
   sudo iptables -L | grep 9000
   
   # macOS
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --list
   ```

### 连接 Peer 失败

**现象：**
```
Failed to connect to peer: 12D3KooW...
Error: Connection refused
```

**排查：**

1. **检查目标节点是否在线**
   ```bash
   f2a health --peer <peer-address>
   ```

2. **检查 NAT 配置**
   - 如果双方都在 NAT 后，需要启用 NAT 穿透
   ```bash
   export F2A_ENABLE_NAT_TRAVERSAL=true
   ```
   - 或使用 Relay 服务器
   ```bash
   export F2A_ENABLE_RELAY_SERVER=true
   ```

3. **检查地址格式**
   ```bash
   # 正确的 multiaddr 格式
   /ip4/192.168.1.100/tcp/9000/p2p/12D3KooW...
   ```

### DHT 无法找到 Peer

**现象：** `f2a discover` 找不到已知在线的节点

**解决：**
- 确保至少一个节点是 DHT 服务器模式
- 检查引导节点配置
- 等待 DHT 路由表构建（首次连接可能需要几分钟）

---

## Agent 相关问题

### Agent 注册失败

**现象：**
```bash
f2a agent register --agent-id agent:16Qk:xxx
# Error: Agent registration failed
```

**排查步骤：**

1. **检查 Agent 身份文件是否存在**
   ```bash
   ls ~/.f2a/agent-identities/
   ```

2. **检查 Daemon 是否运行**
   ```bash
   f2a daemon status
   ```

3. **检查 Token 是否有效**
   ```bash
   # 查看当前 Token
   cat ~/.f2a/config.json | jq .controlToken
   ```

4. **检查 Webhook URL 格式**
   ```bash
   # URL 必须以 http:// 或 https:// 开头
   f2a agent register --agent-id xxx --webhook https://valid-url.com/webhook
   ```

### Agent 无法接收消息

**现象：** 发送消息成功但接收方未收到

**排查步骤：**

1. **检查 Webhook 配置**
   ```bash
   f2a agent status --agent-id <agentId>
   # 查看 webhook 字段
   ```

2. **测试 Webhook 可达性**
   ```bash
   curl -X POST <webhook-url> -d '{"test": true}'
   ```

3. **检查消息队列**
   ```bash
   f2a message list --agent-id <agentId> --unread
   ```

4. **检查 Webhook 限制**
   - 生产环境默认禁止本地 IP webhook
   - 开发环境可设置 `F2A_ALLOW_LOCAL_WEBHOOK=true`

### Agent Token 过期

**现象：** API 返回 `401 Unauthorized`

**解决：**
```bash
# 重新获取 Token（通过 Challenge-Response）
# 或重启 Daemon 刷新 Token
f2a daemon restart
```

---

## 消息发送问题

### 发送消息失败

**现象：**
```bash
f2a message send --to agent:xxx "hello"
# Error: Failed to send message
```

**排查：**

1. **检查目标 Agent 是否在线**
   ```bash
   f2a discover | grep <目标 agentId>
   ```

2. **检查网络连接**
   ```bash
   f2a peers
   # 确认与目标节点有 P2P 连接
   ```

3. **检查发送方 Agent 是否已注册**
   ```bash
   f2a agent list
   ```

4. **检查消息大小**
   - 消息内容过大可能导致发送失败
   - 建议控制在 1MB 以内

### 消息发送成功但对方收不到

**可能原因：**

| 原因 | 排查 | 解决 |
|------|------|------|
| 目标 Agent 未注册 | `f2a agent list` | 提醒对方注册 |
| Webhook 返回错误 | 查看 Daemon 日志 | 修复 Webhook 服务端 |
| 消息被中间件丢弃 | 检查中间件配置 | 调整中间件规则 |
| 目标节点离线 | `f2a peers` | 等待节点上线 |

---

## 身份与密钥问题

### 身份文件丢失

**现象：**
```
Error: Node identity not found
```

**解决：**
- 如果有备份，恢复 `~/.f2a/node-identity.json`
- 如果没有备份，需要重新初始化（PeerID 会变）
  ```bash
  f2a node init --force
  ```
  > ⚠️ 警告：重新初始化后 PeerID 改变，需要重新配置引导节点指纹

### Agent 身份迁移

**场景：** 在新机器上使用已有 Agent 身份

**步骤：**
```bash
# 1. 原机器导出
f2a identity export agent-backup.json

# 2. 复制到新机器
scp agent-backup.json new-machine:~/

# 3. 新机器导入
f2a identity import agent-backup.json
```

---

## 性能问题

### 内存占用过高

**排查：**
```bash
# 查看内存使用
ps aux | grep f2a

# 检查 Peer 数量
f2a peers | wc -l
```

**优化：**
- 限制 PeerTable 大小（配置 `maxSize`）
- 降低日志级别
- 禁用不需要的功能（如 DHT、mDNS）

### CPU 使用率高

**常见原因：**
- DHT 路由表维护（大量节点时）
- 频繁的 mDNS 广播
- 消息签名验证

**优化：**
```bash
# 降低 mDNS 广播频率（需代码配置）
# 或减少 DHT 交互
export F2A_ENABLE_DHT=false  # 小网络可禁用
```

---

## 日志解读

### 常见日志级别

```
[INFO]  Network started        → 正常启动
[WARN]  Peer connection failed → 连接失败（可能重试）
[ERROR] Identity load failed   → 需要人工干预
[DEBUG] Message received       → 调试信息（仅 DEBUG 模式）
```

### 启用调试日志

```bash
# 临时启用
F2A_DEBUG=1 f2a daemon foreground

# 或设置日志级别
export F2A_LOG_LEVEL=DEBUG
```

### 日志文件位置

```bash
# 默认日志
tail -f ~/.f2a/f2a.log

# systemd 日志
journalctl -u f2a-daemon -f
```

---

## CLI 常见问题

### 命令找不到

```bash
# 检查安装
which f2a
# 如果没有输出，需要重新安装或添加到 PATH
npm install -g @f2a/cli
```

### JSON 输出解析失败

```bash
# 使用 --json 标志获取结构化输出
f2a status --json | jq .
```

### 权限不足

```bash
# Linux/macOS：确保 ~/.f2a 目录有读写权限
chmod -R 755 ~/.f2a
```

---

## 获取帮助

如果以上方案无法解决问题：

1. **收集诊断信息**
   ```bash
   f2a --version
   f2a status --json
   f2a health
   node -v
   uname -a
   ```

2. **开启调试模式复现问题**
   ```bash
   F2A_DEBUG=1 f2a <command> 2>&1 | tee f2a-debug.log
   ```

3. **提交 Issue**
   - 访问 [GitHub Issues](https://github.com/LuciusCao/F2A/issues)
   - 附上：环境信息、复现步骤、调试日志

---

## 相关文档

- [部署指南](deployment.md) — 部署与运维
- [配置指南](configuration.md) — 配置参考
- [安全指南](security.md) — 安全最佳实践
- [API 参考](api-reference.md) — HTTP API 文档
