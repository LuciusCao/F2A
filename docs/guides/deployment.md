# F2A 部署指南

> 生产环境部署、运维与监控

---

## 概述

本文档涵盖 F2A 从开发环境到生产环境的完整部署流程，包括：

- 单机部署（本地/测试）
- 生产环境部署
- Docker 容器化部署
- 系统服务配置（systemd）
- 监控与日志

---

## 前置条件

| 要求 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18.0.0 | 运行时环境 |
| npm | >= 9.0.0 | 包管理器 |
| 内存 | >= 512MB | 建议 1GB 以上 |
| 磁盘 | >= 1GB | 数据存储 |
| 网络 | 公网 IP（可选） | DHT 服务器模式需要 |

---

## 快速安装

### 方式一：一键安装脚本

```bash
curl -sSf https://f2a.io/install.sh | sh
```

### 方式二：npm 全局安装

```bash
npm install -g @f2a/cli
```

### 方式三：源码安装

```bash
git clone https://github.com/LuciusCao/F2A.git
cd F2A
npm install
npm run build
npm link -w packages/cli
```

---

## 单机部署

### 1. 初始化节点

```bash
# 创建节点身份
f2a node init

# 或使用默认配置
f2a init
```

### 2. 配置环境变量

```bash
# 生产环境必须设置控制 Token
export F2A_CONTROL_TOKEN="your-secure-random-token"

# 固定 P2P 端口（防火墙开放）
export F2A_P2P_PORT=9000

# 数据目录
export F2A_DATA_DIR=/var/lib/f2a
```

### 3. 启动 Daemon

```bash
# 前台启动（调试）
f2a daemon foreground

# 后台启动
f2a daemon start

# 检查状态
f2a daemon status
```

### 4. 创建并注册 Agent

```bash
# 创建 Agent 身份
f2a agent init --name "production-agent" --webhook https://your-app.com/webhook

# 注册到 Daemon
f2a agent register --agent-id <agent-id>
```

---

## 生产环境部署

### 安全加固检查清单

- [ ] 设置强密码的 `F2A_CONTROL_TOKEN`
- [ ] 配置 `bootstrapPeerFingerprints` 防止中间人攻击
- [ ] 启用 `verifySignatures: true`
- [ ] 禁用 `F2A_ALLOW_LOCAL_WEBHOOK`
- [ ] 配置防火墙规则（仅开放必要端口）
- [ ] 启用日志轮转
- [ ] 配置监控告警

### 生产配置示例

```bash
# /etc/f2a/environment
F2A_CONTROL_TOKEN=your-64-char-random-token
F2A_P2P_PORT=9000
F2A_CONTROL_PORT=9001
F2A_LOG_LEVEL=WARN
F2A_DATA_DIR=/var/lib/f2a
F2A_ALLOW_LOCAL_WEBHOOK=false
```

### 防火墙配置

```bash
# 开放 P2P 端口
iptables -A INPUT -p tcp --dport 9000 -j ACCEPT

# 限制 Control Server 访问（仅允许本地/管理 IP）
iptables -A INPUT -p tcp --dport 9001 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 9001 -j DROP
```

---

## systemd 服务配置

创建 `/etc/systemd/system/f2a-daemon.service`：

```ini
[Unit]
Description=F2A Daemon - Friend-to-Agent P2P Network
After=network.target

[Service]
Type=simple
User=f2a
Group=f2a
WorkingDirectory=/var/lib/f2a
Environment=F2A_CONTROL_PORT=9001
Environment=F2A_P2P_PORT=9000
Environment=F2A_LOG_LEVEL=INFO
Environment=F2A_DATA_DIR=/var/lib/f2a
# 生产环境必须设置强 Token
Environment=F2A_CONTROL_TOKEN=your-secure-token-here
ExecStart=/usr/bin/f2a daemon foreground
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=f2a-daemon

# 资源限制
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
```

### 启动服务

```bash
# 创建 f2a 用户
useradd -r -s /bin/false -d /var/lib/f2a f2a
mkdir -p /var/lib/f2a
chown -R f2a:f2a /var/lib/f2a

# 重新加载 systemd
systemctl daemon-reload

# 启用并启动
systemctl enable f2a-daemon
systemctl start f2a-daemon

# 查看状态
systemctl status f2a-daemon
journalctl -u f2a-daemon -f
```

---

## Docker 部署

### Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

# 安装 F2A CLI
RUN npm install -g @f2a/cli

# 创建数据目录
RUN mkdir -p /data/f2a
ENV F2A_DATA_DIR=/data/f2a

# 暴露端口
EXPOSE 9000 9001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD f2a health || exit 1

