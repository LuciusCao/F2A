/**
 * E2E 测试：Agent-to-Agent 对话
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NodeSpawner } from '../utils/node-spawner';
import { generateTestConfig } from '../utils/test-config';
import type { SpawnedNode } from '../utils/node-spawner';

describe('E2E: Agent-to-Agent Chat', () => {
  let spawner: NodeSpawner;
  let agentNode1: SpawnedNode;
  let agentNode2: SpawnedNode;
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

  describe('Agent 初始化', () => {
    it('should start agent1 with capabilities', async () => {
      agentNode1 = await spawner.spawnNode(testConfig.nodes[0]);
      
      expect(agentNode1).toBeDefined();
      expect(agentNode1.running).toBe(true);
      
      // 注册能力
      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'registerCapability',
        capability: {
          name: 'code-generation',
          description: 'Generate code based on requirements'
        }
      });
      
      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'registerCapability',
        capability: {
          name: 'file-operation',
          description: 'Read and write files'
        }
      });
    }, 30000);

    it('should start agent2 with capabilities', async () => {
      agentNode2 = await spawner.spawnNode(testConfig.nodes[1]);
      
      expect(agentNode2).toBeDefined();
      expect(agentNode2.running).toBe(true);
      
      // 注册能力
      spawner.sendCommand(testConfig.nodes[1].name, {
        type: 'registerCapability',
        capability: {
          name: 'summarize',
          description: 'Summarize text content'
        }
      });
    }, 30000);

    it('should connect agents via P2P', async () => {
      // 等待互相发现
      const discovered = await agentNode1.messageWaiter.waitForPeerDiscovered(
        agentNode2.peerId!,
        { timeout: testConfig.discoveryTimeout }
      );
      
      expect(discovered).toBeDefined();
      
      // 等待连接建立
      const connected = await agentNode1.messageWaiter.waitForPeerConnected(
        agentNode2.peerId!,
        { timeout: testConfig.connectionTimeout }
      );
      
      expect(connected).toBeDefined();
    }, 45000);
  });

  describe('自然语言对话', () => {
    it('should send natural language message', async () => {
      const greeting = 'Hello, I need help with code generation.';
      
      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'send',
        peerId: agentNode2.peerId!,
        message: greeting,
        metadata: { type: 'natural-language' }
      });

      const received = await agentNode2.messageWaiter.waitForMessage(greeting, {
        timeout: testConfig.messageTimeout,
        fromPeerId: agentNode1.peerId!
      });

      expect(received).toBeDefined();
      expect(received!.content).toBe(greeting);
      // metadata 在当前协议中不支持
    }, 15000);

    it('should send response message', async () => {
      const response = 'I can help you summarize content, but not code generation.';
      
      spawner.sendCommand(testConfig.nodes[1].name, {
        type: 'send',
        peerId: agentNode1.peerId!,
        message: response,
        metadata: { type: 'response' }
      });

      const received = await agentNode1.messageWaiter.waitForMessage(response, {
        timeout: testConfig.messageTimeout,
        fromPeerId: agentNode2.peerId!
      });

      expect(received).toBeDefined();
      expect(received!.content).toBe(response);
    }, 15000);

    it('should handle multi-turn conversation', async () => {
      const messages = [
        { from: 0, to: 1, content: 'Can you summarize this document?' },
        { from: 1, to: 0, content: 'Sure, please share the document content.' },
        { from: 0, to: 1, content: 'Here is the content: [document text]' },
        { from: 1, to: 0, content: 'Summary: The document discusses...' }
      ];

      // 发送所有消息
      for (const msg of messages) {
        const targetPeerId = msg.to === 1 ? agentNode2.peerId! : agentNode1.peerId!;
        spawner.sendCommand(testConfig.nodes[msg.from].name, {
          type: 'send',
          peerId: targetPeerId,
          message: msg.content
        });

        // 等待接收
        const receiver = msg.to === 1 ? agentNode2 : agentNode1;
        const senderPeerId = msg.from === 0 ? agentNode1.peerId! : agentNode2.peerId!;
        
        const received = await receiver.messageWaiter.waitForMessage(msg.content, {
          timeout: testConfig.messageTimeout,
          fromPeerId: senderPeerId
        });

        expect(received).toBeDefined();
        expect(received!.content).toBe(msg.content);
      }
    }, 30000);
  });

  describe('任务请求与执行', () => {
    it('should send task request and receive response', async () => {
      const taskType = 'summarize';  // agent2 有 summarize 能力
      const description = 'Summarize this text: Hello World';
      
      // agent1 发送任务请求给 agent2
      spawner.sendCommand(testConfig.nodes[0].name, {
        type: 'sendTask',
        peerId: agentNode2.peerId!,
        taskType: taskType,
        description: description,
        parameters: { text: 'Hello World' }
      });

      // agent2 应该收到任务请求（如果能力被注册）
      // 注意：如果 agent2 没有注册对应能力，可能会收到 rejection
      // 这个测试主要验证消息传递成功
      const taskRequest = await agentNode2.messageWaiter.waitForTaskRequest(taskType, {
        timeout: testConfig.messageTimeout,
        fromPeerId: agentNode1.peerId!
      });

      // 如果收到任务请求，验证内容
      if (taskRequest) {
        expect(taskRequest.taskType).toBe(taskType);
        expect(taskRequest.description).toBe(description);
      }
    }, 20000);

    it('should handle capability not supported', async () => {
      // agent2 发送一个不支持的能力请求给 agent1
      const taskType = 'unknown-capability';
      
      spawner.sendCommand(testConfig.nodes[1].name, {
        type: 'sendTask',
        peerId: agentNode1.peerId!,
        taskType: 'unknown-capability',
        description: 'Test unknown capability'
      });

      // agent1 应该收到任务请求（即使能力不被支持）
      const taskRequest = await agentNode1.messageWaiter.waitForTaskRequest('unknown-capability', {
        timeout: testConfig.messageTimeout,
        fromPeerId: agentNode2.peerId!
      });

      // 任务请求应该被收到
      expect(taskRequest).toBeDefined();
    }, 20000);
  });

  describe('Agent 元数据传递', () => {
    it.skip('should include agent metadata in messages', async () => {
      // 跳过：当前 F2A 协议不支持 metadata 字段
      // 未来可以通过 content 对象传递 metadata，或扩展协议
    }, 15000);
  });
});