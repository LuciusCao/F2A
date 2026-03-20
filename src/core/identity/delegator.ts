/**
 * Identity Delegator
 * 
 * 负责创建和管理 Agent 身份：
 * - 创建新的 Agent 身份
 * - 使用 Node 私钥对 Agent 进行签名
 * - 验证其他 Node 的 Agent 签名
 * - 支持 Agent 迁移（重新签名）
 */

import { Ed25519PrivateKey } from '@libp2p/crypto/keys';
import { unmarshalPrivateKey } from '@libp2p/crypto/keys';
import { Logger } from '../../utils/logger.js';
import { success, failure, failureFromError, Result } from '../../types/index.js';
import { secureWipe } from '../../utils/crypto-utils.js';
import { NodeIdentityManager } from './node-identity.js';
import { AgentIdentityManager } from './agent-identity.js';
import type {
  AgentIdentity,
  DelegationResult,
  MigrationResult,
  AgentIdentityOptions,
  AgentSignaturePayload
} from './types.js';

/**
 * Identity Delegator
 * 
 * 身份委派管理器，负责：
 * - 创建和签名 Agent 身份
 * - 验证 Agent 签名
 * - Agent 迁移
 */
export class IdentityDelegator {
  private nodeIdentity: NodeIdentityManager;
  private logger: Logger;

  constructor(nodeIdentity: NodeIdentityManager) {
    this.nodeIdentity = nodeIdentity;
    this.logger = new Logger({ component: 'IdentityDelegator' });
  }

  /**
   * 创建新的 Agent Identity
   * 
   * @param options Agent 配置选项
   * @returns DelegationResult 包含 Agent Identity 和私钥
   */
  async createAgent(options: AgentIdentityOptions): Promise<Result<DelegationResult>> {
    try {
      // 确保 Node Identity 已加载
      if (!this.nodeIdentity.isNodeLoaded()) {
        const loadResult = await this.nodeIdentity.loadOrCreate();
        if (!loadResult.success) {
          return failure(loadResult.error);
        }
      }

      const nodeId = this.nodeIdentity.getNodeId();
      if (!nodeId) {
        return failure({
          code: 'NODE_IDENTITY_NOT_LOADED',
          message: 'Node identity is not loaded.'
        });
      }

      // 获取 Node 私钥用于签名
      const privateKey = this.nodeIdentity.getPrivateKey();
      if (!privateKey) {
        return failure({
          code: 'NODE_PRIVATE_KEY_NOT_AVAILABLE',
          message: 'Node private key is not available.'
        });
      }

      // 创建签名函数
      const signWithNodeKey = async (data: Uint8Array): Promise<Uint8Array> => {
        // 使用 Ed25519 私钥签名
        const signature = await privateKey.sign(data);
        return signature;
      };

      // 创建 Agent Identity Manager
      const agentManager = new AgentIdentityManager();

      // 创建 Agent Identity
      const result = await agentManager.createAgentIdentity(
        nodeId,
        signWithNodeKey,
        options
      );

      if (!result.success) {
        return failure(result.error);
      }

      const exportedAgent = result.data;

      this.logger.info('Created and signed agent identity', {
        agentId: exportedAgent.id,
        agentName: exportedAgent.name,
        nodeId
      });

      return success({
        agentIdentity: {
          id: exportedAgent.id,
          name: exportedAgent.name,
          capabilities: exportedAgent.capabilities,
          nodeId: exportedAgent.nodeId,
          publicKey: exportedAgent.publicKey,
          signature: exportedAgent.signature,
          createdAt: exportedAgent.createdAt,
          expiresAt: exportedAgent.expiresAt
        },
        agentPrivateKey: exportedAgent.privateKey
      });
    } catch (error) {
      return failureFromError('AGENT_CREATE_FAILED', 'Failed to create agent identity', error as Error);
    }
  }

