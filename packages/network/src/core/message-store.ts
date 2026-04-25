/**
 * MessageStore - 消息历史持久化存储
 * 基于 SQLite 实现消息记录的存储与查询
 */

import Database from 'better-sqlite3';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Logger } from '../utils/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 消息记录
 */
export interface MessageRecord {
  /** 消息 ID */
  id: string;
  /** 发送者 Agent ID (PeerID) */
  from: string;
  /** 接收者 Agent ID (PeerID)，广播消息可为空 */
  to: string;
  /** 消息类型 (DISCOVER/TASK_REQUEST/MESSAGE...) */
  type: string;
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 消息摘要（可选） */
  summary?: string;
  /** JSON 序列化的 payload（可选） */
  payload?: string | null;
  /** 会话 ID（可选） */
  conversationId?: string;
  /** 回复的消息 ID（可选） */
  replyToMessageId?: string;
  /** 本地视角下的消息方向 */
  direction?: 'inbound' | 'outbound' | 'local';
  /** 本地视角 Agent ID */
  agentId?: string;
  /** 对方 Agent ID */
  peerAgentId?: string;
  /** JSON 序列化的 metadata（可选） */
  metadata?: string;
  /** 创建时间（毫秒，兼容 timestamp） */
  createdAt?: number;
}

/**
 * 会话摘要
 */
export interface ConversationSummary {
  /** 会话 ID */
  conversationId: string;
  /** 对方 Agent ID */
  peerAgentId: string;
  /** 最后一条消息时间 */
  lastMessageAt: number;
  /** 消息数量 */
  messageCount: number;
  /** 最后一条消息摘要 */
  lastSummary?: string;
}

/**
 * MessageStore 接口
 */
export interface IMessageStore {
  /** 添加消息记录 */
  add(message: MessageRecord): Promise<void>;
  /** 获取最近的消息记录 */
  getRecent(limit?: number): Promise<MessageRecord[]>;
  /** 获取与特定 Agent 相关的消息记录 */
  getByAgent(agentId: string, limit?: number): Promise<MessageRecord[]>;
  /** 获取指定会话的消息记录 */
  getByConversation(agentId: string, conversationId: string, limit?: number): Promise<MessageRecord[]>;
  /** 获取指定消息 */
  getByMessageId(messageId: string): Promise<MessageRecord | undefined>;
  /** 获取 Agent 的会话摘要列表 */
  listConversations(agentId: string, limit?: number): Promise<ConversationSummary[]>;
  /** 清空所有消息记录 */
  clear(): Promise<void>;
  /** 关闭数据库连接 */
  close(): void;
}

/**
 * MessageStore 配置选项
 */
export interface MessageStoreOptions {
  /** 数据库文件路径（默认: workspace/.f2a/messages.db） */
  dbPath?: string;
  /** 保留天数（默认: 7） */
  retentionDays?: number;
  /** 最大记录数（默认: 10000） */
  maxRecords?: number;
  /** 日志级别 */
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_RECORDS = 10000;
const DEFAULT_DB_PATH = '.f2a/messages.db';

// ============================================================================
// MessageStore 实现
// ============================================================================

/**
 * 消息历史存储类
 * 使用 SQLite 实现持久化存储，支持自动清理过期记录
 */
export class MessageStore implements IMessageStore {
  private db: Database.Database;
  private logger: Logger;
  private retentionDays: number;
  private maxRecords: number;
  private dbPath: string;

  /**
   * 创建 MessageStore 实例
   * @param options 配置选项
   */
  constructor(options: MessageStoreOptions = {}) {
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    this.logger = new Logger({
      level: options.logLevel || 'INFO',
      component: 'MessageStore'
    });

    // 确保目录存在
    const dbDir = dirname(this.dbPath);
    mkdir(dbDir, { recursive: true }).catch(err => {
      this.logger.warn('Failed to create db directory', { error: err.message });
    });

    // 打开数据库
    this.db = new Database(this.dbPath);

    // 初始化表结构
    this.initTables();

    this.logger.info('MessageStore initialized', {
      dbPath: this.dbPath,
      retentionDays: this.retentionDays,
      maxRecords: this.maxRecords
    });
  }

