# F2A 类型定义文档

> `src/types/` 目录下核心类型的说明

## 导入说明 (v0.6.0+)

所有类型已导出到主包入口，可直接导入：

```typescript
// 从主包导入（推荐）
import { AgentInfo, AgentCapability, F2AMessage, F2AMessageType } from '@f2a/network';
import type { Result, TaskDelegateOptions, F2AEvents } from '@f2a/network';

// Result 相关函数
import { success, failure, failureFromError } from '@f2a/network';
```

## 目录结构

```
src/types/
├── index.ts         # 核心类型统一导出
├── result.ts        # Result 类型定义
├── capability-quant.ts  # 能力量化类型
├── skill-exchange.ts    # 技能交换类型
```

---

## 核心类型

### Result<T, E>

用于处理操作成功或失败的通用类型。

```typescript
// 定义（来自 result.ts）
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

// 创建成功结果
function success<T>(value: T): Result<T>;

// 创建失败结果  
function failure<T>(error: Error): Result<T>;
function failureFromError<T>(error: unknown): Result<T>;
```

**使用示例：**

```typescript
import { success, failureFromError } from '@f2a/network';
import type { Result } from '@f2a/network';

async function connectToPeer(peerId: string): Result<void> {
  try {
    await libp2p.dial(peerId);
    return success(undefined);
  } catch (e) {
    return failureFromError(e);
  }
}

// 处理结果
const result = await connectToPeer(peerId);
if (result.ok) {
  console.log('连接成功');
} else {
  console.error('连接失败:', result.error.message);
}

// 使用 match 方法（如果可用）
result.match({
  ok: (value) => console.log('成功'),
  err: (error) => console.error(error),
});
```

---

## Agent 相关类型

### AgentInfo

Agent 的完整信息。

```typescript
interface AgentInfo {
  /** libp2p PeerID */
  peerId: string;
  
  /** 可读名称 */
  displayName?: string;
  
  /** Agent 类型 */
  agentType: 'openclaw' | 'claude-code' | 'codex' | 'custom';
  
  /** 版本 */
  version: string;
  
  /** 支持的能力列表 */
  capabilities: AgentCapability[];
  
  /** 支持的协议版本 */
  protocolVersion: string;
  
  /** 最后活跃时间（毫秒时间戳） */
  lastSeen: number;
  
  /** 网络地址列表 */
  multiaddrs: string[];
  
  /** 端到端加密公钥（base64） */
  encryptionPublicKey?: string;
  
  /** Agent ID（独立于 PeerID） */
  agentId?: string;
}
```

### AgentCapability

Agent 提供的能力定义。

```typescript
interface AgentCapability {
  /** 能力名称，如 "file-operation", "web-browsing", "code-generation" */
  name: string;
  
  /** 能力描述 */
  description: string;
  
  /** 支持的工具/操作 */
  tools: string[];
  
  /** 能力参数 schema（可选） */
  parameters?: Record<string, ParameterSchema>;
}

interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  default?: unknown;
  description?: string;
}
```

**示例：**

```typescript
const capability: AgentCapability = {
  name: 'code-generation',
  description: '生成和编辑代码',
  tools: ['write-file', 'read-file', 'execute-command'],
  parameters: {
    language: {
      type: 'string',
      required: true,
      description: '编程语言',
    },
    maxLines: {
      type: 'number',
      default: 100,
      description: '最大代码行数',
    },
  },
};
```

---

## 消息类型

### F2AMessageType

所有支持的 P2P 消息类型。

```typescript
type F2AMessageType =
  | 'DISCOVER'           // 发现广播
  | 'DISCOVER_RESP'      // 发现响应
  | 'CAPABILITY_QUERY'   // 查询能力
  | 'CAPABILITY_RESPONSE' // 能力响应
  | 'TASK_REQUEST'       // 任务请求
  | 'TASK_RESPONSE'      // 任务响应
  | 'TASK_DELEGATE'      // 任务转委托
  | 'DECRYPT_FAILED'     // 解密失败通知
  | 'PING'               // 心跳
  | 'PONG'               // 心跳响应
  | 'SKILL_ANNOUNCE'     // 技能公告
  | 'SKILL_QUERY'        // 技能查询
  | 'SKILL_QUERY_RESPONSE' // 技能查询响应
  | 'SKILL_INVOKE'       // 技能调用
  | 'SKILL_INVOKE_RESPONSE' // 技能调用响应
  | 'SKILL_RESULT'       // 技能执行结果
  | 'MESSAGE';           // Agent 自由通信
```

### F2AMessage

P2P 消息的通用结构。

```typescript
interface F2AMessage {
  /** 消息 ID（UUID） */
  id: string;
  
  /** 消息类型 */
  type: F2AMessageType;
  
  /** 发送方 PeerID */
  from: string;
  
  /** 目标 PeerID（广播可为空） */
  to?: string;
  
  /** 时间戳（毫秒） */
  timestamp: number;
  
  /** TTL（可选） */
  ttl?: number;
  
  /** 载荷（具体内容依消息类型而定） */
  payload: unknown;
}
```

---

## Payload 类型

各消息类型的具体 Payload 定义。

### DiscoverPayload

