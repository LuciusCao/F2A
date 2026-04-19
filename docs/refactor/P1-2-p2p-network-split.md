# P1-2: P2PNetwork 类拆分计划

## 当前状态
- **文件**: `packages/network/src/core/p2p-network.ts`
- **行数**: 2481 行
- **问题**: 单一类承担过多职责，难以维护和测试

---

## 拆分目标模块

### 1. AsyncLock (独立工具类)
**目标文件**: `packages/network/src/utils/async-lock.ts`
**行数**: ~52 行 (Line 110-162)
**职责**: 异步锁实现，用于保护并发资源访问
**依赖**: 无
**被依赖**: P2PNetwork.peerTableLock

**提取内容**:
```typescript
export class AsyncLock {
  private locked = false;
  private queue: Array<() => void> = [];
  async acquire(timeoutMs?: number): Promise<void>;
  release(): void;
  isLocked(): boolean;
}
```

---

### 2. PeerManager (Peer 状态管理)
**目标文件**: `packages/network/src/core/peer-manager.ts`
**行数**: ~200 行
**职责**: 
- Peer 表状态维护 (peerTable, connectedPeers, trustedPeers)
- Peer 增删改查操作
- Peer 清理/过期处理
- Peer 信任白名单管理

**依赖**: AsyncLock, Logger
**被依赖**: P2PNetwork (多个 handle/discover 方法)

**提取内容**:
```typescript
export class PeerManager {
  private peerTable: Map<string, PeerInfo>;
  private connectedPeers: Set<string>;
  private trustedPeers: Set<string>;
  private lock: AsyncLock;
  private logger: Logger;

  // 公开方法
  get(peerId: string): PeerInfo | undefined;
  list(): PeerInfo[];
  getConnected(): string[];
  isConnected(peerId: string): boolean;
  isTrusted(peerId: string): boolean;
  addTrusted(peerId: string): void;
  
  // 异步方法（需要锁）
  async upsert(peerId: string, info: Partial<PeerInfo>): Promise<void>;
  async delete(peerId: string): Promise<boolean>;
  async cleanupStale(aggressive?: boolean): Promise<void>;
  async updateFromAgentInfo(agentInfo: AgentInfo, peerId: string): Promise<void>;
}
```

**源文件对应方法**:
- Line 167-173: 成员变量 → PeerManager 属性
- Line 1870-1909: upsertPeerFromAgentInfo
- Line 1996-2120: cleanupStalePeers
- Line 2120-2167: updatePeer, upsertPeer, deletePeer

---

### 3. MessageHandler (消息处理)
**目标文件**: `packages/network/src/core/message-handler.ts`
**行数**: ~400 行
**职责**:
- 接收消息分发处理
- 各类型消息的 handle 方法
- 消息验证/解密
- 发送响应消息

**依赖**: PeerManager, E2EECrypto, Logger
**被依赖**: P2PNetwork.setupEventHandlers (注册 handler)

**提取内容**:
```typescript
export class MessageHandler {
  private peerManager: PeerManager;
  private e2eeCrypto: E2EECrypto;
  private logger: Logger;
  
  // 核心方法
  async handle(rawMessage: F2AMessage, peerId: string): Promise<void>;
  
  // 内部处理方法
  private async handleEncrypted(message: F2AMessage, peerId: string): Promise<DecryptResult>;
  private async dispatchMessage(message: F2AMessage, peerId: string): Promise<void>;
  private async handleAgentMessage(message: F2AMessage, peerId: string): Promise<void>;
  private async handleCapabilityQuery(...): Promise<void>;
  private async handleCapabilityResponse(...): Promise<void>;
  private async handleDiscoverMessage(...): Promise<void>;
  private async handleKeyExchange(...): Promise<void>;
  private async handleDecryptFailedMessage(...): Promise<void>;
}
```

**源文件对应方法**:
- Line 1304-1360: handleMessage
- Line 1360-1430: handleEncryptedMessage
- Line 1460-1495: dispatchMessage
- Line 1495-1568: handleAgentMessage
- Line 1568-1595: handleCapabilityQuery
- Line 1595-1642: handleCapabilityResponse
- Line 1642-1753: handleDiscoverMessage
- Line 1662-1685: sendPublicKey
- Line 1685-1712: handleKeyExchange
- Line 1712-1753: handleDecryptFailedMessage

---

### 4. DiscoveryService (发现服务)
**目标文件**: `packages/network/src/core/discovery-service.ts`
**行数**: ~150 行
**职责**:
- Agent 发现广播
- 发现响应处理
- Discovery 消息速率限制

**依赖**: PeerManager, RateLimiter, Logger
**被依赖**: P2PNetwork.discoverAgents

**提取内容**:
```typescript
export class DiscoveryService {
  private peerManager: PeerManager;
  private rateLimiter: RateLimiter;
  private logger: Logger;
  
  async broadcast(): Promise<void>;
  async handleDiscover(agentInfo: AgentInfo, peerId: string, shouldRespond: boolean): Promise<void>;
  async initiateDiscovery(peerId: string, multiaddrs: Multiaddr[]): Promise<void>;
}
```

**源文件对应方法**:
- Line 1753-1870: handleDiscover
- Line 819-834: broadcastDiscovery
- Line 1248-1304: initiateDiscovery

---

### 5. DHTService (DHT/Relay 服务) - 可选
**目标文件**: `packages/network/src/core/dht-service.ts`
**行数**: ~300 行
**职责**:
- DHT 节点发现
- DHT 注册
- Relay 连接

**依赖**: libp2p node, Logger
**被依赖**: P2PNetwork (可选功能)

