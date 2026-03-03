# F2A P2P 网络实现

> ⚠️ **EXPERIMENTAL** - 这是一个实验性项目，API 可能随时变更，不建议在生产环境使用。

基于 libp2p 的 OpenClaw Agent P2P 协作网络。

## Monorepo 结构

```
F2A/
├── packages/
│   └── openclaw-connector/     # OpenClaw 插件 (@f2a/openclaw-connector)
├── src/                         # F2A 核心网络代码
└── docs/                        # 文档
```

## 架构概览

### Monorepo 结构

```
┌─────────────────────────────────────────────────────────┐
│                    F2A 核心 (f2a-network)                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  F2A Core   │  │ P2P Network │  │ Capability Mgmt │  │
│  │  (任务委托)  │  │ (libp2p)    │  │ (能力发现)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│         @f2a/openclaw-connector (可选插件)              │
│              OpenClaw Agent 集成                         │
└─────────────────────────────────────────────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 构建

```bash
# 构建核心
npm run build

# 构建所有包（包括插件）
npm run build:all
```

### 3. 运行测试

```bash
# 运行核心测试
npm test

# 运行测试并查看覆盖率
npm run test:coverage

# 运行所有包测试
npm run test:all
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

### 5. OpenClaw 集成 (通过插件)

> 需要安装 &#96;@f2a/openclaw-connector&#96; 插件包

```bash
cd packages/openclaw-connector
npm link  # 或 npm install -g
```

然后在 OpenClaw 配置中启用：

```json
{
  "plugins": {
    "@f2a/openclaw-connector": {
      "enabled": true,
      "config": {
        "agentName": "My OpenClaw Agent",
        "autoStart": true
      }
    }
  }
}
```

插件提供的工具：
- &#96;f2a_discover&#96; - 发现网络中的 Agents
- &#96;f2a_delegate&#96; - 委托任务给特定 Agent  
- &#96;f2a_broadcast&#96; - 广播任务给多个 Agents
- &#96;f2a_status&#96; - 查看网络状态
- &#96;f2a_reputation&#96; - 管理 Peer 信誉

更多细节见 &#96;packages/openclaw-connector/README.md&#96;

## CLI 使用

### 安装 CLI

```bash
# 方式一：直接运行（需要先构建）
npm run build
node dist/cli/index.js status

# 方式二：全局链接
npm link
f2a status
```

### CLI 命令

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

## Daemon 模式

```bash
# 后台运行
node dist/daemon/index.js &

# 或使用 PM2
pm2 start dist/daemon/index.js --name f2a

# 查看 Daemon 状态
pm2 status f2a
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `F2A_CONTROL_PORT` | 9001 | HTTP 控制端口 |
| `F2A_CONTROL_TOKEN` | `f2a-default-token` | 控制服务器认证 Token |

## 安全注意事项

⚠️ **默认 `F2A_CONTROL_TOKEN` 不安全！** 生产环境请务必设置：

```bash
export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)
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
F2A/                                    # 根目录 (f2a-network)
├── packages/
│   └── openclaw-connector/             # OpenClaw 插件包
│       ├── src/
│       │   ├── index.ts                # 插件主类
│       │   ├── node-manager.ts         # Node 生命周期
│       │   ├── network-client.ts       # HTTP 客户端
│       │   ├── reputation.ts           # 信誉系统
│       │   └── ...
│       └── README.md
├── src/                                 # F2A 核心代码
│   ├── cli/                             # CLI 工具
│   ├── core/                            # 核心 P2P 网络
│   ├── daemon/                          # Daemon 服务
│   └── types/                           # 类型定义
└── docs/                                # 文档
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
