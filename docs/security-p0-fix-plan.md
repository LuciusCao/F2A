# F2A Phase 0 P0 安全问题修复方案

**版本**: 1.0  
**日期**: 2026-03-12  
**作者**: 安全专家 (subagent)  
**状态**: Phase 0 安全修复设计

---

## 一、威胁模型更新

### 1.1 基于新架构的威胁分析

基于 Phase 0 各专家完成的架构设计，我们更新威胁模型如下：

```
┌─────────────────────────────────────────────────────────────────┐
│                        F2A 网络威胁全景图                        │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   网络层威胁      │     │   身份层威胁      │     │   应用层威胁      │
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│ • 中间人攻击      │     │ • Sybil 攻击      │     │ • 恶意任务注入    │
│ • 重放攻击        │     │ • 身份伪造        │     │ • 权限提升        │
│ • 窃听            │     │ • 信誉篡改        │     │ • 数据泄露        │
│ • DoS/DDoS       │     │ • 邀请链攻击      │     │ • 合谋操纵        │
│ • 路由污染        │     │ • 密钥泄露        │     │ • 评审贿赂        │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### 1.2 威胁等级评估

| 威胁 | 可能性 | 影响 | 风险等级 | 当前防护 | 剩余风险 |
|------|--------|------|----------|----------|----------|
| **E2EE 中间人攻击** | 中 | 高 | 🔴 P0 | 基础 ECDH | **无公钥验证** |
| **Sybil 攻击** | 高 | 高 | 🔴 P0 | 初始信誉 70 | **无门槛** |
| **内网横向渗透** | 中 | 高 | 🔴 P0 | 无 | **无节点认证** |
| 重放攻击 | 中 | 中 | 🟡 P1 | 时间戳 + nonce | 已缓解 |
| 信誉篡改 | 低 | 高 | 🟡 P1 | 本地存储 | 链式签名设计中 |
| 合谋操纵 | 低 | 中 | 🟢 P2 | 多评审 | 挑战机制设计中 |

### 1.3 攻击者画像

| 类型 | 能力 | 目标 | 攻击向量 |
|------|------|------|----------|
| **机会主义攻击者** | 低 | 获取资源 | Sybil 攻击、刷信誉 |
| **定向攻击者** | 中 | 窃取数据 | 中间人、内网渗透 |
| **APT 组织** | 高 | 长期潜伏 | 供应链攻击、0day |

---

## 二、P0 问题修复方案

### P0-1: E2EE 中间人攻击风险

#### 2.1.1 攻击场景详细描述

**攻击流程**:
```
┌─────────┐                    ┌─────────┐                    ┌─────────┐
│  Alice  │                    │  Mallory│                    │   Bob   │
│ (请求者) │                    │(攻击者) │                    │ (执行者) │
└────┬────┘                    └────┬────┘                    └────┬────┘
     │                              │                              │
     │  1. 发现请求 (广播)           │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │                              │  2. 伪造发现响应             │
     │                              │  - 替换公钥为攻击者公钥       │
     │                              │  - 保持 Bob 的 PeerId        │
     │<─────────────────────────────│                              │
     │                              │                              │
     │  3. ECDH 密钥交换            │                              │
     │  (实际与 Mallory 建立共享密钥) │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │                              │  4. 与 Bob 建立真实连接       │
     │                              │─────────────────────────────>│
     │                              │                              │
     │  5. 发送加密任务             │                              │
     │─────────────────────────────>│                              │
     │                              │  6. 解密、查看、可能篡改      │
     │                              │  (攻击者可见明文)             │
     │                              │                              │
     │                              │  7. 重新加密转发给 Bob        │
     │                              │─────────────────────────────>│
     │                              │                              │
```

**影响**:
- 攻击者可以**解密所有通信内容**
- 可以**篡改任务参数**（如修改文件路径、注入恶意代码）
- 可以**伪造响应结果**
- 无法被检测（无公钥验证机制）

**先决条件**:
- 攻击者与受害者在同一局域网
- 攻击者能够监听/注入 mDNS 广播

#### 2.1.2 修复方案（技术实现细节）

**方案名称**: **公钥指纹验证 + 信任链 (Web of Trust)**

##### 核心设计

```typescript
// src/core/e2ee-crypto.ts

/**
 * 增强的 E2EE 加密模块 - 支持公钥验证
 */
export class E2EECryptoEnhanced {
  // 本地密钥对
  private keyPair: EncryptionKeyPair;
  
  // 信任存储：peerId → 已验证的公钥指纹
  private trustedKeys: Map<string, string> = new Map();
  
  // 待验证公钥缓存
  private pendingVerifications: Map<string, PendingVerification> = new Map();
  
  /**
   * 获取公钥指纹 (SHA256 前 16 字符)
   */
  getPublicKeyFingerprint(publicKey: Uint8Array): string {
    const hash = sha256(publicKey);
    return Buffer.from(hash).toString('hex').substring(0, 16);
  }
  
  /**
   * 标记公钥为已验证 (通过带外验证或首次安全连接)
   */
  async trustPublicKey(peerId: string, publicKey: Uint8Array): Promise<void> {
    const fingerprint = this.getPublicKeyFingerprint(publicKey);
    this.trustedKeys.set(peerId, fingerprint);
    
    // 持久化到信任存储
    await this.saveTrustedKeys();
  }
  
  /**
   * 验证收到的公钥
   * @returns 'trusted' | 'unverified' | 'mismatch'
   */
  verifyPublicKey(peerId: string, publicKey: Uint8Array): VerificationResult {
    const storedFingerprint = this.trustedKeys.get(peerId);
    
    if (!storedFingerprint) {
      return 'unverified'; // 首次连接，需要验证
    }
    
    const receivedFingerprint = this.getPublicKeyFingerprint(publicKey);
    
    if (storedFingerprint === receivedFingerprint) {
      return 'trusted'; // 公钥匹配
    } else {
      return 'mismatch'; // ⚠️ 公钥不匹配，可能中间人攻击
    }
  }
  
  /**
   * 发起公钥验证挑战 (挑战 - 响应协议)
   */
  async challengeVerification(peerId: string, theirPublicKey: Uint8Array): Promise<boolean> {
    const challenge = randomBytes(32);
    const timestamp = Date.now();
    
    // 使用我们的私钥签名挑战
    const signature = await this.signChallenge(challenge, timestamp);
    
    // 发送验证请求
    const verificationRequest = {
      type: 'KEY_VERIFICATION',
      challenge: Buffer.from(challenge).toString('base64'),
      timestamp,
      signature: Buffer.from(signature).toString('base64'),
      ourPublicKeyFingerprint: this.getPublicKeyFingerprint(this.keyPair.publicKey)
    };
    
    // 等待对方响应
    const response = await this.sendVerificationRequest(peerId, verificationRequest);
    
    // 验证对方签名
    const isValid = await this.verifyChallengeSignature(
      challenge,
      timestamp,
      response.signature,
      theirPublicKey
    );
    
    if (isValid) {
      // 验证成功，信任该公钥
      await this.trustPublicKey(peerId, theirPublicKey);
    }
    
    return isValid;
  }
}
```

##### 协议扩展

**新增消息类型**:
```typescript
// src/types/index.ts

export type F2AMessageType = 
  | 'DISCOVER'
  | 'DISCOVER_RESP'
  | 'KEY_VERIFICATION'        // 新增：公钥验证请求
  | 'KEY_VERIFICATION_RESP'   // 新增：公钥验证响应
  | 'TRUST_REQUEST'           // 新增：信任请求 (Web of Trust)
  | 'TRUST_RESPONSE'          // 新增：信任响应
  // ... 其他类型
```

**KEY_VERIFICATION 消息格式**:
```typescript
interface KeyVerificationMessage {
  type: 'KEY_VERIFICATION';
  // 挑战数据
  challenge: string;  // base64(32 字节随机数)
  timestamp: number;  // Unix 时间戳
  
  // 发送方信息
  senderPeerId: string;
  senderPublicKeyFingerprint: string;  // 指纹用于快速比对
  
  // 签名 (使用发送方私钥签名 challenge + timestamp)
  signature: string;  // base64(Ed25519 签名)
}

interface KeyVerificationResponse {
  type: 'KEY_VERIFICATION_RESP';
  // 原始挑战
  challenge: string;
  
