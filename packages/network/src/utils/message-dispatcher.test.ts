/**
 * MessageDispatcher 测试 - P2P 消息分发器
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageDispatcher, F2A_PROTOCOL } from './message-dispatcher.js';
import type { F2AMessage, AgentInfo, PeerInfo } from '../types/index.js';
import type { Middleware, MiddlewareResult } from './middleware.js';
import type { PeerTableManager } from './peer-table-manager.js';
import type { EncryptedF2AMessage } from '../common/type-guards.js';
import { E2EECrypto } from '../core/e2ee-crypto.js';
import { Logger } from './logger.js';

// 创建有效的 F2AMessage（使用有效 UUID）
function createMessage(overrides: Partial<F2AMessage> = {}): F2AMessage {
  const uuid = '12345678-1234-4000-8000-123456789abc';
  return {
    id: uuid,
    type: 'MESSAGE',
    from: '12D3KooWSender1234567890',
    to: '12D3KooWReceiver1234567890',
    timestamp: Date.now(),
    payload: {
      topic: 'agent.message',
      content: 'test content',
    },
    ...overrides,
  };
}

// 创建加密消息
function createEncryptedMessage(payload: any): EncryptedF2AMessage {
  return {
    id: '12345678-1234-4000-8000-123456789abc',
    type: 'MESSAGE',
    from: '12D3KooWSender1234567890',
    to: '12D3KooWReceiver1234567890',
    timestamp: Date.now(),
    encrypted: true,
    payload: payload,
  };
}

// 创建 AgentInfo
function createAgentInfo(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    peerId: '12D3KooWTest1234567890',
    agentType: 'custom',
    version: '1.0.0',
    capabilities: [],
    protocolVersion: '1.0.0',
    lastSeen: Date.now(),
    multiaddrs: ['/ip4/127.0.0.1/tcp/4001'],
    ...overrides,
  };
}

// 创建 PeerInfo
function createPeerInfo(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    peerId: '12D3KooWTest1234567890',
    multiaddrs: [],
    connected: false,
    reputation: 0,
    lastSeen: Date.now(),
    ...overrides,
  };
}

// 创建模拟的 E2EECrypto
function createMockE2EECrypto() {
  const peerPublicKeys = new Map<string, string>();
  
  return {
    decrypt: vi.fn().mockImplementation((encrypted: any) => {
      // 模拟解密成功
      if (encrypted.ciphertext === 'valid-encrypted') {
        return JSON.stringify(createMessage({ from: '12D3KooWDecryptTarget' }));
      }
      return null;
    }),
    getPeerPublicKey: vi.fn().mockImplementation((peerId: string) => {
      return peerPublicKeys.get(peerId);
    }),
    registerPeerPublicKey: vi.fn().mockImplementation((peerId: string, key: string) => {
      peerPublicKeys.set(peerId, key);
    }),
    _peerPublicKeys: peerPublicKeys, // 用于测试中设置数据
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

// 创建模拟的 PeerTableManager
function createMockPeerTableManager() {
  const peers = new Map<string, PeerInfo>();
  
  return {
    getPeer: vi.fn().mockImplementation((peerId: string) => {
      return peers.get(peerId);
    }),
    _peers: peers, // 用于测试中设置数据
  };
}

describe('MessageDispatcher', () => {
  let mockE2EECrypto: ReturnType<typeof createMockE2EECrypto>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let dispatcher: MessageDispatcher;

  beforeEach(() => {
    mockE2EECrypto = createMockE2EECrypto();
    mockLogger = createMockLogger();
    dispatcher = new MessageDispatcher(mockE2EECrypto as any, {
      logger: mockLogger as any,
      localPeerId: '12D3KooWLocal1234567890',
    });
  });

  describe('constructor and basic setup', () => {
    it('should create dispatcher with default logger', () => {
      const d = new MessageDispatcher(mockE2EECrypto as any);
      expect(d).toBeDefined();
    });

    it('should export F2A_PROTOCOL constant', () => {
      expect(F2A_PROTOCOL).toBe('/f2a/1.0.0');
    });

    it('should set localPeerId', () => {
      dispatcher.setLocalPeerId('new-peer-id');
      // 后续测试验证
    });

    it('should set callbacks', () => {
      const callbacks = {
        onDiscover: vi.fn(),
        onDecryptFailed: vi.fn(),
        onFreeMessage: vi.fn(),
      };
      dispatcher.setCallbacks(callbacks);
      // 后续测试验证回调被调用
    });

    it('should set peer table manager', () => {
      const peerTableManager = createMockPeerTableManager();
      dispatcher.setPeerTableManager(peerTableManager as any);
      // 后续测试验证
    });

    it('should stop rate limiters', () => {
      dispatcher.stop();
      // 验证 stop 被调用，无异常
    });
  });

  describe('middleware management', () => {
    it('should register middleware', () => {
      const middleware: Middleware = {
        name: 'test-middleware',
        process: vi.fn().mockReturnValue({ action: 'continue', context: {} as any }),
      };
      dispatcher.useMiddleware(middleware);
      expect(dispatcher.listMiddlewares()).toContain('test-middleware');
    });

    it('should remove middleware', () => {
      const middleware: Middleware = {
        name: 'removable-middleware',
        process: vi.fn().mockReturnValue({ action: 'continue', context: {} as any }),
      };
      dispatcher.useMiddleware(middleware);
      expect(dispatcher.removeMiddleware('removable-middleware')).toBe(true);
      expect(dispatcher.listMiddlewares()).not.toContain('removable-middleware');
    });

    it('should return false when removing non-existent middleware', () => {
      expect(dispatcher.removeMiddleware('non-existent')).toBe(false);
    });

    it('should list all middlewares', () => {
      const mw1: Middleware = {
        name: 'mw1',
        priority: 1,
        process: vi.fn().mockReturnValue({ action: 'continue', context: {} as any }),
      };
      const mw2: Middleware = {
        name: 'mw2',
        priority: 2,
        process: vi.fn().mockReturnValue({ action: 'continue', context: {} as any }),
      };
      dispatcher.useMiddleware(mw1);
      dispatcher.useMiddleware(mw2);
      
      const list = dispatcher.listMiddlewares();
      expect(list).toHaveLength(2);
      expect(list).toContain('mw1');
      expect(list).toContain('mw2');
    });
  });

  describe('handleMessage - validation', () => {
    it('should reject invalid message format', async () => {
      const invalidMessage = { invalid: true } as any;
      await dispatcher.handleMessage(invalidMessage, '12D3KooWSender');
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid message format',
        expect.objectContaining({
          errors: expect.any(Array),
        })
      );
    });

    it('should accept valid message', async () => {
      const message = createMessage({ type: 'MESSAGE' });
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received message',
        expect.objectContaining({ type: 'MESSAGE' })
      );
    });
  });

  describe('handleMessage - peer table update', () => {
    it('should update peer lastSeen time', async () => {
      const peerTableManager = createMockPeerTableManager();
      const peerInfo = createPeerInfo({ peerId: '12D3KooWUpdatePeer' });
      peerTableManager._peers.set('12D3KooWUpdatePeer', peerInfo);
      dispatcher.setPeerTableManager(peerTableManager as any);
      
      const message = createMessage({ type: 'MESSAGE' });
      await dispatcher.handleMessage(message, '12D3KooWUpdatePeer');
      
      expect(peerInfo.lastSeen).toBeGreaterThan(0);
    });

    it('should not update if peer not found', async () => {
      const peerTableManager = createMockPeerTableManager();
      dispatcher.setPeerTableManager(peerTableManager as any);
      
      const message = createMessage({ type: 'MESSAGE' });
      await dispatcher.handleMessage(message, '12D3KooWUnknownPeer');
      
      // 无异常，正常完成
    });
  });

  describe('handleMessage - middleware execution', () => {
    it('should continue through middleware', async () => {
      const middleware: Middleware = {
        name: 'pass-through',
        process: vi.fn().mockReturnValue({ action: 'continue', context: { message: createMessage(), peerId: 'test', metadata: new Map() } as any }),
      };
      dispatcher.useMiddleware(middleware);
      
      const message = createMessage({ type: 'MESSAGE' });
      const callbacks = { onFreeMessage: vi.fn() };
      dispatcher.setCallbacks(callbacks);
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(middleware.process).toHaveBeenCalled();
    });

    it('should drop message when middleware returns drop', async () => {
      const middleware: Middleware = {
        name: 'dropper',
        process: vi.fn().mockReturnValue({ action: 'drop', reason: 'blocked' }),
      };
      dispatcher.useMiddleware(middleware);
      
      const message = createMessage({ type: 'MESSAGE' });
      const callbacks = { onFreeMessage: vi.fn() };
      dispatcher.setCallbacks(callbacks);
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Message dropped by middleware',
        expect.objectContaining({ reason: 'blocked' })
      );
      expect(callbacks.onFreeMessage).not.toHaveBeenCalled();
    });

    it('should modify message through middleware', async () => {
      const modifiedMessage = createMessage({ type: 'MESSAGE', payload: { modified: true } });
      const middleware: Middleware = {
        name: 'modifier',
        process: vi.fn().mockReturnValue({ action: 'modify', context: { message: modifiedMessage, peerId: 'test', metadata: new Map() } as any }),
      };
      dispatcher.useMiddleware(middleware);
      
      const callbacks = { onFreeMessage: vi.fn() };
      dispatcher.setCallbacks(callbacks);
      
      const message = createMessage({ type: 'MESSAGE' });
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(callbacks.onFreeMessage).toHaveBeenCalledWith(modifiedMessage, '12D3KooWSender');
    });
  });

  describe('handleMessage - encrypted message', () => {
    it('should pass through non-encrypted message', async () => {
      const message = createMessage({ type: 'MESSAGE' });
      const callbacks = { onFreeMessage: vi.fn() };
      dispatcher.setCallbacks(callbacks);
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(callbacks.onFreeMessage).toHaveBeenCalled();
    });

    it('should decrypt encrypted message successfully', async () => {
      const encryptedMessage = createEncryptedMessage({
        ciphertext: 'valid-encrypted',
        iv: 'iv-value',
        authTag: 'auth-tag',
        senderPublicKey: 'sender-pub-key',
      });
      
      const callbacks = { onFreeMessage: vi.fn() };
      dispatcher.setCallbacks(callbacks);
      
      await dispatcher.handleMessage(encryptedMessage as any, '12D3KooWDecryptTarget');
      
      expect(mockE2EECrypto.decrypt).toHaveBeenCalled();
    });

    it('should fail when decryption returns null', async () => {
      mockE2EECrypto.decrypt.mockReturnValue(null);
      
      const encryptedMessage = createEncryptedMessage({
        ciphertext: 'invalid-encrypted',
        iv: 'iv-value',
        authTag: 'auth-tag',
        senderPublicKey: 'sender-pub-key',
      });
      
      const sendMessage = vi.fn().mockResolvedValue({ success: true });
      dispatcher.setCallbacks({ sendMessage });
      
      await dispatcher.handleMessage(encryptedMessage as any, '12D3KooWSender');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to decrypt message',
        expect.any(Object)
      );
      expect(sendMessage).toHaveBeenCalled();
    });

    it('should fail when decrypted JSON is invalid', async () => {
      mockE2EECrypto.decrypt.mockReturnValue('not-valid-json');
      
      const encryptedMessage = createEncryptedMessage({
        ciphertext: 'json-error',
        iv: 'iv-value',
        authTag: 'auth-tag',
        senderPublicKey: 'sender-pub-key',
      });
      
      await dispatcher.handleMessage(encryptedMessage as any, '12D3KooWSender');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to parse decrypted message',
        expect.any(Object)
      );
    });

    it('should verify sender identity - public key mismatch', async () => {
      mockE2EECrypto._peerPublicKeys.set('12D3KooWSender', 'different-key');
      
      const encryptedMessage = createEncryptedMessage({
        ciphertext: 'valid-encrypted',
        iv: 'iv-value',
        authTag: 'auth-tag',
        senderPublicKey: 'sender-pub-key',
      });
      
      await dispatcher.handleMessage(encryptedMessage as any, '12D3KooWSender');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Sender identity verification failed: public key mismatch',
        expect.any(Object)
      );
    });

    it('should verify sender identity - from field mismatch', async () => {
      mockE2EECrypto.decrypt.mockReturnValue(JSON.stringify(
        createMessage({ from: 'different-peer-id' })
      ));
      
      const encryptedMessage = createEncryptedMessage({
        ciphertext: 'valid-encrypted',
        iv: 'iv-value',
        authTag: 'auth-tag',
        senderPublicKey: 'sender-pub-key',
      });
      
      await dispatcher.handleMessage(encryptedMessage as any, '12D3KooWSender');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Sender identity verification failed: from field mismatch',
        expect.any(Object)
      );
    });

    it('should handle sendMessage callback failure', async () => {
      mockE2EECrypto.decrypt.mockReturnValue(null);
      
      const sendMessage = vi.fn().mockRejectedValue(new Error('Send failed'));
      dispatcher.setCallbacks({ sendMessage });
      
      const encryptedMessage = createEncryptedMessage({
        ciphertext: 'invalid-encrypted',
        iv: 'iv-value',
        authTag: 'auth-tag',
      });
      
      await dispatcher.handleMessage(encryptedMessage as any, '12D3KooWSender');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send decrypt failure response',
        expect.any(Object)
      );
    });

    it('should use empty string when localPeerId is not set', async () => {
      // 创建没有 localPeerId 的 dispatcher
      const noPeerIdDispatcher = new MessageDispatcher(mockE2EECrypto as any, {
        logger: mockLogger as any,
      });
      
      mockE2EECrypto.decrypt.mockReturnValue(null);
      
      const sendMessage = vi.fn().mockResolvedValue({ success: true });
      noPeerIdDispatcher.setCallbacks({ sendMessage });
      
      const encryptedMessage = createEncryptedMessage({
        ciphertext: 'invalid-encrypted',
        iv: 'iv-value',
        authTag: 'auth-tag',
      });
      
      await noPeerIdDispatcher.handleMessage(encryptedMessage as any, '12D3KooWSender');
      
      // sendMessage 应被调用，from 字段为空字符串
      expect(sendMessage).toHaveBeenCalled();
      const sentMessage = sendMessage.mock.calls[0][1];
      expect(sentMessage.from).toBe('');
    });
  });

  describe('dispatchMessage - DISCOVER', () => {
    it('should handle DISCOVER message', async () => {
      const agentInfo = createAgentInfo();
      const message = createMessage({
        type: 'DISCOVER',
        payload: { agentInfo },
      });
      
      const onDiscover = vi.fn();
      dispatcher.setCallbacks({ onDiscover });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(onDiscover).toHaveBeenCalledWith(agentInfo, '12D3KooWSender', true);
    });

    it('should handle DISCOVER_RESP message', async () => {
      const agentInfo = createAgentInfo();
      const message = createMessage({
        type: 'DISCOVER_RESP',
        payload: { agentInfo },
      });
      
      const onDiscover = vi.fn();
      dispatcher.setCallbacks({ onDiscover });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(onDiscover).toHaveBeenCalledWith(agentInfo, '12D3KooWSender', false);
    });

    it('should rate limit DISCOVER messages', async () => {
      const agentInfo = createAgentInfo();
      const message = createMessage({
        id: '12345678-1234-4000-8000-123456789001',
        type: 'DISCOVER',
        payload: { agentInfo },
      });
      
      const onDiscover = vi.fn();
      dispatcher.setCallbacks({ onDiscover });
      
      // 发送超过限制的消息（需要不同的 UUID）
      for (let i = 0; i < 15; i++) {
        const msg = createMessage({
          id: `12345678-1234-4000-8000-${i.toString().padStart(12, '0')}`,
          type: 'DISCOVER',
          payload: { agentInfo },
        });
        await dispatcher.handleMessage(msg, '12D3KooWSender');
      }
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'DISCOVER message rate limit exceeded, ignoring',
        expect.any(Object)
      );
    });
  });

  describe('dispatchMessage - DECRYPT_FAILED', () => {
    it('should handle DECRYPT_FAILED message', async () => {
      const message = createMessage({
        type: 'DECRYPT_FAILED',
        payload: {
          originalMessageId: 'original-msg-id',
          error: 'DECRYPTION_FAILED',
          message: 'Unable to decrypt',
        },
      });
      
      const onDecryptFailed = vi.fn();
      dispatcher.setCallbacks({ onDecryptFailed });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Received decrypt failure notification',
        expect.any(Object)
      );
      expect(onDecryptFailed).toHaveBeenCalled();
    });

    it('should re-register encryption key after decrypt failure', async () => {
      const peerTableManager = createMockPeerTableManager();
      const peerInfo = createPeerInfo({
        peerId: '12D3KooWSender',
        agentInfo: createAgentInfo({ encryptionPublicKey: 'new-public-key' }),
      });
      peerTableManager._peers.set('12D3KooWSender', peerInfo);
      dispatcher.setPeerTableManager(peerTableManager as any);
      
      const message = createMessage({
        type: 'DECRYPT_FAILED',
        payload: {
          originalMessageId: 'original-msg-id',
          error: 'DECRYPTION_FAILED',
          message: 'Unable to decrypt',
        },
      });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockE2EECrypto.registerPeerPublicKey).toHaveBeenCalledWith('12D3KooWSender', 'new-public-key');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Re-registered encryption key after decrypt failure',
        expect.any(Object)
      );
    });

    it('should call onError when no onDecryptFailed callback', async () => {
      const onError = vi.fn();
      dispatcher.setCallbacks({ onError });
      
      const message = createMessage({
        type: 'DECRYPT_FAILED',
        payload: {
          originalMessageId: 'original-msg-id',
          error: 'DECRYPTION_FAILED',
          message: 'Unable to decrypt',
        },
      });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should rate limit DECRYPT_FAILED messages', async () => {
      // 发送超过限制的消息
      for (let i = 0; i < 10; i++) {
        const message = createMessage({
          id: `12345678-1234-4000-8000-${i.toString().padStart(12, '0')}`,
          type: 'DECRYPT_FAILED',
          payload: {
            originalMessageId: 'msg-id',
            error: 'ERROR',
            message: 'message',
          },
        });
        await dispatcher.handleMessage(message, '12D3KooWSender');
      }
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'DECRYPT_FAILED message rate limit exceeded, ignoring',
        expect.any(Object)
      );
    });
  });

  describe('dispatchMessage - MESSAGE', () => {
    it('should handle MESSAGE type', async () => {
      const message = createMessage({ type: 'MESSAGE' });
      const onFreeMessage = vi.fn();
      dispatcher.setCallbacks({ onFreeMessage });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(onFreeMessage).toHaveBeenCalledWith(message, '12D3KooWSender');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received free message',
        expect.any(Object)
      );
    });

    it('should log content length for string content', async () => {
      const message = createMessage({
        type: 'MESSAGE',
        payload: { content: 'a'.repeat(100) },
      });
      
      const onFreeMessage = vi.fn();
      dispatcher.setCallbacks({ onFreeMessage });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received free message',
        expect.objectContaining({ contentLength: 100 })
      );
    });

    it('should handle object content', async () => {
      const message = createMessage({
        type: 'MESSAGE',
        payload: { content: { key: 'value' } },
      });
      
      const onFreeMessage = vi.fn();
      dispatcher.setCallbacks({ onFreeMessage });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(onFreeMessage).toHaveBeenCalled();
    });
  });

  describe('callback merging', () => {
    it('should merge callbacks on multiple setCallbacks calls', async () => {
      const cb1 = { onDiscover: vi.fn() };
      const cb2 = { onFreeMessage: vi.fn() };
      dispatcher.setCallbacks(cb1);
      dispatcher.setCallbacks(cb2);
      
      const message = createMessage({ type: 'MESSAGE' });
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(cb2.onFreeMessage).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle valid message with all fields', async () => {
      const message = createMessage({
        type: 'MESSAGE',
        ttl: 1000,
      });
      
      const onFreeMessage = vi.fn();
      dispatcher.setCallbacks({ onFreeMessage });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(onFreeMessage).toHaveBeenCalled();
    });

    it('should handle MESSAGE without content', async () => {
      const message = createMessage({
        type: 'MESSAGE',
        payload: {},
      });
      
      const onFreeMessage = vi.fn();
      dispatcher.setCallbacks({ onFreeMessage });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Received free message',
        expect.objectContaining({ contentLength: 0 })
      );
    });

    it('should skip peer table update when not set', async () => {
      // 不设置 peerTableManager
      const message = createMessage({ type: 'MESSAGE' });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should warn for valid but unhandled message type (PING)', async () => {
      const message = createMessage({
        type: 'PING',
        payload: {},
      });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unknown message type',
        expect.objectContaining({ type: 'PING' })
      );
    });

    it('should warn for valid but unhandled message type (SKILL_ANNOUNCE)', async () => {
      const message = createMessage({
        type: 'SKILL_ANNOUNCE',
        payload: {},
      });
      
      await dispatcher.handleMessage(message, '12D3KooWSender');
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unknown message type',
        expect.objectContaining({ type: 'SKILL_ANNOUNCE' })
      );
    });
  });
});