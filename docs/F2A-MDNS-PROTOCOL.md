# F2A mDNS 自动发现协议规格

> 基于 mDNS/DNS-SD 的局域网节点自动发现协议

---

## 1. 协议概述

### 1.1 设计目标

- **零配置发现**：节点启动后自动被发现，无需手动配置
- **低开销**：最小化网络流量和 CPU 使用
- **快速收敛**：新节点在秒级内被网络感知
- **容错性**：节点离线后自动从网络中移除
- **安全性**：防止恶意节点注入和重放攻击

### 1.2 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 服务发现 | mDNS + DNS-SD | 标准协议，跨平台支持 |
| 服务类型 | `_f2a-node._tcp` | 自定义服务类型 |
| 传输协议 | UDP | mDNS 使用 UDP 5353 端口 |
| 组播地址 | `224.0.0.251` | mDNS 标准组播地址 |
| IPv6 组播 | `FF02::FB` | IPv6 链路本地组播 |

---

## 2. mDNS 服务定义

### 2.1 服务名称

```
服务类型：_f2a-node._tcp.local.
服务实例：{instance-name}._f2a-node._tcp.local.
```

其中 `{instance-name}` 格式：
```
F2A-{PeerId-Short}-{Random}
```

- `F2A-`: 固定前缀
- `{PeerId-Short}`: PeerId 前 8 个字符（base58）
- `{Random}`: 4 位随机数（避免冲突）

**示例：**
```
F2A-16Uiu2HA-7a3f._f2a-node._tcp.local.
```

### 2.2 DNS 记录类型

#### PTR 记录（服务发现）

```
名称：_f2a-node._tcp.local.
类型：PTR
TTL:  120 (秒)
值：  F2A-16Uiu2HA-7a3f._f2a-node._tcp.local.
```

#### SRV 记录（服务定位）

```
名称：F2A-16Uiu2HA-7a3f._f2a-node._tcp.local.
类型：SRV
TTL:  120 (秒)
优先级：0
权重：0
端口：9000
目标：hostname.local.
```

#### A/AAAA 记录（地址解析）

```
名称：hostname.local.
类型：A (IPv4) 或 AAAA (IPv6)
TTL:  120 (秒)
值：  192.168.1.100 (或 IPv6 地址)
```

#### TXT 记录（元数据）

```
名称：F2A-16Uiu2HA-7a3f._f2a-node._tcp.local.
类型：TXT
TTL:  120 (秒)
值：  见下方 TXT 记录格式
```

### 2.3 TXT 记录格式

TXT 记录包含键值对，每行一个键值对：

```
peerId=16Uiu2HAmVZ3qjqjRkV1Vz3qjqjRkV1Vz
displayName=DevTeam-Agent-01
agentType=openclaw
version=0.1.3
protocolVersion=1.0.0
multiaddrs=/ip4/192.168.1.100/tcp/9000,/ip4/192.168.1.100/tcp/9001
capabilities=code-generation,web-search,file-operation
publicKey=CAESQDtqR7...（base64 编码的 E2EE 公钥）
timestamp=1709942400000
nonce=a1b2c3d4
signature=3045022100...（可选，签名验证）
```

#### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `peerId` | string | 是 | libp2p PeerId（base58） |
| `displayName` | string | 否 | 可读名称 |
| `agentType` | string | 是 | Agent 类型（openclaw/claude-code/codex/custom） |
| `version` | string | 是 | F2A 版本号 |
| `protocolVersion` | string | 是 | 协议版本 |
| `multiaddrs` | string | 是 | 多地址列表（逗号分隔） |
| `capabilities` | string | 否 | 能力列表（逗号分隔） |
| `publicKey` | string | 否 | E2EE 公钥（base64） |
| `timestamp` | number | 是 | Unix 时间戳（毫秒） |
| `nonce` | string | 是 | 随机数（防止重放） |
| `signature` | string | 否 | 消息签名（hex） |

#### TXT 记录大小限制

- 单个 TXT 字符串最大 255 字节
- 多个字符串拼接后最大 4096 字节
- 建议总大小控制在 1024 字节以内

