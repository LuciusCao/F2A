# F2A 工具函数指南

> `src/utils/` 目录下工具函数的使用说明

## 导入说明 (v0.6.0+)

部分工具模块已导出到主包入口，可直接导入：

```typescript
// 从主包导入（推荐）
import {
  Logger,
  RateLimiter,
  createRateLimitMiddleware,
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
  createMessageSizeLimitMiddleware,
  createMessageTypeFilterMiddleware,
  createMessageLoggingMiddleware,
  createMessageTransformMiddleware,
  ensureError,
  getErrorMessage,
  toF2AError,
  toF2AErrorFromUnknown,
  RequestSigner,
  isSignatureAvailable,
  requireSignatureInProduction,
  secureWipe,
} from '@f2a/network';
```

以下模块**未导出到主包**，如需使用请通过直接路径导入：

```typescript
// 直接路径导入（未导出到主包）
import { AsyncLock } from '@f2a/network/dist/utils/async-lock.js';
import { PeerTableManager } from '@f2a/network/dist/utils/peer-table-manager.js';
import { MessageDispatcher } from '@f2a/network/dist/utils/message-dispatcher.js';
import * as CapabilityScorer from '@f2a/network/dist/utils/capability-scorer.js';
import {
  validateF2AMessage,
  validateAgentCapability,
  validateTaskDelegateOptions,
} from '@f2a/network/dist/utils/validation.js';
```

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
// 直接路径导入（未导出到主包）
import { AsyncLock } from '@f2a/network/dist/utils/async-lock.js';
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
// 从主包导入（推荐）
import { Logger } from '@f2a/network';

// 或直接路径导入
import { Logger } from '@f2a/network/dist/utils/logger.js';
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
// 直接路径导入（未导出到主包）
import { PeerTableManager, PeerTableConfig } from '@f2a/network/dist/utils/peer-table-manager.js';
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

  // 信任白名单管理
  addTrustedPeer(peerId: string): void;
  isTrusted(peerId: string): boolean;

  // 锁管理（用于手动保护复合操作）
  async acquireLock(timeoutMs?: number): Promise<void>;
  releaseLock(): void;

  // 原子操作（无需手动加锁）
  getPeer(peerId: string): PeerInfo | undefined;
  setPeer(peerId: string, info: PeerInfo): void;
  hasPeer(peerId: string): boolean;
  getSize(): number;

  // 原子操作（内部自动加锁）
  async updatePeer(
    peerId: string,
    updater: (peer: PeerInfo) => PeerInfo
  ): Promise<PeerInfo | undefined>;
  async upsertPeer(
    peerId: string,
    creator: () => PeerInfo,
    updater: (peer: PeerInfo) => PeerInfo
  ): Promise<PeerInfo>;
  async deletePeer(peerId: string): Promise<boolean>;

  // 连接索引管理
  markConnected(peerId: string): void;
  markDisconnected(peerId: string): void;
  isConnected(peerId: string): boolean;
  getConnectedPeers(): PeerInfo[];
  getConnectedCount(): number;

  // 查询
  getAllPeers(): PeerInfo[];
  async getSnapshot(): Promise<Map<string, PeerInfo>>;

  // 容量检查
  isAtHighWatermark(): boolean;
  isFull(): boolean;
  getConfig(): { maxSize: number; cleanupIntervalMs: number; staleThresholdMs: number };

  // 从 AgentInfo 更新 Peer 表
  async upsertPeerFromAgentInfo(agentInfo: AgentInfo, peerId: string): Promise<void>;

  // 清理过期条目
  async cleanupStalePeers(aggressive?: boolean): Promise<void>;
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

// 添加 Peer（直接设置，无需 await）
peerTable.setPeer(peerId, {
  peerId,
  agentInfo: { id: 'agent:abc123...', name: 'Agent-001', version: '1.0.0', capabilities: [], multiaddrs: [] },
  multiaddrs: [],
  connected: false,
  reputation: 50,
  lastSeen: Date.now(),
});

// 标记为已连接
peerTable.markConnected(peerId);

// 查询
const connected = peerTable.getConnectedPeers();
const all = peerTable.getAllPeers();
const size = peerTable.getSize();

