# F2A 借鉴 A2A 协议的设计改进

> 本文档记录从 Google A2A (Agent2Agent) 协议中可以借鉴的设计思路，用于改进 F2A 协议。

---

## 1. Agent Card 概念

### 现状
当前 F2A 的发现消息仅包含基础信息：
```javascript
{
  type: 'F2A_DISCOVER',
  agentId: 'xxx',
  publicKey: 'xxx',
  port: 9000
}
```

### 借鉴 A2A 的改进
将发现消息扩展为包含更多元数据，类似 A2A 的 Agent Card：
```javascript
{
  type: 'F2A_DISCOVER',
  agentId: 'xxx',
  publicKey: 'xxx',
  port: 9000,
  displayName: 'WeatherAgent',
  capabilities: ['chat', 'file_transfer', 'skill_invocation'],
  skills: [
    { 
      name: 'weather', 
      description: 'Get weather info for a location',
      parameters: {
        location: { type: 'string', required: true },
        units: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'celsius' }
      }
    },
    { 
      name: 'translate', 
      description: 'Translate text between languages' 
    }
  ],
  authentication: {
    requireConfirmation: true,
    securityLevel: 'medium'
  }
}
```

### 好处
- **能力发现**: 其他 Agent 可以在连接前了解你能做什么
- **动态协商**: 支持交互模式的协商（文本、文件、结构化数据）
- **自描述**: 减少人工配置，实现真正的即插即用

---

## 2. 任务生命周期管理

### 现状
F2A 目前只有简单的消息发送，缺乏任务状态跟踪：
```javascript
p2p.sendToPeer(peerId, {
  type: 'message',
  content: '...'
});
```

### 借鉴 A2A 的改进
引入 A2A 的任务状态机模型：
```
submitted → working → input-required → completed
                    ↓
                failed / canceled
```

### 实现示例
```javascript
// 发送任务
const taskId = await p2p.sendTask(peerId, {
  skill: 'weather',
  parameters: { location: 'Beijing' }
});

// 任务状态流转
p2p.on('task_update', ({ taskId, status, artifact }) => {
  switch (status) {
    case 'working':
      console.log(`任务 ${taskId} 处理中...`);
      break;
    case 'input-required':
      // 需要用户提供额外信息
      console.log(`需要更多信息: ${artifact.description}`);
      break;
    case 'completed':
      console.log(`任务完成: ${artifact.content}`);
      break;
    case 'failed':
      console.log(`任务失败: ${artifact.error}`);
      break;
  }
});

// 取消任务
await p2p.cancelTask(peerId, taskId);

// 查询任务状态
const task = await p2p.getTask(peerId, taskId);
```

### 好处
- **长任务支持**: 适合需要长时间运行的任务
- **人机协作**: 支持 human-in-the-loop 场景
- **可观测性**: 可以跟踪任务进度和状态
- **容错性**: 支持任务取消和失败处理

---

## 3. 标准化消息格式

### 现状
F2A 使用简单的 JSON 消息，缺乏严格的结构定义：
```javascript
{
  type: 'message',
  content: '...'
}
```

### 借鉴 A2A 的改进
参考 A2A 的 Protocol Buffer 定义，设计更严格的 JSON Schema：

#### 3.1 消息结构标准化
```javascript
// 基础消息结构
{
  // 协议元数据
  "protocol": {
    "name": "F2A",
    "version": "1.0.0"
  },
  
  // 消息元数据
  "meta": {
    "messageId": "uuid",
    "timestamp": 1700000000000,
    "senderId": "f2a-xxx-xxx",
    "correlationId": "uuid"  // 用于关联请求和响应
  },
  
  // 消息负载
  "payload": {
    "type": "task_request",  // task_request | task_response | notification | etc.
    "data": { ... }
  },
  
  // 扩展字段
  "extensions": {
    "customField": "value"
  }
}
```

#### 3.2 Part 结构（内容单元）
借鉴 A2A 的 Part 概念，统一内容表示：
```javascript
// 文本
{ "type": "text", "content": "Hello" }

// 文件
{ 
  "type": "file", 
  "filename": "report.pdf",
  "mimeType": "application/pdf",
  "size": 1024000,
  "fileId": "uuid"  // 引用文件传输系统的 ID
}

// 结构化数据
{ 
  "type": "data", 
  "mimeType": "application/json",
  "content": { "temperature": 25, "unit": "celsius" }
}

// 表单/输入请求
{
  "type": "form",
  "fields": [
    { "name": "location", "type": "text", "required": true },
    { "name": "units", "type": "select", "options": ["C", "F"] }
  ]
}
```

#### 3.3 版本兼容性处理
```javascript
{
  "protocol": {
    "name": "F2A",
    "version": "1.1.0",  // 发送方版本
    "minCompatibleVersion": "1.0.0"  // 最低兼容版本
  },
  
  // 接收方如果不支持某个字段，可以安全忽略
  "payload": {
    "type": "task_request",
    "data": { ... },
    "deprecatedField": "..."  // 标记废弃的字段
  }
}
```

#### 3.4 扩展机制
```javascript
{
  "payload": {
    "type": "task_request",
    "data": { ... }
  },
  
  // 厂商/应用特定扩展
  "extensions": {
    "com.example.customFeature": { ... },
    "org.f2a.streaming": { "enabled": true }
  }
}
```

### 好处
- **互操作性**: 严格的结构定义确保不同实现能正确通信
- **向前兼容**: 版本机制支持平滑升级
- **可扩展性**: 扩展机制允许自定义功能而不破坏核心协议
- **类型安全**: 明确的字段类型减少解析错误

---

## 实施建议

### 优先级
1. **高**: Agent Card - 立即提升发现机制的能力
2. **中**: 任务生命周期 - 支持更复杂的协作场景
3. **低**: 消息格式标准化 - 在需要与其他系统集成时实施

### 向后兼容
- 新字段使用可选（optional）方式添加
- 保留旧版发现消息解析支持
- 版本协商机制：连接时交换支持的协议版本

---

## 参考

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A GitHub Repository](https://github.com/a2aproject/A2A)