ENTRYPOINT ["f2a", "daemon", "foreground"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  f2a-daemon:
    build: .
    container_name: f2a-daemon
    restart: unless-stopped
    ports:
      - "9000:9000"   # P2P 端口
      - "9001:9001"   # Control Server
    volumes:
      - f2a-data:/data/f2a
    environment:
      - F2A_CONTROL_TOKEN=${F2A_CONTROL_TOKEN}
      - F2A_P2P_PORT=9000
      - F2A_CONTROL_PORT=9001
      - F2A_LOG_LEVEL=INFO
      - NODE_ENV=production
    networks:
      - f2a-network

  # 可选：Dashboard
  f2a-dashboard:
    build: ./packages/dashboard
    container_name: f2a-dashboard
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://f2a-daemon:9001
    depends_on:
      - f2a-daemon
    networks:
      - f2a-network

volumes:
  f2a-data:

networks:
  f2a-network:
    driver: bridge
```

### 启动容器

```bash
# 设置环境变量
export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)

# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f f2a-daemon
```

---

## 多节点部署

### 引导节点部署

引导节点作为网络的入口点，需要公网 IP：

```bash
# 引导节点配置
export F2A_P2P_PORT=9000
export F2A_DHT_SERVER_MODE=true
export F2A_ENABLE_NAT_TRAVERSAL=true
export F2A_ENABLE_RELAY_SERVER=true

f2a daemon start
```

### 普通节点部署

```bash
# 连接到引导节点
export BOOTSTRAP_PEERS=/dns4/bootstrap.example.com/tcp/9000/p2p/12D3KooW...

f2a daemon start
```

### 局域网内部署

局域网内无需引导节点，使用 mDNS 自动发现：

```bash
# 节点 A
export F2A_AGENT_NAME=node-a
export F2A_P2P_PORT=9000
f2a daemon start

# 节点 B（同一局域网）
export F2A_AGENT_NAME=node-b
export F2A_P2P_PORT=9000
f2a daemon start

# 自动发现
echo "节点将在几秒内通过 mDNS 自动发现彼此"
```

---

## 日志管理

### 日志级别

| 级别 | 用途 | 生产建议 |
|------|------|----------|
| `DEBUG` | 详细调试信息 | 否 |
| `INFO` | 正常操作记录 | 是 |
| `WARN` | 异常但可恢复 | 是 |
| `ERROR` | 需要关注的错误 | 是 |

### 日志轮转（logrotate）

创建 `/etc/logrotate.d/f2a`：

```
/var/lib/f2a/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 f2a f2a
    sharedscripts
    postrotate
        systemctl reload f2a-daemon
    endscript
}
```

### 结构化日志（JSON）

```bash
# 启用 JSON 格式日志
export F2A_LOG_FORMAT=json
```

---

## 监控与告警

### 健康检查端点

```bash
# 无需认证
curl http://localhost:9001/health
# {"status":"ok","peerId":"12D3KooW..."}
```

### 关键指标

| 指标 | 获取方式 | 告警阈值 |
|------|----------|----------|
| 节点在线状态 | `/health` | status != ok |
| 连接 Peer 数 | `/peers` | < 1（如果是引导节点） |
| 内存使用 | `ps` / `systemd` | > 80% |
| 磁盘使用 | `df` | > 90% |
| 日志错误率 | 日志分析 | > 10/min |

### Prometheus 指标（未来支持）

```yaml
#  planned feature
scrape_configs:
  - job_name: 'f2a'
    static_configs:
      - targets: ['localhost:9001']
    metrics_path: /metrics
```

---

## 备份与恢复

### 备份脚本

```bash
#!/bin/bash
# backup-f2a.sh

BACKUP_DIR="/backup/f2a/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# 备份身份文件
cp ~/.f2a/node-identity.json "$BACKUP_DIR/"
cp -r ~/.f2a/agent-identities "$BACKUP_DIR/"

# 备份配置
cp ~/.f2a/config.json "$BACKUP_DIR/"

# 打包
tar czf "$BACKUP_DIR.tar.gz" -C "$BACKUP_DIR" .
rm -rf "$BACKUP_DIR"

echo "备份完成: $BACKUP_DIR.tar.gz"
```

### 恢复

```bash
# 停止服务
systemctl stop f2a-daemon

# 恢复数据
tar xzf backup-20260101.tar.gz -C ~/.f2a/

# 重启服务
systemctl start f2a-daemon
```

### 重要提醒

> **⚠️ 安全警告**：`node-identity.json` 包含节点私钥，备份时必须加密存储！

```bash
# 加密备份
gpg --symmetric --cipher-algo AES256 backup.tar.gz
```

---

## 升级维护

### 平滑升级流程

```bash
# 1. 备份数据
./backup-f2a.sh

# 2. 通知网络（如果有多个节点）
# 当前版本不支持优雅下线，直接停止

# 3. 停止服务
systemctl stop f2a-daemon

# 4. 更新软件
npm install -g @f2a/cli

# 5. 重启服务
systemctl start f2a-daemon

# 6. 验证
f2a health
f2a peers
```

---

## 故障排查

常见问题请参考 [故障排查指南](troubleshooting.md)。

---

## 相关文档

- [配置指南](configuration.md) — 完整配置参考
- [安全指南](security.md) — 安全配置最佳实践
- [故障排查](troubleshooting.md) — 常见问题解决
- [API 参考](api-reference.md) — HTTP API 文档
