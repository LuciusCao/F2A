# F2A API 参考文档

> Friend-to-Agent P2P 网络协议的完整 API 参考

## 目录

- [核心类](#核心类)
- [配置类型](#配置类型)
- [消息类型](#消息类型)
- [事件类型](#事件类型)
- [工具函数](#工具函数)

---

## 核心类

### F2A

主类，整合 P2P 网络、能力发现与任务委托。

```typescript
import { F2A } from '@f2a/network';

const f2a = new F2A({
  displayName: 'MyAgent',
  agentType: 'openclaw',
  network: {
    listenPort: 7070,
    enableMDNS: true,
    enableDHT: true,
  },
});
```

#### 方法

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `start()` | - | `Promise<Result<void>>` | 启动 P2P 网络和所有服务 |
| `stop()` | - | `Promise<void>` | 停止网络和服务 |
| `registerCapability(capability, handler)` | `AgentCapability`, `(params) => Promise<unknown>` | `void` | 注册能力及处理函数 |
| `getCapabilities()` | - | `AgentCapability[]` | 获取已注册能力列表 |
| `discoverAgents(capability?)` | `string?` | `Promise<AgentInfo[]>` | 发现具有指定能力的 Agent |
| `getConnectedPeers()` | - | `AgentInfo[]` | 获取当前连接的 Peer |
| `getAllPeers()` | - | `AgentInfo[]` | 获取所有已知 Peer |
| `delegateTask(options)` | `TaskDelegateOptions` | `Promise<Result<TaskDelegateResult>>` | 委托任务给其他 Agent |
| `sendTaskTo(peerId, taskType, description, params?)` | `string`, `string`, `string`, `Record<string, unknown>?` | `Promise<Result<unknown>>` | 直接向指定 Peer 发送任务 |
| `useMiddleware(middleware)` | `Middleware` | `void` | 添加中间件 |
| `removeMiddleware(name)` | `string` | `boolean` | 移除中间件 |
| `listMiddlewares()` | - | `string[]` | 列出中间件 |
| `findPeerViaDHT(peerId)` | `string` | `Promise<Result<string[]>>` | 通过 DHT 查找 Peer |
| `getDHTPeerCount()` | - | `number` | 获取 DHT 中的 Peer 数量 |
| `isDHTEnabled()` | - | `boolean` | 检查 DHT 是否启用 |

#### 属性

| 属性 | 类型 | 描述 |
|------|------|------|
| `peerId` | `string` | libp2p PeerID |
| `agentInfo` | `AgentInfo` | Agent 信息 |

#### 事件

```typescript
f2a.on('peer:discovered', (event) => {
  console.log('发现新 Peer:', event.agentInfo.displayName);
});

f2a.on('task:request', (event) => {
  console.log('收到任务请求:', event.taskType);
});
```

---

### P2PNetwork

底层 P2P 网络管理类。

```typescript
import { P2PNetwork } from '@f2a/network/core/p2p-network';
```

#### 主要方法

| 方法 | 描述 |
|------|------|
| `start()` | 启动 libp2p 节点 |
| `stop()` | 停止节点 |
| `connect(peerId, multiaddr?)` | 连接到指定 Peer |
| `disconnect(peerId)` | 断开连接 |
| `send(peerId, message, encrypt?)` | 发送消息 |
| `broadcast(message)` | 广播消息 |
| `getConnectedPeers()` | 获取已连接 Peer |

---

### IdentityManager

身份管理模块，支持 Node Identity 和 Agent Identity。

```typescript
import { 
  NodeIdentityManager, 
  AgentIdentityManager,
  IdentityDelegator 
} from '@f2a/network/core/identity';
```

#### NodeIdentityManager

管理节点级别的身份（PeerID）。

```typescript
const nodeIdentity = new NodeIdentityManager({
  dataDir: '/path/to/data',
  password: 'optional-password',
});

// 获取或创建身份
const identity = await nodeIdentity.getOrCreate();

// 导出身份
const exported = await nodeIdentity.exportIdentity();
```

#### AgentIdentityManager

管理 Agent 级别的身份（独立于 PeerID）。

```typescript
const agentIdentity = new AgentIdentityManager({
  nodeIdentity,
  displayName: 'MyAgent',
});

// 创建 Agent 身份
const agent = await agentIdentity.createAgentIdentity({
  displayName: 'Agent-001',
  capabilities: [{ name: 'code-generation', description: '...' }],
});
```

#### IdentityDelegator

支持 Agent 身份委托。

```typescript
const delegator = new IdentityDelegator({ nodeIdentity });

// 委托身份给 Agent
const delegation = await delegator.delegateToAgent({
  agentId: 'agent-001',
  permissions: ['task:execute', 'capability:announce'],
});
```

---

### E2EECrypto

端到端加密模块。

```typescript
import { E2EECrypto } from '@f2a/network/core/e2ee-crypto';

const crypto = new E2EECrypto();

// 生成密钥对
const keyPair = await crypto.generateKeyPair();

// 加密消息
const encrypted = await crypto.encrypt(message, recipientPublicKey);

// 解密消息
const decrypted = await crypto.decrypt(encrypted, privateKey);
```

---

### ReputationManager

信誉管理模块。

```typescript
import { ReputationManager } from '@f2a/network/core/reputation';

const reputation = new ReputationManager({
  initialScore: 100,
  maxScore: 100,
  minScore: 0,
});

// 更新信誉
reputation.updateScore(peerId, delta, reason);

// 查询信誉
const score = reputation.getScore(peerId);
```

---

## 配置类型

### F2AOptions

```typescript
interface F2AOptions {
  displayName?: string;
  agentType?: string;
  network?: P2PNetworkConfig;
  security?: SecurityConfig;
  logLevel?: LogLevel;
  dataDir?: string;
}
```

### P2PNetworkConfig

```typescript
interface P2PNetworkConfig {
  listenPort?: number;                     // 监听端口
  listenAddresses?: string[];              // 监听地址
  bootstrapPeers?: string[];               // 引导节点
  bootstrapPeerFingerprints?: Record<string, string>;
  trustedPeers?: string[];                 // 信任白名单
  enableMDNS?: boolean;                    // 启用 MDNS
  enableDHT?: boolean;                     // 启用 DHT
  dhtServerMode?: boolean;                 // DHT 服务器模式
  enableNATTraversal?: boolean;            // 启用 NAT 穿透
  enableRelayServer?: boolean;             // 启用 Relay 服务端
  
  // Relay 访问控制
  relayWhitelist?: string[];
  relayBlacklist?: string[];
  relayMinReputation?: number;
  relayMaxPerMinute?: number;
  relayMaxReservations?: number;
  relayMaxCircuits?: number;
}
```

### SecurityConfig

```typescript
interface SecurityConfig {
  level?: 'low' | 'medium' | 'high';
  requireConfirmation?: boolean;
  verifySignatures?: boolean;
  whitelist?: string[];
  blacklist?: string[];
  rateLimit?: RateLimitConfig;
  maxTasksPerMinute?: number;
}
```

### 默认配置

```typescript
import {
  DEFAULT_P2P_NETWORK_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_F2A_OPTIONS,
} from '@f2a/network';

// 默认值
DEFAULT_P2P_NETWORK_CONFIG = {
  listenPort: 7070,
  enableMDNS: true,
  enableDHT: true,
  dhtServerMode: false,
  enableNATTraversal: true,
  enableRelayServer: false,
};
```

---

## 消息类型

### F2AMessageType

```typescript
type F2AMessageType =
  | 'DISCOVER'          // 发现广播
  | 'DISCOVER_RESP'     // 发现响应
  | 'CAPABILITY_QUERY'  // 查询能力
  | 'CAPABILITY_RESPONSE' // 能力响应
  | 'TASK_REQUEST'      // 任务请求
  | 'TASK_RESPONSE'     // 任务响应
  | 'TASK_DELEGATE'     // 任务转委托
  | 'DECRYPT_FAILED'    // 解密失败通知
  | 'PING'              // 心跳
  | 'PONG'              // 心跳响应
  | 'SKILL_ANNOUNCE'    // 技能公告
  | 'SKILL_QUERY'       // 技能查询
  | 'SKILL_INVOKE'      // 技能调用
  | 'MESSAGE';          // 自由消息
```

### AgentInfo

```typescript
interface AgentInfo {
  peerId: string;              // libp2p PeerID
  displayName?: string;        // 可读名称
  agentType: 'openclaw' | 'claude-code' | 'codex' | 'custom';
  version: string;             // 版本
  capabilities: AgentCapability[]; // 能力列表
  protocolVersion: string;     // 协议版本
  lastSeen: number;            // 最后活跃时间
  multiaddrs: string[];        // 网络地址
  encryptionPublicKey?: string; // 加密公钥
  agentId?: string;            // Agent ID
}
```

### AgentCapability

```typescript
interface AgentCapability {
  name: string;                // 能力名称
  description: string;         // 描述
  tools: string[];             // 支持的工具
  parameters?: Record<string, ParameterSchema>;
}
```

### TaskDelegateOptions

```typescript
interface TaskDelegateOptions {
  taskType: string;
  description: string;
  parameters?: Record<string, unknown>;
  targetPeerId?: string;       // 指定目标
  timeout?: number;
  retries?: number;
}
```

---

## 事件类型

### F2AEvents

```typescript
interface F2AEvents {
  'network:started': (event: NetworkStartedEvent) => void;
  'peer:discovered': (event: PeerDiscoveredEvent) => void;
  'peer:connected': (event: PeerConnectedEvent) => void;
  'peer:disconnected': (event: PeerDisconnectedEvent) => void;
  'task:request': (event: TaskRequestEvent) => void;
  'task:response': (event: TaskResponseEvent) => void;
  'error': (error: Error) => void;
}
```

---

## 工具函数

### AsyncLock

```typescript
import { AsyncLock } from '@f2a/network/utils/async-lock';

const lock = new AsyncLock();

await lock.acquire();  // 获取锁（默认 30 秒超时）
lock.release();        // 释放锁
lock.isLocked();       // 检查状态
```

### Logger

```typescript
import { Logger } from '@f2a/network/utils/logger';

const logger = new Logger({ component: 'MyModule' });

logger.debug('调试信息');
logger.info('正常信息');
logger.warn('警告');
logger.error('错误', error);
```

### RateLimiter

```typescript
import { RateLimiter } from '@f2a/network/utils/rate-limiter';

const limiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000,
});

if (limiter.check(peerId)) {
  // 允许请求
} else {
  // 拒绝请求
}
```

### Validation

```typescript
import { validateF2AMessage, validateAgentCapability } from '@f2a/network/utils/validation';

const result = validateF2AMessage(message);
if (!result.valid) {
  console.error(result.errors);
}
```

---

## Result 类型

F2A 使用 `Result<T, E>` 类型处理错误：

```typescript
import { success, failure, Result } from '@f2a/network/types';

// 成功
const ok: Result<string> = success('value');

// 失败
const err: Result<string> = failure(new Error('error'));

// 使用
result.match({
  ok: (value) => console.log(value),
  err: (error) => console.error(error),
});
```

---

## 更多信息

- [架构文档](../architecture-complete.md)
- [中间件指南](../middleware-guide.md)
- [信誉系统指南](../reputation-guide.md)
- [安全设计](../security-design.md)