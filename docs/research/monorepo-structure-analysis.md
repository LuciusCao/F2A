# Monorepo 项目结构最佳实践研究报告

## 一、主流项目结构调研

### 1. React (facebook/react)

```
react/
├── packages/
│   ├── react/                 # 核心包
│   ├── react-dom/             # DOM 绑定
│   ├── react-reconciler/      # 调度器
│   ├── scheduler/             # 谭度器
│   └── ...                    # 其他子包
├── package.json               # workspace 根（无 src）
└── scripts/                   # 构建脚本
```

**特点**：
- 纯 monorepo 结构，根目录只是 workspace 配置
- 所有包都在 `packages/` 下
- 根 package.json 不发布，只是协调器
- 使用 `workspace` 协议管理内部依赖

### 2. Vue (vuejs/vue)

```
vue/
├── packages/
│   ├── vue/                   # 主包
│   ├── vue-runtime-core/      # 运行时核心
│   ├── vue-runtime-dom/       # DOM 运行时
│   ├── vue-reactivity/        # 响应式系统
│   ├── vue-compiler-core/     # 编译器核心
│   └── ...                    # 其他子包
├── package.json               # workspace 根（无 src）
├── scripts/                   # 构建脚本
└── test-dts/                  # 类型测试
```

**特点**：
- 纯 monorepo 结构
- 功能模块化清晰
- 使用 pnpm workspace
- 版本管理：changesets

### 3. Next.js (vercel/next.js)

```
next.js/
├── packages/
│   ├── next/                  # 核心 Next.js
│   ├── create-next-app/       # CLI 工具
│   └── ...                    # 其他子包
├── examples/                  # 示例项目
├── test/                      # 测试
├── package.json               # workspace 根
└── turbo.json                 # Turborepo 配置
```

**特点**：
- 纯 monorepo 结构
- 使用 Turborepo
- 根目录无业务代码

### 4. Turborepo 官方推荐

```
repo/
├── apps/
│   ├── web/                   # Web 应用
│   ├── docs/                  # 文档站点
│   └── api/                   # API 服务
├── packages/
│   ├── ui/                    # 共享 UI 组件库
│   ├── tsconfig/              # 共享 TypeScript 配置
│   ├── eslint-config/         # 共享 ESLint 配置
│   └── utils/                 # 共享工具函数
├── package.json               # workspace 根
├── turbo.json                 # Turborepo 配置
└── pnpm-workspace.yaml        # pnpm workspace 配置
```

