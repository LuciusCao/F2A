# F2A P2P 网络实现

基于 libp2p 的 OpenClaw Agent P2P 协作网络。

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Agent                        │
│                   (通过 Adapter 集成)                     │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                      F2A SDK                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  F2A Core   │  │ P2P Network │  │ Capability Mgmt │  │
│  │  (任务委托)  │  │ (libp2p)    │  │ (能力发现)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                    libp2p 网络层                         │
│         TCP / WebSocket / MDNS / Bootstrap               │
└─────────────────────────────────────────────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 构建

```bash
npm run build
```

### 3. 运行测试

```bash
# 运行所有测试
npm test

# 运行测试并查看覆盖率
npm run test:coverage
```

### 4. 基础使用

```typescript
import { F2A } from 'f2a-network';

// 创建 F2A 节点
const f2a = await F2A.create({
  displayName: 'My OpenClaw Agent',
  agentType: 'openclaw',
  network: {
    listenPort: 9000,
    enableMDNS: true  // 本地网络自动发现
  }
});

// 启动
await f2a.start();

// 注册能力
f2a.registerCapability({
  name: 'code-generation',
  description: 'Generate code in various languages',
  tools: ['generate', 'refactor']
}, async (params) => {
  // 实际执行代码生成
  return { code: '...' };
});

// 发现网络中的 Agents
const agents = await f2a.discoverAgents('code-generation');
console.log(`Found ${agents.length} agents with code-generation capability`);

// 委托任务
const result = await f2a.delegateTask({
  capability: 'code-generation',
  description: 'Generate a Python function to calculate fibonacci',
  parameters: { language: 'python', n: 10 }
});
```

### 5. OpenClaw 集成

```typescript
import { OpenClawF2AAdapter } from 'f2a-network';

// 创建适配器
const adapter = await OpenClawF2AAdapter.create(openclawSession, {
  displayName: 'OpenClaw Node A',
  listenPort: 9000,
  enableMDNS: true
});

// 启动
await adapter.start();

// 委托任务给其他 Agent
const result = await adapter.delegateTask({
  capability: 'file-operation',
  description: 'Read and analyze /var/log/system.log'
});
```

## CLI 使用

```bash
# 查看节点状态
f2a status

# 查看已连接的 Peers
f2a peers

# 发现网络中的 Agents
f2a discover

# 按能力过滤发现
f2a discover --capability code-generation
```

## 双节点测试

### 节点 A (你的机器)

```typescript
// node-a.ts
import { F2A } from 'f2a-network';

const f2a = await F2A.create({
  displayName: 'Node A',
  network: { listenPort: 9000, enableMDNS: true }
});

await f2a.start();

// 注册能力
f2a.registerCapability({
  name: 'echo',
  description: 'Echo back the input',
  tools: ['echo']
}, async (params) => {
  return { echoed: params.message };
});

console.log('Node A started:', f2a.peerId);
```

### 节点 B (另一台机器/VPS)

```typescript
// node-b.ts
import { F2A } from 'f2a-network';

const f2a = await F2A.create({
  displayName: 'Node B',
  network: { 
    listenPort: 9000, 
    enableMDNS: true,
    // 如果 MDNS 不可用，使用引导节点
    bootstrapPeers: ['/ip4/192.168.1.100/tcp/9000/p2p/12D3KooW...']
  }
});

await f2a.start();

// 发现节点 A
const agents = await f2a.discoverAgents('echo');
console.log('Found agents:', agents);

// 发送任务给节点 A
if (agents.length > 0) {
  const result = await f2a.sendTaskTo(
    agents[0].peerId,
    'echo',
    'Echo test',
    { message: 'Hello from Node B!' }
  );
  console.log('Result:', result);
}
```

## 消息协议

### 发现广播 (DISCOVER)

```json
{
  "id": "uuid",
  "type": "DISCOVER",
  "from": "12D3KooW...",
  "timestamp": 1740982800,
  "payload": {
    "agentInfo": {
      "peerId": "12D3KooW...",
      "displayName": "Node A",
      "agentType": "openclaw",
      "version": "1.0.0",
      "capabilities": [
        { "name": "echo", "description": "...", "tools": ["echo"] }
      ],
      "protocolVersion": "f2a/1.0",
      "lastSeen": 1740982800,
      "multiaddrs": ["/ip4/192.168.1.100/tcp/9000"]
    }
  }
}
```

### 任务请求 (TASK_REQUEST)

```json
{
  "id": "task-uuid",
  "type": "TASK_REQUEST",
  "from": "12D3KooW...",
  "to": "12D3KooX...",
  "timestamp": 1740982800,
  "payload": {
    "taskId": "task-uuid",
    "taskType": "echo",
    "description": "Echo test",
    "parameters": { "message": "Hello!" },
    "timeout": 30
  }
}
```

### 任务响应 (TASK_RESPONSE)

```json
{
  "id": "uuid",
  "type": "TASK_RESPONSE",
  "from": "12D3KooX...",
  "to": "12D3KooW...",
  "timestamp": 1740982800,
  "payload": {
    "taskId": "task-uuid",
    "status": "success",
    "result": { "echoed": "Hello!" }
  }
}
```

## API 参考

### F2A 类

| 方法 | 描述 |
|------|------|
| `F2A.create(options)` | 创建实例 |
| `start()` | 启动 P2P 网络 |
| `stop()` | 停止网络 |
| `registerCapability(cap, handler)` | 注册能力 |
| `discoverAgents(capability?)` | 发现 Agents |
| `delegateTask(options)` | 委托任务 |
| `sendTaskTo(peerId, type, desc, params)` | 直接发送任务 |

### 事件

| 事件 | 描述 |
|------|------|
| `peer:discovered` | 发现新 Agent |
| `peer:connected` | Peer 连接成功 |
| `peer:disconnected` | Peer 断开连接 |
| `task:request` | 收到任务请求 |
| `task:response` | 收到任务响应 |
| `network:started` | 网络已启动 |
| `network:stopped` | 网络已停止 |

## 测试覆盖率

```bash
npm run test:coverage
```

当前覆盖率：
- 语句: ~61%
- 分支: ~87%
- 函数: ~70%

主要模块覆盖率：
- `src/index.ts`: 100%
- `src/types/index.ts`: 100%
- `src/adapters/openclaw.ts`: 95%
- `src/core/f2a.ts`: 73%
- `src/daemon/index.ts`: 98%
- `src/daemon/webhook.ts`: 97%

## 开发

### 项目结构

```
src/
├── adapters/
│   └── openclaw.ts       # OpenClaw 适配器
├── cli/
│   └── index.ts          # CLI 入口
├── core/
│   ├── f2a.ts            # F2A 主类
│   └── p2p-network.ts    # P2P 网络层
├── daemon/
│   ├── control-server.ts # HTTP 控制服务器
│   ├── index.ts          # Daemon 入口
│   └── webhook.ts        # Webhook 服务
├── types/
│   └── index.ts          # 类型定义
└── index.ts              # SDK 入口
```

### 提交规范

- `feat:` 新功能
- `fix:` 修复
- `test:` 测试
- `docs:` 文档
- `refactor:` 重构

## 路线图

- [x] 基础 P2P 网络 (libp2p)
- [x] Agent 发现与能力广播
- [x] 任务委托与响应
- [x] OpenClaw 适配器
- [x] CLI 工具
- [x] 基础测试覆盖
- [ ] 引导节点支持
- [ ] DHT 全局发现
- [ ] 端到端加密
- [ ] 信誉系统
- [ ] 多 Agent 类型支持
