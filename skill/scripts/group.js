/**
 * F2A Group Chat Module
 * 
 * 群聊功能模块，支持多 Agent 群组通信
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class GroupChat extends EventEmitter {
  constructor(options = {}) {
    super();
    this.groups = new Map(); // groupId -> Group
    this.myAgentId = options.myAgentId;
  }

  /**
   * 初始化群聊模块
   */
  initialize(myAgentId) {
    this.myAgentId = myAgentId;
  }

  /**
   * 创建群组
   */
  createGroup(name, options = {}) {
    const groupId = crypto.randomUUID();
    const group = {
      id: groupId,
      name: name || '未命名群组',
      creator: this.myAgentId,
      members: new Set([this.myAgentId]),
      createdAt: Date.now(),
      metadata: options.metadata || {}
    };

    this.groups.set(groupId, group);
    this.emit('group_created', { groupId, name });
    
    return groupId;
  }

  /**
   * 加入群组
   */
  joinGroup(groupId, groupInfo) {
    if (!this.groups.has(groupId)) {
      this.groups.set(groupId, {
        id: groupId,
        name: groupInfo.name || '未命名群组',
        creator: groupInfo.creator,
        members: new Set(groupInfo.members || []),
        joinedAt: Date.now(),
        metadata: groupInfo.metadata || {}
      });
      
      this.emit('group_joined', { groupId });
    }
  }

  /**
   * 邀请成员加入群组
   */
  inviteMember(groupId, peerId) {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    if (group.creator !== this.myAgentId) {
      throw new Error('Only group creator can invite members');
    }

    if (group.members.has(peerId)) {
      throw new Error(`Peer ${peerId} is already a member of this group`);
    }

    if (peerId === this.myAgentId) {
      throw new Error('Cannot invite yourself');
    }

    group.members.add(peerId);
    this.emit('member_invited', { groupId, peerId });

    return {
      type: 'group_invite',
      groupId,
      groupName: group.name,
      creator: group.creator,
      members: Array.from(group.members)
    };
  }

  /**
   * 离开群组
   */
  leaveGroup(groupId) {
    const group = this.groups.get(groupId);
    if (!group) return;

    group.members.delete(this.myAgentId);
    
    // 如果群组空了，删除群组
    if (group.members.size === 0) {
      this.groups.delete(groupId);
    }

    this.emit('group_left', { groupId });
  }

  /**
   * 发送群消息
   */
  sendGroupMessage(groupId, content, sendFunction) {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    if (!group.members.has(this.myAgentId)) {
      throw new Error('Not a member of this group');
    }

    const message = {
      type: 'group_message',
      messageId: crypto.randomUUID(),
      groupId,
      from: this.myAgentId,
      content,
      timestamp: Date.now()
    };

    // 广播给所有成员（除了自己）
    const targets = Array.from(group.members).filter(id => id !== this.myAgentId);
    
    for (const peerId of targets) {
      try {
        sendFunction(peerId, message);
      } catch (err) {
        console.error(`[GroupChat] Failed to send to ${peerId}:`, err.message);
      }
    }

    this.emit('group_message_sent', { groupId, messageId: message.messageId });
    return message;
  }

  /**
   * 处理收到的群消息
   */
  handleGroupMessage(message) {
    const { groupId, from, content, timestamp, messageId } = message;
    
    const group = this.groups.get(groupId);
    if (!group) {
      console.warn(`[GroupChat] Received message for unknown group: ${groupId}`);
      return;
    }

    if (!group.members.has(from)) {
      console.warn(`[GroupChat] Received message from non-member: ${from}`);
      return;
    }

    this.emit('group_message', {
      groupId,
      groupName: group.name,
      from,
      content,
      timestamp,
      messageId
    });
  }

  /**
   * 处理群组邀请
   */
  handleGroupInvite(invite) {
    const { groupId, groupName, creator, members } = invite;
    
    this.joinGroup(groupId, {
      name: groupName,
      creator,
      members
    });

    this.emit('group_invite_received', {
      groupId,
      groupName,
      creator,
      members
    });
  }

  /**
   * 获取群组信息
   */
  getGroupInfo(groupId) {
    const group = this.groups.get(groupId);
    if (!group) return null;

    return {
      id: group.id,
      name: group.name,
      creator: group.creator,
      members: Array.from(group.members),
      memberCount: group.members.size,
      createdAt: group.createdAt
    };
  }

  /**
   * 获取所有群组
   */
  getAllGroups() {
    return Array.from(this.groups.keys()).map(id => this.getGroupInfo(id));
  }

  /**
   * 获取我加入的群组
   */
  getMyGroups() {
    return this.getAllGroups().filter(g => g.members.includes(this.myAgentId));
  }

  /**
   * 同步群组成员
   */
  syncGroupMembers(groupId, newMembers) {
    const group = this.groups.get(groupId);
    if (!group) return;

    // 更新成员列表
    group.members = new Set(newMembers);
    
    this.emit('group_members_synced', { 
      groupId, 
      members: Array.from(group.members) 
    });
  }
}

module.exports = { GroupChat };
