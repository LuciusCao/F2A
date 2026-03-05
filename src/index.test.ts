import { describe, it, expect } from 'vitest';
import {
  // 核心 P2P 网络
  F2A,
  P2PNetwork,
  TokenManager,
  defaultTokenManager,
  E2EECrypto,
  defaultE2EECrypto,
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
  // 版本号
  VERSION,
} from './index';

describe('SDK Index exports', () => {
  describe('Core P2P Network', () => {
    it('should export F2A class', () => {
      expect(F2A).toBeDefined();
      expect(typeof F2A.create).toBe('function');
    });

    it('should export P2PNetwork class', () => {
      expect(P2PNetwork).toBeDefined();
      expect(typeof P2PNetwork).toBe('function');
    });

    it('should export TokenManager class', () => {
      expect(TokenManager).toBeDefined();
      expect(typeof TokenManager).toBe('function');
    });

    it('should export defaultTokenManager', () => {
      expect(defaultTokenManager).toBeDefined();
      expect(typeof defaultTokenManager).toBe('object');
    });

    it('should export E2EECrypto class', () => {
      expect(E2EECrypto).toBeDefined();
      expect(typeof E2EECrypto).toBe('function');
    });

    it('should export defaultE2EECrypto', () => {
      expect(defaultE2EECrypto).toBeDefined();
      expect(typeof defaultE2EECrypto).toBe('object');
    });
  });

  describe('Reputation System (Phase 1-4)', () => {
    it('should export ReputationManager class', () => {
      expect(ReputationManager).toBeDefined();
      expect(typeof ReputationManager).toBe('function');
    });

    it('should export REPUTATION_TIERS constant', () => {
      expect(REPUTATION_TIERS).toBeDefined();
      expect(Array.isArray(REPUTATION_TIERS)).toBe(true);
      expect(REPUTATION_TIERS.length).toBeGreaterThan(0);
    });

    it('should have correct reputation tier structure', () => {
      const tier = REPUTATION_TIERS[0];
      expect(tier).toHaveProperty('level');
      expect(tier).toHaveProperty('title');
      expect(tier).toHaveProperty('min');
      expect(tier).toHaveProperty('max');
      expect(tier).toHaveProperty('permissions');
      expect(tier.permissions).toHaveProperty('canPublish');
      expect(tier.permissions).toHaveProperty('canExecute');
      expect(tier.permissions).toHaveProperty('canReview');
    });

    it('should export ReviewCommittee class', () => {
      expect(ReviewCommittee).toBeDefined();
      expect(typeof ReviewCommittee).toBe('function');
    });

    it('should export AutonomousEconomy class', () => {
      expect(AutonomousEconomy).toBeDefined();
      expect(typeof AutonomousEconomy).toBe('function');
    });
  });

  describe('Reputation Security (Phase 3)', () => {
    it('should export ChainSignatureManager class', () => {
      expect(ChainSignatureManager).toBeDefined();
      expect(typeof ChainSignatureManager).toBe('function');
    });

    it('should export InvitationManager class', () => {
      expect(InvitationManager).toBeDefined();
      expect(typeof InvitationManager).toBe('function');
    });

    it('should export ChallengeManager class', () => {
      expect(ChallengeManager).toBeDefined();
      expect(typeof ChallengeManager).toBe('function');
    });
  });

  describe('Utility Modules', () => {
    it('should export Logger class', () => {
      expect(Logger).toBeDefined();
      expect(typeof Logger).toBe('function');
    });

    it('should export RateLimiter class', () => {
      expect(RateLimiter).toBeDefined();
      expect(typeof RateLimiter).toBe('function');
    });

    it('should export RequestSigner class', () => {
      expect(RequestSigner).toBeDefined();
      expect(typeof RequestSigner).toBe('function');
    });

    it('should export createMessageSizeLimitMiddleware', () => {
      expect(createMessageSizeLimitMiddleware).toBeDefined();
      expect(typeof createMessageSizeLimitMiddleware).toBe('function');
    });

    it('should export createMessageTypeFilterMiddleware', () => {
      expect(createMessageTypeFilterMiddleware).toBeDefined();
      expect(typeof createMessageTypeFilterMiddleware).toBe('function');
    });
  });

  describe('VERSION', () => {
    it('should export VERSION', () => {
      expect(VERSION).toBeDefined();
      expect(typeof VERSION).toBe('string');
    });

    it('should have valid semantic version format', () => {
      expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});

describe('SDK Integration - Module instantiation', () => {
  it('should create ReputationManager instance', () => {
    const manager = new ReputationManager();
    expect(manager).toBeInstanceOf(ReputationManager);
    expect(typeof manager.getReputation).toBe('function');
    expect(typeof manager.recordSuccess).toBe('function');
    expect(typeof manager.recordFailure).toBe('function');
  });

  it('should create RateLimiter instance', () => {
    const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 100 });
    expect(limiter).toBeInstanceOf(RateLimiter);
    expect(typeof limiter.allowRequest).toBe('function');
    expect(typeof limiter.getRemainingTokens).toBe('function');
    expect(typeof limiter.reset).toBe('function');
    expect(typeof limiter.stop).toBe('function');
    limiter.stop(); // 清理资源
  });

  it('should create Logger instance', () => {
    const logger = new Logger({ component: 'test' });
    expect(logger).toBeInstanceOf(Logger);
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should create RequestSigner instance', () => {
    const signer = new RequestSigner('test-key');
    expect(signer).toBeInstanceOf(RequestSigner);
    expect(typeof signer.sign).toBe('function');
    expect(typeof signer.verify).toBe('function');
  });

  it('should create middleware objects', () => {
    const sizeMiddleware = createMessageSizeLimitMiddleware(1024 * 1024);
    expect(typeof sizeMiddleware).toBe('object');
    expect(sizeMiddleware).toHaveProperty('name', 'MessageSizeLimit');
    expect(sizeMiddleware).toHaveProperty('priority');
    expect(typeof sizeMiddleware.process).toBe('function');

    const typeMiddleware = createMessageTypeFilterMiddleware(['task', 'response']);
    expect(typeof typeMiddleware).toBe('object');
    expect(typeMiddleware).toHaveProperty('name', 'MessageTypeFilter');
    expect(typeMiddleware).toHaveProperty('priority');
    expect(typeof typeMiddleware.process).toBe('function');
  });
});
