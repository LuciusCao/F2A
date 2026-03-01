/**
 * 代码审查修复测试
 * 测试内存泄漏修复、竞态条件修复等新功能
 */

const { Messaging } = require('../scripts/messaging');
const { SkillsManager } = require('../scripts/skills');
const { GroupChat } = require('../scripts/group');
const EventEmitter = require('events');

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

async function asyncTest(name, fn) {
  try {
    await fn();
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

// Mock connection
class MockConnection extends EventEmitter {
  constructor() {
    super();
    this.sentMessages = [];
    this.closed = false;
  }
  send(data) { this.sentMessages.push(data); }
  close() { this.closed = true; this.emit('close'); }
}

console.log('\n📦 Code Review Fix Tests');

// ==================== Messaging 内存泄漏修复测试 ====================

asyncTest('messaging: pending messages cleaned up on peer disconnect', async () => {
  const messaging = new Messaging({ messageTimeout: 5000 });
  const conn = new MockConnection();
  messaging.registerPeer('peer-1', conn);
  
  const sendPromise = messaging.sendMessage('peer-1', 'test', {
    myAgentId: 'agent-a', requireAck: true
  });
  
  assertEqual(messaging.pendingMessages.size, 1, 'Should have 1 pending');
  
  conn.emit('close');
  
  assertEqual(messaging.pendingMessages.size, 0, 'Should clean up on disconnect');
  
  let rejected = false;
  try { await sendPromise; } catch (err) {
    rejected = true;
    assertTrue(err.message.includes('disconnected'));
  }
  assertTrue(rejected, 'Promise should be rejected');
  
  messaging.stop();
});

asyncTest('messaging: no-ack messages not tracked', async () => {
  const messaging = new Messaging({ messageTimeout: 50 });
  const conn = new MockConnection();
  messaging.registerPeer('peer-2', conn);
  
  // 发送不需要确认的消息
  await messaging.sendMessage('peer-2', 'test', {
    myAgentId: 'agent-a', requireAck: false
  });
  
  // no-ack 消息不应该被跟踪到 pendingMessages 中
  assertEqual(messaging.pendingMessages.size, 0, 'Should not track no-ack messages');
  
  messaging.stop();
});

test('messaging: stop() cleans up all resources', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-3', conn);
  
  messaging.pendingMessages.set('msg-1', {
    resolve: () => {}, reject: () => {}, timeout: null,
    createdAt: Date.now(), peerId: 'peer-3'
  });
  
  messaging.stop();
  
  assertEqual(messaging.pendingMessages.size, 0);
  assertEqual(messaging.peers.size, 0);
  assertTrue(conn.closed);
});

// ==================== SkillsManager 测试 ====================

asyncTest('skills: pending requests cleaned up on peer disconnect', async () => {
  const skills = new SkillsManager({ requestTimeout: 5000 });
  const mockConnection = { send: () => {} };
  
  const queryPromise = skills.querySkills('peer-1', mockConnection);
  assertEqual(skills.pendingRequests.size, 1);
  
  skills.cleanupPeerRequests('peer-1');
  assertEqual(skills.pendingRequests.size, 0);
  
  let rejected = false;
  try { await queryPromise; } catch (err) {
    rejected = true;
    assertTrue(err.message.includes('disconnected'));
  }
  assertTrue(rejected);
  
  skills.stop();
});

test('skills: stop() cleans up all resources', () => {
  const skills = new SkillsManager();
  skills.pendingRequests.set('req-1', {
    resolve: () => {}, reject: () => {},
    timeout: setTimeout(() => {}, 10000),
    createdAt: Date.now(), peerId: 'peer-1'
  });
  
  skills.stop();
  assertEqual(skills.pendingRequests.size, 0);
});

// ==================== GroupChat 输入验证测试 ====================

test('group: cannot invite already member', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  groups.initialize('agent-a');
  const groupId = groups.createGroup('Test Group');
  
  // 先邀请 agent-b
  groups.inviteMember(groupId, 'agent-b');
  
  // 再次邀请 agent-b 应该报错
  let threw = false;
  try { groups.inviteMember(groupId, 'agent-b'); }
  catch (err) {
    threw = true;
    assertTrue(err.message.includes('already a member'));
  }
  assertTrue(threw);
});

test('group: cannot invite self', () => {
  const groups = new GroupChat({ myAgentId: 'agent-a' });
  groups.initialize('agent-a');
  const groupId = groups.createGroup('Test Group');
  
  // agent-a 是创建者，邀请自己应该报错
  let threw = false;
  try { groups.inviteMember(groupId, 'agent-a'); }
  catch (err) {
    threw = true;
    assertTrue(err.message.includes('yourself') || err.message.includes('already'));
  }
  assertTrue(threw);
});

console.log('');
