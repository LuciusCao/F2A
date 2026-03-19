# F2A 架构设计文档：节点身份持久化与消息可靠性

**版本**: 1.0  
**日期**: 2026-03-12  
**作者**: 分布式系统架构师 (subagent)  
**基于分支**: develop

---

## 目录

1. [节点身份持久化方案](#一节点身份持久化方案)
2. [消息可靠性架构](#二消息可靠性架构)
3. [与现有代码的集成点](#三与现有代码的集成点)
4. [技术选型建议](#四技术选型建议)
5. [实施路线图](#五实施路线图)

---

## 一、节点身份持久化方案

### 1.1 设计目标

- **安全性**: 私钥必须加密存储，防止未授权访问
- **可靠性**: 身份数据持久化，节点重启后可恢复
- **可移植性**: 支持身份备份与恢复
- **可选同步**: 多设备场景下的身份同步（可选高级特性）

### 1.2 架构组件图

```
┌─────────────────────────────────────────────────────────────────┐
│                        F2A Agent Node                           │
│                                                                 │
│  ┌─────────────────┐         ┌─────────────────────────────┐   │
│  │  IdentityManager │         │      E2EECrypto (existing)  │   │
│  │  (new module)   │────────▶│      - X25519 keys          │   │
│  └────────┬────────┘         │      - AES-256-GCM          │   │
│           │                   └─────────────────────────────┘   │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              EncryptedKeyStore (new module)             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │ Key Encryptor│  │ SecureStorage│  │ Key Backup   │  │   │
│  │  │ - PBKDF2     │  │ - File-based │  │ - Encrypted  │  │   │
│  │  │ - Argon2     │  │ - Keychain   │  │ - JSON export│  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │   Storage Backend     │
                  │  - ~/.f2a/identity/   │
                  │  - OS Keychain        │
                  └───────────────────────┘
```

### 1.3 核心接口定义

#### 1.3.1 身份管理器接口

```typescript
// src/core/identity-manager.ts

import { EncryptionKeyPair } from './e2ee-crypto.js';

/** 节点身份信息 */
export interface NodeIdentity {
  /** PeerId (libp2p) */
  peerId: string;
  /** 加密密钥对 */
  encryptionKeyPair: EncryptionKeyPair;
  /** 签名密钥对 (可选，用于消息签名验证) */
  signingKeyPair?: SigningKeyPair;
  /** 身份创建时间 */
  createdAt: number;
  /** 身份版本号 */
  version: number;
}

/** 签名密钥对 */
export interface SigningKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/** 身份管理器配置 */
export interface IdentityManagerOptions {
  /** 数据目录路径 */
  dataDir: string;
  /** 加密密码 (可选，不提供则使用系统密钥链) */
  password?: string;
  /** 是否启用自动备份 */
  enableBackup: boolean;
  /** 备份目录 */
  backupDir?: string;
}

/** 身份管理器 */
export class IdentityManager {
  private identity: NodeIdentity | null = null;
  private keyStore: EncryptedKeyStore;
  private logger: Logger;

  constructor(options: IdentityManagerOptions) {
    this.keyStore = new EncryptedKeyStore(options.dataDir, options.password);
    this.logger = new Logger({ component: 'IdentityManager' });
  }

  /**
   * 加载或创建身份
   * 如果已存在身份则加载，否则创建新身份
   */
  async loadOrCreate(): Promise<NodeIdentity> {
    // 尝试加载已有身份
    const existing = await this.keyStore.loadIdentity();
    if (existing) {
      this.identity = existing;
      this.logger.info('Loaded existing identity', {
        peerId: existing.peerId.slice(0, 16)
      });
      return existing;
    }

    // 创建新身份
    this.identity = await this.createIdentity();
    await this.keyStore.saveIdentity(this.identity);
    this.logger.info('Created new identity', {
      peerId: this.identity.peerId.slice(0, 16)
    });
    return this.identity;
  }

  /**
   * 创建新身份
   */
  private async createIdentity(): Promise<NodeIdentity> {
    // 生成 libp2p PeerId
    const { peerId, privateKey: libp2pPrivateKey } = await this.generatePeerId();
    
    // 生成加密密钥对 (X25519)
    const encryptionKeyPair = this.generateEncryptionKeyPair();
    
    // 生成签名密钥对 (Ed25519)
    const signingKeyPair = this.generateSigningKeyPair();

    return {
      peerId,
      encryptionKeyPair,
      signingKeyPair,
      createdAt: Date.now(),
      version: 1
    };
  }

  /**
   * 导出加密身份备份
   * @param exportPassword 导出密码 (可选，不提供则使用主密码)
   */
  async exportIdentity(exportPassword?: string): Promise<string> {
    if (!this.identity) {
      throw new Error('No identity loaded');
    }

    const backup = await this.keyStore.exportIdentity(this.identity, exportPassword);
    return backup;
  }

  /**
   * 从备份恢复身份
   * @param backupData 加密的备份数据 (JSON 字符串)
   * @param importPassword 导入密码
   */
  async importIdentity(backupData: string, importPassword: string): Promise<NodeIdentity> {
    this.identity = await this.keyStore.importIdentity(backupData, importPassword);
    await this.keyStore.saveIdentity(this.identity);
    return this.identity;
  }

  /**
   * 获取当前身份
   */
  getIdentity(): NodeIdentity | null {
    return this.identity;
  }

  /**
   * 获取 PeerId
   */
  getPeerId(): string | null {
    return this.identity?.peerId || null;
  }

  /**
   * 获取加密公钥
   */
  getEncryptionPublicKey(): string | null {
    if (!this.identity) return null;
    return Buffer.from(this.identity.encryptionKeyPair.publicKey).toString('base64');
  }

  /**
   * 获取加密私钥 (谨慎使用)
   */
  getEncryptionPrivateKey(): Uint8Array | null {
    return this.identity?.encryptionKeyPair.privateKey || null;
  }
}
```

#### 1.3.2 加密密钥存储接口

```typescript
// src/core/encrypted-key-store.ts

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_SIZE = 32; // 256 bits
const SALT_SIZE = 16;
const IV_SIZE = 16;
const TAG_SIZE = 16;
const PBKDF2_ITERATIONS = 100000;

/** 加密的身份数据 */
interface EncryptedIdentityData {
  version: number;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: number;
}

/** 明文身份数据 (用于加密/解密) */
interface PlainIdentityData {
  peerId: string;
  encryptionPrivateKey: string;
  encryptionPublicKey: string;
  signingPrivateKey?: string;
  signingPublicKey?: string;
  createdAt: number;
  version: number;
}

export class EncryptedKeyStore {
  private dataDir: string;
  private password: string | null;
  private identityFile: string;

  constructor(dataDir: string, password?: string) {
    this.dataDir = dataDir;
    this.password = password || null;
    this.identityFile = path.join(dataDir, 'identity.json');
  }

  /**
   * 保存身份 (加密存储)
   */
  async saveIdentity(identity: NodeIdentity): Promise<void> {
    // 确保目录存在
    await fs.promises.mkdir(this.dataDir, { recursive: true });

    // 准备明文数据
    const plainData: PlainIdentityData = {
      peerId: identity.peerId,
      encryptionPrivateKey: Buffer.from(identity.encryptionKeyPair.privateKey).toString('base64'),
      encryptionPublicKey: Buffer.from(identity.encryptionKeyPair.publicKey).toString('base64'),
      signingPrivateKey: identity.signingKeyPair 
        ? Buffer.from(identity.signingKeyPair.privateKey).toString('base64') 
        : undefined,
      signingPublicKey: identity.signingKeyPair
        ? Buffer.from(identity.signingKeyPair.publicKey).toString('base64')
        : undefined,
      createdAt: identity.createdAt,
      version: identity.version
    };

    // 加密
    const encrypted = await this.encrypt(plainData);

    // 写入文件
    await fs.promises.writeFile(
      this.identityFile,
      JSON.stringify(encrypted, null, 2),
      { mode: 0o600 } // 仅所有者可读写
    );
  }

  /**
   * 加载身份 (解密)
   */
  async loadIdentity(): Promise<NodeIdentity | null> {
    try {
      const data = await fs.promises.readFile(this.identityFile, 'utf-8');
      const encrypted: EncryptedIdentityData = JSON.parse(data);
      
      // 解密
      const plainData = await this.decrypt(encrypted);

      // 重建身份对象
      return {
        peerId: plainData.peerId,
        encryptionKeyPair: {
          privateKey: Uint8Array.from(Buffer.from(plainData.encryptionPrivateKey, 'base64')),
          publicKey: Uint8Array.from(Buffer.from(plainData.encryptionPublicKey, 'base64'))
        },
        signingKeyPair: plainData.signingPrivateKey && plainData.signingPublicKey ? {
          privateKey: Uint8Array.from(Buffer.from(plainData.signingPrivateKey, 'base64')),
          publicKey: Uint8Array.from(Buffer.from(plainData.signingPublicKey, 'base64'))
        } : undefined,
        createdAt: plainData.createdAt,
        version: plainData.version
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null; // 文件不存在，返回 null
      }
      throw error;
    }
  }

  /**
   * 导出身份备份
   */
  async exportIdentity(identity: NodeIdentity, exportPassword?: string): Promise<string> {
    const password = exportPassword || this.password;
    if (!password) {
      throw new Error('Password required for export');
    }

    const plainData: PlainIdentityData = {
      peerId: identity.peerId,
      encryptionPrivateKey: Buffer.from(identity.encryptionKeyPair.privateKey).toString('base64'),
      encryptionPublicKey: Buffer.from(identity.encryptionKeyPair.publicKey).toString('base64'),
      signingPrivateKey: identity.signingKeyPair 
        ? Buffer.from(identity.signingKeyPair.privateKey).toString('base64') 
        : undefined,
      signingPublicKey: identity.signingKeyPair
        ? Buffer.from(identity.signingKeyPair.publicKey).toString('base64')
        : undefined,
      createdAt: identity.createdAt,
      version: identity.version
    };

    const encrypted = await this.encrypt(plainData, password);
    return JSON.stringify(encrypted);
  }

  /**
   * 从备份导入身份
   */
  async importIdentity(backupData: string, importPassword: string): Promise<NodeIdentity> {
    const encrypted: EncryptedIdentityData = JSON.parse(backupData);
    const plainData = await this.decrypt(encrypted, importPassword);

    return {
      peerId: plainData.peerId,
      encryptionKeyPair: {
        privateKey: Uint8Array.from(Buffer.from(plainData.encryptionPrivateKey, 'base64')),
        publicKey: Uint8Array.from(Buffer.from(plainData.encryptionPublicKey, 'base64'))
      },
      signingKeyPair: plainData.signingPrivateKey && plainData.signingPublicKey ? {
        privateKey: Uint8Array.from(Buffer.from(plainData.signingPrivateKey, 'base64')),
        publicKey: Uint8Array.from(Buffer.from(plainData.signingPublicKey, 'base64'))
      } : undefined,
      createdAt: plainData.createdAt,
      version: plainData.version
    };
  }

  /**
   * 加密数据
   */
  private async encrypt(data: PlainIdentityData, password?: string): Promise<EncryptedIdentityData> {
    const pwd = password || this.password;
    if (!pwd) {
      throw new Error('Encryption password required');
    }

    // 生成随机盐值
    const salt = randomBytes(SALT_SIZE);
    
    // 从密码派生密钥
    const key = pbkdf2Sync(pwd, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
    
    // 生成随机 IV
    const iv = randomBytes(IV_SIZE);
    
    // 创建加密器
    const cipher = createCipheriv(ALGORITHM, key, iv);
    
    // 加密
    const plaintext = JSON.stringify(data);
    let ciphertext = cipher.update(plaintext, 'utf-8', 'base64');
    ciphertext += cipher.final('base64');
    
    // 获取认证标签
    const authTag = cipher.getAuthTag();

    return {
      version: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext,
      createdAt: Date.now()
    };
  }

  /**
   * 解密数据
   */
  private async decrypt(encrypted: EncryptedIdentityData, password?: string): Promise<PlainIdentityData> {
    const pwd = password || this.password;
    if (!pwd) {
      throw new Error('Decryption password required');
    }

    // 解码参数
    const salt = Buffer.from(encrypted.salt, 'base64');
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    
    // 从密码派生密钥
    const key = pbkdf2Sync(pwd, salt, PBKDF2_ITERATIONS, KEY_SIZE, 'sha256');
    
    // 创建解密器
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    // 解密
    let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf-8');
    plaintext += decipher.final('utf-8');
    
    return JSON.parse(plaintext);
  }
}
```

### 1.4 密钥生成与存储流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    身份初始化流程                                │
└─────────────────────────────────────────────────────────────────┘

1. 启动时检查 ~/.f2a/identity/identity.json
   │
   ├─ 存在 ──▶ 读取加密文件
   │           │
   │           ▼
   │         使用密码解密 (PBKDF2 + AES-256-GCM)
   │           │
   │           ▼
   │         加载到内存 (NodeIdentity)
   │           │
   │           ▼
   │         初始化 E2EECrypto 模块
   │
   └─ 不存在 ──▶ 生成新身份
               │
               ▼
             生成 libp2p PeerId (Ed25519)
               │
               ▼
             生成 X25519 加密密钥对
               │
               ▼
             生成 Ed25519 签名密钥对 (可选)
               │
               ▼
             使用密码加密存储
               │
               ▼
             设置文件权限 0o600
```

### 1.5 安全加固措施

1. **文件权限**: 身份文件设置为仅所有者可读写 (0o600)
2. **密钥派生**: 使用 PBKDF2-SHA256，100,000 次迭代
3. **加密算法**: AES-256-GCM (认证加密)
4. **内存保护**: 私钥使用后立即清除 (可选：使用 secure-memory 库)
5. **密码管理**: 
   - 优先使用操作系统密钥链 (macOS Keychain / Windows Credential Manager)
   - 支持环境变量 `F2A_IDENTITY_PASSWORD`
   - 支持交互式密码输入

### 1.6 备份与恢复机制

```typescript
// CLI 命令示例

// 导出备份
f2a identity export --output backup.json --password "strong-password"

// 导入备份
f2a identity import --input backup.json --password "strong-password"

// 查看身份摘要
f2a identity info
// 输出:
// PeerId: QmXyZ... (16 chars)
// Created: 2026-03-12T10:30:00Z
// Encryption: enabled
// Backup: 2026-03-12T10:30:00Z
```

### 1.7 多设备身份同步 (可选高级特性)

```typescript
// 使用端到端加密的云同步方案
interface IdentitySyncManager {
  /**
   * 上传加密身份到云存储
   */
  uploadToCloud(cloudProvider: 'icloud' | 'dropbox' | 'webdav'): Promise<void>;
  
  /**
   * 从云存储下载并解密身份
   */
  downloadFromCloud(cloudProvider: string, syncPassword: string): Promise<NodeIdentity>;
  
  /**
   * 检查云端的身份版本
   */
  checkCloudVersion(): Promise<{ version: number; updatedAt: number }>;
}
```

---

## 二、消息可靠性架构

### 2.1 设计目标

- **至少一次投递**: 确保消息不丢失
- **消息去重**: 防止重复处理
- **有序投递**: 可选的順序保证
- **离线消息**: 支持离线消息队列
- **指数退避**: 智能重传策略

### 2.2 架构组件图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Message Reliability Layer                     │
│                                                                 │
│  ┌──────────────────┐      ┌──────────────────────────────┐    │
│  │ MessageQueue     │      │ ACKManager                   │    │
│  │ (outbound)       │      │ - pending ACKs               │    │
│  │ - priority queue │      │ - timeout tracking           │    │
│  │ - persistence    │─────▶│ - retry scheduling           │    │
│  └──────────────────┘      └──────────────┬───────────────┘    │
│                                           │                     │
│                                           ▼                     │
│  ┌──────────────────┐      ┌──────────────────────────────┐    │
│  │ DedupFilter      │      │ RetryScheduler               │    │
│  │ (inbound)        │      │ - exponential backoff        │    │
│  │ - LRU cache      │      │ - jitter                     │    │
│  │ - message IDs    │      │ - max retries                │    │
│  └──────────────────┘      └──────────────┬───────────────┘    │
│                                           │                     │
│                                           ▼                     │
│  ┌──────────────────┐      ┌──────────────────────────────┐    │
│  │ OfflineQueue     │      │ SequenceManager (optional)   │    │
│  │ (for peers)      │      │ - sequence numbers           │    │
│  │ - per-peer queue │      │ - reordering buffer          │    │
│  └──────────────────┘      └──────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │   P2PNetwork (send)   │
                  └───────────────────────┘
```

### 2.3 核心接口定义

#### 2.3.1 消息队列管理器

```typescript
// src/core/message-queue.ts

/** 消息队列条目 */
interface QueuedMessage {
  /** 消息 ID */
  messageId: string;
  /** 目标 Peer ID */
  peerId: string;
  /** F2A 消息 */
  message: F2AMessage;
  /** 优先级 (1-10, 10 最高) */
  priority: number;
  /** 创建时间 */
  createdAt: number;
  /** 重试次数 */
  retryCount: number;
  /** 下次重试时间 */
  nextRetryAt?: number;
  /** 状态 */
  status: 'pending' | 'sending' | 'acked' | 'failed';
}

/** 消息队列配置 */
export interface MessageQueueOptions {
  /** 最大队列长度 */
  maxQueueSize: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始重试延迟 (毫秒) */
  initialRetryDelayMs: number;
  /** 最大重试延迟 (毫秒) */
  maxRetryDelayMs: number;
  /** 退避因子 */
  backoffMultiplier: number;
  /** 是否启用持久化 */
  enablePersistence: boolean;
  /** 持久化目录 */
  persistDir?: string;
}

/** 消息队列管理器 */
export class MessageQueueManager {
  private queue: PriorityQueue<QueuedMessage>;
  private options: MessageQueueOptions;
  private logger: Logger;
  private pendingACKs: Map<string, QueuedMessage>;
  private retryTimer?: NodeJS.Timeout;

  constructor(options: MessageQueueOptions) {
    this.options = {
      maxQueueSize: 1000,
      maxRetries: 5,
      initialRetryDelayMs: 1000,
      maxRetryDelayMs: 60000,
      backoffMultiplier: 2,
      enablePersistence: false,
      ...options
    };
    
    this.queue = new PriorityQueue<QueuedMessage>(
      (a, b) => b.priority - a.priority || a.createdAt - b.createdAt
    );
    this.pendingACKs = new Map();
    this.logger = new Logger({ component: 'MessageQueue' });
  }

  /**
   * 添加消息到队列
   */
  async enqueue(message: F2AMessage, peerId: string, priority: number = 5): Promise<void> {
    const queuedMessage: QueuedMessage = {
      messageId: message.id,
      peerId,
      message,
      priority,
      createdAt: Date.now(),
      retryCount: 0,
      status: 'pending'
    };

    if (this.queue.size() >= this.options.maxQueueSize) {
      throw new Error('Message queue is full');
    }

    this.queue.enqueue(queuedMessage);
    
    // 如果启用了持久化，保存到磁盘
    if (this.options.enablePersistence) {
      await this.persistMessage(queuedMessage);
    }

    this.logger.debug('Message enqueued', {
      messageId: message.id.slice(0, 8),
      peerId: peerId.slice(0, 8),
      priority
    });
  }

  /**
   * 处理发送确认
   */
  async acknowledge(messageId: string): Promise<void> {
    const queuedMessage = this.pendingACKs.get(messageId);
    if (!queuedMessage) {
      this.logger.warn('ACK received for unknown message', { messageId });
      return;
    }

    queuedMessage.status = 'acked';
    this.pendingACKs.delete(messageId);

    // 从持久化存储中移除
    if (this.options.enablePersistence) {
      await this.removePersistedMessage(messageId);
    }

    this.logger.debug('Message acknowledged', { messageId: messageId.slice(0, 8) });
  }

  /**
   * 标记消息发送中 (等待 ACK)
   */
  markAsSending(messageId: string): void {
    const queuedMessage = this.queue.dequeueByMessageId(messageId);
    if (queuedMessage) {
      queuedMessage.status = 'sending';
      this.pendingACKs.set(messageId, queuedMessage);
    }
  }

  /**
   * 调度重试
   */
  scheduleRetry(messageId: string, error?: string): void {
    const queuedMessage = this.pendingACKs.get(messageId);
    if (!queuedMessage) return;

    queuedMessage.retryCount++;

    if (queuedMessage.retryCount > this.options.maxRetries) {
      queuedMessage.status = 'failed';
      this.pendingACKs.delete(messageId);
      this.logger.error('Message failed after max retries', {
        messageId: messageId.slice(0, 8),
        retryCount: queuedMessage.retryCount
      });
      return;
    }

    // 计算下次重试时间 (指数退避 + jitter)
    const delay = this.calculateBackoffDelay(queuedMessage.retryCount);
    queuedMessage.nextRetryAt = Date.now() + delay;
    queuedMessage.status = 'pending';

    // 移回队列
    this.queue.enqueue(queuedMessage);

    this.logger.info('Message scheduled for retry', {
      messageId: messageId.slice(0, 8),
      retryCount: queuedMessage.retryCount,
      delayMs: delay
    });
  }

  /**
   * 计算退避延迟 (指数退避 + jitter)
   */
  private calculateBackoffDelay(retryCount: number): number {
    const exponentialDelay = this.options.initialRetryDelayMs * 
      Math.pow(this.options.backoffMultiplier, retryCount - 1);
    
    const cappedDelay = Math.min(exponentialDelay, this.options.maxRetryDelayMs);
    
    // 添加 0-25% 的随机 jitter 防止同步重试
    const jitter = cappedDelay * 0.25 * Math.random();
    
    return Math.floor(cappedDelay + jitter);
  }

  /**
   * 获取下一条待发送消息
   */
  peekNext(): QueuedMessage | null {
    const now = Date.now();
    const next = this.queue.peek();
    
    if (!next) return null;
    
    // 检查是否到了重试时间
    if (next.nextRetryAt && next.nextRetryAt > now) {
      return null; // 还没到重试时间
    }
    
    return next;
  }

  /**
   * 启动重试调度器
   */
  startRetryScheduler(): void {
    const checkQueue = () => {
      const next = this.peekNext();
      if (next) {
        this.emit('message:ready', next);
      }
      
      // 1 秒后再次检查
      this.retryTimer = setTimeout(checkQueue, 1000);
    };
    
    checkQueue();
  }

  /**
   * 停止重试调度器
   */
  stopRetryScheduler(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }
}
```

#### 2.3.2 ACK 管理器

```typescript
// src/core/ack-manager.ts

/** ACK 记录 */
interface ACKRecord {
  messageId: string;
  peerId: string;
  sentAt: number;
  timeoutMs: number;
  expiresAt: number;
  retryCount: number;
  onACK?: () => void;
  onTimeout?: () => void;
}

/** ACK 管理器配置 */
export interface ACKManagerOptions {
  /** ACK 超时时间 (毫秒) */
  ackTimeoutMs: number;
  /** 最大重试次数 */
  maxRetries: number;
}

/** ACK 管理器 */
export class ACKManager {
  private pendingACKs: Map<string, ACKRecord>;
  private options: ACKManagerOptions;
  private logger: Logger;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: ACKManagerOptions = { ackTimeoutMs: 5000, maxRetries: 3 }) {
    this.pendingACKs = new Map();
    this.options = options;
    this.logger = new Logger({ component: 'ACKManager' });
  }

  /**
   * 记录待 ACK 的消息
   */
  recordPending(message: F2AMessage, peerId: string): void {
    const record: ACKRecord = {
      messageId: message.id,
      peerId,
      sentAt: Date.now(),
      timeoutMs: this.options.ackTimeoutMs,
      expiresAt: Date.now() + this.options.ackTimeoutMs,
      retryCount: 0
    };

    this.pendingACKs.set(message.id, record);

    // 设置超时定时器
    setTimeout(() => {
      this.checkTimeout(message.id);
    }, this.options.ackTimeoutMs);

    this.logger.debug('ACK recorded', {
      messageId: message.id.slice(0, 8),
      peerId: peerId.slice(0, 8)
    });
  }

  /**
   * 处理收到的 ACK
   */
  handleACK(messageId: string): boolean {
    const record = this.pendingACKs.get(messageId);
    if (!record) {
      return false;
    }

    this.pendingACKs.delete(messageId);
    
    if (record.onACK) {
      record.onACK();
    }

    this.logger.debug('ACK received', { messageId: messageId.slice(0, 8) });
    return true;
  }

  /**
   * 检查超时
   */
  private checkTimeout(messageId: string): void {
    const record = this.pendingACKs.get(messageId);
    if (!record) return;

    const now = Date.now();
    if (now >= record.expiresAt) {
      // 超时
      record.retryCount++;

      if (record.retryCount > this.options.maxRetries) {
        // 超过最大重试次数
        this.pendingACKs.delete(messageId);
        this.logger.error('Message timeout after max retries', {
          messageId: messageId.slice(0, 8),
          retryCount: record.retryCount
        });
        
        if (record.onTimeout) {
          record.onTimeout();
        }
      } else {
        // 重试
        this.logger.warn('Message timeout, scheduling retry', {
          messageId: messageId.slice(0, 8),
          retryCount: record.retryCount
        });
        
        // 触发重试事件
        this.emit('ack:timeout', { messageId, peerId: record.peerId, retryCount: record.retryCount });
      }
    }
  }

  /**
   * 获取待 ACK 数量
   */
  getPendingCount(): number {
    return this.pendingACKs.size;
  }
}
```

#### 2.3.3 消息去重过滤器

```typescript
// src/core/message-dedup.ts

import { LRUCache } from 'lru-cache';

/** 去重过滤器配置 */
export interface DedupFilterOptions {
  /** 最大缓存消息数 */
  maxCacheSize: number;
  /** 消息 TTL (毫秒) */
  messageTTLms: number;
}

/** 消息去重过滤器 */
export class MessageDedupFilter {
  private seenMessages: LRUCache<string, number>;
  private options: DedupFilterOptions;
  private logger: Logger;

  constructor(options: DedupFilterOptions = { maxCacheSize: 10000, messageTTLms: 300000 }) {
    this.options = options;
    this.logger = new Logger({ component: 'DedupFilter' });

    // 使用 LRU 缓存存储已见过的消息 ID
    this.seenMessages = new LRUCache({
      max: options.maxCacheSize,
      ttl: options.messageTTLms,
      updateAgeOnGet: false
    });
  }

  /**
   * 检查消息是否重复
   * @returns true 如果是新消息，false 如果是重复消息
   */
  isNewMessage(messageId: string, peerId: string): boolean {
    // 使用 peerId + messageId 组合作为唯一键
    const key = `${peerId}:${messageId}`;
    
    if (this.seenMessages.has(key)) {
      this.logger.debug('Duplicate message detected', {
        messageId: messageId.slice(0, 8),
        peerId: peerId.slice(0, 8)
      });
      return false;
    }

    // 记录新消息
    this.seenMessages.set(key, Date.now());
    return true;
  }

  /**
   * 批量检查消息
   */
  filterDuplicates(messages: Array<{ id: string; from: string }>): Array<{ id: string; from: string }> {
    return messages.filter(msg => this.isNewMessage(msg.id, msg.from));
  }

  /**
   * 获取缓存统计
   */
  getStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.seenMessages.size,
      hits: this.seenMessages.hits,
      misses: this.seenMessages.misses
    };
  }

  /**
   * 清除过期消息
   */
  cleanup(): void {
    this.seenMessages.purgeStale();
  }
}
```

#### 2.3.4 序列号管理器 (可选顺序保证)

```typescript
// src/core/sequence-manager.ts

/** 序列号管理器 */
export class SequenceManager {
  private outgoingSequences: Map<string, number>; // peerId -> sequence
  private incomingBuffers: Map<string, Map<number, F2AMessage>>; // peerId -> buffer
  private expectedSequences: Map<string, number>; // peerId -> expected sequence
  private logger: Logger;

  constructor() {
    this.outgoingSequences = new Map();
    this.incomingBuffers = new Map();
    this.expectedSequences = new Map();
    this.logger = new Logger({ component: 'SequenceManager' });
  }

  /**
   * 为 outgoing 消息分配序列号
   */
  assignSequence(peerId: string): number {
    const current = this.outgoingSequences.get(peerId) || 0;
    const next = current + 1;
    this.outgoingSequences.set(peerId, next);
    return next;
  }

  /**
   * 处理收到的消息 (带序号)
   * @returns 可以按序投递的消息列表
   */
  handleIncomingMessage(message: F2AMessage, peerId: string, sequence: number): F2AMessage[] {
    // 初始化
    if (!this.incomingBuffers.has(peerId)) {
      this.incomingBuffers.set(peerId, new Map());
      this.expectedSequences.set(peerId, 1);
    }

    const buffer = this.incomingBuffers.get(peerId)!;
    const expected = this.expectedSequences.get(peerId)!;

    // 如果是期望的序列号，直接返回
    if (sequence === expected) {
      this.expectedSequences.set(peerId, sequence + 1);
      
      // 检查 buffer 中是否有后续消息可以投递
      const deliverable = [message];
      let next = sequence + 1;
      while (buffer.has(next)) {
        deliverable.push(buffer.get(next)!);
        buffer.delete(next);
        next++;
      }
      this.expectedSequences.set(peerId, next);
      
      return deliverable;
    }

    // 如果是乱序消息，存入 buffer
    if (sequence > expected) {
      buffer.set(sequence, message);
      this.logger.debug('Out-of-order message buffered', {
        peerId: peerId.slice(0, 8),
        sequence,
        expected
      });
    } else {
      // 重复或过期的消息
      this.logger.debug('Duplicate/old message ignored', {
        peerId: peerId.slice(0, 8),
        sequence,
        expected
      });
    }

    return [];
  }
}
```

### 2.4 消息可靠性数据流图

```
发送方流程:
┌─────────────┐
│ 应用层消息   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ 1. 分配序列号    │ (可选，SequenceManager)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 2. 添加到队列    │ (MessageQueueManager)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 3. 发送消息      │ (P2PNetwork.send)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 4. 记录待 ACK    │ (ACKManager.recordPending)
└──────┬──────────┘
       │
       ├──────────────┐
       │              │
       ▼              ▼
  ┌────────┐    ┌──────────┐
  │ 收到 ACK│    │ ACK 超时  │
  └───┬────┘    └────┬─────┘
      │              │
      ▼              ▼
  ┌────────┐    ┌──────────┐
  │ 成功    │    │ 重试队列 │
  └────────┘    └────┬─────┘
                     │
                     ▼
               ┌──────────┐
               │ 指数退避 │
               └────┬─────┘
                    │
                    └──────▶ 回到步骤 3


接收方流程:
┌─────────────┐
│ 收到消息     │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ 1. 去重检查      │ (MessageDedupFilter.isNewMessage)
└──────┬──────────┘
       │
       ├─ 重复 ──▶ 丢弃
       │
       ▼ 新消息
┌─────────────────┐
│ 2. 序列号检查    │ (可选，SequenceManager)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 3. 处理消息      │ (业务逻辑)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 4. 发送 ACK      │ (自动)
└─────────────────┘
```

### 2.5 关键算法伪代码

#### 2.5.1 指数退避重传算法

```typescript
/**
 * 计算重传延迟 (指数退避 + jitter)
 * 
 * 公式: delay = min(initialDelay * (base ^ retryCount), maxDelay) + jitter
 * 其中 jitter = delay * random(0, 0.25)
 */
function calculateBackoffDelay(
  retryCount: number,
  initialDelayMs: number = 1000,
  maxDelayMs: number = 60000,
  base: number = 2
): number {
  // 指数增长
  const exponentialDelay = initialDelayMs * Math.pow(base, retryCount - 1);
  
  // 限制最大值
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // 添加 0-25% jitter 防止多个节点同时重试导致网络拥塞
  const jitter = cappedDelay * 0.25 * Math.random();
  
  return Math.floor(cappedDelay + jitter);
}

// 示例:
// retryCount=1: 1000ms + 0-250ms jitter
// retryCount=2: 2000ms + 0-500ms jitter
// retryCount=3: 4000ms + 0-1000ms jitter
// retryCount=4: 8000ms + 0-2000ms jitter
// retryCount=5: 16000ms + 0-4000ms jitter
// retryCount=6+: 60000ms ( capped) + 0-15000ms jitter
```

#### 2.5.2 消息去重算法

```typescript
/**
 * 基于 LRU 缓存的消息去重
 * 
 * 数据结构:
 * - key: "${peerId}:${messageId}"
 * - value: timestamp
 * - TTL: 5 分钟 (300000ms)
 * - 最大容量: 10000 条记录
 */
class MessageDedupFilter {
  private cache: LRUCache<string, number>;
  
  isNewMessage(messageId: string, peerId: string): boolean {
    const key = `${peerId}:${messageId}`;
    
    if (this.cache.has(key)) {
      // 重复消息
      return false;
    }
    
    // 新消息，记录到缓存
    this.cache.set(key, Date.now());
    return true;
  }
  
  // 后台定期清理过期条目
  cleanup() {
    this.cache.purgeStale(); // LRU 自动清理 TTL 过期的条目
  }
}
```

#### 2.5.3 ACK 超时处理算法

```typescript
/**
 * ACK 超时处理流程
 */
async function handleACKTimeout(
  messageId: string,
  retryCount: number,
  maxRetries: number
): Promise<void> {
  if (retryCount >= maxRetries) {
    // 超过最大重试次数，标记为失败
    await markMessageAsFailed(messageId);
    emit('message:failed', { messageId, reason: 'MAX_RETRIES_EXCEEDED' });
    return;
  }
  
  // 计算下次重试延迟
  const delay = calculateBackoffDelay(retryCount + 1);
  
  // 调度重试
  scheduleRetry(messageId, delay);
  
  // 记录日志
  logger.warn('Message timeout, scheduling retry', {
    messageId,
    retryCount: retryCount + 1,
    delayMs: delay
  });
}
```

### 2.6 离线消息处理

```typescript
// src/core/offline-queue.ts

/** 离线消息队列 */
export class OfflineQueueManager {
  private peerQueues: Map<string, QueuedMessage[]>; // peerId -> queue
  private maxOfflineMessages: number;
  private logger: Logger;

  constructor(maxOfflineMessages: number = 100) {
    this.peerQueues = new Map();
    this.maxOfflineMessages = maxOfflineMessages;
    this.logger = new Logger({ component: 'OfflineQueue' });
  }

  /**
   * 添加离线消息
   */
  enqueue(peerId: string, message: F2AMessage): void {
    if (!this.peerQueues.has(peerId)) {
      this.peerQueues.set(peerId, []);
    }

    const queue = this.peerQueues.get(peerId)!;
    
    if (queue.length >= this.maxOfflineMessages) {
      // 队列已满，丢弃最旧的消息
      queue.shift();
      this.logger.warn('Offline queue full, dropped oldest message', {
        peerId: peerId.slice(0, 8)
      });
    }

    queue.push({
      messageId: message.id,
      peerId,
      message,
      enqueuedAt: Date.now()
    });

    this.logger.debug('Message queued for offline peer', {
      peerId: peerId.slice(0, 8),
      messageId: message.id.slice(0, 8)
    });
  }

  /**
   * Peer 上线时获取离线消息
   */
  dequeue(peerId: string): QueuedMessage[] {
    const queue = this.peerQueues.get(peerId);
    if (!queue || queue.length === 0) {
      return [];
    }

    // 取出所有消息并清空队列
    this.peerQueues.delete(peerId);
    
    this.logger.info('Delivering offline messages', {
      peerId: peerId.slice(0, 8),
      count: queue.length
    });

    return queue;
  }

  /**
   * 获取离线消息数量
   */
  getOfflineCount(peerId: string): number {
    return this.peerQueues.get(peerId)?.length || 0;
  }
}
```

---

## 三、与现有代码的集成点

### 3.1 需要修改的文件

#### 3.1.1 新增文件

```
src/core/
├── identity-manager.ts          # 身份管理器 (新增)
├── encrypted-key-store.ts       # 加密密钥存储 (新增)
├── message-queue.ts             # 消息队列管理器 (新增)
├── ack-manager.ts               # ACK 管理器 (新增)
├── message-dedup.ts             # 消息去重过滤器 (新增)
├── sequence-manager.ts          # 序列号管理器 (可选，新增)
└── offline-queue.ts             # 离线消息队列 (新增)
```

#### 3.1.2 修改现有文件

**1. src/core/e2ee-crypto.ts**

```typescript
// 修改点：添加从 IdentityManager 加载密钥的方法

export class E2EECrypto {
  // ... 现有代码 ...

  /**
   * 从 IdentityManager 加载密钥对
   */
  loadFromIdentity(identity: NodeIdentity): void {
    this.keyPair = identity.encryptionKeyPair;
    this.logger.info('Loaded encryption keys from IdentityManager');
  }

  /**
   * 获取私钥 (用于导出)
   */
  getPrivateKey(): Uint8Array | null {
    return this.keyPair?.privateKey || null;
  }
}
```

**2. src/core/p2p-network.ts**

```typescript
// 修改点：集成消息可靠性层

import { MessageQueueManager } from './message-queue.js';
import { ACKManager } from './ack-manager.js';
import { MessageDedupFilter } from './message-dedup.js';
import { IdentityManager } from './identity-manager.js';

export class P2PNetwork extends EventEmitter<P2PNetworkEvents> {
  // 新增成员
  private identityManager: IdentityManager;
  private messageQueue: MessageQueueManager;
  private ackManager: ACKManager;
  private dedupFilter: MessageDedupFilter;

  constructor(agentInfo: AgentInfo, config: P2PNetworkConfig = {}) {
    super();
    // ... 现有代码 ...
    
    // 初始化可靠性组件
    this.identityManager = new IdentityManager({ 
      dataDir: config.dataDir || './f2a-data' 
    });
    this.messageQueue = new MessageQueueManager({
      maxQueueSize: 1000,
      maxRetries: 5,
      enablePersistence: config.enableMessagePersistence || false
    });
    this.ackManager = new ACKManager({
      ackTimeoutMs: 5000,
      maxRetries: 3
    });
    this.dedupFilter = new MessageDedupFilter({
      maxCacheSize: 10000,
      messageTTLms: 300000
    });
  }

  async start(): Promise<Result<{ peerId: string; addresses: string[] }>> {
    // 修改点：启动时加载身份
    const identity = await this.identityManager.loadOrCreate();
    
    // 使用持久化的身份初始化 E2EE
    this.e2eeCrypto.loadFromIdentity(identity);
    this.agentInfo.peerId = identity.peerId;
    this.agentInfo.encryptionPublicKey = this.e2eeCrypto.getPublicKey() || undefined;
    
    // ... 现有启动代码 ...
    
    // 启动消息队列调度器
    this.messageQueue.startRetryScheduler();
    
    return success({ peerId: identity.peerId, addresses: addrs });
  }

  async stop(): Promise<void> {
    // 修改点：停止时清理资源
    this.messageQueue.stopRetryScheduler();
    this.dedupFilter.cleanup();
    
    // ... 现有停止代码 ...
  }

  // 修改点：发送消息时集成可靠性层
  private async sendMessage(peerId: string, message: F2AMessage, encrypt: boolean = false): Promise<Result<void>> {
    // 1. 添加到消息队列
    await this.messageQueue.enqueue(message, peerId);
    
    // 2. 立即尝试发送
    return this.sendQueuedMessage(message, peerId, encrypt);
  }

  // 新增：发送队列中的消息
  private async sendQueuedMessage(message: F2AMessage, peerId: string, encrypt: boolean): Promise<Result<void>> {
    // 标记为发送中
    this.messageQueue.markAsSending(message.id);
    
    // 记录待 ACK
    this.ackManager.recordPending(message, peerId);
    
    // ... 现有发送逻辑 ...
    
    const result = await this.performSend(peerId, message, encrypt);
    
    if (result.success) {
      // 发送成功，等待 ACK
      return result;
    } else {
      // 发送失败，调度重试
      this.messageQueue.scheduleRetry(message.id, result.error?.message);
      return result;
    }
  }

  // 修改点：处理收到的消息时集成去重
  private async handleMessage(message: F2AMessage, peerId: string): Promise<void> {
    // 1. 去重检查
    if (!this.dedupFilter.isNewMessage(message.id, peerId)) {
      this.logger.debug('Duplicate message ignored', { messageId: message.id.slice(0, 8) });
      return;
    }
    
    // 2. 如果是 TASK_RESPONSE，处理 ACK
    if (message.type === 'TASK_RESPONSE') {
      const payload = message.payload as TaskResponsePayload;
      const acked = this.ackManager.handleACK(payload.taskId);
      if (acked) {
        this.logger.debug('Task response ACKed', { taskId: payload.taskId.slice(0, 8) });
      }
    }
    
    // ... 现有处理逻辑 ...
  }
}
```

**3. src/core/f2a.ts**

```typescript
// 修改点：添加身份管理 CLI 命令

export class F2A extends EventEmitter<F2AEvents> implements F2AInstance {
  // 新增方法：导出身份
  async exportIdentity(password: string): Promise<string> {
    // 访问 P2P 网络的 IdentityManager
    return this.p2pNetwork.exportIdentity(password);
  }

  // 新增方法：导入身份
  async importIdentity(backupData: string, password: string): Promise<void> {
    await this.p2pNetwork.importIdentity(backupData, password);
  }
}
```

**4. src/cli/commands.ts**

```typescript
// 新增 CLI 命令

// f2a identity export
program
  .command('identity:export')
  .description('Export encrypted identity backup')
  .option('-o, --output <file>', 'Output file path', 'f2a-identity-backup.json')
  .option('-p, --password <password>', 'Encryption password')
  .action(async (options) => {
    const f2a = await F2A.create();
    const backup = await f2a.exportIdentity(options.password);
    await fs.promises.writeFile(options.output, backup);
    console.log(`Identity exported to ${options.output}`);
  });

// f2a identity import
program
  .command('identity:import')
  .description('Import identity from backup')
  .option('-i, --input <file>', 'Input backup file')
  .option('-p, --password <password>', 'Decryption password')
  .action(async (options) => {
    const backup = await fs.promises.readFile(options.input, 'utf-8');
    const f2a = await F2A.create();
    await f2a.importIdentity(backup, options.password);
    console.log('Identity imported successfully');
  });
```

### 3.2 集成流程图

```
F2A 启动流程 (集成身份持久化):
┌─────────────────┐
│ F2A.create()    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ P2PNetwork.start()│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ IdentityManager │
│ .loadOrCreate() │
└────────┬────────┘
         │
         ├─ 存在 ──▶ 解密加载
         │
         └─ 不存在 ──▶ 生成新身份
                        │
                        ▼
                   加密存储
                        │
         ◀──────────────┘
         │
         ▼
┌─────────────────┐
│ E2EECrypto      │
│ .loadFromIdentity()│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 正常启动 P2P 网络  │
└─────────────────┘


消息发送流程 (集成可靠性):
┌─────────────────┐
│ 应用层调用       │
│ sendMessage()   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ MessageQueue    │
│ .enqueue()      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ACKManager      │
│ .recordPending()│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ P2PNetwork.send()│
└────────┬────────┘
         │
         ├─ 成功 ──▶ 等待 ACK
         │            │
         │            ├─ 收到 ACK ──▶ 完成
         │            │
         │            └─ 超时 ──▶ 重试
         │
         └─ 失败 ──▶ MessageQueue
                      .scheduleRetry()
                           │
                           ▼
                      指数退避
                           │
                           └──────▶ 重新发送


消息接收流程 (集成去重):
┌─────────────────┐
│ P2PNetwork      │
│ 收到消息         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ DedupFilter     │
│ .isNewMessage() │
└────────┬────────┘
         │
         ├─ 重复 ──▶ 丢弃
         │
         └─ 新消息 ──▶ 处理
                        │
                        ▼
                   业务逻辑
                        │
                        ▼
                   发送 ACK
```

---

## 四、技术选型建议

### 4.1 存储方案

| 组件 | 推荐方案 | 备选方案 | 理由 |
|------|----------|----------|------|
| 身份存储 | 加密 JSON 文件 | OS Keychain | 跨平台，易备份 |
| 消息队列 | 内存 + 可选文件持久化 | SQLite | 简单场景内存足够 |
| 去重缓存 | LRU Cache (lru-cache 库) | Redis | 本地缓存足够 |
| 离线消息 | 内存队列 | LevelDB | 离线消息量少 |

### 4.2 序列化格式

| 场景 | 推荐格式 | 理由 |
|------|----------|------|
| 身份备份 | JSON (加密后) | 人类可读，易解析 |
| 消息传输 | JSON | 与现有协议一致 |
| 持久化队列 | JSON Lines | 易追加，易恢复 |

### 4.3 依赖库建议

```json
{
  "dependencies": {
    "lru-cache": "^10.0.0",
    "@types/lru-cache": "^10.0.0"
  },
  "optionalDependencies": {
    "keytar": "^7.9.0"
  }
}
```

- **lru-cache**: 高效的 LRU 缓存实现，用于消息去重
- **keytar** (可选): 操作系统密钥链访问 (macOS/Windows/Linux)

### 4.4 安全加固建议

1. **密码管理**:
   - 支持环境变量 `F2A_IDENTITY_PASSWORD`
   - 支持交互式密码输入 (CLI)
   - 推荐使用强密码 (16+ 字符，包含大小写、数字、符号)

2. **文件权限**:
   - 身份文件：0o600 (仅所有者读写)
   - 数据目录：0o700 (仅所有者访问)

3. **密钥派生**:
   - 算法：PBKDF2-SHA256
   - 迭代次数：100,000
   - 盐值：16 字节随机

4. **加密算法**:
   - 算法：AES-256-GCM
   - 密钥长度：256 位
   - IV 长度：16 字节 (每次加密随机生成)

---

## 五、实施路线图

### Phase 1: 身份持久化 (优先级：高)

**Week 1-2**:
- [ ] 实现 `EncryptedKeyStore`
- [ ] 实现 `IdentityManager`
- [ ] 集成到 `P2PNetwork.start()`
- [ ] 添加 CLI 命令 (export/import)
- [ ] 编写单元测试

**Week 3**:
- [ ] 集成测试
- [ ] 文档编写
- [ ] 安全审计

### Phase 2: 消息可靠性基础 (优先级：高)

**Week 4-5**:
- [ ] 实现 `MessageQueueManager`
- [ ] 实现 `ACKManager`
- [ ] 实现 `MessageDedupFilter`
- [ ] 集成到 `P2PNetwork.sendMessage()`
- [ ] 编写单元测试

**Week 6**:
- [ ] 集成测试
- [ ] 性能测试 (消息吞吐量)
- [ ] 文档编写

### Phase 3: 高级特性 (优先级：中)

**Week 7-8**:
- [ ] 实现 `SequenceManager` (可选顺序保证)
- [ ] 实现 `OfflineQueueManager`
- [ ] 消息持久化 (可选)
- [ ] 性能优化

**Week 9-10**:
- [ ] 端到端测试
- [ ] 压力测试
- [ ] 文档完善

### Phase 4: 多设备同步 (优先级：低，可选)

**Week 11-12**:
- [ ] 实现云同步接口
- [ ] 集成 iCloud/Dropbox
- [ ] 冲突解决机制
- [ ] 用户测试

---

## 六、风险与缓解

### 6.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 密钥丢失 | 高 | 低 | 强制备份机制，多副本存储 |
| 密码遗忘 | 高 | 中 | 提供恢复短语 (可选) |
| 性能下降 | 中 | 中 | 异步处理，批量操作 |
| 消息重复 | 中 | 低 | 去重缓存，幂等处理 |

### 6.2 安全风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 私钥泄露 | 高 | 低 | 加密存储，文件权限保护 |
| 中间人攻击 | 高 | 低 | E2EE 加密，公钥验证 |
| 重放攻击 | 中 | 中 | 消息去重，时间戳验证 |

---

## 七、总结

本架构设计文档提供了 F2A 项目的两个核心增强：

1. **节点身份持久化**: 通过 `IdentityManager` 和 `EncryptedKeyStore` 实现安全的身份管理，支持加密存储、备份恢复。

2. **消息可靠性**: 通过 `MessageQueueManager`、`ACKManager`、`MessageDedupFilter` 实现至少一次投递、消息去重、指数退避重传。

### 关键设计决策

- **加密优先**: 所有敏感数据 (私钥、身份) 必须加密存储
- **渐进式实现**: 分 Phase 实施，优先保证基础功能
- **向后兼容**: 不破坏现有 API，通过可选配置启用新功能
- **性能平衡**: 默认使用内存存储，可选持久化

### 下一步行动

1. 评审本设计文档
2. 确认技术选型
3. 开始 Phase 1 实施
4. 定期同步进度

---

**文档结束**