// 原子更新
await peerTable.updatePeer(peerId, (peer) => ({
  ...peer,
  lastSeen: Date.now(),
}));

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
// 直接路径导入（未导出到主包）
import { MessageDispatcher, MessageDispatcherConfig } from '@f2a/network/dist/utils/message-dispatcher.js';
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
  onDiscover?: (agentInfo: AgentInfo, peerId: string, shouldRespond: boolean) => Promise<void>;
  onDecryptFailed?: (message: F2AMessage, peerId: string) => Promise<void>;
  onFreeMessage?: (message: F2AMessage, peerId: string) => Promise<void>;
  onError?: (error: Error) => void;
  sendMessage?: (peerId: string, message: F2AMessage, encrypt: boolean) => Promise<{ success: boolean; error?: { message: string } }>;
}
```

### API

```typescript
class MessageDispatcher {
  constructor(e2eeCrypto: E2EECrypto, config?: MessageDispatcherConfig);

  // 设置本地 Peer ID
  setLocalPeerId(peerId: string): void;

  // 设置回调
  setCallbacks(callbacks: MessageDispatcherCallbacks): void;

  // 设置 Peer 表管理器
  setPeerTableManager(manager: PeerTableManager): void;

  // 停止速率限制器
  stop(): void;

  // 处理消息（已验证格式后的消息对象）
  async handleMessage(message: F2AMessage, peerId: string): Promise<void>;

  // 中间件
  useMiddleware(middleware: Middleware): void;
  removeMiddleware(name: string): boolean;
  listMiddlewares(): string[];
}
```

### 使用示例

```typescript
import { MessageDispatcher } from '@f2a/network/dist/utils/message-dispatcher.js';
import { E2EECrypto } from '@f2a/network';

const e2ee = new E2EECrypto();
const dispatcher = new MessageDispatcher(e2ee, {
  logger: new Logger({ component: 'Dispatcher' }),
  localPeerId: myPeerId,
});

dispatcher.setCallbacks({
  onDiscover: async (agentInfo, peerId, shouldRespond) => {
    if (shouldRespond) {
      // 响应发现请求
    }
  },
  onFreeMessage: async (message, peerId) => {
    // 处理自由消息
  },
});

// 处理消息
await dispatcher.handleMessage(message, peerId);
```

---

## RateLimiter

速率限制器。

### 概述

防止恶意或过量请求，支持滑动窗口算法。

### 导入

```typescript
// 从主包导入（推荐）
import { RateLimiter, createRateLimitMiddleware } from '@f2a/network';

// 或直接路径导入
import { RateLimiter } from '@f2a/network/dist/utils/rate-limiter.js';
```

### 配置

```typescript
interface RateLimitConfig {
  maxRequests: number;      // 最大请求数（必填）
  windowMs: number;         // 时间窗口（毫秒，必填）
  skipSuccessfulRequests?: boolean; // 是否跳过成功请求
  burstMultiplier?: number; // 突发容量倍数（默认 1.5）
}
```

### API

```typescript
class RateLimiter implements Disposable {
  constructor(config: RateLimitConfig);

  // 检查是否允许请求
  allowRequest(key: string): boolean;

  // 获取剩余令牌数
  getRemainingTokens(key: string): number;

  // 重置计数
  reset(key?: string): void;

  // 停止并清理资源
  stop(): void;

  // 检查是否已释放
  isDisposed(): boolean;
}
```

### 使用示例

```typescript
const limiter = new RateLimiter({
  maxRequests: 100,
  windowMs: 60000,  // 每分钟 100 次
});

// 检查
if (limiter.allowRequest(peerId)) {
  // 允许请求
  handleRequest();
} else {
  // 拒绝请求
  const remaining = limiter.getRemainingTokens(peerId);  // 0
  return error('Rate limit exceeded');
}

// 停止时释放资源
limiter.stop();
```

---

## Middleware

中间件系统。

### 概述

提供消息预处理/后处理钩子，支持链式执行。

### 导入

```typescript
// 从主包导入（推荐）
import { 
  Middleware, 
  MiddlewareContext, 
  MiddlewareResult,
  createMessageLoggingMiddleware,
  createMessageTypeFilterMiddleware
} from '@f2a/network';

// 或直接路径导入
import { MiddlewareManager } from '@f2a/network/dist/utils/middleware.js';
```

### 类型

```typescript
interface Middleware {
  /** 中间件名称 */
  name: string;
  /** 执行优先级（数字越小优先级越高，默认 0） */
  priority?: number;
  /**
   * 中间件类型
   * - 'essential': 核心中间件，异常时中断链
   * - 'optional': 可选中间件，异常时继续处理（默认）
   */
  type?: 'essential' | 'optional';
  /** 处理函数 */
  process(context: MiddlewareContext): Promise<MiddlewareResult> | MiddlewareResult;
}

