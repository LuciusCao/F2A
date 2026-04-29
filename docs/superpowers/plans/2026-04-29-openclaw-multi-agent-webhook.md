# OpenClaw Multi-Agent Webhook 实施计划

> **给 Agentic 工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或当前会话逐任务执行。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 让一个 OpenClaw Gateway 内的多个 Agent 使用各自的 per-Agent webhook URL 完成 F2A Agent-first onboarding。

**架构：** OpenClaw 插件只接受 `<webhookPath>/agents/<openclawAgentId>` 形式的 webhook 请求，并用 `openclawAgentId` 路由到 Gateway 内的目标 Agent。`f2a agent connect` 继续负责创建 F2A 身份和 runtime binding，文档示例改为每个 OpenClaw Agent 使用独立 webhook path。

**技术栈：** TypeScript、OpenClaw plugin API、Vitest、Markdown 文档。

---

### Task 1: OpenClaw Webhook 路由测试

**文件：**
- 修改: `packages/openclaw-f2a/tests/webhook.test.ts`

- [ ] **Step 1: 写 per-Agent route 通过测试**

在 webhook 测试文件中添加测试，配置 `agents: [{ openclawAgentId: 'coder' }]`，请求路径使用 `/f2a/webhook/agents/coder`，payload 使用 `{ from: 'agent:sender', content: 'hello' }`，断言返回 `200`。

```typescript
it('routes per-agent webhook requests by openclawAgentId', async () => {
  const mockApi = createMockApi({
    agents: [{ openclawAgentId: 'coder', name: 'Coder Agent' }]
  });
  const { default: register } = await import('../src/plugin');

  register(mockApi);

  const routeCall = mockApi.registerHttpRoute?.mock.calls[0][0];
  const handler = routeCall.handler;
  const mockReq = Object.assign(
    createMockRequest(JSON.stringify({ from: 'agent:sender', content: 'hello' })),
    {
      method: 'POST',
      url: '/f2a/webhook/agents/coder',
      headers: {}
    }
  );
  const mockRes = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn()
  } as any;

  await handler(mockReq, mockRes);

  expect(mockRes.statusCode).toBe(200);
});
```

- [ ] **Step 2: 写 unknown Agent 拒绝测试**

添加测试，配置 `agents: [{ openclawAgentId: 'coder' }]`，请求 `/f2a/webhook/agents/researcher`，断言 `404`。

```typescript
it('rejects unknown configured openclawAgentId', async () => {
  const mockApi = createMockApi({
    agents: [{ openclawAgentId: 'coder', name: 'Coder Agent' }]
  });
  const { default: register } = await import('../src/plugin');

  register(mockApi);

  const handler = mockApi.registerHttpRoute?.mock.calls[0][0].handler;
  const mockReq = Object.assign(
    createMockRequest(JSON.stringify({ from: 'agent:sender', content: 'hello' })),
    {
      method: 'POST',
      url: '/f2a/webhook/agents/researcher',
      headers: {}
    }
  );
  const mockRes = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn()
  } as any;

  await handler(mockReq, mockRes);

  expect(mockRes.statusCode).toBe(404);
});
```

- [ ] **Step 3: 写 global webhook 拒绝测试**

添加测试，请求 `/f2a/webhook`，断言 `404`。

```typescript
it('rejects global webhook path for agent-first delivery', async () => {
  const mockApi = createMockApi();
  const { default: register } = await import('../src/plugin');

  register(mockApi);

  const handler = mockApi.registerHttpRoute?.mock.calls[0][0].handler;
  const mockReq = Object.assign(
    createMockRequest(JSON.stringify({ from: 'agent:sender', content: 'hello' })),
    {
      method: 'POST',
      url: '/f2a/webhook',
      headers: {}
    }
  );
  const mockRes = {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn()
  } as any;

  await handler(mockReq, mockRes);

  expect(mockRes.statusCode).toBe(404);
});
```

- [ ] **Step 4: 运行测试确认失败**

运行:

```bash
npm test --workspace @f2a/openclaw-f2a -- webhook.test.ts
```

预期: 新增测试失败，因为当前插件仍接受全局路径，并且没有校验 `agents[]`。

### Task 2: OpenClaw 插件路由实现

**文件：**
- 修改: `packages/openclaw-f2a/src/plugin.ts`

- [ ] **Step 1: 添加 per-Agent path 解析 helper**

在 `handleWebhookRequest` 附近添加 helper：

