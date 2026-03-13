# F2A Local 私有化部署方案

> 面向中小企业技术团队（20-50 人）的私有化部署指南

---

## 1. 部署架构

### 1.1 单机部署架构

适用于小型团队（20 人以下），单节点作为引导节点。

```
┌─────────────────────────────────────────────────────────────┐
│                      局域网 (LAN)                            │
│                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐ │
│  │   Agent 1    │     │   Agent 2    │     │   Agent 3    │ │
│  │  (OpenClaw)  │     │  (OpenClaw)  │     │  (OpenClaw)  │ │
│  │              │     │              │     │              │ │
│  │ P2P:9000     │     │ P2P:9000     │     │ P2P:9000     │ │
│  │ HTTP:9001    │     │ HTTP:9001    │     │ HTTP:9001    │ │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘ │
│         │                    │                    │          │
│         └────────────────────┼────────────────────┘          │
│                              │                                │
│                     ┌────────▼────────┐                       │
│                     │  Bootstrap Node │                       │
│                     │   (引导节点)     │                       │
│                     │                 │                       │
│                     │  P2P:9000       │                       │
│                     │  HTTP:9001      │                       │
│                     │  mDNS:5353      │                       │
│                     └─────────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 多机集群部署架构

适用于中型团队（20-50 人），多节点高可用。

```
┌─────────────────────────────────────────────────────────────────┐
│                        局域网 (LAN)                              │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Agent 1-5  │  │  Agent 6-10 │  │ Agent 11-15 │   ...       │
│  │  (OpenClaw) │  │  (OpenClaw) │  │  (OpenClaw) │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          │                                      │
│         ┌────────────────┼────────────────┐                     │
│         │                │                │                     │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐             │
│  │ Bootstrap 1 │  │ Bootstrap 2 │  │ Bootstrap 3 │             │
│  │  (Primary)  │  │  (Backup)   │  │  (Backup)   │             │
│  │             │  │             │  │             │             │
│  │ P2P:9000    │  │ P2P:9000    │  │ P2P:9000    │             │
│  │ HTTP:9001   │  │ HTTP:9001   │  │ HTTP:9001   │             │
│  │ mDNS:5353   │  │ mDNS:5353   │  │ mDNS:5353   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 网络拓扑要求

| 项目 | 要求 |
|------|------|
| 网络类型 | 局域网（同一子网或可路由子网） |
| P2P 端口 | 9000/TCP（可配置） |
| HTTP 控制端口 | 9001/TCP（可配置） |
| mDNS 端口 | 5353/UDP（固定） |
| 组播地址 | 224.0.0.251（mDNS 标准） |
| 防火墙规则 | 允许上述端口入站/出站 |

---

## 2. 配置文件设计

### 2.1 配置文件位置

```
~/.f2a/
├── config.yaml          # 主配置文件
├── credentials.yaml     # 敏感凭证（权限 600）
├── nodes/               # 节点身份持久化
│   └── peer-id.json     # PeerId 私钥
└── logs/
    └── f2a.log          # 日志文件
```

### 2.2 配置文件 Schema (YAML)

