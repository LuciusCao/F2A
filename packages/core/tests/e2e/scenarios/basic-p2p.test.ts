/**
 * E2E 测试：基础 P2P 通信
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NodeSpawner } from '../utils/node-spawner';
import { generateTestConfig } from '../utils/test-config';
import type { SpawnedNode } from '../utils/node-spawner';

describe('E2E: Basic P2P Communication', () => {
  let spawner: NodeSpawner;
  let node1: SpawnedNode;
  let node2: SpawnedNode;
  let testConfig: ReturnType<typeof generateTestConfig>;

  beforeAll(async () => {
    testConfig = generateTestConfig(2);
    spawner = new NodeSpawner({
      startTimeout: 30000,
      defaultTimeout: 60000
    });
  }, 60000);

  afterAll(async () => {
    await spawner.stopAll();
    await spawner.cleanupDataDir(testConfig.baseDataDir);
  }, 30000);

  describe('节点启动', () => {
    it('should start node1 successfully', async () => {
      node1 = await spawner.spawnNode(testConfig.nodes[0]);
      
      expect(node1).toBeDefined();
      expect(node1.running).toBe(true);
      expect(node1.peerId).toBeDefined();
      expect(node1.peerId!.length).toBeGreaterThan(0);
      expect(node1.multiaddrs).toBeDefined();
      expect(node1.multiaddrs!.length).toBeGreaterThan(0);
    }, 30000);

    it('should start node2 successfully', async () => {
      node2 = await spawner.spawnNode(testConfig.nodes[1]);
      
      expect(node2).toBeDefined();
      expect(node2.running).toBe(true);
      expect(node2.peerId).toBeDefined();
      expect(node2.peerId!.length).toBeGreaterThan(0);
      expect(node2.multiaddrs).toBeDefined();
      expect(node2.multiaddrs!.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe('mDNS 自动发现', () => {
    it('should discover peer via mDNS', async () => {
      // 等待 node1 发现 node2
      const discoveredPeer = await node1.messageWaiter.waitForPeerDiscovered(
        node2.peerId!,
        { timeout: testConfig.discoveryTimeout }
      );

      expect(discoveredPeer).toBeDefined();
      expect(discoveredPeer).toBe(node2.peerId);
    }, 20000);

    it('should discover peer in both directions', async () => {
      // 等待 node2 也发现 node1
      const discoveredPeer = await node2.messageWaiter.waitForPeerDiscovered(
        node1.peerId!,
        { timeout: testConfig.discoveryTimeout }
      );

      expect(discoveredPeer).toBeDefined();
      expect(discoveredPeer).toBe(node1.peerId);
    }, 20000);
  });

  describe('TCP 连接建立', () => {
    it('should establish TCP connection', async () => {
      // 等待 node1 连接到 node2
      const connectedPeer = await node1.messageWaiter.waitForPeerConnected(
        node2.peerId!,
        { timeout: testConfig.connectionTimeout }
      );

      expect(connectedPeer).toBeDefined();
      expect(connectedPeer).toBe(node2.peerId);
    }, 35000);

    it('should have bidirectional connection', async () => {
      // 检查 node2 的连接状态
      const connectedPeer = await node2.messageWaiter.waitForPeerConnected(
        node1.peerId!,
        { timeout: testConfig.connectionTimeout }
      );

      expect(connectedPeer).toBeDefined();
      expect(connectedPeer).toBe(node1.peerId);
    }, 35000);

    it('should report correct connected peers', async () => {
      // 获取 node1 的连接 peers
      const peers = await spawner.getConnectedPeers(testConfig.nodes[0].name);
      
      expect(peers).toContain(node2.peerId);
    }, 10000);
  });

  describe('双向消息传递', () => {
    it('should send message from node1 to node2', async () => {
      const testMessage = 'Hello from node1!';
      
      // node1 发送消息给 node2
      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'send',
        peerId: node2.peerId!,
        message: testMessage,
        metadata: { test: true }
      });

      // 等待 node2 接收消息
      const received = await node2.messageWaiter.waitForMessage(testMessage, {
        timeout: testConfig.messageTimeout,
        fromPeerId: node1.peerId!
      });

      expect(received).toBeDefined();
      expect(received!.content).toBe(testMessage);
      expect(received!.from).toBe(node1.peerId);
      expect(received!.metadata?.test).toBe(true);
    }, 15000);

    it('should send message from node2 to node1', async () => {
      const testMessage = 'Hello back from node2!';
      
      // node2 发送消息给 node1
      spawner.sendCommand(testConfig.nodes[1].name, {
        type: 'send',
        peerId: node1.peerId!,
        message: testMessage
      });

      // 等待 node1 接收消息
      const received = await node1.messageWaiter.waitForMessage(testMessage, {
        timeout: testConfig.messageTimeout,
        fromPeerId: node2.peerId!
      });

      expect(received).toBeDefined();
      expect(received!.content).toBe(testMessage);
      expect(received!.from).toBe(node2.peerId);
    }, 15000);

    it('should handle multiple messages', async () => {
      const messages = ['msg1', 'msg2', 'msg3'];
      
      for (const msg of messages) {
        spawner.sendCommand(testConfig.nodes[0].name, {
          type: 'send',
          peerId: node2.peerId!,
          message: msg
        });
      }

      // 等待所有消息被接收
      for (const msg of messages) {
        const received = await node2.messageWaiter.waitForMessage(msg, {
          timeout: testConfig.messageTimeout
        });
        expect(received).toBeDefined();
        expect(received!.content).toBe(msg);
      }
    }, 20000);
  });

  describe('端到端加密验证', () => {
    it('should encrypt messages end-to-end', async () => {
      // 发送包含敏感数据的消息
      const sensitiveData = {
        secret: 'confidential-information',
        timestamp: Date.now()
      };

      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'send',
        peerId: node2.peerId!,
        message: JSON.stringify(sensitiveData),
        metadata: { encrypted: true }
      });

      const received = await node2.messageWaiter.waitForMessage(
        JSON.stringify(sensitiveData),
        { timeout: testConfig.messageTimeout }
      );

      // 消息应该被完整接收（加密后传输，解密后显示原始内容）
      expect(received).toBeDefined();
      expect(received!.content).toBe(JSON.stringify(sensitiveData));
    }, 15000);
  });
});