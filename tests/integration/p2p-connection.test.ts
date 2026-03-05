/**
 * P2P 连接集成测试
 * 测试节点之间的连接建立和发现
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// 只在集成测试环境运行
const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.skipIf(!shouldRun)('P2P 连接集成测试', () => {
  const bootstrapAddr = process.env.TEST_BOOTSTRAP_ADDR || 'http://bootstrap.f2a.local:9001';
  const nodeCount = parseInt(process.env.TEST_NODE_COUNT || '3');
  const testToken = process.env.TEST_TOKEN || 'test-token-integration';

  describe('节点启动和健康检查', () => {
    it('引导节点应该健康运行', async () => {
      const response = await fetch(`${bootstrapAddr}/health`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      expect(response.ok).toBe(true);
    });

    it('引导节点应该有正确的 Peer ID', async () => {
      const response = await fetch(`${bootstrapAddr}/status`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      const status = await response.json();
      expect(status.peerId).toBeDefined();
      expect(status.peerId.length).toBeGreaterThan(10);
    });
  });

  describe('节点发现', () => {
    it('引导节点应该发现所有节点', async () => {
      // 等待节点完成发现
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const response = await fetch(`${bootstrapAddr}/peers`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      const peers = await response.json();
      expect(peers.length).toBeGreaterThanOrEqual(nodeCount);
    });

    it('节点应该知道引导节点的地址', async () => {
      // 这个测试验证节点是否正确配置了引导节点
      const response = await fetch(`${bootstrapAddr}/status`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      const status = await response.json();
      expect(status.multiaddrs).toBeDefined();
      expect(status.multiaddrs.length).toBeGreaterThan(0);
    });
  });

  describe('网络拓扑', () => {
    it('所有节点应该在同一个网络中', async () => {
      const response = await fetch(`${bootstrapAddr}/peers`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });
      
      const peers = await response.json();
      
      // 验证所有节点都有有效的 Peer ID
      for (const peer of peers) {
        expect(peer.peerId).toBeDefined();
        expect(peer.connected).toBe(true);
      }
    });
  });
});