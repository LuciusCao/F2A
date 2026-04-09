# Bug 预防指南

基于 2026-04-09 修复的三个 Bug，总结预防措施。

---

## Bug 1: multiaddrs 选择问题

### 问题
CatPi 广播了 3 个地址（localhost、LAN、Tailscale），Mac mini 选择 `multiaddrs[0]` 时选了 localhost，导致连接到自己。

### 根因
```typescript
// 错误：直接选择第一个地址
connection = await this.node.dial(peerInfo.multiaddrs[0]);
```

### 预防措施

#### 1. 单元测试
```typescript
// packages/network/tests/core/p2p-network-address.test.ts
describe('selectBestAddress', () => {
  it('should filter localhost addresses', () => {
    const addrs = [
      '/ip4/127.0.0.1/tcp/9000/p2p/...',
      '/ip4/192.168.2.55/tcp/9000/p2p/...',
    ];
    const selected = selectBestAddress(addrs);
    expect(selected).not.toContain('127.0.0.1');
  });
  
  it('should prefer LAN over Tailscale', () => {
    const addrs = [
      '/ip4/100.69.111.63/tcp/9000/p2p/...',  // Tailscale
      '/ip4/192.168.2.55/tcp/9000/p2p/...',    // LAN
    ];
    const selected = selectBestAddress(addrs);
    expect(selected).toContain('192.168.2.55');
  });
});
```

#### 2. 抽取函数
```typescript
// packages/network/src/core/p2p-network.ts
/**
 * 选择最佳连接地址
 * - 过滤 localhost
 * - 优先 LAN > Tailscale > 公网
 */
private selectBestAddress(multiaddrs: Multiaddr[]): Multiaddr {
  const localhostPatterns = [/127\.0\.0\.1/, /0\.0\.0\.0/, /::1/, /localhost/];
  const isLocalhost = (addr: Multiaddr) => 
    localhostPatterns.some(p => p.test(addr.toString()));
  
  // 过滤 localhost
  const nonLocalhost = multiaddrs.filter(addr => !isLocalhost(addr));
  if (nonLocalhost.length === 0) {
    this.logger.warn('Only localhost addresses available');
    return multiaddrs[0];
  }
  
  // 优先 LAN（192.168.x.x, 10.x.x.x）
  const lanPattern = /\/ip4\/(192\.168\.|10\.)/;
  const lanAddr = nonLocalhost.find(addr => lanPattern.test(addr.toString()));
  if (lanAddr) return lanAddr;
  
  return nonLocalhost[0];
}
```

---

## Bug 2: 事件名不匹配

### 问题
`F2ACore` 监听 `message:received`，但 `F2A` 类发射的是 `peer:message`。

### 根因
- `F2AEvents` 定义了 `peer:message`
- 但 `F2ACore` 使用字符串 `'message:received'` 没有类型检查

### 预防措施

#### 1. 导出类型
```typescript
// packages/openclaw-f2a/src/types.ts
import { F2AEvents } from '@f2a/network';

// 约束消息回调类型
export type MessageCallback = F2AEvents['peer:message'];
```

#### 2. 使用类型约束
```typescript
// packages/openclaw-f2a/src/F2ACore.ts
// 修改前
(this.state.f2a as any).on('message:received', callback);  // 无类型检查

// 修改后
import type { F2AEvents } from '@f2a/network';
(this.state.f2a as EventEmitter<F2AEvents>).on('peer:message', callback);  // 类型安全
```

#### 3. 集成测试
```typescript
// packages/network/tests/integration/message-routing.test.ts
describe('message routing', () => {
  it('should emit peer:message when receiving MESSAGE type', async () => {
    const f2a = await F2A.create({ ... });
    
    const messagePromise = new Promise(resolve => {
      f2a.on('peer:message', resolve);
    });
    
    // 模拟收到 MESSAGE
    await simulateIncomingMessage(f2a, { type: 'MESSAGE', payload: { ... } });
    
    const event = await messagePromise;
    expect(event).toBeDefined();
  });
});
```

---

## Bug 3: 部署路径错误

### 问题
部署到 `~/.npm-global/` 但实际运行在 `/mnt/ssd/openclaw/`。

### 根因
- CatPi 有多个 OpenClaw 安装位置
- 部署脚本没有检查实际运行位置

### 预防措施

#### 1. 部署脚本验证
```bash
#!/bin/bash
# scripts/deploy-to-catpi.sh

# 1. 检测实际运行位置
RUNNING_PATH=$(ssh lucius@CatPi.local "ps aux | grep openclaw-gateway | grep -v grep | awk '{print \$NF}' | head -1")
if [[ "$RUNNING_PATH" == *"/mnt/ssd"* ]]; then
  DEPLOY_PATH="/mnt/ssd/openclaw/extensions/openclaw-f2a"
else
  DEPLOY_PATH="$HOME/.npm-global/lib/node_modules/openclaw/extensions/openclaw-f2a"
fi

echo "Deploying to: $DEPLOY_PATH"

# 2. 部署
rsync -av packages/openclaw-f2a/dist/ lucius@CatPi.local:$DEPLOY_PATH/dist/

# 3. 验证
ssh lucius@CatPi.local "grep 'peer:message' $DEPLOY_PATH/dist/F2ACore.js | head -1"
if [ $? -ne 0 ]; then
  echo "❌ Deployment verification failed!"
  exit 1
fi
echo "✅ Deployment verified"
```

#### 2. 启动时检查
```typescript
// packages/openclaw-f2a/src/plugin.ts
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
console.log('[F2A] Plugin loaded from:', __dirname);
// 确保日志中出现实际加载路径，便于排查部署问题
```

---

## 总结

| 问题 | 预防措施 | 自动化程度 |
|------|----------|------------|
| multiaddrs 选择 | 单元测试 + 抽取函数 | ⭐⭐⭐ CI 自动运行 |
| 事件名不匹配 | 类型约束 + 集成测试 | ⭐⭐⭐ 编译时检查 + CI |
| 部署路径错误 | 部署脚本验证 + 启动日志 | ⭐⭐ 手动运行 + 日志确认 |

**核心原则**：
1. **类型安全**：使用 TypeScript 类型约束，避免字符串魔法值
2. **测试覆盖**：关键路径必须有单元测试
3. **部署验证**：部署后自动验证关键代码是否存在
4. **日志可追溯**：启动时记录实际路径，便于排查