  // 响应签名 (使用接收方私钥签名 challenge)
  responseSignature: string;
  
  // 接收方公钥指纹
  receiverPublicKeyFingerprint: string;
}
```

##### 集成点

**1. mDNS 发现集成**:
```typescript
// src/utils/mdns.ts

// TXT 记录中增加公钥指纹字段
const txtRecords = [
  `peerId=${peerId}`,
  `publicKeyFingerprint=${getPublicKeyFingerprint(publicKey)}`,  // 新增
  `timestamp=${Date.now()}`,
  // ...
];
```

**2. P2P 连接建立流程**:
```typescript
// src/core/p2p-network.ts

async function establishSecureConnection(peerId: string): Promise<void> {
  // 1. mDNS 发现获取公钥指纹
  const discoveredFingerprint = this.mdnsCache.get(peerId)?.publicKeyFingerprint;
  
  // 2. ECDH 密钥交换
  const sharedSecret = await this.e2eeCrypto.deriveSharedSecret(theirPublicKey);
  
  // 3. 公钥验证
  const verificationResult = this.e2eeCrypto.verifyPublicKey(peerId, theirPublicKey);
  
  if (verificationResult === 'mismatch') {
    // ⚠️ 检测到中间人攻击
    this.logger.error('MITM attack detected!', { peerId });
    throw new Error('Public key mismatch - possible MITM attack');
  }
  
  if (verificationResult === 'unverified') {
    // 首次连接，发起挑战 - 响应验证
    const verified = await this.e2eeCrypto.challengeVerification(peerId, theirPublicKey);
    
    if (!verified) {
      throw new Error('Key verification failed');
    }
  }
  
  // 4. 建立加密通道
  // ...
}
```

**3. 用户界面集成 (首次连接确认)**:
```typescript
// CLI 或 GUI 提示
/**
 * ⚠️ 首次连接确认

  你正在与以下节点建立首次连接:
  
  Peer ID: QmXyZ...16Uiu
  公钥指纹: a3f8c9d2e1b4f5a6
  
  请通过其他渠道 (如微信/电话) 确认该指纹是否匹配。
  
  是否信任并继续？[y/N]
*/
```

#### 2.1.3 验收测试用例

```typescript
// tests/security/e2ee-mitm.test.ts

describe('E2EE 中间人攻击防护', () => {
  it('应该检测并阻止公钥不匹配', async () => {
    const alice = await createTestNode();
    const bob = await createTestNode();
    const mallory = await createTestNode();
    
    // Mallory 尝试冒充 Bob
    const fakeBobPublicKey = mallory.e2eeCrypto.getPublicKey();
    
    // Alice 尝试验证 Bob 的公钥 (实际收到 Mallory 的)
    const result = alice.e2eeCrypto.verifyPublicKey(
      bob.peerId,
      fakeBobPublicKey
    );
    
    expect(result).toBe('unverified'); // 首次连接
    expect(result).not.toBe('trusted');
  });
  
  it('应该成功完成挑战 - 响应验证', async () => {
    const alice = await createTestNode();
    const bob = await createTestNode();
    
    // 执行验证流程
    const verified = await alice.e2eeCrypto.challengeVerification(
      bob.peerId,
      bob.e2eeCrypto.getPublicKey()
    );
    
    expect(verified).toBe(true);
    
    // 验证后应该标记为信任
    const secondCheck = alice.e2eeCrypto.verifyPublicKey(
      bob.peerId,
      bob.e2eeCrypto.getPublicKey()
    );
    
    expect(secondCheck).toBe('trusted');
  });
  
  it('应该拒绝被篡改的公钥', async () => {
    const alice = await createTestNode();
    const bob = await createTestNode();
    
    // 首次验证通过
    await alice.e2eeCrypto.trustPublicKey(bob.peerId, bob.e2eeCrypto.getPublicKey());
    
    // 攻击者尝试使用不同的公钥
    const attackerPublicKey = randomBytes(32);
    
    const result = alice.e2eeCrypto.verifyPublicKey(bob.peerId, attackerPublicKey);
    
    expect(result).toBe('mismatch');
  });
  
  it('应该持久化信任的公钥', async () => {
    const alice = await createTestNode();
    const bob = await createTestNode();
    
    // 信任公钥
    await alice.e2eeCrypto.trustPublicKey(bob.peerId, bob.e2eeCrypto.getPublicKey());
    
    // 重启节点
    await alice.restart();
    
    // 信任关系应该保持
    const result = alice.e2eeCrypto.verifyPublicKey(
      bob.peerId,
      bob.e2eeCrypto.getPublicKey()
    );
    
    expect(result).toBe('trusted');
  });
});
```

---

### P0-2: Sybil 攻击无防护

#### 2.2.1 攻击场景详细描述

**攻击流程**:
```
攻击者目标：通过创建大量虚假节点操纵评审委员会

┌─────────────────────────────────────────────────────────────┐
│ 攻击步骤                                                     │
├─────────────────────────────────────────────────────────────┤
│ 1. 自动化脚本创建 100 个虚假节点                              │
│    - 每个节点生成独立 PeerId                                 │
│    - 每个节点获得初始信誉分 70                               │
│    - 成本：几乎为零                                          │
├─────────────────────────────────────────────────────────────┤
│ 2. 虚假节点互相发布任务并执行                                │
│    - Node1 发布任务 → Node2 执行 → Node3 评审                │
│    - 互相给予高评分                                          │
│    - 快速积累信誉分到 80+ (核心成员等级)                     │
├─────────────────────────────────────────────────────────────┤
│ 3. 操纵真实任务评审                                          │
│    - 虚假节点组成评审委员会                                  │
│    - 给恶意任务高评分                                        │
│    - 给竞争对手低评分                                        │
├─────────────────────────────────────────────────────────────┤
│ 4. 控制网络决策                                              │
│    - 占据评审委员会多数席位                                  │
│    - 操纵信誉分分配                                          │
│    - 排除异己节点                                            │
└─────────────────────────────────────────────────────────────┘
```

**影响**:
- 攻击者可以**控制评审委员会**
- 可以**操纵信誉系统**
- 可以**排挤诚实节点**
- 网络**去中心化治理失效**

**成本分析**:
- 创建 100 个节点：~$0 (本地虚拟机)
- 达到核心成员等级 (80 分): ~2-3 天自动化互评
- 总成本：时间成本为主，经济成本几乎为零

#### 2.2.2 修复方案（技术实现细节）

**方案名称**: **邀请制背书 + 渐进式信誉 + 资源证明**

##### 核心设计 1: 邀请制背书 (Invitation-Based Endorsement)

```typescript
// src/core/reputation-invitation.ts

/**
 * 邀请记录
 */
interface InvitationRecord {
  /** 邀请者 PeerId */
  inviterId: string;
  /** 被邀请者 PeerId */
  inviteeId: string;
  /** 邀请时间 */
  createdAt: number;
  /** 邀请者签名 */
  inviterSignature: string;
  /** 状态 */
  status: 'active' | 'used' | 'revoked';
}

/**
 * 邀请规则配置
 */
const INVITATION_RULES = {
  // 邀请资格：信誉分 ≥ 60 (贡献者等级)
  minInviterReputation: 60,
  
  // 邀请配额：基于信誉等级
  invitationQuotas: {
    'restricted': 0,    // 受限者：0 个
    'novice': 0,        // 新手：0 个
    'participant': 1,   // 参与者：1 个
    'contributor': 2,   // 贡献者：2 个
    'core': 5           // 核心成员：5 个
  },
  
  // 初始信誉 = 邀请者信誉 × 0.5，最低 30，最高 50
  initialScoreMultiplier: 0.5,
  minInitialScore: 30,
  maxInitialScore: 50,
  
  // 连带责任系数：被邀请者作恶，邀请者承担 30% 惩罚
  jointLiabilityFactor: 0.3,
  
  // 邀请冷却期：两次邀请之间至少间隔 7 天
  cooldownDays: 7,
};

/**
 * 邀请管理器
 */
export class InvitationManager {
  private invitations: Map<string, InvitationRecord[]> = new Map();
  private reputationManager: ReputationManager;
  
