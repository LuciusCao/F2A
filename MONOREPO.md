# F2A Monorepo

F2A (Friend-to-Agent) 是一个用于 OpenClaw Agents 的 P2P 网络协议。

## 仓库结构

```
F2A/
├── packages/                     # 子包目录
│   └── openclaw-adapter/         # OpenClaw 插件
│       ├── package.json
│       ├── tsconfig.json
│       ├── README.md
│       └── src/
├── src/                          # F2A 核心代码
│   ├── core/                     # 核心 P2P 网络
│   ├── daemon/                   # Daemon 服务
│   ├── cli/                      # CLI 工具
│   └── types/                    # 类型定义
├── docs/                         # 文档
├── package.json                  # 根 package.json (workspaces)
└── tsconfig.json
```

## 包说明

| 包 | 路径 | 说明 |
|----|------|------|
| `f2a-network` | `./` | F2A P2P 网络核心 |
| `f2a-openclaw-adapter` | `./packages/openclaw-adapter` | OpenClaw 插件 |

## 开发

```bash
# 安装所有依赖
npm install

# 构建所有包
npm run build:all

# 测试所有包
npm run test:all

# 构建特定包
cd packages/openclaw-adapter
npm run build
```

## 发布

```bash
# 发布核心包
npm publish

# 发布子包
cd packages/openclaw-adapter
npm publish --access public
```