---

## 3. 协议流程

### 3.1 节点启动流程

```
┌─────────────────────────────────────────────────────────────┐
│ 节点启动                                                     │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 1. 加载/生成 PeerId   │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 2. 启动 libp2p 节点    │
        │    - 监听 P2P 端口     │
        │    - 监听 HTTP 端口    │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 3. 构建 mDNS 服务信息 │
        │    - 生成服务实例名   │
        │    - 构建 TXT 记录    │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 4. 注册 mDNS 服务      │
        │    - 发布 PTR 记录    │
        │    - 发布 SRV 记录    │
        │    - 发布 TXT 记录    │
        │    - 发布 A/AAAA 记录 │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 5. 发送初始广播       │
        │    (快速广播 3 次)     │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 6. 启动定期广播       │
        │    (间隔 30 秒)        │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 7. 启动发现监听       │
        │    (监听其他节点)     │
        └───────────────────────┘
```

### 3.2 服务注册代码示例

```typescript
// src/utils/mdns.ts
import { createServer } from 'dgram';
import { EventEmitter } from 'eventemitter3';
import { Logger } from './logger.js';

const MDNS_PORT = 5353;
const MDNS_ADDRESS = '224.0.0.251';
const MDNS_IPV6_ADDRESS = 'FF02::FB';

export interface MDNSService {
  peerId: string;
  displayName: string;
  agentType: string;
  version: string;
  protocolVersion: string;
  port: number;
  multiaddrs: string[];
  capabilities: string[];
  publicKey?: string;
}

export class MDNSDiscovery extends EventEmitter {
  private socket: any;
  private service: MDNSService;
  private broadcastInterval?: NodeJS.Timeout;
  private logger: Logger;
  private seenPeers: Map<string, number> = new Map();
  
  constructor(service: MDNSService) {
    super();
    this.service = service;
    this.logger = new Logger({ component: 'mDNS' });
  }

  /**
   * 启动 mDNS 服务
   */
  async start(): Promise<void> {
    // 创建 UDP socket
    this.socket = createServer('udp4');
    
    // 允许地址复用
    this.socket.bind({
      port: MDNS_PORT,
      address: '0.0.0.0',
      exclusive: false
    }, () => {
      // 加入组播组
      this.socket.addMembership(MDNS_ADDRESS);
      this.socket.setMulticastTTL(255);
      this.socket.setMulticastLoopback(true);
      
      this.logger.info('mDNS service started', {
        port: MDNS_PORT,
        multicast: MDNS_ADDRESS
      });
    });

    // 监听消息
    this.socket.on('message', (msg: Buffer, rinfo: any) => {
      this.handleMessage(msg, rinfo);
    });

    // 启动定期广播
    this.startBroadcast();
    
    // 发送初始快速广播
    await this.sendInitialBroadcast();
  }

  /**
   * 发送 mDNS 广播
   */
  private sendBroadcast(): void {
    const packet = this.buildMDNSPacket();
    
    this.socket.send(
      packet,
      0,
      packet.length,
      MDNS_PORT,
      MDNS_ADDRESS,
      (err: Error | null) => {
        if (err) {
          this.logger.error('Failed to send mDNS broadcast', err);
        } else {
          this.logger.debug('mDNS broadcast sent');
        }
      }
    );
  }

  /**
   * 构建 mDNS 数据包
   */
  private buildMDNSPacket(): Buffer {
    // 使用 dns-packet 库构建标准 DNS 数据包
    const packet = {
      type: 'query',
      id: 0,  // mDNS 使用 0
      flags: 0,
      questions: [{
        type: 'PTR',
        name: '_f2a-node._tcp.local'
      }],
      answers: [
        {
          type: 'PTR',
          name: '_f2a-node._tcp.local',
          ttl: 120,
          data: this.getServiceInstanceName()
        },
        {
          type: 'SRV',
          name: this.getServiceInstanceName(),
          ttl: 120,
          data: {
            port: this.service.port,
            target: require('os').hostname() + '.local'
          }
        },
        {
          type: 'TXT',
          name: this.getServiceInstanceName(),
          ttl: 120,
          data: this.buildTXTRecord()
        }
      ],
      additionals: [
        {
          type: 'A',
          name: require('os').hostname() + '.local',
          ttl: 120,
          data: this.getLocalIP()
        }
      ]
    };

    return require('dns-packet').encode(packet);
  }

  /**
   * 构建 TXT 记录
   */
  private buildTXTRecord(): string[] {
    const records = [
      `peerId=${this.service.peerId}`,
      `displayName=${this.service.displayName}`,
      `agentType=${this.service.agentType}`,
      `version=${this.service.version}`,
      `protocolVersion=${this.service.protocolVersion}`,
      `multiaddrs=${this.service.multiaddrs.join(',')}`,
      `capabilities=${this.service.capabilities.join(',')}`,
      `timestamp=${Date.now()}`,
      `nonce=${Math.random().toString(36).substring(2, 10)}`
    ];

    if (this.service.publicKey) {
      records.push(`publicKey=${this.service.publicKey}`);
    }

    return records;
  }

  /**
   * 处理接收到的 mDNS 消息
   */
  private handleMessage(msg: Buffer, rinfo: any): void {
    try {
      const packet = require('dns-packet').decode(msg);
      
      // 忽略自己的消息
      if (packet.additionals) {
        for (const answer of packet.additionals) {
          if (answer.type === 'TXT' && answer.name.includes(this.service.peerId)) {
            return;  // 自己的消息
          }
        }
      }

      // 解析发现的节点
      const peerInfo = this.parsePeerInfo(packet);
      if (peerInfo) {
        this.emit('peer:discovered', peerInfo);
      }
    } catch (err) {
      this.logger.debug('Failed to parse mDNS packet', err);
    }
  }

  /**
   * 启动定期广播
   */
  private startBroadcast(): void {
    const interval = 30000;  // 30 秒
    const jitter = Math.random() * 5000;  // 0-5 秒随机抖动
    
    this.broadcastInterval = setInterval(() => {
      this.sendBroadcast();
    }, interval + jitter);
  }

  /**
   * 发送初始快速广播
   */
  private async sendInitialBroadcast(): Promise<void> {
    const count = 3;
    const interval = 5000;  // 5 秒
    
    for (let i = 0; i < count; i++) {
      this.sendBroadcast();
      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
  }

  /**
   * 停止 mDNS 服务
   */
  async stop(): Promise<void> {
    // 发送 goodbye 广播
    this.sendGoodbye();
    
    // 停止定期广播
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }
    
    // 关闭 socket
    if (this.socket) {
      this.socket.close();
    }
    
    this.logger.info('mDNS service stopped');
  }

  /**
   * 发送 goodbye 消息
   */
  private sendGoodbye(): void {
    const packet = this.buildMDNSPacket();
    // 设置 TTL 为 0 表示 goodbye
    packet.answers.forEach((a: any) => a.ttl = 0);
    packet.additionals.forEach((a: any) => a.ttl = 0);
    
    const buffer = require('dns-packet').encode(packet);
    this.socket.send(buffer, 0, buffer.length, MDNS_PORT, MDNS_ADDRESS);
  }
}
```

