# F2A Local 实现指南

> 私有化部署与 mDNS 自动发现的代码实现指南

---

## 1. 项目结构变更

### 1.1 新增文件

```
F2A/
├── src/
│   ├── utils/
│   │   ├── mdns.ts              # 新增：mDNS 服务发现
│   │   ├── mdns.test.ts         # 新增：mDNS 测试
│   │   ├── config-loader.ts     # 新增：配置文件加载
│   │   ├── config-loader.test.ts
│   │   ├── persistence.ts       # 新增：数据持久化
│   │   └── persistence.test.ts
│   ├── daemon/
│   │   └── config-manager.ts    # 新增：配置管理
│   └── types/
│       └── config.ts            # 新增：配置类型定义
├── config/
│   ├── config.example.yaml      # 新增：配置示例
│   └── credentials.example.yaml # 新增：凭证示例
├── scripts/
│   ├── deploy.sh                # 新增：部署脚本
│   ├── generate-config.sh       # 新增：配置生成
│   └── systemd/
│       └── f2a.service          # 新增：systemd 服务
└── docker/
    ├── Dockerfile               # 修改：支持配置
    └── docker-compose.yml       # 新增：生产部署
```

### 1.2 修改文件

| 文件 | 修改内容 | 优先级 |
|------|----------|--------|
| `src/types/index.ts` | 添加配置相关类型 | P0 |
| `src/core/p2p-network.ts` | 集成 mDNS 发现 | P0 |
| `src/core/f2a.ts` | 添加配置加载 | P0 |
| `src/daemon/index.ts` | 支持配置文件 | P1 |
| `src/daemon/main.ts` | 读取环境变量 | P1 |
| `src/cli/daemon.ts` | 添加配置参数 | P1 |
| `package.json` | 添加新依赖 | P0 |

---

## 2. 类型定义实现

### 2.1 配置类型定义

```typescript
// src/types/config.ts

/**
 * F2A Local 配置 Schema
 */

export interface F2ALocalConfig {
  /** 配置文件版本 */
  version: string;
  
  /** 节点配置 */
  node: NodeConfig;
  
  /** 网络配置 */
  network: NetworkConfig;
  
  /** mDNS 配置 */
  mdns: MDNSConfig;
  
  /** 安全配置 */
  security: SecurityConfig;
  
  /** 持久化配置 */
  persistence: PersistenceConfig;
  
  /** 日志配置 */
  logging: LoggingConfig;
  
  /** 监控配置（可选） */
  monitoring?: MonitoringConfig;
}

export interface NodeConfig {
  /** 节点显示名称 */
  displayName: string;
  /** Agent 类型 */
  agentType: 'openclaw' | 'claude-code' | 'codex' | 'custom';
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface NetworkConfig {
  /** P2P 监听端口 */
  p2pPort: number;
  /** HTTP 控制端口 */
  controlPort: number;
  /** 监听地址 */
  listenAddresses?: string[];
  /** 引导节点列表 */
  bootstrapPeers?: string[];
  /** 信任的 Peer 白名单 */
  trustedPeers?: string[];
  /** 是否启用 mDNS */
  enableMDNS: boolean;
  /** 是否启用 DHT */
  enableDHT: boolean;
  /** DHT 服务器模式 */
  dhtServerMode: boolean;
}

export interface MDNSConfig {
  /** 是否启用 mDNS */
  enabled: boolean;
  /** 服务名称 */
  serviceName: string;
  /** 广播间隔（秒） */
  broadcastInterval: number;
  /** 超时时间（秒） */
  timeout: number;
  /** 是否跨子网 */
  crossSubnet: boolean;
}

export interface SecurityConfig {
  /** 安全级别 */
  level: 'low' | 'medium' | 'high';
  /** 要求确认连接 */
  requireConfirmation: boolean;
  /** 验证消息签名 */
  verifySignatures: boolean;
  /** 签名密钥引用 */
  signatureKeyRef?: string;
  /** 控制 Token 引用 */
  controlTokenRef?: string;
  /** 速率限制 */
  rateLimit: RateLimitConfig;
}

export interface RateLimitConfig {
  /** 最大请求数 */
  maxRequests: number;
  /** 时间窗口（毫秒） */
  windowMs: number;
}

export interface PersistenceConfig {
  /** 数据目录 */
  dataDir: string;
  /** PeerId 持久化 */
  peerIdPersistence: boolean;
  /** 节点缓存持久化 */
  peerCachePersistence: boolean;
  /** 缓存清理间隔（小时） */
  cacheCleanupInterval: number;
}

export interface LoggingConfig {
  /** 日志文件路径 */
  file: string;
  /** 日志轮转配置 */
  rotation: {
    maxSize: string;
    maxFiles: number;
    compress: boolean;
  };
  /** 日志格式 */
  format: 'json' | 'text';
}

export interface MonitoringConfig {
  /** Prometheus 指标 */
  prometheus?: {
    enabled: boolean;
    port: number;
  };
  /** 健康检查 */
  healthCheck: {
    enabled: boolean;
    path: string;
  };
}
```

### 2.2 扩展现有类型