```yaml
# F2A Local 配置文件示例
# 路径：~/.f2a/config.yaml

# 基础配置
version: "1.0"
node:
  # 节点显示名称（在网络中显示）
  displayName: "DevTeam-Agent-01"
  # Agent 类型
  agentType: "openclaw"
  # 日志级别
  logLevel: "info"  # debug | info | warn | error

# 网络配置
network:
  # P2P 监听端口（0 = 随机分配）
  p2pPort: 9000
  # HTTP 控制端口
  controlPort: 9001
  # 监听地址（默认所有网卡）
  listenAddresses:
    - "/ip4/0.0.0.0/tcp/9000"
  # 引导节点列表（用于连接远程节点）
  bootstrapPeers:
    - "/dns4/bootstrap1.local/tcp/9000"
    - "/dns4/bootstrap2.local/tcp/9000"
  # 信任的 Peer 白名单（不会被清理）
  trustedPeers:
    - "16Uiu2HAmVZ3qjqjRkV1Vz3qjqjRkV1Vz"
    - "16Uiu2HAmVZ3qjqjRkV1Vz3qjqjRkV1Vx"

# mDNS 自动发现配置
mdns:
  # 是否启用 mDNS 发现
  enabled: true
  # 服务名称（用于服务发现）
  serviceName: "_f2a-node._tcp"
  # 广播间隔（秒）
  broadcastInterval: 30
  # 超时时间（秒，超过此时间未收到广播的节点视为离线）
  timeout: 90
  # 是否跨子网发现（需要组播路由）
  crossSubnet: false

# 安全配置
security:
  # 安全级别
  level: "medium"  # low | medium | high
  # 要求确认连接
  requireConfirmation: false
  # 验证消息签名
  verifySignatures: true
  # 请求签名密钥（从 credentials.yaml 引用）
  signatureKeyRef: "signature_key"
  # HTTP 控制 Token（从 credentials.yaml 引用）
  controlTokenRef: "control_token"
  # 速率限制
  rateLimit:
    maxRequests: 60
    windowMs: 60000

# 数据持久化配置
persistence:
  # 数据目录
  dataDir: "~/.f2a"
  # PeerId 持久化
  peerIdPersistence: true
  # 节点缓存持久化
  peerCachePersistence: true
  # 缓存清理间隔（小时）
  cacheCleanupInterval: 24

# 日志配置
logging:
  # 日志文件路径
  file: "~/.f2a/logs/f2a.log"
  # 日志轮转
  rotation:
    maxSize: "10MB"
    maxFiles: 5
    compress: true
  # 日志格式
  format: "json"  # json | text

# 监控配置
monitoring:
  # 是否启用 Prometheus 指标
  prometheus:
    enabled: false
    port: 9090
  # 健康检查端点
  healthCheck:
    enabled: true
    path: "/health"

# Webhook 配置（可选）
webhook:
  enabled: false
  url: "https://your-webhook-url.com/f2a"
  token: "your-webhook-token"
  events:
    - "peer:connected"
    - "peer:disconnected"
    - "task:received"
```

### 2.3 凭证文件示例

```yaml
# F2A Local 凭证文件
# 路径：~/.f2a/credentials.yaml
# 权限：chmod 600 credentials.yaml

# HTTP 控制 Token（用于 API 认证）
control_token: "f2a-secure-token-$(openssl rand -hex 32)"

# 请求签名密钥（用于消息签名）
signature_key: "f2a-sign-key-$(openssl rand -hex 32)"

# Webhook Token（如果使用 webhook）
webhook_token: "webhook-secure-token-$(openssl rand -hex 32)"
```

### 2.4 环境变量管理

```bash
# /etc/f2a/f2a.env 或 ~/.f2a/f2a.env

# 基础配置
NODE_ENV=production
F2A_CONFIG_PATH=~/.f2a/config.yaml
F2A_CREDENTIALS_PATH=~/.f2a/credentials.yaml

# 网络配置
F2A_P2P_PORT=9000
F2A_CONTROL_PORT=9001
F2A_ALLOWED_ORIGINS=https://your-domain.com,https://api.your-domain.com

# 安全配置
F2A_SECURITY_LEVEL=medium
F2A_SIGNATURE_TOLERANCE=60000

# mDNS 配置
F2A_MDNS_ENABLED=true
F2A_MDNS_BROADCAST_INTERVAL=30

# 日志配置
F2A_LOG_LEVEL=info
F2A_LOG_FILE=~/.f2a/logs/f2a.log

# 健康检查
F2A_HEALTH_TIMEOUT=15000
```

---

## 3. mDNS 自动发现机制设计

### 3.1 mDNS 服务注册与发现协议

#### 服务名称

```
_f2a-node._tcp.local.
```

#### DNS-SD 服务记录

```
服务类型：_f2a-node._tcp.local.
服务实例：F2A-Node-{PeerId-Short}._f2a-node._tcp.local.
端口：9000（P2P 监听端口）
```

#### TXT 记录格式

