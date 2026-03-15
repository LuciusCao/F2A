import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  // 核心 P2P 网络
  F2A,
  P2PNetwork,
  TokenManager,
  E2EECrypto,
  // 信誉系统
  ReputationManager,
  REPUTATION_TIERS,
  ReviewCommittee,
  AutonomousEconomy,
  // 信誉安全机制
  ChainSignatureManager,
  InvitationManager,
  ChallengeManager,
  // 工具模块
  Logger,
  RateLimiter,
  RequestSigner,
  createMessageSizeLimitMiddleware,
  createMessageTypeFilterMiddleware,
  // 类型
  type ReputationLevel,
  type MiddlewareContext,
  // 版本号
  VERSION,
} from './index.js';

// ============================================================================
// 业务场景 1: SDK 导出完整性验证
// 确保用户可以通过 SDK 正确导入所有需要的模块
// ============================================================================
describe('SDK Exports - 用户使用场景', () => {
  describe('场景 1.1: 用户创建 F2A 节点', () => {
    it('应该能导入 F2A 主类并创建实例', () => {
      expect(F2A).toBeDefined();
      expect(typeof F2A.create).toBe('function');
    });

    it('应该能导入 P2PNetwork 用于底层网络操作', () => {
      expect(P2PNetwork).toBeDefined();
      expect(typeof P2PNetwork).toBe('function');
    });
  });

  describe('场景 1.2: 用户配置安全机制', () => {
    it('应该能导入 TokenManager 进行认证管理', () => {
      expect(TokenManager).toBeDefined();
    });

    it('应该能导入 E2EECrypto 进行加密通信', () => {
      expect(E2EECrypto).toBeDefined();
    });

    it('应该能导入 RequestSigner 进行请求签名', () => {
      expect(RequestSigner).toBeDefined();
    });
  });

  describe('场景 1.3: 用户实现信誉系统', () => {
    it('应该能导入 ReputationManager 和等级配置', () => {
      expect(ReputationManager).toBeDefined();
      expect(REPUTATION_TIERS).toBeDefined();
      expect(REPUTATION_TIERS.length).toBe(5); // 5个等级
    });

    it('REPUTATION_TIERS 应该包含完整的业务等级定义', () => {
      const levels: ReputationLevel[] = ['restricted', 'novice', 'participant', 'contributor', 'core'];
      REPUTATION_TIERS.forEach((tier, index) => {
        expect(tier.level).toBe(levels[index]);
        expect(tier.permissions).toHaveProperty('canPublish');
        expect(tier.permissions).toHaveProperty('canExecute');
        expect(tier.permissions).toHaveProperty('canReview');
        expect(tier.permissions).toHaveProperty('publishPriority');
        expect(tier.permissions).toHaveProperty('publishDiscount');
      });
    });

    it('应该能导入 ReviewCommittee 进行任务评审', () => {
      expect(ReviewCommittee).toBeDefined();
    });

    it('应该能导入 AutonomousEconomy 进行经济系统管理', () => {
      expect(AutonomousEconomy).toBeDefined();
    });
  });

  describe('场景 1.4: 用户配置网络安全', () => {
    it('应该能导入 ChainSignatureManager 进行链式签名', () => {
      expect(ChainSignatureManager).toBeDefined();
    });

    it('应该能导入 InvitationManager 管理节点邀请', () => {
      expect(InvitationManager).toBeDefined();
    });

    it('应该能导入 ChallengeManager 进行节点挑战验证', () => {
      expect(ChallengeManager).toBeDefined();
    });
  });

  describe('场景 1.5: 用户配置基础设施', () => {
    it('应该能导入 Logger 进行日志记录', () => {
      expect(Logger).toBeDefined();
    });

    it('应该能导入 RateLimiter 进行速率限制', () => {
      expect(RateLimiter).toBeDefined();
    });

    it('应该能导入中间件工厂函数', () => {
      expect(createMessageSizeLimitMiddleware).toBeDefined();
      expect(createMessageTypeFilterMiddleware).toBeDefined();
    });
  });
});