```typescript
// 修改 src/types/index.ts

// 在 P2PNetworkConfig 接口中添加：
export interface P2PNetworkConfig {
  listenPort?: number;
  listenAddresses?: string[];
  bootstrapPeers?: string[];
  trustedPeers?: string[];
  enableMDNS?: boolean;
  enableDHT?: boolean;
  dhtServerMode?: boolean;
  
  // 新增字段：
  /** 从配置文件加载 */
  configPath?: string;
  /** 数据持久化目录 */
  dataDir?: string;
  /** mDNS 广播间隔（秒） */
  mdnsBroadcastInterval?: number;
}

// 在 F2AOptions 接口中添加：
export interface F2AOptions {
  displayName?: string;
  agentType?: string;
  network?: P2PNetworkConfig;
  security?: SecurityConfig;
  logLevel?: LogLevel;
  dataDir?: string;
  
  // 新增字段：
  /** 配置文件路径 */
  configPath?: string;
  /** 是否从配置加载 */
  loadFromConfig?: boolean;
}
```

---

## 3. mDNS 实现

### 3.1 mDNS 服务类

```typescript
// src/utils/mdns.ts

import { createSocket, RemoteInfo } from 'dgram';
import { EventEmitter } from 'eventemitter3';
import * as dnsPacket from 'dns-packet';
import { Logger } from './logger.js';
import { randomBytes } from 'crypto';

const MDNS_PORT = 5353;
const MDNS_ADDRESS = '224.0.0.251';
const MDNS_IPV6_ADDRESS = 'FF02::FB';
const SERVICE_TYPE = '_f2a-node._tcp';

export interface MDNSServiceInfo {
  peerId: string;
  displayName: string;
  agentType: string;
  version: string;
  protocolVersion: string;
  port: number;
  multiaddrs: string[];
  capabilities: string[];
  publicKey?: string;
  timestamp: number;
  nonce: string;
  signature?: string;
}

export interface DiscoveredPeer {
  peerId: string;
  info: MDNSServiceInfo;
  address: string;
  port: number;
  discoveredAt: number;
}

export interface MDNSConfig {
  enabled: boolean;
  serviceName: string;
  broadcastInterval: number;
  timeout: number;
  crossSubnet: boolean;
}

export class MDNSDiscovery extends EventEmitter<{
  'peer:discovered': [DiscoveredPeer];
  'peer:updated': [DiscoveredPeer];
  'peer:removed': [string];
  'error': [Error];
}> {
  private socket: any;
  private serviceInfo: MDNSServiceInfo;
  private config: MDNSConfig;
  private logger: Logger;
  private broadcastTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private discoveredPeers: Map<string, DiscoveredPeer> = new Map();
  private seenNonces: Map<string, number> = new Map();
  
  constructor(serviceInfo: MDNSServiceInfo, config: MDNSConfig) {
    super();
    this.serviceInfo = serviceInfo;
    this.config = config;
    this.logger = new Logger({ component: 'mDNS' });
  }

  /**
   * 启动 mDNS 服务
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 创建 UDP socket
      this.socket = createSocket({ type: 'udp4', reuseAddr: true });
      
      this.socket.on('error', (err: Error) => {
        this.logger.error('mDNS socket error', err);
        this.emit('error', err);
        reject(err);
      });
      
      this.socket.bind({
        port: MDNS_PORT,
        address: '0.0.0.0',
        exclusive: false
      }, () => {
        try {
          // 加入组播组
          this.socket.addMembership(MDNS_ADDRESS);
          this.socket.setMulticastTTL(255);
          this.socket.setMulticastLoopback(true);
          
          this.logger.info('mDNS service started', {
            port: MDNS_PORT,
            multicast: MDNS_ADDRESS
          });
          
          // 设置消息处理
          this.socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
            this.handleMessage(msg, rinfo);
          });
          
          // 启动定期广播
          this.startBroadcast();
          
          // 启动清理任务
          this.startCleanup();
          
          // 发送初始快速广播
          this.sendInitialBroadcast().then(() => {
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * 发送 mDNS 广播
   */
  private sendBroadcast(): void {
    try {
      const packet = this.buildMDNSPacket();
      const buffer = dnsPacket.encode(packet);
      
      this.socket.send(
        buffer,
        0,
        buffer.length,
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
    } catch (err) {
      this.logger.error('Error building mDNS packet', err);
    }
  }

  /**
   * 构建 mDNS 数据包
   */
  private buildMDNSPacket(): dnsPacket.Packet {
    const hostname = require('os').hostname();
    const localIP = this.getLocalIP();
    
    const packet: dnsPacket.Packet = {
      type: 'response',
      id: 0,  // mDNS 使用 0
      flags: 0x8400,  // 响应标志
      questions: [],
      answers: [
        {
          type: 'PTR',
          name: `${this.config.serviceName}.local`,
          ttl: 120,
          data: this.getServiceInstanceName()
        },
        {
          type: 'SRV',
          name: this.getServiceInstanceName(),
          ttl: 120,
          data: {
            port: this.serviceInfo.port,
            target: `${hostname}.local`
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
          name: `${hostname}.local`,
          ttl: 120,
          data: localIP
        }
      ]
    };
    
    return packet;
  }

  /**
   * 构建 TXT 记录
   */
  private buildTXTRecord(): string[] {
    const records = [
      `peerId=${this.serviceInfo.peerId}`,
      `displayName=${this.serviceInfo.displayName}`,
      `agentType=${this.serviceInfo.agentType}`,
      `version=${this.serviceInfo.version}`,
      `protocolVersion=${this.serviceInfo.protocolVersion}`,
      `multiaddrs=${this.serviceInfo.multiaddrs.join(',')}`,
      `capabilities=${this.serviceInfo.capabilities.join(',')}`,
      `timestamp=${Date.now()}`,
      `nonce=${this.serviceInfo.nonce}`
    ];

    if (this.serviceInfo.publicKey) {
      records.push(`publicKey=${this.serviceInfo.publicKey}`);
    }

    if (this.serviceInfo.signature) {
      records.push(`signature=${this.serviceInfo.signature}`);
    }

    return records;
  }

  /**
   * 处理接收到的 mDNS 消息
   */
  private handleMessage(msg: Buffer, rinfo: RemoteInfo): void {
    try {
      const packet = dnsPacket.decode(msg);
      
      // 忽略自己的消息
      if (this.isOwnPacket(packet)) {
        return;
      }

      // 解析发现的节点
      const peerInfo = this.parsePeerInfo(packet, rinfo);
      if (peerInfo) {
        this.handleDiscoveredPeer(peerInfo);
      }
    } catch (err) {
      this.logger.debug('Failed to parse mDNS packet', err);
    }
  }

  /**
   * 处理发现的节点
   */
  private handleDiscoveredPeer(peer: DiscoveredPeer): void {
    const existing = this.discoveredPeers.get(peer.peerId);
    
    if (!existing) {
      // 新节点
      this.discoveredPeers.set(peer.peerId, peer);
      this.emit('peer:discovered', peer);
      this.logger.info('Discovered new peer', {
        peerId: peer.peerId.slice(0, 16),
        displayName: peer.info.displayName
      });
    } else {
      // 更新现有节点
      existing.info = peer.info;
      existing.discoveredAt = Date.now();
      this.emit('peer:updated', existing);
    }
  }

  /**
   * 解析节点信息
   */
  private parsePeerInfo(
    packet: dnsPacket.Packet,
    rinfo: RemoteInfo
  ): DiscoveredPeer | null {
    // 提取 TXT 记录
    const txtRecord = packet.answers?.find(
      (a: any) => a.type === 'TXT'
    );
    
    if (!txtRecord) {
      return null;
    }

    // 解析 TXT 记录
    const info = this.parseTXTRecord(txtRecord.data);
    
    // 验证必填字段
    if (!info.peerId || !info.timestamp) {
      return null;
    }

    // 检查重放攻击
    if (!this.checkNonce(info.peerId, info.nonce, info.timestamp)) {
      return null;
    }

    // 提取 SRV 记录获取端口
    const srvRecord = packet.answers?.find(
      (a: any) => a.type === 'SRV' && a.name === txtRecord.name
    );
    
    const port = srvRecord?.data?.port || info.port;
    
    // 提取 A 记录获取地址
    const aRecord = packet.additionals?.find(
      (a: any) => a.type === 'A'
    );
    
    const address = aRecord?.data || rinfo.address;

    return {
      peerId: info.peerId,
      info,
      address,
      port,
      discoveredAt: Date.now()
    };
  }

  /**
   * 解析 TXT 记录
   */
  private parseTXTRecord(data: string[] | Buffer): MDNSServiceInfo {
    const text = Array.isArray(data) 
      ? data.join('\n')
      : data.toString('utf-8');
    
    const info: Partial<MDNSServiceInfo> = {};
    
    text.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=');
      
      if (key === 'multiaddrs') {
        info.multiaddrs = value.split(',');
      } else if (key === 'capabilities') {
        info.capabilities = value.split(',');
      } else if (key === 'timestamp') {
        info.timestamp = parseInt(value, 10);
      } else if (key === 'port') {
        info.port = parseInt(value, 10);
      } else {
        (info as any)[key] = value;
      }
    });
    
    return info as MDNSServiceInfo;
  }

  /**
   * 检查 nonce（防止重放攻击）
   */
  private checkNonce(peerId: string, nonce: string, timestamp: number): boolean {
    const key = `${peerId}:${nonce}`;
    const now = Date.now();
    const maxAge = 300000;  // 5 分钟
    
    // 检查时间戳是否过期
    if (now - timestamp > maxAge) {
      return false;
    }
    
    // 检查 nonce 是否已存在
    if (this.seenNonces.has(key)) {
      return false;
    }
    
    // 记录 nonce
    this.seenNonces.set(key, now);
    
    // 清理过期 nonce
    this.cleanupExpiredNonces();
    
    return true;
  }

  /**
   * 启动定期广播
   */
  private startBroadcast(): void {
    const interval = this.config.broadcastInterval * 1000;
    const jitter = Math.random() * 5000;  // 0-5 秒随机抖动
    
    this.broadcastTimer = setInterval(() => {
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
   * 启动清理任务
   */
  private startCleanup(): void {
    const checkInterval = 15000;  // 15 秒
    
    this.cleanupTimer = setInterval(() => {
      this.cleanupStalePeers();
    }, checkInterval);
  }

  /**
   * 清理过期节点
   */
  private cleanupStalePeers(): void {
    const now = Date.now();
    const timeout = this.config.timeout * 1000;
    
    for (const [peerId, peer] of this.discoveredPeers.entries()) {
      const elapsed = now - peer.discoveredAt;
      
      if (elapsed > timeout) {
        this.discoveredPeers.delete(peerId);
        this.emit('peer:removed', peerId);
        this.logger.info('Peer removed (timeout)', {
          peerId: peerId.slice(0, 16)
        });
      }
    }
  }

  /**
   * 清理过期 nonce
   */
  private cleanupExpiredNonces(): void {
    const now = Date.now();
    const maxAge = 300000;  // 5 分钟
    
    for (const [key, timestamp] of this.seenNonces.entries()) {
      if (now - timestamp > maxAge) {
        this.seenNonces.delete(key);
      }
    }
  }

  /**
   * 获取服务实例名称
   */
  private getServiceInstanceName(): string {
    const peerIdShort = this.serviceInfo.peerId.substring(0, 10);
    const random = randomBytes(2).toString('hex');
    return `F2A-${peerIdShort}-${random}.${this.config.serviceName}.local`;
  }

  /**
   * 检查是否自己的数据包
   */
  private isOwnPacket(packet: dnsPacket.Packet): boolean {
    const txtRecord = packet.answers?.find((a: any) => a.type === 'TXT');
    if (!txtRecord) return false;
    
    const info = this.parseTXTRecord(txtRecord.data);
    return info.peerId === this.serviceInfo.peerId;
  }

  /**
   * 获取本地 IP
   */
  private getLocalIP(): string {
    const interfaces = require('os').networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /**
   * 停止 mDNS 服务
   */
  async stop(): Promise<void> {
    // 发送 goodbye 广播
    this.sendGoodbye();
    
    // 停止定时器
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
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
    try {
      const packet = this.buildMDNSPacket();
      // 设置 TTL 为 0 表示 goodbye
      packet.answers?.forEach((a: any) => a.ttl = 0);
      packet.additionals?.forEach((a: any) => a.ttl = 0);
      
      const buffer = dnsPacket.encode(packet);
      this.socket.send(buffer, 0, buffer.length, MDNS_PORT, MDNS_ADDRESS);
    } catch (err) {
      this.logger.error('Failed to send goodbye', err);
    }
  }

  /**
   * 获取已发现的节点
   */
  getDiscoveredPeers(): DiscoveredPeer[] {
    return Array.from(this.discoveredPeers.values());
  }
}
```

