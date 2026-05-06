# Runtime Installers 实施计划

> **给 Agentic 工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或当前会话逐任务执行。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 提供 F2A runtime installer，使 Agent 能通过 installer 准备 OpenClaw/Hermes runtime，然后通过 setup orchestrator 完成 connect。

**架构：** `@f2a/openclaw-f2a` 增加 OpenClaw installer bin；新增 `@f2a/hermes-f2a` 管理 Hermes webhook config；新增 `@f2a/setup` 作为薄 orchestrator，调用 runtime installer 与 `f2a agent connect`。

**技术栈：** TypeScript、Node.js ESM、Vitest、npm workspaces。

---

### Task 1: OpenClaw Installer

**文件：**
- 创建: `packages/openclaw-f2a/src/installer.ts`
- 创建: `packages/openclaw-f2a/src/installer.test.ts`
- 修改: `packages/openclaw-f2a/package.json`

- [ ] 添加 `openclaw-f2a` bin。
- [ ] 实现 `install` 和 `doctor`。
- [ ] 测试 JSON config 更新、保留已有 agents、doctor ready/missing。

### Task 2: Hermes Installer Package

**文件：**
- 创建: `packages/hermes-f2a/package.json`
- 创建: `packages/hermes-f2a/tsconfig.json`
- 创建: `packages/hermes-f2a/src/installer.ts`
- 创建: `packages/hermes-f2a/src/installer.test.ts`

- [ ] 实现 profile/home 解析。
- [ ] 实现 `install` 写入本地 webhook route。
- [ ] 实现 `doctor` 只读检测。
- [ ] 测试 default profile、named profile、config 写入。

### Task 3: Setup Orchestrator Package

**文件：**
- 创建: `packages/setup/package.json`
- 创建: `packages/setup/tsconfig.json`
- 创建: `packages/setup/src/main.ts`
- 创建: `packages/setup/src/main.test.ts`

- [ ] 实现 `f2a-setup install --runtime openclaw|hermes`。
- [ ] 调用对应 runtime installer。
- [ ] 调用 `f2a agent connect`。
- [ ] 支持 `--json`。

### Task 4: Docs and Verification

**文件：**
- 修改: `AGENT_ONBOARDING.md`
- 修改: `tsconfig.json`

- [ ] 更新 onboarding 文档为 installer-first。
- [ ] 加 root TS project references。
- [ ] 运行新增 package build/test。
- [ ] 运行 OpenClaw/CLI 相关回归测试。
