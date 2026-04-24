# F2A 中间件使用指南

中间件系统允许你在消息处理流程中插入自定义逻辑，实现消息过滤、转换、日志记录等功能。

## 导入说明 (v0.6.0+)

所有中间件相关模块已导出到主包入口：

```typescript
// 内置中间件工厂函数
import {
  createMessageSizeLimitMiddleware,
  createMessageTypeFilterMiddleware,
  createMessageLoggingMiddleware,
  createMessageTransformMiddleware,
} from '@f2a/network';

// 中间件类型定义
import type { Middleware, MiddlewareContext, MiddlewareResult } from '@f2a/network';
```

## 目录

- [快速开始](#快速开始)
- [中间件概念](#中间件概念)
- [内置中间件](#内置中间件)
- [自定义中间件](#自定义中间件)
- [中间件执行顺序](#中间件执行顺序)
- [最佳实践](#最佳实践)

## 快速开始

```typescript
import { F2A, createMessageSizeLimitMiddleware } from '@f2a/network';

const f2a = await F2A.create({ displayName: 'My Agent' });

// 注册中间件 - 限制消息大小为 1MB
f2a.useMiddleware(createMessageSizeLimitMiddleware(1024 * 1024));

await f2a.start();
```

## 中间件概念

### 中间件接口

```typescript
interface Middleware {
  /** 中间件名称，用于日志和调试 */
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
```

### 中间件上下文

```typescript
interface MiddlewareContext {
  /** 原始消息 */
  message: F2AMessage;
  
  /** 发送方 Peer ID */
  peerId: string;
  
  /** 发送方 Agent 信息（可选） */
  agentInfo?: AgentInfo;
  
  /** 中间件元数据，用于在中间件间传递数据 */
  metadata: Map<string, unknown>;
}
```

### 处理结果

中间件的 `process` 方法返回三种结果之一：

```typescript
type MiddlewareResult = 
  | { action: 'continue'; context: MiddlewareContext }  // 继续处理
  | { action: 'drop'; reason: string }                  // 丢弃消息
  | { action: 'modify'; context: MiddlewareContext };   // 修改消息后继续
```

| Action | 说明 |
|--------|------|
| `continue` | 通过中间件，继续执行下一个中间件 |
| `drop` | 丢弃消息，不再处理（用于安全过滤） |
| `modify` | 修改消息内容后继续处理 |

## 内置中间件

### 消息大小限制

限制消息大小，防止过大的消息消耗资源：

```typescript
import { createMessageSizeLimitMiddleware } from '@f2a/network';

// 限制消息最大 1MB
f2a.useMiddleware(createMessageSizeLimitMiddleware(1024 * 1024));

// 限制消息最大 100KB
f2a.useMiddleware(createMessageSizeLimitMiddleware(100 * 1024));
```

### 消息类型过滤

只允许特定类型的消息通过：

```typescript
import { createMessageTypeFilterMiddleware } from '@f2a/network';

// 只允许任务请求和响应消息
f2a.useMiddleware(
  createMessageTypeFilterMiddleware(['TASK_REQUEST', 'TASK_RESPONSE'])
);

// 允许所有发现和任务相关消息
f2a.useMiddleware(
  createMessageTypeFilterMiddleware(['DISCOVER', 'TASK_REQUEST', 'TASK_RESPONSE'])
);
```

### 消息日志

记录消息处理日志，用于调试：

```typescript
import { createMessageLoggingMiddleware } from '@f2a/network';

// 使用默认日志器
f2a.useMiddleware(createMessageLoggingMiddleware());

// 使用自定义日志器
import { Logger } from '@f2a/network';
const logger = new Logger({ level: 'debug', component: 'MyLogger' });
f2a.useMiddleware(createMessageLoggingMiddleware(logger));
```

### 消息转换

在处理前修改消息内容：

```typescript
import { createMessageTransformMiddleware } from '@f2a/network';

// 添加时间戳到所有消息
f2a.useMiddleware(
  createMessageTransformMiddleware((msg) => ({
    ...msg,
    timestamp: Date.now()
  }))
);

// 过滤敏感信息
f2a.useMiddleware(
  createMessageTransformMiddleware((msg) => {
    if (msg.payload?.token) {
      msg.payload.token = '[REDACTED]';
    }
    return msg;
  })
);
```

### 速率限制

> 注：`createRateLimitMiddleware` 导出的是 HTTP 中间件，不属于消息中间件系统。消息层的速率限制由 `RateLimiter` 类在内部处理。
>
> 如需在 HTTP 层使用，请从 `@f2a/network` 导入 `createRateLimitMiddleware`：
> ```typescript
> import { createRateLimitMiddleware } from '@f2a/network';
> // 返回 (req, res, next) => void 形式的 HTTP 中间件
> ```

## 自定义中间件

### 基础示例

```typescript
import { Middleware, MiddlewareContext, MiddlewareResult } from '@f2a/network';

// 创建一个简单的日志中间件
const myLogger: Middleware = {
  name: 'MyLogger',
  priority: 50,
  process(context: MiddlewareContext): MiddlewareResult {
    console.log(`[${new Date().toISOString()}] ${context.message.type} from ${context.peerId}`);
    return { action: 'continue', context };
  }
};

f2a.useMiddleware(myLogger);
```

### 安全过滤中间件

```typescript
// 过滤来自黑名单节点的消息
function createBlacklistMiddleware(blacklist: Set<string>): Middleware {
  return {
    name: 'BlacklistFilter',
    priority: 100, // 高优先级，尽早过滤
    type: 'essential', // 核心中间件，异常时中断
    process(context: MiddlewareContext): MiddlewareResult {
      if (blacklist.has(context.peerId)) {
        return {
          action: 'drop',
          reason: `Peer ${context.peerId} is blacklisted`
        };
      }
      return { action: 'continue', context };
    }
  };
}

// 使用
const blacklist = new Set(['12D3KooW...', '12D3KooX...']);
f2a.useMiddleware(createBlacklistMiddleware(blacklist));
```

### 消息修改中间件

```typescript
// 为消息添加处理链路追踪
function createTracingMiddleware(): Middleware {
  return {
    name: 'Tracing',
    priority: 10, // 低优先级，最后执行
    process(context: MiddlewareContext): MiddlewareResult {
      const traceId = context.metadata.get('traceId') || crypto.randomUUID();
      context.metadata.set('traceId', traceId);
      
      return {
        action: 'modify',
        context: {
          ...context,
          message: {
            ...context.message,
            traceId
          }
        }
      };
    }
  };
}
```

### 异步中间件

```typescript
// 验证消息签名（需要异步操作）
function createSignatureVerificationMiddleware(): Middleware {
  return {
    name: 'SignatureVerifier',
    priority: 90,
    type: 'essential',
    async process(context: MiddlewareContext): Promise<MiddlewareResult> {
      const signature = context.message.signature;
      if (!signature) {
        return { action: 'drop', reason: 'Missing signature' };
      }
      
      // 异步验证签名
      const isValid = await verifySignature(context.message, signature);
      if (!isValid) {
        return { action: 'drop', reason: 'Invalid signature' };
      }
      
      return { action: 'continue', context };
    }
  };
}
```

## 中间件执行顺序

中间件按 `priority` 从小到大依次执行：

```
Priority: 0 ──► 50 ──► 100 ──► 1000
           │       │        │
           ▼       ▼        ▼
        [安全检查] [日志] [业务逻辑]
```

### 执行流程示例

```
消息进入
    │
    ▼
┌─────────────────────────┐
│ RateLimit (priority=80) │ ── 超限? ──► DROP
└─────────────────────────┘
    │ continue
    ▼
┌─────────────────────────┐
│ Blacklist (priority=90) │ ── 黑名单? ──► DROP
└─────────────────────────┘
    │ continue
    ▼
┌─────────────────────────┐
│ Logging (priority=100)  │
└─────────────────────────┘
    │ continue
    ▼
┌─────────────────────────┐
│ Transform (priority=10) │ ── modify
└─────────────────────────┘
    │
    ▼
消息处理完成
```

### 推荐优先级范围

| 范围 | 用途 | 示例 |
|------|------|------|
| 0-50 | 消息修改 | Transform, Enrichment |
| 50-80 | 日志、监控 | Logging, Metrics |
| 80-95 | 安全过滤 | Blacklist, Signature |
| 95-100 | 基础检查 | SizeLimit, TypeFilter |

## 中间件管理

### 查看已注册中间件

```typescript
const middlewares = f2a.listMiddlewares();
console.log('已注册的中间件:', middlewares);
// 输出: ['RateLimit', 'BlacklistFilter', 'Logging']
```

### 移除中间件

```typescript
// 按名称移除
f2a.removeMiddleware('BlacklistFilter');
```

## 最佳实践

### 1. 选择正确的优先级

```typescript
// ✅ 好的做法：安全检查优先执行
const securityMiddleware: Middleware = {
  name: 'SecurityCheck',
  priority: 100, // 高优先级
  type: 'essential',
  // ...
};

// ❌ 不好的做法：业务逻辑优先于安全检查
const businessMiddleware: Middleware = {
  name: 'BusinessLogic',
  priority: 0, // 太高了
  // ...
};
```

### 2. 使用 metadata 传递数据

```typescript
// 第一个中间件设置数据
const middleware1: Middleware = {
  name: 'SetData',
  process(context) {
    context.metadata.set('startTime', Date.now());
    return { action: 'continue', context };
  }
};

// 后续中间件读取数据
const middleware2: Middleware = {
  name: 'UseData',
  process(context) {
    const startTime = context.metadata.get('startTime') as number;
    const elapsed = Date.now() - startTime;
    console.log(`处理耗时: ${elapsed}ms`);
    return { action: 'continue', context };
  }
};
```

### 3. 合理使用 type

```typescript
// 核心安全中间件 - 异常时中断
const authMiddleware: Middleware = {
  name: 'Authentication',
  type: 'essential', // 异常时中断整个处理链
  // ...
};

// 可选的日志中间件 - 异常时继续
const loggingMiddleware: Middleware = {
  name: 'Logging',
  type: 'optional', // 异常时继续处理（默认）
  // ...
};
```

### 4. 提供有意义的 drop 原因

```typescript
// ✅ 好的做法
return {
  action: 'drop',
  reason: `Message size ${size} exceeds limit ${maxSize}`
};

// ❌ 不好的做法
return { action: 'drop', reason: 'Error' };
```

### 5. 避免副作用

中间件应该是纯函数，避免修改外部状态：

```typescript
// ❌ 避免修改外部状态
let requestCount = 0;
const badMiddleware: Middleware = {
  name: 'Counter',
  process(context) {
    requestCount++; // 副作用！
    return { action: 'continue', context };
  }
};

// ✅ 使用 metadata 存储状态
const goodMiddleware: Middleware = {
  name: 'Counter',
  process(context) {
    const count = (context.metadata.get('requestCount') as number || 0) + 1;
    context.metadata.set('requestCount', count);
    return { action: 'continue', context };
  }
};
```

## 相关文档

- [API 参考](./api-reference.md)
- [消息协议](../protocols/message.md)
- [安全指南](./security.md)