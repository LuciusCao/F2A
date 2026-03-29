/**
 * E2E 测试：多节点网络
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NodeSpawner } from '../utils/node-spawner';
import { generateTestConfig } from '../utils/test-config';
import type { SpawnedNode } from '../utils/node-spawner';

describe('E2E: Multi-Node Network', () => {
  let spawner: NodeSpawner;
  let nodes: SpawnedNode[] = [];
  let testConfig: ReturnType<typeof generateTestConfig>;

  beforeAll(async () => {
    // 创建 3 个节点
    testConfig = generateTestConfig(3);
    spawner = new NodeSpawner({
      startTimeout: 30000,
      defaultTimeout: 60000
    });
  }, 60000);

  afterAll(async () => {
    await spawner.stopAll();
    await spawner.cleanupDataDir(testConfig.baseDataDir);
  }, 30000);

  describe('3+ 节点组网', () => {
    it('should start all 3 nodes', async () => {
      for (const config of testConfig.nodes) {
        const node = await spawner.spawnNode(config);
        nodes.push(node);
        
        expect(node).toBeDefined();
        expect(node.running).toBe(true);
        expect(node.peerId).toBeDefined();
        expect(node.peerId!.length).toBeGreaterThan(0);
      }
      
      expect(nodes.length).toBe(3);
    }, 90000);

    it('should discover all peers via mDNS', async () => {
      // 等待每个节点发现其他两个节点
      for (let i = 0; i < nodes.length; i++) {
        const currentNode = nodes[i];
        const otherNodes = nodes.filter((_, idx) => idx !== i);
        
        for (const otherNode of otherNodes) {
          const discovered = await currentNode.messageWaiter.waitForPeerDiscovered(
            otherNode.peerId!,
            { timeout: testConfig.discoveryTimeout * 2 }
          );
          
          expect(discovered).toBeDefined();
          expect(discovered).toBe(otherNode.peerId);
        }
      }
    }, 40000);

    it('should establish connections to all peers', async () => {
      // 等待每个节点连接到其他节点
      for (let i = 0; i < nodes.length; i++) {
        const currentNode = nodes[i];
        const otherNodes = nodes.filter((_, idx) => idx !== i);
        
        for (const otherNode of otherNodes) {
          const connected = await currentNode.messageWaiter.waitForPeerConnected(
            otherNode.peerId!,
            { timeout: testConfig.connectionTimeout * 2 }
          );
          
          expect(connected).toBeDefined();
        }
      }
    }, 70000);

    it('should have correct peer count for each node', async () => {
      for (let i = 0; i < nodes.length; i++) {
        const peers = await spawner.getConnectedPeers(testConfig.nodes[i].name);
        expect(peers.length).toBeGreaterThanOrEqual(2);
      }
    }, 15000);
  });

  describe('广播消息', () => {
    it('should broadcast message to all connected peers', async () => {
      const broadcastMessage = 'Broadcast test from node0!';
      const sender = nodes[0];
      const receivers = nodes.slice(1);
      
      // 发送者向所有接收者发送消息
      for (const receiver of receivers) {
        spawner.sendCommand(testConfig.nodes[0].name, {
          type: 'send',
          peerId: receiver.peerId!,
          message: broadcastMessage
        });
      }

      // 等待所有接收者收到消息
      for (const receiver of receivers) {
        const received = await receiver.messageWaiter.waitForMessage(broadcastMessage, {
          timeout: testConfig.messageTimeout,
          fromPeerId: sender.peerId!
        });
        
        expect(received).toBeDefined();
        expect(received!.content).toBe(broadcastMessage);
        expect(received!.from).toBe(sender.peerId);
      }
    }, 25000);

    it('should handle broadcast from each node', async () => {
      // 每个节点都广播一条消息
      for (let i = 0; i < nodes.length; i++) {
        const sender = nodes[i];
        const message = `Broadcast from node${i}!`;
        const receivers = nodes.filter((_, idx) => idx !== i);
        
        // 发送消息
        for (const receiver of receivers) {
          spawner.sendCommand(testConfig.nodes[i].name, {
            type: 'send',
            peerId: receiver.peerId!,
            message: message
          });
        }

        // 等待接收
        for (const receiver of receivers) {
          const received = await receiver.messageWaiter.waitForMessage(message, {
            timeout: testConfig.messageTimeout,
            fromPeerId: sender.peerId!
          });
          
          expect(received).toBeDefined();
        }
      }
    }, 50000);
  });

  describe('消息路由', () => {
    it('should route message through connected peers', async () => {
      // node0 发送消息给 node1
      const message = 'Routing test message';
      
      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'send',
        peerId: nodes[1].peerId!,
        message: message
      });

      // node1 应该收到消息
      const received = await nodes[1].messageWaiter.waitForMessage(message, {
        timeout: testConfig.messageTimeout,
        fromPeerId: nodes[0].peerId!
      });

      expect(received).toBeDefined();
      expect(received!.content).toBe(message);
    }, 15000);

    it('should handle concurrent messages', async () => {
      // 多个节点同时发送消息
      const messages = [
        { from: 0, to: 1, content: 'msg-0-to-1' },
        { from: 1, to: 2, content: 'msg-1-to-2' },
        { from: 2, to: 0, content: 'msg-2-to-0' }
      ];

      // 发送所有消息
      for (const msg of messages) {
        spawner.sendCommand(testConfig.nodes[msg.from].name, {
          type: 'send',
          peerId: nodes[msg.to].peerId!,
          message: msg.content
        });
      }

      // 等待所有消息被接收
      for (const msg of messages) {
        const receiver = nodes[msg.to];
        const received = await receiver.messageWaiter.waitForMessage(msg.content, {
          timeout: testConfig.messageTimeout,
          fromPeerId: nodes[msg.from].peerId!
        });

        expect(received).toBeDefined();
        expect(received!.content).toBe(msg.content);
      }
    }, 20000);
  });

  describe('节点动态离开', () => {
    it('should handle node leaving gracefully', async () => {
      // 停止 node2
      await spawner.stopNode(testConfig.nodes[2].name);
      
      // node0 和 node1 应该仍然互相连接
      const peers0 = await spawner.getConnectedPeers(testConfig.nodes[0].name);
      const peers1 = await spawner.getConnectedPeers(testConfig.nodes[1].name);
      
      // node0 和 node1 应该仍然互相连接
      expect(peers0).toContain(nodes[1].peerId);
      expect(peers1).toContain(nodes[0].peerId);
    }, 20000);

    it('should still communicate after one node leaves', async () => {
      const message = 'Still connected!';
      
      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'send',
        peerId: nodes[1].peerId!,
        message: message
      });

      const received = await nodes[1].messageWaiter.waitForMessage(message, {
        timeout: testConfig.messageTimeout,
        fromPeerId: nodes[0].peerId!
      });

      expect(received).toBeDefined();
      expect(received!.content).toBe(message);
    }, 15000);
  });
});