interface MiddlewareContext {
  /** 消息 */
  message: F2AMessage;
  /** 发送方 Peer ID */
  peerId: string;
  /** 发送方 Agent 信息 */
  agentInfo?: AgentInfo;
  /** 中间件元数据，用于在中间件间传递数据 */
  metadata: Map<string, unknown>;
}

type MiddlewareResult =
  | { action: 'continue'; context: MiddlewareContext }  // 继续处理
  | { action: 'drop'; reason: string }                  // 丢弃消息
  | { action: 'modify'; context: MiddlewareContext };   // 修改消息后继续
```

### 使用示例

```typescript
// 创建日志中间件
const loggingMiddleware: Middleware = {
  name: 'logging',
  priority: 50,
  process(context) {
    console.log(`收到消息: ${context.message.type} from ${context.peerId}`);
    return { action: 'continue', context };
  },
};

// 创建黑名单过滤中间件
const blacklistMiddleware: Middleware = {
  name: 'BlacklistFilter',
  priority: 100, // 高优先级，尽早过滤
  type: 'essential',
  process(context) {
    if (blacklist.has(context.peerId)) {
      return { action: 'drop', reason: `Peer ${context.peerId} is blacklisted` };
    }
    return { action: 'continue', context };
  },
};

// 注册
dispatcher.useMiddleware(loggingMiddleware);
dispatcher.useMiddleware(blacklistMiddleware);
```

---

## Validation

消息和参数验证工具。

### 导入

```typescript
// 直接路径导入（未导出到主包）
import {
  validateF2AMessage,
  validateAgentCapability,
  validateTaskDelegateOptions,
} from '@f2a/network/dist/utils/validation.js';
```

### API

验证函数基于 Zod 实现，返回 `SafeParseReturnType` 结果：

```typescript
function validateF2AMessage(message: unknown): { success: boolean; data?: F2AMessage; error?: ZodError };
function validateAgentCapability(capability: unknown): { success: boolean; data?: AgentCapability; error?: ZodError };
function validateTaskDelegateOptions(options: unknown): { success: boolean; data?: TaskDelegateOptions; error?: ZodError };
function validateF2AOptions(options: unknown): { success: boolean; data?: F2AOptions; error?: ZodError };
function validateStructuredMessagePayload(payload: unknown): { success: boolean; data?: StructuredMessagePayload; error?: ZodError };
function validateWebhookConfig(config: unknown): { success: boolean; data?: WebhookConfig; error?: ZodError };
```

### 使用示例

```typescript
const result = validateF2AMessage(incomingMessage);
if (!result.success) {
  logger.warn('无效消息', result.error.errors);
  return;
}

// 验证通过后可安全访问 result.data
const message = result.data;

// 验证能力
const capResult = validateAgentCapability(capability);
if (!capResult.success) {
  throw new Error(capResult.error.errors.map(e => e.message).join(', '));
}
```

---

## ErrorUtils

错误处理工具。

### 导入

```typescript
// 从主包导入（推荐）
import { ensureError, getErrorMessage, toF2AError } from '@f2a/network';

// 或直接路径导入
import { getErrorMessage } from '@f2a/network/dist/utils/error-utils.js';
```

### API

```typescript
// 确保返回 Error 对象
function ensureError(error: unknown): Error;

// 从错误对象获取消息
function getErrorMessage(error: unknown): string;

// 创建标准化 F2AError
function toF2AError(
  code: ErrorCode,
  message: string,
  cause?: Error,
  details?: Record<string, unknown>
): F2AError;

// 从 unknown 错误创建 F2AError（自动提取原始错误消息）
function toF2AErrorFromUnknown(
  code: ErrorCode,
  message: string,
  error: unknown,
  details?: Record<string, unknown>
): F2AError;
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
// 从主包导入（推荐）
import { RequestSigner, isSignatureAvailable } from '@f2a/network';

// 或直接路径导入
import { RequestSigner } from '@f2a/network/dist/utils/signature.js';
```

### API

```typescript
interface SignatureConfig {
  secretKey: string;
  timestampTolerance?: number; // 默认 5 分钟
}

interface SignedMessage {
  payload: string;
  timestamp: number;
  signature: string;
  nonce: string;
}

