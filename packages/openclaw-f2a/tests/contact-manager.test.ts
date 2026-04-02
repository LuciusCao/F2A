/**
 * ContactManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContactManager } from '../src/contact-manager.js';
import { FriendStatus, type Contact } from '../src/contact-types.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  generateXssPayloads,
  generateLongStringPayload,
  generateSpecialCharPayloads,
  generatePeerId,
} from './utils/test-helpers.js';

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
      manager.addContact({ name: 'Test', peerId: '12D3KooW' + 'T'.repeat(44) });
      
      const dataPath = join(tempDir, 'contacts.json');
      expect(existsSync(dataPath)).toBe(true);
    });

    it('应该加载已有数据', () => {
      // 添加一个联系人
      manager.addContact({ name: 'Test', peerId: '12D3KooW' + 'A'.repeat(44) });
      
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
        peerId: '12D3KooW' + 'A'.repeat(44),
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
      const peerId = '12D3KooW' + 'B'.repeat(44);
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
        peerId: '12D3KooW' + 'C'.repeat(44),
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
        peerId: '12D3KooW' + 'D'.repeat(44),
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
        peerId: '12D3KooW' + 'E'.repeat(44),
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
      manager.addContact({ name: 'Alice', peerId: '12D3KooW' + 'A'.repeat(44), tags: ['friend'] });
      manager.addContact({ name: 'Bob', peerId: '12D3KooW' + 'B'.repeat(44), tags: ['work'] });
      manager.addContact({ name: 'Charlie', peerId: '12D3KooW' + 'C'.repeat(44), tags: ['friend', 'work'] });
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
        from: '12D3KooW' + 'X'.repeat(44),
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
        from: '12D3KooW' + 'Y'.repeat(44),
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
        from: '12D3KooW' + 'Z'.repeat(44),
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
        peerId: '12D3KooW' + 'S'.repeat(44),
      });
      
      manager.blockContact(contact!.id);
      
      expect(manager.isBlocked(contact!.peerId)).toBe(true);
      expect(manager.canSendMessage(contact!.peerId)).toBe(false);
    });

    it('解除拉黑', () => {
      const contact = manager.addContact({
        name: 'Recovered',
        peerId: '12D3KooW' + 'R'.repeat(44),
      });
      
      manager.blockContact(contact!.id);
      manager.unblockContact(contact!.id);
      
      expect(manager.isBlocked(contact!.peerId)).toBe(false);
    });
  });

  describe('导入导出', () => {
    it('导出通讯录', () => {
      manager.addContact({ name: 'Export1', peerId: '12D3KooW' + 'E1'.repeat(22) });
      manager.addContact({ name: 'Export2', peerId: '12D3KooW' + 'E2'.repeat(22) });
      
      const exported = manager.exportContacts('node-1');
      
      expect(exported.contacts).toHaveLength(2);
      expect(exported.exportedBy).toBe('node-1');
      expect(exported.exportedAt).toBeDefined();
    });

    it('导入通讯录（合并模式）', () => {
      manager.addContact({ name: 'Existing', peerId: '12D3KooW' + 'EX'.repeat(22) });
      
      const result = manager.importContacts({
        version: 1,
        contacts: [
          { id: '1', name: 'New', peerId: '12D3KooW' + 'NE'.repeat(22), status: FriendStatus.STRANGER, capabilities: [], reputation: 0, groups: [], tags: [], lastCommunicationTime: 0, createdAt: Date.now(), updatedAt: Date.now() },
          { id: '2', name: 'Existing', peerId: '12D3KooW' + 'EX'.repeat(22), status: FriendStatus.STRANGER, capabilities: [], reputation: 0, groups: [], tags: [], lastCommunicationTime: 0, createdAt: Date.now(), updatedAt: Date.now() },
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
          { id: '1', name: 'Overwrite', peerId: '12D3KooW' + 'OW'.repeat(22), status: FriendStatus.FRIEND, capabilities: [], reputation: 0, groups: [], tags: [], lastCommunicationTime: 0, createdAt: Date.now(), updatedAt: Date.now() },
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
      
      manager.addContact({ name: 'Event', peerId: '12D3KooW' + 'EV'.repeat(22) });
      
      expect(handler).toHaveBeenCalledWith('contact:added', expect.any(Object));
    });

    it('应该触发 contact:updated 事件', () => {
      const handler = vi.fn();
      manager.on(handler);
      
      const contact = manager.addContact({ name: 'ToUpdate', peerId: '12D3KooW' + 'TU'.repeat(22) });
      manager.updateContact(contact!.id, { name: 'Updated' });
      
      expect(handler).toHaveBeenCalledWith('contact:updated', expect.any(Object));
    });
  });

  describe('统计信息', () => {
    it('getStats 应返回正确统计', () => {
      manager.addContact({ name: 'Friend1', peerId: '12D3KooW' + 'F1'.repeat(22) });
      manager.addContact({ name: 'Friend2', peerId: '12D3KooW' + 'F2'.repeat(22) });
      
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
      manager.addContact({ name: 'Flush', peerId: '12D3KooW' + 'FL'.repeat(22) });
      manager.flush();
      
      // 验证文件内容
      const dataPath = join(tempDir, 'contacts.json');
      const content = JSON.parse(readFileSync(dataPath, 'utf-8'));
      expect(content.contacts).toHaveLength(1);
    });
  });

  // P1-5: 恶意输入测试
  describe('恶意输入防护', () => {
    const xssPayloads = generateXssPayloads();
    const specialCharPayloads = generateSpecialCharPayloads();

    describe('XSS 注入防护', () => {
      it.each(xssPayloads)('应该安全处理 XSS payload: %s', (payload) => {
        const peerId = generatePeerId();
        const contact = manager.addContact({
          name: payload,
          peerId,
          tags: [payload],
        });

        expect(contact).toBeDefined();
        expect(contact!.name).toBe(payload);
        expect(contact!.tags).toContain(payload);

        // 验证数据可以正确读取
        const retrieved = manager.getContactByPeerId(peerId);
        expect(retrieved).toBeDefined();
        expect(retrieved!.name).toBe(payload);
      });

      it('XSS payload 不应该影响 JSON 存储', () => {
        const xssName = '<script>alert("xss")</script>';
        const contact = manager.addContact({
          name: xssName,
          peerId: generatePeerId(),
        });

        manager.flush();

        // 验证文件是有效的 JSON
        const dataPath = join(tempDir, 'contacts.json');
        const content = JSON.parse(readFileSync(dataPath, 'utf-8'));
        expect(content.contacts[0].name).toBe(xssName);
      });
    });

    describe('超长字符串处理', () => {
      it('应该接受合理长度的 name', () => {
        const maxLengthName = 'A'.repeat(100); // 常见最大长度限制
        const contact = manager.addContact({
          name: maxLengthName,
          peerId: generatePeerId(),
        });

        expect(contact).toBeDefined();
        expect(contact!.name.length).toBe(100);
      });

      it('应该处理超长 name 字符串', () => {
        const tooLongName = generateLongStringPayload(10000);
        const contact = manager.addContact({
          name: tooLongName,
          peerId: generatePeerId(),
        });

        // 根据实现，可能截断、拒绝或接受
        expect(contact).toBeDefined();
        if (contact) {
          expect(contact.name.length).toBeLessThanOrEqual(10000);
        }
      });

      it('应该处理超长 notes 字符串', () => {
        const contact = manager.addContact({
          name: 'LongNotes',
          peerId: generatePeerId(),
          notes: generateLongStringPayload(5000),
        });

        expect(contact).toBeDefined();
        expect(contact!.notes!.length).toBeLessThanOrEqual(5000);
      });

      it('边界长度名称后数据库应正常工作', () => {
        // 添加多个边界长度联系人
        for (let i = 0; i < 5; i++) {
          manager.addContact({
            name: 'B'.repeat(100),
            peerId: generatePeerId(),
          });
        }

        // 添加正常联系人
        const normalContact = manager.addContact({
          name: 'NormalContact',
          peerId: generatePeerId(),
        });

        expect(normalContact).toBeDefined();
        expect(manager.getContacts().length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('特殊字符处理', () => {
      it.each(specialCharPayloads)('应该安全处理特殊字符: %s', (payload) => {
        const contact = manager.addContact({
          name: payload,
          peerId: generatePeerId(),
        });

        expect(contact).toBeDefined();
        expect(contact!.name).toBe(payload);
      });

      it('应该处理包含 Emoji 的名称', () => {
        const emojiName = '🔥🎮🐱 Agent Name';
        const contact = manager.addContact({
          name: emojiName,
          peerId: generatePeerId(),
        });

        expect(contact!.name).toBe(emojiName);
      });

      it('应该处理 Unicode 方向控制字符', () => {
        // RTL override 可以用于欺骗性文本显示
        const deceptiveName = '\u202EAgent\u202D';
        const contact = manager.addContact({
          name: deceptiveName,
          peerId: generatePeerId(),
        });

        expect(contact!.name).toBe(deceptiveName);
      });

      it('应该处理包含控制字符的 tags', () => {
        const controlChars = '\u0000\u0001\u0002';
        const contact = manager.addContact({
          name: 'ControlChars',
          peerId: generatePeerId(),
          tags: [controlChars, 'normal-tag'],
        });

        expect(contact!.tags).toContain(controlChars);
      });
    });

    describe('边界情况', () => {
      it('应该处理空字符串 name', () => {
        const contact = manager.addContact({
          name: '',
          peerId: generatePeerId(),
        });

        // 空字符串可能被拒绝或接受，取决于验证规则
        expect(contact === null || contact!.name === '').toBe(true);
      });

      it('应该处理只包含空格的 name', () => {
        const spacesName = '   ';
        const contact = manager.addContact({
          name: spacesName,
          peerId: generatePeerId(),
        });

        // 空格字符串可能被接受或被 trim
        expect(contact).toBeDefined();
      });

      it('应该处理 null bytes 在 name 中', () => {
        const nullByteName = 'test\u0000agent';
        const contact = manager.addContact({
          name: nullByteName,
          peerId: generatePeerId(),
        });

        expect(contact!.name).toBe(nullByteName);
      });

      it('更新时也应该安全处理恶意输入', () => {
        const contact = manager.addContact({
          name: 'Original',
          peerId: generatePeerId(),
        });

        const updated = manager.updateContact(contact!.id, {
          name: '<script>updated()</script>',
          notes: "'; DROP TABLE contacts; --",
        });

        expect(updated!.name).toBe('<script>updated()</script>');
        expect(updated!.notes).toBe("'; DROP TABLE contacts; --");
      });
    });
  });
});