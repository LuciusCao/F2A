/**
 * AgentIdentityVerifier - RFC 003 跨节点签名验证
 *
 * 实现其他节点验证 AgentId 签名的机制，防止冒充攻击
 *
 * RFC 003 签名升级：使用 Ed25519 非对称签名
 *
 * 验证流程（Ed25519）：
 * 1. 解析 AgentId → 提取 PeerId 前缀
 * 2. 验证 PeerId 前缀匹配
 * 3. 用 Ed25519 公钥验证签名（无需共享密钥）
 * 4. 验证通过 → 接受消息
 * 5. 验证失败 → 拒绝通信
 *
 * 向后兼容：支持旧的 E2EE 公钥验证
 */

import { Logger } from '../../utils/logger.js';
import { Ed25519Signer } from './ed25519-signer.js';
import type { E2EECrypto } from '../e2ee-crypto.js';
import type { PeerInfo } from '../../types/index.js';

/**
 * AgentId 验证结果
 */
export interface AgentIdVerificationResult {
  /** 验证是否成功 */
  valid: boolean;
  /** 错误原因（如果失败） */
  error?: string;
  /** 解析出的 PeerId 前缀 */
  peerIdPrefix?: string;
  /** 找到的完整 PeerId */
  matchedPeerId?: string;
}

/**
 * 签名验证选项
 */
export interface VerificationOptions {
  /** 是否严格验证 PeerId 匹配（默认 true） */
  strictPeerIdMatch?: boolean;
  /** 是否允许未知的 Peer（默认 false，安全考虑） */
  allowUnknownPeers?: boolean;
  /** 验证超时（毫秒，默认 5000） */
  timeoutMs?: number;
}

/**
 * AgentIdentityVerifier - AgentId 签名验证器
 *
 * 用于验证来自其他节点的 AgentId 签名，防止冒充攻击
 */
export class AgentIdentityVerifier {
  private e2eeCrypto: E2EECrypto;
  private peerTable: Map<string, PeerInfo>;
  private connectedPeers: Set<string>;
  private logger: Logger;

  constructor(
    e2eeCrypto: E2EECrypto,
    peerTable: Map<string, PeerInfo>,
    connectedPeers: Set<string>
  ) {
    this.e2eeCrypto = e2eeCrypto;
    this.peerTable = peerTable;
    this.connectedPeers = connectedPeers;
    this.logger = new Logger({ component: 'AgentIdentityVerifier' });
  }

  /**
   * 解析 AgentId，提取 PeerId 前缀
   *
   * AgentId 格式: agent:<PeerId前16位>:<随机8位>
   *
   * @param agentId Agent ID
   * @returns 解析结果，包含 peerIdPrefix 和 randomSuffix
   */
  parseAgentId(agentId: string): { peerIdPrefix: string; randomSuffix: string } | null {
    // 验证格式
    const parts = agentId.split(':');
    if (parts.length !== 3 || parts[0] !== 'agent') {
      this.logger.warn('Invalid AgentId format', { agentId });
      return null;
    }

    const peerIdPrefix = parts[1];
    const randomSuffix = parts[2];

    // 验证 PeerId 前缀长度（应该是 16 位）
    if (peerIdPrefix.length !== 16) {
      this.logger.warn('Invalid PeerId prefix length', {
        agentId,
        expectedLength: 16,
        actualLength: peerIdPrefix.length
      });
      return null;
    }

    // 验证随机后缀长度（应该是 8 位十六进制）
    if (randomSuffix.length !== 8 || !/^[0-9a-fA-F]+$/.test(randomSuffix)) {
      this.logger.warn('Invalid random suffix format', {
        agentId,
        randomSuffix
      });
      return null;
    }

    return { peerIdPrefix, randomSuffix };
  }

  /**
   * 通过 PeerId 前缀查找完整的 PeerId
   *
   * @param peerIdPrefix PeerId 前缀（16 位）
   * @returns 匹配的完整 PeerId，如果未找到返回 null
   */
  findPeerByPrefix(peerIdPrefix: string): string | null {
    // 优先从已连接的 Peer 中查找
    for (const peerId of this.connectedPeers) {
      if (peerId.startsWith(peerIdPrefix)) {
        this.logger.debug('Found peer in connected set', {
          peerIdPrefix,
          matchedPeerId: peerId.slice(0, 16)
        });
        return peerId;
      }
    }

    // 如果未找到，从 peerTable 中查找
    for (const [peerId, peerInfo] of this.peerTable.entries()) {
      if (peerId.startsWith(peerIdPrefix)) {
        this.logger.debug('Found peer in peer table', {
          peerIdPrefix,
          matchedPeerId: peerId.slice(0, 16),
          connected: peerInfo.connected
        });
        return peerId;
      }
    }

    this.logger.warn('Peer not found by prefix', { peerIdPrefix });
    return null;
  }

