/**
 * Agent Identity Manager
 * 
 * 管理 Agent ID 的生成、持久化和加载
 * Agent ID 与 Ed25519 密钥对绑定，确保身份唯一且可验证
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// 默认配置文件路径
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.f2a');
const DEFAULT_CONFIG_FILE = path.join(DEFAULT_CONFIG_DIR, 'identity.json');

class IdentityManager {
  constructor(options = {}) {
    this.configDir = options.configDir || DEFAULT_CONFIG_DIR;
    this.configFile = options.configFile || DEFAULT_CONFIG_FILE;
    this._identity = null;
  }

  /**
   * 获取或创建 Agent 身份
   * Agent ID 由公钥派生，与密钥对绑定
   * @param {string} displayName - 用户友好的显示名称（可选，仅用于展示）
   * @returns {Object} { agentId, displayName, publicKey, privateKey, isNew, isPersistent }
   */
  getOrCreateIdentity(displayName = null) {
    // 1. 尝试从配置文件加载现有身份
    const savedIdentity = this._loadIdentity();
    if (savedIdentity && savedIdentity.agentId && savedIdentity.privateKey) {
      // 验证密钥对完整性
      try {
        const keyPair = {
          publicKey: savedIdentity.publicKey,
          privateKey: savedIdentity.privateKey
        };
        
        // 验证私钥可以导出匹配的公钥
        const derivedPublicKey = crypto.createPublicKey(savedIdentity.privateKey);
        const derivedPublicKeyPem = derivedPublicKey.export({ type: 'spki', format: 'pem' });
        
        if (derivedPublicKeyPem !== savedIdentity.publicKey) {
          throw new Error('密钥对不匹配');
        }
        
        return {
          agentId: savedIdentity.agentId,
          displayName: savedIdentity.displayName || null,
          publicKey: savedIdentity.publicKey,
          privateKey: savedIdentity.privateKey,
          isNew: false,
          isPersistent: true,
          createdAt: savedIdentity.createdAt
        };
      } catch (err) {
        console.error('[IdentityManager] 已保存的身份无效，重新生成:', err.message);
        // 继续生成新身份
      }
    }

    // 2. 生成新的密钥对和身份
    const keyPair = this._generateKeyPair();
    const agentId = this._deriveAgentId(keyPair.publicKey);
    
    const identity = {
      agentId,
      displayName: displayName || null,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      createdAt: new Date().toISOString()
    };
    
    this._saveIdentity(identity);

    return {
      agentId,
      displayName: displayName || null,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      isNew: true,
      isPersistent: true
    };
  }

  /**
   * 生成 Ed25519 密钥对
   */
  _generateKeyPair() {
    return crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
  }

  /**
   * 从公钥派生 Agent ID
   * 格式: f2a-<公钥前8位十六进制>
   */
  _deriveAgentId(publicKeyPem) {
    // 从 PEM 提取原始公钥字节
    const publicKey = crypto.createPublicKey(publicKeyPem);
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
    // Ed25519 公钥在 DER 格式的最后 32 字节
    const rawPublicKey = publicKeyDer.slice(-32);
    const hash = crypto.createHash('sha256').update(rawPublicKey).digest('hex');
    const shortId = hash.slice(0, 8);
    return `f2a-${shortId.slice(0, 4)}-${shortId.slice(4)}`;
  }

  /**
   * 更新显示名称（不影响 Agent ID）
   * @param {string} displayName - 新的显示名称
   */
  updateDisplayName(displayName) {
    const identity = this._loadIdentity();
    if (!identity) {
      throw new Error('没有可更新的身份');
    }
    
    identity.displayName = displayName;
    this._saveIdentity(identity);
    
    return {
      agentId: identity.agentId,
      displayName: identity.displayName
    };
  }

  /**
   * 从配置文件加载身份
   */
  _loadIdentity() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('[IdentityManager] 加载身份失败:', err.message);
    }
    return null;
  }

  /**
   * 保存身份到配置文件
   */
  _saveIdentity(identity) {
    try {
      // 确保配置目录存在
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      }
      
      // 保存文件并设置权限为 0o600（只有所有者读写）
      fs.writeFileSync(this.configFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
      this._identity = identity;
      return true;
    } catch (err) {
      console.error('[IdentityManager] 保存身份失败:', err.message);
      return false;
    }
  }

  /**
   * 重置身份（删除配置文件）
   * ⚠️ 警告：这将永久丢失当前身份，其他 Agent 将无法识别你
   */
  resetIdentity() {
    try {
      if (fs.existsSync(this.configFile)) {
        const identity = this._loadIdentity();
        fs.unlinkSync(this.configFile);
        console.log(`[IdentityManager] 身份已重置: ${identity?.agentId || 'unknown'}`);
      }
      this._identity = null;
      return true;
    } catch (err) {
      console.error('[IdentityManager] 重置身份失败:', err.message);
      return false;
    }
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath() {
    return this.configFile;
  }

  /**
   * 检查是否已存在持久化身份
   */
  hasPersistentIdentity() {
    return fs.existsSync(this.configFile);
  }

  /**
   * 获取当前身份信息（不包含私钥）
   */
  getIdentityInfo() {
    const identity = this._loadIdentity();
    if (!identity) return null;
    
    return {
      agentId: identity.agentId,
      displayName: identity.displayName,
      publicKey: identity.publicKey,
      createdAt: identity.createdAt
    };
  }
}

module.exports = { IdentityManager, DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE };
