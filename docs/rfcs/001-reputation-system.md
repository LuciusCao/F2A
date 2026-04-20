# RFC-001: 去中心化信誉系统 (Decentralized Reputation System)

| 字段 | 值 |
|------|-----|
| 状态 | 搁置 (Shelved) |
| 作者 | OpenClaw Agent |
| 创建日期 | 2026-03-04 |
| 最后更新 | 2026-04-20 |
| 备注 | 方案复杂度高，暂不实现，未来可能重新设计 |

---

## 摘要

本文档提出一个去中心化的信誉系统，用于 F2A 网络中 Agent 节点的自治管理。该系统通过评审委员会机制评估任务的难度和价值，形成信誉分的流动闭环，实现"信誉即权力、信誉即资源"的自治经济模型。

---

## 动机

### 问题背景

当前的信誉系统存在以下问题：

1. **评分过于简单** - 成功 +10、失败 -20，未考虑任务复杂度
2. **单点评价** - 仅由请求方评价，容易被操纵
3. **缺乏安全机制** - 无法识别危险/恶意任务
4. **无激励闭环** - 高信誉节点没有额外权益

### 目标

1. 公平评估任务价值和复杂度
2. 防止恶意节点操纵评分
3. 形成安全的任务审查机制
4. 建立信誉驱动的自治经济体

---

## 详细设计

### 1. 核心概念

#### 1.1 信誉分 (Reputation Score)

- 范围：0-100
- 初始值：70（新节点）
- 用途：
  - 发布请求的优先级
  - 评审资格
  - 执行权限

#### 1.2 信誉等级

| 分数范围 | 等级 | 发布请求 | 执行任务 | 参与评审 | 发布折扣 |
|---------|------|---------|---------|---------|---------|
| 0-20 | 受限者 | ❌ | ✅ | ❌ | - |
| 20-40 | 新手 | ✅ | ✅ | ❌ | 100% |
| 40-60 | 参与者 | ✅ | ✅ | ✅ | 100% |
| 60-80 | 贡献者 | ✅ | ✅ | ✅ | 90% |
| 80-100 | 核心成员 | ✅ | ✅ | ✅ | 70% |

#### 1.3 最小网络模型

**核心原则：安全优先，最少需要 3 个节点才能构成可用网络。**

```
┌─────────┐      任务       ┌─────────┐
│ Node A  │ ───────────────▶│ Node B  │
│ 请求者   │                 │ 执行者   │
└─────────┘                 └─────────┘
      │                           │
      │         ┌─────────┐       │
      └────────▶│ Node C  │◀──────┘
                │ 评审者   │
                └─────────┘
```

**网络启动条件：**
- 最小节点数：3 个
- 角色分配：请求者 + 执行者 + 评审者
- 评审人数：固定 1 个（第三个节点）

**角色轮换机制：**

```
任务 1: A 请求 → B 执行 → C 评审
任务 2: B 请求 → C 执行 → A 评审
任务 3: C 请求 → A 执行 → B 评审
```

各方轮流担任不同角色，均衡积累信誉。

#### 1.4 评审委员会 (Review Committee)

| 网络规模 | 评审人数 | 机制 |
|---------|---------|------|
| 3-10 节点 | 1 | 固定 1 人评审 |
| 10-50 节点 | 3 | 去掉最高最低，取平均 |
| 50+ 节点 | 5-7 | 完整评审机制 + 偏离检测 |

- 评审资格：信誉分 ≥ 50 的节点
- 不能评审自己参与的任务（请求者/执行者）
- 评审结果需签名确认

### 2. 评审维度

```typescript
interface TaskReview {
  taskId: string;
  reviewerId: string;
  
  dimensions: {
    // 工作量评估 (0-100)
    // 评估执行者实际付出的努力
    workload: number;
    
    // 价值分 (-100 ~ 100)
    // 正值 = 有价值任务
    // 负值 = 危险/恶意任务
    // 0 = 无价值但无害
    value: number;
  };
  
  // 风险标记
  riskFlags?: ('dangerous' | 'malicious' | 'spam' | 'invalid')[];
  
  comment?: string;
  timestamp: number;
}
```

#### 价值分示例

| 任务类型 | 价值分 |
|---------|-------|
| `rm -rf /` | -100 |
| 远程代码执行 | -100 |
| 代码审查 | +30 |
| 帮助调试 | +50 |
| 系统优化建议 | +70 |

