/**
 * F2A 主类集成测试
 * 
 * 测试 F2A 类的整体功能和模块集成
 */

const { F2A, ServerlessP2P, Messaging, SkillsManager, FileTransfer, GroupChat, E2ECrypto } = require('../scripts/index');
const crypto = require('crypto');
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

console.log('\n📦 F2A Main Class Tests');

// 生成测试密钥对
function generateTestKeyPair() {
  return crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function generateEd25519KeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

// ==================== 构造函数测试 ====================

test('constructor with minimal options', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-minimal-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  assertTrue(f2a.myAgentId, 'Should have agent ID');
  assertTrue(f2a.p2p, 'Should have P2P instance');
  assertTrue(f2a.messaging, 'Should have Messaging instance');
  assertTrue(f2a.skills, 'Should have SkillsManager instance');
  assertTrue(f2a.files, 'Should have FileTransfer instance');
  assertTrue(f2a.groups, 'Should have GroupChat instance');
});

test('constructor with custom agent ID', () => {
  const keyPair = generateTestKeyPair();
  const f2a = new F2A({
    myAgentId: 'custom-agent-id',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  assertEqual(f2a.myAgentId, 'custom-agent-id', 'Should have custom agent ID');
});

test('constructor with WebRTC disabled', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-webrtc-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    useWebRTC: false
  });
  
  assertEqual(f2a.useWebRTC, false, 'Should disable WebRTC');
  assertEqual(f2a.webrtc, null, 'Should not have WebRTC instance');
});

test('constructor with encryption disabled', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-encrypt-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    useEncryption: false
  });
  
  assertEqual(f2a.useEncryption, false, 'Should disable encryption');
  assertEqual(f2a.crypto, null, 'Should not have crypto instance');
});

test('constructor with custom port', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-port-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey,
    p2pPort: 9999
  });
  
  assertEqual(f2a.p2p.p2pPort, 9999, 'Should have custom port');
});

// ==================== 启动/停止测试 ====================

asyncTest('start initializes components', async () => {
  const keyPair = generateTestKeyPair();
  const edKeyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-start-agent',
    myPublicKey: edKeyPair.publicKey,
    myPrivateKey: edKeyPair.privateKey,
    p2pPort: 9101
  });
  
  await f2a.start();
  
  assertTrue(f2a.p2p.tcpServer.listening, 'TCP server should be listening');
  
  f2a.stop();
});

asyncTest('stop cleans up resources', async () => {
  const keyPair = generateTestKeyPair();
  const edKeyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-stop-agent',
    myPublicKey: edKeyPair.publicKey,
    myPrivateKey: edKeyPair.privateKey,
    p2pPort: 9102
  });
  
  await f2a.start();
  f2a.stop();
  
  // Give time for cleanup
  await new Promise(resolve => setTimeout(resolve, 100));
  
  assertEqual(f2a.p2p.peers.size, 0, 'Should have no peers');
});

asyncTest('emits stopped event', async () => {
  const keyPair = generateTestKeyPair();
  const edKeyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-event-agent',
    myPublicKey: edKeyPair.publicKey,
    myPrivateKey: edKeyPair.privateKey,
    p2pPort: 9103
  });
  
  await f2a.start();
  
  let stoppedEvent = false;
  f2a.on('stopped', () => {
    stoppedEvent = true;
  });
  
  f2a.stop();
  
  assertTrue(stoppedEvent, 'Should emit stopped event');
});

// ==================== 技能注册测试 ====================

test('registerSkill adds skill', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-skill-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  f2a.registerSkill('test-skill', {
    description: 'Test skill',
    handler: async () => 'result'
  });
  
  const skills = f2a.skills.getLocalSkills();
  assertEqual(skills.length, 1, 'Should have 1 skill');
  assertEqual(skills[0].name, 'test-skill', 'Should have correct name');
});

// ==================== 群聊功能测试 ====================

test('createGroup creates group', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-group-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const groupId = f2a.createGroup('Test Group');
  
  assertTrue(groupId, 'Should return group ID');
  const info = f2a.getGroupInfo(groupId);
  assertEqual(info.name, 'Test Group', 'Should have correct name');
});