### 3.3 节点发现流程

```
┌─────────────────────────────────────────────────────────────┐
│ 监听 mDNS 广播                                               │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 收到 mDNS 数据包       │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 解析 DNS 记录          │
        │ - 提取 PTR/SRV/TXT    │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 验证数据完整性        │
        │ - 检查时间戳          │
        │ - 验证签名（可选）    │
        │ - 检查 nonce 重复     │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ 检查是否新节点        │
        └───────────┬───────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
   新节点                   已知节点
        │                       │
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│ 添加到缓存   │        │ 更新时间戳   │
│ 触发事件     │        │ 重置超时     │
└──────────────┘        └──────────────┘
```

---

## 4. 超时与清理机制

### 4.1 节点状态机

```typescript
enum PeerState {
  DISCOVERED = 'discovered',    // 刚发现
  ONLINE = 'online',            // 在线（收到多次广播）
  STALE = 'stale',              // 过期（超过广播间隔）
  OFFLINE = 'offline',          // 离线（超过超时时间）
  REMOVING = 'removing'         // 移除中（宽限期）
}

interface PeerEntry {
  peerId: string;
  state: PeerState;
  lastSeen: number;
  broadcastCount: number;
  info: MDNSService;
}
```

### 4.2 超时配置

```typescript
interface TimeoutConfig {
  // 广播间隔（秒）
  broadcastInterval: 30;
  
  // 节点超时时间（秒）= 广播间隔 × 3
  nodeTimeout: 90;
  
  // 状态检查间隔（秒）
  checkInterval: 15;
  
  // 宽限期（秒）
  gracePeriod: 30;
  
  // 快速上线阈值（连续收到广播次数）
  fastOnlineThreshold: 2;
}
```