  /**
   * 创建邀请
   */
  async createInvitation(
    inviterId: string,
    inviteePublicKey: string
  ): Promise<Result<InvitationRecord>> {
    const inviterReputation = this.reputationManager.getReputation(inviterId);
    
    // 1. 验证邀请资格
    if (inviterReputation.score < INVITATION_RULES.minInviterReputation) {
      return {
        success: false,
        error: `信誉不足，需要 ${INVITATION_RULES.minInviterReputation} 分，当前 ${inviterReputation.score} 分`
      };
    }
    
    // 2. 检查邀请配额
    const usedInvitations = this.getUsedInvitations(inviterId);
    const quota = INVITATION_RULES.invitationQuotas[inviterReputation.level];
    
    if (usedInvitations >= quota) {
      return {
        success: false,
        error: `邀请配额已用完 (${usedInvitations}/${quota})`
      };
    }
    
    // 3. 检查冷却期
    const lastInvitation = this.getLastInvitation(inviterId);
    if (lastInvitation) {
      const daysSinceLast = (Date.now() - lastInvitation.createdAt) / (1000 * 60 * 60 * 24);
      if (daysSinceLast < INVITATION_RULES.cooldownDays) {
        return {
          success: false,
          error: `冷却期内，${Math.ceil(INVITATION_RULES.cooldownDays - daysSinceLast)} 天后可再次邀请`
        };
      }
    }
    
    // 4. 创建邀请记录
    const invitation: InvitationRecord = {
      inviterId,
      inviteeId: derivePeerIdFromPublicKey(inviteePublicKey),
      createdAt: Date.now(),
      inviterSignature: await this.signInvitation(inviterId, inviteePublicKey),
      status: 'active'
    };
    
    // 5. 保存邀请
    this.saveInvitation(invitation);
    
    return { success: true, data: invitation };
  }
  
  /**
   * 接受邀请 (新节点加入)
   */
  async acceptInvitation(
    invitation: InvitationRecord,
    newIdentity: Ed25519KeyPair
  ): Promise<Result<{ initialScore: number }>> {
    // 1. 验证邀请签名
    const isValid = await this.verifyInvitationSignature(invitation);
    if (!isValid) {
      return { success: false, error: '邀请签名无效' };
    }
    
    // 2. 验证邀请状态
    if (invitation.status !== 'active') {
      return { success: false, error: '邀请已失效' };
    }
    
    // 3. 验证 PeerId 匹配
    const newPeerId = derivePeerIdFromPublicKey(newIdentity.publicKey);
    if (invitation.inviteeId !== newPeerId) {
      return { success: false, error: 'PeerId 不匹配' };
    }
    
    // 4. 计算初始信誉
    const inviterReputation = this.reputationManager.getReputation(invitation.inviterId);
    const initialScore = Math.max(
      INVITATION_RULES.minInitialScore,
      Math.min(
        INVITATION_RULES.maxInitialScore,
        inviterReputation.score * INVITATION_RULES.initialScoreMultiplier
      )
    );
    
    // 5. 设置初始信誉
    await this.reputationManager.setInitialReputation(newPeerId, initialScore);
    
    // 6. 标记邀请为已使用
    invitation.status = 'used';
    
    // 7. 记录邀请关系 (用于连带责任)
    this.recordInvitationRelation(invitation.inviterId, newPeerId);
    
    return { success: true, data: { initialScore } };
  }
  
  /**
   * 连带责任惩罚
   */
  async applyJointLiability(
    maliciousNodeId: string,
    penalty: number
  ): Promise<void> {
    const inviterId = this.getInviter(maliciousNodeId);
    if (!inviterId) return; // 无邀请者 (创世节点)
    
    const jointPenalty = Math.floor(penalty * INVITATION_RULES.jointLiabilityFactor);
    
    // 惩罚邀请者
    await this.reputationManager.deductReputation(inviterId, jointPenalty, 'joint_liability');
    
    // 记录惩罚原因
    this.logger.warn('Applied joint liability', {
      maliciousNode: maliciousNodeId,
      inviter: inviterId,
      penalty: jointPenalty
    });
  }
}
```

##### 核心设计 2: 渐进式信誉 (Progressive Reputation)

```typescript
// src/core/reputation-progressive.ts

/**
 * 渐进式信誉配置
 */
const PROGRESSIVE_RULES = {
  // 信誉上限随时间增长
  // 新节点最高信誉 = min(当前分数, 基础上限 + 每日增长 × 天数)
  baseReputationCap: 50,           // 新节点基础信誉上限
  dailyCapIncrease: 1.25,          // 每日信誉上限增长
  maxReputationCap: 100,           // 最大信誉上限 (40 天后)
  daysToFullCap: 40,               // 达到满上限所需天数
  
  // 每日信誉获取上限
  dailyEarnCap: 15,                // 每日最多获得 15 点信誉
  
  // 信任衰减 (长期不活跃)
  inactivityDecayDays: 30,         // 30 天不活跃开始衰减
  dailyDecayRate: 0.02,            // 每日衰减 2%
  minDecayScore: 40,               // 衰减最低保留 40 分
};

/**
 * 渐进式信誉管理器
 */
export class ProgressiveReputationManager {
  private reputationManager: ReputationManager;
  private nodeAgeCache: Map<string, number> = new Map(); // peerId → 首次发现时间
  
  /**
   * 获取节点年龄 (天)
   */
  getNodeAgeDays(peerId: string): number {
    const firstSeen = this.nodeAgeCache.get(peerId);
    if (!firstSeen) return 0;
    
    return Math.floor((Date.now() - firstSeen) / (1000 * 60 * 60 * 24));
  }
  
  /**
   * 计算当前信誉上限
   */
  calculateReputationCap(peerId: string): number {
    const ageDays = this.getNodeAgeDays(peerId);
    
    const cap = PROGRESSIVE_RULES.baseReputationCap + 
                (ageDays * PROGRESSIVE_RULES.dailyCapIncrease);
    
    return Math.min(cap, PROGRESSIVE_RULES.maxReputationCap);
  }
  
  /**
   * 添加信誉分 (受渐进式限制)
   */
  async addReputation(
    peerId: string,
    delta: number,
    reason: string
  ): Promise<Result<{ added: number; capped: boolean }>> {
    const currentScore = this.reputationManager.getReputation(peerId).score;
    const cap = this.calculateReputationCap(peerId);
    
    // 检查每日获取上限
    const todayEarned = this.getTodayEarned(peerId);
    const remainingDailyCap = PROGRESSIVE_RULES.dailyEarnCap - todayEarned;
    
    if (remainingDailyCap <= 0) {
      return {
        success: false,
        error: '已达到今日信誉获取上限',
        data: { added: 0, capped: true }
      };
    }
    
    // 实际可添加的分数
    const actualDelta = Math.min(delta, remainingDailyCap);
    
    // 检查信誉上限
    const potentialScore = currentScore + actualDelta;
    const cappedScore = Math.min(potentialScore, cap);
    const finalDelta = cappedScore - currentScore;
    
    if (finalDelta <= 0) {
      return {
        success: false,
        error: `已达到当前信誉上限 (${cap} 分，节点年龄 ${this.getNodeAgeDays(peerId)} 天)`,
        data: { added: 0, capped: true }
      };
    }
    
    // 添加信誉
    await this.reputationManager.addReputation(peerId, finalDelta, reason);
    this.recordTodayEarned(peerId, finalDelta);
    
    return {
      success: true,
      data: {
        added: finalDelta,
        capped: potentialScore > cap || delta > remainingDailyCap
      }
    };
  }
  
  /**
   * 应用时间衰减
   */
  applyInactivityDecay(): void {
    const now = Date.now();
    
    for (const [peerId, lastActive] of this.lastActiveCache.entries()) {
      const daysInactive = (now - lastActive) / (1000 * 60 * 60 * 24);
      
      if (daysInactive > PROGRESSIVE_RULES.inactivityDecayDays) {
        const currentScore = this.reputationManager.getReputation(peerId).score;
        const decayFactor = Math.pow(
          1 - PROGRESSIVE_RULES.dailyDecayRate,
          daysInactive - PROGRESSIVE_RULES.inactivityDecayDays
        );
        
        const newScore = Math.max(
          PROGRESSIVE_RULES.minDecayScore,
          Math.floor(currentScore * decayFactor)
        );
        
        this.reputationManager.setReputation(peerId, newScore);
      }
    }
  }
}
```

##### 核心设计 3: 资源证明 (Proof of Resource)

```typescript
// src/core/proof-of-resource.ts

