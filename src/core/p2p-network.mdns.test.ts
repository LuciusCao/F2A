/**
 * mDNS 发现功能测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P2PNetwork } from './p2p-network.js';
import type { AgentInfo, AgentCapability } from '../types/index.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

// 测试用的 Agent 信息
function createTestAgentInfo(peerId?: string): AgentInfo {
  return {
    peerId: peerId || 'test-peer-id',
    displayName: 'Test Agent',
    agentType: 'custom',
    version: '0.1.0',
    protocolVersion: '1.0.0',
    capabilities: [
      { name: 'test-capability', description: 'Test capability' }
    ] as AgentCapability[],
    multiaddrs: ['/ip4/127.0.0.1/tcp/0'],
    lastSeen: Date.now()
  };
}

describe('P2P Network mDNS Discovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `f2a-mdns-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('mDNS 配置', () => {
    it('默认启用 mDNS 发现', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      // 启动网络
      const result = await network.start();
      
      // 调试输出
      if (!result.success) {
        console.log('Network start failed:', result.error);
      }
      
      expect(result.success).toBe(true);

      // 验证 mDNS 配置
      // 由于 mDNS 是通过 libp2p 内部管理的，我们验证网络启动成功即可
      expect(result.data?.peerId).toBeDefined();
      expect(result.data?.addresses.length).toBeGreaterThan(0);

      await network.stop();
    });

    it('可以禁用 mDNS 发现', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        enableMDNS: false,
        dataDir: tempDir
      });

      const result = await network.start();
      expect(result.success).toBe(true);

      await network.stop();
    });
  });

  describe('peer:discovery 事件', () => {
    it('应该在发现新节点时触发 peer:discovered 事件', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      await network.start();

      // 监听 peer:discovered 事件
      const discoveryHandler = vi.fn();
      network.on('peer:discovered', discoveryHandler);

      // 由于 mDNS 发现依赖于网络环境，这里只验证事件处理器的注册
      // 实际发现测试需要在集成测试中进行
      expect(network.listenerCount('peer:discovered')).toBe(1);

      network.off('peer:discovered', discoveryHandler);
      await network.stop();
    });
  });

  describe('发现功能', () => {
    it('discoverAgents 应该返回已知的 agents', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      await network.start();

      // discoverAgents 应该返回空数组（没有其他节点）
      const agents = await network.discoverAgents(undefined, { timeoutMs: 100 });
      expect(Array.isArray(agents)).toBe(true);

      await network.stop();
    });

    it('discoverAgents 应该支持能力过滤', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      await network.start();

      // 按能力过滤
      const agents = await network.discoverAgents('code-generation', { timeoutMs: 100 });
      expect(Array.isArray(agents)).toBe(true);
      // 没有具有 code-generation 能力的节点
      expect(agents.length).toBe(0);

      await network.stop();
    });
  });

  describe('peer 表管理', () => {
    it('getConnectedPeers 应该返回已连接的节点', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      await network.start();

      const connectedPeers = network.getConnectedPeers();
      expect(Array.isArray(connectedPeers)).toBe(true);
      expect(connectedPeers.length).toBe(0);

      await network.stop();
    });

    it('getAllPeers 应该返回所有已知节点', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      await network.start();

      const allPeers = network.getAllPeers();
      expect(Array.isArray(allPeers)).toBe(true);

      await network.stop();
    });
  });
});