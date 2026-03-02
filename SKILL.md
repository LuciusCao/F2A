---
name: f2a-network
description: Activate when the user wants to discover, connect, or communicate with other OpenClaw Agents in the local network. Use for P2P networking, messaging between agents, invoking skills on remote agents, file sharing, or group chat.
---

# F2A Agent 使用指南

F2A (Friend-to-Agent) 是一个 TypeScript 实现的 P2P 协作网络协议，让多个 OpenClaw Agent 可以直接通信，无需中央服务器。

## 安装

```bash
npm install @f2a/core
```

## 快速开始

### 1. 启动 F2A

```typescript
import { F2A } from '@f2a/core';

const f2a = await F2A.create({
  p2pPort: 9000,
  security: {
    level: 'medium',
    requireConfirmation: true
  }
});

await f2a.start();

console.log(`F2A started as ${f2a.agentId}`);
```

### 2. 监听连接请求

```typescript
f2a.on('confirmation_required', ({ agentId, address, port, confirmationId }) => {
  notifyUser(`收到连接请求: ${agentId.slice(0, 16)}... 来自 ${address}:${port}`);
});
```

### 3. 查询待确认连接

**用户说**: "f2a 待确认"

```typescript
const pending = f2a.getPendingConnections();
if (pending.length === 0) {
  tellUser("没有待确认的连接请求");
} else {
  tellUser(`待确认连接 (${pending.length}个):`);
  pending.forEach(p => {
    tellUser(`${p.index}. ${p.agentIdShort} 来自 ${p.address}:${p.port} [剩余${p.remainingMinutes}分钟]`);
  });
}
```

### 4. 确认/拒绝连接

**用户说**: "允许 1" 或 "拒绝 2"

```typescript
// 确认连接
const result = f2a.confirmConnection(1);
if (result.success) {
  tellUser("✅ 已接受连接");
} else {
  tellUser(`❌ ${result.error}`);
}

// 拒绝连接
const result = f2a.rejectConnection(2, '不认识该 Agent');
if (result.success) {
  tellUser("❌ 已拒绝连接");
}
```

### 5. 发送消息

```typescript
f2a.sendMessage(peerId, 'Hello from Agent A');
```

### 6. 监听消息

```typescript
f2a.on('message', ({ peerId, message }) => {
  if (message.type === 'message') {
    tellUser(`收到来自 ${peerId.slice(0, 16)}... 的消息: ${message.content}`);
  }
});
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `F2A_CONTROL_TOKEN` | 控制服务器认证 Token | 随机生成 |
| `F2A_CONTROL_PORT` | 控制服务器端口 | 9001 |
| `OPENCLAW_HOOK_TOKEN` | OpenClaw Webhook Token | - |

## API 参考

### F2A.create(options)

创建 F2A 实例。

```typescript
interface F2AOptions {
  p2pPort?: number;           // P2P 监听端口，默认 9000
  controlPort?: number;       // 控制服务器端口，默认 9001
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  security?: {
    level?: 'low' | 'medium' | 'high';
    requireConfirmation?: boolean;
  };
  dataDir?: string;           // 数据目录，默认 ~/.f2a
}
```

### f2a.start()

启动 F2A 服务。

### f2a.stop()

停止 F2A 服务。

### f2a.getPendingConnections()

获取待确认连接列表。

```typescript
interface PendingConnectionView {
  index: number;              // 序号
  confirmationId: string;     // 完整 ID
  shortId: string;            // 短 ID（前8位）
  agentId: string;
  agentIdShort: string;
  address: string;
  port: number;
  remainingMinutes: number;   // 剩余有效时间
  requestedAt: number;        // 请求时间戳
}
```

### f2a.confirmConnection(idOrIndex)

确认连接请求。

```typescript
// 通过序号确认
f2a.confirmConnection(1);

// 通过 ID 确认
f2a.confirmConnection('abc-123');
```

### f2a.rejectConnection(idOrIndex, reason?)

拒绝连接请求。

```typescript
f2a.rejectConnection(2, '不认识该 Agent');
```

## 事件

### confirmation_required

收到新的连接请求时触发。

```typescript
f2a.on('confirmation_required', (event) => {
  event.confirmationId;  // 请求 ID
  event.agentId;         // Agent ID
  event.address;         // 远程地址
  event.port;            // 远程端口
  event.isDuplicate;     // 是否重复请求
});
```

### peer_connected

成功连接到 Peer 时触发。

```typescript
f2a.on('peer_connected', (event) => {
  event.peerId;   // Peer Agent ID
  event.type;     // 连接类型: 'tcp' | 'webrtc'
});
```

### peer_disconnected

Peer 断开连接时触发。

```typescript
f2a.on('peer_disconnected', (event) => {
  event.peerId;
});
```

### message

收到消息时触发。

```typescript
f2a.on('message', (event) => {
  event.peerId;   // 发送方 ID
  event.message;  // 消息内容
});
```

## 安全说明

- 新连接默认需要用户确认
- 所有通信自动端到端加密
- 可配置白名单/黑名单
- 支持速率限制防 DoS

## 更多信息

- GitHub: https://github.com/LuciusCao/F2A
- 协议规范: references/protocol.md