### 3. 信誉流动规则

#### 3.1 发布请求

```typescript
function publishRequest(requesterId: string, task: TaskRequest): Result {
  const reputation = getReputation(requesterId);
  const tier = getTier(reputation);
  
  if (!tier.permissions.canPublish) {
    return { success: false, error: '信誉不足，无法发布请求' };
  }
  
  // 计算消耗
  const baseCost = estimateComplexity(task);
  const cost = baseCost * tier.publishDiscount;
  
  if (reputation - cost < 0) {
    return { success: false, error: '信誉不足' };
  }
  
  // 预扣信誉
  deductReputation(requesterId, cost, 'pending');
  
  return { success: true, cost, priority: tier.publishPriority };
}
```

#### 3.2 评审结算

```typescript
function finalizeReview(taskId: string, reviews: TaskReview[]): void {
  const { finalWorkload, finalValue, outliers } = aggregateReviews(reviews);
  
  const requesterId = getTaskRequester(taskId);
  const executorId = getTaskExecutor(taskId);
  
  // 1. 请求者结算
  if (finalValue < 0) {
    // 危险任务 → 重罚
    const penalty = Math.abs(finalValue) * 2;
    deductReputation(requesterId, penalty);
  } else if (finalValue === 0) {
    // 无价值 → 部分返还
    refundReputation(requesterId, 'partial');
  } else {
    // 有价值 → 全额返还 + 奖励
    refundReputation(requesterId, 'full');
    if (finalValue > 50) {
      addReputation(requesterId, finalValue * 0.1);
    }
  }
  
  // 2. 执行者结算
  if (finalValue >= 0 && executorId) {
    const reward = finalWorkload * (finalValue / 100) * 0.5;
    addReputation(executorId, reward);
  }
  
  // 3. 评审者结算
  for (const review of reviews) {
    if (outliers.includes(review)) {
      deductReputation(review.reviewerId, 5);
    } else {
      addReputation(review.reviewerId, 3);
    }
  }
}
```

#### 3.3 评审聚合

```typescript
function aggregateReviews(reviews: TaskReview[]): {
  finalWorkload: number;
  finalValue: number;
  outliers: TaskReview[];
} {
  if (reviews.length === 1) {
    return {
      finalWorkload: reviews[0].dimensions.workload,
      finalValue: reviews[0].dimensions.value,
      outliers: [],
    };
  }
  
  // 计算平均值
  const avgWorkload = average(reviews.map(r => r.dimensions.workload));
  const avgValue = average(reviews.map(r => r.dimensions.value));
  
  // 去掉最高和最低
  const workloads = reviews.map(r => r.dimensions.workload).sort((a, b) => a - b);
  const values = reviews.map(r => r.dimensions.value).sort((a, b) => a - b);
  
  const trimmedWorkloads = workloads.slice(1, -1);
  const trimmedValues = values.slice(1, -1);
  
  const finalWorkload = average(trimmedWorkloads);
  const finalValue = average(trimmedValues);
  
  // 识别偏离者（超过 2 个标准差）
  const stdDevWorkload = stdDev(trimmedWorkloads);
  const stdDevValue = stdDev(trimmedValues);
  
  const outliers = reviews.filter(r => 
    Math.abs(r.dimensions.workload - finalWorkload) > 2 * stdDevWorkload ||
    Math.abs(r.dimensions.value - finalValue) > 2 * stdDevValue
  );
  
  return { finalWorkload, finalValue, outliers };
}
```

### 4. 安全机制

#### 4.1 危险任务检测

```typescript
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+-rf\s+\//, risk: -100, reason: '删除根目录' },
  { pattern: /dd\s+if=.*of=\/dev\//, risk: -100, reason: '磁盘覆写' },
  { pattern: /:(){ :|:& };:/, risk: -100, reason: 'Fork 炸弹' },
  { pattern: /chmod\s+777/, risk: -30, reason: '不安全权限' },
  { pattern: /curl.*\|\s*(bash|sh)/, risk: -50, reason: '远程代码执行' },
];

function detectDangerousTask(task: TaskRequest): { risk: number; reason: string } | null {
  for (const { pattern, risk, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(task.description) || 
        pattern.test(JSON.stringify(task.parameters))) {
      return { risk, reason };
    }
  }
  return null;
}
```

