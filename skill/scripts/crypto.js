/**
 * F2A Crypto Module
 * 
 * 端到端加密模块，使用 ECDH 密钥交换 + AES-GCM 加密
 */

const crypto = require('crypto');

const CURVE = 'x25519'; // ECDH 曲线
const CIPHER = 'aes-256-gcm'; // 对称加密算法
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

class E2ECrypto {
  constructor() {
    this.keyPair = null;
    this.sessionKeys = new Map(); // peerId -> { sendKey, recvKey }
  }

  /**
   * 生成 ECDH 密钥对
   */
  generateKeyPair() {
    this.keyPair = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    return this.keyPair;
  }

  /**
   * 加载密钥对
   */
  loadKeyPair(publicKey, privateKey) {
    this.keyPair = { publicKey, privateKey };
    return this;
  }

  /**
   * 执行 ECDH 密钥交换，生成会话密钥
   * 
   * 关键：需要确保 A.sendKey == B.recvKey 且 A.recvKey == B.sendKey
   * 使用 peerId 比较来确定密钥派生顺序
   */
  deriveSessionKey(peerId, peerPublicKey) {
    if (!this.keyPair) {
      throw new Error('Key pair not initialized');
    }

    // 使用 ECDH 计算共享密钥
    const sharedSecret = crypto.diffieHellman({
      privateKey: crypto.createPrivateKey(this.keyPair.privateKey),
      publicKey: crypto.createPublicKey(peerPublicKey)
    });

    // 确定性排序：比较公钥哈希
    // 使用公钥的原始 DER 字节计算哈希，确保比较结果一致
    const myPublicKeyObj = crypto.createPublicKey(this.keyPair.publicKey);
    const peerPublicKeyObj = crypto.createPublicKey(peerPublicKey);
    
    const myPublicKeyDer = myPublicKeyObj.export({ type: 'spki', format: 'der' });
    const peerPublicKeyDer = peerPublicKeyObj.export({ type: 'spki', format: 'der' });
    
    // 使用 SHA-256 哈希后比较，避免直接比较可能包含不同 PEM 格式的字符串
    const myKeyHash = crypto.createHash('sha256').update(myPublicKeyDer).digest('hex');
    const peerKeyHash = crypto.createHash('sha256').update(peerPublicKeyDer).digest('hex');
    const isHigh = myKeyHash > peerKeyHash;

    // 使用 HKDF 派生两个方向的密钥
    // 高方: sendKey=salt'send', recvKey=salt'recv'
    // 低方: sendKey=salt'recv', recvKey=salt'send'
    // 这样高方的 sendKey == 低方的 recvKey
    const firstSalt = isHigh ? Buffer.from('send') : Buffer.from('recv');
    const secondSalt = isHigh ? Buffer.from('recv') : Buffer.from('send');

    const sendKey = crypto.hkdfSync('sha256', sharedSecret, firstSalt, '', KEY_LENGTH);
    const recvKey = crypto.hkdfSync('sha256', sharedSecret, secondSalt, '', KEY_LENGTH);

    this.sessionKeys.set(peerId, {
      sendKey: Buffer.from(sendKey),
      recvKey: Buffer.from(recvKey)
    });

    return this.sessionKeys.get(peerId);
  }

  /**
   * 加密消息
   */
  encrypt(peerId, plaintext) {
    const session = this.sessionKeys.get(peerId);
    if (!session) {
      throw new Error(`No session key for peer: ${peerId}`);
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(CIPHER, session.sendKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();

    // 格式: iv (16) + tag (16) + ciphertext
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  /**
   * 解密消息
   */
  decrypt(peerId, ciphertext) {
    const session = this.sessionKeys.get(peerId);
    if (!session) {
      throw new Error(`No session key for peer: ${peerId}`);
    }

    const data = Buffer.from(ciphertext, 'base64');
    
    if (data.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid ciphertext');
    }

    const iv = data.slice(0, IV_LENGTH);
    const tag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = data.slice(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(CIPHER, session.recvKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * 导出公钥（用于发送给 peer）
   */
  getPublicKey() {
    if (!this.keyPair) {
      throw new Error('Key pair not initialized');
    }
    return this.keyPair.publicKey;
  }

  /**
   * 清除会话密钥
   */
  clearSession(peerId) {
    this.sessionKeys.delete(peerId);
  }

  /**
   * 清除所有会话
   */
  clearAllSessions() {
    this.sessionKeys.clear();
  }
}

module.exports = { E2ECrypto };
