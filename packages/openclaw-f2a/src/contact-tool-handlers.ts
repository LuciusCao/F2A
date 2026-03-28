/**
 * F2A 通讯录工具处理器
 * 
 * 处理通讯录、分组、好友请求相关的工具调用。
 */

import type { F2APlugin } from './connector.js';
import type { ToolResult, SessionContext } from './types.js';
import { FriendStatus, type ContactFilter } from './contact-types.js';
import { extractErrorMessage, isValidPeerId } from './connector-helpers.js';

/**
 * 通讯录工具处理器
 */
export class ContactToolHandlers {
  constructor(private plugin: F2APlugin) {}

  /**
   * 处理通讯录管理工具
   */
  async handleContacts(
    params: {
      action: 'list' | 'get' | 'add' | 'remove' | 'update' | 'block' | 'unblock';
      contact_id?: string;
      peer_id?: string;
      name?: string;
      groups?: string[];
      tags?: string[];
      notes?: string;
      status?: string;
      group?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const cm = (this.plugin as any).contactManager;
      
      switch (params.action) {
        case 'list': {
          const filter: ContactFilter = {};
          if (params.status) {
            filter.status = params.status as FriendStatus;
          }
          if (params.group) {
            filter.group = params.group;
          }
          const contacts = cm.getContacts(filter, { field: 'name', order: 'asc' });
          const stats = cm.getStats();
          
          return {
            content: `📋 **通讯录** (${stats.total} 个联系人)\n\n` +
              contacts.map((c: any) => {
                const statusIcon = ({
                  [FriendStatus.FRIEND]: '💚',
                  [FriendStatus.STRANGER]: '⚪',
                  [FriendStatus.PENDING]: '🟡',
                  [FriendStatus.BLOCKED]: '🔴',
                } as const)[c.status as FriendStatus] || '⚪';
                return `${statusIcon} **${c.name}**\n   Peer: ${c.peerId.slice(0, 16)}...\n   信誉: ${c.reputation} | 状态: ${c.status}`;
              }).join('\n\n') || '暂无联系人'
          };
        }
        
        case 'get': {
          let contact;
          if (params.contact_id) {
            contact = cm.getContact(params.contact_id);
          } else if (params.peer_id) {
            contact = cm.getContactByPeerId(params.peer_id);
          } else {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          if (!contact) {
            return { content: '❌ 联系人不存在' };
          }
          
          return {
            content: `👤 **${contact.name}**\n` +
              `   ID: ${contact.id}\n` +
              `   Peer ID: ${contact.peerId}\n` +
              `   状态: ${contact.status}\n` +
              `   信誉: ${contact.reputation}\n` +
              `   分组: ${contact.groups.join(', ') || '无'}\n` +
              `   标签: ${contact.tags.join(', ') || '无'}\n` +
              `   最后通信: ${contact.lastCommunicationTime ? new Date(contact.lastCommunicationTime).toLocaleString() : '从未'}\n` +
              (contact.notes ? `   备注: ${contact.notes}` : '')
          };
        }
        
        case 'add': {
          if (!params.peer_id || !params.name) {
            return { content: '❌ 需要提供 peer_id 和 name' };
          }
          
          const contact = cm.addContact({
            name: params.name,
            peerId: params.peer_id,
            groups: params.groups,
            tags: params.tags,
            notes: params.notes,
          });
          
          if (!contact) {
            return { content: '❌ 添加联系人失败（可能保存失败或已存在）' };
          }
          
          return { content: `✅ 已添加联系人: ${contact.name} (${contact.peerId.slice(0, 16)})` };
        }
        
        case 'remove': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const success = cm.removeContact(contactId);
          return { content: success ? '✅ 已删除联系人' : '❌ 联系人不存在' };
        }
        
        case 'update': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const contact = cm.updateContact(contactId, {
            name: params.name,
            groups: params.groups,
            tags: params.tags,
            notes: params.notes,
          });
          
          return { content: contact ? `✅ 已更新联系人: ${contact.name}` : '❌ 联系人不存在' };
        }
        
        case 'block': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const success = cm.blockContact(contactId);
          return { content: success ? '✅ 已拉黑联系人' : '❌ 联系人不存在' };
        }
        
        case 'unblock': {
          let contactId = params.contact_id;
          if (!contactId && params.peer_id) {
            const contact = cm.getContactByPeerId(params.peer_id);
            contactId = contact?.id;
          }
          
          if (!contactId) {
            return { content: '❌ 需要提供 contact_id 或 peer_id' };
          }
          
          const success = cm.unblockContact(contactId);
          return { content: success ? '✅ 已解除拉黑' : '❌ 联系人不存在' };
        }
        
        default:
          return { content: '❌ 未知操作' };
      }
    } catch (err) {
      return { content: `❌ 操作失败: ${extractErrorMessage(err)}` };
    }
  }

  /**
   * 处理分组管理工具
   */
  async handleContactGroups(
    params: {
      action: 'list' | 'create' | 'update' | 'delete';
      group_id?: string;
      name?: string;
      description?: string;
      color?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const cm = (this.plugin as any).contactManager;
      
      switch (params.action) {
        case 'list': {
          const groups = cm.getGroups();
          return {
            content: `📁 **分组列表** (${groups.length} 个)\n\n` +
              groups.map((g: any) => `• **${g.name}** (${g.id})\n   ${g.description || '无描述'}`).join('\n\n')
          };
        }
        
        case 'create': {
          if (!params.name) {
            return { content: '❌ 需要提供分组名称' };
          }
          
          const group = cm.createGroup({
            name: params.name,
            description: params.description,
            color: params.color,
          });
          
          if (!group) {
            return { content: '❌ 创建分组失败' };
          }
          return { content: `✅ 已创建分组: ${group.name}` };
        }
        
        case 'update': {
          if (!params.group_id) {
            return { content: '❌ 需要提供 group_id' };
          }
          
          const group = cm.updateGroup(params.group_id, {
            name: params.name,
            description: params.description,
            color: params.color,
          });
          
          return { content: group ? `✅ 已更新分组: ${group.name}` : '❌ 分组不存在' };
        }
        
        case 'delete': {
          if (!params.group_id) {
            return { content: '❌ 需要提供 group_id' };
          }
          
          const success = cm.deleteGroup(params.group_id);
          return { content: success ? '✅ 已删除分组' : '❌ 无法删除（分组不存在或为默认分组）' };
        }
        
        default:
          return { content: '❌ 未知操作' };
      }
    } catch (err) {
      return { content: `❌ 操作失败: ${extractErrorMessage(err)}` };
    }
  }

  /**
   * 处理好友请求工具
   */
  async handleFriendRequest(
    params: {
      peer_id: string;
      message?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const plugin = this.plugin as any;
      
      if (!plugin._f2a) {
        return { content: '❌ F2A 实例未初始化' };
      }
      
      // 确保握手协议已初始化
      if (!plugin._handshakeProtocol) {
        plugin.handshakeProtocol;
      }
      
      if (!plugin._handshakeProtocol) {
        return { content: '❌ 握手协议未初始化' };
      }
      
      // 自动匹配截断的 peer ID
      let targetPeerId = params.peer_id;
      if (params.peer_id.length < 50) {
        const peers = plugin._f2a.getConnectedPeers();
        const matched = peers.find((p: any) => p.peerId.startsWith(params.peer_id));
        if (matched) {
          targetPeerId = matched.peerId;
        }
      }
      
      // P1-2 修复：验证最终 Peer ID 格式
      if (!isValidPeerId(targetPeerId)) {
        return { content: `❌ 无效的 Peer ID 格式: ${targetPeerId.slice(0, 20)}...` };
      }
      
      const requestId = await plugin._handshakeProtocol.sendFriendRequest(
        targetPeerId,
        params.message
      );
      
      if (requestId) {
        return { content: `✅ 好友请求已发送\n请求 ID: ${requestId}\n等待对方响应...` };
      } else {
        return { content: '❌ 发送好友请求失败' };
      }
    } catch (err) {
      return { content: `❌ 发送失败: ${extractErrorMessage(err)}` };
    }
  }

  /**
   * 处理待处理请求工具
   */
  async handlePendingRequests(
    params: {
      action: 'list' | 'accept' | 'reject';
      request_id?: string;
      reason?: string;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const plugin = this.plugin as any;
      const cm = plugin.contactManager;
      
      switch (params.action) {
        case 'list': {
          const pending = cm.getPendingHandshakes();
          
          if (pending.length === 0) {
            return { content: '📭 暂无待处理的好友请求' };
          }
          
          return {
            content: `📬 **待处理的好友请求** (${pending.length} 个)\n\n` +
              pending.map((p: any) => 
                `• **${p.fromName}**\n   Peer: ${p.from.slice(0, 16)}...\n   请求 ID: ${p.requestId}\n   收到: ${new Date(p.receivedAt).toLocaleString()}` +
                (p.message ? `\n   消息: ${p.message}` : '')
              ).join('\n\n')
          };
        }
        
        case 'accept': {
          if (!params.request_id) {
            return { content: '❌ 需要提供 request_id' };
          }
          
          if (!plugin._handshakeProtocol) {
            return { content: '❌ 握手协议未初始化' };
          }
          
          const success = await plugin._handshakeProtocol.acceptRequest(params.request_id);
          return { content: success ? '✅ 已接受好友请求，双方已成为好友' : '❌ 接受失败' };
        }
        
        case 'reject': {
          if (!params.request_id) {
            return { content: '❌ 需要提供 request_id' };
          }
          
          if (!plugin._handshakeProtocol) {
            return { content: '❌ 握手协议未初始化' };
          }
          
          const success = await plugin._handshakeProtocol.rejectRequest(params.request_id, params.reason);
          return { content: success ? '✅ 已拒绝好友请求' : '❌ 拒绝失败' };
        }
        
        default:
          return { content: '❌ 未知操作' };
      }
    } catch (err) {
      return { content: `❌ 操作失败: ${extractErrorMessage(err)}` };
    }
  }

  /**
   * 处理导出通讯录工具
   */
  async handleContactsExport(
    _params: Record<string, never>,
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      const plugin = this.plugin as any;
      const cm = plugin.contactManager;
      const data = cm.exportContacts(plugin._f2a?.peerId);
      
      return {
        content: `📤 **通讯录导出成功**\n\n` +
          `联系人: ${data.contacts.length} 个\n` +
          `分组: ${data.groups.length} 个\n` +
          `导出时间: ${new Date(data.exportedAt).toLocaleString()}\n\n` +
          '```json\n' + JSON.stringify(data, null, 2) + '\n```',
        data,
      };
    } catch (err) {
      return { content: `❌ 导出失败: ${extractErrorMessage(err)}` };
    }
  }

  /**
   * 处理导入通讯录工具
   * P2-4 修复：添加导入数据格式验证
   */
  async handleContactsImport(
    params: {
      data: Record<string, unknown>;
      merge?: boolean;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
      // P2-4 修复：添加 schema 验证
      const data = params.data;
      
      // 基本结构验证
      if (!data || typeof data !== 'object') {
        return { content: '❌ 导入数据格式无效：必须为对象' };
      }
      
      // 验证必需字段
      if (!Array.isArray(data.contacts)) {
        return { content: '❌ 导入数据格式无效：contacts 必须为数组' };
      }
      
      if (!Array.isArray(data.groups)) {
        return { content: '❌ 导入数据格式无效：groups 必须为数组' };
      }
      
      if (typeof data.exportedAt !== 'number' || data.exportedAt <= 0) {
        return { content: '❌ 导入数据格式无效：exportedAt 必须为有效时间戳' };
      }
      
      // 验证 contacts 数组中的每个元素
      for (const contact of data.contacts) {
        if (!contact || typeof contact !== 'object') {
          return { content: '❌ 导入数据格式无效：contacts 包含非对象元素' };
        }
        
        // 验证必需字段
        if (!contact.id || typeof contact.id !== 'string') {
          return { content: '❌ 导入数据格式无效：contact.id 必须为字符串' };
        }
        
        if (!contact.peerId || typeof contact.peerId !== 'string') {
          return { content: '❌ 导入数据格式无效：contact.peerId 必须为字符串' };
        }
        
        if (!contact.name || typeof contact.name !== 'string') {
          return { content: '❌ 导入数据格式无效：contact.name 必须为字符串' };
        }
        
        // 验证可选字段类型
        if (contact.status !== undefined && typeof contact.status !== 'string') {
          return { content: '❌ 导入数据格式无效：contact.status 必须为字符串' };
        }
        
        if (contact.reputation !== undefined && typeof contact.reputation !== 'number') {
          return { content: '❌ 导入数据格式无效：contact.reputation 必须为数字' };
        }
        
        if (contact.groups !== undefined && !Array.isArray(contact.groups)) {
          return { content: '❌ 导入数据格式无效：contact.groups 必须为数组' };
        }
        
        if (contact.tags !== undefined && !Array.isArray(contact.tags)) {
          return { content: '❌ 导入数据格式无效：contact.tags 必须为数组' };
        }
        
        if (contact.createdAt !== undefined && typeof contact.createdAt !== 'number') {
          return { content: '❌ 导入数据格式无效：contact.createdAt 必须为数字' };
        }
        
        if (contact.updatedAt !== undefined && typeof contact.updatedAt !== 'number') {
          return { content: '❌ 导入数据格式无效：contact.updatedAt 必须为数字' };
        }
      }
      
      // 验证 groups 数组中的每个元素
      for (const group of data.groups) {
        if (!group || typeof group !== 'object') {
          return { content: '❌ 导入数据格式无效：groups 包含非对象元素' };
        }
        
        if (!group.id || typeof group.id !== 'string') {
          return { content: '❌ 导入数据格式无效：group.id 必须为字符串' };
        }
        
        if (!group.name || typeof group.name !== 'string') {
          return { content: '❌ 导入数据格式无效：group.name 必须为字符串' };
        }
      }
      
      const plugin = this.plugin as any;
      const cm = plugin.contactManager;
      const result = cm.importContacts(params.data as any, params.merge ?? true);
      
      if (result.success) {
        return {
          content: `📥 **通讯录导入完成**\n\n` +
            `✅ 导入联系人: ${result.importedContacts} 个\n` +
            `✅ 导入分组: ${result.importedGroups} 个\n` +
            `⏭️ 跳过联系人: ${result.skippedContacts} 个` +
            (result.errors.length ? `\n\n⚠️ 错误:\n${result.errors.join('\n')}` : '')
        };
      } else {
        return {
          content: `❌ 导入失败\n\n错误:\n${result.errors.join('\n')}`
        };
      }
    } catch (err) {
      return { content: `❌ 导入失败: ${extractErrorMessage(err)}` };
    }
  }
}