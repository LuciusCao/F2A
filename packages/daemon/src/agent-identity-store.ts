/**
 * Agent Identity Store
 * 管理 Agent Identity 文件的持久化（RFC 004 Phase 6）
 * 
 * 功能：
 * - 启动时加载所有 Agent Identity 文件
 * - 保存新 Agent Identity
 * - 更新 Agent Identity（如 webhook）
 * - 删除 Agent Identity
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Logger } from '@f2a/network';
import type { AgentCapability } from '@f2a/network';

/**
 * Agent Webhook 配置（从 agent-registry.ts 重用）
 */
export interface AgentWebhook {
  /** Webhook URL */
  url: string;
  /** 认证 Token（可选） */
  token?: string;
}

/**
 * Agent Identity 文件结构
 * 存储在 ~/.f2a/agents/<agentId>.json
 */
export interface AgentIdentity {
  /** Agent 唯一标识符 格式: agent:<PeerId前16位>:<随机8位> */
  agentId: string;
  /** Agent 显示名称 */
  name: string;
  /** 签发节点的 PeerId */
  peerId: string;
  /** AgentId 签名（Base64） */
  signature: string;
  /** E2EE 公钥（用于 Challenge-Response 验证，可选） */
  e2eePublicKey?: string;
  /** Webhook 配置 */
  webhook?: AgentWebhook;
  /** Agent 支持的能力列表 */
  capabilities: AgentCapability[];
  /** Agent 元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 最后活跃时间（ISO 8601） */
  lastActiveAt: string;
}

/**
 * Agent Identity 存储
 * 负责 Agent Identity 文件的读写和验证
 */
export class AgentIdentityStore {
  private agentsDir: string;
  private identities: Map<string, AgentIdentity> = new Map();
  private logger: Logger;
  /** 用于验证签名的函数（可选） */
  private verifySignatureFn?: (data: string, signature: string, peerId: string) => boolean;

  constructor(
    dataDir: string,
    verifySignatureFn?: (data: string, signature: string, peerId: string) => boolean
  ) {
    this.agentsDir = join(dataDir, 'agents');
    this.logger = new Logger({ component: 'AgentIdentityStore' });
    this.verifySignatureFn = verifySignatureFn;
  }

  /**
   * 初始化：确保目录存在
   */
  private ensureDir(): void {
    if (!existsSync(this.agentsDir)) {
      mkdirSync(this.agentsDir, { recursive: true });
      this.logger.info('Created agents directory', { path: this.agentsDir });
    }
  }

  /**
   * 启动时加载所有 Agent Identity 文件
   */
  loadAll(): void {
    this.ensureDir();
    
    const files = readdirSync(this.agentsDir)
      .filter(f => f.endsWith('.json') && f.startsWith('agent:'));
    
    this.identities.clear();
    
    for (const file of files) {
      try {
        const filePath = join(this.agentsDir, file);
        const content = readFileSync(filePath, 'utf-8');
        
        // 安全 JSON.parse：过滤危险 key
        const identity = JSON.parse(content, (key, value) => {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
          }
          return value;
        }) as AgentIdentity;
        
        // 验证基本结构
        if (!this.validateIdentityStructure(identity)) {
          this.logger.warn('Agent identity invalid structure, skipping', { file });
          continue;
        }
        
        // 验证签名（如果有验证函数）
        if (this.verifySignatureFn && !this.verifySignatureFn(identity.agentId, identity.signature, identity.peerId)) {
          this.logger.warn('Agent identity signature invalid, skipping', { file, agentId: identity.agentId });
          continue;
        }
        
        this.identities.set(identity.agentId, identity);
        this.logger.info('Agent identity loaded', { agentId: identity.agentId, name: identity.name });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('Failed to load agent identity', { file, error: msg });
      }
    }
    
