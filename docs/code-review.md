# F2A Code Review Report

**日期**: 2026-02-28
**版本**: 0.3.1
**分支**: review/code-audit

---

## 📊 总览

| 文件 | 行数 | 评分 | 状态 |
|------|------|------|------|
| serverless.js | ~700 | B+ | 可用，有改进空间 |
| crypto.js | ~130 | A- | 设计良好 |
| p2p.js | ~170 | B | 功能完整 |
| messaging.js | ~150 | B+ | 可用 |
| skills.js | ~180 | B | 功能完整 |
| files.js | ~130 | C+ | **未完成** |
| group.js | ~200 | B+ | 设计良好 |
| webrtc.js | ~200 | B | 可用 |
| index.js | ~300 | C | **重复代码问题** |

---

## 🔴 Critical Issues (必须修复)

### 1. index.js 存在重复代码

**文件**: `skill/scripts/index.js`

文件后半部分有大量重复代码，从第 67 行开始重复了整个 F2A 类定义。这会导致：
- 后面的定义覆盖前面的
- 代码难以维护
- 可能有意外的行为

```javascript
// 第 1-65 行: F2A 类定义（简化版，无 WebRTC/加密）
// 第 67-300 行: F2A 类定义（完整版，有 WebRTC/加密）
// 后者覆盖前者！
```

**建议**: 删除重复部分，保留一个完整的类定义。

---

### 2. files.js 功能未完成

**文件**: `skill/scripts/files.js`

文件传输模块只实现了 offer/accept 握手，缺少：
- 实际的文件分块发送
- 分块接收和重组
- 断点续传逻辑
- 进度回调

```javascript
// 当前只有这些方法:
sendFile()        // 发送 offer
handleFileOffer() // 接受 offer
getTransferStatus()
cancelTransfer()
_calculateMD5()
_getFreeSpace()   // 返回假数据！

// 缺少:
// sendChunk()
// receiveChunk()
// reassembleFile()
// resumeTransfer()
```

**建议**: 完成文件传输功能，或标记为 WIP。

---

## 🟠 High Priority Issues

### 3. skills.js 缺少 crypto 引入

**文件**: `skill/scripts/skills.js` 第 14 行

```javascript
const requestId = crypto.randomUUID();  // ❌ crypto 未引入!
```

**建议**: 在文件顶部添加 `const crypto = require('crypto');`

---

### 4. 消息解析安全性问题

**文件**: `skill/scripts/serverless.js` 第 223-229 行

```javascript
_handleMessage(socket, data) {
  try {
    const message = JSON.parse(data);  // 没有 JSON 验证
    // ...
  } catch (err) {
    // 静默忽略
  }
}
```

**问题**:
- JSON.parse 可能被恶意大数据攻击
- 没有消息大小限制
- 错误被静默忽略

**建议**:
```javascript
_handleMessage(socket, data) {
  // 添加消息大小限制
  if (data.length > 1024 * 1024) {  // 1MB 限制
    console.warn('[ServerlessP2P] Message too large, ignoring');
    return;
  }
  
  try {
    const message = JSON.parse(data);
    // 验证 message 结构
    if (!message || typeof message !== 'object' || !message.type) {
      return;
    }
    // ...
  } catch (err) {
    console.warn('[ServerlessP2P] Invalid message:', err.message);
  }
}
```

---

### 5. 防重放 Set 无限增长

**文件**: `skill/scripts/serverless.js` 第 227-236 行

```javascript
if (message.id) {
  this.processedMessages.add(message.id);
  // 清理旧的消息 ID
  if (this.processedMessages.size > 10000) {
    const iterator = this.processedMessages.values();
    for (let i = 0; i < 1000; i++) {
      this.processedMessages.delete(iterator.next().value);
    }
  }
}
```

**问题**:
- Set 最多增长到 10000 才清理
- 迭代器删除方式不够优雅
- 可能导致内存问题