```typescript
interface DiscoverPayload {
  agentInfo: AgentInfo;
}
```

### CapabilityQueryPayload

```typescript
interface CapabilityQueryPayload {
  /** 查询特定能力，空表示查询所有 */
  capabilityName?: string;
  
  /** 查询特定工具 */
  toolName?: string;
}
```

### CapabilityResponsePayload

```typescript
interface CapabilityResponsePayload {
  agentInfo: AgentInfo;
}
```

### TaskRequestPayload

```typescript
interface TaskRequestPayload {
  /** 任务类型 */
  taskType: string;
  
  /** 任务描述 */
  description: string;
  
  /** 任务参数 */
  parameters?: Record<string, unknown>;
  
  /** 期望的响应时间（毫秒） */
  expectedResponseTime?: number;
  
  /** 任务优先级 */
  priority?: 'low' | 'normal' | 'high';
  
  /** 委托链（记录任务来源） */
  delegationChain?: string[];
}
```

### TaskResponsePayload

```typescript
interface TaskResponsePayload {
  /** 对应的请求消息 ID */
  requestId: string;
  
  /** 是否成功 */
  success: boolean;
  
  /** 结果数据（成功时） */
  result?: unknown;
  
  /** 错误信息（失败时） */
  error?: string;
  
  /** 执行时间（毫秒） */
  executionTime?: number;
}
```

### MessagePayload

自由消息 Payload。

```typescript
interface MessagePayload {
  /** 消息内容 */
  content: string;
  
  /** 消息类型 */
  messageType?: 'text' | 'json' | 'command';
  
  /** 元数据 */
  metadata?: Record<string, unknown>;
}
```

---

## 事件类型

### F2AEvents

F2A 主类发出的所有事件。

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

### NetworkStartedEvent

```typescript
interface NetworkStartedEvent {
  peerId: string;
  multiaddrs: string[];
  timestamp: number;
}
```

### PeerDiscoveredEvent

```typescript
interface PeerDiscoveredEvent {
  agentInfo: AgentInfo;
  source: 'mdns' | 'dht' | 'direct';
  timestamp: number;
}
```

### PeerConnectedEvent

```typescript
interface PeerConnectedEvent {
  peerId: string;
  agentInfo?: AgentInfo;
  timestamp: number;
}
```

### PeerDisconnectedEvent

```typescript
interface PeerDisconnectedEvent {
  peerId: string;
  reason?: string;
  timestamp: number;
}
```

### TaskRequestEvent

```typescript
interface TaskRequestEvent {
  taskId: string;
  taskType: string;
  description: string;
  fromPeerId: string;
  parameters?: Record<string, unknown>;
  timestamp: number;
}
```

### TaskResponseEvent

```typescript
interface TaskResponseEvent {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  fromPeerId: string;
  timestamp: number;
}
```

---

## 配置类型

配置类型从主包导入：

```typescript
// 从主包导入（推荐）
import type {
  SecurityLevel,
  LogLevel,
  P2PNetworkConfig,
  SecurityConfig,
  F2AOptions,
  WebhookConfig,
  TaskDelegateOptions,
  RateLimitConfig,
} from '@f2a/network';

// 导出默认配置值
import {
  DEFAULT_P2P_NETWORK_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_F2A_OPTIONS,
} from '@f2a/network';
```

---

## 任务委托类型

### TaskDelegateOptions

```typescript
interface TaskDelegateOptions {
  /** 任务类型 */
  taskType: string;
  
  /** 任务描述 */
  description: string;
  
  /** 任务参数 */
  parameters?: Record<string, unknown>;
  
  /** 目标 Peer ID（可选，不指定则广播） */
  targetPeerId?: string;
  
  /** 超时时间（毫秒） */
  timeout?: number;
  
  /** 重试次数 */
  retries?: number;
  
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  
  /** 最小信誉分要求 */
  minReputation?: number;
}
```

### TaskDelegateResult

```typescript
interface TaskDelegateResult {
  /** 任务 ID */
  taskId: string;
  
  /** 执行者 Peer ID */
  executorPeerId: string;
  
  /** 是否成功 */
  success: boolean;
  
  /** 结果数据 */
  result?: unknown;
  
  /** 错误信息 */
  error?: string;
  
  /** 执行时间 */
  executionTime?: number;
}
```

---

## 技能交换类型

详见 `src/types/skill-exchange.ts`。

```typescript
interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  inputs: SkillInput[];
  outputs: SkillOutput[];
  cost: SkillCost;
}
```

---

## 能力量化类型

详见 `src/types/capability-quant.ts`。

用于计算能力匹配度和技能定价。

---

## 类型守卫

验证特定类型的辅助函数：

```typescript
// 检查是否为 AgentInfo
function isAgentInfo(value: unknown): value is AgentInfo;

// 检查是否为 F2AMessage  
function isF2AMessage(value: unknown): value is F2AMessage;

// 检查是否为加密消息
function isEncryptedMessage(msg: F2AMessage): msg is EncryptedF2AMessage;
```

---

## 相关文档

- [API 参考](api/API-REFERENCE.md)
- [配置中心](../src/config/README.md)
- [架构文档](architecture-complete.md)