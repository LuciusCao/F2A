/**
 * HandshakeProtocol 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HandshakeProtocol, HANDSHAKE_MESSAGE_TYPES } from '../src/handshake-protocol.js';
import { ContactManager } from '../src/contact-manager.js';
import { FriendStatus } from '../src/contact-types.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('HandshakeProtocol', () => {
  let tempDir: string;
  let contactManager: ContactManager;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let mockF2A: {
    peerId: string;
    agentInfo: { displayName: string };
    getCapabilities: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  let protocol: HandshakeProtocol;
  let messageHandlers: Map<string, (msg: any) => void>;

  beforeEach(() => {
    // 创建临时目录
    tempDir = mkdtempSync(join(tmpdir(), 'handshake-protocol-test-'));
    
    // Mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    
    // 创建联系人管理器
    contactManager = new ContactManager(tempDir, mockLogger);
    
    // 存储事件处理器
    messageHandlers = new Map();
    
    // Mock F2A 实例
    mockF2A = {
      peerId: '12D3KooW' + 'A'.repeat(44),
      agentInfo: { displayName: 'TestAgent' },
      getCapabilities: vi.fn(() => [
        { name: 'test-capability', description: 'Test capability', tools: ['tool1'] }
      ]),
      on: vi.fn((event, handler) => {
        messageHandlers.set(event, handler);
      }),
      sendMessage: vi.fn(async () => ({ success: true })),
    };
    
    protocol = new HandshakeProtocol(
      mockF2A as any,
      contactManager,
      mockLogger
    );
  });

  afterEach(() => {
    // 清理临时目录
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('初始化', () => {
    it('应该注册消息处理器', () => {
      expect(mockF2A.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('如果 F2A 不支持 on 方法应记录错误', () => {
      const badF2A = { peerId: 'test' };
      const badLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      
      new HandshakeProtocol(badF2A as any, contactManager, badLogger);
      
      expect(badLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('不支持 on 方法')
      );
    });
  });

  describe('sendFriendRequest', () => {
    it('应该成功发送好友请求', async () => {
      const targetPeerId = '12D3KooW' + 'B'.repeat(44);
      
      const requestId = await protocol.sendFriendRequest(targetPeerId, 'Hello!');
      
      expect(requestId).toBeDefined();
      expect(requestId).toMatch(/^req-/);
      expect(mockF2A.sendMessage).toHaveBeenCalledWith(
        targetPeerId,
        expect.any(String),
        { type: 'handshake' }
      );
      
      // 验证发送的消息内容
      const sentMessage = JSON.parse(mockF2A.sendMessage.mock.calls[0][1]);
      expect(sentMessage.type).toBe(HANDSHAKE_MESSAGE_TYPES.FRIEND_REQUEST);
      expect(sentMessage.fromName).toBe('TestAgent');
      expect(sentMessage.message).toBe('Hello!');
    });

    it('如果已是好友应返回 null', async () => {
      const targetPeerId = '12D3KooW' + 'C'.repeat(44);
      
      // 添加为好友
      const contact = contactManager.addContact({ name: 'Friend', peerId: targetPeerId });
      contactManager.updateContact(contact!.id, { status: FriendStatus.FRIEND });
      
      const requestId = await protocol.sendFriendRequest(targetPeerId);
      
      expect(requestId).toBeNull();
      expect(mockF2A.sendMessage).not.toHaveBeenCalled();
    });

    it('如果被拉黑应返回 null', async () => {
      const targetPeerId = '12D3KooW' + 'D'.repeat(44);
      
      // 添加并拉黑
      const contact = contactManager.addContact({ name: 'Blocked', peerId: targetPeerId });
      contactManager.blockContact(contact!.id);
      
      const requestId = await protocol.sendFriendRequest(targetPeerId);
      
      expect(requestId).toBeNull();
    });

    it('发送失败应返回 null', async () => {
      mockF2A.sendMessage.mockResolvedValue({ success: false, error: 'Connection failed' });
      
      const targetPeerId = '12D3KooW' + 'E'.repeat(44);
      const requestId = await protocol.sendFriendRequest(targetPeerId);
      
      expect(requestId).toBeNull();
    });

    it('如果已发送请求应返回已有请求 ID', async () => {
      const targetPeerId = '12D3KooW' + 'F'.repeat(44);
      
      const firstRequestId = await protocol.sendFriendRequest(targetPeerId);
      const secondRequestId = await protocol.sendFriendRequest(targetPeerId);
      
      expect(secondRequestId).toBe(firstRequestId);
      expect(mockF2A.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('发送后应将联系人状态设为 pending', async () => {
      const targetPeerId = '12D3KooW' + 'G'.repeat(44);
      
      await protocol.sendFriendRequest(targetPeerId);
      
      const contact = contactManager.getContactByPeerId(targetPeerId);
      expect(contact!.status).toBe(FriendStatus.PENDING);
    });
  });

  describe('处理消息', () => {
    it('应该处理好友请求消息', async () => {
      const fromPeerId = '12D3KooW' + 'X'.repeat(44);
      const requestMessage = {
        type: HANDSHAKE_MESSAGE_TYPES.FRIEND_REQUEST,
        requestId: 'req-test-1',
        fromName: 'Requester',
        capabilities: [{ name: 'test' }],
        timestamp: Date.now(),
        message: 'Hi!',
      };
      
      // 触发消息处理器
      const handler = messageHandlers.get('message');
      await handler!({
        from: fromPeerId,
        content: JSON.stringify(requestMessage),
        metadata: { type: 'handshake' },
        messageId: 'msg-1',
      });
      
      // 应该添加待处理请求
      const pending = contactManager.getPendingHandshakes();
      expect(pending).toHaveLength(1);
      expect(pending[0].fromName).toBe('Requester');
    });

    it('应该处理好友响应消息（接受）', async () => {
      // 先发送请求
      const targetPeerId = '12D3KooW' + 'Y'.repeat(44);
      const requestId = await protocol.sendFriendRequest(targetPeerId);
      
      // 模拟收到接受响应
      const responseMessage = {
        type: HANDSHAKE_MESSAGE_TYPES.FRIEND_RESPONSE,
        requestId,
        accepted: true,
        fromName: 'Responder',
        capabilities: [{ name: 'response-cap' }],
        timestamp: Date.now(),
      };
      
      const handler = messageHandlers.get('message');
      await handler!({
        from: targetPeerId,
        content: JSON.stringify(responseMessage),
        metadata: { type: 'handshake' },
        messageId: 'msg-2',
      });
      
      // 应该成为好友
      const contact = contactManager.getContactByPeerId(targetPeerId);
      expect(contact!.status).toBe(FriendStatus.FRIEND);
      expect(contact!.name).toBe('Responder');
    });

    it('应该处理好友响应消息（拒绝）', async () => {
      const targetPeerId = '12D3KooW' + 'Z'.repeat(44);
      const requestId = await protocol.sendFriendRequest(targetPeerId);
      
      const responseMessage = {
        type: HANDSHAKE_MESSAGE_TYPES.FRIEND_RESPONSE,
        requestId,
        accepted: false,
        reason: 'Not interested',
        timestamp: Date.now(),
      };
      
      const handler = messageHandlers.get('message');
      await handler!({
        from: targetPeerId,
        content: JSON.stringify(responseMessage),
        metadata: { type: 'handshake' },
        messageId: 'msg-3',
      });
      
      // 不应该成为好友
      const contact = contactManager.getContactByPeerId(targetPeerId);
      expect(contact!.status).toBe(FriendStatus.PENDING); // 保持 pending 状态
    });

    it('应该忽略非握手消息', async () => {
      const handler = messageHandlers.get('message');
      
      await handler!({
        from: '12D3KooW' + 'I'.repeat(44),
        content: 'Hello',
        metadata: { type: 'chat' },
        messageId: 'msg-4',
      });
      
      expect(contactManager.getPendingHandshakes()).toHaveLength(0);
    });

    it('应该忽略无效 JSON', async () => {
      const handler = messageHandlers.get('message');
      
      await handler!({
        from: '12D3KooW' + 'J'.repeat(44),
        content: 'not json',
        metadata: { type: 'handshake' },
        messageId: 'msg-5',
      });
      
      expect(contactManager.getPendingHandshakes()).toHaveLength(0);
    });
  });

  describe('acceptRequest', () => {
    it('应该接受请求并发送响应', async () => {
      // 添加待处理请求
      contactManager.addPendingHandshake({
        requestId: 'req-accept-1',
        from: '12D3KooW' + 'K'.repeat(44),
        fromName: 'ToAccept',
        capabilities: [],
        receivedAt: Date.now(),
      });
      
      const success = await protocol.acceptRequest('req-accept-1');
      
      expect(success).toBe(true);
      expect(mockF2A.sendMessage).toHaveBeenCalled();
      
      // 应该成为好友
      const friends = contactManager.getContactsByStatus(FriendStatus.FRIEND);
      expect(friends).toHaveLength(1);
    });

    it('不存在的请求应返回 false', async () => {
      const success = await protocol.acceptRequest('non-existent');
      expect(success).toBe(false);
    });
  });

  describe('rejectRequest', () => {
    it('应该拒绝请求并发送响应', async () => {
      contactManager.addPendingHandshake({
        requestId: 'req-reject-1',
        from: '12D3KooW' + 'L'.repeat(44),
        fromName: 'ToReject',
        capabilities: [],
        receivedAt: Date.now(),
      });
      
      const success = await protocol.rejectRequest('req-reject-1', 'Not interested');
      
      expect(success).toBe(true);
      
      // 不应该添加联系人
      expect(contactManager.getContacts()).toHaveLength(0);
    });
  });

  describe('事件系统', () => {
    it('应该触发 request 事件', async () => {
      const handler = vi.fn();
      protocol.on('request', handler);
      
      const requestMessage = {
        type: HANDSHAKE_MESSAGE_TYPES.FRIEND_REQUEST,
        requestId: 'req-event-1',
        fromName: 'EventRequester',
        capabilities: [],
        timestamp: Date.now(),
      };
      
      const msgHandler = messageHandlers.get('message');
      await msgHandler!({
        from: '12D3KooW' + 'M'.repeat(44),
        content: JSON.stringify(requestMessage),
        metadata: { type: 'handshake' },
        messageId: 'msg-event-1',
      });
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('应该清理资源', async () => {
      // 发送一个请求
      await protocol.sendFriendRequest('12D3KooW' + 'N'.repeat(44));
      
      protocol.shutdown();
      
      // 尝试发送新请求应该失败
      const requestId = await protocol.sendFriendRequest('12D3KooW' + 'O'.repeat(44));
      expect(requestId).toBeNull();
    });

    it('关闭后应拒绝处理消息', async () => {
      protocol.shutdown();
      
      const requestMessage = {
        type: HANDSHAKE_MESSAGE_TYPES.FRIEND_REQUEST,
        requestId: 'req-shutdown-1',
        fromName: 'Shutdown',
        capabilities: [],
        timestamp: Date.now(),
      };
      
      const handler = messageHandlers.get('message');
      await handler!({
        from: '12D3KooW' + 'P'.repeat(44),
        content: JSON.stringify(requestMessage),
        metadata: { type: 'handshake' },
        messageId: 'msg-shutdown-1',
      });
      
      // 不应该添加请求
      expect(contactManager.getPendingHandshakes()).toHaveLength(0);
    });
  });

  describe('重试机制', () => {
    it('发送失败应重试', async () => {
      mockF2A.sendMessage
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });
      
      const requestId = await protocol.sendFriendRequest('12D3KooW' + 'Q'.repeat(44));
      
      expect(requestId).toBeDefined();
      expect(mockF2A.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('重试次数用尽应返回 null', async () => {
      mockF2A.sendMessage.mockRejectedValue(new Error('Persistent error'));
      
      const requestId = await protocol.sendFriendRequest('12D3KooW' + 'R'.repeat(44));
      
      expect(requestId).toBeNull();
      expect(mockF2A.sendMessage).toHaveBeenCalledTimes(3); // maxRetries = 3
    });
  });
});