---

## 4. 配置文件加载器

### 4.1 配置加载实现

```typescript
// src/utils/config-loader.ts

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, expandTilde } from 'path';
import * as yaml from 'js-yaml';
import { Logger } from './logger.js';
import type { F2ALocalConfig, NetworkConfig, MDNSConfig } from '../types/config.js';

const DEFAULT_CONFIG_PATH = join(homedir(), '.f2a', 'config.yaml');
const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.f2a', 'credentials.yaml');

export interface LoadConfigOptions {
  configPath?: string;
  credentialsPath?: string;
  envPrefix?: string;
}

export class ConfigLoader {
  private logger: Logger;
  
  constructor() {
    this.logger = new Logger({ component: 'ConfigLoader' });
  }

  /**
   * 加载配置文件
   */
  loadConfig(options: LoadConfigOptions = {}): F2ALocalConfig {
    const configPath = options.configPath || 
                       process.env.F2A_CONFIG_PATH || 
                       DEFAULT_CONFIG_PATH;
    
    const credentialsPath = options.credentialsPath ||
                           process.env.F2A_CREDENTIALS_PATH ||
                           DEFAULT_CREDENTIALS_PATH;
    
    this.logger.info('Loading config', { configPath, credentialsPath });
    
    // 加载主配置
    const config = this.loadYAMLConfig(configPath);
    
    // 加载凭证
    const credentials = this.loadCredentials(credentialsPath);
    
    // 合并凭证到配置
    this.mergeCredentials(config, credentials);
    
    // 应用环境变量覆盖
    this.applyEnvOverrides(config, options.envPrefix || 'F2A_');
    
    // 验证配置
    this.validateConfig(config);
    
    return config;
  }

  /**
   * 加载 YAML 配置
   */
  private loadYAMLConfig(path: string): F2ALocalConfig {
    if (!existsSync(path)) {
      throw new Error(`Config file not found: ${path}`);
    }
    
    const content = readFileSync(path, 'utf-8');
    const config = yaml.load(content) as F2ALocalConfig;
    
    this.logger.debug('Config loaded', { path });
    
    return config;
  }

  /**
   * 加载凭证文件
   */
  private loadCredentials(path: string): Record<string, string> {
    if (!existsSync(path)) {
      this.logger.warn('Credentials file not found', { path });
      return {};
    }
    
    const content = readFileSync(path, 'utf-8');
    const credentials = yaml.load(content) as Record<string, string>;
    
    this.logger.debug('Credentials loaded', { path });
    
    return credentials;
  }

  /**
   * 合并凭证到配置
   */
  private mergeCredentials(
    config: F2ALocalConfig,
    credentials: Record<string, string>
  ): void {
    if (config.security.signatureKeyRef && credentials[config.security.signatureKeyRef]) {
      process.env.F2A_SIGNATURE_KEY = credentials[config.security.signatureKeyRef];
    }
    
    if (config.security.controlTokenRef && credentials[config.security.controlTokenRef]) {
      process.env.F2A_CONTROL_TOKEN = credentials[config.security.controlTokenRef];
    }
  }

  /**
   * 应用环境变量覆盖
   */
  private applyEnvOverrides(config: F2ALocalConfig, prefix: string): void {
    const envMap: Record<string, (value: string) => void> = {
      [`${prefix}P2P_PORT`]: (v) => {
        config.network.p2pPort = parseInt(v, 10);
      },
      [`${prefix}CONTROL_PORT`]: (v) => {
        config.network.controlPort = parseInt(v, 10);
      },
      [`${prefix}MDNS_ENABLED`]: (v) => {
        config.mdns.enabled = v.toLowerCase() === 'true';
      },
      [`${prefix}MDNS_BROADCAST_INTERVAL`]: (v) => {
        config.mdns.broadcastInterval = parseInt(v, 10);
      },
      [`${prefix}LOG_LEVEL`]: (v) => {
        config.node.logLevel = v as any;
      },
      [`${prefix}BOOTSTRAP_PEERS`]: (v) => {
        config.network.bootstrapPeers = v.split(',').filter(Boolean);
      }
    };
    
    for (const [envVar, setter] of Object.entries(envMap)) {
      const value = process.env[envVar];
      if (value) {
        setter(value);
        this.logger.debug('Applied env override', { envVar, value });
      }
    }
  }

  /**
   * 验证配置
   */
  private validateConfig(config: F2ALocalConfig): void {
    // 验证必填字段
    if (!config.node.displayName) {
      throw new Error('node.displayName is required');
    }
    
    if (!config.network.p2pPort) {
      throw new Error('network.p2pPort is required');
    }
    
    // 验证端口范围
    if (config.network.p2pPort < 1 || config.network.p2pPort > 65535) {
      throw new Error('network.p2pPort must be between 1 and 65535');
    }
    
    if (config.network.controlPort < 1 || config.network.controlPort > 65535) {
      throw new Error('network.controlPort must be between 1 and 65535');
    }
    
    // 验证 mDNS 配置
    if (config.mdns.broadcastInterval < 5) {
      throw new Error('mdns.broadcastInterval must be at least 5 seconds');
    }
    
    if (config.mdns.timeout <= config.mdns.broadcastInterval) {
      throw new Error('mdns.timeout must be greater than mdns.broadcastInterval');
    }
    
    this.logger.info('Config validated');
  }

  /**
   * 转换为 F2AOptions
   */
  toF2AOptions(config: F2ALocalConfig): any {
    return {
      displayName: config.node.displayName,
      agentType: config.node.agentType,
      logLevel: config.node.logLevel.toUpperCase(),
      network: {
        listenPort: config.network.p2pPort,
        bootstrapPeers: config.network.bootstrapPeers,
        trustedPeers: config.network.trustedPeers,
        enableMDNS: config.mdns.enabled,
        enableDHT: config.network.enableDHT,
        dhtServerMode: config.network.dhtServerMode
      },
      dataDir: config.persistence.dataDir
    };
  }
}

// 便捷函数
export function loadConfig(options?: LoadConfigOptions): F2ALocalConfig {
  const loader = new ConfigLoader();
  return loader.loadConfig(options);
}
```

