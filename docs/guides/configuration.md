# F2A 配置指南

> 完整配置参考：从环境变量到代码选项

---

## 概述

F2A 提供三层配置机制，按优先级从高到低：

1. **代码选项** — `F2A.create(options)` 传入的配置对象
2. **环境变量** — 以 `F2A_` 为前缀的环境变量
3. **默认值** — 内建的默认配置

---

## 环境变量速查

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `F2A_CONTROL_PORT` | `9001` | Daemon HTTP 控制端口 |
| `F2A_CONTROL_TOKEN` | 自动生成 | 认证 Token（生产环境必须设置） |
| `F2A_P2P_PORT` | `0` | P2P 监听端口（0 = 随机分配） |
| `F2A_AGENT_NAME` | `F2A-Node` | 节点显示名称 |
| `F2A_SIGNATURE_KEY` | — | 请求签名密钥 |
| `F2A_ALLOW_LOCAL_WEBHOOK` | `false` | 允许本地 IP webhook（仅开发） |
| `F2A_DEBUG` | — | 设为 `1` 启用 CLI 调试日志 |
| `F2A_LOG_LEVEL` | `INFO` | 日志级别（DEBUG/INFO/WARN/ERROR） |
| `BOOTSTRAP_PEERS` | — | 逗号分隔的引导节点地址 |

---

## F2AOptions 完整配置

### 创建 F2A 实例时的顶层选项

```typescript
import { F2A } from '@f2a/network';

const f2a = await F2A.create({
  displayName: 'My-Agent-Node',
  agentType: 'openclaw',
  dataDir: './f2a-data',
  logLevel: 'INFO',
  messageHandlerUrl: 'http://localhost:3000/handler',
  network: { /* P2PNetworkConfig */ },
  security: { /* SecurityConfig */ },
});
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `displayName` | `string` | `'F2A-Node'` | 节点可读名称 |
| `agentType` | `string` | `'openclaw'` | Agent 类型标识 |
| `dataDir` | `string` | `'.f2a'` | 数据存储目录路径 |
| `logLevel` | `LogLevel` | `'INFO'` | 日志输出级别 |
| `messageHandlerUrl` | `string` | `''` | 消息处理回调 URL |
| `network` | `P2PNetworkConfig` | 见下文 | P2P 网络配置 |
| `security` | `SecurityConfig` | 见下文 | 安全配置 |

---

## P2PNetworkConfig 网络配置

### 基础网络配置

```typescript
const networkConfig = {
  // 监听配置
  listenPort: 0,                    // 0 = 随机分配端口
  listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
  
  // 发现配置
  enableMDNS: true,                 // 局域网 mDNS 发现
  enableDHT: true,                  // DHT 分布式路由
  dhtServerMode: false,             // DHT 客户端模式（服务器模式需公网 IP）
  
  // NAT 穿透（Phase 2 功能）
  enableNATTraversal: false,        // 默认禁用，需显式启用
  enableRelayServer: false,         // Relay 服务端模式
  
  // 引导节点
  bootstrapPeers: [
    '/dns4/bootstrap1.example.com/tcp/9000/p2p/12D3KooW...',
    '/ip4/192.168.1.100/tcp/9000/p2p/12D3KooX...',
  ],
  bootstrapPeerFingerprints: {
    '/dns4/bootstrap1.example.com/tcp/9000': '12D3KooW...',
  },
  
  // 信任列表
  trustedPeers: ['12D3KooW...'],
  
  // Relay 访问控制
  relayWhitelist: [],
  relayBlacklist: [],
  relayMinReputation: 50,
  relayMaxPerMinute: 10,
  relayMaxReservations: 50,
  relayMaxCircuits: 100,
  relayReservationGapMs: 300000,    // 5 分钟
  
  // 消息处理
  messageHandlerUrl: '',
};
```

### 网络配置项详解

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `listenPort` | `number` | `0` | P2P 监听端口，`0` 表示随机分配 |
| `listenAddresses` | `string[]` | `['/ip4/0.0.0.0/tcp/0']` | 监听地址列表 |
| `bootstrapPeers` | `string[]` | `[]` | 引导节点多地址列表 |
| `bootstrapPeerFingerprints` | `Record<string,string>` | `{}` | 引导节点指纹验证映射 |
| `trustedPeers` | `string[]` | `[]` | 信任的 PeerID 白名单 |
| `enableMDNS` | `boolean` | `true` | 启用 mDNS 局域网发现 |
| `enableDHT` | `boolean` | `true` | 启用 Kademlia DHT |
| `dhtServerMode` | `boolean` | `false` | DHT 服务器模式（需公网 IP） |
| `enableNATTraversal` | `boolean` | `false` | 启用 AutoNAT/DCUtR 穿透 |
| `enableRelayServer` | `boolean` | `false` | 启用 Circuit Relay v2 服务端 |
| `relayWhitelist` | `string[]` | `[]` | Relay 使用白名单 |
| `relayBlacklist` | `string[]` | `[]` | Relay 使用黑名单 |
| `relayMinReputation` | `number` | `50` | Relay 最低信誉分要求 |
| `relayMaxPerMinute` | `number` | `10` | 每节点每分钟最大 Relay 次数 |
| `relayMaxReservations` | `number` | `50` | 最大 Relay 预留数 |
| `relayMaxCircuits` | `number` | `100` | 最大 Relay 线路数 |
| `relayReservationGapMs` | `number` | `300000` | Relay 预留间隔（毫秒） |
| `messageHandlerUrl` | `string` | `''` | 消息处理 HTTP 回调 URL |

---

## SecurityConfig 安全配置

```typescript
const securityConfig = {
  level: 'medium',                  // 安全级别: low / medium / high
  requireConfirmation: true,        // 连接前要求确认
  verifySignatures: true,           // 验证消息签名
  whitelist: ['12D3KooW...'],       // 允许连接的 Peer 白名单
  blacklist: ['12D3KooX...'],       // 拒绝连接的 Peer 黑名单
  rateLimit: {
    maxRequests: 100,               // 时间窗口内最大请求数
    windowMs: 60000,                // 时间窗口（毫秒）
    burstMultiplier: 1.5,           // 突发流量倍数
    skipSuccessfulRequests: false,  // 是否跳过成功请求的计数
  },
  maxTasksPerMinute: 60,            // 每分钟最大任务数
};
```

### 安全级别说明

| 级别 | 特性 |
|------|------|
| `low` | 不验证签名，不强制确认连接，适合开发/测试 |
| `medium` | 验证签名，连接需确认，适合大多数场景 |
| `high` | 严格模式，强制签名验证，只允许白名单连接 |

### 速率限制配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxRequests` | `number` | `100` | 时间窗口内最大请求数 |
| `windowMs` | `number` | `60000` | 时间窗口（毫秒） |
| `burstMultiplier` | `number` | `1.5` | 突发流量容忍倍数 |
| `skipSuccessfulRequests` | `boolean` | `false` | 成功请求不计入限流 |

