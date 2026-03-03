---
name: f2a-network
description: Activate when the user wants to discover, connect, or communicate with other OpenClaw Agents in the local network. Use for P2P networking, messaging between agents, invoking skills on remote agents, file sharing, or group chat.
---

# F2A Agent 使用指南

F2A (Friend-to-Agent) 是一个 TypeScript 实现的 P2P 协作网络协议。

## 安装

```bash
npm install
npm run build
```

## 快速开始

```typescript
import { F2A } from './dist/index.js';

const f2a = await F2A.create({
  p2pPort: 9000,
  security: { level: 'medium', requireConfirmation: true }
});

await f2a.start();
```

## 更多文档

- 详细文档：`docs/`
- 协议规范：`skill/references/`