### 4.3 清理算法

```typescript
/**
 * 定期清理过期节点
 */
private cleanupStalePeers(): void {
  const now = Date.now();
  const timeout = this.config.nodeTimeout * 1000;
  const gracePeriod = this.config.gracePeriod * 1000;
  
  for (const [peerId, entry] of this.peerTable.entries()) {
    const elapsed = now - entry.lastSeen;
    
    if (elapsed > timeout + gracePeriod) {
      // 超过宽限期，彻底删除
      this.peerTable.delete(peerId);
      this.emit('peer:removed', { peerId, reason: 'timeout' });
      
    } else if (elapsed > timeout && entry.state !== PeerState.REMOVING) {
      // 超过超时时间，进入移除状态
      entry.state = PeerState.REMOVING;
      this.emit('peer:offline', { peerId });
      
    } else if (elapsed > this.config.broadcastInterval * 1000 * 1.5) {
      // 超过 1.5 倍广播间隔，标记为过期
      if (entry.state === PeerState.ONLINE) {
        entry.state = PeerState.STALE;
        this.emit('peer:stale', { peerId });
      }
    }
  }
}
```

---

## 5. 冲突检测与解决

### 5.1 冲突类型

#### 类型 1：PeerId 冲突

**场景**：两个不同节点使用相同 PeerId

**检测**：
```typescript
function detectPeerIdConflict(
  existingPeer: PeerEntry,
  newPeer: PeerEntry
): boolean {
  return existingPeer.peerId === newPeer.peerId &&
         existingPeer.info.multiaddrs[0] !== newPeer.info.multiaddrs[0];
}
```

**解决策略**：
```typescript
enum PeerIdConflictResolution {
  // 保留先发现的节点
  KEEP_FIRST = 'keep_first',
  
  // 保留时间戳更新的节点
  KEEP_NEWER = 'keep_newer',
  
  // 保留 PeerId 字典序较大的节点
  KEEP_HIGHER = 'keep_higher'
}

function resolvePeerIdConflict(
  existing: PeerEntry,
  incoming: PeerEntry,
  strategy: PeerIdConflictResolution = PeerIdConflictResolution.KEEP_NEWER
): 'keep_existing' | 'keep_incoming' {
  switch (strategy) {
    case PeerIdConflictResolution.KEEP_FIRST:
      return 'keep_existing';
      
    case PeerIdConflictResolution.KEEP_NEWER:
      return incoming.info.timestamp > existing.info.lastSeen
        ? 'keep_incoming'
        : 'keep_existing';
        
    case PeerIdConflictResolution.KEEP_HIGHER:
      return incoming.peerId > existing.peerId
        ? 'keep_incoming'
        : 'keep_existing';
  }
}
```

#### 类型 2：地址冲突

**场景**：同一节点改变地址后重新广播

**检测**：
```typescript
function detectAddressConflict(
  peerId: string,
  address: string
): PeerEntry | null {
  for (const entry of this.peerTable.values()) {
    if (entry.peerId !== peerId && 
        entry.info.multiaddrs.includes(address)) {
      return entry;  // 地址被其他节点占用
    }
  }
  return null;
}
```

**解决**：忽略新节点，记录警告日志