  /**
   * 初始化数据库表
   */
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        summary TEXT,
        payload TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_from ON messages("from");
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages("to");
      CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
    `);

    this.ensureColumn('messages', 'conversation_id', 'TEXT');
    this.ensureColumn('messages', 'reply_to_message_id', 'TEXT');
    this.ensureColumn('messages', 'direction', 'TEXT');
    this.ensureColumn('messages', 'agent_id', 'TEXT');
    this.ensureColumn('messages', 'peer_agent_id', 'TEXT');
    this.ensureColumn('messages', 'metadata', 'TEXT');
    this.ensureColumn('messages', 'created_at', 'INTEGER');

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_peer_agent_id ON messages(peer_agent_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    `);
  }

  /**
   * 幂等补充列，用于兼容旧 messages.db
   */
  private ensureColumn(tableName: string, columnName: string, columnType: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (columns.some(column => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }

  /**
   * 将数据库行转换为 MessageRecord，避免旧调用方看到 null 扩展字段
   */
  private rowToRecord(row: Record<string, unknown>): MessageRecord {
    const record: MessageRecord = {
      id: row.id as string,
      from: row.from as string,
      to: row.to as string,
      type: row.type as string,
      timestamp: row.timestamp as number,
    };

    if (row.summary !== null && row.summary !== undefined) record.summary = row.summary as string;
    if (row.payload !== undefined) record.payload = row.payload as string | null;
    if (row.conversation_id !== null && row.conversation_id !== undefined) record.conversationId = row.conversation_id as string;
    if (row.reply_to_message_id !== null && row.reply_to_message_id !== undefined) record.replyToMessageId = row.reply_to_message_id as string;
    if (row.direction !== null && row.direction !== undefined) record.direction = row.direction as MessageRecord['direction'];
    if (row.agent_id !== null && row.agent_id !== undefined) record.agentId = row.agent_id as string;
    if (row.peer_agent_id !== null && row.peer_agent_id !== undefined) record.peerAgentId = row.peer_agent_id as string;
    if (row.metadata !== null && row.metadata !== undefined) record.metadata = row.metadata as string;
    if (row.created_at !== null && row.created_at !== undefined) record.createdAt = row.created_at as number;

    return record;
  }

  /**
   * 添加消息记录
   * @param message 消息记录
   */
  async add(message: MessageRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, "from", "to", type, timestamp, summary, payload,
        conversation_id, reply_to_message_id, direction, agent_id, peer_agent_id,
        metadata, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.from,
      message.to || '',
      message.type,
      message.timestamp,
      message.summary || null,
      message.payload || null,
      message.conversationId || null,
      message.replyToMessageId || null,
      message.direction || null,
      message.agentId || null,
      message.peerAgentId || null,
      message.metadata || null,
      message.createdAt || message.timestamp
    );

    // 检查是否需要清理
    await this.checkAndCleanup();

    this.logger.debug('Message added', {
      id: message.id,
      type: message.type,
      from: message.from.slice(0, 16)
    });
  }

  /**
   * 获取最近的记录数
   * @param limit 限制数量（默认 100）
   */
  async getRecent(limit: number = 100): Promise<MessageRecord[]> {
    const stmt = this.db.prepare(`
      SELECT id, "from", "to", type, timestamp, summary, payload
      FROM messages
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as Array<Record<string, unknown>>;
    return rows.map(row => this.rowToRecord(row));
  }

  /**
   * 获取与特定 Agent 相关的消息记录
   * @param agentId Agent ID (PeerID)
   * @param limit 限制数量（默认 100）
   */
  async getByAgent(agentId: string, limit: number = 100): Promise<MessageRecord[]> {
    const stmt = this.db.prepare(`
      SELECT id, "from", "to", type, timestamp, summary, payload,
             conversation_id, reply_to_message_id, direction, agent_id,
             peer_agent_id, metadata, created_at
      FROM messages
      WHERE "from" = ? OR "to" = ? OR agent_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(agentId, agentId, agentId, limit) as Array<Record<string, unknown>>;
    return rows.map(row => this.rowToRecord(row));
  }

  /**
   * 获取指定会话的消息记录
   * @param agentId 本地视角 Agent ID
   * @param conversationId 会话 ID
   * @param limit 限制数量（默认 100）
   */
  async getByConversation(
    agentId: string,
    conversationId: string,
    limit: number = 100
  ): Promise<MessageRecord[]> {
    const stmt = this.db.prepare(`
      SELECT id, "from", "to", type, timestamp, summary, payload,
             conversation_id, reply_to_message_id, direction, agent_id,
             peer_agent_id, metadata, created_at
      FROM messages
      WHERE agent_id = ? AND conversation_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);

    const rows = stmt.all(agentId, conversationId, limit) as Array<Record<string, unknown>>;
    return rows.map(row => this.rowToRecord(row));
  }

  /**
   * 获取指定消息
   * @param messageId 消息 ID
   */
  async getByMessageId(messageId: string): Promise<MessageRecord | undefined> {
    const stmt = this.db.prepare(`
      SELECT id, "from", "to", type, timestamp, summary, payload,
             conversation_id, reply_to_message_id, direction, agent_id,
             peer_agent_id, metadata, created_at
      FROM messages
      WHERE id = ?
      LIMIT 1
    `);

    const row = stmt.get(messageId) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  /**
   * 获取 Agent 的会话摘要列表
   * @param agentId 本地视角 Agent ID
   * @param limit 限制数量（默认 50）
   */
  async listConversations(agentId: string, limit: number = 50): Promise<ConversationSummary[]> {
    const stmt = this.db.prepare(`
      SELECT
        conversation_id as conversationId,
        peer_agent_id as peerAgentId,
        MAX(timestamp) as lastMessageAt,
        COUNT(*) as messageCount,
        (
          SELECT m2.summary
          FROM messages m2
          WHERE m2.agent_id = messages.agent_id
            AND m2.conversation_id = messages.conversation_id
            AND m2.peer_agent_id = messages.peer_agent_id
          ORDER BY m2.timestamp DESC
          LIMIT 1
        ) as lastSummary
      FROM messages
      WHERE agent_id = ? AND conversation_id IS NOT NULL
      GROUP BY conversation_id, peer_agent_id
      ORDER BY lastMessageAt DESC
      LIMIT ?
    `);

    const rows = stmt.all(agentId, limit) as Array<{
      conversationId: string;
      peerAgentId: string;
      lastMessageAt: number;
      messageCount: number;
      lastSummary: string | null;
    }>;

    return rows.map(row => ({
      conversationId: row.conversationId,
      peerAgentId: row.peerAgentId,
      lastMessageAt: row.lastMessageAt,
      messageCount: row.messageCount,
      ...(row.lastSummary !== null ? { lastSummary: row.lastSummary } : {})
    }));
  }

  /**
   * 清空所有消息记录
   */
  async clear(): Promise<void> {
    this.db.exec('DELETE FROM messages');
    this.logger.info('All messages cleared');
  }

  /**
   * 检查并清理过期记录
   */
  private async checkAndCleanup(): Promise<void> {
    // 获取当前记录数
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
    const result = countStmt.get() as { count: number };
    const count = result.count;

    // 如果超过阈值，执行清理
    if (count >= this.maxRecords * 0.9) {
      await this.cleanup();
    }
  }

  /**
   * 执行清理：删除过期记录，或超过上限的旧记录
   */
  private async cleanup(): Promise<void> {
    const cutoffTime = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

    // 1. 删除过期记录
    const deleteExpiredStmt = this.db.prepare(`
      DELETE FROM messages
      WHERE timestamp < ?
    `);
    const expiredDeleted = deleteExpiredStmt.run(cutoffTime).changes;

    // 2. 如果仍超过上限，删除最旧的记录
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
    const countResult = countStmt.get() as { count: number };
    const currentCount = countResult.count;

    if (currentCount > this.maxRecords) {
      const deleteOldestStmt = this.db.prepare(`
        DELETE FROM messages
        WHERE id IN (
          SELECT id FROM messages
          ORDER BY timestamp ASC
          LIMIT ?
        )
      `);
      const oldestDeleted = deleteOldestStmt.run(currentCount - this.maxRecords).changes;

      this.logger.info('Cleanup completed', {
        expiredDeleted,
        oldestDeleted,
        remaining: this.maxRecords
      });
    } else if (expiredDeleted > 0) {
      this.logger.info('Cleanup completed', {
        expiredDeleted,
        remaining: currentCount
      });
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { count: number; oldestTimestamp?: number; newestTimestamp?: number } {
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
    const countResult = countStmt.get() as { count: number };

    const rangeStmt = this.db.prepare(`
      SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest
      FROM messages
    `);
    const rangeResult = rangeStmt.get() as { oldest: number | null; newest: number | null };

    return {
      count: countResult.count,
      oldestTimestamp: rangeResult.oldest ?? undefined,
      newestTimestamp: rangeResult.newest ?? undefined
    };
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close();
    this.logger.info('Database closed');
  }
}

/**
 * 创建 MessageRecord 的便捷函数
 * @param id 消息 ID
 * @param from 发送者
 * @param to 接收者
 * @param type 消息类型
 * @param timestamp 时间戳
 * @param summary 消息摘要
 * @param payload JSON payload
 */
export function createMessageRecord(
  id: string,
  from: string,
  to: string,
  type: string,
  timestamp: number,
  summary?: string,
  payload?: unknown,
  options?: {
    conversationId?: string;
    replyToMessageId?: string;
    direction?: 'inbound' | 'outbound' | 'local';
    agentId?: string;
    peerAgentId?: string;
    metadata?: unknown;
    createdAt?: number;
  }
): MessageRecord {
  return {
    id,
    from,
    to,
    type,
    timestamp,
    summary,
    payload: payload ? JSON.stringify(payload) : undefined,
    conversationId: options?.conversationId,
    replyToMessageId: options?.replyToMessageId,
    direction: options?.direction,
    agentId: options?.agentId,
    peerAgentId: options?.peerAgentId,
    metadata: options?.metadata ? JSON.stringify(options.metadata) : undefined,
    createdAt: options?.createdAt
  };
}