```
TXT 记录包含以下键值对：

peerId={libp2p-peer-id}           # PeerId（base58 编码）
displayName={node-display-name}   # 可读名称
agentType={agent-type}            # Agent 类型
version={f2a-version}             # F2A 版本
protocolVersion={protocol-ver}    # 协议版本
multiaddrs={addr1,addr2,...}      # 多地址列表（逗号分隔）
capabilities={cap1,cap2,...}      # 能力列表（逗号分隔）
publicKey={encryption-pub-key}    # E2EE 公钥（base64）
timestamp={unix-timestamp-ms}     # 广播时间戳
```

#### 示例 DNS 查询

```bash
# 查询 F2A 服务
dns-sd -B _f2a-node._tcp

# 解析服务实例
dns-sd -L "F2A-Node-16Uiu2HAm._f2a-node._tcp" local
```

### 3.2 节点广播频率与超时机制

#### 广播策略

```typescript
interface MDNSBroadcastConfig {
  // 正常广播间隔（秒）
  normalInterval: 30;
  // 初始快速广播间隔（秒，启动后前 3 次）
  initialInterval: 5;
  // 离线前最后广播（秒，关闭前发送）
  goodbyeBroadcast: true;
  // 随机抖动（秒，避免同步）
  jitter: 5;
}
```

#### 超时机制

```typescript
interface MDNSTimeoutConfig {
  // 节点超时时间（秒，超过此时间视为离线）
  nodeTimeout: 90;  // 通常是广播间隔的 3 倍
  // 检查间隔（秒）
  checkInterval: 15;
  // 宽限期（秒，超时后保留的时间）
  gracePeriod: 30;
}
```

#### 状态机

```
                    ┌──────────────┐
                    │   OFFLINE    │
                    └──────┬───────┘
                           │ 收到 mDNS 广播
                           ▼
                    ┌──────────────┐
          ┌────────│  DISCOVERED  │────────┐
          │        └──────┬───────┘        │
    超时  │               │ 收到广播        │ 超时
          │               ▼                │
          │        ┌──────────────┐        │
          └───────▶│   ONLINE     │◀───────┘
                   └──────┬───────┘
                          │ 收到 Goodbye
                          ▼
                   ┌──────────────┐
                   │  REMOVING    │───┐
                   └──────────────┘   │ 宽限期后删除
                                      ▼
                               ┌──────────────┐
                               │   OFFLINE    │
                               └──────────────┘
```

### 3.3 冲突检测与解决（PeerId 冲突）

#### 冲突场景

1. **PeerId 重复**：两个节点使用相同的 PeerId
2. **IP:Port 冲突**：同一 IP 上多个节点使用相同端口

#### 检测机制

```typescript
interface ConflictDetection {
  // 收到广播时检查
  onDiscovery(peerInfo: PeerInfo): ConflictResult;
  
  // 检查 PeerId 是否已存在
  checkPeerIdConflict(peerId: string, address: string): boolean;
  
  // 检查地址是否已存在
  checkAddressConflict(address: string): boolean;
}
```

#### 解决策略

```typescript
enum ConflictResolution {
  // 保留先发现的节点，忽略新节点
  KEEP_EXISTING = 'keep_existing',
  
  // 保留时间戳更新的节点
  KEEP_NEWER = 'keep_newer',
  
  // 保留 PeerId 字典序较大的节点
  KEEP_HIGHER_PEERID = 'keep_higher_peerid',
  
  // 生成新的 PeerId（仅适用于本机冲突）
  REGENERATE_PEERID = 'regenerate_peerid'
}

// 默认策略：使用 KEEP_NEWER
const DEFAULT_CONFLICT_RESOLUTION = ConflictResolution.KEEP_NEWER;
```

#### PeerId 冲突处理流程

