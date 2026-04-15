# F2A 安全机制改进问题清单

> **创建时间**: 2026-04-15 10:01
> **来源**: 与用户讨论

---

## 问题 1: AgentId 签发机制

### 已实现 ✅
- [x] 节点生成 AgentId（用户不能自定义）
- [x] 格式规范：`agent:<PeerId前16位>:<随机8位>`
- [x] 使用 E2EE 密钥签名
- [x] 支持一个节点注册多个 Agent

### 未实现 ❌

#### P0 - 严重安全问题
1. **身份持久化缺失**
   - Agent 注册信息存储在内存 Map
   - 重启后所有 Agent 注册丢失
   - 需要重新注册，签名信息丢失
   
2. **签名验证未实现**
   - `verifySignature()` 只做格式检查
   - 不验证签名真实性
   - 无法防止 AgentId 冒充
   
3. **跨节点验证缺失**
   - 其他节点无法验证 AgentId 是否真实签发
   - 任何人可以声称自己是某个 AgentId
   - 消息协议未携带签名验证信息

#### 改进方案
- [ ] SQLite / JSON 文件持久化 Agent 注册信息
- [ ] 用 Peer 的 E2EE 公钥验证签名
- [ ] 消息协议携带签名，接收方验证
- [ ] 验证失败拒绝通信

---

## 问题 2: 消息路由机制

### 已实现 ✅
- [x] 本地消息路由（MessageRouter）
- [x] 指定目标 Agent → 直接路由
- [x] 未指定目标 → 广播给所有 Agent
- [x] 本地回调 vs 队列降级

### 未实现 ❌

#### P1 - 功能缺失
1. **远程消息路由未集成**
   - P2P 收到的消息如何路由到 MessageRouter？
   - P2P → MessageRouter 的消息传递缺失
   
2. **签名验证未集成**
   - P2P 收到消息时未验证签名
   - 未验证消息来源的真实性
   
3. **消息队列无持久化**
   - 队列在内存，重启丢失
   - 未处理的消息无法恢复
   
4. **无优先级支持**
   - 消息无优先级区分
   - 紧急消息无法优先处理

#### 改进方案
- [ ] P2P 收到消息时调用 `verifySignature()`
- [ ] P2P → MessageRouter 的消息传递集成
- [ ] SQLite 存储未处理的消息
- [ ] 添加 `priority` 字段，支持优先级

---

## 问题 3: 安全隐患汇总

| 隐患类型 | AgentId 签发 | 消息路由 |
|----------|-------------|----------|
| **身份伪造** | ❌ 可以冒充任何 AgentId | - |
| **消息伪造** | - | ❌ 未验证消息来源签名 |
| **数据丢失** | ❌ 重启丢失注册信息 | ❌ 重启丢失消息队列 |
| **跨节点验证** | ❌ 无法验证其他节点的 AgentId | ❌ 未验证远程消息签名 |

---

## 优先级排序

### 🔴 P0 - 立即修复
1. AgentId 签名验证实现（防止冒充）
2. Agent 注册信息持久化（防止丢失）

### 🟡 P1 - 近期修复
3. P2P → MessageRouter 集成
4. 消息签名验证集成
5. 消息队列持久化

### 🟢 P2 - 后续改进
6. 消息优先级支持
7. 优先级队列实现

---

## 讨论记录

**2026-04-15 10:01**
- 用户提出 AgentId 签发和消息路由的安全问题
- 记录问题清单，等待后续讨论

---

---

## 问题 4: 身份体系与签名验证

### 身份体系结构

| 层级 | 内容 | 签发方 | 格式 |
|------|------|--------|------|
| **Layer 1: PeerId** | P2P 网络节点标识 | libp2p | `12D3KooW...` |
| **Layer 2: Node Identity** | 节点身份，E2EE 密钥 | 本节点 | `nodeId` |
| **Layer 3: Agent Identity** | Agent 身份，Ed25519 密钥 | Node 签发 | `agent:xxx:yyy` |

### 当前问题

#### P0 - 签名机制问题

1. **签名机制简化（非真实签名）**
   - 当前 `signData()` 只使用 E2EE 公钥前缀 + 哈希
   - 没有使用私钥签名
   - 其他节点无法验证签名真实性
   - 可以伪造签名
   
   ```typescript
   // 当前实现（简化签名）
   signData(data: string): string {
     const hash = sha256(data);
     return `${this.e2eePublicKey.slice(0, 16)}:${hash}`;
   }
   // ❌ 这不是真正的签名！
   ```

2. **签名验证未实现**
   - `verifySignature()` 只检查格式
   - 不验证签名真实性
   - 无法防止 Agent 冒充