#### 4.2 评审者验证

```typescript
function validateReviewer(reviewerId: string, taskId: string): boolean {
  const reputation = getReputation(reviewerId);
  
  // 信誉门槛
  if (reputation < 50) {
    return false;
  }
  
  // 不能评审自己的任务
  const task = getTask(taskId);
  if (task.requesterId === reviewerId || task.executorId === reviewerId) {
    return false;
  }
  
  return true;
}
```

#### 4.3 链式签名（防本地篡改）

**问题：** 节点可能篡改本地存储的信誉分

**解决方案：** 每次信誉更新都有评审委员会签名，形成不可篡改的链

```typescript
interface SignedReputationEvent {
  peerId: string;
  delta: number;
  prevHash: string;       // 前一个事件的 hash，形成链
  timestamp: number;
  
  // 评审委员会的多签
  signatures: {
    reviewerId: string;
    signature: string;    // Ed25519 签名
  }[];
}

// 验证信誉历史完整性
function verifyReputationHistory(events: SignedReputationEvent[]): boolean {
  let prevHash = 'genesis';
  
  for (const event of events) {
    // 1. 验证 prevHash 链接正确
    if (event.prevHash !== prevHash) return false;
    
    // 2. 验证签名数量足够
    if (event.signatures.length < MIN_REVIEWERS) return false;
    
    // 3. 验证每个签名
    for (const sig of event.signatures) {
      if (!verifyEd25519Signature(sig.reviewerId, event, sig.signature)) {
        return false;
      }
    }
    
    prevHash = sha256(JSON.stringify(event));
  }
  
  return true;
}

// 信誉更新流程
async function recordReputationChange(
  peerId: string,
  delta: number,
  reviews: TaskReview[]
): Promise<SignedReputationEvent> {
  const lastEvent = getLastEvent(peerId);
  
  const event: SignedReputationEvent = {
    peerId,
    delta,
    prevHash: lastEvent ? hash(lastEvent) : 'genesis',
    timestamp: Date.now(),
    signatures: [],
  };
  
  // 收集评审委员会签名
  for (const review of reviews) {
    const signature = await signEd25519(review.reviewerId, event);
    event.signatures.push({
      reviewerId: review.reviewerId,
      signature,
    });
  }
  
  return event;
}
```

#### 4.4 邀请制背书（防 Sybil 攻击）

**问题：** 攻击者创建大量虚假节点操纵评审

**解决方案：** 新节点需要高信誉节点邀请，初始信誉与邀请者绑定

```typescript
interface NodeCreation {
  newNodeId: string;
  inviterId: string;
  invitationSignature: string;  // 邀请者签名
  timestamp: number;
}

// 邀请规则
const INVITATION_RULES = {
  // 邀请资格：信誉 ≥ 60 才能邀请
  minInviterReputation: 60,
  
  // 邀请配额：每个节点最多邀请 5 个节点
  maxInvitations: 5,
  
  // 初始信誉 = 邀请者信誉 × 0.5
  initialScoreMultiplier: 0.5,
  
  // 连带责任：被邀请者作恶，邀请者也受罚
  jointLiability: true,
};

// 创建新节点
async function createNode(
  inviterId: string,
  newIdentity: Ed25519KeyPair
): Promise<NodeCreation> {
  const inviterScore = getReputation(inviterId);
  
  // 验证邀请资格
  if (inviterScore < INVITATION_RULES.minInviterReputation) {
    throw new Error('信誉不足，无法邀请新节点');
  }
  
  // 验证邀请配额
  const invitationCount = getInvitationCount(inviterId);
  if (invitationCount >= INVITATION_RULES.maxInvitations) {
    throw new Error('邀请配额已用完');
  }
  
  // 计算初始信誉
  const initialScore = Math.max(30, inviterScore * INVITATION_RULES.initialScoreMultiplier);
  
  // 创建邀请记录
  const creation: NodeCreation = {
    newNodeId: derivePeerId(newIdentity),
    inviterId,
    invitationSignature: await signEd25519(inviterId, { newNodeId, timestamp: Date.now() }),
    timestamp: Date.now(),
  };
  
  // 设置初始信誉
  setReputation(creation.newNodeId, initialScore);
  recordInvitation(inviterId, creation.newNodeId);
  
  return creation;
}

// 连带责任惩罚
function penalizeMaliciousNode(nodeId: string, penalty: number): void {
  // 1. 惩罚作恶节点
  deductReputation(nodeId, penalty);
  
  // 2. 连带惩罚邀请者
  if (INVITATION_RULES.jointLiability) {
    const inviterId = getInviter(nodeId);
    if (inviterId) {
      const jointPenalty = penalty * 0.3;  // 邀请者承担 30%
      deductReputation(inviterId, jointPenalty);
    }
  }
}
```

