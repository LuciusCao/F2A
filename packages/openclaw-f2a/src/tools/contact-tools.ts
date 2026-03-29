/**
 * F2A 通讯录工具定义
 * 
 * 包含通讯录、分组、好友请求等工具。
 */

import type { Tool } from '../types.js';

/**
 * 获取通讯录相关工具定义
 */
export function getContactTools(
  handlers: {
    handleContacts: Tool['handler'];
    handleContactGroups: Tool['handler'];
    handleFriendRequest: Tool['handler'];
    handlePendingRequests: Tool['handler'];
    handleContactsExport: Tool['handler'];
    handleContactsImport: Tool['handler'];
  }
): Tool[] {
  return [
    {
      name: 'f2a_contacts',
      description: '管理通讯录联系人。Actions: list（列出联系人）, get（获取详情）, add（添加）, remove（删除）, update（更新）, block（拉黑）, unblock（解除拉黑）',
      parameters: {
        action: {
          type: 'string',
          description: '操作类型: list, get, add, remove, update, block, unblock',
          required: true,
          enum: ['list', 'get', 'add', 'remove', 'update', 'block', 'unblock'],
        },
        contact_id: {
          type: 'string',
          description: '联系人 ID（get/remove/update/block/unblock 时需要）',
          required: false,
        },
        peer_id: {
          type: 'string',
          description: 'Peer ID（add 时需要，get/remove 时可选）',
          required: false,
        },
        name: {
          type: 'string',
          description: '联系人名称（add/update 时需要）',
          required: false,
        },
        groups: {
          type: 'array',
          description: '分组列表',
          required: false,
          // P2-5 修复：添加 items 类型验证
          items: {
            type: 'string',
            description: '分组名称或 ID',
          },
        },
        tags: {
          type: 'array',
          description: '标签列表',
          required: false,
          // P2-5 修复：添加 items 类型验证
          items: {
            type: 'string',
            description: '标签名称',
          },
        },
        notes: {
          type: 'string',
          description: '备注信息',
          required: false,
        },
        status: {
          type: 'string',
          description: '按状态过滤（list 时可选）: stranger, pending, friend, blocked',
          required: false,
          enum: ['stranger', 'pending', 'friend', 'blocked'],
        },
        group: {
          type: 'string',
          description: '按分组过滤（list 时可选）',
          required: false,
        },
      },
      handler: handlers.handleContacts,
    },
    {
      name: 'f2a_contact_groups',
      description: '管理联系人分组。Actions: list（列出分组）, create（创建）, update（更新）, delete（删除）',
      parameters: {
        action: {
          type: 'string',
          description: '操作类型: list, create, update, delete',
          required: true,
          enum: ['list', 'create', 'update', 'delete'],
        },
        group_id: {
          type: 'string',
          description: '分组 ID（update/delete 时需要）',
          required: false,
        },
        name: {
          type: 'string',
          description: '分组名称（create/update 时需要）',
          required: false,
        },
        description: {
          type: 'string',
          description: '分组描述',
          required: false,
        },
        color: {
          type: 'string',
          description: '分组颜色（十六进制，如 #FF5733）',
          required: false,
        },
      },
      handler: handlers.handleContactGroups,
    },
    {
      name: 'f2a_friend_request',
      description: '发送好友请求给指定 Agent',
      parameters: {
        peer_id: {
          type: 'string',
          description: '目标 Agent 的 Peer ID',
          required: true,
        },
        message: {
          type: 'string',
          description: '附加消息',
          required: false,
        },
      },
      handler: handlers.handleFriendRequest,
    },
    {
      name: 'f2a_pending_requests',
      description: '查看和处理待处理的好友请求。Actions: list（列出请求）, accept（接受）, reject（拒绝）',
      parameters: {
        action: {
          type: 'string',
          description: '操作类型: list, accept, reject',
          required: true,
          enum: ['list', 'accept', 'reject'],
        },
        request_id: {
          type: 'string',
          description: '请求 ID（accept/reject 时需要）',
          required: false,
        },
        reason: {
          type: 'string',
          description: '拒绝原因（reject 时可选）',
          required: false,
        },
      },
      handler: handlers.handlePendingRequests,
    },
    {
      name: 'f2a_contacts_export',
      description: '导出通讯录数据',
      parameters: {},
      handler: handlers.handleContactsExport,
    },
    {
      name: 'f2a_contacts_import',
      description: '导入通讯录数据',
      parameters: {
        data: {
          type: 'object',
          description: '导入的通讯录数据（JSON 格式）',
          required: true,
        },
        merge: {
          type: 'boolean',
          description: '是否合并（true）或覆盖（false），默认 true',
          required: false,
        },
      },
      handler: handlers.handleContactsImport,
    },
  ];
}