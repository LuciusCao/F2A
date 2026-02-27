# F2A 无 Server 模式安全设计

## 攻击场景分析

### 场景 1: 恶意 Agent 主动连接
```
恶意 Agent C                    Agent A (受害者)
      |                              |
      |-- 直接连接 A:9000 ---------->|
      |-- 伪造身份: "我是 Agent B" -->|
      |                              |
      |-- 发送恶意消息 ------------->|
```

### 场景 2: 中间人攻击 (MITM)
```
Agent A          恶意 Agent M          Agent B
   |                  |                  |
   |-- 连接 M (以为是 B) -->|             |
   |                  |-- 连接 B (假装 A) -->|
   |                  |                  |
   |-- 密钥交换 -----&gt;|                  |
   |                  |-- 密钥交换 ----->|
   |                  |                  |
   |-- 加密消息 -----&gt;|-- 解密/篡改 ----&gt;|
```

### 场景 3: 重放攻击
```
恶意 Agent 记录合法通信，稍后重放
```

## 安全机制设计

### 1. 身份验证 (必须)

```javascript
// 连接时交换身份信息
{
  "type": "identity_challenge",
  "agentId": "uuid",
  "publicKey": "ed25519-public-key",
  "challenge": "随机数",  // 防止重放
  "timestamp": 1709000000000  // 5分钟有效期
}

// 签名响应
{
  "type": "identity_response",
  "agentId": "uuid",
  "signature": "签名(challenge + timestamp)"
}
```

### 2. 白名单机制 (推荐)

```javascript
// 只接受已配对过的 Agent 连接
const whitelist = new Set(['agent-a-uuid', 'agent-b-uuid']);

// 首次连接需要手动确认
// 类似蓝牙配对：显示对方身份，用户点击"允许"
```

### 3. 连接确认流程

```
Agent B 尝试连接 Agent A
      |
      v
Agent A 弹出确认对话框
"Agent B (设备: MacBook-Pro) 请求连接"
[允许] [拒绝]
      |
      v
  如果允许: 交换公钥，建立加密通道
  如果拒绝: 断开连接，加入黑名单
```

### 4. 加密通道 (已有)

```javascript
// ECDH 密钥交换
// AES-256-GCM 加密所有通信
// 防止窃听和篡改
```

### 5. 防重放攻击

```javascript
// 每个消息包含唯一 ID 和时间戳
{
  "type": "message",
  "id": "uuid",
  "timestamp": 1709000000000,
  "nonce": "随机数"
}

// 记录已处理的消息 ID，丢弃重复
const processedMessages = new Set();
```

### 6. 速率限制

```javascript
// 防止暴力破解和 DoS
const rateLimiter = {
  'agent-id': {
    lastRequest: timestamp,
    requestCount: 0,
    blocked: false
  }
};

// 超过 10次/分钟 自动断开
```

## 安全等级配置

```javascript
const f2a = new F2A({
  security: {
    // 等级 1: 仅加密 (信任局域网)
    level: 'low',
    
    // 等级 2: 加密 + 白名单 (推荐)
    level: 'medium',
    whitelist: ['agent-a', 'agent-b'],
    
    // 等级 3: 加密 + 手动确认 + 签名验证
    level: 'high',
    requireConfirmation: true,
    verifySignatures: true
  }
});
```

## 实现建议

### 最小安全实现 (MVP)

1. **强制加密** - 所有通信必须加密
2. **首次确认** - 新 Agent 连接需要手动确认
3. **身份签名** - 验证对方身份签名

### 完整安全实现

1. **白名单** - 只接受已知 Agent
2. **黑名单** - 自动屏蔽恶意 Agent
3. **速率限制** - 防止 DoS
4. **审计日志** - 记录所有连接和消息

## 总结

| 威胁 | 防护措施 |
|------|----------|
| 恶意连接 | 白名单 + 手动确认 |
| 身份伪造 | Ed25519 签名验证 |
| 中间人 | ECDH 密钥交换 |
| 重放攻击 | 消息 ID + 时间戳 |
| DoS | 速率限制 + 黑名单 |

无 Server 模式下，安全主要靠 **加密 + 白名单 + 手动确认** 这三层防护。
