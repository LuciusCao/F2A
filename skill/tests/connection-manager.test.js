/**
 * ConnectionManager 模块测试
 */

const { ConnectionManager } = require('../scripts/connection-manager');

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

function createMockSocket() {
  return {
    ended: false,
    end: function() { this.ended = true; },
    remoteAddress: '192.168.1.100',
    remotePort: 9001
  };
}

console.log('\n🧪 ConnectionManager Tests\n');

asyncTest('should add pending connection', async () => {
  const cm = new ConnectionManager();
  const result = cm.addPending('agent-1', createMockSocket(), 'key', '192.168.1.100', 9001);
  assertTrue(result.confirmationId, 'should have confirmationId');
  assertFalse(result.isDuplicate, 'should not be duplicate');
  assertEqual(cm.getPendingCount(), 1, 'should have 1 pending');
  cm.stop();
});

asyncTest('should deduplicate same agent requests', async () => {
  const cm = new ConnectionManager();
  const socket1 = createMockSocket();
  cm.addPending('agent-1', socket1, 'key1', '192.168.1.100', 9001);
  const socket2 = createMockSocket();
  const result2 = cm.addPending('agent-1', socket2, 'key2', '192.168.1.100', 9002);
  assertTrue(result2.isDuplicate, 'should be duplicate');
  assertEqual(cm.getPendingCount(), 1, 'should still have 1 pending');
  assertTrue(socket1.ended, 'old socket should be closed');
  cm.stop();
});

asyncTest('should get pending list', async () => {
  const cm = new ConnectionManager();
  cm.addPending('agent-1', createMockSocket(), 'key1', '192.168.1.100', 9001);
  cm.addPending('agent-2', createMockSocket(), 'key2', '192.168.1.101', 9002);
  const list = cm.getPendingList();
  assertEqual(list.length, 2, 'should have 2 items');
  assertTrue(list[0].index, 'should have index');
  cm.stop();
});

asyncTest('should find pending by index', async () => {
  const cm = new ConnectionManager();
  cm.addPending('agent-1', createMockSocket(), 'key1', '192.168.1.100', 9001);
  cm.addPending('agent-2', createMockSocket(), 'key2', '192.168.1.101', 9002);
  const pending = cm.getByIndex(2);
  assertTrue(pending, 'should find pending');
  assertEqual(pending.agentId, 'agent-2', 'should be agent-2');
  cm.stop();
});

asyncTest('should confirm connection', async () => {
  const cm = new ConnectionManager();
  cm.addPending('agent-1', createMockSocket(), 'key1', '192.168.1.100', 9001);
  const result = cm.confirm(1);
  assertTrue(result.success, 'should confirm successfully');
  assertEqual(cm.getPendingCount(), 0, 'should have 0 pending after confirm');
  cm.stop();
});

asyncTest('should reject connection', async () => {
  const cm = new ConnectionManager();
  const socket = createMockSocket();
  cm.addPending('agent-1', socket, 'key1', '192.168.1.100', 9001);
  const result = cm.reject(1, 'test reason');
  assertTrue(result.success, 'should reject successfully');
  assertTrue(socket.ended, 'socket should be closed');
  cm.stop();
});

asyncTest('should fail to confirm non-existent connection', async () => {
  const cm = new ConnectionManager();
  const result = cm.confirm(999);
  assertFalse(result.success, 'should fail');
  cm.stop();
});

asyncTest('should cleanup expired connections', async () => {
  const cm = new ConnectionManager();
  const result = cm.addPending('agent-1', createMockSocket(), 'key1', '192.168.1.100', 9001);
  const pending = cm.pendingConnections.get(result.confirmationId);
  pending.expiresAt = Date.now() - 1000;
  cm._cleanup();
  assertEqual(cm.getPendingCount(), 0, 'should cleanup expired');
  cm.stop();
});

console.log('\n✅ All ConnectionManager tests completed\n');