```
收到 mDNS 广播
       │
       ▼
检查 PeerId 是否存在于本地缓存
       │
       ├── 不存在 ──▶ 添加新节点
       │
       └── 存在
             │
             ▼
       检查地址是否相同
             │
             ├── 相同 ──▶ 更新时间戳（同一节点刷新）
             │
             └── 不同 ──▶ PeerId 冲突！
                       │
                       ▼
                 应用冲突解决策略
                       │
                       ├── KEEP_EXISTING ──▶ 忽略新节点，记录警告
                       ├── KEEP_NEWER ──▶ 比较时间戳，保留新的
                       └── REGENERATE_PEERID ──▶ 重新生成 PeerId 并重启
```

### 3.4 跨子网发现（可选）

#### 方案一：mDNS 网关/反射器

```
子网 A                          子网 B
┌─────────────┐                ┌─────────────┐
│  Agent 1    │                │  Agent 5    │
│  mDNS       │                │  mDNS       │
└──────┬──────┘                └──────┬──────┘
       │                              │
       │    ┌────────────────┐       │
       └────│  mDNS Gateway  │◀──────┘
            │   (反射器)      │
            │                │
            │  转发 mDNS 包    │
            │  224.0.0.251   │
            └────────────────┘
```

#### 方案二：DHT 引导节点

对于跨子网场景，推荐使用 DHT 作为补充：

```yaml
network:
  enableDHT: true
  dhtServerMode: false
  bootstrapPeers:
    - "/dns4/dht-boot1.example.com/tcp/9000"
    - "/dns4/dht-boot2.example.com/tcp/9000"
```

#### 方案三：静态配置引导节点

```yaml
network:
  enableMDNS: true  # 本地发现
  bootstrapPeers:   # 跨子网节点
    - "/dns4/remote-node.example.com/tcp/9000"
```

### 3.5 与现有 P2P 网络的集成

#### libp2p mDNS 配置

```typescript
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { mdns } from '@libp2p/mdns';

const node = await createLibp2p({
  addresses: {
    listen: ['/ip4/0.0.0.0/tcp/9000']
  },
  transports: [tcp()],
  connectionEncryption: [noise()],
  // 添加 mDNS 服务发现
  peerDiscovery: [
    mdns({
      interval: 30000,  // 30 秒广播间隔
      enabled: true
    })
  ]
});
```

#### 混合发现策略

```typescript
interface DiscoveryStrategy {
  // 1. mDNS 本地发现（优先）
  mdns: {
    enabled: true,
    priority: 1
  };
  
  // 2. DHT 发现（补充）
  dht: {
    enabled: true,
    priority: 2
  };
  
  // 3. 静态引导节点（兜底）
  bootstrap: {
    enabled: true,
    priority: 3
  };
}
```

#### 集成点

```typescript
// 在 P2PNetwork.start() 中集成
async start(): Promise<Result> {
  // 1. 创建 libp2p 节点
  this.node = await createLibp2p({
    // ... 基础配置
    peerDiscovery: []
  });
  
  // 2. 根据配置添加发现机制
  if (this.config.enableMDNS) {
    this.setupMDNSDiscovery();
  }
  
  if (this.config.enableDHT) {
    this.setupDHTDiscovery();
  }
  
  // 3. 启动节点
  await this.node.start();
  
  // 4. 注册 mDNS 服务
  if (this.config.enableMDNS) {
    await this.registerMDNSService();
  }
}
```

---

## 4. 数据持久化策略

### 4.1 PeerId 持久化

```typescript
// 文件：~/.f2a/nodes/peer-id.json
{
  "peerId": "16Uiu2HAmVZ3qjqjRkV1Vz3qjqjRkV1Vz",
  "privateKey": "CAESQ...",  // libp2p 私钥（base64）
  "publicKey": "CAESQ...",  // libp2p 公钥（base64）
  "createdAt": 1709856000000,
  "lastUsed": 1709942400000
}
```

### 4.2 节点缓存持久化

```typescript
// 文件：~/.f2a/nodes/peer-cache.json
{
  "version": 1,
  "lastUpdated": 1709942400000,
  "peers": [
    {
      "peerId": "16Uiu2HAm...",
      "displayName": "Agent-01",
      "multiaddrs": ["/ip4/192.168.1.100/tcp/9000"],
      "lastSeen": 1709942400000,
      "capabilities": ["code-generation", "web-search"]
    }
  ]
}
```