---

## 5. 数据持久化实现

### 5.1 PeerId 持久化

```typescript
// src/utils/persistence.ts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { Logger } from './logger.js';
import type { PeerId } from '@libp2p/interface';
import { peerIdFromJSON } from '@libp2p/peer-id';

export interface PeerIdData {
  peerId: string;
  privateKey: string;
  publicKey: string;
  createdAt: number;
  lastUsed: number;
}

export interface PeerCacheEntry {
  peerId: string;
  displayName: string;
  multiaddrs: string[];
  capabilities: string[];
  lastSeen: number;
}

export interface PersistenceConfig {
  dataDir: string;
  peerIdPersistence: boolean;
  peerCachePersistence: boolean;
  cacheCleanupInterval: number;
}

export class PersistenceManager {
  private config: PersistenceConfig;
  private logger: Logger;
  private peerIdFile: string;
  private peerCacheFile: string;
  
  constructor(config: PersistenceConfig) {
    this.config = config;
    this.logger = new Logger({ component: 'Persistence' });
    
    this.peerIdFile = join(config.dataDir, 'nodes', 'peer-id.json');
    this.peerCacheFile = join(config.dataDir, 'nodes', 'peer-cache.json');
    
    // 确保目录存在
    this.ensureDirectories();
  }

  /**
   * 确保目录存在
   */
  private ensureDirectories(): void {
    const dirs = [
      this.config.dataDir,
      join(this.config.dataDir, 'nodes'),
      join(this.config.dataDir, 'logs')
    ];
    
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
        this.logger.debug('Created directory', { dir });
      }
    }
  }

  /**
   * 加载 PeerId
   */
  async loadPeerId(): Promise<PeerId | null> {
    if (!this.config.peerIdPersistence) {
      return null;
    }
    
    if (!existsSync(this.peerIdFile)) {
      this.logger.info('PeerId file not found, will generate new one');
      return null;
    }
    
    try {
      const data = JSON.parse(readFileSync(this.peerIdFile, 'utf-8')) as PeerIdData;
      const peerId = peerIdFromJSON({
        id: data.peerId,
        privateKey: data.privateKey,
        publicKey: data.publicKey
      });
      
      this.logger.info('Loaded PeerId', { 
        peerId: data.peerId.slice(0, 16) 
      });
      
      return peerId;
    } catch (err) {
      this.logger.error('Failed to load PeerId', err);
      return null;
    }
  }

  /**
   * 保存 PeerId
   */
  async savePeerId(peerId: PeerId): Promise<void> {
    if (!this.config.peerIdPersistence) {
      return;
    }
    
    try {
      const data: PeerIdData = {
        peerId: peerId.toString(),
        privateKey: peerId.privateKey?.toString() || '',
        publicKey: peerId.publicKey?.toString() || '',
        createdAt: Date.now(),
        lastUsed: Date.now()
      };
      
      writeFileSync(this.peerIdFile, JSON.stringify(data, null, 2), {
        mode: 0o600  // 仅所有者可读写
      });
      
      this.logger.info('Saved PeerId', { 
        peerId: peerId.toString().slice(0, 16) 
      });
    } catch (err) {
      this.logger.error('Failed to save PeerId', err);
      throw err;
    }
  }

  /**
   * 加载节点缓存
   */
  async loadPeerCache(): Promise<Map<string, PeerCacheEntry>> {
    const cache = new Map<string, PeerCacheEntry>();
    
    if (!this.config.peerCachePersistence) {
      return cache;
    }
    
    if (!existsSync(this.peerCacheFile)) {
      return cache;
    }
    
    try {
      const data = JSON.parse(readFileSync(this.peerCacheFile, 'utf-8'));
      const now = Date.now();
      const expirationMs = this.config.cacheCleanupInterval * 60 * 60 * 1000;
      
      for (const entry of data.peers || []) {
        // 检查是否过期
        if (now - entry.lastSeen > expirationMs) {
          continue;
        }
        
        cache.set(entry.peerId, entry);
      }
      
      this.logger.info('Loaded peer cache', { count: cache.size });
      
      return cache;
    } catch (err) {
      this.logger.error('Failed to load peer cache', err);
      return cache;
    }
  }

  /**
   * 保存节点缓存
   */
  async savePeerCache(peers: Map<string, PeerCacheEntry>): Promise<void> {
    if (!this.config.peerCachePersistence) {
      return;
    }
    
    try {
      const data = {
        version: 1,
        lastUpdated: Date.now(),
        peers: Array.from(peers.values())
      };
      
      writeFileSync(this.peerCacheFile, JSON.stringify(data, null, 2));
      
      this.logger.debug('Saved peer cache', { count: peers.size });
    } catch (err) {
      this.logger.error('Failed to save peer cache', err);
    }
  }

  /**
   * 更新 PeerId 使用时间
   */
  async updatePeerIdUsage(): Promise<void> {
    if (!existsSync(this.peerIdFile)) {
      return;
    }
    
    try {
      const data = JSON.parse(readFileSync(this.peerIdFile, 'utf-8')) as PeerIdData;
      data.lastUsed = Date.now();
      
      writeFileSync(this.peerIdFile, JSON.stringify(data, null, 2), {
        mode: 0o600
      });
    } catch (err) {
      this.logger.error('Failed to update PeerId usage', err);
    }
  }
}
```