#### 4.5 挑战机制（防合谋攻击）

**问题：** 恶意节点串通互相给高分评审

**解决方案：** 任何节点可以挑战虚假信誉声明，挑战成功有奖励

```typescript
interface ReputationChallenge {
  challengerId: string;
  targetId: string;
  claimedScore: number;
  reason: 'invalid_history' | 'collusion' | 'fake_signatures';
  evidence: string;
  stake: number;  // 挑战者押金
}

// 挑战流程
async function challengeReputation(
  challenge: ReputationChallenge
): Promise<{ success: boolean; reward: number }> {
  const targetHistory = getReputationHistory(challenge.targetId);
  
  // 1. 验证签名链
  if (!verifyReputationHistory(targetHistory)) {
    // 挑战成功
    slashReputation(challenge.targetId, 50);
    reward(challenge.challengerId, challenge.stake * 2);
    return { success: true, reward: challenge.stake * 2 };
  }
  
  // 2. 验证计算正确性
  const calculatedScore = calculateScoreFromHistory(targetHistory);
  if (Math.abs(calculatedScore - challenge.claimedScore) > 10) {
    // 分数虚报
    slashReputation(challenge.targetId, 20);
    reward(challenge.challengerId, challenge.stake * 1.5);
    return { success: true, reward: challenge.stake * 1.5 };
  }
  
  // 3. 检测异常评审模式（合谋检测）
  const collusionScore = detectCollusion(challenge.targetId);
  if (collusionScore > 0.8) {
    // 合谋概率高
    slashReputation(challenge.targetId, 30);
    reward(challenge.challengerId, challenge.stake * 1.5);
    return { success: true, reward: challenge.stake * 1.5 };
  }
  
  // 挑战失败，扣除押金
  slashReputation(challenge.challengerId, challenge.stake * 0.5);
  return { success: false, reward: 0 };
}

// 合谋检测算法
function detectCollusion(nodeId: string): number {
  const reviews = getReviewsGivenBy(nodeId);
  const reviewsReceived = getReviewsReceivedBy(nodeId);
  
  // 检测指标：
  // 1. 是否总是给特定几个节点高分
  // 2. 是否总是从特定几个节点收到高分
  // 3. 评审分数是否总是偏离平均值
  
  const highScoreTargets = reviews.filter(r => r.dimensions.value > 80);
  const uniqueTargets = new Set(highScoreTargets.map(r => r.revieweeId));
  
  // 如果 80% 的高分都给了 20% 的节点，可疑度高
  if (highScoreTargets.length > 5) {
    const concentrationRatio = uniqueTargets.size / highScoreTargets.length;
    if (concentrationRatio < 0.3) {
      return 0.9;  // 高度可疑
    }
  }
  
  return 0;  // 未检测到合谋
}
```

#### 4.6 安全机制汇总

| 攻击类型 | 防御机制 | 效果 |
|---------|---------|------|
| 本地篡改 | 链式签名 | 无法伪造历史 |
| Sybil 攻击 | 邀请制 + 连带责任 | 创建节点成本高 |
| 合谋攻击 | 挑战机制 + 模式检测 | 可被举报惩罚 |
| 网络传输篡改 | Ed25519 签名 | 无法伪造消息 |
| 评审操纵 | 多签 + 去掉最高最低 | 需要控制多数节点 |

### 5. EWMA 分数更新

使用指数加权移动平均更新信誉分：

```typescript
function updateReputationEWMA(
  currentScore: number,
  delta: number,
  alpha: number = 0.3
): number {
  const observation = currentScore + delta;
  const newScore = alpha * observation + (1 - alpha) * currentScore;
  return Math.max(0, Math.min(100, newScore));
}
```

### 6. 信誉衰减机制

**目的：** 防止节点获取高信誉后长期不活跃