---

## 配置文件示例

### 开发环境配置

```typescript
// config.development.ts
export const devConfig = {
  displayName: 'Dev-Node',
  logLevel: 'DEBUG',
  network: {
    listenPort: 9000,
    enableMDNS: true,
    enableDHT: false,           // 开发环境禁用 DHT
    enableNATTraversal: false,
  },
  security: {
    level: 'low',               // 开发环境降低安全要求
    verifySignatures: false,
    requireConfirmation: false,
  },
};
```

### 生产环境配置

```typescript
// config.production.ts
export const prodConfig = {
  displayName: 'Prod-Node',
  logLevel: 'WARN',
  network: {
    listenPort: 9000,
    enableMDNS: false,          // 生产环境禁用 mDNS
    enableDHT: true,
    dhtServerMode: true,        // 作为 DHT 服务器
    enableNATTraversal: true,
    bootstrapPeers: [
      '/dns4/bootstrap1.f2a.network/tcp/9000/p2p/12D3KooW...',
    ],
    bootstrapPeerFingerprints: {
      '/dns4/bootstrap1.f2a.network/tcp/9000': '12D3KooW...',
    },
  },
  security: {
    level: 'high',
    verifySignatures: true,
    requireConfirmation: true,
    whitelist: ['12D3KooW...'], // 只允许特定节点
    rateLimit: {
      maxRequests: 50,
      windowMs: 60000,
    },
  },
};
```

### 局域网测试配置

```typescript
// config.lan.ts
export const lanConfig = {
  displayName: 'LAN-Test-Node',
  network: {
    listenPort: 9000,
    enableMDNS: true,           // 启用局域网发现
    enableDHT: false,           // 局域网不需要 DHT
    bootstrapPeers: [],         // 局域网无引导节点
  },
  security: {
    level: 'low',
  },
};
```

---

## 数据目录结构

默认数据目录：`~/.f2a/`（可通过 `dataDir` 配置修改）

```
~/.f2a/
├── config.json                    # 运行时配置（CLI 创建）
├── node-identity.json             # 节点私钥（敏感！）
├── agent-identities/              # Agent 身份文件目录
│   ├── agent:abc123de.json        # 单个 Agent 身份
│   └── agent:xyz789ab.json
├── agent-registry.json            # Agent 注册表（Daemon 维护）
├── control-token                  # Daemon 控制令牌
├── f2a.log                        # 运行时日志（network 包）
├── daemon.pid                     # Daemon 进程 PID（CLI 管理）
└── daemon.log                     # Daemon 输出日志（CLI 管理）
```

### config.json 示例

```json
{
  "network": {
    "bootstrapPeers": [],
    "bootstrapPeerFingerprints": {}
  },
  "autoStart": false,
  "enableMDNS": true,
  "enableDHT": false
}
```

---

## 配置优先级规则

```
高优先级 ◄─────────────────────────────────────► 低优先级

F2A.create(options)  >  环境变量  >  config.json  >  默认值
    (代码)              (F2A_*)      (~/.f2a/)      (源码)
```

**示例：**

```typescript
// 代码中设置 listenPort: 7070
process.env.F2A_P2P_PORT = '8080';  // 环境变量被代码覆盖

const f2a = await F2A.create({
  network: {
    listenPort: 7070,  // 最终使用 7070
  },
});
```

---

## 配置验证

F2A 在启动时会自动验证配置：

```typescript
import { validateF2AOptions } from '@f2a/network';

const result = validateF2AOptions(options);
if (!result.success) {
  console.error('配置错误:', result.error.format());
  process.exit(1);
}
```

### 常见验证错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `INVALID_LISTEN_PORT` | 端口号超出 0-65535 范围 | 修改 listenPort |
| `EMPTY_BOOTSTRAP_PEER` | 引导节点地址格式错误 | 检查 multiaddr 格式 |
| `INVALID_SECURITY_LEVEL` | 安全级别不是 low/medium/high | 修正 level 值 |
| `RATE_LIMIT_TOO_HIGH` | maxRequests 超过安全阈值 | 降低限流阈值 |

---

## 相关文档

- [API 参考](api-reference.md) — 完整 API 文档
- [中间件指南](middleware.md) — 消息中间件配置
- [安全指南](security.md) — 安全配置最佳实践
- [部署指南](deployment.md) — 生产环境部署
