# RFC 005: F2A 架构统一 - MessageRouter 提升到核心层

> **Status**: Draft
> **Created**: 2026-04-15 10:22
> **Author**: Discussion with user

---

## 问题背景

### 当前架构割裂

用户指出：**本地 Agent 通信和远程 Agent 通信走的是完全不同的两套流程**，预期应该大部分流程组件复用，只有传输渠道不同。

### 代码证据

| 层级 | Peer 级别 | Agent 级别 |
|------|-----------|------------|
| **核心类** | ✅ F2A 有 | ❌ F2A 没有 |
| **路由器** | ❌ 无 | ✅ ControlServer 有 |
| **注册表** | ❌ 无 | ✅ ControlServer 有 |
| **消息流** | P2PNetwork | MessageRouter |
| **集成** | ❌ **未集成** | ❌ **未集成** |

### 演化历史

```
时间线：
─────────────────────────────────────────────────
早期设计          Agent 概念引入（2026-04-14）
    ↓                      ↓
只有 Peer 级别    添加 Agent 级别
    ↓                      ↓
F2A 核心类        MessageRouter/AgentRegistry
    ↓                      ↓
P2P 通信          但放到了 ControlServer 中！
─────────────────────────────────────────────────
```

**关键发现**：
- AgentRegistry 和 MessageRouter 是最近（2026-04-14）才加入的
- 直接放在了 ControlServer 中，而不是 F2A 核心类
- 导致 Peer 级别和 Agent 级别完全割裂

---

## 当前问题详解

### 场景 1：同一节点的 Agent 通信

```
Agent A (节点 A) → ControlServer → MessageRouter → Agent B (节点 A)
```

**流程**：
- ControlServer 接收请求
- MessageRouter 路由到本地 Agent
- 通过 callback 或 queue 传递

### 场景 2：不同节点的 Agent 通信

```
Agent A (节点 A) → ControlServer → F2A → P2PNetwork → 节点 B → F2A → emit('peer:message') → ???
```

**流程**：
- ControlServer 接收请求
- F2A.sendMessageToPeer()
- P2PNetwork 加密传输
- 对方节点 F2A emit 事件
- **❌ 没有路由到 MessageRouter！**

### 问题根源

**MessageRouter 在 ControlServer，不在 F2A 核心类**

```typescript
// 当前代码位置
packages/network/src/daemon/control-server.ts  ← MessageRouter 在这里
packages/network/src/core/f2a.ts               ← F2A 核心类，不知道 MessageRouter
packages/network/src/core/p2p-network.ts       ← P2PNetwork，不知道 Agent
```

---

## 解决方案

### 架构改进

```
┌─────────────────────────────────────────────────┐
│               F2A 核心类（统一入口）              │
│                                                  │
│  ┌─────────────┐                                │
│  │AgentRegistry│ ← 管理 Agent 注册              │
│  └─────────────┘                                │
│         ↓                                        │
│  ┌─────────────┐                                │
│  │MessageRouter│ ← 统一消息路由（核心！）        │
│  │             │                                │
│  │ route(msg)  │                                │
│  │  ↓          │                                │
│  │ 本地Agent?  │                                │
│  │ ├─ YES →    │ callback/queue                 │
│  │ └─ NO →     │ P2PNetwork.send()              │
│  └─────────────┘                                │
│         ↓                                        │
│  ┌─────────────┐                                │
│  │ P2PNetwork  │ ← 只负责传输                   │
│  │             │                                │
│  │ - 连接管理  │                                │
│  │ - E2EE加密 │                                │
│  │ - Stream发送│                                │
│  └─────────────┘                                │
└─────────────────────────────────────────────────┘
```

---

## 重构步骤

### Phase 1：提升 MessageRouter 到核心层

**移动文件**：
```bash
# 从 daemon 移到 core
mv packages/network/src/daemon/message-router.ts → packages/network/src/core/message-router.ts
mv packages/network/src/daemon/agent-registry.ts → packages/network/src/core/agent-registry.ts
```