### 4.3 持久化配置

```yaml
persistence:
  # PeerId 持久化
  peerId:
    enabled: true
    path: "~/.f2a/nodes/peer-id.json"
    # 如果私钥文件不存在，自动生成
    autoGenerate: true
  
  # 节点缓存持久化
  peerCache:
    enabled: true
    path: "~/.f2a/nodes/peer-cache.json"
    # 缓存过期时间（小时）
    expirationHours: 168  # 7 天
    # 最大缓存节点数
    maxPeers: 500
  
  # E2EE 密钥持久化
  e2eeKeys:
    enabled: true
    path: "~/.f2a/nodes/e2ee-keys.json"
```

---

## 5. 日志与监控

### 5.1 日志配置

```yaml
logging:
  # 日志级别
  level: "info"
  
  # 文件日志
  file:
    enabled: true
    path: "~/.f2a/logs/f2a.log"
    maxSize: "10MB"
    maxFiles: 5
    compress: true
  
  # 控制台日志
  console:
    enabled: true
    colorize: true
  
  # 日志格式
  format: "json"
  
  # 日志字段
  fields:
    - timestamp
    - level
    - component
    - peerId
    - message
    - metadata
```

### 5.2 监控指标

```yaml
monitoring:
  # Prometheus 指标
  prometheus:
    enabled: false
    port: 9090
    path: "/metrics"
  
  # 指标收集
  metrics:
    - f2a_peer_count          # 已连接 Peer 数量
    - f2a_discovery_count     # 发现次数
    - f2a_message_count       # 消息数量
    - f2a_task_count          # 任务数量
    - f2a_latency_ms          # 延迟统计
```

### 5.3 健康检查

```bash
# 健康检查端点
curl http://localhost:9001/health

# 响应示例
{
  "status": "ok",
  "peerId": "16Uiu2HAmVZ3qjqjRkV1Vz3qjqjRkV1Vz",
  "uptime": 86400,
  "peerCount": 5,
  "memory": {
    "used": 128000000,
    "total": 512000000
  }
}
```

---

## 6. 部署脚本示例

### 6.1 Docker Compose 配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  f2a-bootstrap:
    image: f2a-network:latest
    container_name: f2a-bootstrap
    restart: unless-stopped
    ports:
      - "9000:9000"  # P2P 端口
      - "9001:9001"  # HTTP 控制端口
    volumes:
      - ./bootstrap-config:/app/config
      - f2a-bootstrap-data:/root/.f2a
    environment:
      - NODE_ENV=production
      - F2A_CONFIG_PATH=/app/config/config.yaml
      - F2A_CREDENTIALS_PATH=/app/config/credentials.yaml
      - F2A_P2P_PORT=9000
      - F2A_CONTROL_PORT=9001
      - F2A_MDNS_ENABLED=true
    networks:
      - f2a-network
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:9001/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  f2a-node:
    image: f2a-network:latest
    container_name: f2a-node
    restart: unless-stopped
    ports:
      - "9000"  # P2P 端口（动态分配）
      - "9001:9001"  # HTTP 控制端口
    volumes:
      - ./node-config:/app/config
      - f2a-node-data:/root/.f2a
    environment:
      - NODE_ENV=production
      - F2A_CONFIG_PATH=/app/config/config.yaml
      - BOOTSTRAP_PEERS=/dns4/f2a-bootstrap/tcp/9000
      - F2A_MDNS_ENABLED=true
    depends_on:
      f2a-bootstrap:
        condition: service_healthy
    networks:
      - f2a-network
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:9001/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    # 使用 --scale 参数扩展节点数量
    # docker compose up --scale f2a-node=10

volumes:
  f2a-bootstrap-data:
  f2a-node-data:

networks:
  f2a-network:
    driver: bridge
```

### 6.2 systemd 服务配置

```ini
# /etc/systemd/system/f2a.service
[Unit]
Description=F2A P2P Network Daemon
Documentation=https://github.com/LuciusCao/F2A
After=network.target
Wants=network-online.target

