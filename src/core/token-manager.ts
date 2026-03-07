import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import { homedir } from 'os';
import { Logger } from '../utils/logger';

/**
 * Token 管理器
 * 负责生成、存储和验证 F2A 控制 Token
 */
export class TokenManager {
  private tokenPath: string;
  private token: string | null = null;
  private logger: Logger;

  constructor(dataDir?: string) {
    this.logger = new Logger({ component: 'TokenManager' });
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
        this.logger.error('F2A_CONTROL_TOKEN is using the insecure default value!');
        this.logger.error('Please set a secure token: export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)');
        throw new Error(
          'Insecure token detected. F2A_CONTROL_TOKEN cannot use the default value "f2a-default-token". ' +
          'Please set a secure token: export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)'
        );
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

    this.logger.info('Generated new control token', { path: this.tokenPath });
    this.logger.info('To use a custom token, set F2A_CONTROL_TOKEN environment variable');

    return newToken;
  }

  /**
   * 验证 Token 是否有效
   * 使用 timingSafeEqual 防止时序攻击
   */
  verifyToken(token: string | undefined): boolean {
    if (!token) return false;
    
    const expectedToken = this.getToken();
    
    // 两个 token 长度必须相同
    if (token.length !== expectedToken.length) {
      return false;
    }
    
    // 使用 timingSafeEqual 防止时序攻击
    try {
      return timingSafeEqual(
        Buffer.from(token, 'utf-8'),
        Buffer.from(expectedToken, 'utf-8')
      );
    } catch {
      return false;
    }
  }

  /**
   * 记录 Token 使用审计日志
   */
  logTokenUsage(clientInfo: { ip?: string; action?: string; success: boolean }): void {
    const auditPath = join(dirname(this.tokenPath), 'token-audit.log');
    const entry = {
      timestamp: new Date().toISOString(),
      ...clientInfo
    };
    
    try {
      appendFileSync(auditPath, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch (error) {
      this.logger.error('Failed to write audit log', { error });
    }
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
      this.logger.error('Failed to save token', { error });
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
