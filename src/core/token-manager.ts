import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { homedir } from 'os';

/**
 * Token 管理器
 * 负责生成、存储和验证 F2A 控制 Token
 */
export class TokenManager {
  private tokenPath: string;
  private token: string | null = null;

  constructor(dataDir?: string) {
    // 默认存储在用户主目录的 .f2a 文件夹
    const baseDir = dataDir || join(homedir(), '.f2a');
    this.tokenPath = join(baseDir, 'control-token');
    
    // 确保目录存在
    const dir = join(baseDir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 获取或生成 Token
   * 优先从环境变量读取，其次从文件读取，最后生成新的
   */
  getToken(): string {
    // 1. 优先使用环境变量
    const envToken = process.env.F2A_CONTROL_TOKEN;
    if (envToken) {
      // 检查是否为不安全默认值
      if (envToken === 'f2a-default-token') {
        console.warn('⚠️ [TokenManager] F2A_CONTROL_TOKEN is using the insecure default value!');
        console.warn('   Please set a secure token: export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)');
      }
      this.token = envToken;
      return envToken;
    }

    // 2. 从文件读取
    if (existsSync(this.tokenPath)) {
      const fileToken = readFileSync(this.tokenPath, 'utf-8').trim();
      if (fileToken) {
        this.token = fileToken;
        return fileToken;
      }
    }

    // 3. 生成新的随机 Token
    const newToken = this.generateSecureToken();
    this.saveToken(newToken);
    this.token = newToken;
    
    console.log(`[TokenManager] Generated new control token and saved to ${this.tokenPath}`);
    console.log('[TokenManager] To use a custom token, set F2A_CONTROL_TOKEN environment variable');
    
    return newToken;
  }

  /**
   * 验证 Token 是否有效
   */
  verifyToken(token: string | undefined): boolean {
    if (!token) return false;
    return token === this.getToken();
  }

  /**
   * 生成安全的随机 Token
   */
  private generateSecureToken(): string {
    // 生成 32 字节 (64 字符) 的十六进制随机字符串
    return 'f2a-' + randomBytes(32).toString('hex');
  }

  /**
   * 保存 Token 到文件
   */
  private saveToken(token: string): void {
    try {
      writeFileSync(this.tokenPath, token, { mode: 0o600 }); // 仅所有者可读写
    } catch (error) {
      console.error('[TokenManager] Failed to save token:', error);
    }
  }

  /**
   * 获取 Token 文件路径
   */
  getTokenPath(): string {
    return this.tokenPath;
  }
}

// 单例导出
export const defaultTokenManager = new TokenManager();