---

## 6. 与现有代码集成

### 6.1 修改 P2PNetwork 类

```typescript
// 修改 src/core/p2p-network.ts

import { MDNSDiscovery, MDNSServiceInfo } from '../utils/mdns.js';

export class P2PNetwork extends EventEmitter<P2PNetworkEvents> {
  private mdns?: MDNSDiscovery;
  private mdnsConfig?: MDNSConfig;
  
  // ... 现有代码 ...
  
  async start(): Promise<Result<{ peerId: string; addresses: string[] }>> {
    try {
      // 1. 构建监听地址
      const listenAddresses = this.config.listenAddresses || [
        `/ip4/0.0.0.0/tcp/${this.config.listenPort}`
      ];

      // 2. 创建 libp2p 节点
      const services: Record<string, any> = {};
      
      if (this.config.enableDHT === true) {
        services.dht = kadDHT({
          clientMode: !this.config.dhtServerMode,
        });
      }

      this.node = await createLibp2p({
        addresses: { listen: listenAddresses },
        transports: [tcp()],
        connectionEncryption: [noise()],
        services
      });

      // 3. 设置事件监听
      this.setupEventHandlers();

      // 4. 启动节点
      await this.node.start();

      // 5. 获取实际监听地址
      const addrs = this.node.getMultiaddrs().map(ma => ma.toString());
      const peerId = this.node.peerId;
      
      this.agentInfo.peerId = peerId.toString();
      this.agentInfo.multiaddrs = addrs;

      // 6. 初始化 E2EE 加密
      await this.e2eeCrypto.initialize();
      this.agentInfo.encryptionPublicKey = this.e2eeCrypto.getPublicKey() || undefined;

      // 7. 启动 mDNS 发现（如果启用）
      if (this.config.enableMDNS !== false) {
        await this.startMDNSDiscovery(addrs);
      }

      // 8. 连接引导节点
      if (this.config.bootstrapPeers) {
        await this.connectToBootstrapPeers(this.config.bootstrapPeers);
      }

      // 9. 启动定期清理任务
      this.startCleanupTask();

      this.logger.info('Started', { peerId: peerId.toString().slice(0, 16) });
      this.logger.info('Listening', { addresses: addrs });

      return success({ peerId: peerId.toString(), addresses: addrs });
    } catch (error) {
      return failureFromError('NETWORK_NOT_STARTED', 'Failed to start P2P network', error as Error);
    }
  }

  /**
   * 启动 mDNS 发现
   */
  private async startMDNSDiscovery(addresses: string[]): Promise<void> {
    const serviceInfo: MDNSServiceInfo = {
      peerId: this.agentInfo.peerId,
      displayName: this.agentInfo.displayName || 'F2A Node',
      agentType: this.agentInfo.agentType,
      version: this.agentInfo.version,
      protocolVersion: this.agentInfo.protocolVersion,
      port: this.config.listenPort || 9000,
      multiaddrs: addresses,
      capabilities: this.agentInfo.capabilities.map(c => c.name),
      publicKey: this.agentInfo.encryptionPublicKey,
      timestamp: Date.now(),
      nonce: randomBytes(8).toString('hex')
    };

    const mdnsConfig: MDNSConfig = {
      enabled: true,
      serviceName: '_f2a-node._tcp',
      broadcastInterval: this.config.mdnsBroadcastInterval || 30,
      timeout: (this.config.mdnsBroadcastInterval || 30) * 3,
      crossSubnet: false
    };

    this.mdns = new MDNSDiscovery(serviceInfo, mdnsConfig);
    
    // 监听发现事件
    this.mdns.on('peer:discovered', (peer) => {
      this.handleMDNSDiscovery(peer);
    });
    
    this.mdns.on('peer:removed', (peerId) => {
      this.handleMDNSRemoval(peerId);
    });
    
    await this.mdns.start();
    
    this.logger.info('mDNS discovery started');
  }

  /**
   * 处理 mDNS 发现
   */
  private async handleMDNSDiscovery(peer: DiscoveredPeer): Promise<void> {
    this.logger.debug('mDNS discovered peer', {
      peerId: peer.peerId.slice(0, 16),
      displayName: peer.info.displayName
    });
    
    // 检查是否已连接
    if (this.connectedPeers.has(peer.peerId)) {
      return;
    }
    
    // 尝试连接
    try {
      const multiaddr = peer.info.multiaddrs[0] || 
                        `/ip4/${peer.address}/tcp/${peer.port}`;
      await this.node!.dial(multiaddr);
      
      // 更新 peer 表
      this.updatePeerTable({
        peerId: peer.peerId,
        agentInfo: {
          peerId: peer.peerId,
          displayName: peer.info.displayName,
          agentType: peer.info.agentType,
          version: peer.info.version,
          protocolVersion: peer.info.protocolVersion,
          multiaddrs: peer.info.multiaddrs,
          capabilities: peer.info.capabilities.map(name => ({
            name,
            description: '',
            tools: []
          })),
          lastSeen: Date.now(),
          encryptionPublicKey: peer.info.publicKey
        },
        lastSeen: Date.now(),
        state: 'connected'
      });
      
      this.logger.info('Connected to mDNS discovered peer', {
        peerId: peer.peerId.slice(0, 16)
      });
    } catch (err) {
      this.logger.warn('Failed to connect to mDNS peer', {
        peerId: peer.peerId.slice(0, 16),
        error: err
      });
    }
  }

  /**
   * 处理 mDNS 节点移除
   */
  private handleMDNSRemoval(peerId: string): void {
    this.logger.info('mDNS peer removed', { peerId: peerId.slice(0, 16) });
    
    // 从 peer 表中移除
    this.peerTable.delete(peerId);
    this.connectedPeers.delete(peerId);
  }

  async stop(): Promise<void> {
    // 停止 mDNS
    if (this.mdns) {
      await this.mdns.stop();
      this.mdns = undefined;
    }
    
    // 停止 libp2p
    if (this.node) {
      await this.node.stop();
      this.node = null;
    }
    
    // 清理其他资源
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.logger.info('Stopped');
  }
}
```