// ============================================================================
// 业务场景 2: 真实业务功能验证
// 测试模块在真实业务场景中的工作能力
// ============================================================================
describe('SDK Integration - 真实业务场景', () => {
  describe('场景 2.1: 信誉管理业务流程', () => {
    it('应该能获取新节点的初始信誉分（默认70分）', () => {
      const reputationManager = new ReputationManager();
      const peerId = 'peer-' + Date.now() + '-' + Math.random();
      const initialRep = reputationManager.getReputation(peerId);
      expect(initialRep.score).toBe(70); // 默认初始分是70
      expect(initialRep.level).toBe('contributor'); // 70分对应contributor等级
    });

    it('应该能记录任务成功并改变信誉分', () => {
      // 使用自定义配置创建新的管理器，避免状态污染
      const reputationManager = new ReputationManager({
        initialScore: 50,
        alpha: 0.3,
        minScore: 0,
        maxScore: 100,
        maxHistory: 100,
      });
      const peerId = 'peer-' + randomUUID();
      
      // 先获取初始状态（会创建条目，分数为50）
      const initialRep = reputationManager.getReputation(peerId);
      expect(initialRep.score).toBe(50);
      // 记录初始历史长度（getReputation 会创建 'initial' 记录）
      const initialHistoryLength = initialRep.history.length;
      
      // 记录成功，delta=10
      reputationManager.recordSuccess(peerId, 'task-1', 10);
      const updatedRep = reputationManager.getReputation(peerId);
      
      // EWMA 算法: newScore = 0.3 * (50 + 10) + 0.7 * 50 = 53
      // 验证分数确实增加了
      expect(updatedRep.score).toBe(53);
      expect(updatedRep.score).toBeGreaterThan(50);
      
      // 验证历史记录增加了
      expect(updatedRep.history.length).toBe(initialHistoryLength + 1);
      expect(updatedRep.history[updatedRep.history.length - 1].type).toBe('task_success');
    });

    it('应该能根据信誉分判断权限', () => {
      const reputationManager = new ReputationManager();
      const peerId = 'peer-' + Date.now() + '-' + Math.random();
      // 默认70分为 contributor 等级，拥有所有权限
      expect(reputationManager.hasPermission(peerId, 'publish')).toBe(true);
      expect(reputationManager.hasPermission(peerId, 'execute')).toBe(true);
      expect(reputationManager.hasPermission(peerId, 'review')).toBe(true);
    });

    it('应该能获取信誉等级', () => {
      const reputationManager = new ReputationManager();
      const tier = reputationManager.getTier(75);
      expect(tier.level).toBe('contributor');
      expect(tier.permissions.canPublish).toBe(true);
    });

    it('应该能记录任务失败并改变信誉分', () => {
      // 使用自定义配置创建新的管理器，避免状态污染
      const reputationManager = new ReputationManager({
        initialScore: 50,
        alpha: 0.3,
        minScore: 0,
        maxScore: 100,
        maxHistory: 100,
      });
      const peerId = 'peer-' + randomUUID();
      
      // 使用默认的 delta (-20) 或传入负数
      reputationManager.recordFailure(peerId, 'task-fail', 'timeout');
      const updatedRep = reputationManager.getReputation(peerId);
      // 默认 delta 为 -20，EWMA: newScore = 0.3 * (50 - 20) + 0.7 * 50 = 44
      expect(updatedRep.score).toBeLessThan(50);
    });

    it('应该能获取发布优先级和折扣（根据实际等级）', () => {
      const reputationManager = new ReputationManager();
      const peerId = 'peer-' + Date.now() + '-' + Math.random();
      // 默认70分为 contributor 等级，优先级为3，折扣90%
      expect(reputationManager.getPublishPriority(peerId)).toBe(3);
      expect(reputationManager.getPublishDiscount(peerId)).toBe(0.9);
    });

    it('应该能获取高信誉节点列表', () => {
      const reputationManager = new ReputationManager();
      const peerA = 'peer-a-' + Date.now() + '-' + Math.random();
      const peerB = 'peer-b-' + Date.now() + '-' + Math.random();
      
      // 提升 peerA 的信誉
      reputationManager.recordSuccess(peerA, 'task-1', 20);
      reputationManager.recordSuccess(peerA, 'task-2', 20);
      
      // peerB 保持默认
      
      const highRepNodes = reputationManager.getHighReputationNodes(80);
      const highRepPeerIds = highRepNodes.map(n => n.peerId);
      expect(highRepPeerIds).toContain(peerA);
    });
  });

  describe('场景 2.2: 速率限制业务流程', () => {
    let rateLimiter: RateLimiter;

    beforeEach(() => {
      rateLimiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
    });

    afterEach(() => {
      rateLimiter.stop();
    });

    it('应该允许在限制内的请求', () => {
      const clientId = 'client-' + Date.now() + '-' + Math.random();
      expect(rateLimiter.allowRequest(clientId)).toBe(true);
      expect(rateLimiter.allowRequest(clientId)).toBe(true);
      expect(rateLimiter.allowRequest(clientId)).toBe(true);
    });

    it('应该拒绝超出限制的请求', () => {
      const clientId = 'client-' + Date.now() + '-' + Math.random();
      rateLimiter.allowRequest(clientId);
      rateLimiter.allowRequest(clientId);
      rateLimiter.allowRequest(clientId);
      expect(rateLimiter.allowRequest(clientId)).toBe(false);
    });

    it('应该能查询剩余令牌数', () => {
      const clientId = 'client-' + Date.now() + '-' + Math.random();
      expect(rateLimiter.getRemainingTokens(clientId)).toBe(3);
      rateLimiter.allowRequest(clientId);
      expect(rateLimiter.getRemainingTokens(clientId)).toBe(2);
    });

    it('应该能重置限制', () => {
      const clientId = 'client-' + Date.now() + '-' + Math.random();
      rateLimiter.allowRequest(clientId);
      rateLimiter.allowRequest(clientId);
      rateLimiter.allowRequest(clientId);
      expect(rateLimiter.allowRequest(clientId)).toBe(false);
      
      rateLimiter.reset(clientId);
      expect(rateLimiter.allowRequest(clientId)).toBe(true);
    });
  });

  describe('场景 2.3: 请求签名业务流程', () => {
    it('应该能签名和验证请求', () => {
      const signer = new RequestSigner({ secretKey: 'my-secret-key' });
      const payload = JSON.stringify({ action: 'publish', data: 'test' });

      const signedMessage = signer.sign(payload);
      expect(signedMessage).toBeDefined();
      expect(signedMessage.signature).toBeDefined();
      expect(signedMessage.timestamp).toBeDefined();
      expect(signedMessage.nonce).toBeDefined();

      const result = signer.verify(signedMessage);
      expect(result.valid).toBe(true);
    });

    it('应该拒绝篡改后的请求', () => {
      const signer = new RequestSigner({ secretKey: 'my-secret-key' });
      const payload = JSON.stringify({ action: 'publish', data: 'test' });
      const signedMessage = signer.sign(payload);

      // 篡改 payload
      signedMessage.payload = JSON.stringify({ action: 'publish', data: 'tampered' });
      const result = signer.verify(signedMessage);
      expect(result.valid).toBe(false);
    });
  });

  describe('场景 2.4: 日志记录业务流程', () => {
    it('应该能创建带组件标识的日志记录器', () => {
      const logger = new Logger({ component: 'TestService' });
      expect(logger).toBeInstanceOf(Logger);

      // 验证日志方法存在且可调用
      expect(() => logger.info('test message')).not.toThrow();
      expect(() => logger.error('error message')).not.toThrow();
      expect(() => logger.warn('warning message')).not.toThrow();
      expect(() => logger.debug('debug message')).not.toThrow();
    });
  });

  describe('场景 2.5: 中间件业务流程', () => {
    it('消息大小限制中间件应该能拦截大消息', async () => {
      const middleware = createMessageSizeLimitMiddleware(100);
      const context: MiddlewareContext = {
        message: {
          id: 'msg-1',
          type: 'task',
          payload: { data: 'x'.repeat(200) }, // 大消息
          timestamp: Date.now(),
        },
        peerId: 'peer-1',
        metadata: new Map(),
      };

      const result = await middleware.process(context);
      expect(result.action).toBe('drop');
    });

    it('消息类型过滤中间件应该能过滤不允许的类型', async () => {
      const middleware = createMessageTypeFilterMiddleware(['task', 'response']);
      const context: MiddlewareContext = {
        message: {
          id: 'msg-2',
          type: 'unknown-type',
          payload: {},
          timestamp: Date.now(),
        },
        peerId: 'peer-1',
        metadata: new Map(),
      };

      const result = await middleware.process(context);
      expect(result.action).toBe('drop');
    });

    it('允许的消息应该继续处理', async () => {
      const middleware = createMessageTypeFilterMiddleware(['task', 'response']);
      const context: MiddlewareContext = {
        message: {
          id: 'msg-3',
          type: 'task',
          payload: {},
          timestamp: Date.now(),
        },
        peerId: 'peer-1',
        metadata: new Map(),
      };

      const result = await middleware.process(context);
      expect(result.action).toBe('continue');
    });
  });

  describe('场景 2.6: 评审委员会业务流程', () => {
    it('应该能创建评审委员会', () => {
      const reputationManager = new ReputationManager();
      const committee = new ReviewCommittee({
        reputationManager,
        minReviewers: 2,
        maxReviewers: 5,
        reviewTimeout: 5000,
      });

      expect(committee).toBeInstanceOf(ReviewCommittee);
    });
  });

  describe('场景 2.7: 自治经济系统业务流程', () => {
    it('应该能创建经济系统', () => {
      const reputationManager = new ReputationManager();
      const economy = new AutonomousEconomy({
        reputationManager,
        baseTaskCost: 10,
        complexityMultiplier: 1.5,
      });

      expect(economy).toBeInstanceOf(AutonomousEconomy);
    });
  });

  describe('场景 2.8: 邀请管理业务流程', () => {
    it('应该能创建邀请管理器', () => {
      const reputationManager = new ReputationManager();
      const invitationManager = new InvitationManager({
        reputationManager,
        minInviterReputation: 60,
      });

      expect(invitationManager).toBeInstanceOf(InvitationManager);
    });
  });

  describe('场景 2.9: 挑战管理业务流程', () => {
    it('应该能创建挑战管理器', () => {
      const reputationManager = new ReputationManager();
      const challengeManager = new ChallengeManager({
        reputationManager,
      });

      expect(challengeManager).toBeInstanceOf(ChallengeManager);
    });
  });

  describe('场景 2.10: 链式签名业务流程', () => {
    it('应该能创建链式签名管理器', () => {
      const signatureManager = new ChainSignatureManager();
      expect(signatureManager).toBeInstanceOf(ChainSignatureManager);
    });
  });
});

// ============================================================================
// 业务场景 3: 版本和兼容性
// ============================================================================
describe('SDK Version - 版本管理', () => {
  it('应该导出有效的语义化版本号', () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe('string');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('版本号应该符合当前发布版本', () => {
    const [major, minor, patch] = VERSION.split('.').map(Number);
    // 接受 0.x.x（开发版本）和 1.x.x+（正式版本）
    expect(major).toBeGreaterThanOrEqual(0);
    expect(minor).toBeGreaterThanOrEqual(0);
    expect(patch).toBeGreaterThanOrEqual(0);
    // 确保版本号格式有效
    expect(major).toBeLessThan(100);
    expect(minor).toBeLessThan(100);
    expect(patch).toBeLessThan(100);
  });
});
