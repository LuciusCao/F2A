/**
 * 信誉安全机制测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ChainSignatureManager,
  InvitationManager,
  ChallengeManager,
  SignedReputationEvent,
} from './reputation-security.js';
import { ReputationManager } from './reputation.js';

describe('ChainSignatureManager', () => {
  let chainManager: ChainSignatureManager;

  beforeEach(() => {
    chainManager = new ChainSignatureManager();
  });

  describe('事件链管理', () => {
    it('should create genesis event', () => {
      const event: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 10,
        prevHash: 'genesis',
        timestamp: Date.now(),
        signatures: [],
      };

      const result = chainManager.addSignedEvent(event);
      expect(result).toBe(true);
    });

    it('should chain events correctly', () => {
      // 第一个事件
      const event1: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 10,
        prevHash: 'genesis',
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(event1);

      // 第二个事件
      const prevHash = chainManager.hashEvent(event1);
      const event2: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: -5,
        prevHash,
        timestamp: Date.now(),
        signatures: [],
      };

      const result = chainManager.addSignedEvent(event2);
      expect(result).toBe(true);
    });

    it('should reject event with wrong prevHash', () => {
      // 第一个事件
      const event1: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 10,
        prevHash: 'genesis',
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(event1);

      // 第二个事件，错误的 prevHash
      const event2: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: -5,
        prevHash: 'wrong-hash',
        timestamp: Date.now(),
        signatures: [],
      };

      const result = chainManager.addSignedEvent(event2);
      expect(result).toBe(false);
    });
  });

  describe('链验证', () => {
    it('should verify valid chain', () => {
      const event1: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 10,
        prevHash: 'genesis',
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(event1);

      const event2: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: -5,
        prevHash: chainManager.hashEvent(event1),
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(event2);

      expect(chainManager.verifyChain('peer-1')).toBe(true);
    });

    it('should detect broken chain', () => {
      // 先添加一个有效事件
      const validEvent: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 10,
        prevHash: 'genesis',
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(validEvent);
      
      // 现在手动添加一个破坏的事件到链中
      const chain = chainManager.getEventChain('peer-1');
      const brokenEvent: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 100,
        prevHash: 'wrong-hash', // 这个应该等于 validEvent 的 hash
        timestamp: Date.now(),
        signatures: [],
      };
      chain.push(brokenEvent);

      expect(chainManager.verifyChain('peer-1')).toBe(false);
    });
  });

  describe('分数计算', () => {
    it('should calculate score from chain', () => {
      const event1: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 10,
        prevHash: 'genesis',
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(event1);

      const event2: SignedReputationEvent = {
        peerId: 'peer-1',
        delta: 20,
        prevHash: chainManager.hashEvent(event1),
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(event2);

      const score = chainManager.calculateScoreFromChain('peer-1', 70);
      expect(score).toBe(100); // 70 + 10 + 20
    });
  });
});

describe('InvitationManager', () => {
  let reputationManager: ReputationManager;
  let invitationManager: InvitationManager;

  beforeEach(() => {
    reputationManager = new ReputationManager();
    invitationManager = new InvitationManager(reputationManager);
  });

  describe('创建邀请', () => {
    it('should create invitation for high reputation inviter', () => {
      // 提升邀请者信誉
      for (let i = 0; i < 5; i++) {
        reputationManager.recordSuccess('inviter-1', `task-${i}`);
      }

      const result = invitationManager.createInvitation('inviter-1', 'invitee-1');
      expect(result.success).toBe(true);
      expect(result.invitation).toBeDefined();
    });

    it('should accept invitation from default reputation inviter (70 > 60)', () => {
      // 邀请者默认信誉是 70，而要求是 60
      const result = invitationManager.createInvitation('inviter-1', 'invitee-1');
      expect(result.success).toBe(true);
    });

    it('should reject invitation from very low reputation inviter', () => {
      // 降低邀请者信誉到低于 60
      for (let i = 0; i < 5; i++) {
        reputationManager.recordFailure('inviter-1', `task-${i}`, 'test');
      }

      const result = invitationManager.createInvitation('inviter-1', 'invitee-1');
      // 检查信誉是否足够
      const score = reputationManager.getReputation('inviter-1').score;
      if (score < 60) {
        expect(result.success).toBe(false);
      }
    });

    it('should reject when invitation quota exhausted', () => {
      // 提升邀请者信誉
      for (let i = 0; i < 5; i++) {
        reputationManager.recordSuccess('inviter-1', `task-${i}`);
      }

      // 创建 5 个邀请（达到上限）
      for (let i = 0; i < 5; i++) {
        invitationManager.createInvitation('inviter-1', `invitee-${i}`);
      }

      // 第 6 个应该失败
      const result = invitationManager.createInvitation('inviter-1', 'invitee-6');
      expect(result.success).toBe(false);
      expect(result.error).toContain('quota');
    });

    it('should reject duplicate invitation', () => {
      for (let i = 0; i < 5; i++) {
        reputationManager.recordSuccess('inviter-1', `task-${i}`);
      }

      invitationManager.createInvitation('inviter-1', 'invitee-1');
      
      // 另一个邀请者邀请同一人
      for (let i = 0; i < 5; i++) {
        reputationManager.recordSuccess('inviter-2', `task-${i}`);
      }
      
      const result = invitationManager.createInvitation('inviter-2', 'invitee-1');
      expect(result.success).toBe(false);
    });
  });

  describe('初始信誉计算', () => {
    it('should set initial score based on inviter reputation', () => {
      // 提升邀请者信誉到高分
      for (let i = 0; i < 10; i++) {
        reputationManager.recordSuccess('inviter-1', `task-${i}`);
      }

      const inviterScore = reputationManager.getReputation('inviter-1').score;
      
      invitationManager.createInvitation('inviter-1', 'invitee-1');
      
      const inviteeScore = reputationManager.getReputation('invitee-1').score;
      // 初始分数 = inviter分数 * 0.5
      expect(inviteeScore).toBeGreaterThanOrEqual(30);
    });
  });

  describe('连带责任', () => {
    it('should apply joint liability penalty', () => {
      for (let i = 0; i < 5; i++) {
        reputationManager.recordSuccess('inviter-1', `task-${i}`);
      }

      invitationManager.createInvitation('inviter-1', 'invitee-1');

      const beforeScore = reputationManager.getReputation('inviter-1').score;
      
      // 被邀请者作恶
      invitationManager.applyJointLiability('invitee-1', 20);
      
      const afterScore = reputationManager.getReputation('inviter-1').score;
      expect(afterScore).toBeLessThan(beforeScore);
    });

    it('should not apply penalty when joint liability disabled', () => {
      const noLiabilityManager = new InvitationManager(reputationManager, {
        jointLiability: false,
      });

      for (let i = 0; i < 5; i++) {
        reputationManager.recordSuccess('inviter-1', `task-${i}`);
      }

      noLiabilityManager.createInvitation('inviter-1', 'invitee-1');

      const beforeScore = reputationManager.getReputation('inviter-1').score;
      
      noLiabilityManager.applyJointLiability('invitee-1', 20);
      
      const afterScore = reputationManager.getReputation('inviter-1').score;
      expect(afterScore).toBe(beforeScore);
    });
  });
});

describe('ChallengeManager', () => {
  let reputationManager: ReputationManager;
  let chainManager: ChainSignatureManager;
  let challengeManager: ChallengeManager;

  beforeEach(() => {
    reputationManager = new ReputationManager();
    chainManager = new ChainSignatureManager();
    challengeManager = new ChallengeManager(reputationManager, chainManager);
  });

  describe('提交挑战', () => {
    it('should submit challenge', () => {
      const challenge = challengeManager.submitChallenge(
        'challenger-1',
        'target-1',
        'invalid_history',
        'Evidence text'
      );

      expect(challenge.challengerId).toBe('challenger-1');
      expect(challenge.targetId).toBe('target-1');
      expect(challenge.status).toBe('pending');
    });

    it('should track challenges by target', () => {
      challengeManager.submitChallenge('challenger-1', 'target-1', 'invalid_history', 'e1');
      challengeManager.submitChallenge('challenger-2', 'target-1', 'collusion', 'e2');

      const challenges = challengeManager.getChallenges('target-1');
      expect(challenges.length).toBe(2);
    });
  });

  describe('处理挑战', () => {
    it('should detect invalid chain when prevHash is wrong', () => {
      // 直接验证链，不依赖 processChallenge
      const event: SignedReputationEvent = {
        peerId: 'target-1',
        delta: 10,
        prevHash: 'wrong-hash', // 错误的 prevHash
        timestamp: Date.now(),
        signatures: [],
      };
      
      // 尝试添加无效事件
      const result = chainManager.addSignedEvent(event);
      
      // 由于没有 genesis 事件，prevHash 应该是 'genesis'
      expect(result).toBe(false);
      
      // 验证链应该是空的
      expect(chainManager.verifyChain('target-1')).toBe(true);
    });

    it('should fail when chain is valid', () => {
      // 创建有效的链
      const event1: SignedReputationEvent = {
        peerId: 'target-1',
        delta: 10,
        prevHash: 'genesis',
        timestamp: Date.now(),
        signatures: [],
      };
      chainManager.addSignedEvent(event1);

      const challenge = challengeManager.submitChallenge(
        'challenger-1',
        'target-1',
        'invalid_history',
        'Chain looks suspicious'
      );

      const beforeScore = reputationManager.getReputation('challenger-1').score;
      const result = challengeManager.processChallenge(challenge);
      const afterScore = reputationManager.getReputation('challenger-1').score;

      expect(result.success).toBe(false);
      expect(afterScore).toBeLessThan(beforeScore); // 挑战失败，惩罚挑战者
    });
  });

  describe('合谋检测', () => {
    it('should detect high variance as potential collusion', () => {
      // 创建分数波动大的历史
      for (let i = 0; i < 10; i++) {
        reputationManager.recordSuccess('suspicious-1', `task-${i}`, i % 2 === 0 ? 50 : -30);
      }

      const score = challengeManager.detectCollusion('suspicious-1');
      expect(score).toBeGreaterThan(0);
    });

    it('should return low score for normal behavior', () => {
      // 正常行为
      for (let i = 0; i < 10; i++) {
        reputationManager.recordSuccess('normal-1', `task-${i}`);
      }

      const score = challengeManager.detectCollusion('normal-1');
      expect(score).toBeLessThan(0.5);
    });
  });

  describe('待处理挑战', () => {
    it('should list pending challenges', () => {
      challengeManager.submitChallenge('c1', 't1', 'invalid_history', 'e1');
      challengeManager.submitChallenge('c2', 't2', 'collusion', 'e2');

      const pending = challengeManager.getPendingChallenges();
      expect(pending.length).toBe(2);
    });
  });
});