# AGENTS.md — F2A 项目指南

> 本文档面向 AI Coding Agent。如果你对这个项目一无所知，从这里开始。

---

## 项目概述

**F2A (Friend-to-Agent)** 是一个基于 libp2p 的 P2P 网络协议，用于 OpenClaw AI Agents 之间的发现、通信与协作。

这是一个**实验性质项目**，代码生成、架构设计、测试编写等大量工作由 AI Agent 协作完成。仅供学习和研究目的，不建议直接用于生产环境。

项目愿景：在未来 AI Agents 成为文明一部分的场景下，F2A 提供 Agent 的协作网络和自治经济系统。

### 核心概念：Node vs Agent

| 概念 | 身份标识 | 职责 |
|------|----------|------|
| **Node** | PeerID (libp2p 自动生成) | 网络连接、消息路由、节点发现、长期运行 |
| **Agent** | AgentId (Node 签发，Ed25519 公钥指纹) | 任务执行、能力管理、信誉积累、可迁移到其他 Node |

Node 是物理节点，Agent 是业务实体。一个 Node 可以签发和管理多个 Agent。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js >= 18，ES Modules ( `"type": "module"` ) |
| 语言 | TypeScript 5.9+，严格模式 |
| P2P 网络 | libp2p (noise, yamux, TCP, mDNS, KAD-DHT, circuit-relay) |
| 前端面板 | React 18 + Vite + TailwindCSS |
| 测试框架 | Vitest (workspace 配置) |
| 数据存储 | better-sqlite3 (本地)，文件系统 (身份持久化) |
| 验证 | Zod |
| 加密 | @noble/curves, @noble/hashes (Ed25519, X25519) |

---

## Monorepo 结构

本项目使用 npm workspaces + pnpm-workspace.yaml 管理 Monorepo。

```
F2A/
├── package.json                 # 根包 @f2a/monorepo，定义 workspace scripts
├── pnpm-workspace.yaml          # workspaces: ['packages/*']
├── tsconfig.json                # 根 TS 配置，project references 到各包
├── vitest.workspace.ts          # Vitest workspace：root (node) + dashboard (jsdom)
│
├── packages/
│   ├── network/                 # @f2a/network — P2P 核心库
│   │   ├── src/
│   │   │   ├── core/            # F2A 主类、P2PNetwork、身份、消息路由、信誉系统
│   │   │   ├── types/           # 类型定义、Result<T> 错误处理模式
│   │   │   ├── config/          # 配置中心（默认值、类型、校验）
│   │   │   ├── utils/           # 日志、限流、中间件、签名工具
│   │   │   └── index.ts         # SDK 入口，导出所有公共 API
│   │   └── tests/               # 单元测试(src/**/*.test.ts) + 集成/E2E 测试
│   ├── daemon/                  # @f2a/daemon — HTTP 后台服务
│   │   └── src/
│   │       ├── control-server.ts    # HTTP API (默认端口 9001)
│   │       ├── handlers/            # REST 路由处理器
│   │       ├── middleware/auth.ts   # Bearer Token 认证
│   │       └── main.ts              # 进程入口
│   ├── cli/                     # @f2a/cli — 命令行工具
│   │   └── src/
│   │       ├── main.ts              # f2a 命令路由入口
│   │       ├── commands.ts          # 旧版命令（保留兼容）
│   │       ├── node.ts              # f2a node <sub>
│   │       ├── agents.ts            # f2a agent <sub>
│   │       ├── messages.ts          # f2a message <sub>
│   │       ├── daemon.ts            # f2a daemon <sub>
│   │       └── output.ts            # JSON/文本输出模式
│   ├── openclaw-f2a/            # @f2a/openclaw-f2a — OpenClaw 插件
│   │   └── src/
│   │       ├── plugin.ts            # 插件入口
│   │       └── types.ts             # 类型定义
│   └── dashboard/               # @f2a/dashboard — Web 可视化面板
│       └── src/
│           ├── App.tsx              # React 应用
│           ├── components/          # NetworkTopology, NodeList
│           └── hooks/               # useF2AData
│
├── skills/                      # OpenClaw Skill 定义（被插件打包分发）
│   ├── f2a-agent/               # Agent 身份管理
│   ├── f2a-node/                # 节点管理
│   ├── f2a-messaging/           # 消息发送
│   └── f2a-discover/            # Agent 发现
│
├── docs/                        # 架构文档、RFC、协议规范
│   ├── architecture/            # 架构图与说明
│   ├── protocols/               # 消息协议、mDNS 协议
│   ├── rfcs/                    # RFC 001-010 设计文档
│   └── guides/                  # API 参考、中间件指南
│
├── scripts/                     # 部署脚本
│   ├── deploy.sh, deploy-local.sh, deploy-dev.sh
│   └── test-local.sh
│
└── install.sh                   # 一键安装脚本（支持 systemd）
```

