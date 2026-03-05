/**
 * 多节点压力测试
 * 测试多节点场景下的性能和稳定性
 */

import { describe, it, expect, beforeAll } from 'vitest';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';

describe.skipIf(!shouldRun)('多节点压力测试', () => {
  const bootstrapAddr = process.env.TEST_BOOTSTRAP_ADDR || 'http://bootstrap.f2a.local:9001';
  const nodeCount = parseInt(process.env.TEST_NODE_COUNT || '3');
  const testToken = process.env.TEST_TOKEN || 'test-token-integration';

  beforeAll(async () => {
    // 等待所有节点就绪
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  describe('并发请求', () => {
    it('应该能同时处理多个请求', async () => {
      const requestCount = 10;
      const requests = [];

      for (let i = 0; i < requestCount; i++) {
        requests.push(
          fetch(`${bootstrapAddr}/status`, {
            headers: { 'Authorization': `Bearer ${testToken}` }
          }).then(r => ({ ok: r.ok, index: i }))
        );
      }

      const results = await Promise.all(requests);
      const successCount = results.filter(r => r.ok).length;

      expect(successCount).toBe(requestCount);
    }, 30000); // 30 秒超时
  });

  describe('节点负载', () => {
    it('节点连接数应该在合理范围内', async () => {
      const response = await fetch(`${bootstrapAddr}/peers`, {
        headers: { 'Authorization': `Bearer ${testToken}` }
      });

      const peers = await response.json();
      
      // 连接数应该等于节点数（每个节点连接到引导节点）
      expect(peers.length).toBeLessThanOrEqual(nodeCount + 5); // 允许一些额外连接
      expect(peers.length).toBeGreaterThanOrEqual(nodeCount - 1); // 允许少量节点未连接
    });
  });

  describe('稳定性', () => {
    it('连续请求应该都能成功', async () => {
      const requestCount = 5;
      
      for (let i = 0; i < requestCount; i++) {
        const response = await fetch(`${bootstrapAddr}/health`, {
          headers: { 'Authorization': `Bearer ${testToken}` }
        });
        
        expect(response.ok).toBe(true);
        
        // 短暂延迟
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    });

    it('节点状态应该一致', async () => {
      // 多次获取状态，验证一致性
      const responses = await Promise.all([
        fetch(`${bootstrapAddr}/status`, {
          headers: { 'Authorization': `Bearer ${testToken}` }
        }).then(r => r.json()),
        fetch(`${bootstrapAddr}/status`, {
          headers: { 'Authorization': `Bearer ${testToken}` }
        }).then(r => r.json())
      ]);

      // peerId 应该一致
      expect(responses[0].peerId).toBe(responses[1].peerId);
    });
  });
});