    this.logger.info('Agent identities loaded', { count: this.identities.size });
  }

  /**
   * 验证 Identity 结构完整性
   */
  private validateIdentityStructure(identity: unknown): boolean {
    if (!identity || typeof identity !== 'object') return false;
    
    const obj = identity as Record<string, unknown>;
    
    // 必须字段
    const requiredFields = ['agentId', 'name', 'peerId', 'signature', 'createdAt', 'lastActiveAt'];
    for (const field of requiredFields) {
      if (!obj[field]) return false;
    }
    
    // agentId 格式验证
    if (typeof obj.agentId !== 'string' || !obj.agentId.startsWith('agent:')) {
      return false;
    }
    
    return true;
  }

  /**
   * 保存 Agent Identity 文件
   */
  save(identity: AgentIdentity): void {
    this.ensureDir();
    
    // 验证结构
    if (!this.validateIdentityStructure(identity)) {
      throw new Error('Invalid AgentIdentity structure');
    }
    
    const filePath = join(this.agentsDir, `${identity.agentId}.json`);
    
    // 更新内存中的 identity
    this.identities.set(identity.agentId, identity);
    
    // 写入文件
    writeFileSync(filePath, JSON.stringify(identity, null, 2), 'utf-8');
    
    this.logger.info('Agent identity saved', { agentId: identity.agentId, path: filePath });
  }

  /**
   * 获取 Agent Identity
   */
  get(agentId: string): AgentIdentity | undefined {
    return this.identities.get(agentId);
  }

  /**
   * 列出所有 Agent Identity
   */
  list(): AgentIdentity[] {
    return Array.from(this.identities.values());
  }

  /**
   * 更新 Agent Webhook
   */
  updateWebhook(agentId: string, webhook: AgentWebhook | undefined): AgentIdentity {
    const identity = this.identities.get(agentId);
    if (!identity) {
      throw new Error('Agent identity not found');
    }
    
    identity.webhook = webhook;
    identity.lastActiveAt = new Date().toISOString();
    
    // 保存更新
    this.save(identity);
    
    this.logger.info('Agent webhook updated', { 
      agentId, 
      webhookUrl: webhook?.url || 'removed',
      hasToken: !!webhook?.token
    });
    
    return identity;
  }

  /**
   * 更新最后活跃时间
   */
  updateLastActive(agentId: string): AgentIdentity {
    const identity = this.identities.get(agentId);
    if (!identity) {
      throw new Error('Agent identity not found');
    }
    
    identity.lastActiveAt = new Date().toISOString();
    this.save(identity);
    
    return identity;
  }

  /**
   * 删除 Agent Identity
   */
  delete(agentId: string): boolean {
    const identity = this.identities.get(agentId);
    if (!identity) {
      this.logger.warn('Agent identity not found for deletion', { agentId });
      return false;
    }
    
    // 从内存删除
    this.identities.delete(agentId);
    
    // 删除文件
    const filePath = join(this.agentsDir, `${agentId}.json`);
    if (existsSync(filePath)) {
      rmSync(filePath);
      this.logger.info('Agent identity file deleted', { agentId, path: filePath });
    }
    
    return true;
  }

  /**
   * 检查 Agent Identity 是否存在
   */
  has(agentId: string): boolean {
    return this.identities.has(agentId);
  }

  /**
   * 获取 Identity 数量
   */
  size(): number {
    return this.identities.size;
  }

  /**
   * 按条件查找 Identity
   */
  findBy(predicate: (identity: AgentIdentity) => boolean): AgentIdentity[] {
    return this.list().filter(predicate);
  }

  /**
   * 按 PeerId 查找 Identity（同一节点的所有 Agent）
   */
  findByPeerId(peerId: string): AgentIdentity[] {
    return this.findBy(identity => identity.peerId === peerId);
  }

  /**
   * 按能力查找 Identity
   */
  findByCapability(capabilityName: string): AgentIdentity[] {
    return this.findBy(identity => 
      identity.capabilities.some(cap => cap.name === capabilityName)
    );
  }

  /**
   * 清理所有 Identity（用于测试）
   */
  clear(): void {
    this.identities.clear();
    if (existsSync(this.agentsDir)) {
      const files = readdirSync(this.agentsDir)
        .filter(f => f.endsWith('.json') && f.startsWith('agent:'));
      for (const file of files) {
        rmSync(join(this.agentsDir, file));
      }
    }
  }

  /**
   * 导出 Identity（用于备份）
   */
  export(agentId: string): string {
    const identity = this.get(agentId);
    if (!identity) {
      throw new Error('Agent identity not found');
    }
    return JSON.stringify(identity, null, 2);
  }

  /**
   * 导入 Identity（用于恢复）
   */
  import(jsonContent: string): AgentIdentity {
    const identity = JSON.parse(jsonContent) as AgentIdentity;
    
    if (!this.validateIdentityStructure(identity)) {
      throw new Error('Invalid AgentIdentity structure in import');
    }
    
    this.save(identity);
    return identity;
  }
}