**修改 F2A 类**：
```typescript
// packages/network/src/core/f2a.ts

class F2A {
  private agentRegistry: AgentRegistry;  ← 新增
  private messageRouter: MessageRouter;  ← 新增
  private p2pNetwork: P2PNetwork;
  
  constructor() {
    this.agentRegistry = new AgentRegistry(peerId, signData);
    this.messageRouter = new MessageRouter(this.agentRegistry);
    this.p2pNetwork = new P2PNetwork(...);
    
    // P2P 收到消息 → 路由到 MessageRouter
    this.p2pNetwork.on('message:received', (msg, peerId) => {
      this.messageRouter.route(msg);
    });
  }
  
  // 统一发送入口
  async sendMessage(fromAgentId: string, toAgentId: string, content: any) {
    const message = {
      messageId: UUID(),
      fromAgentId,
      toAgentId,
      content,
      timestamp: Date.now()
    };
    
    return this.messageRouter.route(message);
  }
}
```

---

### Phase 2：MessageRouter 集成 P2PNetwork

**添加远程路由能力**：
```typescript
// packages/network/src/core/message-router.ts

class MessageRouter {
  private agentRegistry: AgentRegistry;
  private p2pNetwork: P2PNetwork;  ← 添加 P2P 引用
  
  constructor(agentRegistry: AgentRegistry, p2pNetwork?: P2PNetwork) {
    this.agentRegistry = agentRegistry;
    this.p2pNetwork = p2pNetwork;
  }
  
  route(message: RoutableMessage): boolean {
    // 1. 验证发送方
    if (!this.agentRegistry.has(message.fromAgentId)) {
      return false;
    }
    
    // 2. 查找目标
    const target = this.agentRegistry.get(message.toAgentId);
    
    if (!target) {
      // 目标不存在本地 → 尝试远程路由
      return this.routeRemote(message);
    }
    
    // 3. 本地路由
    if (target.onMessage) {
      target.onMessage(message);
      return true;
    }
    
    // 4. 放入队列
    this.enqueue(message.toAgentId, message);
    return true;
  }
  
  private routeRemote(message: RoutableMessage): boolean {
    if (!this.p2pNetwork) {
      this.logger.warn('No P2P network, cannot route remote');
      return false;
    }
    
    // 解析 peerId from agentId
    // agent:12D3KooWHxWdn:abc123 → peerId = 12D3KooWHxWdn...
    const peerIdPrefix = message.toAgentId.split(':')[1];
    const peerId = this.findPeerIdByPrefix(peerIdPrefix);
    
    if (!peerId) {
      this.logger.warn('Peer not found for agentId', { toAgentId });
      return false;
    }
    
    // 构造 P2P 消息
    const p2pMessage = {
      id: UUID(),
      type: 'MESSAGE',
      from: this.p2pNetwork.peerId,
      to: peerId,
      timestamp: Date.now(),
      payload: {
        topic: 'agent.message',
        agentMessage: message  ← 携带完整的 Agent 消息
      }
    };
    
    // 发送（启用加密）
    const result = this.p2pNetwork.sendMessage(peerId, p2pMessage, true);
    return result.success;
  }
  
  private findPeerIdByPrefix(prefix: string): string | null {
    // 从 peerTable 或 connectedPeers 中查找
    for (const [peerId] of this.p2pNetwork.connectedPeers) {
      if (peerId.startsWith(prefix)) {
        return peerId;
      }
    }
    return null;
  }
}
```

---

### Phase 3：P2P 接收集成 MessageRouter

**修改 P2PNetwork 消息处理**：
```typescript
// packages/network/src/core/p2p-network.ts

// 收到消息时
handleIncomingMessage(message: F2AMessage, peerId: string) {
  // 解密、验证...
  
  // 分发消息
  this.dispatchMessage(message, peerId);
  
  // 发出事件
  this.emit('message:received', message, peerId);
}

// F2A 类中监听
this.p2pNetwork.on('message:received', (message, peerId) => {
  if (message.payload.topic === 'agent.message') {
    // 提取 Agent 消息
    const agentMessage = message.payload.agentMessage;
    
    // 路由到 MessageRouter
    this.messageRouter.route(agentMessage);
  } else {
    // 其他 topic 的处理
    this.emit('peer:message', {
      messageId: message.id,
      from: peerId,
      content: message.payload.content,
      topic: message.payload.topic
    });
  }
});
```

