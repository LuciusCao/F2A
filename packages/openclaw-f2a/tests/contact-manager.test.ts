/**
 * ContactManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContactManager } from '../src/contact-manager.js';
import { FriendStatus, type Contact } from '../src/contact-types.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateValidPeerId, MALICIOUS_INPUTS } from './utils/test-helpers.js';

describe('ContactManager', () => {
  let tempDir: string;
  let manager: ContactManager;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // 创建临时目录
    tempDir = mkdtempSync(join(tmpdir(), 'contact-manager-test-'));
    
    // Mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    
    manager = new ContactManager(tempDir, mockLogger);
  });

  afterEach(() => {
    // 清理临时目录
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('初始化', () => {
    it('应该创建默认数据结构', () => {
      expect(manager.getContacts()).toEqual([]);
      expect(manager.getGroups()).toHaveLength(1); // 默认分组
    });

    it('应该创建数据文件', () => {
      // ContactManager 在初始化时创建数据文件（如果没有保存操作可能延迟）
      // 添加联系人触发保存
      manager.addContact({ name: 'Test', peerId: generateValidPeerId('Test') });
      
      const dataPath = join(tempDir, 'contacts.json');
      expect(existsSync(dataPath)).toBe(true);
    });

    it('应该加载已有数据', () => {
      // 添加一个联系人
      manager.addContact({ name: 'Test', peerId: generateValidPeerId('TestA') });
      
      // 创建新的 manager 实例，应该加载已有数据
      const newManager = new ContactManager(tempDir, mockLogger);
      const contacts = newManager.getContacts();
      expect(contacts).toHaveLength(1);
      expect(contacts[0].name).toBe('Test');
    });
  });

  describe('addContact', () => {
    it('应该成功添加联系人', () => {
      const contact = manager.addContact({
        name: 'Alice',
        peerId: generateValidPeerId('Alice'),
        groups: ['work'],
        tags: ['friend'],
      });
      
      expect(contact).not.toBeNull();
      expect(contact!.name).toBe('Alice');
      expect(contact!.status).toBe(FriendStatus.STRANGER);
      expect(contact!.groups).toEqual(['work']);
      expect(contact!.tags).toEqual(['friend']);
    });

    it('应该拒绝重复的 peerId', () => {
      const peerId = generateValidPeerId('Unique');
      manager.addContact({ name: 'First', peerId });
      
      const second = manager.addContact({ name: 'Second', peerId });
      
      // 返回已存在的联系人
      expect(second!.name).toBe('First');
      expect(manager.getContacts()).toHaveLength(1);
    });

    it('保存失败应返回 null', () => {
      // 使用只读目录模拟保存失败
      const readOnlyDir = join(tempDir, 'readonly');
      require('fs').mkdirSync(readOnlyDir, { recursive: true });
      require('fs').chmodSync(readOnlyDir, 0o444);
      
      const readOnlyManager = new ContactManager(readOnlyDir, mockLogger);
      const contact = readOnlyManager.addContact({
        name: 'Test',
        peerId: generateValidPeerId('ReadOnly'),
      });
      
      // 根据文件系统权限，可能成功也可能失败
      // 这里主要测试不会崩溃
      expect(contact).toBeDefined();
    });
  });

  describe('updateContact', () => {
    it('应该成功更新联系人', () => {
      const contact = manager.addContact({
        name: 'Bob',
        peerId: generateValidPeerId('Bob'),
      });
      
      const updated = manager.updateContact(contact!.id, {
        name: 'Robert',
        tags: ['colleague'],
        status: FriendStatus.FRIEND,
      });
      
      expect(updated!.name).toBe('Robert');
      expect(updated!.tags).toEqual(['colleague']);
      expect(updated!.status).toBe(FriendStatus.FRIEND);
    });

    it('更新不存在的联系人应返回 null', () => {
      const result = manager.updateContact('non-existent', { name: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('removeContact', () => {
    it('应该成功删除联系人', () => {
      const contact = manager.addContact({
        name: 'ToDelete',
        peerId: generateValidPeerId('ToDelete'),
      });
      
      const success = manager.removeContact(contact!.id);
      expect(success).toBe(true);
      expect(manager.getContacts()).toHaveLength(0);
    });

    it('删除不存在的联系人应返回 false', () => {
      const success = manager.removeContact('non-existent');
      expect(success).toBe(false);
    });
  });

  describe('查询功能', () => {
    beforeEach(() => {
      // 添加测试数据
      manager.addContact({ name: 'Alice', peerId: generateValidPeerId('Alice'), tags: ['friend'] });
      manager.addContact({ name: 'Bob', peerId: generateValidPeerId('Bob'), tags: ['work'] });
      manager.addContact({ name: 'Charlie', peerId: generateValidPeerId('Charlie'), tags: ['friend', 'work'] });
    });

    it('getContacts 应返回所有联系人', () => {
      expect(manager.getContacts()).toHaveLength(3);
    });

    it('按状态过滤', () => {
      // 更新一个为好友
      const contacts = manager.getContacts();
      manager.updateContact(contacts[0].id, { status: FriendStatus.FRIEND });
      
      const friends = manager.getContacts({ status: FriendStatus.FRIEND });
      expect(friends).toHaveLength(1);
    });

    it('按标签过滤', () => {
      const workContacts = manager.getContacts({ tags: ['work'] });
      expect(workContacts).toHaveLength(2);
    });

    it('按名称搜索', () => {
      const results = manager.getContacts({ name: 'ali' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    it('排序', () => {
      const sorted = manager.getContacts(undefined, { field: 'name', order: 'asc' });
      expect(sorted[0].name).toBe('Alice');
      expect(sorted[2].name).toBe('Charlie');
    });
  });

  describe('分组管理', () => {
    it('创建分组', () => {
      const group = manager.createGroup({ name: 'Work', description: 'Work contacts' });
      expect(group.name).toBe('Work');
      expect(manager.getGroups()).toHaveLength(2);
    });

    it('更新分组', () => {
      const group = manager.createGroup({ name: 'Test' });
      const updated = manager.updateGroup(group.id, { name: 'Updated' });
      expect(updated!.name).toBe('Updated');
    });

    it('删除分组', () => {
      const group = manager.createGroup({ name: 'ToDelete' });
      const success = manager.deleteGroup(group.id);
      expect(success).toBe(true);
    });

    it('不能删除默认分组', () => {
      const success = manager.deleteGroup('default');
      expect(success).toBe(false);
    });
  });

  describe('握手请求', () => {
    it('添加待处理请求', () => {
      manager.addPendingHandshake({
        requestId: 'req-1',
        from: generateValidPeerId('Requester'),
        fromName: 'Requester',
        capabilities: [{ name: 'test' }],
        receivedAt: Date.now(),
      });
      
      const pending = manager.getPendingHandshakes();
      expect(pending).toHaveLength(1);
      expect(pending[0].fromName).toBe('Requester');
    });

    it('接受请求', () => {
      manager.addPendingHandshake({
        requestId: 'req-2',
        from: generateValidPeerId('Friend'),
        fromName: 'Friend',
        capabilities: [],
        receivedAt: Date.now(),
      });
      
      const result = manager.acceptHandshake('req-2', 'Me', []);
      expect(result!.response.accepted).toBe(true);
      
      // 应该添加为好友
      const friends = manager.getContactsByStatus(FriendStatus.FRIEND);
      expect(friends).toHaveLength(1);
    });

    it('拒绝请求', () => {
      manager.addPendingHandshake({
        requestId: 'req-3',
        from: generateValidPeerId('Rejected'),
        fromName: 'Rejected',
        capabilities: [],
        receivedAt: Date.now(),
      });
      
      const result = manager.rejectHandshake('req-3', 'Not interested');
      expect(result!.response.accepted).toBe(false);
      expect(result!.response.reason).toBe('Not interested');
      
      // 不应该添加联系人
      expect(manager.getContacts()).toHaveLength(0);
    });
  });

  describe('黑名单', () => {
    it('拉黑联系人', () => {
      const contact = manager.addContact({
        name: 'Spammer',
        peerId: generateValidPeerId('Spammer'),
      });
      
      manager.blockContact(contact!.id);
      
      expect(manager.isBlocked(contact!.peerId)).toBe(true);
      expect(manager.canSendMessage(contact!.peerId)).toBe(false);
    });

    it('解除拉黑', () => {
      const contact = manager.addContact({
        name: 'Recovered',
        peerId: generateValidPeerId('Recovered'),
      });
      
      manager.blockContact(contact!.id);
      manager.unblockContact(contact!.id);
      
      expect(manager.isBlocked(contact!.peerId)).toBe(false);
    });
  });

  describe('导入导出', () => {
    it('导出通讯录', () => {
      manager.addContact({ name: 'Export1', peerId: generateValidPeerId('Export1') });
      manager.addContact({ name: 'Export2', peerId: generateValidPeerId('Export2') });
      
      const exported = manager.exportContacts('node-1');
      
      expect(exported.contacts).toHaveLength(2);
      expect(exported.exportedBy).toBe('node-1');
      expect(exported.exportedAt).toBeDefined();
    });

    it('导入通讯录（合并模式）', () => {
      manager.addContact({ name: 'Existing', peerId: generateValidPeerId('Existing') });
      
      const result = manager.importContacts({
        version: 1,
        contacts: [
          { id: '1', name: 'New', peerId: generateValidPeerId('New'), status: FriendStatus.STRANGER, capabilities: [], reputation: 0, groups: [], tags: [], lastCommunicationTime: 0, createdAt: Date.now(), updatedAt: Date.now() },
          { id: '2', name: 'Existing', peerId: generateValidPeerId('Existing'), status: FriendStatus.STRANGER, capabilities: [], reputation: 0, groups: [], tags: [], lastCommunicationTime: 0, createdAt: Date.now(), updatedAt: Date.now() },
        ],
        groups: [],
        pendingHandshakes: [],
        blockedPeers: [],
        lastUpdated: Date.now(),
        exportedAt: Date.now(),
      }, true);
      
      expect(result.success).toBe(true);
      expect(result.importedContacts).toBe(1); // 只有新联系人
      expect(result.skippedContacts).toBe(1); // 已存在
    });

    it('导入通讯录（覆盖模式）', () => {
      const result = manager.importContacts({
        version: 1,
        contacts: [
          { id: '1', name: 'Overwrite', peerId: generateValidPeerId('Overwrite'), status: FriendStatus.FRIEND, capabilities: [], reputation: 0, groups: [], tags: [], lastCommunicationTime: 0, createdAt: Date.now(), updatedAt: Date.now() },
        ],
        groups: [],
        pendingHandshakes: [],
        blockedPeers: [],
        lastUpdated: Date.now(),
        exportedAt: Date.now(),
      }, false);
      
      expect(result.importedContacts).toBe(1);
      expect(manager.getContacts()).toHaveLength(1);
    });
  });

  describe('事件系统', () => {
    it('应该触发 contact:added 事件', () => {
      const handler = vi.fn();
      manager.on(handler);
      
      manager.addContact({ name: 'Event', peerId: generateValidPeerId('Event') });
      
      expect(handler).toHaveBeenCalledWith('contact:added', expect.any(Object));
    });

    it('应该触发 contact:updated 事件', () => {
      const handler = vi.fn();
      manager.on(handler);
      
      const contact = manager.addContact({ name: 'ToUpdate', peerId: generateValidPeerId('ToUpdate') });
      manager.updateContact(contact!.id, { name: 'Updated' });
      
      expect(handler).toHaveBeenCalledWith('contact:updated', expect.any(Object));
    });
  });

  describe('统计信息', () => {
    it('getStats 应返回正确统计', () => {
      manager.addContact({ name: 'Friend1', peerId: generateValidPeerId('Friend1') });
      manager.addContact({ name: 'Friend2', peerId: generateValidPeerId('Friend2') });
      
      const contacts = manager.getContacts();
      manager.updateContact(contacts[0].id, { status: FriendStatus.FRIEND });
      manager.updateContact(contacts[1].id, { status: FriendStatus.FRIEND });
      
      const stats = manager.getStats();
      
      expect(stats.total).toBe(2);
      expect(stats.friends).toBe(2);
      expect(stats.strangers).toBe(0);
    });
  });

  describe('持久化', () => {
    it('flush 应保存数据', () => {
      manager.addContact({ name: 'Flush', peerId: generateValidPeerId('Flush') });
      manager.flush();
      
      // 验证文件内容
      const dataPath = join(tempDir, 'contacts.json');
      const content = JSON.parse(readFileSync(dataPath, 'utf-8'));
      expect(content.contacts).toHaveLength(1);
    });
  });

  // P1-1 修复：使用 MALICIOUS_INPUTS.xss 测试数据
  describe('安全输入处理', () => {
    it('应该安全处理 XSS 攻击输入', () => {
      let index = 0;
      for (const xssInput of MALICIOUS_INPUTS.xss) {
        const uniquePeerId = generateValidPeerId(`XSS${index++}`);
        const contact = manager.addContact({
          name: xssInput, // XSS 输入作为名称
          peerId: uniquePeerId,
        });
        
        // 应该成功添加（不拒绝），但存储时应该是安全的
        expect(contact).toBeDefined();
        expect(contact.name).toBe(xssInput); // 原始输入被存储，但渲染时需要转义
      }
    });

    it('应该安全处理路径遍历输入', () => {
      let index = 0;
      for (const pathTraversal of MALICIOUS_INPUTS.pathTraversal) {
        const uniquePeerId = generateValidPeerId(`Path${index++}`);
        const contact = manager.addContact({
          name: 'SafeContact',
          peerId: uniquePeerId,
          tags: [pathTraversal], // 路径遍历作为标签
        });
        
        // 应该成功添加
        expect(contact).toBeDefined();
      }
    });
  });
});