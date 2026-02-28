/**
 * P2PManager 模块测试
 * 
 * 注意：P2PManager 依赖 WebSocket，需要模拟或跳过某些测试
 */

const { P2PManager } = require('../scripts/p2p');
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

console.log('\n📦 P2PManager Tests');

// ==================== 构造函数测试 ====================

test('constructor with default options', () => {
  const p2p = new P2PManager();
  
  assertEqual(p2p.connections.size, 0, 'Should have no connections');
  assertEqual(p2p.heartbeatInterval, 30000, 'Default heartbeat should be 30000ms');
  assertEqual(p2p.heartbeatTimeout, 10000, 'Default timeout should be 10000ms');
});

test('constructor with custom options', () => {
  const p2p = new P2PManager({
    heartbeatInterval: 60000,
    heartbeatTimeout: 20000
  });
  
  assertEqual(p2p.heartbeatInterval, 60000, 'Custom heartbeat should be set');
  assertEqual(p2p.heartbeatTimeout, 20000, 'Custom timeout should be set');
});

// ==================== 连接管理测试 ====================

test('getConnectedPeers returns empty array initially', () => {
  const p2p = new P2PManager();
  
  const peers = p2p.getConnectedPeers();
  assertEqual(peers.length, 0, 'Should have no peers');
});

test('isConnected returns false for unknown peer', () => {
  const p2p = new P2PManager();
  
  assertFalse(p2p.isConnected('unknown-peer'), 'Should not be connected');
});

// ==================== 模拟 WebSocket 连接测试 ====================

test('_registerConnection adds peer and emits event', () => {
  const p2p = new P2PManager();
  
  // Create a mock WebSocket-like object
  const mockWs = new EventEmitter();
  mockWs.readyState = 1; // WebSocket.OPEN
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  let connectedEvent = null;
  p2p.on('connected', (data) => {
    connectedEvent = data;
  });
  
  p2p._registerConnection('peer-1', mockWs);
  
  assertTrue(p2p.connections.has('peer-1'), 'Should have connection');
  assertEqual(connectedEvent.peerId, 'peer-1', 'Should emit connected event');
});

test('_cleanupConnection removes peer and emits event', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-2', mockWs);
  
  let disconnectedEvent = null;
  p2p.on('disconnected', (data) => {
    disconnectedEvent = data;
  });
  
  p2p._cleanupConnection('peer-2');
  
  assertFalse(p2p.connections.has('peer-2'), 'Should remove connection');
  assertEqual(disconnectedEvent.peerId, 'peer-2', 'Should emit disconnected event');
});

test('send throws for unconnected peer', () => {
  const p2p = new P2PManager();
  
  let threw = false;
  try {
    p2p.send('unknown-peer', { type: 'test' });
  } catch (err) {
    threw = true;
  }
  
  assertTrue(threw, 'Should throw for unconnected peer');
});

test('send sends message to connected peer', () => {
  const p2p = new P2PManager();
  
  const sentMessages = [];
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = (data) => sentMessages.push(data);
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-3', mockWs);
  
  p2p.send('peer-3', { type: 'test', data: 'hello' });
  
  assertEqual(sentMessages.length, 1, 'Should send one message');
  const msg = JSON.parse(sentMessages[0]);
  assertEqual(msg.type, 'test', 'Should have correct type');
});

test('send with string data', () => {
  const p2p = new P2PManager();
  
  const sentMessages = [];
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = (data) => sentMessages.push(data);
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-4', mockWs);
  
  p2p.send('peer-4', 'plain text message');
  
  assertEqual(sentMessages[0], 'plain text message', 'Should send string as-is');
});

// ==================== 广播测试 ====================

test('broadcast sends to all connected peers', () => {
  const p2p = new P2PManager();
  
  const sentMessages = [];
  
  for (let i = 1; i <= 3; i++) {
    const mockWs = new EventEmitter();
    mockWs.readyState = 1;
    mockWs.send = (data) => sentMessages.push({ peer: i, data });
    mockWs.close = () => {};
    p2p._registerConnection(`peer-${i}`, mockWs);
  }
  
  p2p.broadcast({ type: 'broadcast', message: 'hello all' });
  
  assertEqual(sentMessages.length, 3, 'Should send to 3 peers');
});

// ==================== 断开连接测试 ====================

test('disconnect removes peer', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = () => {};
  mockWs.close = () => mockWs.emit('close');
  
  p2p._registerConnection('peer-5', mockWs);
  
  p2p.disconnect('peer-5');
  
  assertFalse(p2p.connections.has('peer-5'), 'Should remove connection');
});

test('disconnectAll removes all peers', () => {
  const p2p = new P2PManager();
  
  for (let i = 1; i <= 3; i++) {
    const mockWs = new EventEmitter();
    mockWs.readyState = 1;
    mockWs.send = () => {};
    mockWs.close = () => {};
    p2p._registerConnection(`peer-${i}`, mockWs);
  }
  
  p2p.disconnectAll();
  
  assertEqual(p2p.connections.size, 0, 'Should have no connections');
});

// ==================== 消息事件测试 ====================

test('emits message event on websocket message', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-6', mockWs);
  
  let receivedMessage = null;
  p2p.on('message', (data) => {
    receivedMessage = data;
  });
  
  mockWs.emit('message', 'test data');
  
  assertEqual(receivedMessage.peerId, 'peer-6', 'Should have correct peerId');
  assertEqual(receivedMessage.data, 'test data', 'Should have correct data');
});

test('emits disconnected event on websocket close', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-7', mockWs);
  
  let disconnectedPeer = null;
  p2p.on('disconnected', (data) => {
    disconnectedPeer = data.peerId;
  });
  
  mockWs.emit('close');
  
  assertEqual(disconnectedPeer, 'peer-7', 'Should emit disconnected event');
});

test('emits error event on websocket error', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-8', mockWs);
  
  let errorEvent = null;
  p2p.on('error', (data) => {
    errorEvent = data;
  });
  
  mockWs.emit('error', new Error('test error'));
  
  assertEqual(errorEvent.peerId, 'peer-8', 'Should have correct peerId');
  assertTrue(errorEvent.error, 'Should have error');
});

// ==================== 心跳处理测试 ====================

test('handlePong clears timeout', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 1;
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-9', mockWs);
  
  // Manually set a timeout
  const timeout = setTimeout(() => {}, 10000);
  p2p.heartbeatTimers.set('peer-9_timeout', timeout);
  
  p2p.handlePong('peer-9');
  
  assertFalse(p2p.heartbeatTimers.has('peer-9_timeout'), 'Should clear timeout');
});

// ==================== isConnected 测试 ====================

test('isConnected returns true for open connection', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 1; // WebSocket.OPEN
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-10', mockWs);
  
  assertTrue(p2p.isConnected('peer-10'), 'Should be connected');
});

test('isConnected returns false for closed connection', () => {
  const p2p = new P2PManager();
  
  const mockWs = new EventEmitter();
  mockWs.readyState = 3; // WebSocket.CLOSED
  mockWs.send = () => {};
  mockWs.close = () => {};
  
  p2p._registerConnection('peer-11', mockWs);
  
  assertFalse(p2p.isConnected('peer-11'), 'Should not be connected');
});

console.log('');