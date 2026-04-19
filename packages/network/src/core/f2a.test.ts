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
import { AgentCapability } from '../types/index.js';

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
    on: vi.fn(),
    setIdentityManager: vi.fn(),
    setAgentRegistry: vi.fn()
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
});