**提取内容**:
```typescript
export class DHTService {
  private node: Libp2p;
  private logger: Logger;
  
  async findPeerViaDHT(peerId: string): Promise<Result<string[]>>;
  async discoverPeersViaDHT(options?): Promise<...>;
  async registerToDHT(): Promise<Result<void>>;
  async connectToRelay(relayAddress: string): Promise<boolean>;
}
```

**源文件对应方法**:
- Line 2241-2465: DHT 相关方法

---

## 执行顺序（含测试任务）

```
Phase 1a: 提取 AsyncLock (10分钟)
    │
    └─→ Phase 1b: 添加 async-lock.test.ts (15分钟)
        │
        └─→ Phase 2a: 提取 PeerManager (30分钟)
            │
            └─→ Phase 2b: 添加 peer-manager.test.ts (20分钟)
                │
                └─→ Phase 3a: 提取 MessageHandler (45分钟)
                    │
                    └─→ Phase 3b: 添加 message-handler.test.ts (30分钟)
                        │
                        └─→ Phase 4a: 提取 DiscoveryService (20分钟)
                            │
                            └─→ Phase 4b: 添加 discovery-service.test.ts (15分钟)
                                │
                                └─→ Phase 5a: 提取 DHTService (25分钟)
                                    │
                                    └─→ Phase 5b: 添加 dht-service.test.ts (20分钟)
                                        │
                                        └─→ Phase 6: P2PNetwork 整合 + 测试验证 (30分钟)
```

---

## 预估工作量（含测试）

| Phase | 任务 | 预估时间 | 复杂度 |
|-------|------|---------|--------|
| 1a | 提取 AsyncLock | 10分钟 | 低 |
| 1b | async-lock.test.ts | 15分钟 | 低 |
| 2a | 提取 PeerManager | 30分钟 | 中 |
| 2b | peer-manager.test.ts | 20分钟 | 中 |
| 3a | 提取 MessageHandler | 45分钟 | 高 |
| 3b | message-handler.test.ts | 30分钟 | 高 |
| 4a | 提取 DiscoveryService | 20分钟 | 中 |
| 4b | discovery-service.test.ts | 15分钟 | 中 |
| 5a | 提取 DHTService | 25分钟 | 中 |
| 5b | dht-service.test.ts | 20分钟 | 中 |
| 6 | P2PNetwork 整合 | 30分钟 | 中 |
| **总计** | | **3小时** | |

---

## 测试任务详情

### Phase 1b: async-lock.test.ts
测试用例：
- 基本获取/释放
- 并发获取排队
- 超时获取失败
- isLocked() 状态检查

### Phase 2b: peer-manager.test.ts
测试用例：
- get/list/getConnected 基础查询
- upsert 更新 Peer 信息
- delete 删除 Peer
- cleanupStale 清理过期 Peer
- trustedPeers 白名单管理
- 并发操作（锁机制验证）

### Phase 3b: message-handler.test.ts
测试用例：
- handle 消息分发
- handleEncryptedMessage 解密处理
- 'send' 事件发射验证
- handleDiscoverMessage 响应
- handleKeyExchange 密钥交换
- 错误消息处理

### Phase 4b: discovery-service.test.ts
测试用例：
- broadcast 发送发现广播
- handleDiscover 处理发现响应
- initiateDiscovery 发起发现
- RateLimiter 限制验证

### Phase 5b: dht-service.test.ts
测试用例：
- findPeerViaDHT 查找 Peer
- discoverPeersViaDHT 发现 Peers
- registerToDHT 注册到 DHT
- connectToRelay 连接中继

---

## 风险与注意事项

### 1. 循环依赖风险
- MessageHandler 需要发送消息，但 sendMessage 在 P2PNetwork
- **解决方案**: 使用回调或事件机制，MessageHandler emit 事件，P2PNetwork 监听后发送

### 2. 状态共享
- peerTable 等状态需要被多个模块访问
- **解决方案**: PeerManager 作为单一状态持有者，其他模块通过依赖注入获取

### 3. libp2p 节点引用
- sendMessage, broadcast 需要访问 libp2p node
- **解决方案**: P2PNetwork 保留 node，通过方法参数或 setter 传递给需要的服务

### 4. 事件发射
- P2PNetwork 继承 EventEmitter，handle 方法中会 emit 事件
- **解决方案**: MessageHandler 也继承 EventEmitter，事件向上传递

---

## 最终目标结构

```
packages/network/src/
├── core/
│   ├── p2p-network.ts      (~500行，整合各模块)
│   ├── peer-manager.ts     (~200行)
│   ├── message-handler.ts  (~400行)
│   ├── discovery-service.ts (~150行)
│   └── dht-service.ts      (~300行，可选)
├── utils/
│   ├── async-lock.ts       (~52行)
│   └── rate-limiter.ts     (已存在)
```

---

## 决策点

1. **Phase 5 (DHTService)**: ✅ 一并处理

2. **MessageHandler 发送消息方式**: ✅ 方案 B - 事件机制
   - MessageHandler 继承 EventEmitter
   - 发射 `send` 事件，P2PNetwork 监听处理
   - 符合 P2PNetwork 已有的 EventEmitter 模式
   - 测试更简单，解耦更好

3. **测试策略**: ✅ 每阶段添加测试任务
   - Phase 1a: 提取 AsyncLock → Phase 1b: 添加 async-lock.test.ts
   - Phase 2a: 提取 PeerManager → Phase 2b: 添加 peer-manager.test.ts
   - Phase 3a: 提取 MessageHandler → Phase 3b: 添加 message-handler.test.ts
   - Phase 4a: 提取 DiscoveryService → Phase 4b: 添加 discovery-service.test.ts
   - Phase 5a: 提取 DHTService → Phase 5b: 添加 dht-service.test.ts
   - Phase 6: P2PNetwork 整合 + 现有测试验证