### 5.2 冲突处理流程

```
收到 mDNS 广播
       │
       ▼
提取 PeerId 和地址
       │
       ▼
检查 PeerId 是否存在
       │
       ├── 不存在 ──▶ 添加新节点
       │
       └── 存在
             │
             ▼
       检查地址是否相同
             │
             ├── 相同 ──▶ 更新现有节点（刷新）
             │
             └── 不同 ──▶ PeerId 冲突
                       │
                       ▼
                 记录冲突事件
                       │
                       ▼
                 应用解决策略
                       │
                       ├── 保留现有 ──▶ 忽略新节点，发送警告
                       └── 保留新节点 ──▶ 替换现有节点
```

---

## 6. 安全机制

### 6.1 消息签名

```typescript
interface SignedMDNSMessage {
  // ... 标准 TXT 记录字段
  timestamp: number;
  nonce: string;
  signature: string;  // 可选
}

/**
 * 构建带签名的 TXT 记录
 */
function buildSignedTXTRecord(
  service: MDNSService,
  privateKey: string
): string[] {
  const baseRecords = [
    `peerId=${service.peerId}`,
    `timestamp=${Date.now()}`,
    `nonce=${generateNonce()}`
    // ... 其他字段
  ];
  
  // 构建待签名消息
  const message = baseRecords.join('\n');
  
  // 签名
  const signature = sign(message, privateKey);
  
  // 添加签名字段
  baseRecords.push(`signature=${signature}`);
  
  return baseRecords;
}

/**
 * 验证 mDNS 消息签名
 */
function verifyMDNSSignature(
  txtRecords: string[],
  publicKey: string
): boolean {
  const signature = txtRecords.find(r => r.startsWith('signature='));
  if (!signature) return false;  // 无签名，跳过验证
  
  const sigValue = signature.split('=')[1];
  
  // 提取除签名外的所有记录
  const messageRecords = txtRecords.filter(r => !r.startsWith('signature='));
  const message = messageRecords.join('\n');
  
  return verify(message, sigValue, publicKey);
}
```

### 6.2 重放攻击防护

```typescript
class ReplayProtection {
  private seenNonces: Map<string, number> = new Map();
  private readonly MAX_AGE_MS = 300000;  // 5 分钟
  
  /**
   * 检查并记录 nonce
   * @returns true 如果是新的，false 如果是重放
   */
  checkNonce(peerId: string, nonce: string, timestamp: number): boolean {
    const key = `${peerId}:${nonce}`;
    const now = Date.now();
    
    // 检查时间戳是否过期
    if (now - timestamp > this.MAX_AGE_MS) {
      return false;  // 消息过期
    }
    
    // 检查 nonce 是否已存在
    if (this.seenNonces.has(key)) {
      return false;  // 重放攻击
    }
    
    // 记录 nonce
    this.seenNonces.set(key, now);
    
    // 清理过期 nonce
    this.cleanupExpiredNonces();
    
    return true;
  }
  
  private cleanupExpiredNonces(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seenNonces.entries()) {
      if (now - timestamp > this.MAX_AGE_MS) {
        this.seenNonces.delete(key);
      }
    }
  }
}
```

### 6.3 速率限制

```typescript
interface RateLimitConfig {
  maxBroadcastsPerMinute: 10;
  maxDiscoveryPerMinute: 30;
}

class MDNSRateLimiter {
  private broadcastCounts: Map<string, number[]> = new Map();
  
  allowBroadcast(peerId: string): boolean {
    const now = Date.now();
    const windowMs = 60000;  // 1 分钟
    const maxCount = 10;
    
    const timestamps = this.broadcastCounts.get(peerId) || [];
    
    // 移除窗口外的时间戳
    const validTimestamps = timestamps.filter(t => now - t < windowMs);
    
    if (validTimestamps.length >= maxCount) {
      return false;  // 超过速率限制
    }
    
    validTimestamps.push(now);
    this.broadcastCounts.set(peerId, validTimestamps);
    
    return true;
  }
}
```

---

## 7. 跨子网发现

