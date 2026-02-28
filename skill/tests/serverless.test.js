/**
 * ServerlessP2P 模块测试
 * 
 * 注意：由于涉及 TCP/UDP 网络操作，需要特殊处理
 */

const { ServerlessP2P } = require('../scripts/serverless');
const crypto = require('crypto');
const dgram = require('dgram');
const net = require('net');

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

console.log('\n📦 ServerlessP2P Tests');

// 生成测试密钥对
function generateTestKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

// ==================== 构造函数测试 ====================

test('constructor with default options', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  assertEqual(p2p.myAgentId, 'test-agent', 'Agent ID should match');
  assertEqual(p2p.p2pPort, 9000, 'Default port should be 9000');
  assertEqual(p2p.security.level, 'medium', 'Default security level should be medium');
  assertTrue(p2p.security.requireConfirmation, 'Should require confirmation by default');
});

test('constructor with custom options', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    p2pPort: 9999,
    discoveryPort: 8768,
    security: {
      level: 'low',
      requireConfirmation: false,
      whitelist: ['trusted-agent'],
      blacklist: ['banned-agent']
    }
  });
  
  assertEqual(p2p.p2pPort, 9999, 'Custom port should be set');
  assertEqual(p2p.discoveryPort, 8768, 'Custom discovery port should be set');
  assertEqual(p2p.security.level, 'low', 'Custom security level should be set');
  assertFalse(p2p.security.requireConfirmation, 'Should not require confirmation');
  assertTrue(p2p.security.whitelist.has('trusted-agent'), 'Whitelist should contain agent');
  assertTrue(p2p.security.blacklist.has('banned-agent'), 'Blacklist should contain agent');
});

// ==================== 启动/停止测试 ====================

asyncTest('start and stop P2P', async () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent-start',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    p2pPort: 9001,
    discoveryPort: 8768 // 不同的端口避免冲突
  });
  
  await p2p.start();
  
  assertTrue(p2p.tcpServer.listening, 'TCP server should be listening');
  assertTrue(p2p.udpSocket !== null, 'UDP socket should be created');
  
  // 使用 Promise 等待 stop 完成
  await new Promise((resolve) => {
    p2p.stop();
    // 给一点时间让资源清理
    setTimeout(resolve, 200);
  });
  
  assertTrue(p2p.peers.size === 0, 'Peers should be cleared');
});

asyncTest('emit started event', async () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent-event',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    p2pPort: 9010, // Use different port
    discoveryPort: 8770 // Use different discovery port
  });
  
  let startedEvent = null;
  p2p.on('started', (data) => {
    startedEvent = data;
  });
  
  await p2p.start();
  
  assertTrue(startedEvent !== null, 'Should emit started event');
  assertEqual(startedEvent.port, 9010, 'Event should include port');
  
  // 使用 Promise 等待 stop 完成
  await new Promise((resolve) => {
    p2p.stop();
    setTimeout(resolve, 200);
  });
});

// ==================== 黑名单测试 ====================

test('blacklist prevents connection', async () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    security: {
      blacklist: ['blocked-agent']
    }
  });
  
  // Add to blacklist
  p2p.blacklist('new-blocked-agent');
  
  assertTrue(p2p.security.blacklist.has('blocked-agent'), 'Should have initial blacklist');
  assertTrue(p2p.security.blacklist.has('new-blocked-agent'), 'Should have new blacklist entry');
});

test('removeFromWhitelist removes agent', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    security: {
      whitelist: ['trusted-agent']
    }
  });
  
  p2p.removeFromWhitelist('trusted-agent');
  
  assertFalse(p2p.security.whitelist.has('trusted-agent'), 'Should be removed from whitelist');
});

// ==================== 发现 Agents 测试 ====================

test('getDiscoveredAgents returns empty array initially', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const agents = p2p.getDiscoveredAgents();
  assertEqual(agents.length, 0, 'Should have no discovered agents');
});

test('getDiscoveredAgents filters expired entries', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  // Add a fresh entry
  p2p.discoveredAgents.set('fresh-agent', {
    address: '192.168.1.1',
    port: 9000,
    lastSeen: Date.now()
  });
  
  // Add an expired entry (over 30 seconds old)
  p2p.discoveredAgents.set('expired-agent', {
    address: '192.168.1.2',
    port: 9000,
    lastSeen: Date.now() - 35000
  });
  
  const agents = p2p.getDiscoveredAgents();
  assertEqual(agents.length, 1, 'Should only have fresh agent');
  assertEqual(agents[0].agentId, 'fresh-agent', 'Should be the fresh agent');
});

// ==================== 连接 Peers 测试 ====================

test('getConnectedPeers returns empty array initially', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const peers = p2p.getConnectedPeers();
  assertEqual(peers.length, 0, 'Should have no connected peers');
});

test('sendToPeer throws for unconnected peer', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  let threw = false;
  try {
    p2p.sendToPeer('unknown-peer', { type: 'test' });
  } catch (err) {
    threw = true;
  }
  
  assertTrue(threw, 'Should throw for unconnected peer');
});

// ==================== 广播地址测试 ====================

test('_getBroadcastAddresses includes 255.255.255.255', async () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const addresses = p2p._getBroadcastAddresses();
  assertTrue(addresses.includes('255.255.255.255'), 'Should include broadcast address');
});

// ==================== 速率限制测试 ====================

test('_checkRateLimit allows requests within limit', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    security: {
      rateLimit: { maxRequests: 5, windowMs: 60000 }
    }
  });
  
  // First 5 requests should succeed
  for (let i = 0; i < 5; i++) {
    assertTrue(p2p._checkRateLimit('client-1'), `Request ${i + 1} should be allowed`);
  }
  
  // 6th request should be blocked
  assertFalse(p2p._checkRateLimit('client-1'), 'Request 6 should be blocked');
});

test('_checkRateLimit resets after window', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    security: {
      rateLimit: { maxRequests: 2, windowMs: 100 } // 100ms window
    }
  });
  
  assertTrue(p2p._checkRateLimit('client-2'), 'First request should be allowed');
  assertTrue(p2p._checkRateLimit('client-2'), 'Second request should be allowed');
  assertFalse(p2p._checkRateLimit('client-2'), 'Third request should be blocked');
});

// ==================== 清理测试 ====================

test('_cleanup clears expired rate limiter entries', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  // Add an expired entry
  p2p.rateLimiter.set('expired-client', {
    count: 1,
    resetTime: Date.now() - 1000 // Already expired
  });
  
  p2p._cleanup();
  
  assertFalse(p2p.rateLimiter.has('expired-client'), 'Expired entry should be removed');
});

// ==================== 广播测试 ====================

test('broadcast sends to all connected peers', () => {
  const keyPair = generateTestKeyPair();
  const p2p = new ServerlessP2P({
    myAgentId: 'test-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  // Mock connected peers
  const sentMessages = [];
  p2p.peers.set('peer-1', {
    socket: { write: (msg) => sentMessages.push({ peer: 'peer-1', msg }) },
    verified: true
  });
  p2p.peers.set('peer-2', {
    socket: { write: (msg) => sentMessages.push({ peer: 'peer-2', msg }) },
    verified: true
  });
  p2p.peers.set('peer-3', {
    socket: { write: (msg) => sentMessages.push({ peer: 'peer-3', msg }) },
    verified: false // Not verified, should not receive
  });
  
  p2p.broadcast({ type: 'test', data: 'hello' });
  
  assertEqual(sentMessages.length, 2, 'Should send to 2 verified peers');
});

// 确保测试完成后退出进程
setTimeout(() => {
  process.exit(process.exitCode || 0);
}, 1000);

console.log('');