  /**
   * 验证 Agent Identity 的签名
   * 
   * @param agentIdentity 要验证的 Agent Identity
   * @param getNodePublicKey 获取 Node 公钥的函数
   */
  async verifyAgent(
    agentIdentity: AgentIdentity,
    getNodePublicKey: (nodeId: string) => Promise<Uint8Array | null>
  ): Promise<Result<boolean>> {
    try {
      // 检查是否过期
      if (agentIdentity.expiresAt) {
        const expiresAt = new Date(agentIdentity.expiresAt);
        if (expiresAt < new Date()) {
          this.logger.warn('Agent identity has expired', {
            agentId: agentIdentity.id,
            expiresAt: agentIdentity.expiresAt
          });
          return success(false);
        }
      }

      // 获取 Node 公钥
      const nodePublicKey = await getNodePublicKey(agentIdentity.nodeId);
      if (!nodePublicKey) {
        this.logger.warn('Node public key not found', {
          nodeId: agentIdentity.nodeId
        });
        return success(false);
      }

      // 重建签名载荷
      const payload = AgentIdentityManager.createSignaturePayload(
        agentIdentity.id,
        agentIdentity.name,
        agentIdentity.capabilities,
        agentIdentity.nodeId,
        agentIdentity.publicKey,
        agentIdentity.createdAt,
        agentIdentity.expiresAt
      );

      const payloadBytes = Buffer.from(
        AgentIdentityManager.serializePayloadForSignature(payload),
        'utf-8'
      );

      const signatureBytes = Buffer.from(agentIdentity.signature, 'base64');

      // 使用 Node 公钥验证签名
      const isValid = await this.verifySignature(
        nodePublicKey,
        payloadBytes,
        signatureBytes
      );

      return success(isValid);
    } catch (error) {
      // P3-3 修复: 记录错误详情后再返回
      this.logger.error('Failed to verify agent signature', {
        agentId: agentIdentity.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return success(false);
    }
  }

  /**
   * 验证签名（内部方法）
   */
  private async verifySignature(
    publicKey: Uint8Array,
    data: Uint8Array,
    signature: Uint8Array
  ): Promise<boolean> {
    try {
      // 从公钥创建 Ed25519 验证器
      // 使用 noble/curves 进行签名验证
      const { ed25519 } = await import('@noble/curves/ed25519.js');
      
      this.logger.debug('Verifying signature', {
        publicKeyLength: publicKey.length,
        dataLength: data.length,
        signatureLength: signature.length
      });
      
      // 验证签名
      return ed25519.verify(signature, data, publicKey);
    } catch (error) {
      this.logger.error('Signature verification failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * 迁移 Agent 到新的 Node
   * 
   * P1-2 修复: 添加授权验证 - 要求调用者证明拥有 Agent 私钥
   * 
   * @param agentIdentity 要迁移的 Agent Identity
   * @param agentPrivateKey Agent 的私钥 (base64)
   * @param proofOfOwnership 所有权证明 - 用 Agent 私钥签名的 challenge
   * @param challenge 用于验证所有权的 challenge 字符串
   * @param newNodeId 新的 Node ID
   * @param signWithNewNodeKey 使用新 Node 私钥签名的函数
   */
  async migrateAgent(
    agentIdentity: AgentIdentity,
    agentPrivateKey: string,
    proofOfOwnership: Uint8Array,
    challenge: string,
    newNodeId: string,
    signWithNewNodeKey: (data: Uint8Array) => Promise<Uint8Array>
  ): Promise<Result<MigrationResult>> {
    try {
      // P1-2: 验证所有权 - 使用 Agent 公钥验证签名
      const { ed25519 } = await import('@noble/curves/ed25519.js');
      
      const publicKeyBytes = Buffer.from(agentIdentity.publicKey, 'base64');
      const challengeBytes = Buffer.from(challenge, 'utf-8');
      
      const isValidOwnership = ed25519.verify(proofOfOwnership, challengeBytes, publicKeyBytes);
      if (!isValidOwnership) {
        this.logger.warn('Agent migration rejected: invalid ownership proof', {
          agentId: agentIdentity.id
        });
        return failure({
          code: 'AGENT_MIGRATION_UNAUTHORIZED',
          message: 'Invalid ownership proof. The caller must prove possession of the agent private key.'
        });
      }
      
      // 更新 Node ID
      const updatedPayload = AgentIdentityManager.createSignaturePayload(
        agentIdentity.id,
        agentIdentity.name,
        agentIdentity.capabilities,
        newNodeId, // 新的 Node ID
        agentIdentity.publicKey,
        agentIdentity.createdAt,
        agentIdentity.expiresAt
      );

      // 使用新 Node 签名
      const payloadBytes = Buffer.from(
        AgentIdentityManager.serializePayloadForSignature(updatedPayload),
        'utf-8'
      );
      const newSignature = await signWithNewNodeKey(payloadBytes);
      const newSignatureBase64 = Buffer.from(newSignature).toString('base64');

      const newAgentIdentity: AgentIdentity = {
        ...agentIdentity,
        nodeId: newNodeId,
        signature: newSignatureBase64
      };

      this.logger.info('Migrated agent to new node', {
        agentId: agentIdentity.id,
        oldNodeId: agentIdentity.nodeId,
        newNodeId
      });

      return success({
        agentIdentity: newAgentIdentity,
        signature: newSignatureBase64
      });
    } catch (error) {
      return failureFromError('AGENT_MIGRATION_FAILED', 'Failed to migrate agent identity', error as Error);
    }
  }

  /**
   * 撤销 Agent（删除其身份）
   * 
   * @param agentManager Agent Identity Manager
   */
  async revokeAgent(agentManager: AgentIdentityManager): Promise<Result<void>> {
    try {
      const result = await agentManager.deleteAgentIdentity();
      
      if (!result.success) {
        return failure(result.error);
      }

      this.logger.info('Revoked agent identity');
      return success(undefined);
    } catch (error) {
      return failureFromError('AGENT_REVOKE_FAILED', 'Failed to revoke agent identity', error as Error);
    }
  }

  /**
   * 批量验证 Agent 签名
   * 
   * @param agents 要验证的 Agent 列表
   * @param getNodePublicKey 获取 Node 公钥的函数
   */
  async batchVerify(
    agents: AgentIdentity[],
    getNodePublicKey: (nodeId: string) => Promise<Uint8Array | null>
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    // 并行验证
    const verifyPromises = agents.map(async (agent) => {
      const result = await this.verifyAgent(agent, getNodePublicKey);
      return { id: agent.id, valid: result.success ? result.data : false };
    });

    const verifyResults = await Promise.all(verifyPromises);

    for (const { id, valid } of verifyResults) {
      results.set(id, valid);
    }

    return results;
  }

  /**
   * 检查 Agent 是否即将过期
   * 
   * @param agentIdentity Agent Identity
   * @param thresholdDays 阈值天数
   */
  isAgentExpiringSoon(
    agentIdentity: AgentIdentity,
    thresholdDays: number = 7
  ): boolean {
    if (!agentIdentity.expiresAt) {
      return false; // 没有过期时间，永不过期
    }

    const expiresAt = new Date(agentIdentity.expiresAt);
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + thresholdDays);

    return expiresAt < threshold;
  }

  /**
   * 续期 Agent
   * 
   * P1-3 修复: 添加 nodeId 匹配检查，验证请求来自当前所属 Node
   * 
   * @param agentIdentity 要续期的 Agent Identity
   * @param newExpiresAt 新的过期时间
   * @param signWithNodeKey 使用 Node 私钥签名的函数
   */
  async renewAgent(
    agentIdentity: AgentIdentity,
    newExpiresAt: Date,
    signWithNodeKey: (data: Uint8Array) => Promise<Uint8Array>
  ): Promise<Result<AgentIdentity>> {
    try {
      // P1-3: 验证请求来自当前所属 Node
      const currentNodeId = this.nodeIdentity.getNodeId();
      if (!currentNodeId) {
        return failure({
          code: 'NODE_IDENTITY_NOT_LOADED',
          message: 'Node identity is not loaded.'
        });
      }
      
      if (agentIdentity.nodeId !== currentNodeId) {
        this.logger.warn('Agent renewal rejected: nodeId mismatch', {
          agentId: agentIdentity.id,
          agentNodeId: agentIdentity.nodeId,
          currentNodeId
        });
        return failure({
          code: 'AGENT_RENEW_UNAUTHORIZED',
          message: 'Agent renewal can only be performed by the current owning Node.'
        });
      }
      
      // 创建新的签名载荷（更新过期时间）
      const newPayload = AgentIdentityManager.createSignaturePayload(
        agentIdentity.id,
        agentIdentity.name,
        agentIdentity.capabilities,
        agentIdentity.nodeId,
        agentIdentity.publicKey,
        agentIdentity.createdAt,
        newExpiresAt.toISOString()
      );

      // 重新签名
      const payloadBytes = Buffer.from(
        AgentIdentityManager.serializePayloadForSignature(newPayload),
        'utf-8'
      );
      const newSignature = await signWithNodeKey(payloadBytes);

      const renewedAgent: AgentIdentity = {
        ...agentIdentity,
        expiresAt: newExpiresAt.toISOString(),
        signature: Buffer.from(newSignature).toString('base64')
      };

      this.logger.info('Renewed agent identity', {
        agentId: agentIdentity.id,
        newExpiresAt: newExpiresAt.toISOString()
      });

      return success(renewedAgent);
    } catch (error) {
      return failureFromError('AGENT_RENEW_FAILED', 'Failed to renew agent identity', error as Error);
    }
  }
}