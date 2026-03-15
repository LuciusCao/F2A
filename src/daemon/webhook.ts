/**
 * Webhook 通知服务
 */

import { request, RequestOptions } from 'https';
import { request as httpRequest } from 'http';
import { WebhookConfig } from '../types/index.js';
import { Logger } from '../utils/logger.js';

export interface WebhookNotification {
  message: string;
  name?: string;
  wakeMode?: 'now' | 'next-heartbeat';
  deliver?: boolean;
}

/**
 * P2-2 修复：验证 URL 是否为内网地址，防止 SSRF 攻击
 * 阻止以下私有地址段：
 * - 127.x.x.x (loopback)
 * - 10.x.x.x (Class A private)
 * - 192.168.x.x (Class C private)
 * - 172.16.x.x - 172.31.x.x (Class B private)
 * - 169.254.x.x (link-local)
 * - ::1 (IPv6 loopback)
 * - fc00::/7 (IPv6 ULA)
 * - fe80::/10 (IPv6 link-local)
 */
function isPrivateIP(hostname: string): boolean {
  // IPv4 地址检查
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Regex);
  
  if (match) {
    const octets = [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), parseInt(match[4], 10)];
    
    // 127.x.x.x (loopback)
    if (octets[0] === 127) return true;
    
    // 10.x.x.x (Class A private)
    if (octets[0] === 10) return true;
    
    // 192.168.x.x (Class C private)
    if (octets[0] === 192 && octets[1] === 168) return true;
    
    // 172.16.x.x - 172.31.x.x (Class B private)
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    
    // 169.254.x.x (link-local)
    if (octets[0] === 169 && octets[1] === 254) return true;
    
    // 0.0.0.0 (all interfaces)
    if (octets[0] === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0) return true;
  }
  
  // IPv6 地址检查
  const lowerHostname = hostname.toLowerCase();
  
  // ::1 (loopback)
  if (lowerHostname === '::1' || lowerHostname === '0:0:0:0:0:0:0:1') return true;
  
  // fc00::/7 (ULA - Unique Local Address)
  if (lowerHostname.startsWith('fc') || lowerHostname.startsWith('fd')) return true;
  
  // fe80::/10 (link-local)
  if (lowerHostname.startsWith('fe8') || lowerHostname.startsWith('fe9') || 
      lowerHostname.startsWith('fea') || lowerHostname.startsWith('feb')) return true;
  
  return false;
}

/**
 * P2-2 修复：验证 webhook URL 安全性
 */
function validateWebhookUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    
    // 只允许 http 和 https 协议
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, error: `Invalid protocol: ${url.protocol}. Only http and https are allowed.` };
    }
    
    // 检查是否为内网地址
    const hostname = url.hostname;
    
    // 检查 localhost 别名
    if (hostname === 'localhost' || hostname === 'local' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      return { valid: false, error: 'localhost and local domains are not allowed for security reasons.' };
    }
    
    // 检查私有 IP 地址
    if (isPrivateIP(hostname)) {
      return { valid: false, error: `Private IP address ${hostname} is not allowed for security reasons (SSRF protection).` };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export class WebhookService {
  private config: WebhookConfig;
  private logger: Logger;

  constructor(config: WebhookConfig) {
    this.config = {
      timeout: 5000,
      retries: 3,
      retryDelay: 1000,
      ...config
    };
    this.logger = new Logger({ component: 'Webhook' });
  }

  /**
   * 发送通知
   */
  async send(notification: WebhookNotification): Promise<{ success: boolean; error?: string }> {
    if (!this.config.token) {
      this.logger.warn('Token not set, skipping notification');
      return { success: false, error: 'Token not set' };
    }

    // P2-2 修复：验证 URL 安全性，防止 SSRF 攻击
    const urlValidation = validateWebhookUrl(this.config.url);
    if (!urlValidation.valid) {
      this.logger.error('Webhook URL validation failed', { 
        url: this.config.url, 
        error: urlValidation.error 
      });
      return { success: false, error: urlValidation.error };
    }

    const payload = JSON.stringify({
      message: notification.message,
      name: notification.name || 'F2A',
      wakeMode: notification.wakeMode || 'now',
      deliver: notification.deliver !== false
    });

    for (let attempt = 1; attempt <= this.config.retries!; attempt++) {
      try {
        await this.sendRequest(payload);
        this.logger.info('Notification sent', { attempt });
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('Attempt failed', { attempt, error: message });

        if (attempt < this.config.retries!) {
          await this.delay(this.config.retryDelay!);
        }
      }
    }

    return { success: false, error: 'All retries failed' };
  }

  /**
   * 发送 HTTP 请求
   */
  private sendRequest(payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isHttps = this.config.url.startsWith('https');
      const client = isHttps ? request : httpRequest;

      const options: RequestOptions = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: this.config.timeout
      };

      const req = client(this.config.url, options, (res) => {
        if (res.statusCode === 200 || res.statusCode === 202) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}