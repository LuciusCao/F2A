# P1-6: AgentIdentityStore 异步化改造

## 方案：只改运行时操作

**保持同步**: `loadAll()` - 启动时执行一次，阻塞可接受
**改为异步**: `save()`, `updateWebhook()`, `delete()` - 运行时操作，避免阻塞 HTTP 处理

---

## 任务拆分

### Phase 1: 修改 AgentIdentityStore 类

**文件**: `packages/daemon/src/agent-identity-store.ts`

**任务**:
1. 导入改为 `fs.promises` (保留 existsSync 用于 loadAll)
2. `save()` 改为 `async save()`
3. `updateWebhook()` 改为 `async updateWebhook()`
4. `delete()` 改为 `async delete()`
5. `loadAll()` 保持同步（使用 existsSync, readdirSync, readFileSync）

**代码示例**:
```typescript
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { join } from 'path';

// 同步方法（启动时）
loadAll(): void {
  // 保持 existsSync, readdirSync, readFileSync
}

// 异步方法（运行时）
async save(identity: AgentIdentity): Promise<void> {
  await fs.writeFile(...);
}

async updateWebhook(agentId: string, webhook?: AgentWebhook): Promise<boolean> {
  await fs.writeFile(...);
}

async delete(agentId: string): Promise<boolean> {
  await fs.rm(filePath);
}
```

---

### Phase 2a: 修改 AgentHandler 调用点

**文件**: `packages/daemon/src/handlers/agent-handler.ts`

**调用点**:
- `handleRegisterAgent()` 约 Line 263: `this.identityStore.save(identity)`
- `handleRegisterAgent()` 约 Line 158, 165: `this.identityStore.updateWebhook()`
- `handleUnregisterAgent()` 约 Line 308: `this.identityStore.delete(agentId)`
- `handleUpdateWebhook()` 约 Line 426: `this.identityStore.updateWebhook()`
- `handleVerifyAgent()` 约 Line 508, 560: `this.identityStore.get()` + `save()`

**任务**: 所有调用改为 `await this.identityStore.xxx()`

---

### Phase 2b: 修改类型定义

**文件**: `packages/daemon/src/types/handlers.ts`

**任务**: 更新 AgentIdentityStore 的类型引用（方法签名变化）

---

### Phase 3: 更新测试

**文件**: `packages/daemon/tests/agent-identity-store.test.ts`

**任务**: 测试方法改为 async，使用 await

---

## 执行顺序

```
Phase 1 (AgentIdentityStore 类)
    │
    ├── Phase 2a (AgentHandler) ──┐
    │                             │
    ├── Phase 2b (types) ────────┼──→ Phase 3 (Tests)
    │                             │
    └── Phase 2c (ControlServer) ─┘
        (loadAll 保持同步，无需改)
```

Phase 2a/2b/2c 可并行执行。

---

## 验证

- `npm run build` 编译通过
- `npm test` 224 测试通过