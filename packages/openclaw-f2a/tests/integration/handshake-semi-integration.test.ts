/**
 * HandshakeProtocol 半集成测试
 * 
 * 测试真实的握手逻辑，但使用模拟的网络传输。
 * 这样可以在单机环境下验证完整流程。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HandshakeProtocol, HANDSHAKE_MESSAGE_TYPES } from '../../src/handshake-protocol.js';
import { ContactManager } from '../../src/contact-manager.js';
import { FriendStatus } from '../../src/contact-types.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('HandshakeProtocol 半集成测试', () => {
  let tempDir1: string;
  let tempDir2: string;
  let contactManager1: ContactManager;
  let contactManager2: ContactManager;
  let protocol1: HandshakeProtocol;
  let protocol2: HandshakeProtocol;

  beforeEach(() => {
    tempDir1 = mkdtempSync(join(tmpdir(), 'handshake-1-'));
    tempDir2 = mkdtempSync(join(tmpdir(), 'handshake-2-'));

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    contactManager1 = new ContactManager(tempDir1, logger);
    contactManager2 = new ContactManager(tempDir2, logger);

    // 消息处理器存储
    const messageHandlers1: Map<string, Function> = new Map();
    const messageHandlers2: Map<string, Function> = new Map();

    // 模拟 F2A 实例 - 直接传递消息
    const mockF2A1 = {
      peerId: '12D3KooW' + 'A'.repeat(44),
      agentInfo: { displayName: 'Node1' },
      getCapabilities: () => [{ name: 'test-cap', description: 'Test' }],
      on: (event: string, handler: Function) => {
        messageHandlers1.set(event, handler);
      },
      sendMessage: async (peerId: string, content: string, metadata?: any) => {
        // 直接调用 Node2 的处理器
        const handler = messageHandlers2.get('message');
        if (handler) {
          setTimeout(() => {
            handler({ from: '12D3KooW' + 'A'.repeat(44), content, metadata });
          }, 10);
        }
        return { success: true };
      },
    };

    const mockF2A2 = {
      peerId: '12D3KooW' + 'B'.repeat(44),
      agentInfo: { displayName: 'Node2' },
      getCapabilities: () => [{ name: 'test-cap', description: 'Test' }],
      on: (event: string, handler: Function) => {
        messageHandlers2.set(event, handler);
      },
      sendMessage: async (peerId: string, content: string, metadata?: any) => {
        // 直接调用 Node1 的处理器
        const handler = messageHandlers1.get('message');
        if (handler) {
          setTimeout(() => {
            handler({ from: '12D3KooW' + 'B'.repeat(44), content, metadata });
          }, 10);
        }
        return { success: true };
      },
    };

    protocol1 = new HandshakeProtocol(mockF2A1 as any, contactManager1, logger);
    protocol2 = new HandshakeProtocol(mockF2A2 as any, contactManager2, logger);
  });

  afterEach(() => {
    if (existsSync(tempDir1)) rmSync(tempDir1, { recursive: true, force: true });
    if (existsSync(tempDir2)) rmSync(tempDir2, { recursive: true, force: true });
  });

  describe('完整握手流程', () => {
    it('应该完成发送-接收-接受流程', async () => {
      const peerId2 = '12D3KooW' + 'B'.repeat(44);
      
      // 1. Node1 发送好友请求
      const requestId = await protocol1.sendFriendRequest(peerId2, 'Hello!');
      expect(requestId).toBeDefined();
      expect(requestId!.startsWith('req-')).toBe(true);
      
      // 2. 等待消息传递和处理
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 3. Node2 应该收到请求
      const pending = contactManager2.getPendingHandshakes();
      expect(pending.length).toBe(1);
      expect(pending[0].fromName).toBe('Node1');
      expect(pending[0].message).toBe('Hello!');
      
      // 4. Node2 接受请求
      const acceptSuccess = await protocol2.acceptRequest(pending[0].requestId);
      expect(acceptSuccess).toBe(true);
      
      // 5. 等待响应传递
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 6. 双方应该成为好友
      const friends1 = contactManager1.getContactsByStatus(FriendStatus.FRIEND);
      const friends2 = contactManager2.getContactsByStatus(FriendStatus.FRIEND);
      
      expect(friends1.length).toBe(1);
      expect(friends2.length).toBe(1);
      expect(friends1[0].name).toBe('Node2');
      expect(friends2[0].name).toBe('Node1');
    }, 10000);

    it('应该完成发送-接收-拒绝流程', async () => {
      const peerId2 = '12D3KooW' + 'B'.repeat(44);
      
      // 1. Node1 发送好友请求
      const requestId = await protocol1.sendFriendRequest(peerId2, 'Be my friend?');
      expect(requestId).toBeDefined();
      
      // 2. 等待消息传递
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 3. Node2 收到请求
      const pending = contactManager2.getPendingHandshakes();
      expect(pending.length).toBe(1);
      
      // 4. Node2 拒绝请求
      const rejectSuccess = await protocol2.rejectRequest(pending[0].requestId, 'No thanks');
      expect(rejectSuccess).toBe(true);
      
      // 5. 等待响应传递
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 6. 双方不应该成为好友
      const friends1 = contactManager1.getContactsByStatus(FriendStatus.FRIEND);
      const friends2 = contactManager2.getContactsByStatus(FriendStatus.FRIEND);
      
      expect(friends1.length).toBe(0);
      expect(friends2.length).toBe(0);
    }, 10000);
  });

  describe('数据持久化', () => {
    it('请求数据应该持久化到磁盘', async () => {
      const peerId2 = '12D3KooW' + 'B'.repeat(44);
      
      await protocol1.sendFriendRequest(peerId2, 'Test persistence');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 重新加载 ContactManager
      const newManager = new ContactManager(tempDir2, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
      const pending = newManager.getPendingHandshakes();
      
      expect(pending.length).toBe(1);
      expect(pending[0].message).toBe('Test persistence');
    }, 5000);

    it('好友关系应该持久化到磁盘', async () => {
      const peerId2 = '12D3KooW' + 'B'.repeat(44);
      
      await protocol1.sendFriendRequest(peerId2, 'Hi');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const pending = contactManager2.getPendingHandshakes();
      await protocol2.acceptRequest(pending[0].requestId);
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 重新加载 ContactManager
      const newManager = new ContactManager(tempDir2, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
      const friends = newManager.getContactsByStatus(FriendStatus.FRIEND);
      
      expect(friends.length).toBe(1);
      expect(friends[0].name).toBe('Node1');
    }, 5000);
  });
});