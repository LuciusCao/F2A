/**
 * Messaging 模块测试
 */

const { Messaging } = require('../scripts/messaging');
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

function assertFalse(value, message) {
  if (value) {
    throw new Error(message || 'Expected false, got true');
  }
}

console.log('\n📦 Messaging Tests');

// Mock connection class
class MockConnection extends EventEmitter {
  constructor() {
    super();
    this.sentMessages = [];
    this.closed = false;
  }
  
  send(data) {
    this.sentMessages.push(data);
  }
  
  close() {
    this.closed = true;
    this.emit('close');
  }
}

// ==================== 构造函数测试 ====================

test('constructor with default options', () => {
  const messaging = new Messaging();
  
  assertEqual(messaging.peers.size, 0, 'Should have no peers');
  assertEqual(messaging.pendingMessages.size, 0, 'Should have no pending messages');
  assertEqual(messaging.messageTimeout, 30000, 'Default timeout should be 30000ms');
});

test('constructor with custom timeout', () => {
  const messaging = new Messaging({
    messageTimeout: 60000
  });
  
  assertEqual(messaging.messageTimeout, 60000, 'Custom timeout should be set');
});

// ==================== 注册 Peer 测试 ====================

test('registerPeer adds peer to map', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  
  messaging.registerPeer('peer-1', conn);
  
  assertTrue(messaging.peers.has('peer-1'), 'Should have peer in map');
  assertEqual(messaging.peers.get('peer-1'), conn, 'Should have connection');
});

test('registerPeer emits event on peer disconnect', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  
  let disconnectedPeer = null;
  messaging.on('peer_disconnected', (data) => {
    disconnectedPeer = data.peerId;
  });
  
  messaging.registerPeer('peer-2', conn);
  conn.emit('close');
  
  assertEqual(disconnectedPeer, 'peer-2', 'Should emit disconnect event');
  assertFalse(messaging.peers.has('peer-2'), 'Should remove peer from map');
});

// ==================== 发送消息测试 ====================

asyncTest('sendMessage throws for unconnected peer', async () => {
  const messaging = new Messaging();
  
  let threw = false;
  try {
    await messaging.sendMessage('unknown-peer', 'hello');
  } catch (err) {
    threw = true;
    assertTrue(err.message.includes('not connected'), 'Should mention not connected');
  }
  
  assertTrue(threw, 'Should throw for unconnected peer');
});

asyncTest('sendMessage sends message to connected peer', async () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-3', conn);
  
  // Set requireAck to false to avoid waiting for response
  const result = await messaging.sendMessage('peer-3', 'hello', {
    myAgentId: 'agent-a',
    requireAck: false
  });
  
  assertEqual(conn.sentMessages.length, 1, 'Should send one message');
  const msg = JSON.parse(conn.sentMessages[0]);
  assertEqual(msg.type, 'message', 'Should be message type');
  assertEqual(msg.content, 'hello', 'Should have correct content');
  assertEqual(msg.requireAck, false, 'Should not require ack');
});

asyncTest('sendMessage includes signature when sign option is true', async () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-4', conn);
  
  // Use ed25519 for signing (x25519 doesn't support sign)
  const crypto = require('crypto');
  const keyPair = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  await messaging.sendMessage('peer-4', 'signed message', {
    myAgentId: 'agent-a',
    requireAck: false,
    sign: true,
    privateKey: keyPair.privateKey
  });
  
  const msg = JSON.parse(conn.sentMessages[0]);
  assertTrue(msg.signature, 'Should have signature');
});

// ==================== 广播测试 ====================

asyncTest('broadcast sends to all peers', async () => {
  const messaging = new Messaging();
  
  const conn1 = new MockConnection();
  const conn2 = new MockConnection();
  const conn3 = new MockConnection();
  
  messaging.registerPeer('peer-a', conn1);
  messaging.registerPeer('peer-b', conn2);
  messaging.registerPeer('peer-c', conn3);
  
  const results = await messaging.broadcast('broadcast message', {
    myAgentId: 'agent-a',
    requireAck: false
  });
  
  assertEqual(results.length, 3, 'Should send to 3 peers');
  assertEqual(results.filter(r => r.status === 'success').length, 3, 'All should succeed');
});

// ==================== 消息处理测试 ====================