### 6.2 修改 F2A 类

```typescript
// 修改 src/core/f2a.ts

import { ConfigLoader, loadConfig } from '../utils/config-loader.js';
import { PersistenceManager } from '../utils/persistence.js';

export class F2A {
  private persistenceManager?: PersistenceManager;
  
  static async create(options: F2AOptions = {}): Promise<F2A> {
    // 如果指定了配置文件，从配置加载
    if (options.loadFromConfig !== false || options.configPath) {
      try {
        const configLoader = new ConfigLoader();
        const config = configLoader.loadConfig({
          configPath: options.configPath
        });
        
        // 合并配置到 options
        options = {
          ...configLoader.toF2AOptions(config),
          ...options
        };
        
        // 设置持久化
        if (config.persistence.dataDir) {
          options.dataDir = config.persistence.dataDir;
        }
      } catch (err) {
        // 配置文件不存在或无效，使用默认配置
        console.warn('Failed to load config, using defaults:', err);
      }
    }
    
    const f2a = new F2A(options);
    
    // 初始化持久化管理器
    if (options.dataDir) {
      f2a.persistenceManager = new PersistenceManager({
        dataDir: options.dataDir,
        peerIdPersistence: true,
        peerCachePersistence: true,
        cacheCleanupInterval: 24
      });
      
      // 尝试加载 PeerId
      const existingPeerId = await f2a.persistenceManager.loadPeerId();
      if (existingPeerId) {
        // 使用现有的 PeerId
        options.peerId = existingPeerId;
      }
    }
    
    return f2a;
  }
  
  async start(): Promise<Result> {
    // ... 现有启动代码 ...
    
    // 保存 PeerId
    if (this.persistenceManager && this.network.node) {
      await this.persistenceManager.savePeerId(this.network.node.peerId);
    }
    
    // ... 其余代码 ...
  }
  
  async stop(): Promise<void> {
    // 保存节点缓存
    if (this.persistenceManager && this.network) {
      const peers = this.network.getAllPeers();
      await this.persistenceManager.savePeerCache(
        new Map(peers.map(p => [p.peerId, {
          peerId: p.peerId,
          displayName: p.agentInfo?.displayName || '',
          multiaddrs: p.agentInfo?.multiaddrs || [],
          capabilities: p.agentInfo?.capabilities.map(c => c.name) || [],
          lastSeen: p.lastSeen
        }])))
      );
    }
    
    await this.network?.stop();
  }
}
```