```typescript
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseOpenClawAgentWebhookPath(webhookPath: string, urlPath: string): string | null {
  const normalizedBase = webhookPath.endsWith('/') ? webhookPath.slice(0, -1) : webhookPath;
  const pattern = new RegExp(`^${escapeRegExp(normalizedBase)}/agents/([^/?#]+)(?:[/?#]|$)`);
  const match = urlPath.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

function isConfiguredOpenClawAgent(config: Required<WebhookConfig>, openclawAgentId: string): boolean {
  if (config.agents.length === 0) {
    return true;
  }
  return config.agents.some(agent => agent.openclawAgentId === openclawAgentId);
}
```

- [ ] **Step 2: 替换旧路由判断**

在 `handleWebhookRequest` 中删除全局路径和 `/agent:<prefix>` 判断，改为：

```typescript
const urlPath = req.url || '';
const openclawAgentId = parseOpenClawAgentWebhookPath(config.webhookPath, urlPath);

if (req.method !== 'POST' || !openclawAgentId) {
  res.statusCode = 404;
  res.end('Not found');
  return true;
}

if (!isConfiguredOpenClawAgent(config, openclawAgentId)) {
  res.statusCode = 404;
  res.end('Unknown OpenClaw agent');
  return true;
}
```

- [ ] **Step 3: 使用 openclawAgentId 作为目标上下文**

把日志和调用 Agent 的 session key 改成 `openclawAgentId`：

```typescript
api.logger?.info(`[F2A Webhook] Received message (openclaw:${openclawAgentId}) from ${fromAgentId.slice(0, 16)}, length=${message.length}`);

const reply = await invokeAgent(api, openclawAgentId, message, config.agentTimeout);
```

- [ ] **Step 4: 运行 OpenClaw webhook 测试**

运行:

```bash
npm test --workspace @f2a/openclaw-f2a -- webhook.test.ts
```

预期: webhook 测试通过。

### Task 3: OpenClaw 文档和 onboarding 示例

**文件：**
- 修改: `AGENT_ONBOARDING.md`
- 修改: `packages/openclaw-f2a/README.md`

- [ ] **Step 1: 更新 AGENT_ONBOARDING.md OpenClaw 配置说明**

在 OpenClaw 章节说明：

```markdown
For one OpenClaw Gateway with multiple Agents, use the same `runtimeId` and a different `runtimeAgentId` for each `agents.list[].id`.

Each Agent must use its own webhook URL:

```text
http://127.0.0.1:18789/f2a/webhook/agents/<openclawAgentId>
```
```

- [ ] **Step 2: 更新 AGENT_ONBOARDING.md connect 示例**

把 OpenClaw 示例改成 per-Agent path：

```bash
f2a agent connect \
  --runtime openclaw \
  --runtime-id local-openclaw \
  --runtime-agent-id coder \
  --name "OpenClaw Coder" \
  --webhook http://127.0.0.1:18789/f2a/webhook/agents/coder \
  --capability chat \
  --capability code \
  --json
```

- [ ] **Step 3: 更新 openclaw-f2a README webhook endpoint**

把端点说明改成：

```markdown
- Agent webhook: `POST http://127.0.0.1:18789/f2a/webhook/agents/<openclawAgentId>`
```

删除全局 webhook 可用于 Agent-first delivery 的表述。

- [ ] **Step 4: 文档 grep 检查**

运行:

```bash
rg "/f2a/webhook/agent:|POST http://127.0.0.1:18789/f2a/webhook$|--webhook http://127.0.0.1:18789/f2a/webhook " AGENT_ONBOARDING.md packages/openclaw-f2a/README.md
```

预期: 无旧路径命中。

### Task 4: 全量相关验证

**文件：**
- 修改: 无

- [ ] **Step 1: 构建 OpenClaw 插件**

运行:

```bash
npm run build --workspace @f2a/openclaw-f2a
```

预期: TypeScript 构建通过。

- [ ] **Step 2: 跑 OpenClaw 插件测试**

运行:

```bash
npm test --workspace @f2a/openclaw-f2a -- webhook.test.ts register.test.ts
```

预期: 测试通过。

- [ ] **Step 3: 跑 CLI 相关测试**

运行:

```bash
npm test --workspace @f2a/cli -- cli-entry.test.ts connect.test.ts
```

预期: 测试通过。

- [ ] **Step 4: 检查工作区 diff**

运行:

```bash
git diff --stat
```

预期: 只包含 OpenClaw 插件、OpenClaw README、AGENT_ONBOARDING、spec/plan，以及已有 CLI help 修正。
