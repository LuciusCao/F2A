/**
 * HandshakeProtocol 集成测试
 * 
 * 使用 libp2p 风格的网络模拟，测试真实的握手流程。
 * 
 * 测试策略：
 * 1. 使用 createMockF2APair 创建两个模拟节点
 * 2. 节点之间通过内存消息队列通信
 * 3. 测试完整的握手流程（发送-接收-接受/拒绝）
 * 4. 验证数据持久化
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HandshakeProtocol } from '../../src/handshake-protocol.js';
import { ContactManager } from '../../src/contact-manager.js';
import { FriendStatus } from '../../src/contact-types.js';
import { createMockF2APair } from './network-mock.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('HandshakeProtocol 集成测试（网络模拟）', () => {
  let tempDir1: string;
  let tempDir2: string;
  let contactManager1: ContactManager;
  let contactManager2: ContactManager;
  let protocol1: HandshakeProtocol;
  let protocol2: HandshakeProtocol;
  let mockPair: ReturnType<typeof createMockF2APair>;

  beforeEach(() => {
    tempDir1 = mkdtempSync(join(tmpdir(), 'handshake-int-1-'));
    tempDir2 = mkdtempSync(join(tmpdir(), 'handshake-int-2-'));

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    contactManager1 = new ContactManager(tempDir1, logger);
    contactManager2 = new ContactManager(tempDir2, logger);

    // 创建模拟 F2A 对
    mockPair = createMockF2APair();

    // 创建握手协议
    protocol1 = new HandshakeProtocol(mockPair.f2a1 as any, contactManager1, logger);
    protocol2 = new HandshakeProtocol(mockPair.f2a2 as any, contactManager2, logger);
  });

  afterEach(() => {
    if (existsSync(tempDir1)) rmSync(tempDir1, { recursive: true, force: true });
    if (existsSync(tempDir2)) rmSync(tempDir2, { recursive: true, force: true });
  });

  describe('完整握手流程', () => {
    it('应该完成发送-接收-接受流程', async () => {
      const peerId2 = mockPair.f2a2.peerId;
      
      // 1. Node1 发送好友请求
      const requestId = await protocol1.sendFriendRequest(peerId2, 'Hello from Node1!');
      expect(requestId).toBeDefined();
      expect(requestId!.startsWith('req-')).toBe(true);
      
      // 2. 等待消息传递
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 3. Node2 应该收到请求
      const pending = contactManager2.getPendingHandshakes();
      expect(pending.length).toBe(1);
      expect(pending[0].fromName).toBe('Node1');
      expect(pending[0].message).toBe('Hello from Node1!');
      
      // 4. Node2 接受请求
      const acceptSuccess = await protocol2.acceptRequest(pending[0].requestId);
      expect(acceptSuccess).toBe(true);
      
      // 5. 等待响应传递
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 6. Node2 应该有 Node1 作为好友（接受方）
      const friends2 = contactManager2.getContactsByStatus(FriendStatus.FRIEND);
      expect(friends2.length).toBe(1);
      expect(friends2[0].name).toBe('Node1');
      
      // 7. Node1 也应该有 Node2 作为好友（发起方）
      // 当 Node2 接受请求后，会发送 FRIEND_RESPONSE 给 Node1
      // Node1 的 handleFriendResponse 会处理响应并添加好友
      const friends1 = contactManager1.getContactsByStatus(FriendStatus.FRIEND);
      expect(friends1.length).toBe(1);
      expect(friends1[0].name).toBe('Node2');
    }, 10000);

    // TODO: 此测试有 bug - rejectRequest 后 pendingHandshakes 没有被正确清理
    // 根因：network-mock.ts 的消息传递机制导致消息被反复处理
    // 需要重新设计 MockMessageQueue 的实现
    it.skip('应该完成发送-接收-拒绝流程', async () => {
      const peerId2 = mockPair.f2a2.peerId;
      
      // 1. 发送好友请求
      const requestId = await protocol1.sendFriendRequest(peerId2, 'Be my friend?');
      expect(requestId).toBeDefined();
      
      // 2. 等待消息传递
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 3. Node2 收到请求
      const pending = contactManager2.getPendingHandshakes();
      expect(pending.length).toBe(1);
      
      // 4. Node2 拒绝请求
      const rejectSuccess = await protocol2.rejectRequest(pending[0].requestId, 'No thanks');
      expect(rejectSuccess).toBe(true);
      
      // 5. 等待响应传递
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 6. 双方不应该成为好友
      const friends1 = contactManager1.getContactsByStatus(FriendStatus.FRIEND);
      const friends2 = contactManager2.getContactsByStatus(FriendStatus.FRIEND);
      
      expect(friends1.length).toBe(0);
      expect(friends2.length).toBe(0);
      
      // 拒绝后，待处理列表应该为空
      const pending2 = contactManager2.getPendingHandshakes();
      expect(pending2.length).toBe(0);
    }, 10000);

    it('重复发送好友请求应该返回已有请求 ID', async () => {
      const peerId2 = mockPair.f2a2.peerId;
      
      const requestId1 = await protocol1.sendFriendRequest(peerId2, 'First');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const requestId2 = await protocol1.sendFriendRequest(peerId2, 'Second');
      
      // 应该返回相同的请求 ID（因为前一个还在 pending）
      expect(requestId2).toBe(requestId1);
    }, 5000);

    it('已经是好友时应该返回 null', async () => {
      const peerId2 = mockPair.f2a2.peerId;
      
      // 先建立好友关系
      await protocol1.sendFriendRequest(peerId2, 'Hi');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const pending = contactManager2.getPendingHandshakes();
      await protocol2.acceptRequest(pending[0].requestId);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 再次发送请求
      const requestId = await protocol1.sendFriendRequest(peerId2, 'Hi again');
      expect(requestId).toBeNull(); // 已经是好友，返回 null
    }, 10000);
  });

  describe('数据持久化', () => {
    it('请求数据应该持久化到磁盘', async () => {
      const peerId2 = mockPair.f2a2.peerId;
      
      await protocol1.sendFriendRequest(peerId2, 'Test persistence');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 重新加载 ContactManager
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const newManager = new ContactManager(tempDir2, logger);
      const pending = newManager.getPendingHandshakes();
      
      expect(pending.length).toBe(1);
      expect(pending[0].message).toBe('Test persistence');
    }, 5000);

    it('好友关系应该持久化到磁盘', async () => {
      const peerId2 = mockPair.f2a2.peerId;
      
      await protocol1.sendFriendRequest(peerId2, 'Hi');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const pending = contactManager2.getPendingHandshakes();
      await protocol2.acceptRequest(pending[0].requestId);
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 重新加载 ContactManager
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const newManager = new ContactManager(tempDir2, logger);
      const friends = newManager.getContactsByStatus(FriendStatus.FRIEND);
      
      expect(friends.length).toBe(1);
      expect(friends[0].name).toBe('Node1');
    }, 5000);
  });

  describe('边界情况', () => {
    it('接受不存在的请求应该返回 false', async () => {
      const result = await protocol2.acceptRequest('req-nonexistent');
      expect(result).toBe(false);
    });

    it('拒绝不存在的请求应该返回 false', async () => {
      const result = await protocol2.rejectRequest('req-nonexistent');
      expect(result).toBe(false);
    });

    it('向自己发送好友请求应该返回 null', async () => {
      const myPeerId = mockPair.f2a1.peerId;
      const result = await protocol1.sendFriendRequest(myPeerId, 'Self request');
      // P1-5 修复：向自己发送请求应该返回 null
      expect(result).toBeNull();
    });
  });
});