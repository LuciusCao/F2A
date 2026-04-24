# @f2a/dashboard

> F2A Dashboard — F2A P2P 网络可视化监控面板

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 概述

`@f2a/dashboard` 是 F2A（Friend-to-Agent）P2P 网络的 Web 可视化监控面板。基于 React 18 + TypeScript + Tailwind CSS 构建，提供实时的网络拓扑视图、节点状态监控和能力展示。

## 功能特性

### 网络拓扑可视化

- **SVG 拓扑图** — 以圆形布局展示本地节点与远程 Peer 的连接关系
- **连接状态** — 实线表示本地节点，虚线表示远程连接
- **节点统计** — 实时显示总节点数和已连接 Peer 数

### 节点列表

- **详细信息** — PeerID、IP 地址、连接状态、最后活跃时间
- **Agent 类型** — 显示节点类型（openclaw / custom 等）
- **能力标签** — 展示每个节点注册的 Agent 能力

### 网络能力概览

- **能力卡片** — 以卡片形式展示全网 Agent 的能力分布
- **工具标签** — 显示每个能力支持的工具列表
- **来源标识** — 标注能力来自哪个 Peer

### 实时监控

- **自动刷新** — 每 5 秒自动刷新数据
- **连接状态指示** — 顶部状态栏显示与 Daemon 的连接状态
- **手动刷新** — 支持手动点击刷新按钮

### 安全认证

- **Token 认证** — 通过 F2A Control Token 访问受保护端点
- **本地存储** — Token 保存在 localStorage 中，避免重复输入
- **未授权提示** — 当 Token 无效或缺失时显示认证界面

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| React | ^18.2.0 | UI 框架 |
| TypeScript | ^5.9.3 | 类型系统 |
| Vite | ^6.2.0 | 构建工具 |
| Tailwind CSS | ^3.4.0 | CSS 框架 |
| Vitest | ^1.6.1 | 测试框架 |

## 安装

```bash
npm install @f2a/dashboard
```

## 开发运行

### 前置条件

- F2A Daemon 正在运行（默认端口 9001）
- Node.js >= 18

### 启动开发服务器

```bash
# 安装依赖
npm install

# 启动开发服务器（带 API 代理）
npm run dev
```

开发服务器默认在 `http://localhost:3000` 启动，并代理 `/api` 请求到 `http://localhost:9001`。

### 构建生产版本

```bash
npm run build
```

构建产物输出到 `dist/` 目录。

### 预览生产构建

```bash
npm run preview
```

## 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_URL` | `/api` | F2A Control Server API URL |

### 开发环境代理

在 `vite.config.ts` 中配置了开发代理：

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:9001',
      changeOrigin: true,
    }
  }
}
```

### 认证

Dashboard 需要 F2A Control Token 才能访问受保护端点（`/status`、`/peers`）：

1. 从 F2A 配置中获取 Token：
   ```bash
   cat ~/.f2a/config.json | jq .controlToken
   ```

2. 在 Dashboard UI 中输入 Token

3. Token 会自动保存到浏览器 localStorage

## 项目结构

```
src/
├── App.tsx                    # 主应用组件
├── main.tsx                   # 应用入口
├── index.css                  # 全局样式
├── types.ts                   # TypeScript 类型定义
├── vite-env.d.ts             # Vite 环境类型
├── components/
│   ├── NetworkTopology.tsx   # 网络拓扑图组件
│   ├── NetworkTopology.test.tsx
│   ├── NodeList.tsx          # 节点列表组件
│   └── NodeList.test.tsx
├── hooks/
│   ├── useF2AData.ts         # F2A 数据获取 Hook
│   └── useF2AData.test.ts
└── test/
    └── setup.ts              # 测试配置
```

## API 端点

Dashboard 连接到 F2A Control Server：

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/health` | GET | 否 | 健康检查 |
| `/status` | GET | Bearer Token | 节点状态（PeerID、监听地址） |
| `/peers` | GET | Bearer Token | 已连接的 Peers 列表 |

## 部署方式

### 方式一：独立部署（开发调试）

```bash
# 启动 F2A Daemon
f2a daemon start

# 启动 Dashboard（带代理）
npm run dev
```

访问 `http://localhost:3000`

### 方式二：嵌入 Daemon 部署

构建后的 Dashboard 可以嵌入到 F2A Daemon 中作为静态文件服务：

```bash
# 构建
npm run build

# 将 dist/ 复制到 Daemon 的静态文件目录
# Daemon 会自动提供 Dashboard 访问
```

## 测试

```bash
# 运行单元测试
npm run test:unit

# 运行测试（交互模式）
npm test

# 打开测试 UI
npm run test:ui
```

## 界面预览

### 主界面布局

```
+----------------------------------------------------------+
|  F2A Dashboard                    [Connected]  [Refresh] |
|  Peer: 16Qk...                                          |
+----------------------------------------------------------+
|  +----------------+  +--------------------------------+  |
|  | Network        |  | Node List                      |  |
|  | Topology       |  | PeerID    IP    Status  Type   |  |
|  |                |  | 16Qk...  ...   Local   open...|  |
|  |  [O]---[O]     |  | a1b2...  ...   Online  custom |  |
|  |   \     /      |  | ...                            |  |
|  |    [Local]     |  +--------------------------------+  |
|  +----------------+                                      |
|  +----------------------------------------------------+  |
|  | Network Capabilities                               |  |
|  | [code-generation] [data-analysis] [file-operation] |  |
|  +----------------------------------------------------+  |
+----------------------------------------------------------+
```

## 相关包

| 包 | 描述 |
|---|---|
| `@f2a/network` | P2P 网络核心库 |
| `@f2a/daemon` | F2A HTTP API 服务 |

## 许可证

MIT
