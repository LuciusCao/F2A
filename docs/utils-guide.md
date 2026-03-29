# F2A 工具函数指南

> `src/utils/` 目录下工具函数的使用说明

## 目录

- [AsyncLock](#asynclock)
- [Logger](#logger)
- [PeerTableManager](#peertablemanager)
- [MessageDispatcher](#messagedispatcher)
- [RateLimiter](#ratelimiter)
- [Middleware](#middleware)
- [Validation](#validation)
- [ErrorUtils](#errorutils)
- [Signature](#signature)
- [CryptoUtils](#cryptoutils)
- [CapabilityScorer](#capabilityscorer)

---

## AsyncLock

异步锁，用于保护关键资源的并发访问。

### 概述

防止多并发操作同时修改共享资源（如 PeerTable），支持超时机制避免死锁。

### 导入

```typescript
import { AsyncLock } from '@f2a/network/utils/async-lock';
```

### API

```typescript
class AsyncLock {
  // 获取锁
  async acquire(timeoutMs?: number): Promise<void>;
  
  // 释放锁
  release(): void;
  
  // 检查锁状态
  isLocked(): boolean;
}
```

### 使用示例

```typescript
const lock = new AsyncLock();

// 保护共享资源
async function updatePeerTable(peerId: string, info: PeerInfo) {
  await lock.acquire();
  try {
    peerTable.set(peerId, info);
  } finally {
    lock.release();  // 必须释放
  }
}

// 自定义超时
await lock.acquire(5000);  // 5 秒超时
```

### 默认配置

- 默认超时：30 秒 (`DEFAULT_TIMEOUT_MS = 30000`)
- 超时抛出错误：`Error: AsyncLock acquire timeout after Xms`

### 最佳实践

1. **始终使用 try-finally** 确保 lock.release() 被调用
2. **避免长时间持有锁**，尽快完成操作
3. **处理超时错误**：
   ```typescript
   try {
     await lock.acquire(5000);
   } catch (e) {
     if (e.message.includes('timeout')) {
       // 处理超时
     }
   }
   ```

---

## Logger

统一的日志记录工具。

### 概述

提供分级日志输出，支持组件标识、颜色输出和日志级别控制。

### 导入

```typescript
import { Logger } from '@f2a/network/utils/logger';
```

### API

```typescript
class Logger {
  constructor(options?: { component?: string; level?: LogLevel });
  
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: Error): void;
  
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}
```

### 日志级别

```typescript
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
```

级别优先级：ERROR > WARN > INFO > DEBUG

### 使用示例

```typescript
const logger = new Logger({ component: 'P2PNetwork' });

logger.debug('连接尝试', { peerId, attempt: 1 });
logger.info('Peer 连接成功', peerId);
logger.warn('连接不稳定', { peerId, latency });
logger.error('连接失败', error);

// 运行时调整级别
logger.setLevel('DEBUG');  // 显示所有日志
logger.setLevel('ERROR');  // 只显示错误
```

### 最佳实践

1. **为每个模块设置组件名**：便于日志过滤
2. **使用合适级别**：
   - DEBUG：详细调试信息
   - INFO：正常操作记录
   - WARN：异常但可恢复
   - ERROR：需要关注的错误
3. **避免敏感数据**：日志可能被持久化

---

## PeerTableManager

Peer 路由表管理器。

### 概述

维护 Peer 路由表，提供原子操作、定期清理和连接索引。

### 导入

```typescript
import { PeerTableManager, PeerTableConfig } from '@f2a/network/utils/peer-table-manager';
```

### 配置

```typescript
interface PeerTableConfig {
  maxSize?: number;        // 最大 Peer 数量（默认 1000）
  cleanupInterval?: number; // 清理间隔（默认 5 分钟）
  staleThreshold?: number;  // 过期阈值（默认 24 小时）
  trustedPeers?: Set<string>; // 信任白名单
  logger?: Logger;
}
```

### 常量

```typescript
PEER_TABLE_CLEANUP_INTERVAL = 5 * 60 * 1000;  // 5 分钟
PEER_TABLE_STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 小时
PEER_TABLE_MAX_SIZE = 1000; // 最大 peer 数
```

### API

```typescript
class PeerTableManager {
  constructor(config?: PeerTableConfig);
  
  // 启动清理任务
  startCleanupTask(): void;
  
  // 停止清理任务
  stopCleanupTask(): void;
  
  // 添加 Peer
  async addPeer(peerId: string, info: PeerInfo): Promise<void>;
  
  // 获取 Peer
  async getPeer(peerId: string): Promise<PeerInfo | undefined>;
  
  // 删除 Peer
  async removePeer(peerId: string): Promise<boolean>;
  
  // 更新连接状态
  async setConnected(peerId: string): Promise<void>;
  async setDisconnected(peerId: string): Promise<void>;
  
  // 查询
  async getConnectedPeers(): Promise<PeerInfo[]>;
  async getAllPeers(): Promise<PeerInfo[]>;
  async getPeerCount(): Promise<number>;
  
  // 清理过期条目
  async cleanupStalePeers(aggressive?: boolean): Promise<number>;
}
```

### 使用示例

```typescript
const peerTable = new PeerTableManager({
  maxSize: 500,
  trustedPeers: new Set(['trusted-peer-id']),
});

// 启动自动清理
peerTable.startCleanupTask();

// 添加 Peer
await peerTable.addPeer(peerId, {
  peerId,
  displayName: 'Agent-001',
  lastSeen: Date.now(),
  multiaddrs: ['/ip4/127.0.0.1/tcp/7070'],
});

// 查询
const connected = await peerTable.getConnectedPeers();
const all = await peerTable.getAllPeers();

// 停止清理
peerTable.stopCleanupTask();
```

---

## MessageDispatcher

P2P 消息分发器。

### 概述

处理消息验证、加密/解密、中间件执行和消息路由。

### 导入

```typescript
import { MessageDispatcher, MessageDispatcherConfig } from '@f2a/network/utils/message-dispatcher';
```

### 协议标识

```typescript
F2A_PROTOCOL = '/f2a/1.0.0';
```

### 配置

```typescript
interface MessageDispatcherConfig {
  logger?: Logger;
  localPeerId?: string;
}

interface MessageDispatcherCallbacks {
  onDiscover?: (agentInfo, peerId, shouldRespond) => Promise<void>;
  onCapabilityQuery?: (query, peerId) => Promise<void>;
  onCapabilityResponse?: (agentInfo, peerId) => Promise<void>;
  onTaskResponse?: (payload) => void;
  onDecryptFailed?: (message, peerId) => Promise<void>;
  onFreeMessage?: (message, peerId) => Promise<void>;
  onError?: (error) => void;
  sendMessage?: (peerId, message, encrypt) => Promise<{...}>;
}
```

### API

```typescript
class MessageDispatcher {
  constructor(config: MessageDispatcherConfig);
  
  // 设置回调
  setCallbacks(callbacks: MessageDispatcherCallbacks): void;
  
  // 处理原始消息
  async handleRawMessage(data: Uint8Array, peerId: string): Promise<void>;
  
  // 处理消息
  async handleMessage(message: F2AMessage, peerId: string): Promise<void>;
  
  // 发送消息
  async sendMessage(peerId: string, message: F2AMessage, encrypt?: boolean): Promise<void>;
  
  // 中间件
  useMiddleware(middleware: Middleware): void;
  removeMiddleware(name: string): boolean;
  
  // 设置加密器
  setE2EECrypto(crypto: E2EECrypto): void;
}
```

### 使用示例

```typescript
const dispatcher = new MessageDispatcher({
  logger: new Logger({ component: 'Dispatcher' }),
  localPeerId: myPeerId,
});

dispatcher.setCallbacks({
  onDiscover: async (agentInfo, peerId, shouldRespond) => {
    if (shouldRespond) {
      // 响应发现请求
    }
  },
  onTaskResponse: (payload) => {
    // 处理任务响应
  },
});

// 处理消息
await dispatcher.handleRawMessage(rawData, peerId);
```

---

## RateLimiter

速率限制器。

### 概述

防止恶意或过量请求，支持滑动窗口算法。

### 导入

```typescript
import { RateLimiter, RateLimitConfig } from '@f2a/network/utils/rate-limiter';
```

### 配置

```typescript
interface RateLimitConfig {
  maxRequests?: number;  // 最大请求数（默认 100）
  windowMs?: number;     // 时间窗口（默认 60000ms）
}
```

### API

```typescript
class RateLimiter {
  constructor(config?: RateLimitConfig);
  
  // 检查是否允许请求
  check(key: string): boolean;
  
  // 获取剩余配额
  getRemaining(key: string): number;
  
  // 重置计数
  reset(key: string): void;
  
  // 清理所有记录
  clear(): void;
}
```

### 使用示例

```typescript
const limiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000,  // 每分钟 100 次
});

// 检查
if (limiter.check(peerId)) {
  // 允许请求
  handleRequest();
} else {
  // 拒绝请求
  const remaining = limiter.getRemaining(peerId);  // 0
  return error('Rate limit exceeded');
}
```

---

## Middleware

中间件系统。

### 概述

提供消息预处理/后处理钩子，支持链式执行。

### 导入

```typescript
import { Middleware, MiddlewareManager, MiddlewareContext } from '@f2a/network/utils/middleware';
```

### 类型

```typescript
interface Middleware {
  name: string;
  priority?: number;  // 优先级（默认 0）
  
  // 前置处理
  before?(context: MiddlewareContext): Promise<MiddlewareResult>;
  
  // 后置处理
  after?(context: MiddlewareContext, result: unknown): Promise<MiddlewareResult>;
}

interface MiddlewareContext {
  message: F2AMessage;
  peerId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

type MiddlewareResult = 
  | { action: 'continue' }
  | { action: 'return'; value?: unknown }
  | { action: 'error'; error: Error };
```

### 使用示例

```typescript
// 创建日志中间件
const loggingMiddleware: Middleware = {
  name: 'logging',
  priority: 100,  // 高优先级，最先执行
  
  async before(context) {
    console.log(`收到消息: ${context.message.type} from ${context.peerId}`);
    return { action: 'continue' };
  },
  
  async after(context, result) {
    console.log(`消息处理完成: ${context.message.id}`);
    return { action: 'continue' };
  },
};

// 注册
dispatcher.useMiddleware(loggingMiddleware);
```

---

## Validation

消息和参数验证工具。

### 导入

```typescript
import {
  validateF2AMessage,
  validateAgentCapability,
  validateTaskDelegateOptions,
} from '@f2a/network/utils/validation';
```

### API

```typescript
interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

function validateF2AMessage(message: unknown): ValidationResult;
function validateAgentCapability(capability: unknown): ValidationResult;
function validateTaskDelegateOptions(options: unknown): ValidationResult;
```

### 使用示例

```typescript
const result = validateF2AMessage(incomingMessage);
if (!result.valid) {
  logger.warn('无效消息', result.errors);
  return;
}

// 验证能力
const capResult = validateAgentCapability(capability);
if (!capResult.valid) {
  throw new Error(capResult.errors?.join(', '));
}
```

---

## ErrorUtils

错误处理工具。

### 导入

```typescript
import { getErrorMessage, createError, isError } from '@f2a/network/utils/error-utils';
```

### API

```typescript
// 从错误对象获取消息
function getErrorMessage(error: unknown): string;

// 创建标准化错误
function createError(code: string, message: string): Error;

// 检查是否为错误
function isError(value: unknown): boolean;
```

### 使用示例

```typescript
try {
  await riskyOperation();
} catch (e) {
  const msg = getErrorMessage(e);
  logger.error('操作失败', msg);
}
```

---

## Signature

签名工具（基于 Ed25519）。

### 导入

```typescript
import { 
  generateKeyPair, 
  sign, 
  verify, 
  Signature 
} from '@f2a/network/utils/signature';
```

### API

```typescript
// 生成密钥对
async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }>;

// 签名
async function sign(data: string, privateKey: string): Promise<string>;

// 验证
async function verify(data: string, signature: string, publicKey: string): Promise<boolean>;
```

### 使用示例

```typescript
const { publicKey, privateKey } = await generateKeyPair();

const signature = await sign(message, privateKey);

const isValid = await verify(message, signature, publicKey);
if (!isValid) {
  throw new Error('签名验证失败');
}
```

---

## CryptoUtils

加密辅助工具。

### 导入

```typescript
import { CryptoUtils } from '@f2a/network/utils/crypto-utils';
```

### API

```typescript
class CryptoUtils {
  // 生成随机 ID
  static generateId(): string;
  
  // 哈希
  static hash(data: string): string;
  
  // Base64 编码/解码
  static toBase64(data: Uint8Array): string;
  static fromBase64(str: string): Uint8Array;
}
```

---

## CapabilityScorer

能力评分器。

### 概述

计算 Agent 能力匹配度分数。

### 导入

```typescript
import { CapabilityScorer } from '@f2a/network/utils/capability-scorer';
```

### API

```typescript
class CapabilityScorer {
  // 计算能力匹配分数（0-100）
  calculateScore(agent: AgentInfo, requirements: string[]): number;
  
  // 找到最佳匹配 Agent
  findBestMatch(agents: AgentInfo[], requirements: string[]): AgentInfo | null;
  
  // 排序 Agents
  sortByMatch(agents: AgentInfo[], requirements: string[]): AgentInfo[];
}
```

### 使用示例

```typescript
const scorer = new CapabilityScorer();

// 计算分数
const score = scorer.calculateScore(agent, ['code-generation', 'file-operation']);

// 找最佳匹配
const best = scorer.findBestMatch(availableAgents, ['web-browsing']);

// 排序
const sorted = scorer.sortByMatch(agents, ['data-analysis']);
```

---

## 相关文档

- [API 参考](api/API-REFERENCE.md)
- [中间件指南](middleware-guide.md)
- [架构文档](architecture-complete.md)