/**
 * 资源证明挑战
 */
interface ResourceChallenge {
  challengeId: string;
  peerId: string;
  challengeType: 'memory' | 'compute' | 'storage';
  difficulty: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * 资源证明验证器
 */
export class ProofOfResourceVerifier {
  /**
   * 生成内存挑战 (要求节点证明拥有至少 X MB 可用内存)
   */
  generateMemoryChallenge(minMemoryMB: number): ResourceChallenge {
    const challengeData = randomBytes(32);
    const hashTarget = Buffer.alloc(32, 0);
    hashTarget[31] = minMemoryMB; // 难度编码
    
    return {
      challengeId: randomUUID(),
      peerId: '', // 待填充
      challengeType: 'memory',
      difficulty: minMemoryMB,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000 // 1 分钟有效
    };
  }
  
  /**
   * 验证内存证明
   */
  async verifyMemoryProof(
    challenge: ResourceChallenge,
    proof: { allocatedMB: number; hash: string }
  ): Promise<boolean> {
    // 验证分配的内存量
    if (proof.allocatedMB < challenge.difficulty) {
      return false;
    }
    
    // 验证哈希 (要求节点分配内存后计算哈希)
    const expectedHash = sha256(Buffer.alloc(proof.allocatedMB * 1024 * 1024));
    return proof.hash === Buffer.from(expectedHash).toString('hex');
  }
  
  /**
   * 新节点加入时的资源验证
   */
  async verifyNewNodeResources(peerId: string): Promise<Result<ResourceMetrics>> {
    // 1. 发送内存挑战 (要求至少 512MB 可用内存)
    const memoryChallenge = this.generateMemoryChallenge(512);
    
    // 2. 发送计算挑战 (要求完成一定量 PoW)
    const computeChallenge = this.generateComputeChallenge(10000); // 10000 次哈希
    
    // 3. 等待节点响应
    const [memoryProof, computeProof] = await Promise.all([
      this.requestMemoryProof(peerId, memoryChallenge),
      this.requestComputeProof(peerId, computeChallenge)
    ]);
    
    // 4. 验证证明
    const memoryValid = await this.verifyMemoryProof(memoryChallenge, memoryProof);
    const computeValid = await this.verifyComputeProof(computeChallenge, computeProof);
    
    if (!memoryValid || !computeValid) {
      return {
        success: false,
        error: '资源验证失败，可能为虚假节点'
      };
    }
    
    return {
      success: true,
      data: {
        availableMemoryMB: memoryProof.allocatedMB,
        computeScore: computeProof.computationTime
      }
    };
  }
}
```

#### 2.2.3 与现有架构的集成点

**1. 节点启动流程集成**:
```typescript
// src/core/p2p-network.ts

async function startNode(): Promise<void> {
  // 1. 加载或创建身份
  const identity = await this.identityManager.loadOrCreate();
  
  // 2. 如果是新节点，需要邀请码
  if (identity.isNew) {
    const invitationCode = config.get('invitationCode');
    
    if (!invitationCode) {
      throw new Error('新节点需要邀请码才能加入网络');
    }
    
    // 3. 验证邀请
    const result = await this.invitationManager.acceptInvitation(
      invitationCode,
      identity.keyPair
    );
    
    if (!result.success) {
      throw new Error(`邀请验证失败：${result.error}`);
    }
    
    // 4. 资源验证
    const resourceResult = await this.poResourceVerifier.verifyNewNodeResources(
      identity.peerId
    );
    
    if (!resourceResult.success) {
      throw new Error(`资源验证失败：${resourceResult.error}`);
    }
  }
  
  // 5. 正常启动
  // ...
}
```

**2. 信誉系统扩展**:
```typescript
// src/core/reputation.ts

export class ReputationManager {
  // 新增字段
  private invitationManager: InvitationManager;
  private progressiveManager: ProgressiveReputationManager;
  
  // 修改添加信誉方法
  async addReputation(peerId: string, delta: number, reason: string): Promise<Result> {
    // 使用渐进式管理器 (受每日上限和信誉上限限制)
    return this.progressiveManager.addReputation(peerId, delta, reason);
  }
  
  // 新增：连带责任惩罚
  async penalizeWithJointLiability(maliciousNodeId: string, penalty: number): Promise<void> {
    await this.invitationManager.applyJointLiability(maliciousNodeId, penalty);
  }
}
```

#### 2.2.4 验收测试用例

```typescript
// tests/security/sybil-protection.test.ts

describe('Sybil 攻击防护', () => {
  describe('邀请制背书', () => {
    it('应该拒绝无邀请的新节点', async () => {
      const newNode = await createTestNode({ isNew: true });
      
      const result = await newNode.joinNetwork();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('邀请码');
    });
    
    it('应该接受有效邀请', async () => {
      const inviter = await createTestNode({ reputation: 70 });
      const invitee = await createTestNode({ isNew: true });
      
      // 创建邀请
      const invitation = await inviter.invitationManager.createInvitation(
        inviter.peerId,
        invitee.publicKey
      );
      
      // 接受邀请
      const result = await invitee.acceptInvitation(invitation.data);
      
      expect(result.success).toBe(true);
      expect(result.data.initialScore).toBeBetween(30, 50);
    });
    
    it('应该应用连带责任惩罚', async () => {
      const inviter = await createTestNode({ reputation: 80 });
      const invitee = await createTestNode({ isNew: true, inviter });
      
      // invitee 作恶
      await invitee.reputationManager.deductReputation(50, 'malicious_behavior');
      
      // 验证邀请者也受到惩罚
      const inviterScoreAfter = inviter.reputationManager.getReputation().score;
      expect(inviterScoreAfter).toBeLessThan(80);
    });
    
    it('应该限制邀请配额', async () => {
      const inviter = await createTestNode({ reputation: 70 }); // 贡献者，配额 2
      
      // 创建 2 个邀请
      await inviter.createInvitation(node1);
      await inviter.createInvitation(node2);
      
      // 第 3 个邀请应该失败
      const result3 = await inviter.createInvitation(node3);
      
      expect(result3.success).toBe(false);
      expect(result3.error).toContain('配额已用完');
    });
  });
  
  describe('渐进式信誉', () => {
    it('应该限制新节点的信誉上限', async () => {
      const newNode = await createTestNode({ age: 0 }); // 新节点
      
      // 尝试添加大量信誉
      const result = await newNode.addReputation(100, 'test');
      
      expect(result.data.added).toBeLessThanOrEqual(50); // 新节点上限 50
    });
    
    it('应该随时间增长信誉上限', async () => {
      const node = await createTestNode({ age: 20 }); // 20 天
      
      const cap = node.calculateReputationCap();
      
      expect(cap).toBeGreaterThan(50);
      expect(cap).toBeLessThan(100);
    });
    
    it('应该限制每日信誉获取', async () => {
      const node = await createTestNode();
      
      // 第一次添加
      await node.addReputation(10, 'task1');
      
      // 第二次添加 (同一天)
      const result2 = await node.addReputation(10, 'task2');
      
      // 每日上限 15，所以第二次只能获得 5
      expect(result2.data.added).toBeLessThanOrEqual(5);
    });
    
    it('应该衰减长期不活跃节点', async () => {
      const node = await createTestNode({ reputation: 80, lastActive: 60 }); // 60 天不活跃
      
      const currentScore = node.getReputation();
      
      expect(currentScore).toBeLessThan(80);
      expect(currentScore).toBeGreaterThanOrEqual(40); // 最低保留 40
    });
  });
  
  describe('资源证明', () => {
    it('应该验证新节点的内存资源', async () => {
      const newNode = await createTestNode();
      
      const result = await newNode.verifyResourceProof();
      
      expect(result.success).toBe(true);
      expect(result.data.availableMemoryMB).toBeGreaterThanOrEqual(512);
    });
    
    it('应该拒绝资源不足的节点', async () => {
      const fakeNode = await createFakeNode({ claimedMemory: 256 }); // 只有 256MB
      
      const result = await fakeNode.verifyResourceProof();
      
      expect(result.success).toBe(false);
    });
  });
});
```

---

### P0-3: 内网横向渗透风险

#### 2.3.1 攻击场景详细描述

**攻击流程**:
```
攻击者目标：攻陷一个节点后，横向渗透到整个内网

┌─────────────────────────────────────────────────────────────┐
│ 攻击步骤                                                     │
├─────────────────────────────────────────────────────────────┤
│ 1. 初始入侵                                                  │
│    - 通过漏洞/社会工程攻陷 Node A                           │
│    - 获取 Node A 的身份和密钥                               │
│    - 成本：取决于 Node A 的安全水平                          │
├─────────────────────────────────────────────────────────────┤
│ 2. 内网侦察                                                  │
│    - 通过 Node A 的 mDNS 缓存发现其他节点                   │
│    - 获取内网拓扑结构                                       │
│    - 成本：几乎为零                                          │
├─────────────────────────────────────────────────────────────┤
│ 3. 横向移动                                                  │
│    - 使用 Node A 的身份与其他节点通信                       │
│    - 由于无节点间认证，其他节点信任 Node A                  │
│    - 窃取敏感数据、任务内容                                 │
│    - 成本：几乎为零                                          │
├─────────────────────────────────────────────────────────────┤
│ 4. 权限提升                                                  │
│    - 通过任务执行获取更高权限                               │
│    - 利用信任关系渗透更多节点                               │
│    - 成本：低                                                │
├─────────────────────────────────────────────────────────────┤
│ 5. 持久化                                                    │
│    - 在多个节点植入后门                                     │
│    - 建立隐蔽 C2 通道                                        │
│    - 成本：中                                                │
└─────────────────────────────────────────────────────────────┘
```

**影响**:
- 攻击者可以**访问所有内网节点**
- 可以**窃取敏感任务和文件**
- 可以**植入恶意代码**
- 可以**长期潜伏不被发现**

**现实案例参考**:
- 2020 年 SolarWinds 攻击：供应链入侵后横向渗透
- 2021 年 Kaseya VSA 攻击：MSP 软件被利用进行勒索软件传播

#### 2.3.2 修复方案（技术实现细节）

**方案名称**: **零信任节点认证 + 最小权限原则 + 行为异常检测**

##### 核心设计 1: 零信任节点认证 (Zero-Trust Node Authentication)

```typescript
// src/core/node-auth.ts

/**
 * 节点认证令牌
 */
interface NodeAuthToken {
  /** 令牌 ID */
  tokenId: string;
  /** 颁发者 PeerId */
  issuerId: string;
  /** 接收者 PeerId */
  subjectId: string;
  /** 权限范围 */
  permissions: NodePermission[];
  /** 颁发时间 */
  issuedAt: number;
  /** 过期时间 */
  expiresAt: number;
  /** 令牌签名 */
  signature: string;
}

/**
 * 节点权限枚举
 */
enum NodePermission {
  DISCOVER = 'discover',           // 发现其他节点
  COMMUNICATE = 'communicate',     // 发送消息
  EXECUTE_TASK = 'execute_task',   // 执行任务
  ACCESS_FILE = 'access_file',     // 访问文件
  ADMIN = 'admin'                  // 管理权限
}

/**
 * 节点认证管理器
 */
export class NodeAuthManager {
  private authToken: NodeAuthToken | null = null;
  private trustedNodes: Map<string, TrustedNodeInfo> = new Map();
  private reputationManager: ReputationManager;
  
