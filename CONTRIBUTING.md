# 贡献指南

感谢您考虑为 F2A (Friend-to-Agent) 项目做出贡献！

## 目录

- [项目概述](#项目概述)
- [如何贡献](#如何贡献)
- [开发环境设置](#开发环境设置)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [Pull Request 流程](#pull-request-流程)
- [问题报告](#问题报告)
- [功能建议](#功能建议)

---

## 项目概述

F2A 是一个基于 libp2p 的 P2P 网络，用于 OpenClaw Agents 之间的协作。主要功能包括：

- P2P 网络发现与连接
- Agent 能力公告与发现
- 任务委托与执行
- 端到端加密通信
- 信誉系统
- NAT 穿透支持

## 如何贡献

### 贡献方式

1. **代码贡献** - 提交 PR 修复 bug 或添加新功能
2. **文档改进** - 改进文档、添加示例、翻译
3. **问题报告** - 提交 bug 报告或功能建议
4. **测试贡献** - 添加测试用例、改进测试覆盖率
5. **讨论参与** - 在 Issues 中提供反馈和建议

### 贡献前须知

- 先阅读现有的文档和代码
- 在提交 PR 前讨论大型改动（创建 Issue）
- 确保代码通过所有测试
- 遵循代码规范和提交规范

---

## 开发环境设置

### 系统要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/LuciusCao/F2A.git
cd F2A

# 安装依赖
npm install

# 构建项目
npm run build

# 运行测试
npm run test
```

### 开发命令

```bash
# 开发模式（自动构建）
npm run build:watch

# 类型检查
npm run lint

# 运行单元测试
npm run test:unit

# 运行带覆盖率的测试
npm run test:coverage

# 运行集成测试（需要 Docker）
npm run test:docker
```

### 项目结构

```
F2A/
├── src/
│   ├── core/          # 核心模块（p2p-network, identity, reputation 等）
│   ├── utils/         # 工具函数（async-lock, logger, validation 等）
│   ├── types/         # 类型定义
│   ├── config/        # 配置管理
│   ├── cli/           # CLI 工具
│   └── daemon/        # 守护进程
├── tests/
│   ├── integration/   # 集成测试
│   └── mocks/         # 测试 mock
├── docs/              # 文档
├── packages/          # 子包（OpenClaw 适配器）
└── scripts/           # 工具脚本
```

---

## 代码规范

### TypeScript 规范

1. **类型安全** - 避免使用 `any`，优先使用明确的类型定义
   ```typescript
   // ✅ Good
   function processMessage(msg: F2AMessage): Result<void> { ... }
   
   // ❌ Bad
   function processMessage(msg: any): any { ... }
   ```

2. **使用 Result 类型** - 错误处理使用 `Result<T>` 而不是抛出异常
   ```typescript
   import { success, failure, Result } from '../types/index.js';
   
   // ✅ Good
   function doSomething(): Result<string> {
     try {
       return success(result);
     } catch (e) {
       return failureFromError(e);
     }
   }
   ```

3. **文件命名** - 使用 kebab-case，`.ts` 扩展名
   ```
   p2p-network.ts
   async-lock.ts
   message-dispatcher.ts
   ```

4. **导出规范** - 明确导出公共 API
   ```typescript
   // 类型导出
   export type { MyType, Options };
   
   // 值导出
   export { MyClass, myFunction };
   export const MY_CONSTANT = 'value';
   ```

### 代码风格

1. **ESM 模块** - 使用 ES Module（`.js` 扩展名导入）
   ```typescript
   import { something } from './module.js';
   ```

2. **异步函数** - 使用 async/await
   ```typescript
   // ✅ Good
   async function connect() {
     await p2pNetwork.start();
   }
   
   // ❌ Bad
   function connect() {
     return p2pNetwork.start().then(...);
   }
   ```

3. **注释规范**
   ```typescript
   /**
    * 函数描述
    * @param name 参数描述
    * @returns 返回值描述
    */
   function myFunction(name: string): Result<void> { ... }
   ```

---

## 提交规范

我们遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型

| 类型 | 描述 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码风格（不影响功能） |
| `refactor` | 重构（不新增功能或修复 bug） |
| `test` | 测试相关 |
| `chore` | 构建/工具相关 |
| `perf` | 性能优化 |

### 示例

```bash
# 新功能
feat(identity): add agent identity delegation support

# Bug 修复
fix(p2p-network): resolve DHT peer discovery timeout

# 文档
docs(api): update F2A class API reference

# 重构
refactor(utils): extract PeerTableManager from p2p-network

# 测试
test(e2ee-crypto): add encryption roundtrip tests
```

---

## Pull Request 流程

### 创建 PR

1. **Fork 仓库** - 在 GitHub 上 Fork 项目

2. **创建分支**
   ```bash
   git checkout -b feat/my-feature
   ```

3. **进行修改** - 编写代码和测试

4. **提交变更**
   ```bash
   git add .
   git commit -m "feat(module): my feature description"
   ```

5. **推送分支**
   ```bash
   git push origin feat/my-feature
   ```

6. **创建 PR** - 在 GitHub 上创建 Pull Request

### PR 要求

- **描述清晰** - 说明改动内容和原因
- **关联 Issue** - 引用相关 Issue（`#123`）
- **通过测试** - 确保所有测试通过
- **代码审查** - 等待代码审查
- **解决评论** - 处理审查意见

### PR 检查清单

```markdown
- [ ] 代码通过 lint 检查 (`npm run lint`)
- [ ] 所有测试通过 (`npm run test`)
- [ ] 添加必要的测试用例
- [ ] 更新相关文档
- [ ] 遵循提交规范
- [ ] PR 描述清晰完整
```

---

## 问题报告

### Bug 报告模板

```markdown
## Bug 描述
简明描述遇到的问题

## 复现步骤
1. 执行 '...'
2. 点击 '...'
3. 看到错误 '...'

## 期望行为
应该发生什么

## 实际行为
实际发生了什么

## 环境
- Node.js 版本:
- F2A 版本:
- 操作系统:

## 相关日志
```
粘贴相关日志
```

## 其他信息
任何其他相关信息
```

---

## 功能建议

### 功能建议模板

```markdown
## 功能描述
希望添加的功能描述

## 使用场景
这个功能在什么场景下有用

## 可能的实现
建议的实现方案（可选）

## 其他信息
任何其他相关信息
```

---

## 代码审查

### 审查标准

1. **正确性** - 代码是否正确实现功能
2. **测试覆盖** - 是否有足够的测试
3. **代码质量** - 是否遵循规范
4. **文档完整** - 是否有必要的文档
5. **性能影响** - 是否有性能问题
6. **安全性** - 是否有安全隐患

### 审查流程

1. 作者提交 PR
2. 审查者检查代码
3. 提出审查意见
4. 作者处理意见
5. 审查者批准
6. 合并代码

---

## 行为准则

请阅读并遵守我们的 [行为准则](CODE_OF_CONDUCT.md)。

---

## 许可证

本项目采用 MIT 许可证。贡献的代码将以相同许可证发布。

---

## 联系方式

- GitHub Issues: https://github.com/LuciusCao/F2A/issues
- 作者: Lucius.C

感谢您的贡献！🙏