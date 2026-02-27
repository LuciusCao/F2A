/**
 * 群聊模块测试
 */

const { GroupChat } = require('../scripts/group');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    process.exitCode = 1;
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || 'Expected true, got false');
  }
}

console.log('\n📦 GroupChat Tests');

test('createGroup creates group with correct properties', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group');
  
  assertTrue(groupId, 'Group ID should exist');
  
  const info = groups.getGroupInfo(groupId);
  assertEqual(info.name, 'Test Group', 'Group name should match');
  assertEqual(info.creator, 'agent-a', 'Creator should be agent-a');
  assertEqual(info.memberCount, 1, 'Should have 1 member');
});

test('createGroup with metadata', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group', { 
    metadata: { topic: 'testing' } 
  });
  
  const info = groups.getGroupInfo(groupId);
  assertEqual(info.name, 'Test Group', 'Group name should match');
});

test('inviteMember adds member to group', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group');
  
  const invite = groups.inviteMember(groupId, 'agent-b');
  
  assertEqual(invite.type, 'group_invite', 'Should return invite message');
  assertEqual(invite.groupId, groupId, 'Invite should have correct groupId');
  assertTrue(invite.members.includes('agent-b'), 'Invite should include new member');
  
  const info = groups.getGroupInfo(groupId);
  assertEqual(info.memberCount, 2, 'Should have 2 members');
});

test('only creator can invite members', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group');
  
  // 切换到另一个 agent
  groups.myAgentId = 'agent-b';
  
  let threw = false;
  try {
    groups.inviteMember(groupId, 'agent-c');
  } catch (err) {
    threw = true;
  }
  
  assertTrue(threw, 'Non-creator should not be able to invite');
});

test('leaveGroup removes member', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group');
  
  groups.leaveGroup(groupId);
  
  const myGroups = groups.getMyGroups();
  assertEqual(myGroups.length, 0, 'Should have no groups after leaving');
});

test('getAllGroups returns all groups', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  groups.createGroup('Group 1');
  groups.createGroup('Group 2');
  groups.createGroup('Group 3');
  
  const allGroups = groups.getAllGroups();
  assertEqual(allGroups.length, 3, 'Should have 3 groups');
});

test('getMyGroups returns only joined groups', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const group1 = groups.createGroup('Group 1');
  const group2 = groups.createGroup('Group 2');
  
  // 邀请 agent-b 到 group2
  groups.inviteMember(group2, 'agent-b');
  
  // 切换到 agent-b
  groups.myAgentId = 'agent-b';
  groups.joinGroup(group2, { name: 'Group 2', creator: 'agent-a', members: ['agent-a', 'agent-b'] });
  
  const myGroups = groups.getMyGroups();
  assertEqual(myGroups.length, 1, 'agent-b should be in 1 group');
  assertEqual(myGroups[0].id, group2, 'Should be Group 2');
});

test('handleGroupInvite joins group', () => {
  const groups = new GroupChat({ myAgentId: 'agent-b' });
  
  groups.handleGroupInvite({
    type: 'group_invite',
    groupId: 'group-123',
    groupName: 'Test Group',
    creator: 'agent-a',
    members: ['agent-a', 'agent-b']
  });
  
  const info = groups.getGroupInfo('group-123');
  assertEqual(info.name, 'Test Group', 'Should join group with correct name');
  assertEqual(info.memberCount, 2, 'Should have 2 members');
});

test('sendGroupMessage broadcasts to members', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group');
  groups.inviteMember(groupId, 'agent-b');
  groups.inviteMember(groupId, 'agent-c');
  
  const sentMessages = [];
  const sendFunction = (peerId, message) => {
    sentMessages.push({ peerId, message });
  };
  
  groups.sendGroupMessage(groupId, 'Hello everyone!', sendFunction);
  
  assertEqual(sentMessages.length, 2, 'Should send to 2 members (excluding self)');
  assertTrue(sentMessages.every(m => m.peerId !== 'agent-a'), 'Should not send to self');
  assertTrue(sentMessages.every(m => m.message.content === 'Hello everyone!'), 'Content should match');
});

test('handleGroupMessage emits event for valid message', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group');
  groups.inviteMember(groupId, 'agent-b');
  
  let receivedEvent = null;
  groups.on('group_message', (data) => {
    receivedEvent = data;
  });
  
  groups.handleGroupMessage({
    type: 'group_message',
    messageId: 'msg-1',
    groupId: groupId,
    from: 'agent-b',
    content: 'Hello!',
    timestamp: Date.now()
  });
  
  assertTrue(receivedEvent !== null, 'Should emit group_message event');
  assertEqual(receivedEvent.content, 'Hello!', 'Content should match');
  assertEqual(receivedEvent.from, 'agent-b', 'From should be agent-b');
});

test('handleGroupMessage ignores message from non-member', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  const groupId = groups.createGroup('Test Group');
  // agent-b is not invited
  
  let receivedEvent = null;
  groups.on('group_message', (data) => {
    receivedEvent = data;
  });
  
  groups.handleGroupMessage({
    type: 'group_message',
    messageId: 'msg-1',
    groupId: groupId,
    from: 'agent-b', // Not a member
    content: 'Hello!',
    timestamp: Date.now()
  });
  
  assertEqual(receivedEvent, null, 'Should not emit event for non-member');
});

console.log('');
