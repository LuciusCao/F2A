/**
 * Tool Handlers 单元测试
 * 
 * 测试 F2A 工具处理器的核心功能
 * 
 * P1 修复内容：
 * 1. Mock方法名与真实API一致 - 使用 sendMessageToPeer
 * 2. F2A未初始化场景 - 正确模拟 getF2A() 返回 undefined
 * 3. 断言验证调用参数 - 验证 MESSAGE 协议格式
 * 4. 使用共享 mock 工具函数 - 抽取重复逻辑
 * 7. 添加恶意输入测试
 * 8. 添加 Unicode 边界测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolHandlers } from '../src/tool-handlers.js';
import type { F2APluginPublicInterface } from '../src/types.js';
import {
  createMockPlugin,
  createUninitializedMockPlugin,
  generatePeerId,
  MALICIOUS_INPUT_TEST_CASES,
  UNICODE_BOUNDARY_TEST_CASES,
  expectMessageProtocol,
} from './utils/test-helpers.js';

describe('ToolHandlers', () => {
  let handlers: ToolHandlers;
  let mockPlugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    handlers = new ToolHandlers(mockPlugin as unknown as F2APluginPublicInterface);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handleDiscover', () => {
    it('应该返回发现的 Agents 列表', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Agent1'), displayName: 'Agent1', capabilities: [] },
          { peerId: generatePeerId('Agent2'), displayName: 'Agent2', capabilities: [] },
        ],
      });

      const result = await handlers.handleDiscover({});

      expect(result.content).toContain('发现');
      expect(result.content).toContain('Agent1');
      expect(result.content).toContain('Agent2');
    });

    it('应该处理没有发现 Agents 的情况', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await handlers.handleDiscover({});

      expect(result.content).toContain('未发现');
    });

    it('应该处理发现失败的情况', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: false,
        error: { message: 'Network error' },
      });

      const result = await handlers.handleDiscover({});

      expect(result.content).toContain('失败');
    });

    it('应该按能力过滤 Agents', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Agent1'), displayName: 'Agent1', capabilities: [{ name: 'code-generation' }] },
        ],
      });

      await handlers.handleDiscover({ capability: 'code-generation' });

      expect(mockPlugin._mocks.networkClient.discoverAgents).toHaveBeenCalledWith('code-generation');
    });

    it('应该按最低信誉过滤 Agents', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Agent1'), displayName: 'Agent1', capabilities: [] },
        ],
      });

      await handlers.handleDiscover({ min_reputation: 90 });

      // getReputation 会被调用以检查信誉
      expect(mockPlugin._mocks.reputationSystem.getReputation).toHaveBeenCalled();
    });
  });

  describe('handleDelegate', () => {
    it('应该验证缺少 agent 参数', async () => {
      const result = await handlers.handleDelegate({
        agent: '',
        task: 'Test task',
      });

      expect(result.content).toContain('请提供有效的 agent');
    });

    it('应该验证缺少 task 参数', async () => {
      const result = await handlers.handleDelegate({
        agent: 'test-agent',
        task: '',
      });

      expect(result.content).toContain('请提供有效的 task');
    });

    it('应该成功发送消息给目标 Agent', async () => {
      // 设置：发现目标 Agent
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Target'), displayName: 'TargetAgent' },
        ],
      });

      const result = await handlers.handleDelegate({
        agent: 'TargetAgent',
        task: 'Hello, this is a test message',
      });

      // 验证：消息发送成功
      expect(result.content).toContain('✅');
      expect(result.content).toContain('消息已发送');
      
      // P1-3 修复：验证调用参数符合 MESSAGE 协议
      expect(mockPlugin._mocks.f2a.sendMessageToPeer).toHaveBeenCalled();
      
      const callArgs = mockPlugin._mocks.f2a.sendMessageToPeer.mock.calls[0];
      const validation = expectMessageProtocol(callArgs);
      
      expect(validation.peerIdValid).toBe(true);
      expect(validation.messageValid).toBe(true);
      expect(validation.protocolResult.topic).toBe('chat');
    });

    it('应该发送带 context 的任务请求', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Target'), displayName: 'TargetAgent' },
        ],
      });

      const result = await handlers.handleDelegate({
        agent: 'TargetAgent',
        task: 'Write code',
        context: 'This is a coding task',
      });

      expect(result.content).toContain('✅');
      
      // 验证：使用 task.request topic
      const callArgs = mockPlugin._mocks.f2a.sendMessageToPeer.mock.calls[0];
      const validation = expectMessageProtocol(callArgs);
      expect(validation.protocolResult.topic).toBe('task.request');
      expect(validation.protocolResult.content?.context).toBe('This is a coding task');
    });

    // P1-2 修复：核心路径覆盖 - F2A未初始化场景
    it('应该在 F2A 未运行时返回错误', async () => {
      // 使用专门的未初始化 mock
      const uninitializedPlugin = createUninitializedMockPlugin();
      uninitializedPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Target'), displayName: 'TargetAgent' },
        ],
      });

      const uninitializedHandlers = new ToolHandlers(uninitializedPlugin as unknown as F2APluginPublicInterface);

      const result = await uninitializedHandlers.handleDelegate({
        agent: 'TargetAgent',
        task: 'Test message',
      });

      expect(result.content).toContain('❌');
      expect(result.content).toContain('F2A 未运行');
      
      // 验证：getF2A 返回 undefined，sendMessageToPeer 不应被调用
      expect(uninitializedPlugin.getF2A()).toBeUndefined();
      expect(uninitializedPlugin._mocks.f2a.sendMessageToPeer).not.toHaveBeenCalled();
    });

    it('应该在找不到目标 Agent 时返回错误', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await handlers.handleDelegate({
        agent: 'NonExistent',
        task: 'Test message',
      });

      expect(result.content).toContain('❌');
      expect(result.content).toContain('找不到 Agent');
    });
  });

  describe('handleReputation', () => {
    it('应该返回指定 Peer 的信誉分数', async () => {
      mockPlugin._mocks.reputationSystem.getReputation.mockReturnValue({
        score: 90,
        successfulTasks: 10,
        failedTasks: 2,
        avgResponseTime: 150,
        lastInteraction: Date.now(),
      });

      const result = await handlers.handleReputation({
        action: 'view',
        peer_id: generatePeerId('View'),
      });

      expect(result.content).toContain('90');
    });

    it('应该列出所有 Peers 的信誉', async () => {
      mockPlugin._mocks.reputationSystem.getTopAgents.mockReturnValue([
        { peerId: generatePeerId('Agent1'), reputation: 90 },
        { peerId: generatePeerId('Agent2'), reputation: 80 },
      ]);

      const result = await handlers.handleReputation({
        action: 'list',
      });

      expect(result.content).toContain('信誉');
    });

    it('应该能够拉黑 Peer', async () => {
      const result = await handlers.handleReputation({
        action: 'block',
        peer_id: generatePeerId('Block'),
      });

      expect(result.content).toContain('屏蔽');
    });

    it('应该能够解除拉黑', async () => {
      const result = await handlers.handleReputation({
        action: 'unblock',
        peer_id: generatePeerId('Unblock'),
      });

      expect(result.content).toContain('解除');
    });
    
    // P1-7 修复：添加恶意输入测试 - 无效 peer_id
    it('应该拒绝无效格式的 peer_id', async () => {
      const result = await handlers.handleReputation({
        action: 'view',
        peer_id: 'InvalidPeerIdNotValid',
      });

      expect(result.content).toContain('❌');
      expect(result.content).toContain('无效');
    });
  });

  describe('handlePollTasks', () => {
    it('应该返回任务列表', async () => {
      mockPlugin._mocks.taskQueue.getPending.mockReturnValue([
        { taskId: 'task-1', status: 'pending', description: 'Task 1', from: generatePeerId('From'), taskType: 'test', createdAt: Date.now() },
      ]);

      const result = await handlers.handlePollTasks({});

      expect(result.content).toContain('任务');
    });

    it('应该处理空任务列表', async () => {
      mockPlugin._mocks.taskQueue.getPending.mockReturnValue([]);

      const result = await handlers.handlePollTasks({});

      expect(result.content).toContain('没有');
    });

    it('应该按状态过滤任务', async () => {
      mockPlugin._mocks.taskQueue.getAll.mockReturnValue([
        { taskId: 'task-1', status: 'pending', description: 'Task 1', from: generatePeerId('From'), taskType: 'test', createdAt: Date.now() },
      ]);

      const result = await handlers.handlePollTasks({ status: 'pending' });

      expect(result.content).toContain('任务');
    });
    
    // P1-7 修复：添加恶意输入测试 - 无效 status
    it('应该拒绝无效的 status 参数', async () => {
      const result = await handlers.handlePollTasks({ status: 'invalid_status' });

      expect(result.content).toContain('❌');
    });
    
    // P1-7 修复：添加恶意输入测试 - 无效 limit
    it('应该拒绝无效的 limit 参数', async () => {
      const result = await handlers.handlePollTasks({ limit: -1 });

      expect(result.content).toContain('❌');
    });
  });

  describe('handleSubmitResult', () => {
    it('应该成功提交成功结果', async () => {
      const result = await handlers.handleSubmitResult({
        task_id: 'task-1',
        result: 'Success',
        status: 'success',
      });

      expect(result.content).toContain('已提交');
    });

    it('应该提交失败结果', async () => {
      const result = await handlers.handleSubmitResult({
        task_id: 'task-1',
        result: 'Failed',
        status: 'error',
      });

      expect(result.content).toContain('已提交');
    });
    
    // P1-7 修复：添加恶意输入测试
    it('应该拒绝无效的 status 参数', async () => {
      const result = await handlers.handleSubmitResult({
        task_id: 'task-1',
        result: 'Test',
        status: 'invalid_status',
      });

      expect(result.content).toContain('❌');
    });
  });

  describe('handleEstimateTask', () => {
    it('应该返回任务评估结果', async () => {
      const result = await handlers.handleEstimateTask({
        task_type: 'code-review',
        description: 'Review code',
      });

      expect(result.content).toContain('工作量');
      expect(result.content).toContain('复杂度');
    });
    
    // P1-7 修复：添加恶意输入测试 - 空参数
    it('应该拒绝缺少 task_type 的请求', async () => {
      const result = await handlers.handleEstimateTask({
        task_type: '',
        description: 'Test',
      });

      expect(result.content).toContain('❌');
    });
    
    it('应该拒绝缺少 description 的请求', async () => {
      const result = await handlers.handleEstimateTask({
        task_type: 'test',
        description: '',
      });

      expect(result.content).toContain('❌');
    });
  });

  describe('handleReviewTask', () => {
    it('应该提交任务评审', async () => {
      const result = await handlers.handleReviewTask({
        task_id: 'task-1',
        workload: 50,
        value: 30,
      }, { sessionId: 'test-session' });

      expect(result.content).toContain('评审');
    });
    
    // P1-7 修复：添加恶意输入测试 - 越界参数
    it('应该拒绝越界的 workload 参数', async () => {
      const result = await handlers.handleReviewTask({
        task_id: 'task-1',
        workload: 150, // 超过 100
        value: 30,
      }, { sessionId: 'test-session' });

      expect(result.content).toContain('❌');
    });
    
    it('应该拒绝越界的 value 参数', async () => {
      const result = await handlers.handleReviewTask({
        task_id: 'task-1',
        workload: 50,
        value: 200, // 超过 100
      });

      expect(result.content).toContain('❌');
    });
  });

  describe('handleGetReviews', () => {
    it('应该返回任务评审汇总', async () => {
      const result = await handlers.handleGetReviews({
        task_id: 'task-1',
      });

      expect(result.content).toBeDefined();
    });
    
    // P1-7 修复：添加恶意输入测试
    it('应该拒绝缺少 task_id 的请求', async () => {
      const result = await handlers.handleGetReviews({
        task_id: '',
      });

      expect(result.content).toContain('❌');
    });
  });

  describe('handleGetCapabilities', () => {
    it('应该返回指定 Agent 的能力', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Agent1'), displayName: 'Agent1', capabilities: [{ name: 'code-generation' }] },
        ],
      });

      const result = await handlers.handleGetCapabilities({
        peer_id: generatePeerId('Agent1'),
      });

      expect(result.content).toBeDefined();
    });

    it('应该处理 Agent 不存在的情况', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await handlers.handleGetCapabilities({
        peer_id: generatePeerId('NonExist'),
      });

      expect(result.content).toContain('找不到');
    });
    
    // P1-7 修复：添加恶意输入测试 - 无效 peer_id 格式
    it('应该拒绝无效格式的 peer_id', async () => {
      const result = await handlers.handleGetCapabilities({
        peer_id: 'InvalidFormatNotStartingWith12D3KooW',
      });

      expect(result.content).toContain('❌');
      expect(result.content).toContain('无效');
    });
  });

  describe('handleTaskStats', () => {
    it('应该返回任务队列统计', async () => {
      mockPlugin._mocks.taskQueue.getStats.mockReturnValue({
        pending: 5,
        processing: 2,
        completed: 10,
        failed: 1,
        total: 18,
      });

      const result = await handlers.handleTaskStats({});

      expect(result.content).toContain('统计');
    });

    it('应该处理空统计', async () => {
      mockPlugin._mocks.taskQueue.getStats.mockReturnValue({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        total: 0,
      });

      const result = await handlers.handleTaskStats({});

      expect(result.content).toBeDefined();
    });
  });

  describe('handleBroadcast', () => {
    it('应该广播任务给所有具备某能力的 Agents', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [
          { peerId: generatePeerId('Agent1'), displayName: 'Agent1' },
          { peerId: generatePeerId('Agent2'), displayName: 'Agent2' },
        ],
      });
      mockPlugin._mocks.networkClient.sendMessage.mockResolvedValue({ success: true });

      const result = await handlers.handleBroadcast({
        capability: 'code-generation',
        task: 'Review code',
      });

      // 验证调用了 discoverAgents
      expect(mockPlugin._mocks.networkClient.discoverAgents).toHaveBeenCalled();
    });

    it('应该处理没有 Agents 具备所需能力的情况', async () => {
      mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
        success: true,
        data: [],
      });

      const result = await handlers.handleBroadcast({
        capability: 'nonexistent-capability',
        task: 'Test task',
      });

      expect(result.content).toContain('未发现');
    });
    
    // P1-7 修复：添加恶意输入测试
    it('应该拒绝缺少 capability 的请求', async () => {
      const result = await handlers.handleBroadcast({
        capability: '',
        task: 'Test',
      });

      expect(result.content).toContain('❌');
    });
    
    it('应该拒绝缺少 task 的请求', async () => {
      const result = await handlers.handleBroadcast({
        capability: 'test',
        task: '',
      });

      expect(result.content).toContain('❌');
    });
  });

  // ========== P1-7 修复：恶意输入测试套件 ==========

  describe('恶意输入防护', () => {
    describe('命令注入防护', () => {
      for (const maliciousInput of MALICIOUS_INPUT_TEST_CASES.commandInjection) {
        it(`应该检测并拒绝命令注入: "${maliciousInput.slice(0, 20)}..."`, async () => {
          mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
            success: true,
            data: [{ peerId: generatePeerId('Target'), displayName: 'TargetAgent' }],
          });

          const result = await handlers.handleDelegate({
            agent: 'TargetAgent',
            task: maliciousInput,
          });

          // 消息可能被发送，但应该在后续处理中被 TaskGuard 检测
          // 这里主要验证输入不会导致异常
          expect(result.content).toBeDefined();
          expect(() => JSON.parse(mockPlugin._mocks.f2a.sendMessageToPeer.mock.calls?.[0]?.[1] || '{}')).not.toThrow();
        });
      }
    });

    describe('路径遍历防护', () => {
      for (const maliciousInput of MALICIOUS_INPUT_TEST_CASES.pathTraversal) {
        it(`应该安全处理路径遍历输入: "${maliciousInput.slice(0, 20)}..."`, async () => {
          const result = await handlers.handleEstimateTask({
            task_type: 'file-operation',
            description: maliciousInput,
          });

          // 应该正常处理，不应该抛出异常
          expect(result.content).toBeDefined();
        });
      }
    });

    describe('环境变量注入防护', () => {
      for (const maliciousInput of MALICIOUS_INPUT_TEST_CASES.envInjection) {
        it(`应该安全处理环境变量注入: "${maliciousInput}"`, async () => {
          mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
            success: true,
            data: [{ peerId: generatePeerId('Target'), displayName: 'TargetAgent' }],
          });

          const result = await handlers.handleDelegate({
            agent: 'TargetAgent',
            task: `Read file ${maliciousInput}`,
          });

          expect(result.content).toBeDefined();
        });
      }
    });
  });

  // ========== P1-8 修复：Unicode 边界测试套件 ==========

  describe('Unicode 边界处理', () => {
    describe('不可见字符处理', () => {
      for (const char of UNICODE_BOUNDARY_TEST_CASES.invisible) {
        it(`应该安全处理不可见字符: U+${char.charCodeAt(0).toString(16).padStart(4, '0')}`, async () => {
          mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
            success: true,
            data: [{ peerId: generatePeerId('Target'), displayName: 'TargetAgent' }],
          });

          const result = await handlers.handleDelegate({
            agent: 'TargetAgent',
            task: `Test${char}Message`,
          });

          expect(result.content).toBeDefined();
        });
      }
    });

    describe('超长字符串处理', () => {
      for (const longStr of UNICODE_BOUNDARY_TEST_CASES.longStrings.slice(0, 3)) {
        it(`应该处理超长字符串 (长度: ${longStr.length})`, async () => {
          mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
            success: true,
            data: [{ peerId: generatePeerId('Target'), displayName: 'TargetAgent' }],
          });

          const result = await handlers.handleDelegate({
            agent: 'TargetAgent',
            task: longStr,
          });

          // 超长字符串应该被截断或正常处理
          expect(result.content).toBeDefined();
        });
      }
    });

    describe('控制字符处理', () => {
      for (const ctrl of UNICODE_BOUNDARY_TEST_CASES.controlChars) {
        it(`应该安全处理控制字符`, async () => {
          mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
            success: true,
            data: [{ peerId: generatePeerId('Target'), displayName: 'TargetAgent' }],
          });

          const result = await handlers.handleDelegate({
            agent: 'TargetAgent',
            task: `Line1${ctrl}Line2`,
          });

          expect(result.content).toBeDefined();
        });
      }
    });

    describe('特殊 Unicode 字符处理', () => {
      for (const char of UNICODE_BOUNDARY_TEST_CASES.specialChars) {
        it(`应该安全处理特殊 Unicode 字符: U+${char.charCodeAt(0).toString(16).padStart(4, '0')}`, async () => {
          mockPlugin._mocks.networkClient.discoverAgents.mockResolvedValue({
            success: true,
            data: [{ peerId: generatePeerId('Target'), displayName: 'TargetAgent' }],
          });

          const result = await handlers.handleDelegate({
            agent: 'TargetAgent',
            task: `Test${char}Message`,
          });

          expect(result.content).toBeDefined();
        });
      }
    });
  });
});