  /**
   * 验证 AgentId 签名（RFC 003 Ed25519 签名升级）
   *
   * 支持两种验证方式：
   * 1. Ed25519 公钥验证（推荐）- 无需共享密钥，支持首次连接验证
   * 2. E2EE 公钥验证（向后兼容）- 需要已建立的加密通道
   *
   * @param agentId Agent ID
   * @param signature AgentId 签名（Base64，Ed25519 签名）
   * @param ed25519PublicKey Ed25519 公钥（Base64，用于验证签名）- 推荐
   * @param peerId 发送方的 PeerId（可选，用于交叉验证）
   * @param options 验证选项
   * @returns 验证结果
   */
  async verifyRemoteAgentId(
    agentId: string,
    signature: string,
    ed25519PublicKey?: string,
    peerId?: string,
    options: VerificationOptions = {}
  ): Promise<AgentIdVerificationResult> {
    const {
      strictPeerIdMatch = true,
      allowUnknownPeers = false,
      timeoutMs = 5000
    } = options;

    // Step 1: 解析 AgentId
    const parsed = this.parseAgentId(agentId);
    if (!parsed) {
      return {
        valid: false,
        error: 'Invalid AgentId format'
      };
    }

    const { peerIdPrefix } = parsed;

    // Step 2: 验证 PeerId 前缀匹配
    if (peerId && strictPeerIdMatch) {
      if (!peerId.startsWith(peerIdPrefix)) {
        this.logger.warn('PeerId prefix mismatch, possible impersonation', {
          agentId,
          providedPeerId: peerId.slice(0, 16),
          expectedPrefix: peerIdPrefix
        });
        return {
          valid: false,
          error: 'PeerId does not match AgentId prefix - possible impersonation attack',
          peerIdPrefix
        };
      }
    }

    // Step 3: 查找对应的 Peer 连接
    let matchedPeerId: string | undefined = peerId;
    if (!matchedPeerId) {
      const foundPeerId = this.findPeerByPrefix(peerIdPrefix);
      matchedPeerId = foundPeerId || undefined;
    }

    // ======================================
    // RFC 003 Ed25519 验证（优先使用）
    // ======================================
    // 如果提供了 Ed25519 公钥，直接验证签名，无需查找 Peer 或共享密钥
    if (ed25519PublicKey) {
      try {
        const isValid = await Ed25519Signer.verifyWithPublicKey(
          agentId,
          signature,
          ed25519PublicKey
        );

        if (!isValid) {
          this.logger.warn('Ed25519 signature verification failed', {
            agentId,
            ed25519PublicKey: ed25519PublicKey.slice(0, 16) + '...'
          });
          return {
            valid: false,
            error: 'Ed25519 signature verification failed - invalid signature',
            peerIdPrefix,
            matchedPeerId
          };
        }

        // Ed25519 验证成功
        this.logger.info('AgentId signature verified successfully (Ed25519)', {
          agentId,
          peerIdPrefix,
          matchedPeerId: matchedPeerId?.slice(0, 16)
        });

        return {
          valid: true,
          peerIdPrefix,
          matchedPeerId
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error('Ed25519 signature verification error', {
          agentId,
          error: errorMessage
        });
        return {
          valid: false,
          error: `Ed25519 signature verification error: ${errorMessage}`,
          peerIdPrefix,
          matchedPeerId
        };
      }
    }

    // ======================================
    // 向后兼容：E2EE 公钥验证（需要已建立的加密通道）
    // ======================================
    if (!matchedPeerId) {
      if (!allowUnknownPeers) {
        this.logger.warn('Unknown peer, rejecting AgentId', {
          agentId,
          peerIdPrefix
        });
        return {
          valid: false,
          error: 'Unknown peer - cannot verify signature (Ed25519 public key not provided)',
          peerIdPrefix
        };
      } else {
        // 允许未知 Peer，但无法验证签名
        this.logger.warn('Allowing unknown peer without signature verification', {
          agentId,
          peerIdPrefix
        });
        return {
          valid: true, // 允许但不验证签名
          peerIdPrefix,
          error: 'Unknown peer - signature verification skipped'
        };
      }
    }

    // 向后兼容：获取 Peer 的 E2EE 公钥
    const peerInfo = this.peerTable.get(matchedPeerId);
    if (!peerInfo) {
      this.logger.warn('Peer not in table', { matchedPeerId: matchedPeerId.slice(0, 16) });
      return {
        valid: false,
        error: 'Peer not found in peer table',
        peerIdPrefix,
        matchedPeerId
      };
    }

    // 尝试从 agentInfo 获取加密公钥
    let peerPublicKey: string | null = null;
    if (peerInfo.agentInfo?.encryptionPublicKey) {
      peerPublicKey = peerInfo.agentInfo.encryptionPublicKey;
    } else {
      // 尝试从 E2EECrypto 获取
      peerPublicKey = this.e2eeCrypto.getPeerPublicKey(matchedPeerId);
    }

    if (!peerPublicKey) {
      this.logger.warn('No E2EE public key for peer', {
        matchedPeerId: matchedPeerId.slice(0, 16)
      });
      return {
        valid: false,
        error: 'No E2EE public key available for peer - cannot verify signature',
        peerIdPrefix,
        matchedPeerId
      };
    }

    // 向后兼容：用 E2EE 公钥验证签名
    try {
      const isValid = this.e2eeCrypto.verifySignature(
        agentId,
        signature,
        peerPublicKey
      );

      if (!isValid) {
        this.logger.warn('Signature verification failed (E2EE fallback)', {
          agentId,
          matchedPeerId: matchedPeerId.slice(0, 16)
        });
        return {
          valid: false,
          error: 'Signature verification failed - invalid signature',
          peerIdPrefix,
          matchedPeerId
        };
      }

      // 验证成功（E2EE fallback)
      this.logger.info('AgentId signature verified successfully (E2EE fallback)', {
        agentId,
        matchedPeerId: matchedPeerId.slice(0, 16)
      });

      return {
        valid: true,
        peerIdPrefix,
        matchedPeerId
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error('Signature verification error', {
        agentId,
        matchedPeerId: matchedPeerId.slice(0, 16),
        error: errorMessage
      });

      return {
        valid: false,
        error: `Signature verification error: ${errorMessage}`,
        peerIdPrefix,
        matchedPeerId
      };
    }
  }

  /**
   * 批量验证多个 AgentId
   *
   * @param agentIds Agent ID 列表
   * @param signatures 对应的签名列表
   * @param peerIds 对应的 PeerId 列表（可选）
   * @returns 验证结果列表
   */
  async verifyBatch(
    agentIds: string[],
    signatures: string[],
    peerIds?: string[]
  ): Promise<AgentIdVerificationResult[]> {
    if (agentIds.length !== signatures.length) {
      this.logger.warn('Mismatched agentIds and signatures length', {
        agentIds: agentIds.length,
        signatures: signatures.length
      });
      return agentIds.map(() => ({
        valid: false,
        error: 'Mismatched input arrays'
      }));
    }

    const results: AgentIdVerificationResult[] = [];
    for (let i = 0; i < agentIds.length; i++) {
      const result = await this.verifyRemoteAgentId(
        agentIds[i],
        signatures[i],
        peerIds?.[i]
      );
      results.push(result);
    }

    return results;
  }

  /**
   * 快速验证（仅检查格式和 PeerId 前缀，不验证签名）
   *
   * 用于快速过滤明显无效的 AgentId
   *
   * @param agentId Agent ID
   * @param peerId PeerId（可选）
   * @returns 是否快速验证通过
   */
  quickVerify(agentId: string, peerId?: string): boolean {
    const parsed = this.parseAgentId(agentId);
    if (!parsed) {
      return false;
    }

    // 如果提供了 PeerId，检查前缀匹配
    if (peerId) {
      return peerId.startsWith(parsed.peerIdPrefix);
    }

    // 仅检查格式
    return true;
  }

  /**
   * 更新 Peer 表引用（用于实时更新）
   *
   * @param peerTable 新的 Peer 表
   * @param connectedPeers 新的已连接 Peer 集
   */
  updatePeerReferences(
    peerTable: Map<string, PeerInfo>,
    connectedPeers: Set<string>
  ): void {
    this.peerTable = peerTable;
    this.connectedPeers = connectedPeers;
    this.logger.debug('Peer references updated', {
      peerCount: peerTable.size,
      connectedCount: connectedPeers.size
    });
  }
}