**建议**: 使用 LRU Cache 或定时清理机制。

---

### 6. 速率限制器无限增长

**文件**: `skill/scripts/serverless.js` 第 540-555 行

```javascript
_checkRateLimit(clientKey) {
  // rateLimiter Map 只增不减
}
```

**建议**: 添加定期清理过期记录的逻辑。

---

## 🟡 Medium Priority Issues

### 7. pendingConnections 内存泄漏风险

**文件**: `skill/scripts/serverless.js`

`pendingConnections` Map 在连接失败时可能不会被清理。

**建议**: 添加超时清理机制。

---

### 8. 缺少输入验证

**文件**: 多个文件

很多方法没有验证输入参数：

```javascript
// group.js
createGroup(name, options = {}) {
  // 没有验证 name 是否为空或类型
}

// files.js
sendFile(peerId, filePath, connection, options = {}) {
  // 没有验证 filePath 是否是绝对路径或存在路径遍历风险
}
```

**建议**: 添加参数验证和类型检查。

---

### 9. console.log 应改为可配置日志

**文件**: 所有文件

代码中大量使用 `console.log`，在生产环境可能不需要。

**建议**: 
```javascript
// 创建简单的 logger
const logger = {
  debug: process.env.F2A_DEBUG ? console.log : () => {},
  info: console.log,
  warn: console.warn,
  error: console.error
};
```

---

### 10. P2PManager 和 ServerlessP2P 功能重叠

两个模块都管理 P2P 连接：
- `p2p.js` 使用 WebSocket
- `serverless.js` 使用原生 TCP

但 `index.js` 只使用了 `ServerlessP2P`，`P2PManager` 未被使用。

**建议**: 
- 明确两个模块的使用场景
- 或合并为一个模块，支持多种传输方式

---

## 🟢 Low Priority Issues

### 11. 硬编码常量

```javascript
// serverless.js
const DISCOVERY_PORT = 8767;
const DEFAULT_P2P_PORT = 9000;
const DISCOVERY_INTERVAL = 5000;
const DISCOVERY_TIMEOUT = 15000;

// files.js
const CHUNK_SIZE = 64 * 1024;
```

**建议**: 移到配置文件或环境变量。

---

### 12. 缺少 TypeScript 类型定义

对于库项目，TypeScript 类型定义会大大提升开发体验。

**建议**: 添加 `.d.ts` 文件或迁移到 TypeScript。

---

### 13. 测试覆盖率不足

当前测试文件存在，但需要检查覆盖率。

**建议**: 添加更多单元测试和集成测试。

---

## ✅ 做得好的地方

1. **加密设计良好**: `crypto.js` 使用 X25519 + AES-256-GCM，符合现代加密最佳实践
2. **事件驱动架构**: 模块间解耦清晰
3. **安全配置灵活**: 支持 low/medium/high 三级安全模式
4. **身份验证完善**: 使用 Ed25519 签名验证
5. **代码结构清晰**: 每个模块职责单一

---

## 📋 修复优先级

| 优先级 | Issue | 影响 |
|--------|-------|------|
| 🔴 P0 | index.js 重复代码 | 可能导致功能异常 |
| 🔴 P0 | files.js 未完成 | 文件传输不可用 |
| 🟠 P1 | skills.js 缺少 crypto | 运行时错误 |
| 🟠 P1 | 消息解析安全 | 安全风险 |
| 🟡 P2 | 内存泄漏风险 | 长时间运行问题 |
| 🟡 P2 | 输入验证 | 安全风险 |
| 🟢 P3 | 日志配置 | 可维护性 |

---

## 🛠️ 建议的下一步

1. **立即修复** index.js 重复代码
2. **立即修复** skills.js 缺少 crypto 引入
3. **标记** files.js 为 WIP 或完成实现
4. **添加** 消息大小限制和输入验证
5. **考虑** 添加内存清理机制

---

*Review by Cat Guru 🐱*