---

## 7. 部署脚本

### 7.1 Dockerfile

```dockerfile
# docker/Dockerfile
FROM node:22-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制代码
COPY dist ./dist

# 创建数据目录
RUN mkdir -p /root/.f2a/nodes /root/.f2a/logs

# 环境变量
ENV NODE_ENV=production
ENV F2A_CONFIG_PATH=/app/config/config.yaml
ENV F2A_CREDENTIALS_PATH=/app/config/credentials.yaml

# 健康检查
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -q --spider http://localhost:9001/health || exit 1

# 端口
EXPOSE 9000 9001

# 启动命令
CMD ["node", "dist/daemon/main.js"]
```

### 7.2 Docker Compose

```yaml
# docker/docker-compose.yml
version: '3.8'

services:
  f2a-bootstrap:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: f2a-bootstrap
    restart: unless-stopped
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - ./bootstrap-config:/app/config:ro
      - f2a-bootstrap-data:/root/.f2a
    environment:
      - NODE_ENV=production
      - F2A_P2P_PORT=9000
      - F2A_CONTROL_PORT=9001
    networks:
      - f2a-network
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:9001/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  f2a-node:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: f2a-node
    restart: unless-stopped
    ports:
      - "9001:9001"
    volumes:
      - ./node-config:/app/config:ro
      - f2a-node-data:/root/.f2a
    environment:
      - NODE_ENV=production
      - BOOTSTRAP_PEERS=/dns4/f2a-bootstrap/tcp/9000
    depends_on:
      f2a-bootstrap:
        condition: service_healthy
    networks:
      - f2a-network
    # 使用 --scale 扩展
    # docker compose up --scale f2a-node=10

volumes:
  f2a-bootstrap-data:
  f2a-node-data:

networks:
  f2a-network:
    driver: bridge
```

