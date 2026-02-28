/**
 * FileTransfer 模块测试
 */

const { FileTransfer } = require('../scripts/files');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

console.log('\n📦 FileTransfer Tests');

// ==================== 构造函数测试 ====================

test('constructor with default options', () => {
  const files = new FileTransfer();
  
  assertTrue(files.chunkSize > 0, 'Should have default chunk size');
  assertTrue(files.tempDir, 'Should have temp directory');
  assertEqual(files.transfers.size, 0, 'Should have no transfers initially');
});

test('constructor with custom options', () => {
  const files = new FileTransfer({
    chunkSize: 128 * 1024,
    tempDir: '/tmp/custom-f2a'
  });
  
  assertEqual(files.chunkSize, 128 * 1024, 'Should have custom chunk size');
  assertEqual(files.tempDir, '/tmp/custom-f2a', 'Should have custom temp dir');
});

// ==================== 发送文件测试 ====================

asyncTest('sendFile throws for non-existent file', async () => {
  const files = new FileTransfer();
  
  let threw = false;
  try {
    await files.sendFile('peer-1', '/non/existent/file.txt', {
      send: () => {}
    });
  } catch (err) {
    threw = true;
    assertTrue(err.message.includes('not found'), 'Should mention file not found');
  }
  
  assertTrue(threw, 'Should throw for non-existent file');
});

asyncTest('sendFile creates transfer and sends offer', async () => {
  const files = new FileTransfer();
  
  // Create a temp file
  const tempFile = path.join(os.tmpdir(), `test-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, 'Hello, World!');
  
  const sentMessages = [];
  const mockConnection = {
    send: (data) => sentMessages.push(JSON.parse(data))
  };
  
  const fileId = await files.sendFile('peer-1', tempFile, mockConnection);
  
  assertTrue(fileId, 'Should return file ID');
  assertEqual(sentMessages.length, 1, 'Should send one message');
  assertEqual(sentMessages[0].type, 'file_offer', 'Should be file offer');
  assertEqual(sentMessages[0].filename, path.basename(tempFile), 'Should have correct filename');
  assertEqual(sentMessages[0].size, 13, 'Should have correct size');
  
  // Cleanup
  fs.unlinkSync(tempFile);
});

asyncTest('sendFile emits file_offered event', async () => {
  const files = new FileTransfer();
  
  // Create a temp file
  const tempFile = path.join(os.tmpdir(), `test-event-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, 'Test content');
  
  let eventFired = false;
  files.on('file_offered', (data) => {
    eventFired = true;
    assertTrue(data.fileId, 'Should have file ID');
    assertEqual(data.peerId, 'peer-1', 'Should have correct peer');
  });
  
  await files.sendFile('peer-1', tempFile, { send: () => {} });
  
  assertTrue(eventFired, 'Should emit file_offered event');
  
  // Cleanup
  fs.unlinkSync(tempFile);
});

// ==================== 接收文件测试 ====================

asyncTest('handleFileOffer creates transfer and sends accept', async () => {
  const files = new FileTransfer();
  
  const sentMessages = [];
  const mockConnection = {
    send: (data) => sentMessages.push(JSON.parse(data))
  };
  
  await files.handleFileOffer({
    fileId: 'file-123',
    filename: 'test.txt',
    size: 1024,
    md5: 'abc123',
    chunks: 1
  }, 'peer-1', mockConnection);
  
  assertEqual(sentMessages.length, 1, 'Should send one response');
  assertEqual(sentMessages[0].type, 'file_accept', 'Should be file accept');
  assertEqual(sentMessages[0].fileId, 'file-123', 'Should have correct file ID');
  
  const status = files.getTransferStatus('file-123');
  assertEqual(status.status, 'receiving', 'Should be receiving');
});

asyncTest('handleFileOffer emits file_receiving event', async () => {
  const files = new FileTransfer();
  
  let eventFired = false;
  files.on('file_receiving', (data) => {
    eventFired = true;
    assertEqual(data.fileId, 'file-456', 'Should have correct file ID');
    assertEqual(data.filename, 'test.txt', 'Should have correct filename');
  });
  
  await files.handleFileOffer({
    fileId: 'file-456',
    filename: 'test.txt',
    size: 1024,
    md5: 'abc123',
    chunks: 1
  }, 'peer-1', { send: () => {} });
  
  assertTrue(eventFired, 'Should emit file_receiving event');
});

// ==================== 传输状态测试 ====================

test('getTransferStatus returns null for unknown transfer', () => {
  const files = new FileTransfer();
  
  const status = files.getTransferStatus('unknown-id');
  assertEqual(status, null, 'Should return null for unknown transfer');
});

test('getTransferStatus returns correct progress', async () => {
  const files = new FileTransfer();
  
  // Create a transfer manually
  files.transfers.set('transfer-1', {
    fileId: 'transfer-1',
    filename: 'test.txt',
    size: 1000,
    totalChunks: 10,
    sentChunks: 3,
    status: 'sending'
  });
  
  const status = files.getTransferStatus('transfer-1');
  
  assertEqual(status.fileId, 'transfer-1', 'Should have correct file ID');
  assertEqual(status.status, 'sending', 'Should have correct status');
  assertEqual(status.progress, 0.3, 'Should have correct progress');
});

// ==================== 取消传输测试 ====================

test('cancelTransfer removes transfer', () => {
  const files = new FileTransfer();
  
  // Create a transfer
  files.transfers.set('cancel-test', {
    fileId: 'cancel-test',
    status: 'sending'
  });
  
  files.cancelTransfer('cancel-test');
  
  assertEqual(files.transfers.has('cancel-test'), false, 'Transfer should be removed');
});

test('cancelTransfer emits file_cancelled event', () => {
  const files = new FileTransfer();
  
  // Create a transfer
  files.transfers.set('cancel-event', {
    fileId: 'cancel-event',
    status: 'sending'
  });
  
  let eventFired = false;
  files.on('file_cancelled', (data) => {
    eventFired = true;
    assertEqual(data.fileId, 'cancel-event', 'Should have correct file ID');
  });
  
  files.cancelTransfer('cancel-event');
  
  assertTrue(eventFired, 'Should emit file_cancelled event');
});

// ==================== MD5 计算测试 ====================

asyncTest('_calculateMD5 returns correct hash', async () => {
  const files = new FileTransfer();
  
  // Create a temp file with known content
  const tempFile = path.join(os.tmpdir(), `md5-test-${Date.now()}.txt`);
  fs.writeFileSync(tempFile, 'Hello, World!');
  
  const md5 = await files._calculateMD5(tempFile);
  
  // MD5 of "Hello, World!" is 65a8e27d8879283831b664bd8b7f0ad4
  assertEqual(md5, '65a8e27d8879283831b664bd8b7f0ad4', 'Should have correct MD5');
  
  // Cleanup
  fs.unlinkSync(tempFile);
});

// ==================== 存储空间测试 ====================

test('_getFreeSpace returns positive value', async () => {
  const files = new FileTransfer();
  
  const freeSpace = await files._getFreeSpace();
  
  assertTrue(freeSpace > 0, 'Should return positive free space');
});

console.log('');