# F2A 测试架构

## 测试层级

F2A 采用三层测试架构，遵循测试金字塔原则：

```
        ▲
       /│\        stress-tests (最少，最慢)
      / │ \
     /  │  \      docker-tests (中等)
    /   │   \
   /    │    \   integration-tests (中等)
  /     │     \
 /      │      \ unit-tests (最多，最快)
───────────────
```

## 测试类型

### 1. unit-tests（单元测试）

**目的**：测试单个函数/模块，mock 外部依赖

**运行命令**：
```bash
npm run test:unit
```

**CI 触发**：每个 PR 必跑

**特点**：
- 最快、独立、量大
- mock 网络和文件系统依赖
- 测试文件位于 `src/**/*.test.ts`

### 2. integration-tests（集成测试）

**目的**：测试真实 P2P 网络场景，验证节点间通信

**运行命令**：
```bash
npm run test:integration
```

**CI 触发**：每个 PR 必跑

**特点**：
- 使用 `NodeSpawner` 启动真实 F2A 进程
- 测试 mDNS 发现、TCP 连接、消息传递、E2EE
- 测试文件位于 `tests/e2e/scenarios/`

**测试场景**：
| 文件 | 测试内容 |
|------|---------|
| `basic-p2p.test.ts` | 基础 P2P 连接、mDNS 发现 |
| `agent-chat.test.ts` | Agent 对话场景 |
| `multi-node.test.ts` | 多节点网络 |

### 3. docker-tests（Docker 容器测试）

**目的**：在隔离的 Docker 容器中测试守护进程生命周期

**运行命令**：
```bash
npm run test:docker
```

**CI 触发**：仅 main/develop 分支 push 时

**特点**：
- 完全隔离的容器环境
- 3 个节点（1 bootstrap + 2 nodes）
- 测试守护进程启动、健康检查、API

**测试文件**：`tests/integration/`

### 4. stress-tests（压力测试）

**目的**：测试大规模 P2P 网络稳定性

**运行命令**：
```bash
npm run test:stress
```

**CI 触发**：仅 main 分支 push 时

**特点**：
- 10 个节点同时运行
- 测试网络拓扑、消息广播

## 本地开发

### 运行单个测试

```bash
# 运行单个文件
npx vitest run tests/e2e/scenarios/basic-p2p.test.ts

# 监听模式
npx vitest watch tests/e2e/scenarios/basic-p2p.test.ts
```

### 调试测试

```bash
# 使用 Node 调试器
npx vitest run --inspect tests/e2e/scenarios/basic-p2p.test.ts
```

## CI 配置

### 分支保护要求

main 分支需要以下检查通过：
- `unit-tests`
- `integration-tests`
- `docker-tests`
- `stress-tests`

### 触发策略

| 测试类型 | PR | develop push | main push |
|---------|:--:|:------------:|:---------:|
| unit-tests | ✅ | ✅ | ✅ |
| integration-tests | ✅ | ✅ | ✅ |
| docker-tests | ❌ | ✅ | ✅ |
| stress-tests | ❌ | ❌ | ✅ |

## 常见问题

### Q: 为什么 integration-tests 和 docker-tests 分开？

A: 它们测试不同层面：
- `integration-tests`：测试 P2P 协议和节点交互
- `docker-tests`：测试守护进程生命周期和容器化部署

### Q: 如何添加新的测试？

A: 根据测试类型选择目录：
- 单元测试 → `src/**/*.test.ts`
- 集成测试 → `tests/e2e/scenarios/`
- Docker 测试 → `tests/integration/`