  /**
   * 生成节点认证令牌 (挑战 - 响应协议)
   */
  async generateAuthToken(
    requesterId: string,
    requestedPermissions: NodePermission[]
  ): Promise<Result<NodeAuthToken>> {
    // 1. 验证请求者信誉
    const requesterRep = this.reputationManager.getReputation(requesterId);
    
    if (requesterRep.score < 50) {
      return {
        success: false,
        error: '信誉不足，无法获取认证令牌'
      };
    }
    
    // 2. 根据信誉等级限制权限
    const allowedPermissions = this.filterPermissionsByReputation(
      requestedPermissions,
      requesterRep.level
    );
    
    // 3. 生成令牌
    const token: NodeAuthToken = {
      tokenId: randomUUID(),
      issuerId: this.localPeerId,
      subjectId: requesterId,
      permissions: allowedPermissions,
      issuedAt: Date.now(),
      expiresAt: Date.now() + this.getTokenTTL(requesterRep.level),
      signature: await this.signToken(requesterId, allowedPermissions)
    };
    
    return { success: true, data: token };
  }
  
  /**
   * 验证收到的认证令牌
   */
  async verifyAuthToken(token: NodeAuthToken): Promise<Result<VerifiedToken>> {
    // 1. 验证签名
    const signatureValid = await this.verifyTokenSignature(token);
    if (!signatureValid) {
      return { success: false, error: '令牌签名无效' };
    }
    
    // 2. 验证过期时间
    if (Date.now() > token.expiresAt) {
      return { success: false, error: '令牌已过期' };
    }
    
    // 3. 验证颁发者信誉
    const issuerRep = await this.fetchReputation(token.issuerId);
    if (issuerRep.score < 40) {
      return {
        success: false,
        error: '令牌颁发者信誉不足'
      };
    }
    
    // 4. 检查令牌撤销列表
    if (this.isTokenRevoked(token.tokenId)) {
      return { success: false, error: '令牌已被撤销' };
    }
    
    // 5. 记录令牌使用 (审计日志)
    this.logTokenUsage(token);
    
    return {
      success: true,
      data: {
        permissions: token.permissions,
        subjectId: token.subjectId,
        remainingTTL: token.expiresAt - Date.now()
      }
    };
  }
  
  /**
   * 撤销令牌 (检测到异常行为时)
   */
  async revokeToken(tokenId: string, reason: string): Promise<void> {
    this.revokedTokens.add(tokenId);
    this.broadcastTokenRevocation(tokenId, reason);
    
    this.logger.warn('Token revoked', { tokenId, reason });
  }
  
  /**
   * 获取令牌有效期 (基于信誉等级)
   */
  private getTokenTTL(reputationLevel: string): number {
    const ttlMap = {
      'restricted': 0,              // 无权获取令牌
      'novice': 30 * 60 * 1000,     // 30 分钟
      'participant': 2 * 60 * 60 * 1000,  // 2 小时
      'contributor': 24 * 60 * 60 * 1000, // 24 小时
      'core': 7 * 24 * 60 * 60 * 1000     // 7 天
    };
    
    return ttlMap[reputationLevel] || 0;
  }
  
  /**
   * 根据信誉等级过滤权限
   */
  private filterPermissionsByReputation(
    requested: NodePermission[],
    level: string
  ): NodePermission[] {
    const allowedMap = {
      'restricted': [],
      'novice': [NodePermission.DISCOVER, NodePermission.COMMUNICATE],
      'participant': [NodePermission.DISCOVER, NodePermission.COMMUNICATE, NodePermission.EXECUTE_TASK],
      'contributor': [NodePermission.DISCOVER, NodePermission.COMMUNICATE, NodePermission.EXECUTE_TASK, NodePermission.ACCESS_FILE],
      'core': Object.values(NodePermission)
    };
    
    const allowed = allowedMap[level] || [];
    return requested.filter(p => allowed.includes(p));
  }
}
```

##### 核心设计 2: 最小权限原则 (Principle of Least Privilege)

```typescript
// src/core/least-privilege.ts

/**
 * 任务执行沙箱
 */
export class TaskSandbox {
  private permissions: NodePermission[];
  private allowedPaths: string[];
  private allowedCommands: string[];
  private resourceLimits: ResourceLimits;
  
  /**
   * 创建受限沙箱
   */
  constructor(context: TaskExecutionContext) {
    this.permissions = this.determinePermissions(context);
    this.allowedPaths = this.determineAllowedPaths(context);
    this.allowedCommands = this.determineAllowedCommands(context);
    this.resourceLimits = this.determineResourceLimits(context);
  }
  
  /**
   * 执行命令 (受限)
   */
  async executeCommand(command: string): Promise<Result<string>> {
    // 1. 命令白名单检查
    if (!this.isCommandAllowed(command)) {
      return {
        success: false,
        error: `命令 "${command}" 不在白名单内`
      };
    }
    
    // 2. 危险命令检测
    const dangerCheck = this.detectDangerousCommand(command);
    if (dangerCheck.isDangerous) {
      return {
        success: false,
        error: `危险命令被阻止：${dangerCheck.reason}`
      };
    }
    
    // 3. 资源限制检查
    const resourceCheck = await this.checkResourceLimits();
    if (!resourceCheck.ok) {
      return {
        success: false,
        error: `资源限制：${resourceCheck.reason}`
      };
    }
    
    // 4. 在沙箱中执行
    return this.executeInSandbox(command);
  }
  
