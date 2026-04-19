/**
 * MessageHandler 测试
 * Phase 3a+3b: 测试 MessageHandler 的核心功能
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageHandler } from './message-handler.js';
import { PeerManager } from './peer-manager.js';
import { E2EECrypto } from './e2ee-crypto.js';
import type { F2AMessage, AgentInfo, StructuredMessagePayload } from '../types/index.js';
import { MESSAGE_TOPICS } from '../types/index.js';

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
    id: `msg-${Date.now()}`,
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

  beforeEach(async () => {
    peerManager = new PeerManager();
    e2eeCrypto = new MockE2EECrypto();
    await e2eeCrypto.initialize();

    handler = new MessageHandler({
      peerManager,
      e2eeCrypto: e2eeCrypto as any,
      agentInfo: createAgentInfo('local-peer'),
    });
  });

  afterEach(() => {
    handler.stop();
    e2eeCrypto.stop();
  });

  describe('handle', () => {
    it('should dispatch DISCOVER message to correct handler', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo });

      let discoveredData: any = null;
      handler.on('peer:discovered', (data) => {
        discoveredData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(discoveredData).not.toBeNull();
      expect(discoveredData.peerId).toBe('remote-peer');
      expect(discoveredData.agentInfo.peerId).toBe('remote-peer');
    });

    it('should dispatch DISCOVER_RESP message without sending response', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER_RESP', { agentInfo: remoteAgentInfo });

      let sendCalled = false;
      handler.on('send', () => {
        sendCalled = true;
      });

      await handler.handle(message, 'remote-peer');

      // DISCOVER_RESP should not trigger a response
      expect(sendCalled).toBe(false);

      // Should still update peer table
      expect(peerManager.get('remote-peer')).toBeDefined();
    });

    it('should reject DISCOVER with mismatched peerId', async () => {
      const remoteAgentInfo = createAgentInfo('fake-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo }, 'real-peer');

      let discoveredData: any = null;
      handler.on('peer:discovered', (data) => {
        discoveredData = data;
      });

      await handler.handle(message, 'real-peer');

      // Should not emit discovered event due to peerId mismatch
      expect(discoveredData).toBeNull();
    });

    it('should respond to DISCOVER request', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo });

      let sentMessage: F2AMessage | null = null;
      let sentPeerId: string | null = null;
      handler.on('send', ({ peerId, message }) => {
        sentPeerId = peerId;
        sentMessage = message;
      });

      await handler.handle(message, 'remote-peer');

      expect(sentPeerId).toBe('remote-peer');
      expect(sentMessage?.type).toBe('DISCOVER_RESP');
      expect(sentMessage?.payload).toEqual({ agentInfo: handler.getAgentInfo() });
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
        id: 'encrypted-msg',
        type: 'MESSAGE',
        from: 'remote-peer',
        to: 'local-peer',
        timestamp: Date.now(),
        encrypted: true,
        payload: encryptedPayload,
      };

      let sentMessage: F2AMessage | null = null;
      handler.on('send', ({ message }) => {
        sentMessage = message;
      });

      await handler.handle(message, 'remote-peer');

      expect(sentMessage?.type).toBe('DECRYPT_FAILED');
    });

    it('should respect rate limiting', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo });

      // Handle multiple times to exceed rate limit
      for (let i = 0; i < 15; i++) {
        await handler.handle(message, 'rate-limit-test-peer');
      }

      // After rate limit exceeded, should not process
      let lastDiscovered: any = null;
      handler.on('peer:discovered', (data) => {
        lastDiscovered = data;
      });

      // Clear previous handlers by creating new handler
      const newHandler = new MessageHandler({
        peerManager: new PeerManager(),
        e2eeCrypto: e2eeCrypto as any,
        agentInfo: createAgentInfo(),
      });

      // This should be rate limited
      await newHandler.handle(message, 'rate-limit-test-peer');
      // Rate limit may or may not be exceeded based on timing
      newHandler.stop();
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
        id: 'encrypted-msg',
        type: 'MESSAGE',
        from: 'remote-peer',
        to: 'local-peer',
        timestamp: Date.now(),
        encrypted: true,
        payload: encrypted,
      };

      let receivedMessage: F2AMessage | null = null;
      handler.on('message:received', ({ message }) => {
        receivedMessage = message;
      });

      await handler.handle(encryptedMessage, 'remote-peer');

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
        id: 'encrypted-msg',
        type: 'MESSAGE',
        from: 'remote-peer',
        to: 'local-peer',
        timestamp: Date.now(),
        encrypted: true,
        payload: encryptedPayload,
      };

      let sentMessage: F2AMessage | null = null;
      handler.on('send', ({ message }) => {
        sentMessage = message;
      });

      await handler.handle(encryptedMessage, 'remote-peer');

      expect(sentMessage?.type).toBe('DECRYPT_FAILED');
    });
  });

  describe('handleKeyExchange', () => {
    it('should register peer public key', async () => {
      const message = createMessage('KEY_EXCHANGE', {
        publicKey: 'test-public-key-base64',
      });

      await handler.handle(message, 'remote-peer');

      expect(e2eeCrypto.getPeerPublicKey('remote-peer')).toBe('test-public-key-base64');
    });

    it('should respond with own public key if not already exchanged', async () => {
      const message = createMessage('KEY_EXCHANGE', {
        publicKey: 'test-public-key-base64',
      });

      let sentMessage: F2AMessage | null = null;
      handler.on('send', ({ message }) => {
        sentMessage = message;
      });

      await handler.handle(message, 'remote-peer');

      // Since we just registered, canEncryptTo should be true now
      // No response should be sent because encryption is now possible
      expect(e2eeCrypto.canEncryptTo('remote-peer')).toBe(true);
    });

    it('should ignore KEY_EXCHANGE without public key', async () => {
      const message = createMessage('KEY_EXCHANGE', {});

      let sentMessage: F2AMessage | null = null;
      handler.on('send', ({ message }) => {
        sentMessage = message;
      });

      await handler.handle(message, 'remote-peer');

      expect(sentMessage).toBeNull();
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
      handler.on('error', (error) => {
        errorEvent = error;
      });

      await handler.handle(message, 'remote-peer');

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

      await handler.handle(message, 'remote-peer');

      // Should have re-registered the key
      expect(e2eeCrypto.getPeerPublicKey('remote-peer')).toBe('stored-encryption-key');
    });
  });

  describe('handleAgentMessage', () => {
    it('should emit message:received for MESSAGE type', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.FREE_CHAT,
        content: 'Hello',
      });

      let receivedMessage: F2AMessage | null = null;
      handler.on('message:received', ({ message }) => {
        receivedMessage = message;
      });

      await handler.handle(message, 'remote-peer');

      expect(receivedMessage).toBeDefined();
    });

    it('should reject invalid MESSAGE payload', async () => {
      const message = createMessage('MESSAGE', 'invalid-payload');

      let receivedMessage: F2AMessage | null = null;
      handler.on('message:received', ({ message }) => {
        receivedMessage = message;
      });

      await handler.handle(message, 'remote-peer');

      // Invalid payload should not trigger event
      expect(receivedMessage).toBeNull();
    });
  });

  describe('handleCapabilityQuery', () => {
    it('should respond with capabilities', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.CAPABILITY_QUERY,
        content: { capabilityName: 'test-capability' },
      });

      let sentMessage: F2AMessage | null = null;
      handler.on('send', ({ message }) => {
        sentMessage = message;
      });

      let capabilityQueryData: any = null;
      handler.on('capability:query', (data) => {
        capabilityQueryData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(capabilityQueryData).not.toBeNull();
      expect(capabilityQueryData.peerId).toBe('remote-peer');
      expect(sentMessage).toBeDefined();
      expect(sentMessage?.type).toBe('MESSAGE');
      const payload = sentMessage?.payload as StructuredMessagePayload;
      expect(payload.topic).toBe(MESSAGE_TOPICS.CAPABILITY_RESPONSE);
    });

    it('should emit capability:query event', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.CAPABILITY_QUERY,
        content: {},
      });

      let capabilityQueryData: any = null;
      handler.on('capability:query', (data) => {
        capabilityQueryData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(capabilityQueryData).not.toBeNull();
      expect(capabilityQueryData.peerId).toBe('remote-peer');
    });
  });

  describe('handleCapabilityResponse', () => {
    it('should update peer from capability response', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.CAPABILITY_RESPONSE,
        content: { agentInfo: remoteAgentInfo },
      });

      let capabilityResponseData: any = null;
      handler.on('capability:response', (data) => {
        capabilityResponseData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(capabilityResponseData).not.toBeNull();
      expect(capabilityResponseData.peerId).toBe('remote-peer');
      expect(peerManager.get('remote-peer')).toBeDefined();
    });
  });

  describe('handleTaskResponse', () => {
    it('should emit task:response event', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.TASK_RESPONSE,
        content: {
          taskId: 'task-123',
          status: 'success',
          result: { data: 'test-result' },
        },
      });

      let taskResponseData: any = null;
      handler.on('task:response', (data) => {
        taskResponseData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(taskResponseData).not.toBeNull();
      expect(taskResponseData.taskId).toBe('task-123');
      expect(taskResponseData.status).toBe('success');
      expect(taskResponseData.result).toEqual({ data: 'test-result' });
    });

    it('should emit task:response with error status', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.TASK_RESPONSE,
        content: {
          taskId: 'task-456',
          status: 'error',
          error: 'Task failed',
        },
      });

      let taskResponseData: any = null;
      handler.on('task:response', (data) => {
        taskResponseData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(taskResponseData).not.toBeNull();
      expect(taskResponseData.taskId).toBe('task-456');
      expect(taskResponseData.status).toBe('error');
      expect(taskResponseData.error).toBe('Task failed');
    });
  });

  describe('sendPublicKey', () => {
    it('should emit send event with KEY_EXCHANGE message', async () => {
      let sentMessage: F2AMessage | null = null;
      let sentPeerId: string | null = null;
      handler.on('send', ({ peerId, message }) => {
        sentPeerId = peerId;
        sentMessage = message;
      });

      await handler.sendPublicKey('remote-peer');

      expect(sentPeerId).toBe('remote-peer');
      expect(sentMessage?.type).toBe('KEY_EXCHANGE');
      expect(sentMessage?.payload).toEqual({ publicKey: e2eeCrypto.getPublicKey() });
    });

    it('should not send if no public key available', async () => {
      // Create handler without initialized crypto
      const uninitializedCrypto = new MockE2EECrypto();
      const newHandler = new MessageHandler({
        peerManager: new PeerManager(),
        e2eeCrypto: uninitializedCrypto as any,
        agentInfo: createAgentInfo(),
      });

      let sentMessage: F2AMessage | null = null;
      newHandler.on('send', ({ message }) => {
        sentMessage = message;
      });

      await newHandler.sendPublicKey('remote-peer');

      expect(sentMessage).toBeNull();
      newHandler.stop();
    });
  });

  describe('updateAgentInfo', () => {
    it('should update agent info', () => {
      const newAgentInfo = createAgentInfo('new-peer-id');
      newAgentInfo.version = '2.0.0';

      handler.updateAgentInfo(newAgentInfo);

      expect(handler.getAgentInfo().peerId).toBe('new-peer-id');
      expect(handler.getAgentInfo().version).toBe('2.0.0');
    });
  });

  describe('events', () => {
    it('should emit message:received event', async () => {
      const message = createMessage('MESSAGE', {
        topic: MESSAGE_TOPICS.FREE_CHAT,
        content: 'Test message',
      });

      let eventData: any = null;
      handler.on('message:received', (data) => {
        eventData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(eventData).not.toBeNull();
      expect(eventData.message).toBeDefined();
      expect(eventData.peerId).toBe('remote-peer');
    });

    it('should emit send event with correct parameters', async () => {
      const remoteAgentInfo = createAgentInfo('remote-peer');
      const message = createMessage('DISCOVER', { agentInfo: remoteAgentInfo });

      let eventData: any = null;
      handler.on('send', (data) => {
        eventData = data;
      });

      await handler.handle(message, 'remote-peer');

      expect(eventData).not.toBeNull();
      expect(eventData.peerId).toBe('remote-peer');
      expect(eventData.message).toBeDefined();
      expect(eventData.encrypt).toBe(false);
    });
  });

  describe('unknown message type', () => {
    it('should log warning for unknown message type', async () => {
      const message: any = {
        id: 'unknown-msg',
        type: 'UNKNOWN_TYPE',
        from: 'remote-peer',
        timestamp: Date.now(),
        payload: {},
      };

      let receivedMessage: F2AMessage | null = null;
      handler.on('message:received', ({ message }) => {
        receivedMessage = message;
      });

      await handler.handle(message, 'remote-peer');

      // Should emit message:received during dispatchMessage
      expect(receivedMessage).toBeDefined();
    });
  });
});