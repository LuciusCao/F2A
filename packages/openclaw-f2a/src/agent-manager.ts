/**
 * Agent Manager
 * 
 * 管理 Agent 身份和生命周期。
 * Phase 1: 引入 AgentID，独立于 Node 的 PeerID。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { AgentIdentity, AgentConfig } from './types.js';
import { pluginLogger as logger } from './logger.js';

/** Agent 数据文件名 */
const AGENT_DATA_FILE = 'agent.json';

/**
 * Agent Manager
 * 
 * 职责：
 * - 生成或加载 Agent 身份
 * - 持久化 Agent 数据
 * - 提供 Agent 相关 API
 */
export class AgentManager {
  private dataDir: string;
  private identity: AgentIdentity | null = null;
  private config: AgentConfig;

  constructor(dataDir: string, config: AgentConfig = {}) {
    this.dataDir = dataDir;
    this.config = config;
    
    // 同步初始化（避免插件异步注册问题）
    this.initializeSync();
  }

  /**
   * 同步初始化 Agent 身份
   * - 如果已存在则加载
   * - 如果不存在则创建
   */
  private initializeSync(): void {
    // 尝试加载已有身份
    const existing = this.loadIdentity();
    if (existing) {
      this.identity = existing;
      logger.info('[F2A:Agent] 已加载 Agent 身份: %s', existing.agentId);
      return;
    }

    // 创建新身份
    this.identity = this.createIdentity();
    this.saveIdentity(this.identity);
    logger.info('[F2A:Agent] 已创建新 Agent 身份: %s', this.identity.agentId);
  }

  /**
   * 异步初始化（兼容旧 API）
   * @deprecated 使用构造函数自动初始化
   */
  async initialize(): Promise<AgentIdentity> {
    if (!this.identity) {
      this.initializeSync();
    }
    return this.identity!;
  }

  /**
   * 获取当前 Agent 身份
   */
  getIdentity(): AgentIdentity | null {
    return this.identity;
  }

  /**
   * 获取 AgentID
   */
  getAgentId(): string | null {
    return this.identity?.agentId || null;
  }

  /**
   * 获取 Agent 名称
   */
  getAgentName(): string {
    return this.identity?.name || 'Unknown Agent';
  }

  /**
   * 创建新 Agent 身份
   */
  private createIdentity(): AgentIdentity {
    const agentId = this.config.id || this.generateAgentId();
    const name = this.config.name || this.generateDefaultName();

    return {
      agentId,
      name,
      createdAt: Date.now()
    };
  }

  /**
   * 生成 AgentID
   * 格式: agent-{timestamp}-{random}
   */
  private generateAgentId(): string {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(6).toString('hex');
    return `agent-${timestamp}-${random}`;
  }

  /**
   * 生成默认 Agent 名称
   */
  private generateDefaultName(): string {
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
    const randomName = names[Math.floor(Math.random() * names.length)];
    return `Agent-${randomName}`;
  }

  /**
   * 加载已存在的 Agent 身份
   */
  private loadIdentity(): AgentIdentity | null {
    const filePath = join(this.dataDir, AGENT_DATA_FILE);
    
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const data = readFileSync(filePath, 'utf-8');
      const identity = JSON.parse(data) as AgentIdentity;
      
      // 验证必要字段
      if (!identity.agentId || !identity.name || !identity.createdAt) {
        logger.warn('[F2A:Agent] 身份文件格式无效，将创建新身份');
        return null;
      }

      return identity;
    } catch (error) {
      logger.warn('[F2A:Agent] 加载身份文件失败: %s', error);
      return null;
    }
  }

  /**
   * 保存 Agent 身份到文件
   */
  private saveIdentity(identity: AgentIdentity): void {
    // 确保目录存在
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    const filePath = join(this.dataDir, AGENT_DATA_FILE);
    const data = JSON.stringify(identity, null, 2);
    
    writeFileSync(filePath, data, { mode: 0o600 }); // 仅所有者可读写
    logger.debug?.('[F2A:Agent] 身份已保存到: %s', filePath);
  }

  /**
   * 导出 Agent 身份（用于迁移）
   */
  exportIdentity(): string {
    if (!this.identity) {
      throw new Error('No agent identity loaded');
    }
    return JSON.stringify(this.identity);
  }

  /**
   * 导入 Agent 身份（用于迁移）
   */
  importIdentity(data: string): AgentIdentity {
    // P1-3 修复：输入验证
    // 1. 长度限制：防止过大的输入导致内存问题
    const MAX_IDENTITY_SIZE = 4096; // 4KB 足够存储 AgentIdentity
    if (data.length > MAX_IDENTITY_SIZE) {
      throw new Error(`Identity data too large: ${data.length} bytes (max: ${MAX_IDENTITY_SIZE})`);
    }

    // 2. 基础格式校验：确保是有效的 JSON
    let identity: AgentIdentity;
    try {
      identity = JSON.parse(data) as AgentIdentity;
    } catch (parseError) {
      throw new Error('Invalid JSON format for identity data');
    }

    // 3. 类型验证：确保解析结果是一个对象
    if (typeof identity !== 'object' || identity === null || Array.isArray(identity)) {
      throw new Error('Identity data must be a JSON object');
    }
    
    // 4. 验证必要字段
    if (!identity.agentId || !identity.name || !identity.createdAt) {
      throw new Error('Invalid agent identity data: missing required fields (agentId, name, createdAt)');
    }

    // 5. 字段格式验证
    if (typeof identity.agentId !== 'string' || identity.agentId.length === 0) {
      throw new Error('Invalid agentId: must be a non-empty string');
    }
    if (typeof identity.name !== 'string' || identity.name.length === 0) {
      throw new Error('Invalid name: must be a non-empty string');
    }
    if (typeof identity.createdAt !== 'number' || identity.createdAt <= 0) {
      throw new Error('Invalid createdAt: must be a positive number');
    }

    this.identity = identity;
    this.saveIdentity(identity);
    logger.info('[F2A:Agent] 已导入 Agent 身份: %s', identity.agentId);
    return identity;
  }

  /**
   * 重置 Agent 身份（创建新的）
   */
  resetIdentity(): AgentIdentity {
    this.identity = this.createIdentity();
    this.saveIdentity(this.identity);
    logger.info('[F2A:Agent] 已重置 Agent 身份: %s', this.identity.agentId);
    return this.identity;
  }
}