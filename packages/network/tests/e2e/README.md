# F2A E2E 测试框架

## 概述

本目录包含 F2A P2P 网络的端到端（E2E）测试框架，用于验证在真实环境下的功能。

## 目录结构

```
tests/e2e/
├── e2e-test-runner.ts      # 测试运行器（可选使用）
├── test-node.ts            # 测试节点进程（TypeScript 版本，仅供参考）
├── test-node.js            # 测试节点进程（实际使用）
├── scenarios/              # 测试场景
│   ├── basic-p2p.test.ts   # 基础 P2P 通信测试
│   ├── multi-node.test.ts  # 多节点网络测试
│   └── agent-chat.test.ts  # Agent 对话测试
└── utils/                  # 工具函数
    ├── index.ts            # 导出模块
    ├── node-spawner.ts     # 节点进程管理器
    ├── message-waiter.ts   # 消息等待工具
    └── test-config.ts      # 测试配置
```

## 运行测试

### 运行所有 E2E 测试

```bash
npm run test:e2e
```

### 运行特定测试

```bash
npx vitest run tests/e2e/scenarios/basic-p2p.test.ts
npx vitest run tests/e2e/scenarios/multi-node.test.ts
npx vitest run tests/e2e/scenarios/agent-chat.test.ts
```

### 监视模式

```bash
npm run test:e2e:watch
```

## 测试场景

### 1. 基础 P2P 通信 (basic-p2p.test.ts)

- 节点启动验证
- mDNS 自动发现
- TCP 连接建立
- 双向消息传递
- 端到端加密验证

### 2. 多节点网络 (multi-node.test.ts)

- 3+ 节点组网
- 广播消息
- 消息路由
- 节点动态离开

### 3. Agent 对话 (agent-chat.test.ts)

- Agent 初始化与能力注册
- 自然语言对话
- 任务请求与执行
- Agent 元数据传递

## 测试配置

测试配置通过 `generateTestConfig()` 函数生成，包含：

- 唯一的测试运行 ID
- 随机端口分配
- 独立的数据目录
- mDNS service tag 隔离

## IPC 协议

测试运行器与测试节点之间通过 IPC 通信：

### 命令 (TestCommand)

- `start`: 启动节点
- `send`: 发送消息
- `sendTask`: 发送任务请求
- `registerCapability`: 注册能力
- `stop`: 停止节点
- `getStatus`: 获取状态
- `getConnectedPeers`: 获取连接的 peers

### 事件 (TestEvent)

- `started`: 节点已启动
- `peerDiscovered`: 发现 peer
- `peerConnected`: peer 已连接
- `messageReceived`: 收到消息
- `taskRequest`: 收到任务请求
- `taskResponse`: 收到任务响应
- `error`: 错误
- `stopped`: 节点已停止

## 超时配置

- 默认测试超时：120 秒
- 启动超时：30 秒
- 连接超时：30 秒
- 发现超时：15 秒
- 消息等待超时：10 秒

## 注意事项

1. **并行执行**：E2E 测试使用单进程模式运行，避免端口冲突
2. **数据隔离**：每次测试运行使用独立的数据目录
3. **端口分配**：使用随机端口，避免与其他测试冲突
4. **清理**：测试结束后会自动清理临时数据

## 调试

如果测试失败，可以查看节点日志：

```typescript
const node = spawner.getNode('node-0');
console.log(node.logs);
```

## CI 环境

E2E 测试可以在 CI 环境中运行，但需要注意：

- GitHub Actions 可能需要更长的超时时间
- 某些网络环境可能不支持 mDNS
- 建议在 CI 中设置 `VITEST_POOL_OPTIONS='{"forks":{"singleFork":true}}'`