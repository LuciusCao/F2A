# @f2a/daemon

F2A Daemon - 后台服务，提供 HTTP API 管理 Agent。

## 功能特性

- **HTTP Control Server** - 默认端口 9001，提供 RESTful API
- **Agent 注册/注销** - 管理本地和远程 Agent 实例
- **消息路由 (MessageRouter)** - Agent 间消息投递，支持本地回调、Webhook 推送、队列轮询
- **Challenge-Response 身份验证** - 安全的 Agent 身份验证机制
- **Agent Token 管理** - 会话 Token 签发与验证
- **Webhook 推送** - 支持远程 Agent 消息推送

## 安装

```bash
npm install @f2a/daemon
```

## 快速开始

### 编程方式使用

```typescript
import { F2ADaemon } from '@f2a/daemon';

// 创建 Daemon 实例
const daemon = new F2ADaemon({
  controlPort: 9001,  // HTTP API 端口（默认 9001）
  dataDir: '~/.f2a',   // 数据存储目录
  webhook: {          // 可选：全局 Webhook 配置
    url: 'https://your-webhook.com/agent',
    token: 'your-webhook-token'
  }
});

// 启动服务
await daemon.start();

console.log('Daemon started');
console.log('Peer ID:', daemon.getF2A()?.peerId);
console.log('Running:', daemon.isRunning());

// 停止服务
await daemon.stop();
```

### CLI 方式使用

```bash
# 启动 Daemon
f2ad

# 指定端口启动
f2ad --port 9002

# 指定数据目录
f2ad --data-dir /path/to/data
```

## API 文档

### 主要导出

#### `F2ADaemon`

Daemon 主类，管理后台服务。

```typescript
import { F2ADaemon, DaemonOptions } from '@f2a/daemon';

const daemon = new F2ADaemon(options?: DaemonOptions);
await daemon.start();           // 启动服务
await daemon.stop();            // 停止服务
daemon.getF2A();               // 获取 F2A 实例
daemon.isRunning();            // 检查运行状态
```

#### `ControlServer`

HTTP 控制服务器，处理 API 请求。

```typescript
import { ControlServer, ControlServerOptions } from '@f2a/daemon';

const server = new ControlServer(f2a, port, token?, options?);
await server.start();
await server.stop();
```

#### `AgentRegistry`

Agent 注册表，管理注册的 Agent。

```typescript
import { 
  AgentRegistry, 
  AgentRegistration, 
  AgentRegistrationRequest 
} from '@f2a/daemon';

const registry = new AgentRegistry(peerId);
await registry.register(request);     // 注册 Agent
await registry.unregister(agentId);   // 注销 Agent
registry.get(agentId);               // 获取 Agent 信息
registry.list();                     // 列出所有 Agent
```

#### `MessageRouter`

消息路由器，处理 Agent 间消息投递。

```typescript
import { 
  MessageRouter, 
  RoutableMessage, 
  MessageQueue 
} from '@f2a/daemon';

const router = new MessageRouter(agentRegistry);
await router.route(message);          // 路由消息
router.getQueue(agentId);            // 获取消息队列
```

#### `AgentTokenManager`

Agent Session Token 管理器。

```typescript
import { 
  AgentTokenManager, 
  AgentTokenData 
} from '@f2a/daemon';

const tokenManager = new AgentTokenManager(options);
const token = tokenManager.issueToken(agentId, metadata?);
const data = tokenManager.verifyToken(token);  // 验证 Token
```

#### `AgentIdentityStore`

Agent 身份存储，持久化 Agent 信息。

```typescript
import { AgentIdentityStore, AgentIdentity } from '@f2a/daemon';

const store = new AgentIdentityStore(dataDir);
await store.save(identity);
const identity = await store.load(agentId);
```

#### `AuthMiddleware`

认证中间件，处理 Challenge-Response 验证。

```typescript
import { AuthMiddleware, AuthResult } from '@f2a/daemon';

const auth = new AuthMiddleware(deps);
const result = await auth.authenticate(token);
```

## HTTP API 端点

Daemon 启动后，通过 HTTP API 进行交互：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/status` | GET | 获取 Daemon 状态 |
| `/agent/register` | POST | 注册 Agent |
| `/agent/unregister` | POST | 注销 Agent |
| `/agent/list` | GET | 列出已注册 Agent |
| `/message/send` | POST | 发送消息 |
| `/message/poll` | GET | 轮询消息 |
| `/p2p/connect` | POST | 连接远端节点 |
| `/p2p/peers` | GET | 获取连接的 Peers |

## 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `F2A_DAEMON_PORT` | Daemon HTTP 端口 | `9001` |
| `F2A_DATA_DIR` | 数据存储目录 | `~/.f2a` |
| `F2A_ALLOWED_ORIGINS` | CORS 允许的来源（逗号分隔） | `http://localhost` |
| `F2A_STRICT_CORS` | 严格 CORS 模式 | `false` |
| `NODE_ENV` | 环境（生产环境会启用严格 CORS 检查） | - |

## CLI 命令

通过 `@f2a/cli` 包提供的命令：

```bash
# 启动 Daemon
f2a daemon start

# 停止 Daemon
f2a daemon stop

# 查看 Daemon 状态
f2a daemon status
```

## 相关包

- **@f2a/network** - P2P 核心网络库
- **@f2a/cli** - 命令行工具

## License

MIT