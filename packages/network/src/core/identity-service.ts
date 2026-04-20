/**
 * IdentityService - 身份服务
 *
 * 提供身份相关的操作，包括导出 Node/Agent 身份、续期等
 *
 * Phase 2a: 从 F2A 类中提取身份相关方法
 */

import { NodeIdentityManager } from './identity/node-identity.js';
import { AgentIdentityManager } from './identity/agent-identity.js';
import { IdentityDelegator } from './identity/delegator.js';
import { Ed25519Signer } from './identity/ed25519-signer.js';
import { Logger } from '../utils/logger.js';
import { Result, success, failureFromError } from '../types/index.js';
import type { ExportedAgentIdentity, AgentIdentity } from './identity/types.js';

/**
 * IdentityService 配置选项
 */
export interface IdentityServiceOptions {
  nodeIdentityManager?: NodeIdentityManager;
  agentIdentityManager?: AgentIdentityManager;
  identityDelegator?: IdentityDelegator;
  ed25519Signer?: Ed25519Signer;
  logger: Logger;
}

/**
 * IdentityService - 身份服务
 *
 * 管理身份相关操作，包括导出、续期等
 */
export class IdentityService {
  private nodeIdentityManager?: NodeIdentityManager;
  private agentIdentityManager?: AgentIdentityManager;
  private identityDelegator?: IdentityDelegator;
  private ed25519Signer?: Ed25519Signer;

  constructor(options: IdentityServiceOptions) {
    this.nodeIdentityManager = options.nodeIdentityManager;
    this.agentIdentityManager = options.agentIdentityManager;
    this.identityDelegator = options.identityDelegator;
    this.ed25519Signer = options.ed25519Signer;
  }

  /**
   * 设置 NodeIdentityManager
   */
  setNodeIdentityManager(manager: NodeIdentityManager): void {
    this.nodeIdentityManager = manager;
  }

  /**
   * 设置 AgentIdentityManager
   */
  setAgentIdentityManager(manager: AgentIdentityManager): void {
    this.agentIdentityManager = manager;
  }

  /**
   * 设置 IdentityDelegator
   */
  setIdentityDelegator(delegator: IdentityDelegator): void {
    this.identityDelegator = delegator;
  }

  /**
   * 设置 Ed25519Signer
   */
  setEd25519Signer(signer: Ed25519Signer): void {
    this.ed25519Signer = signer;
  }

  /**
   * 导出 Node Identity(用于备份/迁移)
   *
   * WARNING: 返回敏感的私钥材料
   */
  async exportNodeIdentity(): Promise<Result<{
    nodeId: string;
    peerId: string;
    privateKey: string;
  }>> {
    if (!this.nodeIdentityManager) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Node identity manager not initialized');
    }

    try {
      const identity = this.nodeIdentityManager.exportIdentity();
      return success({
        nodeId: this.nodeIdentityManager.getNodeId() || '',
        peerId: identity.peerId,
        privateKey: identity.privateKey
      });
    } catch (error) {
      return failureFromError('EXPORT_FAILED', 'Failed to export node identity', error as Error);
    }
  }

  /**
   * 导出 Agent Identity(用于备份/迁移)
   *
   * WARNING: 返回敏感的私钥材料
   */
  async exportAgentIdentity(): Promise<Result<ExportedAgentIdentity>> {
    if (!this.agentIdentityManager) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Agent identity manager not initialized');
    }

    try {
      const identity = this.agentIdentityManager.exportAgentIdentity();
      if (!identity) {
        return failureFromError('IDENTITY_NOT_FOUND', 'No agent identity found');
      }
      return success(identity);
    } catch (error) {
      return failureFromError('EXPORT_FAILED', 'Failed to export agent identity', error as Error);
    }
  }

  /**
   * 续期 Agent 身份
   *
   * @param newExpiresAt 新的过期时间
   */
  async renewAgentIdentity(newExpiresAt: Date): Promise<Result<AgentIdentity>> {
    if (!this.identityDelegator || !this.agentIdentityManager) {
      return failureFromError('IDENTITY_NOT_INITIALIZED', 'Identity system not initialized');
    }

    const currentIdentity = this.agentIdentityManager.getAgentIdentity();
    if (!currentIdentity) {
      return failureFromError('IDENTITY_NOT_FOUND', 'No current agent identity found');
    }

    const privateKey = this.nodeIdentityManager?.getPrivateKey();
    if (!privateKey) {
      return failureFromError('NODE_KEY_NOT_AVAILABLE', 'Node private key not available');
    }

    const signWithNodeKey = async (data: Uint8Array): Promise<Uint8Array> => {
      return await privateKey.sign(data);
    };

    return this.identityDelegator.renewAgent(currentIdentity, newExpiresAt, signWithNodeKey);
  }

  /**
   * 获取 Ed25519Signer
   */
  getEd25519Signer(): Ed25519Signer | undefined {
    return this.ed25519Signer;
  }

  /**
   * 获取 NodeIdentityManager
   */
  getNodeIdentityManager(): NodeIdentityManager | undefined {
    return this.nodeIdentityManager;
  }

  /**
   * 获取 AgentIdentityManager
   */
  getAgentIdentityManager(): AgentIdentityManager | undefined {
    return this.agentIdentityManager;
  }

  /**
   * 获取 IdentityDelegator
   */
  getIdentityDelegator(): IdentityDelegator | undefined {
    return this.identityDelegator;
  }
}