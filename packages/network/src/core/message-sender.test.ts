/**
 * MessageSender 测试 - P2P 消息发送器
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageSender } from './message-sender.js';
import type { MessageSenderDeps } from '../types/p2p-handlers.js';
import type { F2AMessage } from '../types/index.js';
import { success, failureFromError } from '../types/index.js';

// 创建模拟消息
function createMessage(overrides: Partial<F2AMessage> = {}): F2AMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'MESSAGE',
    from: '12D3KooWSender1234567890',
    to: '12D3KooWReceiver1234567890',
    timestamp: Date.now(),
    payload: {
      messageId: `msg-${Date.now()}`,
      fromAgentId: 'agent:sender',
      toAgentId: 'agent:receiver',
      content: 'test content',
      type: 'message',
    },
    ...overrides,
  };
}

// 创建模拟的 Connection
function createMockConnection(peerId: string) {
  return {
    remotePeer: { toString: () => peerId },
    newStream: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue(undefined),
      SendCloseWrite: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

// 创建模拟的 Libp2p node
function createMockNode() {
  const connections: any[] = [];
  return {
    getConnections: vi.fn().mockReturnValue(connections),
    dial: vi.fn().mockImplementation(async (addr: any) => {
      // 返回一个模拟的 connection
      return createMockConnection('12D3KooWDialed1234567890');
    }),
    _connections: connections, // 用于测试中添加 connection
  };
}

// 创建模拟的 PeerManager
function createMockPeerManager() {
  const connectedPeersSet = new Set<string>();
  const peerTable = new Map<string, { peerId: string; multiaddrs: any[] }>();
  
  return {
    getConnectedPeersSet: vi.fn().mockReturnValue(connectedPeersSet),
    getPeerTable: vi.fn().mockReturnValue(peerTable),
    _connectedPeersSet: connectedPeersSet, // 用于测试中添加 peer
    _peerTable: peerTable,
  };
}

// 创建模拟的 E2EECrypto
function createMockE2EECrypto() {
  return {
    canEncryptTo: vi.fn().mockReturnValue(true),
    encrypt: vi.fn().mockReturnValue({
      ciphertext: 'encrypted-data',
      iv: 'iv-value',
      authTag: 'auth-tag',
      senderPublicKey: 'public-key',
    }),
  };
}

// 创建模拟的 Logger
function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// 创建模拟的 MessageSenderDeps
function createMockDeps() {
  return {
    node: createMockNode() as any,
    e2eeCrypto: createMockE2EECrypto() as any,
    logger: createMockLogger() as any,
    peerManager: createMockPeerManager() as any,
    enableE2EE: false,
  };
}

describe('MessageSender', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let sender: MessageSender;

  beforeEach(() => {
    deps = createMockDeps();
    sender = new MessageSender(deps as unknown as MessageSenderDeps);
  });

  describe('send', () => {
    it('should fail when network not started', async () => {
      deps.node = null as any;
      
      const message = createMessage();
      const result = await sender.send('12D3KooWTarget1234', message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NETWORK_NOT_STARTED');
    });

    it('should send to connected peer', async () => {
      const peerId = '12D3KooWConnected1234';
      
      // 设置已连接 peer
      deps.peerManager._connectedPeersSet.add(peerId);
      const connection = createMockConnection(peerId);
      deps.node._connections.push(connection);
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(true);
      expect(connection.newStream).toHaveBeenCalled();
    });

    it('should dial and send to unconnected peer', async () => {
      const peerId = '12D3KooWTarget1234';
      
      // 设置 peer 信息但未连接
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: ['/ip4/192.168.1.1/tcp/4001/p2p/' + peerId],
      });
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(true);
      expect(deps.node.dial).toHaveBeenCalled();
    });

    it('should fail when peer not found', async () => {
      const peerId = '12D3KooWUnknown1234';
      
      // peer 未在 peerTable 中
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PEER_NOT_FOUND');
    });

    it('should fail when peer has no multiaddrs', async () => {
      const peerId = '12D3KooWNoAddr1234';
      
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: [],
      });
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PEER_NOT_FOUND');
    });

    it('should handle inconsistent connection index', async () => {
      const peerId = '12D3KooWIncon1234';
      
      // 设置已连接但实际 connection 不存在
      deps.peerManager._connectedPeersSet.add(peerId);
      // 不添加 connection
      
      // 设置 peer 信息以便 dial
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: ['/ip4/192.168.1.1/tcp/4001/p2p/' + peerId],
      });
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(true);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Connection index inconsistent, clearing',
        expect.objectContaining({ peerId: peerId.slice(0, 16) })
      );
    });

    it('should encrypt message when E2EE enabled', async () => {
      const peerId = '12D3KooWEncrypt1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      const connection = createMockConnection(peerId);
      deps.node._connections.push(connection);
      
      // 启用 E2EE
      deps.enableE2EE = true;
      sender = new MessageSender(deps as unknown as MessageSenderDeps);
      
      const message = createMessage();
      const result = await sender.send(peerId, message, true);
      
      expect(result.success).toBe(true);
      expect(deps.e2eeCrypto.canEncryptTo).toHaveBeenCalledWith(peerId);
      expect(deps.e2eeCrypto.encrypt).toHaveBeenCalled();
    });

    it('should fail when encryption not possible', async () => {
      const peerId = '12D3KooWNoKey1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      const connection = createMockConnection(peerId);
      deps.node._connections.push(connection);
      
      deps.enableE2EE = true;
      deps.e2eeCrypto.canEncryptTo.mockReturnValue(false);
      sender = new MessageSender(deps as unknown as MessageSenderDeps);
      
      const message = createMessage();
      const result = await sender.send(peerId, message, true);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENCRYPTION_FAILED');
    });

    it('should fail when encryption returns null', async () => {
      const peerId = '12D3KooWEncNull1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      const connection = createMockConnection(peerId);
      deps.node._connections.push(connection);
      
      deps.enableE2EE = true;
      deps.e2eeCrypto.encrypt.mockReturnValue(null);
      sender = new MessageSender(deps as unknown as MessageSenderDeps);
      
      const message = createMessage();
      const result = await sender.send(peerId, message, true);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENCRYPTION_FAILED');
    });

    it('should handle newStream failure and reconnect', async () => {
      const peerId = '12D3KooWStreamFail1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      
      // connection that fails newStream but dial succeeds
      const failingConnection = {
        remotePeer: { toString: () => peerId },
        newStream: vi.fn().mockRejectedValue(new Error('Stream failed')),
      };
      deps.node._connections.push(failingConnection);
      
      // 设置 peer 信息以便 reconnect
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: ['/ip4/192.168.1.1/tcp/4001/p2p/' + peerId],
      });
      
      // dial 返回新的成功 connection
      const successConnection = createMockConnection(peerId);
      deps.node.dial.mockResolvedValue(successConnection);
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(true);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        'Failed to create stream, reconnecting',
        expect.objectContaining({ peerId: peerId.slice(0, 16) })
      );
    });

    it('should fail when reconnect fails', async () => {
      const peerId = '12D3KooWReFail1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      
      const failingConnection = {
        remotePeer: { toString: () => peerId },
        newStream: vi.fn().mockRejectedValue(new Error('Stream failed')),
      };
      deps.node._connections.push(failingConnection);
      
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: ['/ip4/192.168.1.1/tcp/4001/p2p/' + peerId],
      });
      
      // dial 也失败
      deps.node.dial.mockRejectedValue(new Error('Dial failed'));
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONNECTION_FAILED');
    });

    it('should fail when reconnect has no peer info', async () => {
      const peerId = '12D3KooWNoInfo1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      
      const failingConnection = {
        remotePeer: { toString: () => peerId },
        newStream: vi.fn().mockRejectedValue(new Error('Stream failed')),
      };
      deps.node._connections.push(failingConnection);
      
      // peer info 不存在
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONNECTION_FAILED');
    });
  });

  describe('broadcast', () => {
    it('should return early when no connected peers', async () => {
      // 无连接 peer
      const message = createMessage();
      await sender.broadcast(message);
      
      expect(deps.logger.debug).toHaveBeenCalledWith('No connected peers to broadcast to');
    });

    it('should broadcast to all connected peers', async () => {
      const peerId1 = '12D3KooWPeerA1234';
      const peerId2 = '12D3KooWPeerB1234';
      
      deps.peerManager._connectedPeersSet.add(peerId1);
      deps.peerManager._connectedPeersSet.add(peerId2);
      
      const connection1 = createMockConnection(peerId1);
      const connection2 = createMockConnection(peerId2);
      deps.node._connections.push(connection1, connection2);
      
      const message = createMessage();
      await sender.broadcast(message);
      
      expect(connection1.newStream).toHaveBeenCalled();
      expect(connection2.newStream).toHaveBeenCalled();
    });

    it('should log failed broadcasts', async () => {
      const peerId1 = '12D3KooWPeerOk1234';
      const peerId2 = '12D3KooWPeerBad1234';
      
      deps.peerManager._connectedPeersSet.add(peerId1);
      deps.peerManager._connectedPeersSet.add(peerId2);
      
      // 成功的 connection
      const successConnection = createMockConnection(peerId1);
      deps.node._connections.push(successConnection);
      
      // 设置 peer2 在 peerTable 以便 dial
      deps.peerManager._peerTable.set(peerId2, {
        peerId: peerId2,
        multiaddrs: [{ toString: () => '/ip4/192.168.1.2/tcp/4001/p2p/' + peerId2 }],
      });
      
      // dial 返回成功的 connection
      const dialConnection = createMockConnection(peerId2);
      // 让 stream.send 失败
      const failingStream = {
        send: vi.fn().mockRejectedValue(new Error('Send failed')),
        SendCloseWrite: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      dialConnection.newStream.mockResolvedValue(failingStream);
      deps.node.dial.mockResolvedValue(dialConnection);
      
      const message = createMessage();
      await sender.broadcast(message);
      
      // broadcast 应记录失败
      expect(deps.logger.warn).toHaveBeenCalled();
    });

    it('should handle rejection in Promise.allSettled', async () => {
      const peerId = '12D3KooWReject1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      
      // connection that throws on send
      const connection = createMockConnection(peerId);
      const stream = {
        send: vi.fn().mockRejectedValue(new Error('Send rejected')),
        SendCloseWrite: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      connection.newStream.mockResolvedValue(stream);
      deps.node._connections.push(connection);
      
      const message = createMessage();
      await sender.broadcast(message);
      
      expect(deps.logger.warn).toHaveBeenCalled();
    });
  });

  describe('setNode', () => {
    it('should update node reference', () => {
      const newNode = createMockNode();
      sender.setNode(newNode as any);
      
      // 验证后续 send 使用新 node
      const peerId = '12D3KooWNewNode1234';
      deps.peerManager._connectedPeersSet.add(peerId);
      newNode._connections.push(createMockConnection(peerId));
      
      const message = createMessage();
      sender.send(peerId, message);
      
      expect(newNode.getConnections).toHaveBeenCalled();
    });
  });

  describe('dialPeer - localhost filtering', () => {
    it('should prefer non-localhost multiaddr', async () => {
      const peerId = '12D3KooWDial1234';
      
      // multiaddrs 作为对象数组（模拟真实 multiaddr 对象）
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: [
          { toString: () => '/ip4/127.0.0.1/tcp/4001/p2p/' + peerId }, // localhost
          { toString: () => '/ip4/192.168.1.1/tcp/4001/p2p/' + peerId }, // non-localhost
        ],
      });
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(true);
      // dial 应收到非 localhost 地址对象
      expect(deps.node.dial).toHaveBeenCalled();
      const calledArg = deps.node.dial.mock.calls[0][0];
      expect(calledArg.toString()).toContain('192.168.1.1');
    });

    it('should use localhost when no other option', async () => {
      const peerId = '12D3KooWLocal1234';
      
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: [{ toString: () => '/ip4/127.0.0.1/tcp/4001/p2p/' + peerId }],
      });
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(true);
      expect(deps.node.dial).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle connection failed error', async () => {
      const peerId = '12D3KooWError1234';
      
      deps.peerManager._peerTable.set(peerId, {
        peerId,
        multiaddrs: ['/ip4/192.168.1.1/tcp/4001/p2p/' + peerId],
      });
      
      deps.node.dial.mockImplementation(() => {
        throw new Error('Dial error');
      });
      
      const message = createMessage();
      const result = await sender.send(peerId, message);
      
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONNECTION_FAILED');
    });

    it('should send unencrypted message when encrypt=false', async () => {
      const peerId = '12D3KooWPlain1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      const connection = createMockConnection(peerId);
      deps.node._connections.push(connection);
      
      deps.enableE2EE = true; // E2EE enabled
      sender = new MessageSender(deps as unknown as MessageSenderDeps);
      
      const message = createMessage();
      const result = await sender.send(peerId, message, false); // encrypt=false
      
      expect(result.success).toBe(true);
      expect(deps.e2eeCrypto.encrypt).not.toHaveBeenCalled();
    });

    it('should send unencrypted message when enableE2EE=false', async () => {
      const peerId = '12D3KooWNoE2E1234';
      
      deps.peerManager._connectedPeersSet.add(peerId);
      const connection = createMockConnection(peerId);
      deps.node._connections.push(connection);
      
      deps.enableE2EE = false;
      sender = new MessageSender(deps as unknown as MessageSenderDeps);
      
      const message = createMessage();
      const result = await sender.send(peerId, message, true); // encrypt=true
      
      expect(result.success).toBe(true);
      expect(deps.e2eeCrypto.encrypt).not.toHaveBeenCalled();
    });
  });
});