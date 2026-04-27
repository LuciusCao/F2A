# Agent-First Connect 实施计划

> **给 Agentic 工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或当前会话逐任务执行。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 支持本机两个 runtime-hosted Agent 各自完成 F2A connect，并能使用现有消息命令互相对话。

**架构：** 新增 CLI 侧 runtime binding 存储与 `f2a agent connect` 命令。`connect` 组合现有 `agent init` 与 `agent register` 语义：按 `(runtimeType, runtimeId, runtimeAgentId)` 查找绑定，没有绑定就创建或复用 AgentIdentity，然后注册到 daemon 并保存 binding。OpenClaw/Hermes 适配先落到可复用 CLI 与存储边界，插件多 Agent 路由作为后续任务接入。

**技术栈：** TypeScript ES Modules, Node.js fs/path/os, Vitest, existing `@f2a/network` AgentIdentityKeypair, existing CLI HTTP client.

---

### Task 1: Runtime Binding 存储单元

**文件：**
- 创建: `packages/cli/src/runtime-bindings.ts`
- 测试: `packages/cli/src/runtime-bindings.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  saveRuntimeBinding,
  loadRuntimeBinding,
  resolveHermesRuntimeAgentId,
  RuntimeAgentBinding
} from './runtime-bindings.js';

describe('runtime-bindings', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'f2a-bindings-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('saves and loads binding by runtime tuple', async () => {
    const binding: RuntimeAgentBinding = {
      agentId: 'agent:abc123',
      runtimeType: 'openclaw',
      runtimeId: 'local-openclaw',
      runtimeAgentId: 'research',
      webhook: { url: 'http://127.0.0.1:18789/f2a/webhook/agent:abc123' },
      status: 'registered',
      createdAt: '2026-04-27T00:00:00.000Z',
      lastSeenAt: '2026-04-27T00:00:00.000Z'
    };

    await saveRuntimeBinding(dataDir, binding);

    await expect(loadRuntimeBinding(dataDir, {
      runtimeType: 'openclaw',
      runtimeId: 'local-openclaw',
      runtimeAgentId: 'research'
    })).resolves.toEqual(binding);
  });

  it('uses default Hermes runtime agent when HERMES_HOME is unset or ~/.hermes', () => {
    expect(resolveHermesRuntimeAgentId(undefined, '/Users/alice')).toBe('default');
    expect(resolveHermesRuntimeAgentId('/Users/alice/.hermes', '/Users/alice')).toBe('default');
  });

  it('uses Hermes profile name when HERMES_HOME points at profiles directory', () => {
    expect(resolveHermesRuntimeAgentId('/Users/alice/.hermes/profiles/coder', '/Users/alice')).toBe('coder');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行: `npm test --workspace @f2a/cli -- runtime-bindings.test.ts`

预期: FAIL，因为 `packages/cli/src/runtime-bindings.ts` 尚不存在。

- [ ] **Step 3: 写最小实现**

实现导出：

```typescript
export type RuntimeType = 'openclaw' | 'hermes' | 'other';

export interface RuntimeAgentBinding {
  agentId: string;
  runtimeType: RuntimeType;
  runtimeId: string;
  runtimeAgentId: string;
  webhook?: { url: string; token?: string };
  nodeId?: string;
  nodeSignature?: string;
  status: 'initialized' | 'registered';
  createdAt: string;
  lastSeenAt: string;
}

export async function saveRuntimeBinding(dataDir: string, binding: RuntimeAgentBinding): Promise<void>;
export async function loadRuntimeBinding(dataDir: string, key: RuntimeBindingKey): Promise<RuntimeAgentBinding | null>;
export function resolveHermesRuntimeAgentId(hermesHome: string | undefined, homeDir?: string): string;
```

存储路径: `<dataDir>/runtime-bindings/<runtimeType>/<runtimeId>/<runtimeAgentId>.json`。

- [ ] **Step 4: 运行测试确认通过**

运行: `npm test --workspace @f2a/cli -- runtime-bindings.test.ts`

预期: PASS。

### Task 2: Agent Connect 核心流程

**文件：**
- 创建: `packages/cli/src/connect.ts`
- 测试: `packages/cli/src/connect.test.ts`
- 修改: `packages/cli/src/init.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { connectAgent } from './connect.js';
import { loadRuntimeBinding } from './runtime-bindings.js';

