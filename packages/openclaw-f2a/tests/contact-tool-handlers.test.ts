/**
 * ContactToolHandlers 测试
 * 
 * 测试通讯录工具处理器的各个方法。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContactToolHandlers } from '../src/contact-tool-handlers.js';
import { ContactManager } from '../src/contact-manager.js';
import { FriendStatus } from '../src/contact-types.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { 
  generateValidPeerId, 
  type F2APluginPublicInterface 
} from './utils/test-helpers.js';

// P0-3 修复：Mock plugin 使用类型推断
const createMockPlugin = (
  contactManager: ContactManager, 
  handshakeProtocol?: any, 
  f2a?: any
): F2APluginPublicInterface => {
  const defaultF2A = handshakeProtocol ? {
    getConnectedPeers: () => [],
    peerId: generateValidPeerId('Self'),
  } : undefined;
  
  return {
    getConfig: () => ({}),
    getApi: () => undefined,
    getNetworkClient: () => null,
    getReputationSystem: () => null,
    getNodeManager: () => null,
    getTaskQueue: () => null,
    getAnnouncementQueue: () => null,
    getReviewCommittee: () => undefined,
    getContactManager: () => contactManager,
    getHandshakeProtocol: () => handshakeProtocol,
    getF2AStatus: () => ({ 
      running: !!(f2a ?? defaultF2A), 
      peerId: f2a?.peerId ?? defaultF2A?.peerId 
    }),
    getF2A: () => f2a ?? defaultF2A,
    discoverAgents: async () => ({ success: false, error: { message: 'Not implemented' } }),
    getConnectedPeers: async () => ({ success: false, error: { message: 'Not implemented' } }),
    sendMessage: async () => ({ success: false, error: 'Not implemented' }),
    // P1-3 修复：添加握手协议方法
    sendFriendRequest: async (peerId: string, message?: string) => {
      return handshakeProtocol?.sendFriendRequest?.(peerId, message) ?? null;
    },
    acceptFriendRequest: async (requestId: string) => {
      return handshakeProtocol?.acceptRequest?.(requestId) ?? false;
    },
    rejectFriendRequest: async (requestId: string, reason?: string) => {
      return handshakeProtocol?.rejectRequest?.(requestId, reason) ?? false;
    },
  } as F2APluginPublicInterface;
};

// Mock SessionContext
const mockContext = {} as any;

describe('ContactToolHandlers', () => {
  let tempDir: string;
  let contactManager: ContactManager;
  let handlers: ContactToolHandlers;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'f2a-contact-test-'));
    contactManager = new ContactManager(tempDir);
    const mockPlugin = createMockPlugin(contactManager);
    handlers = new ContactToolHandlers(mockPlugin as any);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('handleContacts', () => {
    it('应该列出空通讯录', async () => {
      const result = await handlers.handleContacts({ action: 'list' }, mockContext);
      expect(result.content).toContain('通讯录');
      expect(result.content).toContain('0 个联系人');
    });

    it('应该列出联系人', async () => {
      contactManager.addContact({
        name: '测试联系人',
        peerId: generateValidPeerId('Test1'),
      });

      const result = await handlers.handleContacts({ action: 'list' }, mockContext);
      expect(result.content).toContain('测试联系人');
      expect(result.content).toContain('1 个联系人');
    });

    it('应该按状态过滤联系人', async () => {
      contactManager.addContact({
        name: '好友A',
        peerId: generateValidPeerId('Friend1'),
        status: FriendStatus.FRIEND,
      });
      contactManager.addContact({
        name: '陌生人B',
        peerId: generateValidPeerId('Stranger1'),
        status: FriendStatus.STRANGER,
      });

      const result = await handlers.handleContacts(
        { action: 'list', status: 'friend' },
        mockContext
      );
      expect(result.content).toContain('好友A');
      expect(result.content).not.toContain('陌生人B');
    });

    it('应该获取联系人详情', async () => {
      const contact = contactManager.addContact({
        name: '测试用户',
        peerId: generateValidPeerId('User1'),
        groups: ['测试组'],
        tags: ['测试标签'],
        notes: '测试备注',
      });

      const result = await handlers.handleContacts(
        { action: 'get', contact_id: contact!.id },
        mockContext
      );
      expect(result.content).toContain('测试用户');
      expect(result.content).toContain(contact!.id);
      expect(result.content).toContain('测试组');
      expect(result.content).toContain('测试标签');
      expect(result.content).toContain('测试备注');
    });

    it('应该通过 peer_id 获取联系人', async () => {
      const peerId = generateValidPeerId('ByPeerId1');
      contactManager.addContact({
        name: '通过Peer获取',
        peerId,
      });

      const result = await handlers.handleContacts(
        { action: 'get', peer_id: peerId },
        mockContext
      );
      expect(result.content).toContain('通过Peer获取');
    });

    it('应该拒绝缺少 ID 的获取请求', async () => {
      const result = await handlers.handleContacts({ action: 'get' }, mockContext);
      expect(result.content).toContain('❌');
      expect(result.content).toContain('需要提供');
    });

    it('应该提示不存在联系人', async () => {
      const result = await handlers.handleContacts(
        { action: 'get', contact_id: 'non-existent' },
        mockContext
      );
      expect(result.content).toContain('❌');
      expect(result.content).toContain('不存在');
    });

    it('应该添加联系人', async () => {
      const result = await handlers.handleContacts(
        {
          action: 'add',
          peer_id: generateValidPeerId('New1'),
          name: '新联系人',
        },
        mockContext
      );
      expect(result.content).toContain('✅');
      expect(result.content).toContain('新联系人');

      // 验证已添加
      const contacts = contactManager.getContacts();
      expect(contacts.length).toBe(1);
      expect(contacts[0].name).toBe('新联系人');
    });

    it('应该拒绝缺少必要信息的添加', async () => {
      const result = await handlers.handleContacts(
        { action: 'add', name: '只有名字' },
        mockContext
      );
      expect(result.content).toContain('❌');
    });

    it('应该删除联系人', async () => {
      const contact = contactManager.addContact({
        name: '待删除',
        peerId: generateValidPeerId('Delete1'),
      });

      const result = await handlers.handleContacts(
        { action: 'remove', contact_id: contact!.id },
        mockContext
      );
      expect(result.content).toContain('✅');

      // 验证已删除
      expect(contactManager.getContacts().length).toBe(0);
    });

    it('应该通过 peer_id 删除联系人', async () => {
      const peerId = generateValidPeerId('RemoveByPeer');
      contactManager.addContact({ name: '待删除', peerId });

      const result = await handlers.handleContacts(
        { action: 'remove', peer_id: peerId },
        mockContext
      );
      expect(result.content).toContain('✅');
    });

    it('应该更新联系人', async () => {
      const contact = contactManager.addContact({
        name: '旧名字',
        peerId: generateValidPeerId('Update1'),
      });

      const result = await handlers.handleContacts(
        {
          action: 'update',
          contact_id: contact!.id,
          name: '新名字',
          notes: '更新后的备注',
        },
        mockContext
      );
      expect(result.content).toContain('✅');
      expect(result.content).toContain('新名字');

      // 验证已更新
      const updated = contactManager.getContact(contact!.id);
      expect(updated?.name).toBe('新名字');
      expect(updated?.notes).toBe('更新后的备注');
    });

    it('应该拉黑联系人', async () => {
      const contact = contactManager.addContact({
        name: '待拉黑',
        peerId: generateValidPeerId('Block1'),
      });

      const result = await handlers.handleContacts(
        { action: 'block', contact_id: contact!.id },
        mockContext
      );
      expect(result.content).toContain('✅');

      const blocked = contactManager.getContact(contact!.id);
      expect(blocked?.status).toBe(FriendStatus.BLOCKED);
    });

    it('应该解除拉黑', async () => {
      const contact = contactManager.addContact({
        name: '已拉黑',
        peerId: generateValidPeerId('Blocked1'),
        status: FriendStatus.BLOCKED,
      });

      const result = await handlers.handleContacts(
        { action: 'unblock', contact_id: contact!.id },
        mockContext
      );
      expect(result.content).toContain('✅');

      const unblocked = contactManager.getContact(contact!.id);
      expect(unblocked?.status).toBe(FriendStatus.STRANGER);
    });
  });

  describe('handleContactGroups', () => {
    it('应该列出空分组', async () => {
      const result = await handlers.handleContactGroups({ action: 'list' }, mockContext);
      expect(result.content).toContain('分组列表');
    });

    it('应该创建分组', async () => {
      const result = await handlers.handleContactGroups(
        { action: 'create', name: '测试分组', description: '测试描述' },
        mockContext
      );
      expect(result.content).toContain('✅');
      expect(result.content).toContain('测试分组');

      const groups = contactManager.getGroups();
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.some(g => g.name === '测试分组')).toBe(true);
    });

    it('应该拒绝缺少名称的创建', async () => {
      const result = await handlers.handleContactGroups({ action: 'create' }, mockContext);
      expect(result.content).toContain('❌');
    });

    it('应该更新分组', async () => {
      const group = contactManager.createGroup({ name: '旧分组名' });

      const result = await handlers.handleContactGroups(
        { action: 'update', group_id: group!.id, name: '新分组名' },
        mockContext
      );
      expect(result.content).toContain('✅');
      expect(result.content).toContain('新分组名');
    });

    it('应该删除分组', async () => {
      const group = contactManager.createGroup({ name: '待删除分组' });

      const result = await handlers.handleContactGroups(
        { action: 'delete', group_id: group!.id },
        mockContext
      );
      expect(result.content).toContain('✅');
    });
  });

  describe('handleContactsExport', () => {
    it('应该导出通讯录', async () => {
      contactManager.addContact({
        name: '导出测试',
        peerId: generateValidPeerId('Export1'),
      });

      const result = await handlers.handleContactsExport({}, mockContext);
      expect(result.content).toContain('导出成功');
      expect(result.content).toContain('1 个');
      expect(result.data).toBeDefined();
    });
  });

  describe('handleContactsImport', () => {
    it('应该导入通讯录', async () => {
      const importData = {
        contacts: [{
          id: 'import-1',
          name: '导入联系人',
          peerId: generateValidPeerId('Import1'),
          status: FriendStatus.STRANGER,
          reputation: 50,
          groups: [],
          tags: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
        groups: [],
        exportedAt: Date.now(),
        exportedBy: 'test',
      };

      const result = await handlers.handleContactsImport(
        { data: importData, merge: true },
        mockContext
      );
      expect(result.content).toContain('导入完成');
      expect(result.content).toContain('1 个');

      // 验证已导入
      expect(contactManager.getContacts().length).toBeGreaterThan(0);
    });

    it('应该处理导入失败', async () => {
      const result = await handlers.handleContactsImport(
        { data: { invalid: true } as any },
        mockContext
      );
      expect(result.content).toContain('❌');
    });
  });

  describe('handleFriendRequest', () => {
    it('应该拒绝未初始化的请求', async () => {
      const result = await handlers.handleFriendRequest(
        { peer_id: generateValidPeerId('Target1') },
        mockContext
      );
      expect(result.content).toContain('❌');
      expect(result.content).toContain('未初始化');
    });

    // P1-3 修复：添加成功场景测试
    it('应该成功发送好友请求', async () => {
      // Mock handshakeProtocol
      const mockHandshakeProtocol = {
        sendFriendRequest: async (peerId: string, message?: string) => {
          return `req-${peerId.slice(0, 8)}-${Date.now()}`;
        },
      };

      const mockPlugin = createMockPlugin(contactManager, mockHandshakeProtocol);
      const handlersWithMock = new ContactToolHandlers(mockPlugin as any);

      const peerId = generateValidPeerId('TargetSuccess');
      const result = await handlersWithMock.handleFriendRequest(
        { peer_id: peerId, message: '你好，请加好友' },
        mockContext
      );

      expect(result.content).toContain('✅');
      expect(result.content).toContain('好友请求已发送');
      expect(result.content).toContain('请求 ID');
    });

    // P1-3 修复：添加截断匹配验证测试
    it('应该拒绝截断匹配后的无效 Peer ID', async () => {
      // Mock F2A 返回无效的 Peer ID
      const mockF2A = {
        getConnectedPeers: () => [
          { peerId: 'InvalidPeerIdNotValid' }, // 不符合 12D3KooW + 44字符格式
        ],
        peerId: generateValidPeerId('Self'),
      };

      const mockHandshakeProtocol = {
        sendFriendRequest: async () => null,
      };

      const mockPlugin = createMockPlugin(contactManager, mockHandshakeProtocol, mockF2A);
      const handlersWithMock = new ContactToolHandlers(mockPlugin as any);

      // 传入截断的无效 ID
      const result = await handlersWithMock.handleFriendRequest(
        { peer_id: 'Invalid' }, // 会匹配到 InvalidPeerIdNotValid
        mockContext
      );

      expect(result.content).toContain('❌');
      expect(result.content).toContain('无效的 Peer ID 格式');
    });

    // P1-3 修复：添加发送失败场景测试
    it('应该处理发送失败', async () => {
      const mockHandshakeProtocol = {
        sendFriendRequest: async () => null, // 返回 null 表示失败
      };

      const mockPlugin = createMockPlugin(contactManager, mockHandshakeProtocol);
      const handlersWithMock = new ContactToolHandlers(mockPlugin as any);

      const peerId = generateValidPeerId('TargetFail');
      const result = await handlersWithMock.handleFriendRequest(
        { peer_id: peerId },
        mockContext
      );

      expect(result.content).toContain('❌');
      expect(result.content).toContain('发送好友请求失败');
    });
  });

  describe('handlePendingRequests', () => {
    it('应该列出空请求', async () => {
      const result = await handlers.handlePendingRequests({ action: 'list' }, mockContext);
      expect(result.content).toContain('暂无');
    });

    it('应该拒绝未初始化的 accept', async () => {
      const result = await handlers.handlePendingRequests(
        { action: 'accept', request_id: 'req-1' },
        mockContext
      );
      expect(result.content).toContain('❌');
    });

    // P1-4 修复：添加 accept 成功场景测试
    it('应该成功接受好友请求', async () => {
      // 先添加一个待处理的请求
      const fromPeerId = generateValidPeerId('FromAccept');
      contactManager.addPendingHandshake({
        requestId: 'req-accept-test',
        from: fromPeerId,
        fromName: '请求者A',
        message: '请加我好友',
        receivedAt: Date.now(),
      });

      const mockHandshakeProtocol = {
        acceptRequest: async (requestId: string) => requestId === 'req-accept-test',
      };

      const mockPlugin = createMockPlugin(contactManager, mockHandshakeProtocol);
      const handlersWithMock = new ContactToolHandlers(mockPlugin as any);

      const result = await handlersWithMock.handlePendingRequests(
        { action: 'accept', request_id: 'req-accept-test' },
        mockContext
      );

      expect(result.content).toContain('✅');
      expect(result.content).toContain('已接受好友请求');
    });

    // P1-4 修复：添加 reject 成功场景测试
    it('应该成功拒绝好友请求', async () => {
      const fromPeerId = generateValidPeerId('FromReject');
      contactManager.addPendingHandshake({
        requestId: 'req-reject-test',
        from: fromPeerId,
        fromName: '请求者B',
        message: '请加我好友',
        receivedAt: Date.now(),
      });

      const mockHandshakeProtocol = {
        rejectRequest: async (requestId: string, reason?: string) => requestId === 'req-reject-test',
      };

      const mockPlugin = createMockPlugin(contactManager, mockHandshakeProtocol);
      const handlersWithMock = new ContactToolHandlers(mockPlugin as any);

      const result = await handlersWithMock.handlePendingRequests(
        { action: 'reject', request_id: 'req-reject-test', reason: '不需要' },
        mockContext
      );

      expect(result.content).toContain('✅');
      expect(result.content).toContain('已拒绝好友请求');
    });

    // P1-4 修复：添加 accept 失败场景测试
    it('应该处理接受失败', async () => {
      const mockHandshakeProtocol = {
        acceptRequest: async () => false, // 返回 false 表示失败
      };

      const mockPlugin = createMockPlugin(contactManager, mockHandshakeProtocol);
      const handlersWithMock = new ContactToolHandlers(mockPlugin as any);

      const result = await handlersWithMock.handlePendingRequests(
        { action: 'accept', request_id: 'req-accept-fail' },
        mockContext
      );

      expect(result.content).toContain('❌');
      expect(result.content).toContain('接受失败');
    });

    // P1-4 修复：添加 reject 失败场景测试
    it('应该处理拒绝失败', async () => {
      const mockHandshakeProtocol = {
        rejectRequest: async () => false, // 返回 false 表示失败
      };

      const mockPlugin = createMockPlugin(contactManager, mockHandshakeProtocol);
      const handlersWithMock = new ContactToolHandlers(mockPlugin as any);

      const result = await handlersWithMock.handlePendingRequests(
        { action: 'reject', request_id: 'req-reject-fail' },
        mockContext
      );

      expect(result.content).toContain('❌');
      expect(result.content).toContain('拒绝失败');
    });
  });
});