### 7.1 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| mDNS 网关 | 透明，无需修改客户端 | 需要额外设备 | 多子网环境 |
| DHT 补充 | 去中心化，可扩展 | 延迟较高 | 大规模部署 |
| 静态配置 | 简单可靠 | 需手动维护 | 固定节点 |

### 7.2 mDNS 网关实现

```typescript
interface MDNSGatewayConfig {
  interfaces: string[];  // 监听的网络接口
  forwardTo: string[];   // 转发到的子网
}

class MDNSGateway {
  private sockets: Map<string, any> = new Map();
  
  async start(config: MDNSGatewayConfig): Promise<void> {
    for (const iface of config.interfaces) {
      const socket = createServer('udp4');
      
      socket.bind({
        port: 5353,
        address: iface,
        exclusive: false
      }, () => {
        socket.addMembership('224.0.0.251', iface);
      });
      
      socket.on('message', (msg: Buffer, rinfo: any) => {
        this.forwardMessage(msg, rinfo, config.forwardTo);
      });
      
      this.sockets.set(iface, socket);
    }
  }
  
  private forwardMessage(
    msg: Buffer,
    from: any,
    targets: string[]
  ): void {
    for (const target of targets) {
      // 转发到其他子网
      // 注意：需要路由器支持组播路由
    }
  }
}
```

### 7.3 DHT 补充配置

```yaml
# config.yaml
network:
  # 本地发现
  enableMDNS: true
  
  # DHT 补充（跨子网）
  enableDHT: true
  dhtServerMode: false
  
  # 引导节点
  bootstrapPeers:
    - "/dns4/bootstrap1.example.com/tcp/9000"
    - "/dns4/bootstrap2.example.com/tcp/9000"
```

---

## 8. 与 libp2p 集成

### 8.1 libp2p mDNS 配置

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
  peerDiscovery: [
    mdns({
      interval: 30000,  // 30 秒
      enabled: true
    })
  ]
});
```

### 8.2 自定义 mDNS 与 libp2p 协同

```typescript
// src/core/p2p-network.ts
import { MDNSDiscovery } from '../utils/mdns.js';

export class P2PNetwork extends EventEmitter {
  private mdns?: MDNSDiscovery;
  
  async start(): Promise<Result> {
    // 1. 启动 libp2p
    this.node = await createLibp2p({ /* ... */ });
    await this.node.start();
    
    // 2. 如果启用 mDNS，启动自定义发现服务
    if (this.config.enableMDNS) {
      this.mdns = new MDNSDiscovery({
        peerId: this.node.peerId.toString(),
        displayName: this.agentInfo.displayName,
        agentType: this.agentInfo.agentType,
        version: this.agentInfo.version,
        protocolVersion: this.agentInfo.protocolVersion,
        port: this.config.listenPort,
        multiaddrs: this.node.getMultiaddrs().map(ma => ma.toString()),
        capabilities: this.agentInfo.capabilities.map(c => c.name),
        publicKey: this.e2eeCrypto.getPublicKey()
      });
      
      // 监听发现事件
      this.mdns.on('peer:discovered', (peerInfo) => {
        this.handlePeerDiscovery(peerInfo);
      });
      
      await this.mdns.start();
    }
    
    return success({ /* ... */ });
  }
  
  private async handlePeerDiscovery(peerInfo: MDNSService): Promise<void> {
    // 1. 验证 peerInfo
    if (!this.validatePeerInfo(peerInfo)) {
      return;
    }
    
    // 2. 检查是否已连接
    if (this.connectedPeers.has(peerInfo.peerId)) {
      return;
    }
    
    // 3. 尝试连接
    try {
      const multiaddr = peerInfo.multiaddrs[0];
      await this.node.dial(multiaddr);
      
      // 4. 更新 peer 表
      this.updatePeerTable(peerInfo);
      
      // 5. 触发事件
      this.emit('peer:discovered', {
        peerId: peerInfo.peerId,
        agentInfo: peerInfo
      });
    } catch (err) {
      this.logger.warn('Failed to connect to discovered peer', err);
    }
  }
  
