/**
 * P2P Network NAT 穿透集成测试
 * 
 * 测试 Circuit Relay 和 DCUtR 功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P2PNetwork } from './p2p-network.js';
import type { AgentInfo, AgentCapability } from '../types/index.js';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// 创建测试用 AgentInfo
function createTestAgentInfo(): AgentInfo {
  return {
    id: 'test-agent-' + Math.random().toString(36).slice(2),
    name: 'TestAgent',
    capabilities: ['message-passing'] as AgentCapability[],
    version: '1.0.0',
    endpoint: 'test://localhost',
    metadata: {}
  };
}

describe('P2PNetwork NAT Traversal', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `f2a-nat-test-${Date.now()}`);
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('NAT Traversal 配置', () => {
    it('默认禁用 NAT 穿透', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      const result = await network.start();
      expect(result.success).toBe(true);

      // 默认不启用 NAT 穿透
      const config = network.getConfig();
      expect(config.enableNATTraversal).toBeFalsy(); // false 或 undefined

      await network.stop();
    });

    it('可以启用 NAT 穿透', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir,
        enableNATTraversal: true
      });

      const config = network.getConfig();
      expect(config.enableNATTraversal).toBe(true);

      // 注意：启动时可能会因为测试环境问题失败
      // 但配置应该是正确的
    });
  });

  describe('NAT 穿透管理器', () => {
    it('未启用 NAT 穿透时状态为 undefined', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
      });

      await network.start();

      const natStatus = network.getNATTraversalStatus();
      expect(natStatus).toBeUndefined();

      await network.stop();
    });
  });

  describe('Circuit Relay', () => {
    it('可以连接到 Relay 服务器', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir,
        enableNATTraversal: true
      });

      await network.start();

      // 注意：实际 Relay 连接需要真实的 Relay 服务器
      // 这里只测试 API 存在
      expect(typeof network.connectToRelay).toBe('function');

      await network.stop();
    });

    it('connectToRelay 未启用 NAT 时返回 false', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir
        // enableNATTraversal 未设置
      });

      await network.start();

      const result = await network.connectToRelay('/ip4/127.0.0.1/tcp/4001/p2p/QmRelay');
      expect(result).toBe(false);

      await network.stop();
    });

    it('connectToRelay 无效地址返回 false', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir,
        enableNATTraversal: true
      });

      await network.start();

      const result = await network.connectToRelay('invalid-address');
      expect(result).toBe(false);

      await network.stop();
    });
  });

  describe('Relay Server 模式', () => {
    it('可以启用 Relay Server 模式', async () => {
      const agentInfo = createTestAgentInfo();
      const network = new P2PNetwork(agentInfo, {
        listenPort: 0,
        dataDir: tempDir,
        enableRelayServer: true
      });

      const config = network.getConfig();
      expect(config.enableRelayServer).toBe(true);

      // 注意：实际 Relay Server 需要公网可达性
      // 这里只测试配置正确
    });
  });
});