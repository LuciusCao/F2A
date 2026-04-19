/**
 * P2PNetwork 边缘情况和高价值测试
 * 专注于：错误处理、边界条件、并发场景、安全验证
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { P2PNetwork } from './p2p-network.js';
import { AgentInfo, F2AMessage } from '../types/index.js';
import { E2EECrypto } from './e2ee-crypto.js';

describe('P2PNetwork - 高价值边缘情况', () => {
  let network: P2PNetwork;
  let mockAgentInfo: AgentInfo;

  beforeEach(() => {
    mockAgentInfo = {
      peerId: 'test-agent',
      displayName: 'Test Agent',
      agentType: 'openclaw',
      version: '1.0.0',
      capabilities: [],
      protocolVersion: 'f2a/1.0',
      lastSeen: Date.now(),
      multiaddrs: []
    };
    network = new P2PNetwork(mockAgentInfo);
  });

  afterEach(async () => {
    await network.stop();
    vi.clearAllMocks();
  });

  // ========== 1. 加密消息处理 - 安全关键路径 ==========
  describe('加密消息处理 (handleEncryptedMessage)', () => {
    it('应该拒绝解密失败的消息并发送失败响应', async () => {
      const mockCrypto = {
        decrypt: vi.fn().mockReturnValue(null), // 解密失败
        canEncryptTo: vi.fn().mockReturnValue(true),
        encrypt: vi.fn(),
        registerPeerPublicKey: vi.fn(),
        getPeerPublicKey: vi.fn()
      };
      (network as any).e2eeCrypto = mockCrypto;

      const sendSpy = vi.spyOn(network as any, 'sendMessage').mockResolvedValue({ success: true, data: undefined });

      const encryptedMessage: F2AMessage = {
        id: 'msg-1',
        type: 'TASK_REQUEST',
        from: 'peer-1',
        to: 'test-agent',
        timestamp: Date.now(),
        encrypted: true,
        payload: {
          iv: 'fake-iv',
          ciphertext: 'fake-ciphertext',
          senderPublicKey: 'fake-public-key'
        } as any
      };

      await (network as any).handleEncryptedMessage(encryptedMessage, 'peer-1');

      // 验证发送了解密失败响应
      expect(sendSpy).toHaveBeenCalledWith(
        'peer-1',
        expect.objectContaining({
          type: 'DECRYPT_FAILED',
          payload: expect.objectContaining({
            originalMessageId: 'msg-1',
            error: 'DECRYPTION_FAILED'
          })
        }),
        false
      );
    });

    it('应该拒绝公钥不匹配的加密消息（身份伪造检测）', async () => {
      const mockCrypto = {
        decrypt: vi.fn().mockReturnValue(JSON.stringify({ from: 'peer-1', type: 'TASK_REQUEST' })),
        getPeerPublicKey: vi.fn().mockReturnValue('different-public-key'), // 已注册的公钥不匹配
        canEncryptTo: vi.fn(),
        encrypt: vi.fn(),
        registerPeerPublicKey: vi.fn()
      };
      (network as any).e2eeCrypto = mockCrypto;
      (network as any).logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

      const encryptedMessage: F2AMessage = {
        id: 'msg-2',
        type: 'TASK_REQUEST',
        from: 'peer-1',
        timestamp: Date.now(),
        encrypted: true,
        payload: {
          iv: 'fake-iv',
          ciphertext: 'fake-ciphertext',
          senderPublicKey: 'attacker-public-key' // 攻击者的公钥
        } as any
      };

      const result = await (network as any).handleEncryptedMessage(encryptedMessage, 'peer-1');

      // 应该拒绝处理（action='return'）
      expect(result.action).toBe('return');
      expect(mockCrypto.getPeerPublicKey).toHaveBeenCalledWith('peer-1');
    });

    it('应该拒绝 from 字段与发送方 peerId 不匹配的消息', async () => {
      const mockCrypto = {
        decrypt: vi.fn().mockReturnValue(JSON.stringify({ from: 'impersonator', type: 'TASK_REQUEST' })),
        getPeerPublicKey: vi.fn().mockReturnValue(null), // 没有已注册的公钥
        canEncryptTo: vi.fn(),
        encrypt: vi.fn(),
        registerPeerPublicKey: vi.fn()
      };
      (network as any).e2eeCrypto = mockCrypto;
      (network as any).logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

      const encryptedMessage: F2AMessage = {
        id: 'msg-3',
        type: 'TASK_REQUEST',
        from: 'impersonator', // 声称是另一个 peer
        timestamp: Date.now(),
        encrypted: true,
        payload: {
          iv: 'fake-iv',
          ciphertext: 'fake-ciphertext',
          senderPublicKey: 'some-key'
        } as any
      };

      const result = await (network as any).handleEncryptedMessage(encryptedMessage, 'peer-1');

      // 应该拒绝处理
      expect(result.action).toBe('return');
    });

    it('应该接受解密成功且身份验证通过的消息', async () => {
      const validMessage = { from: 'peer-1', type: 'TASK_REQUEST', id: 'msg-4', timestamp: Date.now() };
      const mockCrypto = {
        decrypt: vi.fn().mockReturnValue(JSON.stringify(validMessage)),
        getPeerPublicKey: vi.fn().mockReturnValue('valid-public-key'),
        canEncryptTo: vi.fn(),
        encrypt: vi.fn(),
        registerPeerPublicKey: vi.fn()
      };
      (network as any).e2eeCrypto = mockCrypto;
      (network as any).logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

      const encryptedMessage: F2AMessage = {
        id: 'msg-4',
        type: 'TASK_REQUEST',
        from: 'peer-1',
        timestamp: Date.now(),
        encrypted: true,
        payload: {
          iv: 'fake-iv',
          ciphertext: 'fake-ciphertext',
          senderPublicKey: 'valid-public-key' // 与已注册的公钥匹配
        } as any
      };

      const result = await (network as any).handleEncryptedMessage(encryptedMessage, 'peer-1');

      expect(result.action).toBe('continue');
      expect(result.message).toEqual(validMessage);
    });
  });

  // ========== 2. 解密失败通知处理 ==========
  describe('handleDecryptFailedMessage', () => {
    it('应该重新注册公钥以尝试恢复加密通道', async () => {
      const mockCrypto = {
        registerPeerPublicKey: vi.fn()
      };
      (network as any).e2eeCrypto = mockCrypto;
      (network as any).logger = { error: vi.fn(), info: vi.fn() };

      // 先在 peer 表中添加带有公钥的 peer
      (network as any).peerManager.getPeerTable().set('peer-1', {
        peerId: 'peer-1',
        agentInfo: {
          ...mockAgentInfo,
          encryptionPublicKey: 'peer-1-public-key'
        },
        multiaddrs: [],
        connected: false,
        lastSeen: Date.now()
      });

      const emitSpy = vi.spyOn(network, 'emit');

      await (network as any).handleDecryptFailedMessage(
        {
          id: 'msg-5',
          type: 'DECRYPT_FAILED',
          from: 'peer-1',
          timestamp: Date.now(),
          payload: {
            originalMessageId: 'original-msg-1',
            error: 'DECRYPTION_FAILED',
            message: 'Key mismatch'
          }
        },
        'peer-1'
      );

      expect(mockCrypto.registerPeerPublicKey).toHaveBeenCalledWith('peer-1', 'peer-1-public-key');
      expect(emitSpy).toHaveBeenCalledWith('error', expect.any(Error));
    });
  });

  // ========== 3. 任务响应处理 - 竞态条件防护 ==========
  // ⚠️ 跳过：PR #111 移除了 TASK_RESPONSE 类型，改用 MESSAGE + topic
  describe.skip('handleTaskResponseMessage - 竞态条件防护', () => {
    it('应该忽略已解析任务的重复响应', async () => {
      const taskId = '00000000-0000-4000-8000-000000000001'; // 有效的 UUID
      
      // 手动添加待处理任务，初始 resolved=false
      const mockResolve = vi.fn();
      const mockReject = vi.fn();
      (network as any).pendingTasks.set(taskId, {
        resolve: mockResolve,
        reject: mockReject,
        timeout: setTimeout(() => {}, 10000),
        resolved: false
      });

      // 模拟第一个响应（正常处理）
      await (network as any).handleTaskResponseMessage({
        id: 'resp-1',
        type: 'TASK_RESPONSE',
        from: 'peer-1',
        timestamp: Date.now(),
        payload: {
          taskId,
          status: 'success',
          result: { data: 'result-1' }
        }
      });

      // 验证 resolve 被调用
      expect(mockResolve).toHaveBeenCalledWith({ data: 'result-1' });
      // 验证任务已从 pendingTasks 中删除
      expect((network as any).pendingTasks.get(taskId)).toBeUndefined();

      // 模拟第二个响应（重复，应该被忽略，因为任务已删除）
      const warnSpy = vi.spyOn((network as any).logger, 'warn');
      await (network as any).handleTaskResponseMessage({
        id: 'resp-2',
        type: 'TASK_RESPONSE',
        from: 'peer-1',
        timestamp: Date.now(),
        payload: {
          taskId,
          status: 'success',
          result: { data: 'result-2' } // 不同的结果
        }
      });

      // 应该记录警告（unknown task）并忽略
      expect(warnSpy).toHaveBeenCalled();
      const callArgs = warnSpy.mock.calls[0];
      expect(callArgs[0]).toContain('unknown task');
    });

    it('应该验证任务响应 payload 格式', async () => {
      const warnSpy = vi.spyOn((network as any).logger, 'warn');

      await (network as any).handleTaskResponseMessage({
        id: 'resp-invalid',
        type: 'TASK_RESPONSE',
        from: 'peer-1',
        timestamp: Date.now(),
        payload: {
          // 缺少必需字段
          taskId: 'task-1'
          // 缺少 status 等字段
        }
      });

      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid task response payload',
        expect.objectContaining({ errors: expect.any(Array) })
      );
    });
  });

  // ========== 4. 发现代理的 waitForFirstResponse 模式 ==========
  describe('discoverAgents - waitForFirstResponse 模式', () => {
    it('应该在收到首个匹配响应后立即返回', async () => {
      // 模拟 peer 表中有 peer
      (network as any).peerManager.getPeerTable().set('peer-1', {
        peerId: 'peer-1',
        agentInfo: {
          ...mockAgentInfo,
          peerId: 'peer-1',
          capabilities: [{ name: 'code-gen', description: 'Code Generation', tools: ['generate'] }]
        },
        multiaddrs: [],
        connected: false,
        lastSeen: Date.now()
      });

      const broadcastSpy = vi.spyOn(network as any, 'broadcast').mockResolvedValue(undefined);

      // 使用 waitForFirstResponse=true
      const discoverPromise = network.discoverAgents('code-gen', {
        timeoutMs: 5000,
        waitForFirstResponse: true
      });

      // 模拟收到 peer:discovered 事件
      setTimeout(() => {
        network.emit('peer:discovered', {
          peerId: 'peer-2',
          agentInfo: {
            ...mockAgentInfo,
            peerId: 'peer-2',
            capabilities: [{ name: 'code-gen', description: 'Code Generation', tools: ['generate'] }]
          },
          multiaddrs: []
        });
      }, 100);

      const agents = await discoverPromise;

      // 应该包含 peer-1（已有）和 peer-2（事件触发）
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(broadcastSpy).toHaveBeenCalled(); // 应该广播了能力查询
    });
  });

  // ========== 5. sendMessage 的 E2EE 加密路径 ==========
  describe('sendMessage - E2EE 加密路径', () => {
    it('应该在启用加密但没有共享密钥时拒绝发送', async () => {
      // 添加 peer 到 peerTable
      (network as any).peerManager.getPeerTable().set('peer-1', {
        peerId: 'peer-1',
        multiaddrs: ['/ip4/127.0.0.1/tcp/9001'],
        connected: false,
        lastSeen: Date.now()
      });

      // 模拟已连接（跳过 dial）
      const mockConn = {
        remotePeer: { toString: () => 'peer-1' }
      };
      (network as any).node = {
        getConnections: vi.fn().mockReturnValue([mockConn]),
        stop: vi.fn().mockResolvedValue(undefined)
      };
      (network as any).e2eeCrypto = {
        canEncryptTo: vi.fn().mockReturnValue(false)
      };
      (network as any).enableE2EE = true;

      const result = await (network as any).sendMessage('peer-1', {
        id: 'msg-1',
        type: 'TASK_REQUEST',
        from: 'test-agent',
        to: 'peer-1',
        timestamp: Date.now(),
        payload: {}
      }, true); // encrypt=true

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENCRYPTION_NOT_READY');
    });

    it('应该在加密失败时拒绝发送', async () => {
      (network as any).peerManager.getPeerTable().set('peer-2', {
        peerId: 'peer-2',
        multiaddrs: ['/ip4/127.0.0.1/tcp/9002'],
        connected: false,
        lastSeen: Date.now()
      });

      const mockConn = {
        remotePeer: { toString: () => 'peer-2' }
      };
      (network as any).node = {
        getConnections: vi.fn().mockReturnValue([mockConn]),
        stop: vi.fn().mockResolvedValue(undefined)
      };
      (network as any).e2eeCrypto = {
        canEncryptTo: vi.fn().mockReturnValue(true),
        encrypt: vi.fn().mockReturnValue(null) // 加密失败
      };
      (network as any).enableE2EE = true;

      const result = await (network as any).sendMessage('peer-2', {
        id: 'msg-2',
        type: 'TASK_REQUEST',
        from: 'test-agent',
        to: 'peer-2',
        timestamp: Date.now(),
        payload: {}
      }, true);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENCRYPTION_FAILED');
    });
  });

  // ========== 6. 消息 JSON 解析错误处理 ==========
  describe('消息 JSON 解析错误处理', () => {
    it('应该优雅处理无效的消息格式', async () => {
      const warnSpy = vi.spyOn((network as any).logger, 'warn');

      // 模拟收到无效格式的消息
      await (network as any).handleMessage(
        {
          id: 'msg-invalid',
          type: 'TASK_REQUEST',
          from: 'peer-1',
          timestamp: Date.now(),
          payload: 'invalid-payload-type' // 应该是对象而非字符串
        },
        'peer-1'
      );

      // 应该记录警告但不抛出异常
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid message format',
        expect.objectContaining({ errors: expect.any(Array) })
      );
    });
  });

  // ========== 7. 中间件 drop 路径 ==========
  describe('中间件 drop 路径', () => {
    it('应该丢弃被中间件拒绝的消息', async () => {
      const mockMiddleware = {
        execute: vi.fn().mockResolvedValue({
          action: 'drop',
          reason: 'Rate limited',
          context: { message: {} }
        })
      };
      (network as any).middlewareManager = mockMiddleware;
      (network as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const emitSpy = vi.spyOn(network, 'emit');

      await (network as any).handleMessage(
        {
          id: 'msg-1',
          type: 'TASK_REQUEST',
          from: 'peer-1',
          timestamp: Date.now(),
          payload: {}
        },
        'peer-1'
      );

      // 消息被丢弃，不应该 emit
      expect(emitSpy).not.toHaveBeenCalledWith('message:received', expect.anything(), expect.anything());
    });
  });

  // ========== 8. Peer 断连处理 ==========
  describe('Peer 断连处理', () => {
    it('应该从 connectedPeers 索引中移除断开的 peer', async () => {
      // 先添加 peer 到连接索引
      (network as any).peerManager.getConnectedPeersSet().add('peer-1');
      (network as any).peerManager.getPeerTable().set('peer-1', {
        peerId: 'peer-1',
        connected: true,
        lastSeen: Date.now(),
        multiaddrs: []
      });

      // 模拟断连事件
      const mockEvent = {
        detail: { toString: () => 'peer-1' }
      };

      // 设置 node 事件监听
      const eventHandlers = new Map();
      (network as any).node = {
        addEventListener: vi.fn((event, handler) => {
          eventHandlers.set(event, handler);
        }),
        handle: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined)
      };

      // 重新初始化事件处理器
      (network as any).setupEventHandlers();

      // 触发断连
      const handler = eventHandlers.get('peer:disconnect');
      if (handler) {
        await handler(mockEvent);
      }

      expect((network as any).peerManager.getConnectedPeersSet().has('peer-1')).toBe(false);
    });

    it('应该记录不在路由表中的 peer 断连警告', async () => {
      const warnSpy = vi.spyOn((network as any).logger, 'warn');

      const mockEvent = {
        detail: { toString: () => 'unknown-peer' }
      };

      const eventHandlers = new Map();
      (network as any).node = {
        addEventListener: vi.fn((event, handler) => {
          eventHandlers.set(event, handler);
        }),
        handle: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined)
      };

      (network as any).setupEventHandlers();

      const handler = eventHandlers.get('peer:disconnect');
      if (handler) {
        await handler(mockEvent);
      }

      expect(warnSpy).toHaveBeenCalledWith(
        'Peer disconnected but not in routing table',
        expect.objectContaining({ peerId: expect.any(String) })
      );
    });
  });

  // ========== 9. sendTaskRequest 超时处理 ==========
  describe('sendTaskRequest - 超时处理', () => {
    it('应该在无法连接 peer 时返回 PEER_NOT_FOUND 错误', async () => {
      // 不添加 peer 到 peerTable，模拟 peer 不存在
      (network as any).node = {
        getConnections: vi.fn().mockReturnValue([]),
        dial: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined)
      };
      (network as any).enableE2EE = false;

      const result = await network.sendTaskRequest(
        'non-existent-peer',
        'test-task',
        'Test task description',
        {},
        1000
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PEER_NOT_FOUND');
    });
  });

  // ========== 10. handleDiscover 的 peerId 验证 ==========
  describe('handleDiscover - peerId 验证', () => {
    it('应该拒绝 peerId 不匹配的发现消息（防止伪造）', async () => {
      const warnSpy = vi.spyOn((network as any).logger, 'warn');

      await (network as any).handleDiscover(
        {
          ...mockAgentInfo,
          peerId: 'different-peer-id' // 声称是另一个 peer
        },
        'actual-peer-id' // 实际发送方
      );

      expect(warnSpy).toHaveBeenCalledWith(
        'Discovery message rejected: peerId mismatch',
        expect.objectContaining({
          claimedPeerId: expect.any(String),
          actualPeerId: expect.any(String)
        })
      );
    });

    it('应该接受 peerId 匹配的发现消息', async () => {
      const warnSpy = vi.spyOn((network as any).logger, 'warn');

      await (network as any).handleDiscover(
        {
          ...mockAgentInfo,
          peerId: 'peer-matching'
        },
        'peer-matching' // peerId 匹配
      );

      // 不应该有警告
      expect(warnSpy).not.toHaveBeenCalledWith(
        'Discovery message rejected: peerId mismatch',
        expect.anything()
      );
    });
  });
});