[Service]
Type=notify
User=f2a
Group=f2a
WorkingDirectory=/opt/f2a

# 环境变量
Environment=NODE_ENV=production
Environment=F2A_CONFIG_PATH=/etc/f2a/config.yaml
Environment=F2A_CREDENTIALS_PATH=/etc/f2a/credentials.yaml
Environment=F2A_P2P_PORT=9000
Environment=F2A_CONTROL_PORT=9001
Environment=F2A_MDNS_ENABLED=true

# 启动命令
ExecStart=/usr/bin/node /opt/f2a/dist/daemon/main.js
ExecReload=/bin/kill -HUP $MAINPID
ExecStop=/bin/kill -SIGTERM $MAINPID

# 重启策略
Restart=always
RestartSec=10

# 资源限制
LimitNOFILE=65536
LimitNPROC=4096

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/f2a /var/log/f2a

# 日志
StandardOutput=journal
StandardError=journal
SyslogIdentifier=f2a

[Install]
WantedBy=multi-user.target
```

```bash
# 安装服务
sudo cp f2a.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable f2a
sudo systemctl start f2a

# 查看状态
sudo systemctl status f2a

# 查看日志
sudo journalctl -u f2a -f
```

### 6.3 一键部署脚本

```bash
#!/bin/bash
# F2A Local 一键部署脚本

set -e

F2A_VERSION="0.1.3"
INSTALL_DIR="/opt/f2a"
CONFIG_DIR="/etc/f2a"
DATA_DIR="/var/lib/f2a"
LOG_DIR="/var/log/f2a"

echo "=== F2A Local 部署脚本 ==="

# 1. 创建用户
if ! id -u f2a &>/dev/null; then
    echo "[1/7] 创建 f2a 用户..."
    sudo useradd -r -s /bin/false -d "$DATA_DIR" f2a
fi

# 2. 创建目录
echo "[2/7] 创建目录..."
sudo mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"
sudo chown -R f2a:f2a "$DATA_DIR" "$LOG_DIR"

# 3. 安装 Node.js（如果未安装）
if ! command -v node &>/dev/null; then
    echo "[3/7] 安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 4. 安装 F2A
echo "[4/7] 安装 F2A..."
cd "$INSTALL_DIR"
sudo npm install -g @f2a/network@$F2A_VERSION

# 5. 生成配置
echo "[5/7] 生成配置文件..."
sudo tee "$CONFIG_DIR/config.yaml" > /dev/null <<EOF
version: "1.0"
node:
  displayName: "F2A-Node-$(hostname)"
  agentType: "openclaw"
  logLevel: "info"

network:
  p2pPort: 9000
  controlPort: 9001
  enableMDNS: true

mdns:
  enabled: true
  serviceName: "_f2a-node._tcp"
  broadcastInterval: 30
  timeout: 90

security:
  level: "medium"
  verifySignatures: true

persistence:
  dataDir: "$DATA_DIR"
  peerIdPersistence: true
  peerCachePersistence: true

logging:
  file: "$LOG_DIR/f2a.log"
  rotation:
    maxSize: "10MB"
    maxFiles: 5
EOF

# 6. 生成凭证
echo "[6/7] 生成凭证文件..."
CONTROL_TOKEN=$(openssl rand -hex 32)
SIGNATURE_KEY=$(openssl rand -hex 32)

sudo tee "$CONFIG_DIR/credentials.yaml" > /dev/null <<EOF
control_token: "f2a-secure-token-$CONTROL_TOKEN"
signature_key: "f2a-sign-key-$SIGNATURE_KEY"
EOF

sudo chmod 600 "$CONFIG_DIR/credentials.yaml"
sudo chown f2a:f2a "$CONFIG_DIR/credentials.yaml"

# 7. 安装 systemd 服务
echo "[7/7] 安装 systemd 服务..."
sudo tee /etc/systemd/system/f2a.service > /dev/null <<EOF
[Unit]
Description=F2A P2P Network Daemon
After=network.target

