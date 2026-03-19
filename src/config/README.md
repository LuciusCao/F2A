# F2A 配置中心

统一的配置类型管理，解决配置类型分散在多个文件的问题。

## 目录结构

```
src/config/
├── types.ts      # 核心配置类型定义
├── defaults.ts   # 默认配置值
└── index.ts      # 统一导出入口
```

## 配置层级

### 1. 核心配置（本模块）

以下配置类型在 `src/config/types.ts` 中集中定义：

- **P2PNetworkConfig** - P2P 网络配置（端口、引导节点、DHT 等）
- **SecurityConfig** - 安全配置（安全级别、白名单、速率限制）
- **F2AOptions** - F2A 节点核心选项
- **WebhookConfig** - Webhook 回调配置
- **TaskDelegateOptions** - 任务委托选项

### 2. 模块配置（保持在内聚模块内）

以下配置类型定义在各自的功能模块中，通过配置中心重导出：

- **ReputationConfig** - `src/core/reputation.ts`
- **EconomyConfig** - `src/core/autonomous-economy.ts`
- **ReviewCommitteeConfig** - `src/core/review-committee.ts`
- **CapabilityManagerConfig** - `src/core/capability-manager.ts`
- **InvitationConfig** - `src/core/reputation-security.ts`
- **IdentityManagerOptions** - `src/core/identity/types.ts`

### 3. 适配器配置（独立管理）

以下配置类型定义在 OpenClaw 适配器包中：

- **F2ANodeConfig** - `packages/openclaw-adapter/src/types.ts`
- **F2APluginConfig** - `packages/openclaw-adapter/src/types.ts`
- **WebhookPushConfig** - `packages/openclaw-adapter/src/types.ts`

### 4. CLI 配置

CLI 配置使用 Zod schema 定义，保持独立：

- **F2AConfig** - `src/cli/config.ts`

## 使用方式

### 导入类型

```typescript
// 推荐：从配置中心导入
import type { 
  P2PNetworkConfig, 
  SecurityConfig, 
  F2AOptions 
} from '@f2a/config';

// 向后兼容：从旧位置导入（自动重导出）
import type { 
  P2PNetworkConfig, 
  SecurityConfig 
} from '@f2a/network';
```

### 使用默认值

```typescript
import { 
  DEFAULT_P2P_NETWORK_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_F2A_OPTIONS 
} from '@f2a/config';

// 使用默认值创建配置
const config: F2AOptions = {
  ...DEFAULT_F2A_OPTIONS,
  displayName: 'My-Node',
};
```

### 配置验证

```typescript
import { 
  validateP2PNetworkConfig,
  validateSecurityConfig,
  mergeConfig 
} from '@f2a/config';

// 验证配置
const result = validateP2PNetworkConfig(config);
if (!result.valid) {
  console.error('Config errors:', result.errors);
}

// 深度合并配置
const merged = mergeConfig(DEFAULT_F2A_OPTIONS, partialConfig);
```

## 设计原则

1. **单一职责** - 核心配置集中管理，模块配置保持内聚
2. **向后兼容** - 旧导入路径继续工作，通过重导出实现
3. **类型安全** - 所有配置都有明确的 TypeScript 类型定义
4. **默认值统一** - 所有默认值集中在 `defaults.ts` 中

## 迁移指南

### 从 `src/types/index.ts` 迁移

现有代码无需修改，`src/types/index.ts` 已自动重导出所有核心配置类型。

### 从模块直接导入迁移

```typescript
// 旧方式
import type { ReputationConfig } from '../core/reputation.js';

// 新方式（推荐）
import type { ReputationConfig } from '../config/index.js';
```

注意：模块配置仍然定义在各自的模块文件中，配置中心只是重导出。

## 维护指南

### 添加新的核心配置

1. 在 `src/config/types.ts` 中定义类型
2. 在 `src/config/defaults.ts` 中添加默认值
3. 在 `src/config/index.ts` 中导出

### 添加新的模块配置

1. 在模块文件中定义类型和默认值
2. 在 `src/config/types.ts` 中添加重导出（可选）
3. 在 `src/config/index.ts` 中重导出（便于统一导入）

## 解决的问题

1. ✅ 统一核心配置类型定义
2. ✅ 消除重复的配置类型定义
3. ✅ 保持模块配置的内聚性
4. ✅ 保持向后兼容
5. ✅ 统一默认值管理