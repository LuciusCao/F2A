# @f2a/core

F2A 网络核心包，提供 P2P 网络、身份管理、能力发现和任务委托的基础设施。

## 概述

`@f2a/core` 是 F2A（Federated Agent-to-Agent）网络的核心实现，包含：

- **P2P 网络层** - 基于 libp2p 的去中心化网络通信
- **身份系统** - Node 和 Agent 的独立身份管理
- **Daemon 服务** - 后台服务进程和消息路由
- **能力管理** - Agent 能力的注册、发现和调度
- **信誉系统** - 基于 Agent 行为的信誉评分

## 主要模块

### 核心模块 (`src/core/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **F2A** | `f2a.ts` | 主类，整合所有组件 |
| **P2PNetwork** | `p2p-network.ts` | libp2p 网络连接、节点发现、消息传递 |
| **IdentityManager** | `identity/` | Node/Agent 身份创建、签名验证 |
| **CapabilityManager** | `capability-manager.ts` | 能力智能调度、Peer 选择 |
| **SkillExchangeManager** | `skill-exchange-manager.ts` | 技能交换协议 |
| **Reputation** | `reputation.ts` | Agent 信誉评分系统 |
| **TokenManager** | `token-manager.ts` | Daemon 控制令牌管理 |
| **E2EECrypto** | `e2ee-crypto.ts` | 端到端加密通信 |
| **NATTraversal** | `nat-traversal.ts` | NAT 穿透支持 |

### Daemon 模块 (`src/daemon/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **F2ADaemon** | `index.ts` | 后台服务主入口 |
| **AgentRegistry** | `agent-registry.ts` | Agent 注册管理 |
| **MessageRouter** | `message-router.ts` | Agent 间消息路由 |
| **ControlServer** | `control-server.ts` | HTTP 控制接口 |
| **Webhook** | `webhook.ts` | Webhook 推送通知 |

### 身份系统 (`src/core/identity/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **NodeIdentityManager** | `node-identity.ts` | 物理节点身份（PeerID） |
| **AgentIdentityManager** | `agent-identity.ts` | Agent 业务身份（AgentID） |
| **IdentityDelegator** | `delegator.ts` | Node 为 Agent 签发身份 |
| **EncryptedKeyStore** | `encrypted-key-store.ts` | 私钥加密存储 |

### CLI 模块 (`src/cli/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **Commands** | `commands.ts` | CLI 命令处理器 |
| **Configure** | `configure.ts` | 交互式配置 |
| **DaemonCLI** | `daemon.ts` | Daemon 启动/停止 |
| **IdentityCLI** | `identity.ts` | 身份管理命令 |

### 工具模块 (`src/utils/`)

| 模块 | 文件 | 功能 |
|------|------|------|
| **Logger** | `logger.ts` | 分级日志系统 |
| **RateLimiter** | `rate-limiter.ts` | API 速率限制 |
| **Validation** | `validation.ts` | 参数验证 |
| **Signature** | `signature.ts` | 消息签名工具 |
| **AsyncLock** | `async-lock.ts` | 异步锁机制 |

## 安装

```bash
# 从源码安装
cd packages/core
npm install
npm run build

# 或作为依赖安装
npm install @f2a/core
```

## 基础使用

### 创建 F2A 实例

```typescript
import { F2A } from '@f2a/core';

// 创建实例
const f2a = await F2A.create({
  displayName: 'My Agent',
  agentType: 'openclaw',
  dataDir: './f2a-data',
  network: {
    enableMDNS: true,  // 局域网发现
    enableDHT: false,  // DHT 路由
  },
});

// 启动网络
await f2a.start();

console.log('PeerID:', f2a.peerId);
console.log('AgentID:', f2a.getAgentId());
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
```

### 委托任务

```typescript
const result = await f2a.delegateTask({
  capability: 'code-generation',
  description: 'Write a Fibonacci function',
  parameters: { language: 'python' },
  timeout: 30000,
});

if (result.success) {
  console.log('Task completed:', result.data.results);
}
```

### 运行 Daemon

```typescript
import { F2ADaemon } from '@f2a/core';

const daemon = new F2ADaemon({
  controlPort: 9001,
  dataDir: './f2a-data',
});

await daemon.start();

// Daemon 提供 HTTP API：
// - /status - 获取状态
// - /peers - 获取连接节点
// - /api/agents - Agent 注册管理
// - /api/messages - 消息路由
```

## 身份系统

### Node vs Agent

F2A 采用分离的身份模型：

| 概念 | 身份标识 | 职责 | 生命周期 |
|------|----------|------|----------|
| **Node** | PeerID (libp2p) | 网络层：连接、路由、发现 | 长期持久化 |
| **Agent** | AgentID (独立) | 业务层：任务、能力、信誉 | 可迁移 |

```typescript
// 获取 Node ID（物理节点标识）
const nodeId = f2a.getNodeId();

// 获取 Agent ID（业务标识）
const agentId = f2a.getAgentId();

// 导出身份（用于备份/迁移）
const nodeIdentity = await f2a.exportNodeIdentity();
const agentIdentity = await f2a.exportAgentIdentity();
```

### Agent 身份续期

```typescript
// 检查身份是否过期
if (f2a.isAgentExpired()) {
  // 续期
  const newExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await f2a.renewAgentIdentity(newExpiresAt);
}
```

## 类型系统

### AgentInfo

```typescript
interface AgentInfo {
  peerId: string;          // libp2p PeerID
  agentId?: string;        // Agent ID
  displayName: string;     // 显示名称
  agentType: 'openclaw' | 'custom';
  version: string;
  capabilities: AgentCapability[];
  protocolVersion: string;
  lastSeen: number;
  multiaddrs: string[];
}
```

### AgentCapability

```typescript
interface AgentCapability {
  name: string;
  description: string;
  tools: string[];
  parameters?: Record<string, ParamSchema>;
}
```

## 与 openclaw-f2a 的关系

| 包 | 职责 | 使用场景 |
|---|------|----------|
| `@f2a/core` | 核心功能实现 | 直接开发、CLI 工具、嵌入式场景 |
| `@f2a/openclaw-f2a` | OpenClaw 插件集成 | 作为 OpenClaw Agent 的能力扩展 |

`@f2a/openclaw-f2a` 是 `@f2a/core` 的上层封装：
- 自动管理 Daemon 进程生命周期
- 提供 OpenClaw 工具接口（`f2a_discover`, `f2a_delegate` 等）
- 处理 Webhook 推送和任务队列

## 架构层次

```
┌─────────────────────────────────────────────┐
│              应用层                          │
│  (OpenClaw Plugin / CLI / 第三方应用)        │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              Daemon 层                       │
│  AgentRegistry | MessageRouter | ControlAPI │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              F2A Core                        │
│  F2A | Identity | Capability | Reputation   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              P2P Network                     │
│  libp2p | mDNS | DHT | GossipSub            │
└─────────────────────────────────────────────┘
```

## 开发

```bash
# 构建
npm run build

# 测试
npm test

# 测试覆盖率
npm run test:coverage

# 类型检查
npm run typecheck
```

## 数据存储

默认数据目录：`~/.f2a/` 或配置的 `dataDir`

| 文件 | 内容 |
|------|------|
| `node-identity.json` | Node 私钥和 PeerID |
| `agent-identity.json` | Agent 身份和签名 |
| `token.json` | Daemon 控制令牌 |
| `reputation.json` | 信誉评分数据 |
| `f2a.log` | 运行日志 |

## License

MIT