# @f2a/network

[![npm version](https://img.shields.io/npm/v/@f2a/network.svg)](https://www.npmjs.com/package/@f2a/network)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

基于 libp2p 的 P2P 网络核心库，为 OpenClaw Agents 提供去中心化网络通信能力。

## 概述

`@f2a/network` 是 F2A（Friend-to-Agent）网络的核心实现，提供：

- **P2P 网络连接** - 基于 libp2p 的去中心化网络通信
- **节点发现** - 支持 mDNS 局域网发现和 DHT 分布式发现
- **身份管理** - Node/Agent 独立身份体系，支持签名验证
- **消息路由** - Agent 间消息传递与路由
- **E2EE 加密** - 端到端加密通信
- **Agent 注册表** - Agent 能力注册与发现
- **信誉系统** - 基于 Agent 行为的信誉评分

## 功能特性

### 🌐 P2P 网络层
- libp2p 原生实现，支持多种传输协议
- mDNS 局域网自动发现
- Kademlia DHT 分布式路由
- NAT 穿透支持（AutoNAT, DCUtR, Circuit Relay）

### 🔐 安全与身份
- Node 身份（PeerID）- 网络层标识
- Agent 身份（AgentID）- 业务层标识，可迁移
- Ed25519 签名验证
- 端到端加密通信

### 📨 消息系统
- 灵活的消息协议（网络层 + Agent 层）
- 消息路由与队列管理
- 中间件支持（日志、限流、转换等）

### ⭐ 信誉与经济
- Agent 信誉评分系统
- 评审委员会机制
- 自主经济系统

## 安装

```bash
npm install @f2a/network
```

## 快速开始

### 创建 F2A 实例

```typescript
import { F2AFactory } from '@f2a/network/core/f2a-factory.js';

// 创建实例（现代方式，返回 Result<F2A>）
const result = await F2AFactory.create({
  displayName: 'My Agent',
  agentType: 'openclaw',
  dataDir: './f2a-data',
  network: {
    enableMDNS: true,   // 局域网发现
    enableDHT: true,    // DHT 路由
  },
});

if (!result.success) {
  throw new Error(result.error.message);
}

const f2a = result.data;

// 启动网络
await f2a.start();

console.log('PeerID:', f2a.peerId);
console.log('AgentID:', f2a.getAgentId());

// 向后兼容：F2A.create() 直接返回 F2A 实例（失败时抛出异常）
// import { F2A } from '@f2a/network';
// const f2a = await F2A.create({ ... });
```

### 注册能力

```typescript
// 注册代码生成能力
f2a.registerCapability(
  {
    name: 'code-generation',
    description: 'Generate code from requirements',
    tools: ['write', 'read', 'exec'],
  },
  async (params) => {
    // 执行代码生成逻辑
    return { code: '...' };
  }
);
```

### 发现其他 Agent

```typescript
// 发现所有 Agent
const agents = await f2a.discoverAgents();

// 按能力过滤
const codeAgents = await f2a.discoverAgents('code-generation');

console.log(`Found ${codeAgents.length} agents with code-generation capability`);
```

### 发送/接收消息

```typescript
// 监听消息
f2a.on('peer:message', (event) => {
  console.log(`Message from ${event.from}:`, event.content);
});

// 发送消息给指定 Peer
const peerId = 'target-peer-id';
await f2a.sendMessageToPeer(peerId, 'Hello from F2A!', 'chat');
```

### 事件监听

```typescript
// 网络事件
f2a.on('peer:discovered', (event) => {
  console.log('New peer discovered:', event.peerId);
});

f2a.on('peer:connected', (event) => {
  console.log('Peer connected:', event.peerId);
});

f2a.on('peer:disconnected', (event) => {
  console.log('Peer disconnected:', event.peerId);
});

f2a.on('network:started', (event) => {
  console.log('Network started, listening on:', event.listenAddresses);
});

f2a.on('error', (error) => {
  console.error('Network error:', error);
});
```

## API 文档

### 核心类

#### `F2A`

主类，整合所有网络组件。

```typescript
// 创建实例（向后兼容，失败时抛出异常）
const f2a = await F2A.create(options: F2AOptions);

// 现代方式：使用 F2AFactory.create() 返回 Result<F2A>
// import { F2AFactory } from '@f2a/network/core/f2a-factory.js';
// const result = await F2AFactory.create(options);
// if (!result.success) throw new Error(result.error.message);
// const f2a = result.data;

// 生命周期
await f2a.start(): Promise<Result<void>>;
await f2a.stop(): Promise<void>;

// 身份
f2a.peerId: string;
f2a.getAgentId(): string;

// 能力管理
f2a.registerCapability(capability, handler): void;
f2a.getCapabilities(): AgentCapability[];

// 发现
await f2a.discoverAgents(capability?): Promise<AgentInfo[]>;
f2a.getConnectedPeers(): AgentInfo[];

// 消息
await f2a.sendMessageToPeer(peerId, content, topic?): Promise<Result<void>>;
await f2a.sendMessage(fromAgentId, toAgentId, content, options?): Promise<Result<void>>;

// 事件
f2a.on('peer:message', callback);
f2a.on('peer:connected', callback);
f2a.on('peer:disconnected', callback);
f2a.on('peer:discovered', callback);
f2a.on('network:started', callback);
f2a.on('error', callback);
```

#### `P2PNetwork`

libp2p 网络管理类。

#### `NodeIdentityManager`

Node 身份管理（网络层标识）。

#### `AgentIdentityManager`

Agent 身份管理（业务层标识）。

#### `MessageRouter`

消息路由器，支持队列管理和消息分发。

#### `AgentRegistry`

Agent 注册表，管理 Agent 能力注册与发现。

#### `E2EECrypto`

端到端加密工具类。

#### `ReputationManager`

Agent 信誉管理。

### 配置类型

#### `F2AOptions`

```typescript
interface F2AOptions {
  displayName?: string;      // 节点可读名称
  agentType?: string;        // Agent 类型
  network?: P2PNetworkConfig; // P2P 网络配置
  security?: SecurityConfig;  // 安全配置
  logLevel?: LogLevel;       // 日志级别
  dataDir?: string;          // 数据目录
}
```

#### `P2PNetworkConfig`

```typescript
interface P2PNetworkConfig {
  listenPort?: number;
  listenAddresses?: string[];
  bootstrapPeers?: string[];
  enableMDNS?: boolean;
  enableDHT?: boolean;
  enableNATTraversal?: boolean;
}
```

#### `SecurityConfig`

```typescript
interface SecurityConfig {
  level?: 'low' | 'medium' | 'high';
  requireConfirmation?: boolean;
  verifySignatures?: boolean;
  whitelist?: string[];
  blacklist?: string[];
}
```

### 导出模块

```typescript
// 核心
export { F2A, F2AFactory } from './core/f2a.js';
export { P2PNetwork } from './core/p2p-network.js';
export { TokenManager, defaultTokenManager } from './core/token-manager.js';
export { E2EECrypto, defaultE2EECrypto } from './core/e2ee-crypto.js';

// 身份管理
export { NodeIdentityManager, isValidNodeId } from './core/identity/node-identity.js';
export { AgentIdentityManager } from './core/identity/agent-identity.js';
export { IdentityDelegator } from './core/identity/delegator.js';
export {
  AgentIdentityKeypair, generateAgentId, computeFingerprint,
  parseAgentId, validateAgentId, isNewFormat, isOldFormat,
  isValidAgentIdFormat, extractFingerprint, extractPeerIdPrefix,
  generateChallenge, signChallenge, verifyChallengeResponse,
  verifyChallengeResponseWithStore, ChallengeStore,
  signSelfSignature, verifySelfSignature, computeAgentId,
} from './core/identity/index.js';

// 消息与路由
export { AgentRegistry, AgentRegistration } from './core/agent-registry.js';
export { MessageRouter, RoutableMessage } from './core/message-router.js';

// 信誉系统
export { ReputationManager, REPUTATION_TIERS } from './core/reputation.js';
export { ReviewCommittee } from './core/review-committee.js';
export { AutonomousEconomy } from './core/autonomous-economy.js';
export { ChainSignatureManager, InvitationManager, ChallengeManager } from './core/reputation-security.js';

// 工具
export { Logger } from './utils/logger.js';
export { RateLimiter, createRateLimitMiddleware } from './utils/rate-limiter.js';
export { secureWipe } from './utils/crypto-utils.js';
export { RequestSigner, loadSignatureConfig, loadSignatureConfigSafe, isSignatureAvailable, requireSignatureInProduction } from './utils/signature.js';
export { createMessageSizeLimitMiddleware, createMessageTypeFilterMiddleware, createMessageLoggingMiddleware, createMessageTransformMiddleware } from './utils/middleware.js';
export { ensureError, getErrorMessage, toF2AError, toF2AErrorFromUnknown } from './utils/error-utils.js';

// 类型与配置
export type { F2AOptions, P2PNetworkConfig, SecurityConfig, SecurityLevel, RateLimitConfig, WebhookConfig, TaskDelegateOptions, LogLevel } from './config/types.js';
export type { AgentInfo, AgentCapability, F2AMessage, Result } from './types/index.js';
export {
  DEFAULT_P2P_NETWORK_CONFIG, DEFAULT_SECURITY_CONFIG, DEFAULT_LOG_LEVEL, DEFAULT_F2A_OPTIONS,
} from './config/defaults.js';
export const VERSION = '...'; // 从 package.json 自动读取
```

## 相关包

| 包 | 描述 |
|---|---|
| `@f2a/daemon` | HTTP API 服务，提供 RESTful 接口 |
| `@f2a/cli` | 命令行工具，管理身份、启动服务 |

## 架构

```
┌─────────────────────────────────────────────────────┐
│                     应用层                           │
│           (OpenClaw Plugin / CLI / 第三方)          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                   F2A Core                          │
│    F2A | Identity | Capability | Reputation        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                  P2P Network                         │
│        libp2p | mDNS | DHT | GossipSub              │
└─────────────────────────────────────────────────────┘
```

## 开发

```bash
# 构建
npm run build

# 类型检查
npm run lint

# 测试
npm test

# 测试覆盖率
npm run test:coverage

# 集成测试
npm run test:integration
```

## 数据存储

默认数据目录：`~/.f2a/` 或配置的 `dataDir`

| 文件/目录 | 内容 |
|-----------|------|
| `node-identity.json` | Node 私钥和 PeerID |
| `agent-identity.json` | Agent 身份和签名（旧格式兼容） |
| `agent-identities/` | Agent 身份文件目录（RFC 008 新格式） |
| `control-token` | Daemon 控制令牌 |
| `config.json` | 用户配置 |
| `f2a.log` | 运行时日志 |
| `token-audit.log` | Token 使用审计日志 |

## License

MIT