---

## 8. 测试计划

### 8.1 单元测试

```typescript
// src/utils/mdns.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MDNSDiscovery } from './mdns.js';

describe('MDNSDiscovery', () => {
  let mdns1: MDNSDiscovery;
  let mdns2: MDNSDiscovery;
  
  const createServiceInfo = (peerId: string) => ({
    peerId,
    displayName: 'Test Node',
    agentType: 'openclaw',
    version: '0.1.3',
    protocolVersion: '1.0.0',
    port: 9000,
    multiaddrs: ['/ip4/127.0.0.1/tcp/9000'],
    capabilities: ['test'],
    timestamp: Date.now(),
    nonce: 'test-nonce'
  });
  
  const mdnsConfig = {
    enabled: true,
    serviceName: '_f2a-node._tcp',
    broadcastInterval: 5,  // 快速测试
    timeout: 15,
    crossSubnet: false
  };
  
  afterEach(async () => {
    await mdns1?.stop();
    await mdns2?.stop();
  });
  
  it('should discover peer within timeout', async () => {
    mdns1 = new MDNSDiscovery(createServiceInfo('peer1'), mdnsConfig);
    mdns2 = new MDNSDiscovery(createServiceInfo('peer2'), mdnsConfig);
    
    const discovered = new Promise((resolve) => {
      mdns1.on('peer:discovered', resolve);
    });
    
    await mdns1.start();
    await mdns2.start();
    
    const peer = await discovered;
    expect(peer.peerId).toBe('peer2');
  });
  
  it('should handle peer timeout', async () => {
    mdns1 = new MDNSDiscovery(createServiceInfo('peer1'), {
      ...mdnsConfig,
      timeout: 2  // 2 秒超时
    });
    mdns2 = new MDNSDiscovery(createServiceInfo('peer2'), mdnsConfig);
    
    const removed = new Promise((resolve) => {
      mdns1.on('peer:removed', resolve);
    });
    
    await mdns1.start();
    await mdns2.start();
    
    // 等待发现
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 停止 mdns2
    await mdns2.stop();
    
    // 等待超时
    const peerId = await removed;
    expect(peerId).toBe('peer2');
  });
});
```

### 8.2 集成测试

```typescript
// tests/integration/mdns-discovery.test.ts

import { describe, it, expect } from 'vitest';
import { F2A } from '../../src/core/f2a.js';

describe('mDNS Discovery Integration', () => {
  it('should auto-discover nodes in local network', async () => {
    const node1 = await F2A.create({
      displayName: 'Node-1',
      network: {
        listenPort: 0,
        enableMDNS: true,
        enableDHT: false
      }
    });
    
    const node2 = await F2A.create({
      displayName: 'Node-2',
      network: {
        listenPort: 0,
        enableMDNS: true,
        enableDHT: false
      }
    });
    
    await node1.start();
    await node2.start();
    
    // 等待 mDNS 发现
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const peers1 = await node1.discoverAgents();
    const peers2 = await node2.discoverAgents();
    
    expect(peers1.length).toBeGreaterThanOrEqual(1);
    expect(peers2.length).toBeGreaterThanOrEqual(1);
    
    await node1.stop();
    await node2.stop();
  });
});
```

---

## 9. 依赖更新

### 9.1 package.json 更新

```json
{
  "dependencies": {
    "@libp2p/mdns": "^10.0.0",
    "dns-packet": "^5.6.1",
    "js-yaml": "^4.1.0",
    "@types/js-yaml": "^4.0.9",
    "@types/dns-packet": "^5.6.5"
  }
}
```

---

## 10. 实施检查清单

### Phase 0 (P0 - 必须完成)

- [ ] 创建 `src/utils/mdns.ts` - mDNS 服务发现
- [ ] 创建 `src/utils/config-loader.ts` - 配置加载
- [ ] 创建 `src/utils/persistence.ts` - 数据持久化
- [ ] 修改 `src/types/index.ts` - 添加配置类型
- [ ] 修改 `src/core/p2p-network.ts` - 集成 mDNS
- [ ] 修改 `package.json` - 添加依赖
- [ ] 创建配置文件示例

### Phase 1 (P1 - 重要)

- [ ] 创建 `src/daemon/config-manager.ts` - 配置管理
- [ ] 修改 `src/daemon/main.ts` - 读取环境变量
- [ ] 创建部署脚本
- [ ] 创建 Docker 配置
- [ ] 创建 systemd 服务文件

### Phase 2 (P2 - 可选)

- [ ] 添加监控指标
- [ ] 实现跨子网 mDNS 网关
- [ ] 完善文档和示例
- [ ] 性能优化和压力测试

---

**版本**: 1.0.0  
**最后更新**: 2026-03-12  
**状态**: 草稿