3. **Agent 过期机制未检查**
   - `AgentIdentity.expiresAt` 字段存在但未使用
   - 过期 Agent 仍可以发送消息

#### P1 - 非法节点处理

1. **非法节点标记未实现**
   - 节点被标记为非法后
   - 该节点签发的 Agent 未失效
   - 缺少节点信誉系统

2. **Agent 验证流程不完整**
   - 收到消息时未验证 Agent 签名
   - 未检查 Node 信誉
   - 未检查 Agent 过期时间

### 改进方案

#### 完整的签名机制

```typescript
// Node 签发 Agent 身份
signAgentIdentity(agent: AgentIdentity): string {
  // 1. 构造签名载荷
  const payload: AgentSignaturePayload = {
    id: agent.id,
    name: agent.name,
    capabilities: agent.capabilities,
    nodeId: this.nodeId,
    publicKey: agent.publicKey,
    createdAt: agent.createdAt,
    expiresAt: agent.expiresAt  // 包含过期时间
  }; 
  
  // 2. 序列化
  const payloadBytes = JSON.stringify(payload);
  
  // 3. 用 Node 的 Ed25519 私钥签名
  const signature = ed25519.sign(payloadBytes, this.nodePrivateKey);
  
  // 4. 返回 Base64 编码
  return base64Encode(signature);
}

// 其他节点验证签名
verifyAgentSignature(agent: AgentIdentity, nodePublicKey: string): boolean {
  // 1. 构造相同的签名载荷
  const payload = {
    id: agent.id,
    name: agent.name,
    capabilities: agent.capabilities,
    nodeId: agent.nodeId,
    publicKey: agent.publicKey,
    createdAt: agent.createdAt,
    expiresAt: agent.expiresAt
  }; 
  
  // 2. 用 Node 的公钥验证签名
  const isValid = ed25519.verify(
    base64Decode(agent.signature),
    JSON.stringify(payload),
    nodePublicKey
  );
  
  return isValid;
}
```

#### Agent 验证流程

```typescript
// 收到消息时验证 Agent 身份
validateAgent(agent: AgentIdentity): boolean {
  // 1. 验证签名
  const nodePublicKey = this.getNodePublicKey(agent.nodeId);
  if (!this.verifyAgentSignature(agent, nodePublicKey)) {
    this.logger.warn('Agent signature invalid', { agentId: agent.id });
    return false;
  }
  
  // 2. 检查 Agent 过期时间
  if (agent.expiresAt && new Date() > new Date(agent.expiresAt)) {
    this.logger.warn('Agent expired', { agentId: agent.id });
    return false;
  }
  
  // 3. 检查 Node 信誉（未实现）
  // const reputation = this.nodeReputation.get(agent.nodeId);
  // if (reputation?.status === 'banned') return false;
  
  return true;
}
```

#### 非法节点处理（未来实现）

```typescript
class ReputationSystem {
  private nodeReputation: Map<string, NodeReputation>;
  
  // 投票标记非法节点
  voteBanNode(nodeId: string, reason: string) {
    const votes = this.collectVotes(nodeId);
    
    if (votes.length > VOTE_THRESHOLD) {
      this.nodeReputation.set(nodeId, {
        status: 'banned',
        reason,
        bannedAt: new Date()
      });
      
      // 该节点签发的所有 Agent 失效
      this.invalidateAgentsFromNode(nodeId);
    }
  }
  
  invalidateAgentsFromNode(nodeId: string) {
    // 通知所有节点该 Node 被禁
    // 所有从该 Node 签发的 Agent 都失效
  }
}
```

### 优先级排序

#### 🔴 P0 - 立即修复
1. 实现完整的 Ed25519 签名机制
2. 实现 Agent 签名验证
3. 实现 Agent 过期时间检查

#### 🟡 P1 - 近期实现
4. 消息接收时验证 Agent 身份
5. 节点公钥分发机制（PKI 或 DHT）

#### 🟢 P2 - 后续实现
6. 节点信誉系统
7. 非法节点投票机制
8. Agent 身份撤销机制

---

## 讨论记录

**2026-04-15 10:58**
- 用户确认身份体系三层结构理解正确
- 记录签名验证、过期机制、非法节点处理等改进方案
- 节点信誉系统暂不实现，先关注签名验证

---

## 相关文档
- [RFC 003: AgentId 签发机制](./docs/rfcs/003-agentid-issuance.md)
- [RFC 005: F2A 架构统一](./docs/rfcs/005-architecture-unification.md)
- [F2A Protocol Specification](./docs/F2A-PROTOCOL.md)