### 包依赖关系

```
@f2a/network  (核心，无内部依赖)
      ↑
      ├── @f2a/daemon
      ├── @f2a/cli          (依赖 network + daemon)
      ├── @f2a/openclaw-f2a
      └── @f2a/dashboard
```

---

## 构建与开发命令

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- 推荐 Node.js 22（CI 使用版本）

### 安装与构建

```bash
# 安装依赖
npm install

# 构建所有包
npm run build

# 构建单个包
npm run build:core      # @f2a/network
npm run build:cli       # @f2a/cli
npm run build:daemon    # @f2a/daemon
npm run build:openclaw-f2a
npm run build:dashboard

# 类型检查（lint = tsc --noEmit）
npm run lint

# 清理构建产物
npm run clean
```

### 本地开发运行

```bash
# 1. 构建
npm run build

# 2. 初始化节点
node packages/cli/dist/main.js node init

# 3. 启动 Daemon（前台调试）
node packages/cli/dist/main.js daemon foreground

# 或使用 CLI（它会通过 HTTP 与 Daemon 通信）
f2a status
f2a peers
```

### 端口分配

| 端口 | 服务 | 说明 |
|------|------|------|
| 9000 | P2P Network | libp2p 监听端口（可配置） |
| 9001 | ControlServer | HTTP API（Agent 注册/消息/状态） |
| 3000 | Dashboard | Vite 开发服务器（代理 /api 到 9001） |

---

## 测试策略

测试框架为 **Vitest**，使用 workspace 配置。

### 测试层级

1. **单元测试** (`src/**/*.test.ts`)：Mock 外部依赖，快速运行
2. **集成测试** (`tests/integration/`)：真实 P2P 网络通信测试
3. **E2E 测试** (`tests/e2e/scenarios/`)：多节点端到端场景
4. **Docker 测试** (`tests/docker/`)：容器化多节点网络测试
5. **压力测试** (`test:stress`)：10 节点并发测试

### 常用命令

```bash
# 运行所有单元测试
npm run test:unit

# 运行单个包的测试
cd packages/network && npm test

# 集成测试（真实 P2P）
npm run test:integration

# Docker 测试（3 节点）
npm run test:docker

# 压力测试（10 节点）
npm run test:stress

# 覆盖率
npm run test:coverage
```

### 覆盖率阈值（packages/network）

- statements: 60%
- branches: 55%
- functions: 65%
- lines: 60%

测试文件默认**不**计入覆盖率： `tests/`、`**/*.d.ts`、导出文件、`src/utils/benchmark.ts` 等。

### 测试配置要点

- `packages/network/vitest.config.ts`：单元测试用 `threads` 池并行运行（2-4 线程）
- `vitest.workspace.ts`：根环境为 node，dashboard 使用 jsdom
- 单元测试超时 30s，hook 超时 10s
- E2E/集成测试超时更长，通过单独命令运行

---

## 代码风格与开发约定

### 模块系统

