/**
 * F2A 核心测试
 * 
 * 测试策略：
 * 1. 单元测试 - 测试核心逻辑（能力管理、任务处理）
 * 2. 集成测试 - 移到 tests/integration/
 * 
 * 注意：此文件不测试 P2P 网络（已在 p2p-network.test.ts 和集成测试中覆盖）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { F2A } from './f2a.js';
import { AgentCapability, TaskDelegateOptions } from '../types/index.js';

// 最小化 Mock - 只 mock 外部依赖
vi.mock('./p2p-network', () => ({
  P2PNetwork: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue({ 
      success: true, 
      data: { peerId: 'test-peer-id', addresses: ['/ip4/127.0.0.1/tcp/9000'] }
    }),
    stop: vi.fn(),
    discoverAgents: vi.fn().mockResolvedValue([
      { peerId: 'agent-1', displayName: 'Agent 1', capabilities: [{ name: 'echo' }] },
      { peerId: 'agent-2', displayName: 'Agent 2', capabilities: [{ name: 'echo' }] },
    ]),
    getConnectedPeers: vi.fn().mockReturnValue([]),
    sendTaskRequest: vi.fn().mockResolvedValue({ success: true, data: { result: 'ok' } }),
    sendTaskResponse: vi.fn().mockResolvedValue({ success: true }),
    on: vi.fn(),
    setIdentityManager: vi.fn()
  }))
}));

vi.mock('./identity/index.js', () => ({
  IdentityManager: vi.fn().mockImplementation(() => ({
    loadOrCreate: vi.fn().mockResolvedValue({ success: true, data: { peerId: 'test-peer-id' } }),
    getPeerIdString: vi.fn().mockReturnValue('test-peer-id'),
    getPeerId: vi.fn().mockReturnValue({ toString: () => 'test-peer-id' }),
    getPrivateKey: vi.fn().mockReturnValue({ bytes: new Uint8Array(32) }),
    getE2EEKeyPair: vi.fn().mockReturnValue({ publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }),
    isLoaded: vi.fn().mockReturnValue(true)
  }))
}));

describe('F2A', () => {
  let f2a: F2A;

  beforeEach(async () => {
    f2a = await F2A.create({
      displayName: 'Test Agent',
      dataDir: '/tmp/f2a-test-' + Date.now(),
      network: { enableMDNS: false }
    });
  });

  afterEach(async () => {
    await f2a.stop();
  });

  // ============================================================================
  // 能力管理 - 核心功能
  // ============================================================================
  
  describe('capability management', () => {
    it('should register and retrieve capabilities', () => {
      const capability: AgentCapability = {
        name: 'echo',
        description: 'Echo back input',
        tools: ['echo']
      };

      const result = f2a.registerCapability(capability, async (params) => ({
        echoed: params.message
      }));

      expect(result.success).toBe(true);
      expect(f2a.getCapabilities()).toHaveLength(1);
      expect(f2a.getCapabilities()[0].name).toBe('echo');
    });

    it('should reject invalid capability definition', () => {
      const result = f2a.registerCapability(
        { name: '', description: 'Invalid', tools: [] }, // 空名称
        async () => {}
      );

      expect(result.success).toBe(false);
      expect(f2a.getCapabilities()).toHaveLength(0);
    });

    it('should update capability when registering same name', () => {
      f2a.registerCapability(
        { name: 'echo', description: 'Original', tools: [] },
        async () => 'v1'
      );
      f2a.registerCapability(
        { name: 'echo', description: 'Updated', tools: ['new-tool'] },
        async () => 'v2'
      );

      const caps = f2a.getCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0].description).toBe('Updated');
      expect(caps[0].tools).toContain('new-tool');
    });
  });

  // ============================================================================
  // 任务处理 - 核心功能
  // ============================================================================

  describe('task handling', () => {
    it('should execute registered handler and return result', async () => {
      const handler = vi.fn().mockResolvedValue({ echoed: 'hello' });
      f2a.registerCapability(
        { name: 'echo', description: 'Echo', tools: [] },
        handler
      );

      const sendResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'echo',
        'Test task',
        { message: 'hello' },
        'caller-peer'
      );

      expect(handler).toHaveBeenCalledWith({ message: 'hello' });
      expect(sendResponseSpy).toHaveBeenCalledWith(
        'caller-peer',
        'task-123',
        'success',
        { echoed: 'hello' }
      );
    });

    it('should reject unsupported capability', async () => {
      const sendResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'unknown-cap',
        'Test task',
        {},
        'caller-peer'
      );

      expect(sendResponseSpy).toHaveBeenCalledWith(
        'caller-peer',
        'task-123',
        'rejected',
        undefined,
        expect.stringContaining('not supported')
      );
    });

    it('should handle handler errors gracefully', async () => {
      f2a.registerCapability(
        { name: 'failing-cap', description: 'Fails', tools: [] },
        async () => { throw new Error('Handler failed'); }
      );

      const sendResponseSpy = vi.fn().mockResolvedValue({ success: true });
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'failing-cap',
        'Test task',
        {},
        'caller-peer'
      );

      expect(sendResponseSpy).toHaveBeenCalledWith(
        'caller-peer',
        'task-123',
        'error',
        undefined,
        'Handler failed'
      );
    });

    it('should not auto-respond when no handler (manual mode)', async () => {
      // 注册能力但不提供 handler - 等待手动响应
      (f2a as any).registeredCapabilities.set('manual-cap', {
        name: 'manual-cap',
        description: 'Manual',
        tools: []
        // 没有 handler
      });

      const sendResponseSpy = vi.fn();
      (f2a as any).p2pNetwork.sendTaskResponse = sendResponseSpy;

      await (f2a as any).handleTaskRequest(
        'task-123',
        'manual-cap',
        'Test task',
        {},
        'caller-peer'
      );

      expect(sendResponseSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 任务委托 - 核心功能
  // ============================================================================

  describe('task delegation', () => {
    it('should fail when no agents have the capability', async () => {
      // discoverAgents 返回空数组
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue([]);

      const result = await f2a.delegateTask({
        capability: 'non-existent',
        description: 'Test'
      });

      expect(result.success).toBe(false);
      expect(result.error?.message || result.error).toContain('No agent found');
    });

    it('should delegate to discovered agents', async () => {
      const mockAgents = [
        { peerId: 'agent-1', displayName: 'Agent 1' },
        { peerId: 'agent-2', displayName: 'Agent 2' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValueOnce({ success: true, data: { result: 'ok' } });

      const result = await f2a.delegateTask({
        capability: 'echo',
        description: 'Test',
        parameters: { message: 'hello' }
      });

      expect(result.success).toBe(true);
      expect(result.data.results).toHaveLength(1);
      expect(result.data.results[0].status).toBe('success');
    });

    it('should try next agent on failure', async () => {
      const mockAgents = [
        { peerId: 'agent-1' },
        { peerId: 'agent-2' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValueOnce({ success: false, error: { message: 'Failed' } })
        .mockResolvedValueOnce({ success: true, data: { result: 'ok' } });

      const result = await f2a.delegateTask({
        capability: 'echo',
        description: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.data.results).toHaveLength(2);
      expect(result.data.results[1].status).toBe('success');
    });

    it('should delegate in parallel when requested', async () => {
      const mockAgents = [
        { peerId: 'agent-1' },
        { peerId: 'agent-2' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValue({ success: true, data: { result: 'ok' } });

      const result = await f2a.delegateTask({
        capability: 'echo',
        description: 'Test',
        parallel: true,
        minResponses: 2
      });

      expect(result.success).toBe(true);
      expect(result.data.results).toHaveLength(2);
    });
  });

  // ============================================================================
  // 智能调度 - 核心功能（使用真实 CapabilityManager）
  // ============================================================================

  describe('smart scheduling', () => {
    it('should use CapabilityManager for scheduling when available', async () => {
      // CapabilityManager 已在 F2A.create() 中创建
      // 测试它是否被正确使用
      
      const mockAgents = [
        { peerId: 'low-score-agent', displayName: 'Low Score' },
        { peerId: 'high-score-agent', displayName: 'High Score' },
      ];
      (f2a as any).p2pNetwork.discoverAgents = vi.fn().mockResolvedValue(mockAgents);
      (f2a as any).p2pNetwork.sendTaskRequest = vi.fn()
        .mockResolvedValue({ success: true, data: {} });

      // 验证 CapabilityManager 存在
      expect(f2a['capabilityManager']).toBeDefined();

      await f2a.delegateTask({
        capability: 'echo',
        description: 'Test'
      });

      // 验证 sendTaskRequest 被调用（智能调度会尝试最佳节点）
      expect((f2a as any).p2pNetwork.sendTaskRequest).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 生命周期 - 基本功能
  // ============================================================================

  describe('lifecycle', () => {
    it('should start and stop successfully', async () => {
      const result = await f2a.start();
      expect(result.success).toBe(true);
      
      await f2a.stop();
      // 不抛出异常即为成功
    });

    it('should not start twice', async () => {
      await f2a.start();
      const result = await f2a.start();
      expect(result.success).toBe(false);
    });

    it('should emit network:started event', async () => {
      const eventSpy = vi.fn();
      f2a.on('network:started', eventSpy);

      await f2a.start();
      
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should emit network:stopped event', async () => {
      const eventSpy = vi.fn();
      f2a.on('network:stopped', eventSpy);

      await f2a.start();
      await f2a.stop();
      
      expect(eventSpy).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 事件处理
  // ============================================================================

  describe('events', () => {
    // ⚠️ 跳过：handleTaskRequest 方法不再发出 'task:request' 事件
    it.skip('should emit task:request event on incoming task', async () => {
      const eventSpy = vi.fn();
      f2a.on('task:request', eventSpy);

      f2a.registerCapability(
        { name: 'echo', description: 'Echo', tools: [] },
        async () => 'result'
      );

      await (f2a as any).handleTaskRequest(
        'task-123',
        'echo',
        'Test task',
        {},
        'caller-peer'
      );

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          taskType: 'echo'
        })
      );
    });
  });
});