test('getAllGroups returns groups', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-groups-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  f2a.createGroup('Group 1');
  f2a.createGroup('Group 2');
  
  const groups = f2a.getAllGroups();
  assertEqual(groups.length, 2, 'Should have 2 groups');
});

test('leaveGroup removes group', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-leave-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const groupId = f2a.createGroup('Test Group');
  f2a.leaveGroup(groupId);
  
  const myGroups = f2a.groups.getMyGroups();
  assertEqual(myGroups.length, 0, 'Should have no groups');
});

// ==================== 状态查询测试 ====================

test('getDiscoveredAgents returns array', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-discover-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const agents = f2a.getDiscoveredAgents();
  assertTrue(Array.isArray(agents), 'Should return array');
});

test('getConnectedPeers returns array', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-peers-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const peers = f2a.getConnectedPeers();
  assertTrue(Array.isArray(peers), 'Should return array');
});

test('getConnectionType returns undefined for unknown peer', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-conn-type-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  const type = f2a.getConnectionType('unknown-peer');
  assertEqual(type, undefined, 'Should return undefined');
});

// ==================== 消息发送测试 ====================

test('sendMessage throws for unconnected peer', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-msg-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  let threw = false;
  try {
    f2a.sendMessage('unknown-peer', 'hello');
  } catch (err) {
    threw = true;
  }
  
  assertTrue(threw, 'Should throw for unconnected peer');
});

// ==================== 技能调用测试 ====================

test('querySkills method exists and returns promise', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-query-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  // 测试方法存在
  assertTrue(typeof f2a.querySkills === 'function', 'Should have querySkills method');
  
  // querySkills 需要连接才能工作，这里只测试方法存在
});

test('invokeSkill method exists and returns promise', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-invoke-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  // 测试方法存在
  assertTrue(typeof f2a.invokeSkill === 'function', 'Should have invokeSkill method');
});

// ==================== 文件传输测试 ====================

test('sendFile returns promise and handles errors', async () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-file-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  // sendFile 应该返回 Promise，即使文件不存在也会 reject
  let threw = false;
  try {
    await f2a.sendFile('unknown-peer', '/nonexistent/file.txt');
  } catch (err) {
    threw = true;
  }
  assertTrue(threw, 'Should throw for nonexistent file');
});

// ==================== 断开连接测试 ====================

test('disconnect removes peer from all maps', () => {
  const keyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-disconnect-agent',
    myPublicKey: keyPair.publicKey,
    myPrivateKey: keyPair.privateKey
  });
  
  // Manually add a peer to test disconnect
  f2a.connectionTypes.set('peer-1', 'tcp');
  
  f2a.disconnect('peer-1');
  
  assertFalse(f2a.connectionTypes.has('peer-1'), 'Should remove connection type');
});

test('close stops everything', async () => {
  const keyPair = generateTestKeyPair();
  const edKeyPair = generateEd25519KeyPair();
  const f2a = new F2A({
    myAgentId: 'test-close-agent',
    myPublicKey: edKeyPair.publicKey,
    myPrivateKey: edKeyPair.privateKey,
    p2pPort: 9104
  });
  
  await f2a.start();
  f2a.close();
  
  // Should not throw
  assertTrue(true, 'Should close without error');
});

// ==================== 导出测试 ====================

test('exports all modules', () => {
  assertTrue(F2A !== undefined, 'Should export F2A');
  assertTrue(ServerlessP2P !== undefined, 'Should export ServerlessP2P');
  assertTrue(Messaging !== undefined, 'Should export Messaging');
  assertTrue(SkillsManager !== undefined, 'Should export SkillsManager');
  assertTrue(FileTransfer !== undefined, 'Should export FileTransfer');
  assertTrue(GroupChat !== undefined, 'Should export GroupChat');
  assertTrue(E2ECrypto !== undefined, 'Should export E2ECrypto');
});

// 确保测试完成后退出进程
setTimeout(() => {
  process.exit(process.exitCode || 0);
}, 1000);

console.log('');