  async stop(): Promise<void> {
    // 停止 mDNS
    if (this.mdns) {
      await this.mdns.stop();
    }
    
    // 停止 libp2p
    if (this.node) {
      await this.node.stop();
    }
  }
}
```

---

## 9. 测试与调试

### 9.1 mDNS 调试命令

```bash
# macOS: 浏览 F2A 服务
dns-sd -B _f2a-node._tcp

# macOS: 解析服务实例
dns-sd -L "F2A-16Uiu2HA-7a3f._f2a-node._tcp" local

# Linux: 使用 avahi-browse
avahi-browse _f2a-node._tcp -r

# 监听 mDNS 流量
sudo tcpdump -i en0 -n port 5353

# 发送测试 mDNS 查询
dig @224.0.0.251 -p 5353 -t PTR _f2a-node._tcp.local
```

### 9.2 测试场景

```typescript
describe('mDNS Discovery', () => {
  it('should discover peer within 5 seconds', async () => {
    const node1 = await createTestNode();
    const node2 = await createTestNode();
    
    const discovered = waitForEvent(node1, 'peer:discovered');
    await node2.start();
    
    const peerInfo = await discovered;
    expect(peerInfo.peerId).toBe(node2.peerId);
  });
  
  it('should handle peer offline after timeout', async () => {
    const node1 = await createTestNode();
    const node2 = await createTestNode();
    
    await node2.start();
    await waitForDiscovery(node1, node2);
    
    // 停止 node2
    await node2.stop();
    
    // 等待超时
    await sleep(100000);  // 90s timeout + grace period
    
    const peers = node1.getPeers();
    expect(peers.find(p => p.peerId === node2.peerId)).toBeUndefined();
  });
  
  it('should resolve PeerId conflict', async () => {
    // 模拟 PeerId 冲突场景
    // ...
  });
});
```

---

## 附录 A：完整 mDNS 数据包示例

```
DNS Header:
  ID: 0x0000
  Flags: 0x8400 (Response)
  Questions: 0
  Answer RRs: 3
  Authority RRs: 0
  Additional RRs: 1

Answer Section:
  PTR Record:
    Name: _f2a-node._tcp.local
    Type: PTR (12)
    Class: IN (1)
    TTL: 120
    Data: F2A-16Uiu2HA-7a3f._f2a-node._tcp.local
  
  SRV Record:
    Name: F2A-16Uiu2HA-7a3f._f2a-node._tcp.local
    Type: SRV (33)
    Class: IN (1)
    TTL: 120
    Priority: 0
    Weight: 0
    Port: 9000
    Target: devteam-mac.local
  
  TXT Record:
    Name: F2A-16Uiu2HA-7a3f._f2a-node._tcp.local
    Type: TXT (16)
    Class: IN (1)
    TTL: 120
    Data: 
      peerId=16Uiu2HAmVZ3qjqjRkV1Vz3qjqjRkV1Vz
      displayName=DevTeam-Agent-01
      agentType=openclaw
      version=0.1.3
      protocolVersion=1.0.0
      multiaddrs=/ip4/192.168.1.100/tcp/9000
      capabilities=code-generation,web-search
      timestamp=1709942400000
      nonce=a1b2c3d4

Additional Section:
  A Record:
    Name: devteam-mac.local
    Type: A (1)
    Class: IN (1)
    TTL: 120
    Address: 192.168.1.100
```

## 附录 B：故障排查清单

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 节点无法被发现 | 防火墙阻止 5353 端口 | 允许 UDP 5353 入站 |
| 节点发现延迟高 | 广播间隔过长 | 减少 `broadcastInterval` |
| PeerId 冲突 | 复制了相同的 peer-id.json | 删除并重新生成 |
| 跨子网无法发现 | 组播未路由 | 配置 mDNS 网关或使用 DHT |
| mDNS 服务未注册 | avahi-daemon 未运行 | `sudo systemctl start avahi-daemon` |

---

**版本**: 1.0.0  
**最后更新**: 2026-03-12  
**作者**: F2A Technical Architect
