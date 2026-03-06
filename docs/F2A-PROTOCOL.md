# F2A Protocol Specification

F2A (Federated Agent Architecture) Protocol 是 Agent 之间的通用通信协议。

## 版本

当前版本: **1.0.0**

## 消息格式

```typescript
interface F2AMessage {
  version: "1.0";
  type: MessageType;
  from: string;
  to?: string;
  timestamp: number;
  payload: unknown;
  signature?: string;
}
```

## 消息类型

- `discover` - 发现 Agents
- `announce` - 广播任务（认领模式）
- `claim` - 认领任务
- `delegate` - 明确委托
- `accept` / `reject` - 接受/拒绝委托
- `response` - 任务响应
- `review` - 评审提交
- `heartbeat` - 心跳

## 委托模式

### 1. 直接委托

```
Agent A --delegate--> Agent B --response--> Agent A
```

### 2. 广播并行

```
Agent A --delegate--> All Agents --response--> Agent A
```

### 3. 广播认领

```
Agent A --announce--> All Agents
Agent B --claim--> Agent A
Agent A --delegate--> Agent B --response--> Agent A
```

## 安全机制

- 白名单/黑名单
- 信誉系统
- 评审团（高价值任务）
- 消息签名验证
