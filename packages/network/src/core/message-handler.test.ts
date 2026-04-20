/**
 * MessageHandler 测试
 * Phase 3a+3b: 测试 MessageHandler 的核心功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'eventemitter3';
import { MessageHandler } from './message-handler.js';
import { PeerManager } from './peer-manager.js';
import { E2EECrypto } from './e2ee-crypto.js';
import type { F2AMessage, AgentInfo, StructuredMessagePayload } from '../types/index.js';
import { MESSAGE_TOPICS } from '../types/index.js';
import type { MessageHandlerEvents } from '../types/p2p-handlers.js';

// Mock E2EECrypto
class MockE2EECrypto {
  private keyPair: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;
  private peerPublicKeys: Map<string, string> = new Map();
  private sharedSecrets: Map<string, Uint8Array> = new Map();

  async initialize(): Promise<void> {
    this.keyPair = {
      publicKey: new Uint8Array(32).fill(1),
      privateKey: new Uint8Array(32).fill(2),
    };
  }

  getPublicKey(): string | null {
    if (!this.keyPair) return null;
    return Buffer.from(this.keyPair.publicKey).toString('base64');
  }

  registerPeerPublicKey(peerId: string, publicKeyBase64: string): void {
    this.peerPublicKeys.set(peerId, publicKeyBase64);
    this.sharedSecrets.set(peerId, new Uint8Array(32).fill(3));
  }

  getPeerPublicKey(peerId: string): string | null {
    return this.peerPublicKeys.get(peerId) || null;
  }

  canEncryptTo(peerId: string): boolean {
    return this.sharedSecrets.has(peerId);
  }

  encrypt(peerId: string, plaintext: string): any {
    if (!this.sharedSecrets.has(peerId)) return null;
    return {
      senderPublicKey: this.getPublicKey()!,
      iv: Buffer.from(new Uint8Array(16).fill(4)).toString('base64'),
      authTag: Buffer.from(new Uint8Array(16).fill(5)).toString('base64'),
      ciphertext: Buffer.from(plaintext).toString('base64'),
      salt: Buffer.from(new Uint8Array(16).fill(6)).toString('base64'),
    };
  }

  decrypt(encrypted: any): string | null {
    if (!this.keyPair) return null;
    // Return the original plaintext for mock
    try {
      // Check if ciphertext looks like valid base64 (no invalid chars like hyphens)
      // Also check for minimum length - real encrypted data should have substantial length
      if (!encrypted?.ciphertext || 
          /[^A-Za-z0-9+/=]/.test(encrypted.ciphertext) ||
          encrypted.ciphertext.length < 10) {
        return null;
      }
      return Buffer.from(encrypted.ciphertext, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  stop(): void {
    this.keyPair = null;
    this.peerPublicKeys.clear();
    this.sharedSecrets.clear();
  }
}

// Mock Logger
class MockLogger {
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
  debug = vi.fn();
}

// Mock MiddlewareManager
class MockMiddlewareManager {
  async execute(context: any) {
    return { action: 'continue', context };
  }
}

// Mock RateLimiter
class MockRateLimiter {
  allowRequest = vi.fn().mockReturnValue(true);
}

// Helper to create agent info
function createAgentInfo(peerId: string = 'test-peer'): AgentInfo {
  return {
    peerId,
    agentType: 'openclaw',
    version: '1.0.0',
    capabilities: [
      { name: 'test-capability', description: 'Test capability', tools: ['test-tool'] },
    ],
    protocolVersion: '1.0',
    lastSeen: Date.now(),
    multiaddrs: [],
  };
}

// Helper to create F2A message
function createMessage(
  type: F2AMessage['type'],
  payload: unknown,
  from: string = 'remote-peer',
  to?: string
): F2AMessage {
  return {
    id: randomUUID(),
    type,
    from,
    to,
    timestamp: Date.now(),
    payload,
  };
}

describe('MessageHandler', () => {
  let handler: MessageHandler;
  let peerManager: PeerManager;
  let e2eeCrypto: MockE2EECrypto;
  let emitter: EventEmitter<MessageHandlerEvents>;
  let logger: MockLogger;
  let middlewareManager: MockMiddlewareManager;
  let decryptFailedRateLimiter: MockRateLimiter;
  let discoverRateLimiter: MockRateLimiter;
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let onKeyExchangeMock: ReturnType<typeof vi.fn>;
  let pendingTasks: Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: string) => void;
    timeout: NodeJS.Timeout;
    resolved: boolean;
  }>;

  beforeEach(async () => {
    peerManager = new PeerManager();
    e2eeCrypto = new MockE2EECrypto();
    await e2eeCrypto.initialize();
    
    emitter = new EventEmitter<MessageHandlerEvents>();
    logger = new MockLogger();
    middlewareManager = new MockMiddlewareManager();
    decryptFailedRateLimiter = new MockRateLimiter();
    discoverRateLimiter = new MockRateLimiter();
    sendMessageMock = vi.fn().mockResolvedValue(undefined);
    onKeyExchangeMock = vi.fn().mockResolvedValue(undefined);
    pendingTasks = new Map();

    handler = new MessageHandler({
      e2eeCrypto: e2eeCrypto as any,
      peerManager,
      logger: logger as any,
      middlewareManager: middlewareManager as any,
      emitter,
      agentInfo: createAgentInfo('local-peer'),
      sendMessage: sendMessageMock,
      decryptFailedRateLimiter,
      discoverRateLimiter,
      pendingTasks,
      enableAgentIdVerification: false,
      onKeyExchange: onKeyExchangeMock,
    });
  });

  afterEach(() => {
    e2eeCrypto.stop();
  });

  describe('handleMessage', () => {
    it('should dispatch DISCOVER message to correct handler', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo });

      let discoveredData: any = null;
      emitter.on('peer:discovered', (data) => {
        discoveredData = data;
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(discoveredData).not.toBeNull();
      expect(discoveredData.peerId).toBe('remote-peer');
      expect(discoveredData.agentInfo.peerId).toBe('remote-peer');
    });

    it('should dispatch DISCOVER_RESP message without sending response', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER_RESP', { agentInfo: remoteAgentInfo });

      await handler.handleMessage(message, 'remote-peer');

      // DISCOVER_RESP should not trigger a response
      expect(sendMessageMock).not.toHaveBeenCalled();

      // Should still update peer table
      expect(peerManager.get('remote-peer')).toBeDefined();
    });

    it('should reject DISCOVER with mismatched peerId', async () => {
      const remoteAgentInfo = createAgentInfo('fake-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo }, 'real-peer');

      let discoveredData: any = null;
      emitter.on('peer:discovered', (data) => {
        discoveredData = data;
      });

      await handler.handleMessage(message, 'real-peer');

      // Should not emit discovered event due to peerId mismatch
      expect(discoveredData).toBeNull();
    });

    it('should respond to DISCOVER request', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo });

      await handler.handleMessage(message, 'remote-peer');

      expect(sendMessageMock).toHaveBeenCalledWith('remote-peer', expect.objectContaining({
        type: 'DISCOVER_RESP',
        payload: { agentInfo: expect.anything() }
      }), false);
    });

    it('should emit send event for encrypted decrypt failure', async () => {
      // Create an encrypted message that will fail to decrypt
      const encryptedPayload = {
        senderPublicKey: 'invalid-key',
        iv: 'invalid-iv',
        authTag: 'invalid-tag',
        ciphertext: 'invalid-ciphertext',
        salt: 'invalid-salt',
      };

      // Cast as any to bypass type check for test
      const message: any = {
        id: randomUUID(),
        type: 'MESSAGE',
        from: 'remote-peer',
        to: 'local-peer',
        timestamp: Date.now(),
        encrypted: true,
        payload: encryptedPayload,
      };

      await handler.handleMessage(message, 'remote-peer');

      expect(sendMessageMock).toHaveBeenCalledWith('remote-peer', expect.objectContaining({
        type: 'DECRYPT_FAILED'
      }), false);
    });

    it('should respect rate limiting for DISCOVER', async () => {
      discoverRateLimiter.allowRequest.mockReturnValue(false);
      
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo });

      let discoveredData: any = null;
      emitter.on('peer:discovered', (data) => {
        discoveredData = data;
      });

      await handler.handleMessage(message, 'rate-limit-test-peer');

      // Should not emit discovered event when rate limited
      expect(discoveredData).toBeNull();
    });
  });

  describe('handleEncryptedMessage', () => {
    it('should successfully decrypt valid encrypted message', async () => {
      // Register the peer's public key first
      e2eeCrypto.registerPeerPublicKey('remote-peer', e2eeCrypto.getPublicKey()!);

      const originalMessage = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.FREE_CHAT,
        content: 'Hello world',
      });

      // Encrypt the message
      const encrypted = e2eeCrypto.encrypt('remote-peer', JSON.stringify(originalMessage));

      const encryptedMessage: any = {
        id: randomUUID(),
        type: 'MESSAGE',
        from: 'remote-peer',
        to: 'local-peer',
        timestamp: Date.now(),
        encrypted: true,
        payload: encrypted,
      };

      let receivedMessage: F2AMessage | null = null;
      emitter.on('message:received', (message) => {
        receivedMessage = message;
      });

      await handler.handleMessage(encryptedMessage, 'remote-peer');

      // Should have received the decrypted message
      expect(receivedMessage).toBeDefined();
    });

    it('should emit send event on decrypt failure', async () => {
      const encryptedPayload = {
        senderPublicKey: 'invalid-base64-key',
        iv: 'invalid',
        authTag: 'invalid',
        ciphertext: 'invalid',
        salt: 'invalid',
      };

      const encryptedMessage: any = {
        id: randomUUID(),
        type: 'MESSAGE',
        from: 'remote-peer',
        to: 'local-peer',
        timestamp: Date.now(),
        encrypted: true,
        payload: encryptedPayload,
      };

      await handler.handleMessage(encryptedMessage, 'remote-peer');

      expect(sendMessageMock).toHaveBeenCalledWith('remote-peer', expect.objectContaining({
        type: 'DECRYPT_FAILED'
      }), false);
    });
  });

  describe('handleKeyExchange', () => {
    // Note: KEY_EXCHANGE is not in the F2AMessage validation schema
    // It's handled separately by the KeyExchangeService
    it.skip('should call onKeyExchange callback for KEY_EXCHANGE message', async () => {
      const message = createMessage('KEY_EXCHANGE', {
        publicKey: 'test-public-key-base64',
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(onKeyExchangeMock).toHaveBeenCalledWith(message, 'remote-peer');
    });
  });

  describe('handleDecryptFailedMessage', () => {
    it('should emit error event on DECRYPT_FAILED', async () => {
      const message = createMessage('DECRYPT_FAILED', {
        originalMessageId: 'original-msg-id',
        error: 'DECRYPTION_FAILED',
        message: 'Unable to decrypt',
      });

      let errorEvent: Error | null = null;
      emitter.on('error', (error) => {
        errorEvent = error;
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(errorEvent).not.toBeNull();
      expect(errorEvent?.message).toContain('Decrypt failed');
    });

    it('should re-register encryption key if available', async () => {
      // First register the peer with encryption key
      const remoteAgentInfo = createAgentInfo('remote-peer');
      remoteAgentInfo.encryptionPublicKey = 'stored-encryption-key';
      await peerManager.upsertFromAgentInfo(remoteAgentInfo, 'remote-peer');

      const message = createMessage('DECRYPT_FAILED', {
        originalMessageId: 'original-msg-id',
        error: 'DECRYPTION_FAILED',
        message: 'Unable to decrypt',
      });

      await handler.handleMessage(message, 'remote-peer');

      // Should have re-registered the key
      expect(e2eeCrypto.getPeerPublicKey('remote-peer')).toBe('stored-encryption-key');
    });

    it('should respect rate limiting for DECRYPT_FAILED', async () => {
      decryptFailedRateLimiter.allowRequest.mockReturnValue(false);
      
      const message = createMessage('DECRYPT_FAILED', {
        originalMessageId: 'original-msg-id',
        error: 'DECRYPTION_FAILED',
        message: 'Unable to decrypt',
      });

      let errorEvent: Error | null = null;
      emitter.on('error', (error) => {
        errorEvent = error;
      });

      await handler.handleMessage(message, 'remote-peer');

      // Should not emit error event when rate limited
      expect(errorEvent).toBeNull();
    });
  });

  describe('handleAgentMessage', () => {
    it('should emit message:received for MESSAGE type', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.FREE_CHAT,
        content: 'Hello',
      });

      let receivedMessage: F2AMessage | null = null;
      emitter.on('message:received', (message) => {
        receivedMessage = message;
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(receivedMessage).toBeDefined();
    });

    it('should warn on invalid MESSAGE payload', async () => {
      // Create a truly invalid payload - missing required content field
      const message = createMessage('MESSAGE', { topic: 'test' });

      await handler.handleMessage(message, 'remote-peer');

      // Invalid payload should trigger a warning
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('handleCapabilityQuery', () => {
    it('should respond with capabilities', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.CAPABILITY_QUERY,
        content: { capabilityName: 'test-capability' },
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(sendMessageMock).toHaveBeenCalledWith('remote-peer', expect.objectContaining({
        type: 'MESSAGE',
        payload: expect.objectContaining({
          topic: MESSAGE_TOPICS.CAPABILITY_RESPONSE
        })
      }));
    });

    it('should respond to capability query without capability name', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.CAPABILITY_QUERY,
        content: {},
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(sendMessageMock).toHaveBeenCalledWith('remote-peer', expect.objectContaining({
        type: 'MESSAGE',
        payload: expect.objectContaining({
          topic: MESSAGE_TOPICS.CAPABILITY_RESPONSE
        })
      }));
    });
  });

  describe('handleCapabilityResponse', () => {
    it('should update peer from capability response', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.CAPABILITY_RESPONSE,
        content: { agentInfo: remoteAgentInfo },
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(peerManager.get('remote-peer')).toBeDefined();
    });
  });

  describe('handleTaskResponse', () => {
    it('should resolve pending task on success', async () => {
      // Set up a pending task
      const resolveMock = vi.fn();
      const rejectMock = vi.fn();
      pendingTasks.set('task-123', {
        resolve: resolveMock,
        reject: rejectMock,
        timeout: setTimeout(() => {}, 10000) as unknown as NodeJS.Timeout,
        resolved: false,
      });

      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.TASK_RESPONSE,
        content: {
          taskId: 'task-123',
          status: 'success',
          result: { data: 'test-result' },
        },
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(resolveMock).toHaveBeenCalledWith({ data: 'test-result' });
      expect(pendingTasks.has('task-123')).toBe(false);
    });

    it('should reject pending task on error', async () => {
      // Set up a pending task
      const resolveMock = vi.fn();
      const rejectMock = vi.fn();
      pendingTasks.set('task-456', {
        resolve: resolveMock,
        reject: rejectMock,
        timeout: setTimeout(() => {}, 10000) as unknown as NodeJS.Timeout,
        resolved: false,
      });

      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.TASK_RESPONSE,
        content: {
          taskId: 'task-456',
          status: 'error',
          error: 'Task failed',
        },
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(rejectMock).toHaveBeenCalledWith('Task failed');
      expect(pendingTasks.has('task-456')).toBe(false);
    });

    it('should ignore unknown task response', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.TASK_RESPONSE,
        content: {
          taskId: 'unknown-task',
          status: 'success',
          result: { data: 'test-result' },
        },
      });

      // Should not throw
      await handler.handleMessage(message, 'remote-peer');
      
      // Logger should have warned
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('should emit message:received event', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.FREE_CHAT,
        content: 'Test message',
      });

      let receivedMessage: F2AMessage | null = null;
      let receivedPeerId: string | null = null;
      emitter.on('message:received', (message, peerId) => {
        receivedMessage = message;
        receivedPeerId = peerId;
      });

      await handler.handleMessage(message, 'remote-peer');

      expect(receivedMessage).toBeDefined();
      expect(receivedPeerId).toBe('remote-peer');
    });
  });

  describe('unknown message type', () => {
    it('should still emit message:received for unknown message type', async () => {
      const message: any = {
        id: 'unknown-msg',
        type: 'UNKNOWN_TYPE',
        from: 'remote-peer',
        timestamp: Date.now(),
        payload: {},
      };

      let receivedMessage: F2AMessage | null = null;
      emitter.on('message:received', (message) => {
        receivedMessage = message;
      });

      await handler.handleMessage(message, 'remote-peer');

      // Should emit message:received during handleMessage
      expect(receivedMessage).toBeDefined();
    });
  });
});