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
┌─────────────────────────────────────────────────────────────────────┐
│                       F2A 核心 (f2a-network)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │  F2A Core   │  │ P2P Network │  │     Capability Mgmt         │  │
│  │  (任务委托)  │  │ (libp2p)    │  │     (能力发现)               │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    信誉系统 (Phase 1-4)                        │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐  │   │
│  │  │ Reputation   │ │   Review     │ │ Autonomous Economy   │  │   │
│  │  │ Manager      │ │ Committee    │ │ (信誉消耗+激励)       │  │   │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    安全与基础设施                              │   │
│  │  E2EE加密 │ 请求签名 │ 速率限制 │ 输入验证 │ 中间件 │ 日志    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────────┐
│              @f2a/openclaw-connector (可选插件)                      │
│                   OpenClaw Agent 集成                                │
└──────────────────────────────────────────────────────────────────────┘
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
| `F2A_CONTROL_TOKEN` | 自动生成 | 控制服务器认证 Token（**生产环境必须设置**）|
| `F2A_SIGNATURE_KEY` | - | 请求签名密钥（可选，启用消息签名验证）|
| `F2A_SIGNATURE_TOLERANCE` | 300000 | 签名时间戳容忍度（毫秒，默认5分钟）|
| `NODE_ENV` | - | 设置为 `production` 启用 JSON 格式日志 |

### 生产环境配置示例

```bash
# 必须设置自定义 Token
export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)

# 可选：启用请求签名验证
export F2A_SIGNATURE_KEY=$(openssl rand -hex 32)

# 生产环境日志
export NODE_ENV=production
```

## DHT 配置

F2A 使用 Kademlia DHT 实现全局节点发现。

### DHT 模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **客户端模式** (默认) | 参与 DHT 路由，但不存储数据 | 普通节点，资源受限设备 |
| **服务器模式** | 作为 DHT 服务器，存储路由表 | 长期在线的稳定节点，引导节点 |

### 配置示例

```typescript
const f2a = await F2A.create({
  displayName: 'My Agent',
  network: {
    enableDHT: true,           // 启用 DHT (默认 false)
    dhtServerMode: false,      // 客户端模式 (默认)
    bootstrapPeers: [          // 可选：引导节点加速首次连接
      '/ip4/1.2.3.4/tcp/9000/p2p/12D3KooW...'
    ]
  }
});
```

### DHT API

```typescript
// 通过 DHT 查找节点
const result = await f2a.findPeerViaDHT('target-peer-id');

// 检查 DHT 状态
f2a.isDHTEnabled();      // true/false
f2a.getDHTPeerCount();   // 路由表中的节点数
```

### 注意事项

- DHT 首次启动需要一段时间来填充路由表
- 配置 `bootstrapPeers` 可以加速初始连接
- 服务器模式需要更多带宽和存储资源

## 安全注意事项

### 1. 控制 Token（必须）

⚠️ **生产环境必须设置自定义 Token：**

```bash
export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)
```

使用默认 token 会导致启动失败。

### 2. E2EE 端到端加密（自动启用）

- 任务消息自动使用 X25519 + AES-256-GCM 加密
- 加密失败时拒绝发送，不回退到明文
- 密钥通过发现广播自动交换
- 每个会话使用独立密钥对

### 3. 请求签名验证（可选）

启用消息来源真实性验证：

```bash
export F2A_SIGNATURE_KEY=$(openssl rand -hex 32)
```

签名验证流程：
- 发送方使用 HMAC-SHA256 签名消息
- 接收方验证签名和时间戳
- 默认容忍 5 分钟时间偏差

### 4. 速率限制（自动启用）

- HTTP 控制接口：每分钟 60 请求
- 返回 429 状态码当超出限制
- 防止 DoS 攻击

### 5. 输入验证

- 所有外部输入使用 Zod 进行运行时验证
- 无效输入返回详细错误信息
- 防止注入攻击

### 6. 信誉安全机制 (Phase 3)

- 邀请制加入：新节点需要现有成员邀请
- 挑战机制：验证节点真实能力
- 签名信誉事件：防止信誉记录篡改

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

## 中间件使用

F2A 支持中间件机制，可在消息处理流程中插入自定义逻辑：

```typescript
import { 
  createMessageSizeLimitMiddleware,
  createMessageTypeFilterMiddleware 
} from 'f2a-network';

// 限制消息大小（1MB）
f2a.useMiddleware(createMessageSizeLimitMiddleware(1024 * 1024));

// 过滤消息类型
f2a.useMiddleware(
  createMessageTypeFilterMiddleware(['TASK_REQUEST', 'TASK_RESPONSE'])
);

// 自定义中间件
f2a.useMiddleware({
  name: 'MyMiddleware',
  priority: 50,
  process(context) {
    console.log('Processing:', context.message.type);
    return { action: 'continue', context };
  }
});
```

中间件操作类型：
- `continue` - 继续处理
- `drop` - 丢弃消息（安全检查失败）
- `modify` - 修改消息后继续

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
| `useMiddleware(middleware)` | 注册中间件 |
| `removeMiddleware(name)` | 移除中间件 |
| `listMiddlewares()` | 列出中间件 |

### P2PNetwork 类

| 方法 | 描述 |
|------|------|
| `signMessage(payload)` | 签名消息（需配置 F2A_SIGNATURE_KEY）|
| `verifyMessageSignature(message)` | 验证消息签名 |
| `isSignatureEnabled()` | 检查签名是否启用 |
| `findPeerViaDHT(peerId)` | 通过 DHT 查找节点 |
| `getDHTPeerCount()` | 获取 DHT 路由表大小 |
| `isDHTEnabled()` | 检查 DHT 是否启用 |

### 信誉系统 API

#### ReputationManager (Phase 1)

| 方法 | 描述 |
|------|------|
| `getReputation(peerId)` | 获取节点信誉信息 |
| `getTier(score)` | 获取信誉等级 |
| `hasPermission(peerId, permission)` | 检查权限 (publish/execute/review) |
| `recordSuccess(peerId, taskId, delta?)` | 记录任务成功 |
| `recordFailure(peerId, taskId, reason?, delta?)` | 记录任务失败 |
| `recordRejection(peerId, taskId, reason?, delta?)` | 记录任务拒绝 |
| `getHighReputationNodes(minScore?)` | 获取高信誉节点列表 |
| `getPublishPriority(peerId)` | 获取发布优先级 |
| `getPublishDiscount(peerId)` | 获取发布折扣 |

#### 信誉等级

| 分数范围 | 等级 | 发布请求 | 执行任务 | 参与评审 | 发布折扣 |
|---------|------|---------|---------|---------|---------|
| 0-20 | 受限者 | ❌ | ✅ | ❌ | - |
| 20-40 | 新手 | ✅ | ✅ | ❌ | 100% |
| 40-60 | 参与者 | ✅ | ✅ | ✅ | 100% |
| 60-80 | 贡献者 | ✅ | ✅ | ✅ | 90% |
| 80-100 | 核心成员 | ✅ | ✅ | ✅ | 70% |

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
| `message:received` | 收到消息（中间件处理前）|

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
- [x] E2EE 端到端加密
- [x] DHT 全局发现
- [x] 中间件系统
- [x] 输入验证与速率限制
- [x] 结构化日志系统
- [x] 请求签名验证
- [x] 信誉系统 Phase 1 - 基础信誉管理
- [x] 信誉系统 Phase 2 - 评审机制
- [x] 信誉系统 Phase 3 - 安全机制
- [x] 信誉系统 Phase 4 - 自治经济
- [ ] 多 Agent 类型支持
