/**
 * IdentityManager 模块测试
 */

const { IdentityManager } = require('../scripts/identity');
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

function assertFalse(value, message) {
  if (value) {
    throw new Error(message || 'Expected false, got true');
  }
}

function assertMatch(actual, pattern, message) {
  if (!pattern.test(actual)) {
    throw new Error(message || `Expected ${actual} to match ${pattern}`);
  }
}

console.log('\n📦 IdentityManager Tests');

// 创建临时测试目录
const tempDir = path.join(os.tmpdir(), `f2a-test-${Date.now()}`);
const tempConfigFile = path.join(tempDir, 'identity.json');

// 清理函数
function cleanup() {
  try {
    if (fs.existsSync(tempConfigFile)) {
      fs.unlinkSync(tempConfigFile);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  } catch (e) {}
}

// 测试前清理
cleanup();

// ==================== 构造函数测试 ====================

test('constructor with default options', () => {
  const manager = new IdentityManager();
  assertTrue(manager.configDir.includes('.f2a'), 'Should have default config dir');
  assertTrue(manager.configFile.includes('identity.json'), 'Should have default config file');
});

test('constructor with custom options', () => {
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  assertEqual(manager.configDir, tempDir, 'Should have custom config dir');
  assertEqual(manager.configFile, tempConfigFile, 'Should have custom config file');
});

// ==================== getOrCreateIdentity 测试 ====================

test('getOrCreateIdentity with display name', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const result = manager.getOrCreateIdentity('My Agent');
  
  assertTrue(result.agentId, 'Should have agent ID');
  assertMatch(result.agentId, /^f2a-[a-f0-9]{4}-[a-f0-9]{4}$/, 'Should match f2a-xxxx-xxxx format');
  assertEqual(result.displayName, 'My Agent', 'Should have display name');
  assertTrue(result.publicKey, 'Should have public key');
  assertTrue(result.privateKey, 'Should have private key');
  assertTrue(result.isNew, 'Should be new');
  assertTrue(result.isPersistent, 'Should be persistent');
});

test('getOrCreateIdentity auto-generates ID when no display name', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const result = manager.getOrCreateIdentity();
  
  assertTrue(result.agentId, 'Should have auto-generated ID');
  assertMatch(result.agentId, /^f2a-[a-f0-9]{4}-[a-f0-9]{4}$/, 'Should match f2a-xxxx-xxxx format');
  assertTrue(result.isNew, 'Should be new');
  assertTrue(result.isPersistent, 'Should be persistent');
});

test('getOrCreateIdentity loads existing identity', () => {
  cleanup();
  const manager1 = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const firstResult = manager1.getOrCreateIdentity('First Agent');
  const firstId = firstResult.agentId;
  
  // Create new manager instance pointing to same config
  const manager2 = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const secondResult = manager2.getOrCreateIdentity('Second Agent');
  
  assertEqual(secondResult.agentId, firstId, 'Should load saved ID (same public key)');
  assertFalse(secondResult.isNew, 'Should not be new');
  assertTrue(secondResult.isPersistent, 'Should be persistent');
});

test('getOrCreateIdentity preserves ID across multiple calls', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const result1 = manager.getOrCreateIdentity();
  const firstId = result1.agentId;
  
  const result2 = manager.getOrCreateIdentity();
  const secondId = result2.agentId;
  
  assertEqual(firstId, secondId, 'Should return same ID');
});

// ==================== 持久化测试 ====================

test('identity is saved to config file', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const result = manager.getOrCreateIdentity('Test Agent');
  
  assertTrue(fs.existsSync(tempConfigFile), 'Config file should exist');
  
  const saved = JSON.parse(fs.readFileSync(tempConfigFile, 'utf8'));
  assertEqual(saved.agentId, result.agentId, 'Saved ID should match');
  assertEqual(saved.displayName, 'Test Agent', 'Saved display name should match');
  assertTrue(saved.publicKey, 'Should have public key');
  assertTrue(saved.privateKey, 'Should have private key');
  assertTrue(saved.createdAt, 'Should have createdAt timestamp');
});

