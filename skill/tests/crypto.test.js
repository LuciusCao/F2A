/**
 * 加密模块测试
 */

const { E2ECrypto } = require('../scripts/crypto');

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
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || 'Expected true, got false');
  }
}

console.log('\n📦 E2ECrypto Tests');

test('generateKeyPair creates valid keys', () => {
  const crypto = new E2ECrypto();
  const keyPair = crypto.generateKeyPair();
  
  assertTrue(keyPair.publicKey, 'Public key should exist');
  assertTrue(keyPair.privateKey, 'Private key should exist');
});

test('deriveSessionKey creates compatible keys', () => {
  const cryptoA = new E2ECrypto();
  const cryptoB = new E2ECrypto();
  
  const pairA = cryptoA.generateKeyPair();
  const pairB = cryptoB.generateKeyPair();
  
  cryptoA.deriveSessionKey('peer-b', pairB.publicKey);
  cryptoB.deriveSessionKey('peer-a', pairA.publicKey);
  
  // 双方应该能互相加解密
  const message = 'Hello, World!';
  const encrypted = cryptoA.encrypt('peer-b', message);
  const decrypted = cryptoB.decrypt('peer-a', encrypted);
  
  assertEqual(decrypted, message, 'Decrypted message should match original');
});

test('encrypt produces different output', () => {
  const cryptoA = new E2ECrypto();
  const cryptoB = new E2ECrypto();
  
  const pairA = cryptoA.generateKeyPair();
  const pairB = cryptoB.generateKeyPair();
  
  cryptoA.deriveSessionKey('peer-b', pairB.publicKey);
  cryptoB.deriveSessionKey('peer-a', pairA.publicKey);
  
  const message = 'Secret message';
  const encrypted = cryptoA.encrypt('peer-b', message);
  
  assertTrue(encrypted !== message, 'Encrypted should differ from plaintext');
  assertTrue(encrypted.length > 0, 'Encrypted should not be empty');
});

test('decrypt recovers original message', () => {
  const cryptoA = new E2ECrypto();
  const cryptoB = new E2ECrypto();
  
  const pairA = cryptoA.generateKeyPair();
  const pairB = cryptoB.generateKeyPair();
  
  cryptoA.deriveSessionKey('peer-b', pairB.publicKey);
  cryptoB.deriveSessionKey('peer-a', pairA.publicKey);
  
  const message = 'Test message 123 !@#';
  const encrypted = cryptoA.encrypt('peer-b', message);
  const decrypted = cryptoB.decrypt('peer-a', encrypted);
  
  assertEqual(decrypted, message, 'Decrypted should match original');
});

test('throws when encrypting without session key', () => {
  const crypto = new E2ECrypto();
  crypto.generateKeyPair();
  
  let threw = false;
  try {
    crypto.encrypt('unknown-peer', 'message');
  } catch (err) {
    threw = true;
  }
  
  assertTrue(threw, 'Should throw error for unknown peer');
});

test('clearSession removes session key', () => {
  const cryptoA = new E2ECrypto();
  const cryptoB = new E2ECrypto();
  
  const pairA = cryptoA.generateKeyPair();
  const pairB = cryptoB.generateKeyPair();
  
  cryptoA.deriveSessionKey('peer-b', pairB.publicKey);
  
  assertTrue(cryptoA.sessionKeys.has('peer-b'), 'Session should exist');
  
  cryptoA.clearSession('peer-b');
  
  assertTrue(!cryptoA.sessionKeys.has('peer-b'), 'Session should be removed');
});

console.log('');