  /**
   * 访问文件 (受限)
   */
  async accessFile(path: string, mode: 'read' | 'write'): Promise<Result<Buffer>> {
    // 1. 路径白名单检查
    if (!this.isPathAllowed(path)) {
      return {
        success: false,
        error: `路径 "${path}" 不在允许范围内`
      };
    }
    
    // 2. 路径遍历防护
    if (this.detectPathTraversal(path)) {
      return {
        success: false,
        error: '检测到路径遍历攻击'
      };
    }
    
    // 3. 敏感文件防护
    if (this.isSensitiveFile(path)) {
      return {
        success: false,
        error: '访问敏感文件被拒绝'
      };
    }
    
    // 4. 执行访问
    return this.performFileAccess(path, mode);
  }
  
  /**
   * 危险命令白名单
   */
  private readonly DANGEROUS_COMMAND_PATTERNS = [
    { pattern: /rm\s+-rf\s+\//, reason: '禁止删除根目录' },
    { pattern: /dd\s+if=.*of=\/dev\//, reason: '禁止磁盘覆写' },
    { pattern: /:(){ :|:& };:/, reason: '禁止 Fork 炸弹' },
    { pattern: /chmod\s+777/, reason: '禁止不安全权限' },
    { pattern: /curl.*\|\s*(bash|sh)/, reason: '禁止远程代码执行' },
    { pattern: /sudo\s+/, reason: '禁止提权' },
    { pattern: /passwd|shadow|ssh_key/, reason: '禁止访问敏感文件' }
  ];
}
```

##### 核心设计 3: 行为异常检测 (Behavioral Anomaly Detection)

```typescript
// src/core/anomaly-detection.ts

/**
 * 节点行为基线
 */
interface NodeBehaviorBaseline {
  peerId: string;
  // 通信模式
  avgMessagesPerHour: number;
  avgMessageSize: number;
  typicalActiveHours: number[];  // 0-23
  // 任务执行模式
  avgTasksPerDay: number;
  avgTaskDuration: number;
  typicalTaskTypes: string[];
  // 资源使用模式
  avgCpuUsage: number;
  avgMemoryUsage: number;
  avgNetworkUsage: number;
  // 更新时间
  lastUpdated: number;
}

/**
 * 异常检测器
 */
export class AnomalyDetector {
  private baselines: Map<string, NodeBehaviorBaseline> = new Map();
  private recentActivity: Map<string, ActivityRecord[]> = new Map();
  
  /**
   * 检测异常行为
   */
  detectAnomalies(peerId: string, activity: ActivityRecord): AnomalyReport[] {
    const baseline = this.baselines.get(peerId);
    if (!baseline) return []; // 无基线，无法检测
    
    const anomalies: AnomalyReport[] = [];
    
    // 1. 通信频率异常
    const msgPerHour = this.calculateMessagesPerHour(peerId);
    if (msgPerHour > baseline.avgMessagesPerHour * 5) {
      anomalies.push({
        type: 'COMMUNICATION_SPIKE',
        severity: 'high',
        description: `通信频率异常：${msgPerHour}/小时 (基线：${baseline.avgMessagesPerHour}/小时)`,
        confidence: 0.85
      });
    }
    
    // 2. 非活跃时间活动
    const currentHour = new Date().getHours();
    if (!baseline.typicalActiveHours.includes(currentHour)) {
      anomalies.push({
        type: 'UNUSUAL_ACTIVE_TIME',
        severity: 'medium',
        description: `在非活跃时间活动：${currentHour}点`,
        confidence: 0.6
      });
    }
    
    // 3. 任务类型异常
    if (!baseline.typicalTaskTypes.includes(activity.taskType)) {
      anomalies.push({
        type: 'UNUSUAL_TASK_TYPE',
        severity: 'medium',
        description: `执行不寻常的任务类型：${activity.taskType}`,
        confidence: 0.7
      });
    }
    
    // 4. 资源使用异常
    if (activity.cpuUsage > baseline.avgCpuUsage * 3) {
      anomalies.push({
        type: 'RESOURCE_SPIKE',
        severity: 'high',
        description: `CPU 使用率异常：${activity.cpuUsage}% (基线：${baseline.avgCpuUsage}%)`,
        confidence: 0.8
      });
    }
    
    // 5. 横向移动检测
    const uniquePeersContacted = this.countUniquePeersContacted(peerId, 1000); // 过去 1000ms
    if (uniquePeersContacted > 10) {
      anomalies.push({
        type: 'LATERAL_MOVEMENT',
        severity: 'critical',
        description: `疑似横向移动：1 秒内联系 ${uniquePeersContacted} 个节点`,
        confidence: 0.9
      });
    }
    
    return anomalies;
  }
  
  /**
   * 响应异常 (自动或人工)
   */
  async respondToAnomaly(anomaly: AnomalyReport, peerId: string): Promise<void> {
    switch (anomaly.severity) {
      case 'critical':
        // 立即隔离节点
        await this.isolateNode(peerId);
        await this.alertAdmin(anomaly);
        break;
        
      case 'high':
        // 限制权限，通知管理员
        await this.restrictPermissions(peerId);
        await this.alertAdmin(anomaly);
        break;
        
      case 'medium':
        // 记录日志，持续监控
        this.logAnomaly(anomaly);
        this.increaseMonitoring(peerId);
        break;
        
      case 'low':
        // 仅记录
        this.logAnomaly(anomaly);
        break;
    }
  }
  
  /**
   * 隔离节点 (撤销所有令牌，断开连接)
   */
  private async isolateNode(peerId: string): Promise<void> {
    // 1. 撤销所有令牌
    await this.revokeAllTokens(peerId);
    
    // 2. 断开连接
    await this.disconnectPeer(peerId);
    
    // 3. 加入黑名单
    this.blacklist.add(peerId);
    
    // 4. 广播警告
    this.broadcastSecurityAlert({
      type: 'NODE_ISOLATED',
      peerId,
      reason: '检测到严重异常行为',
      timestamp: Date.now()
    });
  }
}
```

#### 2.3.3 与现有架构的集成点

**1. 消息发送前认证**:
```typescript
// src/core/p2p-network.ts

async sendMessage(peerId: string, message: F2AMessage): Promise<Result> {
  // 1. 验证对方节点的认证令牌
  const tokenVerification = await this.nodeAuth.verifyAuthToken(peerAuthToken);
  
  if (!tokenVerification.success) {
    return {
      success: false,
      error: `节点认证失败：${tokenVerification.error}`
    };
  }
  
  // 2. 检查权限
  if (!tokenVerification.data.permissions.includes(NodePermission.COMMUNICATE)) {
    return {
      success: false,
      error: '节点无通信权限'
    };
  }
  
  // 3. 异常检测
  const anomalies = this.anomalyDetector.detectAnomalies(peerId, {
    type: 'MESSAGE_SEND',
    timestamp: Date.now(),
    messageSize: message.size
  });
  
  for (const anomaly of anomalies) {
    await this.anomalyDetector.respondToAnomaly(anomaly, peerId);
  }
  
  // 4. 正常发送
  // ...
}
```

**2. 任务执行沙箱集成**:
```typescript
// src/core/task-executor.ts

async executeTask(task: TaskRequest): Promise<Result> {
  // 1. 创建沙箱
  const sandbox = new TaskSandbox({
    taskType: task.type,
    requesterReputation: task.requesterReputation,
    sensitivity: task.sensitivity
  });
  
  // 2. 在沙箱中执行
  for (const step of task.steps) {
    if (step.type === 'command') {
      const result = await sandbox.executeCommand(step.command);
      if (!result.success) {
        return result;
      }
    } else if (step.type === 'file_access') {
      const result = await sandbox.accessFile(step.path, step.mode);
      if (!result.success) {
        return result;
      }
    }
  }
  
  // 3. 返回结果
  // ...
}
```

#### 2.3.4 验收测试用例

```typescript
// tests/security/lateral-movement-protection.test.ts

describe('内网横向渗透防护', () => {
  describe('零信任节点认证', () => {
    it('应该拒绝无认证令牌的节点', async () => {
      const attacker = await createTestNode({ reputation: 30 });
      const victim = await createTestNode();
      
      const result = await attacker.sendMessage(victim.peerId, testMessage);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('认证');
    });
    
    it('应该根据信誉等级限制权限', async () => {
      const noviceNode = await createTestNode({ reputation: 35 }); // novice
      
      const tokenResult = await victim.nodeAuth.generateAuthToken(
        noviceNode.peerId,
        [NodePermission.EXECUTE_TASK, NodePermission.ACCESS_FILE]
      );
      
      // Novice 只能获得 DISCOVER 和 COMMUNICATE 权限
      expect(tokenResult.data.permissions).not.toContain(NodePermission.EXECUTE_TASK);
      expect(tokenResult.data.permissions).not.toContain(NodePermission.ACCESS_FILE);
    });
    
    it('应该撤销异常节点的令牌', async () => {
      const node = await createTestNode({ reputation: 70 });
      
      // 获取令牌
      const token = await victim.nodeAuth.generateAuthToken(node.peerId, [NodePermission.COMMUNICATE]);
      
      // 检测到异常
      await victim.nodeAuth.revokeToken(token.data.tokenId, 'suspicious_activity');
      
      // 尝试使用已撤销的令牌
      const verifyResult = await victim.nodeAuth.verifyAuthToken(token.data);
      
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.error).toContain('撤销');
    });
  });
  
  describe('最小权限沙箱', () => {
    it('应该阻止危险命令', async () => {
      const sandbox = await createTaskSandbox();
      
      const result = await sandbox.executeCommand('rm -rf /');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('危险命令');
    });
    
    it('应该阻止路径遍历', async () => {
      const sandbox = await createTaskSandbox({ allowedPaths: ['/tmp'] });
      
      const result = await sandbox.accessFile('../../../etc/passwd', 'read');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('路径遍历');
    });
    
    it('应该阻止访问敏感文件', async () => {
      const sandbox = await createTaskSandbox();
      
      const result = await sandbox.accessFile('~/.ssh/id_rsa', 'read');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('敏感文件');
    });
  });
  
  describe('行为异常检测', () => {
    it('应该检测通信频率异常', async () => {
      const node = await createTestNode();
      const detector = new AnomalyDetector();
      
      // 建立基线：平均 10 条/小时
      detector.setBaseline(node.peerId, { avgMessagesPerHour: 10 });
      
      // 模拟突发：1 分钟 50 条 (= 3000 条/小时)
      for (let i = 0; i < 50; i++) {
        detector.recordActivity(node.peerId, { type: 'MESSAGE' });
      }
      
      const anomalies = detector.detectAnomalies(node.peerId, {});
      
      expect(anomalies.some(a => a.type === 'COMMUNICATION_SPIKE')).toBe(true);
    });
    
    it('应该检测横向移动', async () => {
      const node = await createTestNode();
      const detector = new AnomalyDetector();
      
      // 1 秒内联系 20 个不同节点
      for (let i = 0; i < 20; i++) {
        detector.recordActivity(node.peerId, {
          type: 'CONTACT_PEER',
          targetPeerId: `node-${i}`
        });
      }
      
      const anomalies = detector.detectAnomalies(node.peerId, {});
      
      expect(anomalies.some(a => a.type === 'LATERAL_MOVEMENT')).toBe(true);
      expect(anomalies.find(a => a.type === 'LATERAL_MOVEMENT')?.severity).toBe('critical');
    });
    
    it('应该自动隔离严重异常节点', async () => {
      const maliciousNode = await createTestNode();
      const detector = new AnomalyDetector();
      
      // 模拟严重异常
      const criticalAnomaly = {
        type: 'LATERAL_MOVEMENT',
        severity: 'critical' as const,
        description: '疑似横向移动',
        confidence: 0.9
      };
      
      await detector.respondToAnomaly(criticalAnomaly, maliciousNode.peerId);
      
      // 验证节点被隔离
      expect(maliciousNode.isConnected).toBe(false);
      expect(detector.blacklist.has(maliciousNode.peerId)).toBe(true);
    });
  });
});
```

---

## 三、安全配置清单

### 3.1 生产环境必须启用的安全选项

```yaml
# f2a-security-config.yaml

security:
  # ==========================================================================
  # P0-1: E2EE 中间人攻击防护
  # ==========================================================================
  e2ee:
    # 启用公钥指纹验证
    enablePublicKeyVerification: true
    