test('_handleMessage handles message type', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-5', conn);
  
  let receivedMessage = null;
  messaging.on('message', (data) => {
    receivedMessage = data;
  });
  
  messaging._handleMessage('peer-5', JSON.stringify({
    type: 'message',
    id: 'msg-1',
    from: 'agent-b',
    content: 'hello',
    timestamp: Date.now(),
    requireAck: true
  }));
  
  assertTrue(receivedMessage, 'Should emit message event');
  assertEqual(receivedMessage.content, 'hello', 'Should have correct content');
  
  // Check ack was sent
  assertEqual(conn.sentMessages.length, 1, 'Should send ack');
  const ack = JSON.parse(conn.sentMessages[0]);
  assertEqual(ack.type, 'message_ack', 'Should be ack type');
});

test('_handleMessage handles ping type', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-6', conn);
  
  messaging._handleMessage('peer-6', JSON.stringify({
    type: 'ping',
    timestamp: Date.now()
  }));
  
  assertEqual(conn.sentMessages.length, 1, 'Should send pong');
  const pong = JSON.parse(conn.sentMessages[0]);
  assertEqual(pong.type, 'pong', 'Should be pong type');
});

test('_handleMessage emits raw_message for unknown types', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-7', conn);
  
  let rawMessage = null;
  messaging.on('raw_message', (data) => {
    rawMessage = data;
  });
  
  messaging._handleMessage('peer-7', JSON.stringify({
    type: 'custom_type',
    data: 'test'
  }));
  
  assertTrue(rawMessage, 'Should emit raw_message event');
  assertEqual(rawMessage.message.type, 'custom_type', 'Should have correct type');
});

// ==================== 消息确认测试 ====================

asyncTest('message ack resolves pending promise', async () => {
  const messaging = new Messaging({
    messageTimeout: 1000
  });
  const conn = new MockConnection();
  messaging.registerPeer('peer-8', conn);
  
  // Start sending a message (will wait for ack)
  const sendPromise = messaging.sendMessage('peer-8', 'test', {
    myAgentId: 'agent-a',
    requireAck: true
  });
  
  // Extract message id from sent message
  const sentMsg = JSON.parse(conn.sentMessages[0]);
  
  // Simulate receiving ack
  messaging._handleMessage('peer-8', JSON.stringify({
    type: 'message_ack',
    messageId: sentMsg.id,
    timestamp: Date.now()
  }));
  
  const result = await sendPromise;
  assertEqual(result.status, 'delivered', 'Should be delivered');
  assertTrue(result.deliveredAt, 'Should have deliveredAt');
});

asyncTest('message timeout rejects promise', async () => {
  const messaging = new Messaging({
    messageTimeout: 100
  });
  const conn = new MockConnection();
  messaging.registerPeer('peer-9', conn);
  
  let threw = false;
  try {
    await messaging.sendMessage('peer-9', 'test', {
      myAgentId: 'agent-a',
      requireAck: true
    });
  } catch (err) {
    threw = true;
    assertTrue(err.message.includes('timeout'), 'Should mention timeout');
  }
  
  assertTrue(threw, 'Should throw on timeout');
});

// ==================== 错误处理测试 ====================

test('_handleMessage emits error on invalid JSON', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-10', conn);
  
  let errorEmitted = false;
  messaging.on('error', (data) => {
    errorEmitted = true;
  });
  
  messaging._handleMessage('peer-10', 'invalid json');
  
  assertTrue(errorEmitted, 'Should emit error event');
});

// ==================== 断开连接测试 ====================

test('disconnectPeer removes peer', () => {
  const messaging = new Messaging();
  const conn = new MockConnection();
  messaging.registerPeer('peer-11', conn);
  
  messaging.disconnectPeer('peer-11');
  
  assertFalse(messaging.peers.has('peer-11'), 'Should remove peer');
  assertTrue(conn.closed, 'Should close connection');
});

test('disconnectAll removes all peers', () => {
  const messaging = new Messaging();
  
  const conn1 = new MockConnection();
  const conn2 = new MockConnection();
  
  messaging.registerPeer('peer-a', conn1);
  messaging.registerPeer('peer-b', conn2);
  
  messaging.disconnectAll();
  
  assertEqual(messaging.peers.size, 0, 'Should have no peers');
  assertTrue(conn1.closed, 'Should close conn1');
  assertTrue(conn2.closed, 'Should close conn2');
});

// ==================== 工具方法测试 ====================

test('getConnectedPeers returns list', () => {
  const messaging = new Messaging();
  
  messaging.registerPeer('peer-x', new MockConnection());
  messaging.registerPeer('peer-y', new MockConnection());
  
  const peers = messaging.getConnectedPeers();
  
  assertEqual(peers.length, 2, 'Should have 2 peers');
  assertTrue(peers.includes('peer-x'), 'Should include peer-x');
  assertTrue(peers.includes('peer-y'), 'Should include peer-y');
});

console.log('');