---

### Phase 4：ControlServer 简化

**ControlServer 不再直接管理 MessageRouter**：
```typescript
// packages/network/src/daemon/control-server.ts

class ControlServer {
  private f2a: F2A;  ← 只持有 F2A 引用
  // private messageRouter: MessageRouter; ← 删除
  
  constructor(f2a: F2A) {
    this.f2a = f2a;
  }
  
  // 发送消息
  async handleSend(command, res) {
    const result = await this.f2a.sendMessage(
      command.fromAgentId,
      command.toAgentId,
      command.content
    );
    
    res.writeHead(200);
    res.end(JSON.stringify(result));
  }
  
  // 注册 Agent
  handleRegisterAgent(command, res) {
    const registration = this.f2a.agentRegistry.register({
      name: command.name,
      capabilities: command.capabilities
    });
    
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, agent: registration }));
  }
}
```

---

## 重构收益

| 收益 | 说明 |
|------|------|
| **统一流程** | 本地和远程走同一套逻辑 |
| **职责清晰** | MessageRouter 负责路由，P2PNetwork 负责传输 |
| **易于测试** | 只需测试 MessageRouter.route() |
| **扩展性好** | 未来添加其他传输渠道（WebSocket、MQ）只需调用 MessageRouter |
| **代码复用** | 80% 的流程组件复用 |

---

## 统一消息流（重构后）

```
Agent A 发送消息
    ↓
┌─────────────────────────────────────┐
│ F2A.sendMessage(fromAgentId,        │
│                 toAgentId, content)  │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ MessageRouter.route(message)         │
│                                      │
│ 判断目标位置：                        │
│ ├─ 本地 Agent？                      │
│ │   ├─ YES → callback/queue         │
│ │   └─ NO → P2PNetwork.send()       │
│ └─────────────────────────────────────┘
    ↓ 本地 → 直接送达
    ↓ 远程 → P2P 传输
┌─────────────────────────────────────┐
│ 对方节点 P2PNetwork.receive()        │
│ ↓ emit('message:received')           │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 对方节点 F2A 监听事件                 │
│ ↓                                    │
│ MessageRouter.route(agentMessage)    │
│ ↓                                    │
│ 路由到目标 Agent                      │
└─────────────────────────────────────┘
    ↓
Agent B 收到消息
```

---

## 实现计划

| Phase | 时间 | 内容 |
|-------|------|------|
| **Phase 1** | Week 1 | 移动文件，F2A 添加 MessageRouter/AgentRegistry |
| **Phase 2** | Week 2 | MessageRouter 集成 P2PNetwork，添加 routeRemote |
| **Phase 3** | Week 3 | P2P 接收集成 MessageRouter，测试端到端流程 |
| **Phase 4** | Week 4 | ControlServer 简化，移除直接管理 |

---

## 测试验证

### 本地 Agent 通信测试
```typescript
// Agent A → Agent B (同一节点)
const result = await f2a.sendMessage(
  'agent:12D3KooWHxWdn:abc1',
  'agent:12D3KooWHxWdn:abc2',
  '测试消息'
);

expect(result.success).toBe(true);
expect(agentB.onMessage).toHaveBeenCalledWith(message);
```

### 远程 Agent 通信测试
```typescript
// Agent A (节点 A) → Agent B (节点 B)
const result = await f2a.sendMessage(
  'agent:12D3KooWHxWdn:abc1',
  'agent:12D3KooWDGvY6a:abc2',  // 不同节点
  '测试消息'
);

expect(result.success).toBe(true);
expect(p2pNetwork.sendMessage).toHaveBeenCalledWith(
  '12D3KooWDGvY6aL4...',
  expect.objectContaining({
    payload: { topic: 'agent.message', agentMessage: message }
  }),
  true  // encrypt
);
```

---

## 相关文档

- [RFC 003: AgentId 签发机制](./003-agentid-issuance.md)
- [RFC 004: Webhook 插件架构](./004-webhook-plugin-architecture.md)
- [SECURITY-IMPROVEMENTS.md](./SECURITY-IMPROVEMENTS.md)