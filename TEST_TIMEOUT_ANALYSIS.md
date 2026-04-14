# F2A 测试超时问题诊断报告

## 问题诊断

### 1. 根本原因

**`autoStart` 默认值为 `true` 导致测试启动真实 P2P 网络**

在 `packages/openclaw-f2a/src/connector-helpers.ts` 第 234 行：
```typescript
autoStart: (config.autoStart as boolean) ?? true,
```

这意味着当测试中传入 `config: {}` 时，插件会自动启动真实的 libp2p P2P 网络。每个测试的启动/关闭需要数秒钟，导致整个测试套件运行时间过长。

### 2. 具体数据

- **connector.test.ts**: 28 个测试配置，只有 1 个设置了 `autoStart: false`
- **整个 openclaw-f2a 包**: 46 处设置了 `autoStart: false`，但有超过 200 处 `config: {}` 配置

### 3. 超时分析

运行测试时观察到：
- **network 包**: 约 82 秒完成（包含 E2E 测试）
- **openclaw-f2a 包**: 60 秒内未完成，被终止（exit code 143）

每个启用真实网络的测试需要：
- 启动 libp2p 节点 (~1-2 秒)
- 监听多个端口
- 启动 webhook 服务器
- 关闭时清理所有资源 (~1-2 秒)

### 4. 问题测试文件

以下测试文件有最多未设置 `autoStart: false` 的配置：

| 文件 | config:{} 数量 | autoStart:false 数量 |
|------|---------------|---------------------|
| connector.test.ts | 28 | 1 |
| connector-shutdown.test.ts | 62 | 62 |
| connector-enhanced.test.ts | 54 | 54 |
| connector-edge.test.ts | 30 | 30 |
| connector-integration.test.ts | 29 | 29 |
| connector-advanced.test.ts | 29 | 29 |
| connector-more.test.ts | 18 | 18 |

**connector.test.ts 是主要问题** - 只有 1 个测试设置了 autoStart: false

### 5. network 包的失败测试

network 包有 27 个测试失败，主要问题：
- `src/core/p2p-network.test.ts` - broadcast 测试失败
- `src/core/p2p-network.dht.test.ts` - DHT 测试有 peerId 解析错误
- `src/core/agent-registry.test.ts` - 测试失败

## 修复建议

### 方案 A：修改默认配置（推荐）

将 `autoStart` 默认值改为 `false`，让需要真实网络的测试显式启用：

```typescript
// connector-helpers.ts 第 234 行
autoStart: (config.autoStart as boolean) ?? false,  // 改为 false
```

**优点**：
- 一处修改，影响所有测试
- 测试更明确（需要真实网络的测试显式启用）
- 默认不启动网络，测试更快

**缺点**：
- 可能影响生产环境使用（需要用户显式配置 autoStart: true）

### 方案 B：批量添加 autoStart: false

为所有不需要真实网络的测试添加 `autoStart: false`：

```typescript
await plugin.initialize({
  api: mockApi as any,
  config: {
    autoStart: false,  // 添加这一行
  },
});
```

**优点**：
- 不影响生产环境
- 更精确控制

**缺点**：
- 需要修改大量测试文件

### 方案 C：增加 vitest 超时配置

在 `vitest.config.ts` 中增加超时时间：

```typescript
test: {
  testTimeout: 60000,  // 60 秒
  hookTimeout: 30000,  // 30 秒
}
```

**优点**：
- 简单快速

**缺点**：
- 测试仍然慢
- 不解决根本问题

## 推荐实施方案 A + B

1. **修改默认值**（connector-helpers.ts）
2. **为需要真实网络的测试显式设置** `autoStart: true`

需要真实网络的测试特征：
- 测试 `enable()` 后的实际网络功能
- 测试 peer 连接、消息发送等
- E2E/集成测试

## 其他发现

### daemon 包的测试失败

`src/agent-registry.test.ts` 有多个测试失败：
```
Cannot read properties of undefined (reading 'slice')
```

这可能是测试数据问题，需要单独修复。

### dashboard 包

已知有 TypeScript 编译错误，建议暂时排除其测试。

## 立即可执行的修复

### 修复 connector.test.ts

需要为以下测试添加 `autoStart: false`：

```typescript
// 第 120 行
config: { autoStart: false },

// 第 141 行
config: { minReputation: 50, autoStart: false },

// 第 238 行
config: { autoStart: false },

// 第 266 行
config: { autoStart: false },

// 第 290 行
config: { autoStart: false },

// 第 326 行
config: { autoStart: false },

// 第 452 行
config: { autoStart: false },

// 第 475 行
config: { agentName: 'TestAgent', p2pPort: 4001, autoStart: false },

// 第 591 行
config: { autoStart: false },

// 第 642 行
config: { autoStart: false },

// 第 667 行
config: { autoStart: false },
```

### 排除慢测试

可以在 vitest.config.ts 中排除某些测试：

```typescript
exclude: [
  'node_modules', 
  'dist',
  'tests/integration/**',  // 排除集成测试
  'tests/e2e/**',          // 排除 E2E 测试
]
```

## 总结

主要问题是 `autoStart` 默认为 `true`，导致大量测试启动真实 P2P 网络。建议：
1. 修改默认值为 `false`
2. 为需要真实网络的测试显式启用
3. 修复 connector.test.ts 中的所有测试配置

---

生成时间: 2026-04-14