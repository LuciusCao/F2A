# F2A API 参考文档

> Friend-to-Agent P2P 网络协议的完整 API 参考

## 目录

- [核心类](#核心类)
- [模块化组件 (v0.6.0+)](#模块化组件-v060)
- [服务接口 (v0.6.0+)](#服务接口-v060)
- [Daemon 模块](#daemon-模块)
- [ControlServer HTTP API](#controlserver-http-api)
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

### 模块化组件 (v0.6.0+)

P2PNetwork 和 MessageRouter 在 v0.6.0 中进行了模块拆分，提取出独立的可测试组件。

```typescript
// 导入路径
import { 
  MessageHandler, 
  MessageSender, 
  EventHandlerSetupService 
} from '@f2a/network/core';
```

#### MessageHandler

处理 P2P 消息的核心逻辑，支持依赖注入。

```typescript
import { MessageHandler } from '@f2a/network/core/message-handler';
import type { MessageHandlerDeps } from '@f2a/network/types/p2p-handlers';

const handler = new MessageHandler({
  peerManager,
  middlewareManager,
  logger,
  emitter,
  // ... 其他依赖
});

// 处理消息
await handler.handleMessage(message, peerId);
```

| 方法 | 描述 |
|------|------|
| `handleMessage(message, peerId)` | 处理收到的 P2P 消息 |
| `handleDiscover(payload, peerId)` | 处理发现消息 |
| `handleCapabilityQuery(message, peerId)` | 处理能力查询 |
| `handleTaskRequest(message, peerId)` | 处理任务请求 |

---

#### MessageSender

P2P 消息发送和广播，支持 E2EE 加密。

```typescript
import { MessageSender } from '@f2a/network/core/message-sender';
import type { MessageSenderDeps } from '@f2a/network/types/p2p-handlers';

const sender = new MessageSender({
  node,
  peerManager,
  e2eeCrypto,
  logger,
  enableE2EE: true,
});

// 发送消息
const result = await sender.send(peerId, message, true);

// 广播消息
await sender.broadcast(message);
```

| 方法 | 描述 |
|------|------|
| `send(peerId, message, encrypt?)` | 发送消息到指定 Peer |
| `broadcast(message)` | 广播消息到全网 |

---

#### QueueManager

管理 Agent 消息队列，从 MessageRouter 提取。

```typescript
import { QueueManager } from '@f2a/network/core/queue-manager';

const queueManager = new QueueManager({
  logger,
  defaultMaxQueueSize: 100,
});

// 创建队列
queueManager.createQueue('agent:xxx:yyy', 50);

// 获取消息
const messages = queueManager.pollQueue('agent:xxx:yyy', 10);

// 推送消息
queueManager.pushMessage('agent:xxx:yyy', message);
```

| 方法 | 描述 |
|------|------|
| `createQueue(agentId, maxSize?)` | 创建消息队列 |
| `deleteQueue(agentId)` | 删除队列 |
| `getQueue(agentId)` | 获取队列信息 |
| `pollQueue(agentId, limit?)` | 获取消息（不移除） |
| `pushMessage(agentId, message)` | 推送消息到队列 |
| `clearQueue(agentId, ids?)` | 清除指定消息 |

---

#### WebhookPusher

RFC 004 Agent 级 Webhook 转发，从 MessageRouter 提取。

```typescript
import { WebhookPusher } from '@f2a/network/core/webhook-pusher';

const pusher = new WebhookPusher({ logger });

// 转发消息到 Agent webhook
const result = await pusher.forwardToAgentWebhook(message, targetAgent);
```

| 方法 | 描述 |
|------|------|
| `forwardToAgentWebhook(message, agent)` | 转发消息到 Agent webhook |
| `clearCache(agentId)` | 清除 webhook 服务缓存 |

---

### 服务接口 (v0.6.0+)

用于依赖注入和测试 mock 的接口定义。

```typescript
import { 
  IAgentRegistry, 
  IMessageRouter 
} from '@f2a/network/interfaces';
```

#### IAgentRegistry

Agent 注册表接口，定义注册、查询、更新等操作契约。

```typescript
interface IAgentRegistry {
  // 注册
  register(request: AgentRegistrationRequest): AgentRegistration;
  registerRFC008(request: RFC008AgentRegistrationRequest): AgentRegistration;
  
  // 查询
  get(agentId: string): AgentRegistration | undefined;
  list(): AgentRegistration[];
  findByCapability(name: string): AgentRegistration[];
  
  // 更新
  updateName(agentId, newName): boolean;
  updateWebhook(agentId, webhook): boolean;
  
  // 验证
  verifySignature(agentId, signature?, peerId?, publicKey?): boolean;
  
  // 持久化
  saveAsync(): Promise<void>;
}
```

#### IMessageRouter

消息路由接口，定义队列管理和路由操作契约。

```typescript
interface IMessageRouter {
  // 队列管理
  createQueue(agentId: string, maxSize?: number): void;
  deleteQueue(agentId: string): void;
  getQueue(agentId: string): MessageQueue | undefined;
  
  // 路由
  route(message: RoutableMessage): boolean;
  routeAsync(message: RoutableMessage): Promise<boolean>;
  broadcast(message: RoutableMessage): boolean;
  
  // 消息管理
  getMessages(agentId: string, limit?: number): RoutableMessage[];
  clearMessages(agentId: string, ids?: string[]): number;
}
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

## Daemon 模块

Daemon 包提供后台服务，管理 Agent 注册、消息路由和 HTTP API。

```typescript
import { F2ADaemon, AgentRegistry, MessageRouter, ControlServer } from '@f2a/daemon';
```

### F2ADaemon

主 Daemon 类，整合 F2A 网络和 ControlServer。

```typescript
const daemon = new F2ADaemon({
  controlPort: 9001,
  dataDir: '~/.f2a',
});

await daemon.start();
const f2a = daemon.getF2A();
await daemon.stop();
```

#### 方法

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `start()` | - | `Promise<void>` | 启动 Daemon（F2A 网络 + ControlServer） |
| `stop()` | - | `Promise<void>` | 停止 Daemon |
| `getF2A()` | - | `F2A | undefined` | 获取底层 F2A 实例 |
| `isRunning()` | - | `boolean` | 检查是否运行中 |

---

### AgentRegistry

管理注册到 Daemon 的 Agent 实例。

**RFC 003**: AgentId 由节点签发，用户不能自定义。格式: `agent:<PeerId前16位>:<随机8位>`。

```typescript
const registry = controlServer.getAgentRegistry();

// 注册 Agent
const registration = registry.register({
  name: 'MyAgent',
  capabilities: [{ name: 'code-generation', description: '...' }],
  webhook: { url: 'http://localhost:9002/webhooks/f2a-message' },
});

// AgentId 由节点生成
console.log(registration.agentId); // agent:16Qk...:a1b2c3d4
```

#### 类型定义

```typescript
interface AgentRegistration {
  agentId: string;              // 节点签发，格式: agent:<PeerId前16位>:<随机8位>
  name: string;                 // 显示名称（可修改）
  capabilities: AgentCapability[];
  peerId: string;               // 签发节点 PeerId
  signature: string;            // AgentId 签名（Base64）
  registeredAt: Date;
  lastActiveAt: Date;
  webhook?: AgentWebhook;       // RFC 004: Agent 级 Webhook
  onMessage?: MessageCallback;  // 本地回调
  metadata?: Record<string, unknown>;
}

interface AgentRegistrationRequest {
  name: string;                 // 必填
  capabilities: AgentCapability[];
  webhook?: AgentWebhook;
  onMessage?: MessageCallback;
  metadata?: Record<string, unknown>;
}

interface AgentWebhook {
  url: string;
  token?: string;
}

type MessageCallback = (message: {
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  type: string;
  createdAt: Date;
}) => void;
```

#### 方法

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `register(request)` | `AgentRegistrationRequest` | `AgentRegistration` | 注册 Agent（节点签发 AgentId） |
| `unregister(agentId)` | `string` | `boolean` | 注销 Agent |
| `get(agentId)` | `string` | `AgentRegistration \| undefined` | 获取 Agent 信息 |
| `has(agentId)` | `string` | `boolean` | 检查 Agent 是否存在 |
| `getAll()` | - | `AgentRegistration[]` | 获取所有 Agent |
| `list()` | - | `AgentRegistration[]` | 列出所有 Agent |
| `size()` | - | `number` | Agent 数量 |
| `updateName(agentId, name)` | `string`, `string` | `boolean` | 更新 Agent 名称 |
| `updateWebhook(agentId, webhook)` | `string`, `AgentWebhook \| undefined` | `boolean` | 更新 Webhook（RFC 004） |
| `updateLastActive(agentId)` | `string` | `void` | 更新活跃时间 |
| `getStats()` | - | `{ total, local, remote, active }` | 获取统计信息 |
| `cleanupInactive(maxMs)` | `number` | `number` | 清理不活跃 Agent |

---

### MessageRouter

处理 Daemon 内部 Agent 之间的消息路由。

**投递优先级**：
1. `onMessage` 本地回调（同进程 Agent，同步调用）
2. Webhook 推送（远程 Agent，异步执行）
3. 消息队列（HTTP 轮询，作为 fallback）

```typescript
const router = controlServer.getMessageRouter();

// 路由消息到特定 Agent
router.route({
  messageId: 'msg-001',
  fromAgentId: 'agent:sender:...',
  toAgentId: 'agent:target:...',
  content: 'Hello!',
  type: 'message',
  createdAt: new Date(),
});

// 广播消息（不指定目标）
router.broadcast({
  messageId: 'msg-002',
  fromAgentId: 'agent:broadcaster:...',
  content: 'Announcement',
  type: 'announcement',
  createdAt: new Date(),
});

// 获取队列中的消息
const messages = router.getMessages('agent:target:...');
```

#### 类型定义

```typescript
interface RoutableMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId?: string;           // 可选，不指定则广播
  content: string;
  metadata?: Record<string, unknown>;
  type: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  createdAt: Date;
}

interface F2AMessagePayload {
  message: string;
  from: { agentId: string; name: string; };
  to: { agentId: string; name: string; };
  sessionKey: string;
  type: string;
  timestamp: number;
  messageId: string;
}

interface WebhookPushResult {
  success: boolean;
  error?: string;
  latency?: number;
}
```

#### 方法

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `route(message)` | `RoutableMessage` | `boolean` | 路由消息到特定 Agent |
| `broadcast(message)` | `RoutableMessage` | `boolean` | 广播给所有 Agent（除发送方） |
| `createQueue(agentId, maxSize?)` | `string`, `number?` | `void` | 创建消息队列 |
| `deleteQueue(agentId)` | `string` | `void` | 删除消息队列 |
| `getQueue(agentId)` | `string` | `MessageQueue \| undefined` | 获取队列信息 |
| `getMessages(agentId, limit?)` | `string`, `number?` | `RoutableMessage[]` | 获取队列消息 |
| `clearMessages(agentId, ids?)` | `string`, `string[]?` | `number` | 清除消息，返回清除数量 |
| `getStats()` | - | `{ queues, totalMessages, pendingPushes }` | 获取统计信息 |

---

### ControlServer

HTTP API 服务端，提供 Agent 注册和消息发送接口。

```typescript
import { ControlServer } from '@f2a/daemon';

const server = new ControlServer(f2a, 9001, tokenManager, { dataDir: '~/.f2a' });
await server.start();

// 访问内部组件
const registry = server.getAgentRegistry();
const router = server.getMessageRouter();

await server.stop();
```

#### 方法

| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `start()` | - | `Promise<void>` | 启动 HTTP 服务 |
| `stop()` | - | `Promise<void>` | 停止服务 |
| `getAgentRegistry()` | - | `AgentRegistry` | 获取 Agent 注册表 |
| `getMessageRouter()` | - | `MessageRouter` | 获取消息路由器 |
| `getPort()` | - | `number` | 获取监听端口 |

---

## ControlServer HTTP API

ControlServer 在端口 **9001** 提供 HTTP API（可通过 `controlPort` 配置）。

### 基础端点（无需认证）

#### GET /health

健康检查。

```bash
curl http://localhost:9001/health
# {"success": true, "status": "ok", "peerId": "16Qk..."}
```

#### GET /api/agents

列出所有注册的 Agent。

```bash
curl http://localhost:9001/api/agents
# [{"agentId": "agent:16Qk:a1b2c3d4", "name": "MyAgent", ...}]
```

#### POST /api/agents

注册 Agent。

```bash
curl -X POST http://localhost:9001/api/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "MyAgent", "capabilities": [...], "webhook": {"url": "http://localhost:9002/webhooks/f2a-message"}}'
# {"success": true, "agentId": "agent:16Qk:a1b2c3d4", ...}
```

**请求体**:
```typescript
{
  name: string;                 // 必填
  capabilities: AgentCapability[];
  webhook?: { url: string; token?: string; };
  metadata?: Record<string, unknown>;
}
```

#### GET /api/agents/:agentId

获取指定 Agent 信息。

```bash
curl http://localhost:9001/api/agents/agent:16Qk:a1b2c3d4
# {"success": true, "agent": {...}}
```

#### DELETE /api/agents/:agentId

注销 Agent。

```bash
curl -X DELETE http://localhost:9001/api/agents/agent:16Qk:a1b2c3d4
# {"success": true}
```

#### PATCH /api/agents/:agentId/webhook

更新 Agent Webhook（RFC 004）。

```bash
curl -X PATCH http://localhost:9001/api/agents/agent:16Qk:a1b2c3d4/webhook \
  -H "Content-Type: application/json" \
  -d '{"url": "http://new-webhook:9002/webhooks/f2a-message", "token": "secret"}'
# {"success": true}
```

#### POST /api/messages

发送消息。

```bash
curl -X POST http://localhost:9001/api/messages \
  -H "Content-Type: application/json" \
  -d '{"fromAgentId": "agent:sender:...", "toAgentId": "agent:target:...", "content": "Hello!", "type": "message"}'
# {"success": true, "messageId": "msg-001"}
```

**请求体**:
```typescript
{
  fromAgentId: string;          // 必填，发送方 AgentId
  toAgentId?: string;           // 可选，不指定则广播
  content: string;              // 必填
  type: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
}
```

#### GET /api/messages/:agentId

获取 Agent 的消息队列。

```bash
curl "http://localhost:9001/api/messages/agent:16Qk:a1b2c3d4?limit=10"
# {"success": true, "messages": [...]}
```

#### DELETE /api/messages/:agentId

清除消息队列。

```bash
curl -X DELETE "http://localhost:9001/api/messages/agent:16Qk:a1b2c3d4?messageIds=msg-001,msg-002"
# {"success": true, "cleared": 2}
```

### 认证端点（需要 Token）

以下端点需要通过 `X-F2A-Token` 或 `Authorization: Bearer <token>` 提供认证。

#### GET /status

获取节点状态。

```bash
curl -H "X-F2A-Token: your-token" http://localhost:9001/status
# {"success": true, "peerId": "16Qk...", "multiaddrs": [...]}
```

#### GET /peers

获取已知的 Peers。

```bash
curl -H "X-F2A-Token: your-token" http://localhost:9001/peers
# {"success": true, "peers": [...]}
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
- [消息协议](../message-protocol.md)
- [RFC 文档](../rfc/)