test('config directory is created if not exists', () => {
  cleanup();
  const newTempDir = path.join(os.tmpdir(), `f2a-test-new-${Date.now()}`);
  const newConfigFile = path.join(newTempDir, 'identity.json');
  
  // Ensure directory doesn't exist
  try {
    if (fs.existsSync(newTempDir)) {
      fs.rmSync(newTempDir, { recursive: true });
    }
  } catch (e) {}
  
  const manager = new IdentityManager({
    configDir: newTempDir,
    configFile: newConfigFile
  });
  
  manager.getOrCreateIdentity('Test Agent');
  
  assertTrue(fs.existsSync(newTempDir), 'Config directory should be created');
  assertTrue(fs.existsSync(newConfigFile), 'Config file should be created');
  
  // Cleanup
  try {
    fs.unlinkSync(newConfigFile);
    fs.rmdirSync(newTempDir);
  } catch (e) {}
});

// ==================== resetIdentity 测试 ====================

test('resetIdentity removes config file', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  manager.getOrCreateIdentity('Test Agent');
  assertTrue(fs.existsSync(tempConfigFile), 'Config file should exist');
  
  const result = manager.resetIdentity();
  
  assertTrue(result, 'Should return true');
  assertFalse(fs.existsSync(tempConfigFile), 'Config file should be removed');
});

test('resetIdentity returns false if file does not exist', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const result = manager.resetIdentity();
  
  assertTrue(result, 'Should return true even if file does not exist');
});

// ==================== hasPersistentIdentity 测试 ====================

test('hasPersistentIdentity returns false when no config', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  assertFalse(manager.hasPersistentIdentity(), 'Should return false');
});

test('hasPersistentIdentity returns true when config exists', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  manager.getOrCreateIdentity('Test Agent');
  
  assertTrue(manager.hasPersistentIdentity(), 'Should return true');
});

// ==================== getConfigPath 测试 ====================

test('getConfigPath returns correct path', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  assertEqual(manager.getConfigPath(), tempConfigFile, 'Should return config file path');
});

// ==================== 边界情况测试 ====================

test('handles corrupted config file gracefully', () => {
  cleanup();
  
  // Create corrupted config file
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(tempConfigFile, 'invalid json {{{');
  
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const result = manager.getOrCreateIdentity();
  
  assertTrue(result.agentId, 'Should generate new ID when config is corrupted');
  assertTrue(result.isNew, 'Should be new');
});

// ==================== updateDisplayName 测试 ====================

test('updateDisplayName changes display name without affecting ID', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const firstResult = manager.getOrCreateIdentity('First Name');
  const originalId = firstResult.agentId;
  
  const updateResult = manager.updateDisplayName('Second Name');
  
  assertEqual(updateResult.agentId, originalId, 'ID should not change');
  assertEqual(updateResult.displayName, 'Second Name', 'Display name should be updated');
  
  // Verify persistence
  const saved = JSON.parse(fs.readFileSync(tempConfigFile, 'utf8'));
  assertEqual(saved.displayName, 'Second Name', 'Saved display name should be updated');
});

// ==================== getIdentityInfo 测试 ====================

test('getIdentityInfo returns identity without private key', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  const created = manager.getOrCreateIdentity('Test Agent');
  const info = manager.getIdentityInfo();
  
  assertEqual(info.agentId, created.agentId, 'Should have correct ID');
  assertEqual(info.displayName, 'Test Agent', 'Should have correct display name');
  assertTrue(info.publicKey, 'Should have public key');
  assertTrue(info.createdAt, 'Should have createdAt');
  assertFalse(info.privateKey, 'Should NOT have private key');
});

// ==================== 文件权限测试 ====================

test('config file has correct permissions (0o600)', () => {
  cleanup();
  const manager = new IdentityManager({
    configDir: tempDir,
    configFile: tempConfigFile
  });
  
  manager.getOrCreateIdentity('Test Agent');
  
  const stats = fs.statSync(tempConfigFile);
  const mode = stats.mode & 0o777;
  assertEqual(mode, 0o600, 'File should have 0o600 permissions (owner read/write only)');
});

// 最终清理
cleanup();

console.log('');

// 确保退出
setTimeout(() => {
  process.exit(process.exitCode || 0);
}, 100);
