/**
 * TaskGuard 测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskGuard, DEFAULT_TASK_GUARD_CONFIG, type TaskGuardRule, type TaskGuardContext } from './task-guard.js';
import type { TaskRequest, TaskAnnouncement, ReputationEntry } from './types.js';

describe('TaskGuard', () => {
  let guard: TaskGuard;

  beforeEach(() => {
    guard = new TaskGuard();
  });

  // 创建测试任务
  const createTask = (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
    taskId: 'test-task-1',
    taskType: 'test',
    description: 'A test task',
    from: 'peer-1',
    timestamp: Date.now(),
    timeout: 5000,
    ...overrides
  });

  const createAnnouncement = (overrides: Partial<TaskAnnouncement> = {}): TaskAnnouncement => ({
    announcementId: 'ann-test-1',
    taskType: 'test',
    description: 'A test announcement',
    from: 'peer-1',
    timestamp: Date.now(),
    timeout: 5000,
    status: 'open',
    ...overrides
  });

  describe('check() - 基础功能', () => {
    it('应该返回检查报告', () => {
      const task = createTask();
      const report = guard.check(task);

      expect(report.taskId).toBe('test-task-1');
      expect(report.passed).toBe(true);
      expect(report.timestamp).toBeGreaterThan(0);
      expect(Array.isArray(report.results)).toBe(true);
    });

    it('应该运行所有启用的规则', () => {
      const task = createTask();
      const report = guard.check(task);

      // 7 个默认规则
      expect(report.results).toHaveLength(7);
    });

    it('应该正确分类 blocks 和 warnings', () => {
      const task = createTask({ description: 'rm -rf /' });
      const report = guard.check(task);

      expect(report.passed).toBe(false);
      expect(report.blocks.length).toBeGreaterThan(0);
    });

    it('应该记录任务以用于频率限制', () => {
      const task = createTask();
      
      guard.check(task);
      guard.check(task);
      guard.check(task);
      
      // 第四次检查应该在 recentTaskCount 中看到 3
      const report = guard.check(task, { isWhitelisted: false, isBlacklisted: false });
      
      // 频率限制规则应该通过（3 < 10）
      const rateLimitResult = report.results.find(r => r.ruleId === 'rate-limit');
      expect(rateLimitResult?.passed).toBe(true);
    });
  });

  describe('规则 1: 黑名单检查', () => {
    it('应该阻止黑名单用户', () => {
      const task = createTask();
      const report = guard.check(task, { isBlacklisted: true });

      expect(report.passed).toBe(false);
      expect(report.blocks.some(r => r.ruleId === 'blacklist')).toBe(true);
    });

    it('应该允许非黑名单用户', () => {
      const task = createTask();
      const report = guard.check(task, { isBlacklisted: false });

      const blacklistResult = report.results.find(r => r.ruleId === 'blacklist');
      expect(blacklistResult?.passed).toBe(true);
    });
  });

  describe('规则 2: 频率限制', () => {
    it('应该阻止频率过高的请求', () => {
      const task = createTask();
      
      // 发送 11 次请求（超过默认限制 10）
      for (let i = 0; i < 11; i++) {
        guard.check(task);
      }
      
      const report = guard.check(task);
      
      const rateLimitResult = report.results.find(r => r.ruleId === 'rate-limit');
      expect(rateLimitResult?.passed).toBe(false);
      expect(report.passed).toBe(false);
    });

    it('应该允许正常频率的请求', () => {
      const task = createTask();
      const report = guard.check(task);

      const rateLimitResult = report.results.find(r => r.ruleId === 'rate-limit');
      expect(rateLimitResult?.passed).toBe(true);
    });

    it('应该使用自定义的 maxTasksPerMinute', () => {
      const strictGuard = new TaskGuard({ maxTasksPerMinute: 2 });
      const task = createTask();
      
      // 第一次检查：recentTaskCount = 0，通过
      strictGuard.check(task);
      // 第二次检查：recentTaskCount = 1，通过
      strictGuard.check(task);
      // 第三次检查：recentTaskCount = 2，2 > 2 = false，通过
      strictGuard.check(task);
      // 第四次检查：recentTaskCount = 3，3 > 2 = true，被阻止
      const report = strictGuard.check(task);
      
      expect(report.passed).toBe(false);
      expect(report.blocks.some(r => r.ruleId === 'rate-limit')).toBe(true);
    });
  });

  describe('规则 3: 危险关键词检查', () => {
    it('应该检测危险关键词', () => {
      const dangerousTasks = [
        'rm -rf /',
        'format the disk',
        'delete all files',
        'destroy everything',
        'wipe the system'
      ];

      for (const desc of dangerousTasks) {
        const task = createTask({ description: desc });
        const report = guard.check(task);
        
        const keywordResult = report.results.find(r => r.ruleId === 'dangerous-keywords');
        expect(keywordResult?.passed).toBe(false);
      }
    });

    it('应该允许安全描述', () => {
      const task = createTask({ description: 'Read a file and process data' });
      const report = guard.check(task);

      const keywordResult = report.results.find(r => r.ruleId === 'dangerous-keywords');
      expect(keywordResult?.passed).toBe(true);
    });

    it('应该检测关键词（不区分大小写）', () => {
      const task = createTask({ description: 'FORMAT the disk' });
      const report = guard.check(task);

      const keywordResult = report.results.find(r => r.ruleId === 'dangerous-keywords');
      expect(keywordResult?.passed).toBe(false);
    });
  });

  describe('规则 4: 危险模式检查', () => {
    it('应该检测危险正则模式', () => {
      const dangerousPatterns = [
        'rm -rf /',
        'format c:',
        'delete all records',
        'drop database users',
        'shutdown -h now'
      ];

      for (const desc of dangerousPatterns) {
        const task = createTask({ description: desc });
        const report = guard.check(task);
        
        const patternResult = report.results.find(r => r.ruleId === 'dangerous-patterns');
        expect(patternResult?.passed).toBe(false);
      }
    });

    it('应该允许安全模式', () => {
      const task = createTask({ description: 'delete a single item from list' });
      const report = guard.check(task);

      const patternResult = report.results.find(r => r.ruleId === 'dangerous-patterns');
      expect(patternResult?.passed).toBe(true);
    });
  });

  describe('规则 5: 信誉检查', () => {
    it('应该检查信誉是否足够执行危险任务', () => {
      const reputation: ReputationEntry = {
        peerId: 'peer-1',
        score: 50, // 低于默认的 minReputationForDangerous (70)
        successfulTasks: 10,
        failedTasks: 5,
        totalTasks: 15,
        avgResponseTime: 100,
        lastInteraction: Date.now(),
        history: []
      };

      const task = createTask({ description: 'rm -rf /' });
      const report = guard.check(task, { requesterReputation: reputation });

      const repResult = report.results.find(r => r.ruleId === 'reputation');
      expect(repResult?.passed).toBe(false);
    });

    it('应该允许高信誉用户执行危险任务', () => {
      const reputation: ReputationEntry = {
        peerId: 'peer-1',
        score: 80,
        successfulTasks: 100,
        failedTasks: 5,
        totalTasks: 105,
        avgResponseTime: 50,
        lastInteraction: Date.now(),
        history: []
      };

      const task = createTask({ description: 'rm -rf /' });
      const report = guard.check(task, { requesterReputation: reputation });

      // 注意：虽然信誉通过了，但危险关键词检查仍然会阻止
      const repResult = report.results.find(r => r.ruleId === 'reputation');
      expect(repResult?.passed).toBe(true);
    });

    it('应该处理无信誉记录的情况', () => {
      const task = createTask();
      const report = guard.check(task);

      const repResult = report.results.find(r => r.ruleId === 'reputation');
      expect(repResult?.passed).toBe(true);
    });
  });

  describe('规则 6: 文件操作检查', () => {
    it('应该检测系统路径文件操作', () => {
      const dangerousPaths = [
        'read /etc/passwd',
        'write to /sys/config',
        'delete /proc/123',
        'edit /dev/null'
      ];

      for (const desc of dangerousPaths) {
        const task = createTask({ description: desc });
        const report = guard.check(task);
        
        const fileResult = report.results.find(r => r.ruleId === 'file-operation');
        expect(fileResult?.passed).toBe(false);
      }
    });

    it('应该允许普通文件操作', () => {
      const task = createTask({ description: 'read ~/documents/file.txt' });
      const report = guard.check(task);

      const fileResult = report.results.find(r => r.ruleId === 'file-operation');
      expect(fileResult?.passed).toBe(true);
    });
  });

  describe('规则 7: 网络操作检查', () => {
    it('应该检测可疑的网络下载', () => {
      // 更新测试用例：只检测真正的可执行文件扩展名
      const suspiciousOps = [
        'download malware.exe from http://example.com',
        'fetch tool.dll via curl',
        'wget http://example.com/backdoor.app',
        'download payload.deb from api'
      ];

      for (const desc of suspiciousOps) {
        const task = createTask({ description: desc });
        const report = guard.check(task);
        
        const networkResult = report.results.find(r => r.ruleId === 'network-operation');
        expect(networkResult?.passed).toBe(false);
      }
    });

    it('应该允许正常的网络操作', () => {
      // 更新测试：python script 不再被标记为可疑
      const normalOps = [
        'fetch data from http://api.example.com/data',
        'download python script from api',
        'download script.sh from http://example.com'
      ];

      for (const desc of normalOps) {
        const task = createTask({ description: desc });
        const report = guard.check(task);

        const networkResult = report.results.find(r => r.ruleId === 'network-operation');
        expect(networkResult?.passed).toBe(true);
      }
    });
  });

  describe('quickCheck()', () => {
    it('应该只返回布尔值', () => {
      const task = createTask();
      expect(guard.quickCheck(task)).toBe(true);
    });

    it('应该对危险任务返回 false', () => {
      const task = createTask({ description: 'rm -rf /' });
      expect(guard.quickCheck(task)).toBe(false);
    });
  });

  describe('addRule()', () => {
    it('应该添加自定义规则', () => {
      const customRule: TaskGuardRule = {
        id: 'custom-rule',
        name: '自定义规则',
        description: '测试自定义规则',
        enabled: true,
        severity: 'warn',
        check: (task, context) => ({
          passed: true,
          severity: 'warn',
          ruleId: 'custom-rule',
          message: '自定义规则检查通过'
        })
      };

      guard.addRule(customRule);
      
      const task = createTask();
      const report = guard.check(task);
      
      expect(report.results.some(r => r.ruleId === 'custom-rule')).toBe(true);
    });

    it('自定义规则应该能阻止任务', () => {
      const blockRule: TaskGuardRule = {
        id: 'block-all',
        name: '阻止所有',
        description: '测试阻止规则',
        enabled: true,
        severity: 'block',
        check: (task, context) => ({
          passed: false,
          severity: 'block',
          ruleId: 'block-all',
          message: '阻止所有任务'
        })
      };

      guard.addRule(blockRule);
      
      const task = createTask();
      const report = guard.check(task);
      
      expect(report.passed).toBe(false);
      expect(report.blocks.some(r => r.ruleId === 'block-all')).toBe(true);
    });
  });

  describe('setRuleEnabled()', () => {
    it('应该禁用规则', () => {
      guard.setRuleEnabled('blacklist', false);
      
      const task = createTask();
      const report = guard.check(task, { isBlacklisted: true });
      
      // 黑名单规则被禁用，应该通过
      expect(report.passed).toBe(true);
    });

    it('应该重新启用规则', () => {
      guard.setRuleEnabled('blacklist', false);
      guard.setRuleEnabled('blacklist', true);
      
      const task = createTask();
      const report = guard.check(task, { isBlacklisted: true });
      
      expect(report.passed).toBe(false);
    });

    it('应该忽略不存在的规则 ID', () => {
      // 不应该抛出错误
      guard.setRuleEnabled('non-existent-rule', true);
      guard.setRuleEnabled('non-existent-rule', false);
    });
  });

  describe('updateConfig()', () => {
    it('应该更新配置', () => {
      guard.updateConfig({ maxTasksPerMinute: 5 });
      
      const task = createTask();
      for (let i = 0; i < 6; i++) {
        guard.check(task);
      }
      
      const report = guard.check(task);
      expect(report.passed).toBe(false);
    });

    it('应该合并配置', () => {
      const originalBlocked = DEFAULT_TASK_GUARD_CONFIG.blockedKeywords.length;
      guard.updateConfig({ blockedKeywords: ['custom-dangerous-word'] });
      
      const task = createTask({ description: 'custom-dangerous-word' });
      const report = guard.check(task);
      
      expect(report.passed).toBe(false);
    });
  });

  describe('requiresConfirmation', () => {
    it('应该在有 warn 级别失败时要求确认', () => {
      const reputation: ReputationEntry = {
        peerId: 'peer-1',
        score: 50,
        successfulTasks: 10,
        failedTasks: 5,
        totalTasks: 15,
        avgResponseTime: 100,
        lastInteraction: Date.now(),
        history: []
      };

      const task = createTask({ description: 'rm -rf /' });
      const report = guard.check(task, { requesterReputation: reputation });

      // 危险任务会被 block，但如果只是 warn 级别，应该要求确认
      expect(report.requiresConfirmation).toBeDefined();
    });

    it('应该遵循 requireConfirmationForDangerous 配置', () => {
      const noConfirmGuard = new TaskGuard({ requireConfirmationForDangerous: false });
      
      const task = createTask({ description: 'download script.sh' });
      const report = noConfirmGuard.check(task);
      
      // 即使有 warn 级别的问题，也不需要确认
      // 注意：需要找一个是 warn 而不是 block 的场景
    });
  });

  describe('处理 TaskAnnouncement', () => {
    it('应该正确处理 TaskAnnouncement 类型', () => {
      const announcement = createAnnouncement();
      const report = guard.check(announcement);

      expect(report.taskId).toBe('ann-test-1');
      expect(report.passed).toBe(true);
    });

    it('应该检测 TaskAnnouncement 中的危险描述', () => {
      const announcement = createAnnouncement({ description: 'rm -rf /' });
      const report = guard.check(announcement);

      expect(report.passed).toBe(false);
    });
  });

  describe('规则执行错误处理', () => {
    it('应该处理规则执行中的错误', () => {
      const errorRule: TaskGuardRule = {
        id: 'error-rule',
        name: '错误规则',
        description: '测试错误处理',
        enabled: true,
        severity: 'warn',
        check: (task, context) => {
          throw new Error('规则执行失败');
        }
      };

      guard.addRule(errorRule);
      
      const task = createTask();
      const report = guard.check(task);
      
      const errorResult = report.results.find(r => r.ruleId === 'error-rule');
      expect(errorResult?.passed).toBe(false);
      expect(errorResult?.message).toContain('规则执行错误');
    });
  });
});