- **纯 ESM**：所有包设置 `"type": "module"`
- 使用 `NodeNext` module resolution
- 所有 import 必须带 `.js` 扩展名（即使源文件是 `.ts`）
- 用 `fileURLToPath(import.meta.url)` 获取 `__dirname`

### TypeScript 规范

- `strict: true`
- `declaration: true`, `sourceMap: true`, `declarationMap: true`
- 每个包的 `tsconfig.json` 中 `rootDir: "./src"`, `outDir: "./dist"`
- 测试文件在 `tsconfig.json` 中被 `exclude`

### 错误处理模式

项目广泛使用 **Result<T>** 模式代替 throw：

```typescript
export interface Result<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// 使用
import { failureFromError } from '../types/index.js';
return failureFromError('NETWORK_ALREADY_RUNNING', 'F2A already running');
```

### 命名与注释

- 源码注释主要使用**中文**
- Phase/RFC 编号常用于标记架构演进阶段，如 `// Phase 1`, `// RFC 003`, `// RFC 008`
- 测试文件与源码同目录，命名 `*.test.ts`
- 类名 PascalCase，文件 kebab-case

### 日志与输出

- 核心库使用 `Logger` 工具类（`src/utils/logger.ts`）
- CLI 默认静默：非调试模式下 `F2A_LOG_LEVEL=ERROR`, `F2A_CONSOLE=false`
- 用户可通过 `F2A_DEBUG=1` 启用调试输出
- CLI 支持 `--json` 全局标志输出结构化 JSON

---

## 核心架构说明

### F2A 主类 (`packages/network/src/core/f2a.ts`)

`F2A` 是整个 SDK 的核心门面类：

- 聚合 `P2PNetwork`、`AgentRegistry`、`MessageRouter`、`MessageService`
- 管理 Node/Agent 双身份系统
- 委托 `F2AFactory.create()` 进行初始化（返回 `Result<F2A>`）
- 提供 `registerCapability()`、`discoverAgents()`、`sendMessage()` 等方法

### P2PNetwork (`packages/network/src/core/p2p-network.ts`)

基于 libp2p 的 P2P 网络管理：

- 传输：TCP + Noise 加密 + Yamux 多路复用
- 发现：mDNS（局域网）+ KAD-DHT（广域网）
- NAT 穿透：AutoNAT + DCUtR + Circuit Relay v2
- 身份：libp2p PeerID

### 身份系统 (`packages/network/src/core/identity/`)

- **NodeIdentityManager**：管理节点持久化身份（`~/.f2a/node-identity.json`）
- **AgentIdentityManager**：管理 Agent 身份（`~/.f2a/agent-identities/`）
- **Ed25519Signer**：Ed25519 签名/验签
- **IdentityDelegator**：Node 为 Agent 签发身份
- **Challenge**：Challenge-Response 认证机制
- **RFC 008**：Agent 自持有 Ed25519 密钥对，AgentId = `agent:<公钥指纹16位>`

### Daemon (`packages/daemon/`)

- `F2ADaemon` 类封装整个后台服务
- `ControlServer`：基于 Node.js HTTP 的 REST API（默认 9001 端口）
- `AgentRegistry`：管理本节点注册的 Agent
- `MessageRouter`：将入站消息路由到对应 Agent
- Webhook 推送：Agent 未本地注册时，通过 HTTP Webhook 推送消息
- 认证：Bearer Token（`F2A_CONTROL_TOKEN`）+ Challenge-Response

### CLI (`packages/cli/`)

命令结构：

```
f2a node <init|status|peers|health|discover>
f2a agent <init|register|list|unregister|status|update|verify>
f2a message <send|list|clear>
f2a daemon <start|stop|restart|status|foreground>
f2a identity <status|export|import>
```

CLI 通过 HTTP 与本地 Daemon 通信（`http://localhost:9001`），不直接操作 P2P 网络。

---

## 配置与数据目录

### 默认数据目录：`~/.f2a/`

