/**
 * F2A 信誉安全机制
 * Phase 3: 链式签名、邀请制、挑战机制
 */

import { createHash, createSign, createVerify } from 'crypto';
import { Logger } from '../utils/logger.js';
import { ReputationEntry, ReputationManager } from './reputation.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 签名信誉事件
 */
export interface SignedReputationEvent {
  peerId: string;
  delta: number;
  prevHash: string;
  timestamp: number;
  signatures: ReviewerSignature[];
}

/**
 * 评审者签名
 */
export interface ReviewerSignature {
  reviewerId: string;
  signature: string;
}

/**
 * 邀请记录
 */
export interface InvitationRecord {
  inviterId: string;
  inviteeId: string;
  invitationSignature: string;
  timestamp: number;
}

/**
 * 邀请规则配置
 */
export interface InvitationConfig {
  minInviterReputation: number;
  maxInvitations: number;
  initialScoreMultiplier: number;
  jointLiability: boolean;
  jointLiabilityRate: number;
}

/**
 * 挑战记录
 */
export interface ChallengeRecord {
  challengerId: string;
  targetId: string;
  reason: 'invalid_history' | 'collusion' | 'fake_signatures' | 'score_manipulation';
  evidence: string;
  stake: number;
  timestamp: number;
  status: 'pending' | 'success' | 'failed';
}

/**
 * 挑战结果
 */
export interface ChallengeResult {
  success: boolean;
  reward: number;
  reason: string;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_INVITATION_CONFIG: InvitationConfig = {
  minInviterReputation: 60,
  maxInvitations: 5,
  initialScoreMultiplier: 0.5,
  jointLiability: true,
  jointLiabilityRate: 0.3,
};

// ============================================================================
// 链式签名管理器
// ============================================================================

export class ChainSignatureManager {
  private eventChains: Map<string, SignedReputationEvent[]> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ component: 'ChainSignature' });
  }

  /**
   * 获取事件链
   */
  getEventChain(peerId: string): SignedReputationEvent[] {
    return this.eventChains.get(peerId) || [];
  }

  /**
   * 添加签名事件
   */
  addSignedEvent(event: SignedReputationEvent): boolean {
    // 验证 prevHash
    const chain = this.getEventChain(event.peerId);
    
    if (chain.length === 0) {
      if (event.prevHash !== 'genesis') {
        this.logger.error('Invalid genesis event', { peerId: event.peerId });
        return false;
      }
    } else {
      const lastEvent = chain[chain.length - 1];
      const expectedPrevHash = this.hashEvent(lastEvent);
      
      if (event.prevHash !== expectedPrevHash) {
        this.logger.error('Chain broken', { peerId: event.peerId });
        return false;
      }
    }

    chain.push(event);
    this.eventChains.set(event.peerId, chain);
    return true;
  }

  /**
   * 验证事件链完整性
   */
  verifyChain(peerId: string): boolean {
    const chain = this.getEventChain(peerId);
    
    if (chain.length === 0) return true;

    let prevHash = 'genesis';
    
    for (const event of chain) {
      // 检查 prevHash
      if (event.prevHash !== prevHash) {
        this.logger.error('Chain verification failed', {
          peerId,
          eventIndex: chain.indexOf(event),
        });
        return false;
      }

      prevHash = this.hashEvent(event);
    }

    return true;
  }

  /**
   * 计算事件哈希
   */
  hashEvent(event: SignedReputationEvent): string {
    const data = JSON.stringify({
      peerId: event.peerId,
      delta: event.delta,
      prevHash: event.prevHash,
      timestamp: event.timestamp,
    });
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * 创建签名事件
   */
  createSignedEvent(
    peerId: string,
    delta: number,
    signatures: ReviewerSignature[]
  ): SignedReputationEvent {
    const chain = this.getEventChain(peerId);
    const lastEvent = chain.length > 0 ? chain[chain.length - 1] : null;
    
    return {
      peerId,
      delta,
      prevHash: lastEvent ? this.hashEvent(lastEvent) : 'genesis',
      timestamp: Date.now(),
      signatures,
    };
  }

  /**
   * 从事件链计算信誉分
   */
  calculateScoreFromChain(peerId: string, initialScore: number = 70): number {
    const chain = this.getEventChain(peerId);
    let score = initialScore;

    for (const event of chain) {
      score = Math.max(0, Math.min(100, score + event.delta));
    }

    return score;
  }

  /**
   * 导出事件链
   */
  exportChain(peerId: string): string {
    const chain = this.getEventChain(peerId);
    return JSON.stringify(chain);
  }

  /**
   * 导入事件链
   */
  importChain(peerId: string, data: string): boolean {
    try {
      const chain = JSON.parse(data) as SignedReputationEvent[];
      this.eventChains.set(peerId, chain);
      return this.verifyChain(peerId);
    } catch {
      return false;
    }
  }
}

