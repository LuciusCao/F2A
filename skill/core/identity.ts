/**
 * 身份管理器
 * 负责生成、加载和保存 Agent 身份
 */

import { randomUUID } from 'crypto';
import { generateKeyPairSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AgentIdentity, IdentityInfo, Result } from '../types';

export interface IdentityManagerOptions {
  configDir?: string;
}

export class IdentityManager {
  private configDir: string;
  private identityFile: string;

  constructor(options: IdentityManagerOptions = {}) {
    this.configDir = options.configDir ?? join(homedir(), '.f2a');
    this.identityFile = join(this.configDir, 'identity.json');
    this.ensureConfigDir();
  }

  /**
   * 获取或创建身份
   */
  getOrCreateIdentity(displayName?: string): IdentityInfo {
    const existing = this.loadIdentity();
    if (existing) {
      return { ...existing, isNew: false };
    }

    return this.createIdentity(displayName);
  }

  /**
   * 创建新身份
   */
  createIdentity(displayName?: string): IdentityInfo {
    const keyPair = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const agentId = this.generateAgentId(keyPair.publicKey);

    const identity: AgentIdentity = {
      agentId,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      displayName
    };

    this.saveIdentity(identity);

    return {
      ...identity,
      isNew: true,
      createdAt: Date.now()
    };
  }

  /**
   * 加载已有身份
   */
  loadIdentity(): AgentIdentity | null {
    try {
      if (!existsSync(this.identityFile)) {
        return null;
      }

      const data = readFileSync(this.identityFile, 'utf-8');
      const identity = JSON.parse(data) as AgentIdentity;

      // 验证必要字段
      if (!identity.agentId || !identity.publicKey || !identity.privateKey) {
        console.error('[IdentityManager] 身份文件格式错误');
        return null;
      }

      return identity;
    } catch (error) {
      console.error('[IdentityManager] 加载身份失败:', error);
      return null;
    }
  }

  /**
   * 保存身份
   */
  saveIdentity(identity: AgentIdentity): Result<void> {
    try {
      const data = JSON.stringify(identity, null, 2);
      writeFileSync(this.identityFile, data, { mode: 0o600 }); // 只有所有者可读写
      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `保存身份失败: ${message}` };
    }
  }

  /**
   * 获取身份文件路径
   */
  getConfigPath(): string {
    return this.identityFile;
  }

  /**
   * 获取身份信息（只读）
   */
  getIdentityInfo(): Pick<AgentIdentity, 'agentId' | 'displayName'> | null {
    const identity = this.loadIdentity();
    if (!identity) return null;

    return {
      agentId: identity.agentId,
      displayName: identity.displayName
    };
  }

  /**
   * 生成 Agent ID
   * 基于公钥派生
   */
  private generateAgentId(publicKey: string): string {
    // 使用公钥的前 16 位作为基础
    const base = publicKey
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '')
      .slice(0, 16);

    // 格式: f2a-xxxx-xxxx
    return `f2a-${base.slice(0, 4)}-${base.slice(4, 8)}-${base.slice(8, 12)}`;
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }
  }
}