    # 首次连接需要带外验证 (电话/微信确认指纹)
    requireOutOfBandVerification: true
    
    # 公钥不匹配时自动断开
    autoDisconnectOnMismatch: true
    
    # 信任存储持久化
    persistTrustedKeys: true
    
    # 信任存储路径
    trustedKeysPath: ~/.f2a/security/trusted-keys.json
    
    # 挑战 - 响应超时 (毫秒)
    challengeTimeoutMs: 30000
  
  # ==========================================================================
  # P0-2: Sybil 攻击防护
  # ==========================================================================
  sybil_protection:
    # 启用邀请制
    enableInvitationSystem: true
    
    # 最低邀请者信誉分
    minInviterReputation: 60
    
    # 初始信誉上限
    maxInitialReputation: 50
    
    # 启用渐进式信誉
    enableProgressiveReputation: true
    
    # 新节点信誉上限 (天)
    progressiveReputation:
      baseCap: 50
      dailyIncrease: 1.25
      maxCap: 100
      daysToFullCap: 40
    
    # 每日信誉获取上限
    dailyEarnCap: 15
    
    # 启用连带责任
    enableJointLiability: true
    jointLiabilityFactor: 0.3
    
    # 启用资源证明
    enableProofOfResource: true
    minMemoryMB: 512
    minComputeScore: 10000
  
  # ==========================================================================
  # P0-3: 内网横向渗透防护
  # ==========================================================================
  lateral_movement_protection:
    # 启用零信任认证
    enableZeroTrustAuth: true
    
    # 令牌有效期 (基于信誉等级)
    tokenTTL:
      novice: 1800          # 30 分钟
      participant: 7200     # 2 小时
      contributor: 86400    # 24 小时
      core: 604800          # 7 天
    
    # 启用任务沙箱
    enableTaskSandbox: true
    
    # 命令白名单模式
    commandWhitelistMode: true
    
    # 危险命令阻断
    blockDangerousCommands: true
    
    # 启用行为异常检测
    enableAnomalyDetection: true
    
    # 异常响应策略
    anomalyResponse:
      critical: 'isolate'   # 立即隔离
      high: 'restrict'      # 限制权限
      medium: 'monitor'     # 加强监控
      low: 'log'            # 仅记录
    
    # 横向移动检测阈值
    lateralMovementThreshold:
      uniquePeersPerSecond: 10
      uniquePeersPerMinute: 50
  
  # ==========================================================================
  # 通用安全配置
  # ==========================================================================
  general:
    # 安全等级 (low/medium/high)
    level: 'high'
    
    # 启用审计日志
    enableAuditLog: true
    auditLogPath: ~/.f2a/security/audit.log
    
    # 启用安全事件告警
    enableSecurityAlerts: true
    alertWebhook: 'https://your-webhook-url.com/security'
    
    # 速率限制
    rateLimit:
      maxRequestsPerMinute: 60
      maxMessagesPerMinute: 100
    
    # 消息大小限制 (MB)
    maxMessageSizeMB: 1
    
