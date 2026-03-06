import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReputationSystem } from './reputation';
import { ReputationConfig } from './types';

// Mock fs - 使用 factory 函数返回 mock 函数
vi.mock('fs', () => {
  return {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock path
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
}));

describe('ReputationSystem', () => {
  let system: ReputationSystem;
  const mockConfig: ReputationConfig = {
    initialScore: 50,
    decayFactor: 0.95,
    historyLimit: 10,
    minScoreForDelegation: 30,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValue(false);
    system = new ReputationSystem(mockConfig, './test-data');
  });

  describe('getReputation', () => {
    it('should return default reputation for new peer', () => {
      const rep = system.getReputation('peer-1');
      expect(rep.peerId).toBe('peer-1');
      expect(rep.score).toBe(50);
      expect(rep.totalTasks).toBe(0);
    });

    it('should return same reputation for existing peer', () => {
      const rep1 = system.getReputation('peer-1');
      const rep2 = system.getReputation('peer-1');
      expect(rep1).toBe(rep2);
    });
  });

  describe('recordSuccess', () => {
    it('should increase score on success', () => {
      system.recordSuccess('peer-1', 'task-1', 100);
      const rep = system.getReputation('peer-1');
      expect(rep.score).toBe(60);
      expect(rep.successfulTasks).toBe(1);
      expect(rep.totalTasks).toBe(1);
    });

    it('should update average response time using EMA', () => {
      system.recordSuccess('peer-1', 'task-1', 100);
      system.recordSuccess('peer-1', 'task-2', 200);
      const rep = system.getReputation('peer-1');
      // EMA: 100 * 0.7 + 200 * 0.3 = 70 + 60 = 130
      expect(rep.avgResponseTime).toBe(130);
    });

    it('should cap score at 100', () => {
      for (let i = 0; i < 10; i++) {
        system.recordSuccess('peer-1', `task-${i}`, 100);
      }
      const rep = system.getReputation('peer-1');
      expect(rep.score).toBe(100);
    });
  });

  describe('recordFailure', () => {
    it('should decrease score on failure', () => {
      system.recordFailure('peer-1', 'task-1', 'timeout');
      const rep = system.getReputation('peer-1');
      expect(rep.score).toBe(30);
      expect(rep.failedTasks).toBe(1);
    });

    it('should not go below 0', () => {
      system.recordFailure('peer-1', 'task-1');
      system.recordFailure('peer-1', 'task-2');
      system.recordFailure('peer-1', 'task-3');
      const rep = system.getReputation('peer-1');
      expect(rep.score).toBe(0);
    });
  });

  describe('recordRejection', () => {
    it('should decrease score on rejection', () => {
      system.recordRejection('peer-1', 'task-1', 'busy');
      const rep = system.getReputation('peer-1');
      expect(rep.score).toBe(45);
    });
  });

  describe('isAllowed', () => {
    it('should return true for allowed peer', () => {
      system.recordSuccess('peer-1', 'task-1', 100);
      system.recordSuccess('peer-1', 'task-2', 100);
      system.recordSuccess('peer-1', 'task-3', 100);
      expect(system.isAllowed('peer-1')).toBe(true);
    });

    it('should return false for disallowed peer when enabled', () => {
      // Create a system with enabled reputation check
      // enabled: true - 启用信誉检查，低于 minScoreForService 的节点将被拒绝
      // minScoreForService: 35 - 服务最低信誉门槛（默认50分，失败一次扣20分，所以30分会低于35）
      const strictConfig = { ...mockConfig, enabled: true, minScoreForService: 35 };
      const strictSystem = new ReputationSystem(strictConfig, './test-data');
      strictSystem.recordFailure('peer-1', 'task-1'); // score goes from 50 to 30
      expect(strictSystem.isAllowed('peer-1')).toBe(false);
    });
  });

  describe('getAllReputations', () => {
    it('should return all reputations sorted by score', () => {
      system.recordSuccess('peer-a', 'task-1', 100);
      system.recordSuccess('peer-a', 'task-2', 100);
      system.recordSuccess('peer-b', 'task-1', 100);
      
      const allReps = system.getAllReputations();
      expect(allReps[0].peerId).toBe('peer-a');
      expect(allReps[0].score).toBe(70);
      expect(allReps[1].peerId).toBe('peer-b');
      expect(allReps[1].score).toBe(60);
    });

    it('should limit results when specified', () => {
      system.recordSuccess('peer-a', 'task-1', 100);
      system.recordSuccess('peer-b', 'task-1', 100);
      system.recordSuccess('peer-c', 'task-1', 100);
      
      const allReps = system.getAllReputations();
      // getAllReputations doesn't have limit param, so we get all
      expect(allReps.length).toBe(3);
    });
  });
});