// ============================================================================
// 邀请管理器
// ============================================================================

export class InvitationManager {
  private config: InvitationConfig;
  private reputationManager: ReputationManager;
  private invitations: Map<string, InvitationRecord[]> = new Map();
  private inviteeToInviter: Map<string, string> = new Map();
  private logger: Logger;

  constructor(
    reputationManager: ReputationManager,
    config: Partial<InvitationConfig> = {}
  ) {
    this.config = { ...DEFAULT_INVITATION_CONFIG, ...config };
    this.reputationManager = reputationManager;
    this.logger = new Logger({ component: 'InvitationManager' });
  }

  /**
   * 创建邀请
   */
  createInvitation(
    inviterId: string,
    inviteeId: string
  ): { success: boolean; invitation?: InvitationRecord; error?: string } {
    // 检查邀请者信誉
    const inviterRep = this.reputationManager.getReputation(inviterId);
    
    if (inviterRep.score < this.config.minInviterReputation) {
      return {
        success: false,
        error: `Inviter reputation ${inviterRep.score} below minimum ${this.config.minInviterReputation}`,
      };
    }

    // 检查邀请配额
    const invitationCount = this.getInvitationCount(inviterId);
    
    if (invitationCount >= this.config.maxInvitations) {
      return {
        success: false,
        error: `Invitation quota exhausted (${invitationCount}/${this.config.maxInvitations})`,
      };
    }

    // 检查是否已被邀请
    if (this.inviteeToInviter.has(inviteeId)) {
      return {
        success: false,
        error: 'Invitee already invited by another node',
      };
    }

    // 创建邀请记录
    const invitation: InvitationRecord = {
      inviterId,
      inviteeId,
      invitationSignature: this.generateSignature(inviterId, inviteeId),
      timestamp: Date.now(),
    };

    // 记录邀请
    const inviterInvitations = this.invitations.get(inviterId) || [];
    inviterInvitations.push(invitation);
    this.invitations.set(inviterId, inviterInvitations);
    this.inviteeToInviter.set(inviteeId, inviterId);

    // 设置被邀请者的初始信誉
    const initialScore = Math.max(
      30,
      Math.floor(inviterRep.score * this.config.initialScoreMultiplier)
    );
    // 使用 ReputationManager 的公开方法设置初始分数
    this.reputationManager.setInitialScore(inviteeId, initialScore);

    this.logger.info('Invitation created', {
      inviterId: inviterId.slice(0, 16),
      inviteeId: inviteeId.slice(0, 16),
      initialScore,
    });

    return { success: true, invitation };
  }

  /**
   * 获取邀请者
   */
  getInviter(inviteeId: string): string | null {
    return this.inviteeToInviter.get(inviteeId) || null;
  }

  /**
   * 获取邀请数量
   */
  getInvitationCount(inviterId: string): number {
    return this.invitations.get(inviterId)?.length || 0;
  }

  /**
   * 执行连带责任惩罚
   */
  applyJointLiability(inviteeId: string, penalty: number): void {
    if (!this.config.jointLiability) return;

    const inviterId = this.getInviter(inviteeId);
    if (!inviterId) return;

    const jointPenalty = Math.floor(penalty * this.config.jointLiabilityRate);
    
    this.reputationManager.recordFailure(
      inviterId,
      `joint-liability-${inviteeId}`,
      `Joint liability for invitee ${inviteeId}`,
      -jointPenalty
    );

    this.logger.warn('Joint liability applied', {
      inviterId: inviterId.slice(0, 16),
      inviteeId: inviteeId.slice(0, 16),
      jointPenalty,
    });
  }

  /**
   * 获取所有邀请
   */
  getAllInvitations(): InvitationRecord[] {
    const all: InvitationRecord[] = [];
    for (const invitations of this.invitations.values()) {
      all.push(...invitations);
    }
    return all;
  }

  /**
   * 生成签名
   */
  private generateSignature(inviterId: string, inviteeId: string): string {
    const data = `${inviterId}:${inviteeId}:${Date.now()}`;
    return createHash('sha256').update(data).digest('hex');
  }
}

// ============================================================================
// 挑战管理器
// ============================================================================

export class ChallengeManager {
  private reputationManager: ReputationManager;
  private chainManager: ChainSignatureManager;
  private challenges: Map<string, ChallengeRecord[]> = new Map();
  private logger: Logger;