class RequestSigner implements Disposable {
  constructor(config: SignatureConfig);
  sign(payload: string): SignedMessage;
  verify(message: SignedMessage): { valid: boolean; error?: string };
  dispose(): void;
  [Symbol.dispose](): void;
}

// 从环境变量加载签名配置
function loadSignatureConfig(): SignatureConfig | null;
function loadSignatureConfigSafe(): {
  success: boolean;
  config?: SignatureConfig;
  error?: string;
  warning?: string;
  isProduction: boolean;
};

// 检查签名功能是否可用
function isSignatureAvailable(): boolean;

// 生产环境强制检查
function requireSignatureInProduction(): void;
```

### 使用示例

```typescript
const signer = new RequestSigner({ secretKey: 'my-secret-key' });

const signed = signer.sign(JSON.stringify(payload));

const result = signer.verify(signed);
if (!result.valid) {
  throw new Error(`签名验证失败: ${result.error}`);
}

// 释放资源
signer.dispose();
```

---

## CryptoUtils

加密辅助工具。

### 导入

```typescript
// 从主包导入（推荐）
import { secureWipe } from '@f2a/network';

// 或直接路径导入
import { secureWipe } from '@f2a/network/dist/utils/crypto-utils.js';
```

### API

```typescript
// 验证字符串是否为有效的 Base64 格式
function isValidBase64(str: unknown): str is string;

// 安全清零 Uint8Array/Buffer
function secureWipe(data: Uint8Array | Buffer | null | undefined): void;
```

---

## CapabilityScorer

能力评分算法。

### 概述

提供各维度的能力评分计算函数，基于量化指标评估 Agent 能力。

### 导入

```typescript
// 直接路径导入（未导出到主包）
import {
  scoreComputation,
  scoreStorage,
  scoreNetwork,
  scoreSkills,
  scoreReputation,
  calculateOverallScore,
  generateCapabilityVector,
  calculateCapabilityScore,
  cosineSimilarity,
  applyDecay,
  decaySkillProficiency,
} from '@f2a/network/dist/utils/capability-scorer.js';
```

### API

```typescript
// 各维度评分（0-100）
function scoreComputation(metrics: ComputationMetrics): number;
function scoreStorage(metrics: StorageMetrics): number;
function scoreNetwork(metrics: NetworkMetrics): number;
function scoreSkills(skills: SkillTag[]): number;
function scoreReputation(metrics: ReputationMetrics): number;

// 综合评分
function calculateOverallScore(
  dimensionScores: DimensionScores,
  weights?: CapabilityWeights
): number;

// 计算完整能力评分
function calculateCapabilityScore(
  metrics: {
    computation: ComputationMetrics;
    storage: StorageMetrics;
    network: NetworkMetrics;
    skills: SkillTag[];
    reputation: ReputationMetrics;
  },
  weights?: CapabilityWeights
): CapabilityScore;

// 生成能力向量（35 维）
function generateCapabilityVector(
  dimensionScores: DimensionScores,
  skills?: SkillTag[]
): CapabilityVector;

// 余弦相似度
function cosineSimilarity(vecA: number[], vecB: number[]): number;

// 分数衰减
function applyDecay(currentScore: number, decayRate: number, daysPassed: number): number;
function decaySkillProficiency(
  proficiency: 1 | 2 | 3 | 4 | 5,
  decayRate: number,
  daysPassed: number
): 1 | 2 | 3 | 4 | 5;
```

### 使用示例

```typescript
const dimensionScores = {
  computation: scoreComputation({ cpuScore: 2000, memoryMB: 8192, concurrencyLimit: 4, throughput: 50 }),
  storage: scoreStorage({ availableGB: 500, storageType: 'ssd', readSpeedMBps: 300 }),
  network: scoreNetwork({ bandwidthMbps: 100, latencyP95Ms: 50, stability: 0.95, directConnect: true }),
  skill: scoreSkills(agent.skills),
  reputation: scoreReputation({ score: 80, totalTasks: 100, successTasks: 95, nodeAgeDays: 30, avgResponseTimeMs: 2000 }),
};

// 综合评分
const overall = calculateOverallScore(dimensionScores);

// 完整评分（含能力向量）
const score = calculateCapabilityScore(metrics);
```

---

## 相关文档

- [API 参考](./api-reference.md)
- [中间件指南](./middleware.md)
- [架构文档](../architecture/complete.md)