    # 连接超时 (毫秒)
    connectionTimeoutMs: 30000
```

### 3.2 安全检查脚本

```bash
#!/bin/bash
# f2a-security-check.sh

echo "=== F2A 安全检查 ==="

# 1. 检查 E2EE 配置
echo -e "\n[1/5] 检查 E2EE 配置..."
if [ -f ~/.f2a/security/trusted-keys.json ]; then
  echo "✓ 信任密钥存储存在"
else
  echo "✗ 信任密钥存储不存在"
fi

# 2. 检查邀请制
echo -e "\n[2/5] 检查 Sybil 防护..."
if grep -q "enableInvitationSystem: true" ~/.f2a/config.yaml; then
  echo "✓ 邀请制已启用"
else
  echo "✗ 邀请制未启用"
fi

# 3. 检查零信任认证
echo -e "\n[3/5] 检查零信任认证..."
if grep -q "enableZeroTrustAuth: true" ~/.f2a/config.yaml; then
  echo "✓ 零信任认证已启用"
else
  echo "✗ 零信任认证未启用"
fi

# 4. 检查审计日志
echo -e "\n[4/5] 检查审计日志..."
if [ -f ~/.f2a/security/audit.log ]; then
  echo "✓ 审计日志存在"
  echo "  最近 10 条记录:"
  tail -10 ~/.f2a/security/audit.log
else
  echo "✗ 审计日志不存在"
fi

# 5. 检查安全事件
echo -e "\n[5/5] 检查安全事件..."
if grep -q "CRITICAL\|HIGH" ~/.f2a/security/audit.log 2>/dev/null; then
  echo "⚠ 发现严重/高危安全事件:"
  grep "CRITICAL\|HIGH" ~/.f2a/security/audit.log | tail -5
else
  echo "✓ 无严重/高危安全事件"
fi

echo -e "\n=== 检查完成 ==="
```

---

## 四、安全测试计划

### 4.1 测试环境搭建

```yaml
测试拓扑:
  - 正常节点: 5 个 (不同信誉等级)
  - 攻击者节点: 3 个 (模拟不同攻击场景)
  - 监控节点: 1 个 (收集日志和指标)

测试工具:
  - MITM 攻击：bettercap / mitmproxy
  - Sybil 攻击：自定义脚本 (批量创建节点)
  - 横向渗透：自定义攻击脚本
  - 流量分析：Wireshark / tcpdump
```

### 4.2 测试用例矩阵

| 测试 ID | 测试场景 | 测试方法 | 预期结果 | 优先级 |
|--------|---------|---------|---------|--------|
| SEC-001 | E2EE 中间人攻击 | 使用 bettercap 劫持 mDNS 响应 | 公钥不匹配检测成功，连接中断 | P0 |
| SEC-002 | 公钥重放攻击 | 重放旧的公钥验证消息 | 时间戳验证失败，拒绝连接 | P0 |
| SEC-003 | Sybil 攻击 (无邀请) | 创建 100 个无邀请节点 | 所有节点被拒绝加入 | P0 |
| SEC-004 | Sybil 攻击 (有效邀请) | 创建 10 个有邀请节点 | 初始信誉受限，无法快速积累 | P0 |
| SEC-005 | 信誉刷分 | 虚假节点互评 | 渐进式信誉限制生效，每日≤15 分 | P0 |
| SEC-006 | 连带责任测试 | 被邀请节点作恶 | 邀请者受到 30% 连带惩罚 | P0 |
| SEC-007 | 无令牌访问 | 未认证节点尝试通信 | 访问被拒绝，记录安全事件 | P0 |
| SEC-008 | 令牌过期访问 | 使用过期令牌 | 访问被拒绝 | P0 |
| SEC-009 | 权限提升尝试 | 低信誉节点请求高权限 | 权限被限制 | P0 |
| SEC-010 | 危险命令执行 | 尝试执行 `rm -rf /` | 命令被沙箱阻止 | P0 |
| SEC-011 | 路径遍历攻击 | 尝试访问 `../../../etc/passwd` | 访问被阻止 | P0 |
| SEC-012 | 横向移动检测 | 1 秒内联系 20 个节点 | 检测到异常，节点被隔离 | P0 |
| SEC-013 | 通信频率异常 | 1 分钟发送 1000 条消息 | 速率限制触发，连接暂停 | P1 |
| SEC-014 | 非活跃时间活动 | 凌晨 3 点大量活动 | 记录异常，提升监控级别 | P1 |
| SEC-015 | 资源耗尽攻击 | 请求超大文件传输 | 资源限制触发，请求被拒绝 | P1 |

### 4.3 渗透测试流程

```
Phase 1: 信息收集 (1 天)
├── 网络拓扑发现
├── 节点指纹识别
├── 协议分析
└── 弱点扫描

Phase 2: 威胁建模 (1 天)
├── 攻击面分析
├── 威胁场景设计
└── 攻击路径规划

Phase 3: 漏洞利用 (3 天)
├── E2EE 中间人攻击
├── Sybil 攻击
├── 横向渗透
└── 权限提升

Phase 4: 后渗透 (2 天)
├── 持久化测试
├── 数据窃取测试
└── 隐蔽 C2 通道测试

Phase 5: 报告与修复 (3 天)
├── 漏洞报告
├── 修复建议
└── 回归测试
```

### 4.4 验收标准

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| MITM 攻击检测率 | ≥99% | 100 次攻击，成功检测≥99 次 |
| Sybil 攻击阻断率 | 100% | 无邀请节点 0 个成功加入 |
| 横向移动检测时间 | <5 秒 | 从异常行为到隔离的时间 |
| 误报率 | <1% | 正常行为被误判为异常的比例 |
| 性能影响 | <10% | 启用安全功能后的吞吐量下降 |
| 审计日志完整性 | 100% | 所有安全事件都被记录 |

---

## 五、剩余风险

### 5.1 Phase 0 无法完全解决的风险

| 风险 | 描述 | 剩余等级 | 缓解措施 |
|------|------|---------|---------|
| **0day 漏洞** | 加密库/依赖中的未知漏洞 | 🟡 中 | 定期更新依赖、漏洞赏金计划 |
| **社会工程** | 用户被欺骗手动确认攻击者指纹 | 🟡 中 | 用户教育、多因素验证 |
| **物理攻击** | 攻击者物理访问节点设备 | 🔴 高 | 硬件加密模块、远程擦除 |
| **供应链攻击** | 依赖包被植入恶意代码 | 🟡 中 | 锁定版本、完整性校验 |
| **量子计算威胁** | 未来量子计算机破解 ECDH | 🟢 低 | 后量子密码学研究、算法升级计划 |
| **内部威胁** | 恶意内部人员滥用权限 | 🟡 中 | 最小权限、审计日志、职责分离 |
| **合谋攻击** | 多个高信誉节点合谋操纵 | 🟡 中 | 挑战机制、异常模式检测 |
| **资源耗尽** | DDoS 攻击耗尽系统资源 | 🟡 中 | 速率限制、弹性扩容 |

### 5.2 风险缓解路线图

```
Phase 1 (0-3 月): 基础防护
├── 实现 P0 安全修复
├── 建立安全监控
└── 制定应急响应流程

Phase 2 (3-6 月): 增强防护
├── 实现挑战机制 (防合谋)
├── 第三方安全审计
└── 漏洞赏金计划

Phase 3 (6-12 月): 高级防护
├── 硬件安全模块 (HSM) 集成
├── 后量子密码学预研
└── 自动化威胁狩猎

Phase 4 (12+ 月): 持续改进
├── 定期渗透测试
├── 安全培训
└── 威胁情报共享
```

---

## 六、总结

### 6.1 P0 安全修复完成状态

| 问题 | 修复方案 | 状态 |
|------|---------|------|
| E2EE 中间人攻击 | 公钥指纹验证 + 挑战 - 响应协议 | ✅ 设计完成 |
| Sybil 攻击 | 邀请制 + 渐进式信誉 + 资源证明 | ✅ 设计完成 |
| 内网横向渗透 | 零信任认证 + 最小权限 + 异常检测 | ✅ 设计完成 |

### 6.2 关键设计决策

1. **安全优先于便利**: 首次连接需要带外验证，增加用户操作但保证安全
2. **纵深防御**: 多层防护机制，单一防线被突破仍有其他保护
3. **零信任原则**: 不信任任何节点，所有通信都需要认证和授权
4. **渐进式信任**: 新节点需要时间积累信任，防止快速攻击
5. **可检测可响应**: 所有安全事件都被记录和告警，支持快速响应

### 6.3 下一步行动

1. **立即启动**:
   - [ ] 实现 E2EE 公钥验证模块
   - [ ] 实现邀请制管理器
   - [ ] 实现节点认证令牌系统

2. **本周完成**:
   - [ ] 编写单元测试
   - [ ] 搭建测试环境
   - [ ] 执行初步渗透测试

3. **本月完成**:
   - [ ] 第三方安全审计
   - [ ] 修复发现的问题
   - [ ] 发布 v0.4.0 安全更新

---

**文档结束**

*安全是过程，不是终点。持续监控、持续改进。*
