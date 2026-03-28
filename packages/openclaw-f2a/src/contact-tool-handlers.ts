/**
 * F2A 通讯录工具处理器
 * 
 * 处理通讯录、分组、好友请求相关的工具调用。
 */

import type { F2APlugin } from './connector.js';
import type { ToolResult, SessionContext } from './types.js';
import { FriendStatus, type ContactFilter } from './contact-types.js';
import { extractErrorMessage } from './connector-helpers.js';

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
   */
  async handleContactsImport(
    params: {
      data: Record<string, unknown>;
      merge?: boolean;
    },
    _context: SessionContext
  ): Promise<ToolResult> {
    try {
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