```
~/.f2a/
├── config.json                    # 用户配置
├── node-identity.json             # 节点私钥（敏感）
├── agent-identities/
│   └── agent:<指纹>.json          # Agent 身份文件
├── f2a.log                        # 运行时日志
└── logs/                          # 详细日志目录
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `F2A_CONTROL_PORT` | 9001 | HTTP 控制端口 |
| `F2A_CONTROL_TOKEN` | 自动生成 | 认证 Token（生产环境必须设置） |
| `F2A_P2P_PORT` | 0 | P2P 端口（0=随机） |
| `F2A_AGENT_NAME` | - | Agent 显示名称 |
| `F2A_SIGNATURE_KEY` | - | 请求签名密钥 |
| `F2A_ALLOW_LOCAL_WEBHOOK` | false | 允许本地 IP webhook（开发） |
| `F2A_DEBUG` | - | 设为 1 启用 CLI 调试日志 |
| `BOOTSTRAP_PEERS` | - | 逗号分隔的引导节点地址 |

---

## 安全注意事项

> **⚠️ 实验性质项目，安全实现仍在演进中。**

1. **生产环境必须设置 `F2A_CONTROL_TOKEN`**：自动生成逻辑仅适合本地测试
2. **Agent 私钥存储**：Agent Ed25519 私钥以明文 JSON 存储在 `~/.f2a/agent-identities/`，尚无硬件密钥集成
3. **引导节点指纹验证**：配置 `bootstrapPeerFingerprints` 防止中间人攻击
4. **SSRF 保护**：生产环境默认启用 undici SSRF 保护；开发环境通过 `F2A_ALLOW_LOCAL_WEBHOOK=true` 禁用
5. **签名验证**：生产环境应启用 `verifySignatures: true`（默认）
6. **Rate Limiting**：内置请求限流，可配置 `security.rateLimit`
7. **密钥擦除**：提供 `secureWipe()` 工具函数用于内存安全擦除

---

## CI/CD 与发布

### GitHub Actions 工作流

- **`.github/workflows/ci.yml`**：PR 和 push 到 main/develop 时触发
  - unit-tests → integration-tests → docker-tests → stress-tests（main only）
- **publish-*.yml**：各包独立发布到 npm

### 发布流程

- 包独立版本号，通过 npm publish 发布
- `@f2a/cli` 提供全局 `f2a` 命令
- `@f2a/openclaw-f2a` 作为 OpenClaw 插件分发

---

## 常见开发任务

### 添加新 CLI 命令

1. 在 `packages/cli/src/` 创建/修改对应模块（如 `node.ts`）
2. 在 `main.ts` 的 switch case 中注册子命令路由
3. 添加 `showXxxHelp()` 帮助文本
4. 编写 `*.test.ts` 测试

### 修改 P2P 协议

1. 修改 `packages/network/src/core/p2p-network.ts`
2. 更新 `packages/network/src/types/` 中的类型定义
3. 确保向后兼容或标记 RFC 版本
4. 在 `tests/e2e/scenarios/` 添加端到端验证

### 修改配置默认值

所有默认值定义在 `packages/network/src/config/defaults.ts`，类型在 `packages/network/src/config/types.ts`。

### 添加新测试

- 单元测试：与源码同目录，`*.test.ts`
- 集成测试：`packages/network/tests/integration/`
- E2E 测试：`packages/network/tests/e2e/scenarios/`

---

## 相关文档索引

| 文档 | 路径 |
|------|------|
| 快速开始 | `QUICKSTART.md` |
| 完整 README | `README.md` |
| 贡献指南 | `CONTRIBUTING.md` |
| 架构概览 | `docs/architecture/overview.md` |
| 完整架构 | `docs/architecture/complete.md` |
| API 参考 | `docs/guides/api-reference.md` |
| 消息协议 | `docs/protocols/message.md` |
| RFC 文档 | `docs/rfcs/` |
| 包 README | `packages/*/README.md` |

---

*本文档基于项目实际内容生成。如有架构变更，请同步更新此文件。*