vi.mock('./http-client.js', () => ({
  sendRequest: vi.fn(async () => ({
    success: true,
    agent: { agentId: 'agent:mocked' },
    nodeSignature: 'node-sig',
    nodeId: 'node-1',
    token: 'agent-token'
  }))
}));

describe('connectAgent', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'f2a-connect-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates identity, registers it, and stores runtime binding', async () => {
    const result = await connectAgent({
      dataDir,
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      name: 'Agent A',
      capabilities: ['chat'],
      webhook: 'http://127.0.0.1:9101/f2a/webhook'
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^agent:[0-9a-f]{16}$/);

    const binding = await loadRuntimeBinding(dataDir, {
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a'
    });
    expect(binding?.agentId).toBe(result.agentId);
    expect(binding?.status).toBe('registered');
    expect(binding?.webhook?.url).toBe('http://127.0.0.1:9101/f2a/webhook');
  });

  it('returns existing binding without creating a new agent when not forced', async () => {
    const first = await connectAgent({
      dataDir,
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      name: 'Agent A',
      webhook: 'http://127.0.0.1:9101/f2a/webhook'
    });

    const second = await connectAgent({
      dataDir,
      runtimeType: 'other',
      runtimeId: 'local-test',
      runtimeAgentId: 'agent-a',
      name: 'Agent A',
      webhook: 'http://127.0.0.1:9101/f2a/webhook'
    });

    expect(second.agentId).toBe(first.agentId);
    expect(second.alreadyConnected).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行: `npm test --workspace @f2a/cli -- connect.test.ts`

预期: FAIL，因为 `connect.ts` 尚不存在。

- [ ] **Step 3: 写最小实现**

实现 `connectAgent(options)`：

```typescript
export interface ConnectAgentOptions {
  dataDir?: string;
  runtimeType: RuntimeType;
  runtimeId: string;
  runtimeAgentId: string;
  name: string;
  agentId?: string;
  capabilities?: string[];
  webhook?: string;
  force?: boolean;
}
```

实现细节：

- 使用 `loadRuntimeBinding()` 查已有 binding。
- 没有 `agentId` 时调用一个可注入 dataDir 的 identity 创建函数。
- 有 `agentId` 时读取对应 identity。
- 调用 `sendRequest('POST', '/api/v1/agents', body)` 注册。
- 保存 node signature 到 identity 文件。
- 保存 `RuntimeAgentBinding`。

`packages/cli/src/init.ts` 需要新增可配置 dataDir 的 helper，保留现有默认行为：

```typescript
export function getAgentIdentitiesDir(dataDir = F2A_DATA_DIR): string;
export function readIdentityByAgentId(agentId: string, dataDir?: string): AgentIdentityFile | null;
export async function initAgentIdentity(options: InitOptions & { dataDir?: string }): Promise<...>;
```

- [ ] **Step 4: 运行测试确认通过**

运行: `npm test --workspace @f2a/cli -- connect.test.ts runtime-bindings.test.ts`

预期: PASS。

### Task 3: CLI 命令接入

**文件：**
- 修改: `packages/cli/src/main.ts`
- 测试: `packages/cli/src/main.test.ts`

- [ ] **Step 1: 写失败测试**

在 `main.test.ts` 增加用例，mock `./connect.js`：

```typescript
vi.mock('./connect.js', () => ({
  cliConnectAgent: vi.fn(async () => undefined)
}));

it('routes f2a agent connect to cliConnectAgent', async () => {
  const { cliConnectAgent } = await import('./connect.js');
  process.argv = [
    'node',
    'f2a',
    'agent',
    'connect',
    '--runtime',
    'other',
    '--runtime-id',
    'local-test',
    '--runtime-agent-id',
    'agent-a',
    '--name',
    'Agent A',
    '--webhook',
    'http://127.0.0.1:9101/f2a/webhook',
    '--capability',
    'chat'
  ];

  await import('./main.js');

  expect(cliConnectAgent).toHaveBeenCalledWith({
    runtimeType: 'other',
    runtimeId: 'local-test',
    runtimeAgentId: 'agent-a',
    name: 'Agent A',
    agentId: undefined,
    webhook: 'http://127.0.0.1:9101/f2a/webhook',
    capabilities: ['chat'],
    force: undefined
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行: `npm test --workspace @f2a/cli -- main.test.ts`

预期: FAIL，因为 `agent connect` 尚未路由。

- [ ] **Step 3: 写最小实现**

修改 `packages/cli/src/main.ts`：

- import `cliConnectAgent`。
- `showAgentHelp()` 加 `connect`。
- JSON help subcommands 加 `connect`。
- `handleAgentCommand()` 增加 `case 'connect'`。
- 校验 `--runtime`, `--runtime-id`, `--runtime-agent-id`, `--name`。
- 将 `--capability` 重复参数映射为 string array。

- [ ] **Step 4: 运行测试确认通过**

运行: `npm test --workspace @f2a/cli -- main.test.ts connect.test.ts runtime-bindings.test.ts`

预期: PASS。

### Task 4: 本机双 Agent 对话验证脚本

**文件：**
- 创建: `docs/testing/local-two-agent-connect.md`

- [ ] **Step 1: 写验证文档草稿**

文档包含以下命令：

```bash
npm run build
f2a daemon start

node packages/cli/dist/main.js agent connect \
  --runtime other \
  --runtime-id local-test \
  --runtime-agent-id agent-a \
  --name "Local Agent A" \
  --webhook http://127.0.0.1:9101/f2a/webhook \
  --capability chat

node packages/cli/dist/main.js agent connect \
  --runtime other \
  --runtime-id local-test \
  --runtime-agent-id agent-b \
  --name "Local Agent B" \
  --webhook http://127.0.0.1:9102/f2a/webhook \
  --capability chat

node packages/cli/dist/main.js message send \
  --agent-id <agent-a-id> \
  --to <agent-b-id> \
  --expect-reply \
  "hello from A"

node packages/cli/dist/main.js message list --agent-id <agent-b-id>
```

- [ ] **Step 2: 构建确认**

运行: `npm run build`

预期: PASS。

- [ ] **Step 3: CLI 测试确认**

运行: `npm test --workspace @f2a/cli -- connect.test.ts runtime-bindings.test.ts main.test.ts`

预期: PASS。

### Task 5: OpenClaw 插件配置 schema 前置兼容

**文件：**
- 修改: `packages/openclaw-f2a/openclaw.plugin.json`
- 修改: `packages/openclaw-f2a/src/types.ts`
- 测试: `packages/openclaw-f2a/tests/register.test.ts`

- [ ] **Step 1: 写失败测试**

在 register 测试中增加配置解析用例，预期 `agents[]` 配置可被类型接受，并生成两个 connect target。

```typescript
const config = {
  webhookPath: '/f2a/webhook',
  agents: [
    { openclawAgentId: 'research', name: 'Research Agent', capabilities: ['research'] },
    { openclawAgentId: 'coding', name: 'Coding Agent', capabilities: ['code'] }
  ]
};
expect(config.agents).toHaveLength(2);
```

- [ ] **Step 2: 运行测试确认失败**

运行: `npm test --workspace @f2a/openclaw-f2a -- register.test.ts`

预期: FAIL，因为 `WebhookConfig` 尚无 `agents` 字段或 schema 未声明。

- [ ] **Step 3: 写最小实现**

新增类型：

```typescript
export interface F2AOpenClawAgentConfig {
  openclawAgentId: string;
  f2aAgentId?: string;
  name?: string;
  capabilities?: string[];
  webhookPath?: string;
}
```

`WebhookConfig` 加：

```typescript
runtimeId?: string;
agents?: F2AOpenClawAgentConfig[];
```

`openclaw.plugin.json` schema 加 `runtimeId` 与 `agents`。

- [ ] **Step 4: 运行测试确认通过**

运行: `npm test --workspace @f2a/openclaw-f2a -- register.test.ts`

预期: PASS。

## Completion Criteria

- `f2a agent connect` 可以为两个不同 `runtimeAgentId` 创建两个不同 Agent。
- 两个 Agent 的 runtime bindings 分别保存在 `~/.f2a/runtime-bindings/...`。
- 两个 Agent 注册到 daemon 后可用现有 `message send/list` 互相传递消息。
- Hermes 默认 profile 规则在 storage helper 中有测试覆盖。
- OpenClaw `agents[]` 配置 schema 可接受，为后续插件多 Agent 路由打基础。