[Service]
Type=notify
User=f2a
Group=f2a
WorkingDirectory=$INSTALL_DIR

Environment=NODE_ENV=production
Environment=F2A_CONFIG_PATH=$CONFIG_DIR/config.yaml
Environment=F2A_CREDENTIALS_PATH=$CONFIG_DIR/credentials.yaml
Environment=F2A_P2P_PORT=9000
Environment=F2A_CONTROL_PORT=9001
Environment=F2A_MDNS_ENABLED=true

ExecStart=/usr/bin/node $INSTALL_DIR/dist/daemon/main.js
Restart=always
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=f2a

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable f2a
sudo systemctl start f2a

echo ""
echo "=== 部署完成 ==="
echo ""
echo "服务状态：sudo systemctl status f2a"
echo "查看日志：sudo journalctl -u f2a -f"
echo "控制端口：http://localhost:9001"
echo "P2P 端口：9000"
echo ""
echo "控制 Token: $CONTROL_TOKEN"
echo "导出环境变量：export F2A_CONTROL_TOKEN=$CONTROL_TOKEN"
```

---

## 7. 安全加固建议

### 7.1 节点间认证

```yaml
security:
  # 启用消息签名验证
  verifySignatures: true
  
  # 签名密钥（每个节点独立）
  signatureKey: "unique-per-node-key"
  
  # 签名时间容差（毫秒）
  signatureTolerance: 60000
  
  # 生产环境必须设置
  requireConfirmation: true
  
  # 白名单（可选）
  whitelist:
    - "16Uiu2HAmVZ3qjqjRkV1Vz3qjqjRkV1Vz"
```

### 7.2 网络隔离

```bash
# 防火墙规则示例（iptables）
# 允许 P2P 端口
iptables -A INPUT -p tcp --dport 9000 -j ACCEPT
# 允许 HTTP 控制端口（仅内网）
iptables -A INPUT -p tcp --dport 9001 -s 192.168.0.0/16 -j ACCEPT
# 允许 mDNS
iptables -A INPUT -p udp --dport 5353 -j ACCEPT
# 拒绝其他入站连接
iptables -A INPUT -p tcp --dport 9000:9001 -j DROP
```

### 7.3 内网横向渗透防护

```yaml
security:
  level: "high"
  
  # 速率限制
  rateLimit:
    maxRequests: 30
    windowMs: 60000
  
  # 连接限制
  connectionLimit:
    maxConnections: 50
    maxConnectionsPerPeer: 5
  
  # 异常检测
  anomalyDetection:
    enabled: true
    # 单节点最大发现请求/分钟
    maxDiscoveryPerMinute: 10
    # 单节点最大任务委托/分钟
    maxTasksPerMinute: 20
```

---

## 8. 故障排查

### 8.1 常见问题

#### mDNS 无法发现节点

```bash
# 检查 mDNS 服务是否运行
sudo systemctl status avahi-daemon

# 检查防火墙是否允许 mDNS
sudo iptables -L -n | grep 5353

# 手动查询 mDNS 服务
dns-sd -B _f2a-node._tcp

# 检查网络是否允许组播
ping -c 1 224.0.0.251
```

#### PeerId 冲突

```bash
# 删除 PeerId 文件重新生成
rm ~/.f2a/nodes/peer-id.json
systemctl restart f2a
```

#### 节点无法连接

```bash
# 检查端口是否监听
netstat -tlnp | grep 9000

# 检查引导节点配置
cat ~/.f2a/config.yaml | grep bootstrapPeers

# 查看日志
journalctl -u f2a -n 100
```

### 8.2 调试模式

```bash
# 启用调试日志
export F2A_LOG_LEVEL=debug

# 前台运行查看详细输出
f2a daemon -f

# 启用 mDNS 调试
export DEBUG=mdns*
```

---

## 9. 性能优化

### 9.1 大规模部署建议（50+ 节点）

```yaml
network:
  # 启用 DHT 提高可扩展性
  enableDHT: true
  dhtServerMode: true
  
  # 减少 mDNS 广播频率
  mdns:
    broadcastInterval: 60
  
  # 增加连接限制
  connectionLimit:
    maxConnections: 100
    maxConnectionsPerPeer: 3