**特点**：
- **apps/** 存放可部署的应用
- **packages/** 存放可复用的库
- 清晰的边界分离
- 根 package.json 只作为协调器

### 5. Nx 推荐结构

Nx 支持两种模式：

**Integrated Monorepo**（项目混合）：
```
repo/
├── apps/
│   ├── app1/
│   └── app2/
├── libs/
│   ├── feature1/
│   └── shared/
└── nx.json
```

**Package-based Monorepo**（类似 Turborepo）：
```
repo/
├── packages/
│   ├── package1/
│   └── package2/
└── nx.json
```

### 6. pnpm Workspace 推荐

```
repo/
├── packages/
│   ├── core/
│   ├── utils/
│   └── app/
├── pnpm-workspace.yaml
└── package.json               # workspace 根
```

---

## 二、两种方案对比分析

### 当前 F2A 结构（方案 A：混合结构）

```
F2A/
├── package.json          # @f2a/network（既是根又是包）
├── src/                  # 核心库源码
├── tests/                # 核心库测试
├── dist/                 # 核心库编译产物
├── packages/
│   ├── dashboard/        # @f2a/dashboard
│   └── openclaw-f2a/     # @f2a/openclaw-f2a
└── node_modules/
```

**实际配置**：
- 根 package.json: `name: "@f2a/network"`, `workspaces: ["packages/*"]`
- 子包依赖根包: `"@f2a/network": "*"`

### 纯 Monorepo 结构（方案 B）

```
F2A/
├── package.json          # workspace 根（不发布）
├── packages/
│   ├── core/             # @f2a/network 或 @f2a/core
│   │   ├── src/
│   │   ├── tests/
│   │   ├── dist/
│   │   └── package.json
│   ├── adapter/          # @f2a/openclaw-f2a
│   │   ├── src/
│   │   └── package.json
│   └── dashboard/        # @f2a/dashboard
│       ├── src/
│       └ package.json
├── docs/                 # 共享文档
├── scripts/              # 共享脚本
└── tests/                # 共享测试配置
```

---

## 三、详细对比（六大维度）

### 1. 发布便利性

| 维度 | 方案 A（混合） | 方案 B（纯 monorepo） |
|------|---------------|---------------------|
| **核心包发布** | ✅ 简单：直接在根目录 `npm publish` | ⚠️ 需进入 packages/core/ |
| **子包发布** | ✅ 进入对应目录发布 | ✅ 相同 |
| **版本同步** | ⚠️ 根包和子包版本号可能不一致 | ✅ 所有包版本管理统一 |
| **发布脚本** | ⚠️ 需特殊处理根包 | ✅ 统一脚本处理所有包 |

**案例**：
- 方案 A：当前 `@f2a/network` 0.4.7，`@f2a/openclaw-f2a` 0.3.3（版本不同步）
- 方案 B：可使用 changesets 统一管理所有包版本

### 2. 版本管理

| 维度 | 方案 A（混合） | 方案 B（纯 monorepo） |
|------|---------------|---------------------|
| **Changesets** | ⚠️ 需特殊配置处理根包 | ✅ 标准配置 |
| **Lerna** | ⚠️ 根包不在 packages/，配置复杂 | ✅ 标准支持 |
| **独立版本** | ⚠️ 根包和子包版本号容易混乱 | ✅ 清晰隔离 |
| **依赖版本** | `"@f2a/network": "*"` 依赖不稳定 | ✅ 可用 `workspace:*` |

**当前问题**：
```json
{
  "@f2a/network": "*",  // 不稳定，发布后变成实际版本号
}
```

方案 B 可使用：
```json
{
  "@f2a/network": "workspace:*"  // pnpm workspace 协议，发布时自动替换
}
```

### 3. 依赖共享

| 维度 | 方案 A（混合） | 方案 B（纯 monorepo） |
|------|---------------|---------------------|
| **共享 devDependencies** | ⚠️ 根 package.json 有业务依赖，难以区分 | ✅ 根 package.json 只放共享工具 |
| **依赖提升** | ⚠️ 根包依赖提升到顶层，可能冲突 | ✅ 所有包依赖平等处理 |
| **TypeScript 配置** | ⚠️ 根 tsconfig.json 需同时处理根包和子包 | ✅ 统一的基础配置 + 各包继承 |

**当前问题**：
- 根 package.json 包含大量业务依赖（libp2p 等），这些会提升到顶层
- 子包可能意外访问根包的依赖
- 不符合 npm/yarn/pnpm 的提升策略设计

### 4. CI/CD 配置

| 维度 | 方案 A（混合） | 方案 B（纯 monorepo） |
|------|---------------|---------------------|
| **构建缓存** | ⚠️ Turborepo 需特殊配置根包 | ✅ Turborepo 标准配置 |
| **增量构建** | ⚠️ 根包变化判断复杂 | ✅ 每个包独立判断 |
| **测试范围** | ⚠️ 根包测试和子包测试需区分 | ✅ 每个包独立测试配置 |
| **发布流程** | ⚠️ 根包和子包处理不一致 | ✅ 统一流程 |

**Turborepo 配置示例**：

方案 A 需要：
```json
{
  "pipeline": {
    "build": {
      "outputs": ["dist/**", "packages/*/dist/**"]  // 需特殊处理
    }
  }
}
```

方案 B：
```json
{
  "pipeline": {
    "build": {
      "outputs": ["packages/*/dist/**"]  // 标准配置
    }
  }
}
```

### 5. 代码组织清晰度

| 维度 | 方案 A（混合） | 方案 B（纯 monorepo） |
|------|---------------|---------------------|
| **新开发者理解** | ⚠️ 需理解"根目录既是包又是根" | ✅ 一目了然的结构 |
| **包边界** | ⚠️ 根包边界模糊 | ✅ 每个包边界清晰 |
| **文档组织** | ⚠️ docs/ 既服务于根包又服务于整体 | ✅ docs/ 可按包分离 |
| **导入路径** | ⚠️ `import { X } from '@f2a/network'` 指向根 | ✅ 指向 packages/core |

**认知负担对比**：
- 方案 A："为什么根目录有 src？这是根还是包？"
- 方案 B："每个包在 packages/ 下，根只是协调器"

### 6. 社区惯例

| 维度 | 方案 A（混合） | 方案 B（纯 monorepo） |
|------|---------------|---------------------|
| **主流项目** | ❌ React、Vue、Next.js 都用纯结构 | ✅ 符合主流惯例 |
| **工具支持** | ⚠️ Turborepo/Nx/pnpm 需特殊配置 | ✅ 工具默认支持 |
| **文档参考** | ⚠️ 需查阅特殊案例文档 | ✅ 标准文档直接适用 |
| **招聘/协作** | ⚠️ 需额外解释项目结构 | ✅ 团队成员快速上手 |

---

## 四、主流项目采用情况

### 采用纯 Monorepo 结构的项目

| 项目 | 结构 | 工具 |
|------|------|------|
| React | packages/* | npm workspaces |
| Vue | packages/* | pnpm + changesets |
| Next.js | packages/* | Turborepo |
| Vite | packages/* | pnpm |
| Svelte | packages/* | pnpm |
| Angular | packages/* | Nx (早期) |
| Babel | packages/* | Lerna |
| Jest | packages/* | Lerna |
| TypeScript | packages/* | npm workspaces |

### 采用混合结构的项目（极少）

| 项目 | 结构 | 原因 |
|------|------|------|
| **create-react-app** | 根是 CLI，packages 有模板 | CLI 是主入口点 |
| **tslib** | 根是包，无子包 | 单包项目 |

**结论**：混合结构在大型 monorepo 项目中**几乎没有**采用。

---

## 五、建议与结论

### 建议：重构为纯 Monorepo 结构

### 推荐结构

```
F2A/
├── package.json               # workspace 根（不发布）
├── pnpm-workspace.yaml        # pnpm workspace 配置
├── turbo.json                 # Turborepo 配置（可选）
├── packages/
│   ├── core/                  # @f2a/network → @f2a/core
│   │   ├── src/
│   │   ├── tests/
│   │   ├── dist/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── adapter/               # @f2a/openclaw-f2a → @f2a/adapter
│   │   ├── src/
│   │   ├── tests/
│   │   ├── dist/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── dashboard/             # @f2a/dashboard
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
├── apps/                      # 可部署应用（可选）
│   └── cli/                   # CLI 工具（如果需要独立包）
├── docs/                      # 共享文档
├── scripts/                   # 共享构建脚本
├── .changeset/                # 版本管理配置
└── tsconfig.base.json         # 共享 TypeScript 配置
```

### 包命名建议

| 包 | 当前名称 | 建议名称 | 原因 |
|----|---------|---------|------|
| core | `@f2a/network` | `@f2a/core` 或保持 | network 已有品牌认知 |
| adapter | `@f2a/openclaw-f2a` | `@f2a/openclaw-adapter` | 更符合命名惯例 |
| dashboard | `@f2a/dashboard` | 保持 | 无问题 |

### 迁移步骤

1. **创建新结构**：
   - 创建 `packages/core/` 目录
   - 将 `src/`, `tests/`, `dist/` 移动到 `packages/core/`

2. **修改根 package.json**：
   ```json
   {
     "name": "f2a-monorepo",
     "private": true,
     "workspaces": ["packages/*"]
   }
   ```

3. **创建各包 package.json**：
   - `packages/core/package.json`: 复制当前根 package.json 内容
   - `packages/adapter/package.json`: 保持现有配置

4. **更新依赖引用**：
   - `"@f2a/network": "workspace:*"`（pnpm）
   - 或 `"@f2a/network": "*"`（npm）

5. **配置 Turborepo/changesets**（可选）：
   - 使用 changesets 管理版本
   - 使用 Turborepo 加速构建

### 不重构的风险

如果保持当前混合结构：

1. **工具兼容性问题**：新工具可能不支持混合结构
2. **版本管理混乱**：根包和子包版本号持续不同步
3. **团队协作困难**：新成员需要额外学习成本
4. **未来扩展困难**：新增子包时结构更加混乱

### 重构的收益

1. ✅ 符合社区主流惯例，工具支持完善
2. ✅ 版本管理统一，可使用 changesets
3. ✅ CI/CD 配置标准化，构建缓存优化
4. ✅ 新成员快速理解项目结构
5. ✅ 未来扩展包时无障碍

---

## 六、总结

| 方案 | 评分 | 结论 |
|------|------|------|
| 方案 A（混合结构） | 3/10 | 仅适合简单项目，不适合 monorepo |
| 方案 B（纯 monorepo） | 9/10 | 主流标准，工具完善，团队友好 |

**最终建议**：重构为纯 monorepo 结构。

当前混合结构虽然可以工作，但随着项目发展和团队扩大，会面临越来越多的问题。主流项目（React、Vue、Next.js）全部采用纯 monorepo 结构，这证明了该结构的可靠性和可持续性。

重构工作量适中（主要是目录调整），收益长期显著。