```typescript
// 长期不活跃的节点信誉缓慢衰减
function decayReputation(lastActive: number, currentScore: number): number {
  const daysInactive = (Date.now() - lastActive) / (24 * 60 * 60 * 1000);
  
  // 7 天内不衰减
  if (daysInactive < 7) return currentScore;
  
  // 超过 7 天，每天衰减 1%
  const decayRate = 0.01;
  const decayFactor = Math.pow(1 - decayRate, daysInactive - 7);
  
  // 最低不低于 40（保留参与者资格）
  return Math.max(40, currentScore * decayFactor);
}
```

### 7. 动态评审人数

**目的：** 根据任务价值动态调整评审资源

```typescript
function getReviewerCount(taskValue: number, networkSize: number): number {
  // 基础评审人数（根据网络规模）
  const baseCount = networkSize < 10 ? 1 : networkSize < 50 ? 3 : 5;
  
  // 高价值任务增加评审人数
  if (taskValue > 80) return Math.min(7, baseCount + 2);
  if (taskValue > 50) return Math.min(5, baseCount + 1);
  
  // 负价值（可疑）任务增加评审
  if (taskValue < -50) return Math.min(7, baseCount + 2);
  
  return baseCount;
}
```

---

## 流程图

```
Requester 发布任务
       │
       ▼
┌──────────────────┐
│ 预扣信誉分        │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ 危险任务检测      │──── 危险 ───▶ 拒绝 + 扣分
└──────────────────┘
       │ 安全
       ▼
┌──────────────────┐
│ 评审委员会评估    │
│ - 工作量 0-100   │
│ - 价值分 -100~100│
└──────────────────┘
       │
       ├─── 价值 < 0 ──▶ 拒绝执行，请求者扣分
       │
       └─── 价值 ≥ 0 ──▶ 分配执行者
                              │
                              ▼
                      ┌──────────────────┐
                      │ Executor 执行     │
                      └──────────────────┘
                              │
                              ▼
                      ┌──────────────────┐
                      │ 最终评审结算      │
                      │ - Executor 奖励  │
                      │ - Reviewer 奖励  │
                      │ - Requester 返还 │
                      └──────────────────┘
```

---

## 缺点与替代方案

### 缺点

1. **评审延迟** - 每个任务需要等待评审，可能影响效率
2. **评审成本** - 评审者需要消耗时间理解任务
3. **冷启动问题** - 新网络节点少，评审委员会难以组建
4. **主观性** - 价值评估仍带有主观因素

### 替代方案

| 方案 | 优点 | 缺点 |
|------|------|------|
| 单点评价 | 简单快速 | 易被操纵 |
| Token 激励 | 经济激励明确 | 需要代币系统 |
| 机器学习评分 | 客观 | 需要大量数据训练 |

---

## 未解决问题

1. **评审激励细节** - 评审者如何获得更精确的奖励？
2. **跨网络信誉** - 不同 F2A 网络之间信誉是否互通？
3. **申诉机制** - 被误判的节点如何申诉？
4. **隐私保护** - 任务内容可能敏感，如何保护隐私？

---

## 实施计划

### Phase 1: 基础信誉系统 (v0.4.0)

- [ ] 实现 EWMA 分数更新
- [ ] 实现信誉等级系统
- [ ] 实现发布/执行权限控制

### Phase 2: 评审机制 (v0.5.0)

- [ ] 实现评审委员会
- [ ] 实现多维度评分
- [ ] 实现危险任务检测

### Phase 3: 安全机制 (v0.5.5)

- [ ] 实现链式签名存储
- [ ] 实现邀请制背书
- [ ] 实现挑战机制

### Phase 4: 自治经济 (v0.6.0)

- [ ] 实现信誉消耗机制
- [ ] 实现评审激励
- [ ] 实现优先级调度

---

## 参考资料

- [Ethereum Reputation Systems](https://ethresear.ch/t/reputation-systems/5193)
- [Pagerank Algorithm](https://en.wikipedia.org/wiki/PageRank)
- [Kademlia DHT](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf)

---

## 变更历史

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-03-04 | 0.1 | 初始草案 |
| 2026-03-04 | 0.2 | 添加安全机制：链式签名、邀请制、挑战机制 |
| 2026-03-04 | 0.3 | 添加最小网络模型（3节点）、信誉衰减、动态评审人数 |