  constructor(
    reputationManager: ReputationManager,
    chainManager: ChainSignatureManager
  ) {
    this.reputationManager = reputationManager;
    this.chainManager = chainManager;
    this.logger = new Logger({ component: 'ChallengeManager' });
  }

  /**
   * 提交挑战
   */
  submitChallenge(
    challengerId: string,
    targetId: string,
    reason: ChallengeRecord['reason'],
    evidence: string,
    stake: number = 10
  ): ChallengeRecord {
    const challenge: ChallengeRecord = {
      challengerId,
      targetId,
      reason,
      evidence,
      stake,
      timestamp: Date.now(),
      status: 'pending',
    };

    const targetChallenges = this.challenges.get(targetId) || [];
    targetChallenges.push(challenge);
    this.challenges.set(targetId, targetChallenges);

    this.logger.info('Challenge submitted', {
      challengerId: challengerId.slice(0, 16),
      targetId: targetId.slice(0, 16),
      reason,
    });

    return challenge;
  }

  /**
   * 处理挑战
   */
  processChallenge(challenge: ChallengeRecord): ChallengeResult {
    const targetId = challenge.targetId;

    // 1. 验证事件链
    if (challenge.reason === 'invalid_history' || challenge.reason === 'fake_signatures') {
      const chainValid = this.chainManager.verifyChain(targetId);
      
      if (!chainValid) {
        // 挑战成功
        this.reputationManager.recordFailure(
          targetId,
          'challenge-invalid-chain',
          'Invalid reputation chain detected',
          -50
        );
        
        // 奖励挑战者
        this.reputationManager.recordReviewReward(
          challenge.challengerId,
          challenge.stake * 2
        );

        challenge.status = 'success';
        return { success: true, reward: challenge.stake * 2, reason: 'Invalid chain detected' };
      }
    }

    // 2. 检测合谋
    if (challenge.reason === 'collusion') {
      const collusionScore = this.detectCollusion(targetId);
      
      if (collusionScore > 0.8) {
        // 合谋检测成功
        this.reputationManager.recordFailure(
          targetId,
          'challenge-collusion',
          'Collusion detected',
          -30
        );
        
        this.reputationManager.recordReviewReward(
          challenge.challengerId,
          challenge.stake * 1.5
        );

        challenge.status = 'success';
        return { success: true, reward: challenge.stake * 1.5, reason: 'Collusion detected' };
      }
    }

    // 3. 分数操纵检测
    if (challenge.reason === 'score_manipulation') {
      const chain = this.chainManager.getEventChain(targetId);
      const calculatedScore = this.chainManager.calculateScoreFromChain(targetId);
      const claimedScore = this.reputationManager.getReputation(targetId).score;
      
      if (Math.abs(calculatedScore - claimedScore) > 10) {
        // 分数不一致
        this.reputationManager.recordFailure(
          targetId,
          'challenge-score-manipulation',
          'Score manipulation detected',
          -20
        );
        
        this.reputationManager.recordReviewReward(
          challenge.challengerId,
          challenge.stake * 1.5
        );

        challenge.status = 'success';
        return { success: true, reward: challenge.stake * 1.5, reason: 'Score manipulation detected' };
      }
    }

    // 挑战失败
    this.reputationManager.recordReviewPenalty(
      challenge.challengerId,
      -challenge.stake * 0.5,
      'Failed challenge'
    );

    challenge.status = 'failed';
    return { success: false, reward: 0, reason: 'Challenge failed' };
  }

  /**
   * 合谋检测算法
   */
  detectCollusion(nodeId: string): number {
    const entry = this.reputationManager.getReputation(nodeId);
    
    // 分析评审历史
    const successEvents = entry.history.filter(e => e.type === 'task_success');
    
    if (successEvents.length < 5) return 0;

    // 简单检测：如果所有成功事件都是同一任务类型，可疑度低
    // 如果成功事件分数波动极大，可疑度高
    const deltas = successEvents.map(e => e.delta);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((sum, d) => sum + Math.pow(d - avgDelta, 2), 0) / deltas.length;
    
    // 方差越大，可疑度越高
    const normalizedVariance = Math.min(1, variance / 100);
    
    return normalizedVariance;
  }

  /**
   * 获取挑战历史
   */
  getChallenges(targetId: string): ChallengeRecord[] {
    return this.challenges.get(targetId) || [];
  }

  /**
   * 获取待处理挑战
   */
  getPendingChallenges(): ChallengeRecord[] {
    const all: ChallengeRecord[] = [];
    for (const challenges of this.challenges.values()) {
      all.push(...challenges.filter(c => c.status === 'pending'));
    }
    return all;
  }
}

// 默认导出
export default {
  ChainSignatureManager,
  InvitationManager,
  ChallengeManager,
};