persistence:
  peerCache:
    # 增加缓存大小
    maxPeers: 2000
    # 缩短过期时间
    expirationHours: 24
```

### 9.2 资源限制

```ini
# systemd 服务资源限制
[Service]
MemoryLimit=512M
CPUQuota=50%
LimitNOFILE=65536
```

---

## 10. 与现有代码的集成点

### 10.1 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/core/p2p-network.ts` | 添加 mDNS 服务注册与发现逻辑 |
| `src/types/index.ts` | 添加 mDNS 配置类型定义 |
| `src/daemon/index.ts` | 添加配置文件加载 |
| `src/cli/daemon.ts` | 添加配置文件路径参数 |
| `src/utils/mdns.ts` | **新建** mDNS 工具模块 |
| `src/utils/config-loader.ts` | **新建** 配置文件加载器 |
| `src/utils/persistence.ts` | **新建** 数据持久化工具 |

### 10.2 新增依赖

```json
{
  "dependencies": {
    "@libp2p/mdns": "^10.0.0",
    "@dnsquery/dns-packet": "^6.1.0",
    "multicast-dns": "^7.2.5",
    "js-yaml": "^4.1.0",
    "better-sqlite3": "^9.0.0"
  }
}
```

### 10.3 配置加载集成

```typescript
// src/utils/config-loader.ts
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { homedir } from 'os';
import { join } from 'path';

export interface F2AConfig {
  version: string;
  node: NodeConfig;
  network: NetworkConfig;
  mdns: MDNSConfig;
  security: SecurityConfig;
  persistence: PersistenceConfig;
  logging: LoggingConfig;
}

export function loadConfig(configPath?: string): F2AConfig {
  const path = configPath || process.env.F2A_CONFIG_PATH || 
               join(homedir(), '.f2a', 'config.yaml');
  
  const content = readFileSync(path, 'utf-8');
  const config = yaml.load(content) as F2AConfig;
  
  // 验证配置
  validateConfig(config);
  
  // 合并环境变量
  mergeEnvConfig(config);
  
  return config;
}
```

---

## 附录 A：完整配置文件模板

详见本章节 2.2 节。

## 附录 B：环境变量列表

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `development` | 运行环境 |
| `F2A_CONFIG_PATH` | `~/.f2a/config.yaml` | 配置文件路径 |
| `F2A_CREDENTIALS_PATH` | `~/.f2a/credentials.yaml` | 凭证文件路径 |
| `F2A_P2P_PORT` | `9000` | P2P 监听端口 |
| `F2A_CONTROL_PORT` | `9001` | HTTP 控制端口 |
| `F2A_CONTROL_TOKEN` | 自动生成 | HTTP 认证 Token |
| `F2A_SIGNATURE_KEY` | - | 消息签名密钥 |
| `F2A_SIGNATURE_TOLERANCE` | `60000` | 签名时间容差（毫秒） |
| `F2A_MDNS_ENABLED` | `true` | 启用 mDNS |
| `F2A_MDNS_BROADCAST_INTERVAL` | `30` | mDNS 广播间隔（秒） |
| `F2A_LOG_LEVEL` | `info` | 日志级别 |
| `F2A_LOG_FILE` | `~/.f2a/logs/f2a.log` | 日志文件路径 |
| `F2A_HEALTH_TIMEOUT` | `15000` | 健康检查超时（毫秒） |
| `F2A_ALLOWED_ORIGINS` | `http://localhost` | CORS 允许来源 |
| `BOOTSTRAP_PEERS` | - | 引导节点列表（逗号分隔） |

## 附录 C：参考资源

- [libp2p mDNS 文档](https://github.com/libp2p/js-libp2p-mdns)
- [DNS-SD 规范](https://datatracker.ietf.org/doc/html/rfc6763)
- [mDNS 规范](https://datatracker.ietf.org/doc/html/rfc6762)
- [libp2p 文档](https://docs.libp2p.io/)
