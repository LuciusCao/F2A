/**
 * Webhook 通知服务
 */

import { request, RequestOptions } from 'https';
import { request as httpRequest } from 'http';
import { lookup } from 'dns';
import { isIPv6 } from 'net';
import { promisify } from 'util';
import { WebhookConfig } from '../types/index.js';
import { Logger } from '../utils/logger.js';

const dnsLookup = promisify(lookup);

export interface WebhookNotification {
  message: string;
  name?: string;
  wakeMode?: 'now' | 'next-heartbeat';
  deliver?: boolean;
}

/**
 * P2-2 修复：判断字符串是否为 IPv6 地址格式
 * 使用 Node.js 标准库进行验证，避免正则匹配无效字符串
 * P2-3 修复：处理特殊 IPv6 地址如 ::（未指定地址）
 */
function isIPv6Format(hostname: string): boolean {
  // 去除方括号后检查
  const cleanHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  
  // P2-3 修复：特殊处理 :: (未指定地址)
  if (cleanHostname === '::') {
    return true;
  }
  
  return isIPv6(cleanHostname);
}

/**
 * P2-2 修复：检查 IPv4 地址是否为私有地址
 * 拆分为独立函数以提高可读性
 */
function isPrivateIPv4(octets: number[]): boolean {
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
  
  return false;
}

/**
 * P2-2 修复：检查 IPv6 地址是否为私有地址
 * 拆分为独立函数以提高可读性
 */
function isPrivateIPv6(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();
  
  // :: (未指定地址) - P2-3 修复
  if (lowerHostname === '::' || lowerHostname === '0:0:0:0:0:0:0:0') return true;
  
  // ::1 (loopback)
  if (lowerHostname === '::1' || lowerHostname === '0:0:0:0:0:0:0:1') return true;
  
  // P2-2 修复：只对纯 IPv6 格式的地址检查 fc/fd 前缀
  // 避免误拦截 fc2.com 等合法域名
  if (isIPv6Format(lowerHostname)) {
    // fc00::/7 (ULA - Unique Local Address)
    if (lowerHostname.startsWith('fc') || lowerHostname.startsWith('fd')) return true;
    
    // fe80::/10 (link-local)
    if (lowerHostname.startsWith('fe8') || lowerHostname.startsWith('fe9') || 
        lowerHostname.startsWith('fea') || lowerHostname.startsWith('feb')) return true;
  }
  
  return false;
}

/**
 * P2-2 修复：验证 IP 是否为内网地址，防止 SSRF 攻击
 * 重构为调用 isPrivateIPv4() 和 isPrivateIPv6() 辅助函数
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
  // P1-1 修复：去除 IPv6 地址的方括号
  // URL.hostname 对 IPv6 地址返回带方括号的格式，如 [::1]
  let cleanHostname = hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    cleanHostname = hostname.slice(1, -1);
  }
  
  // IPv4 地址检查
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = cleanHostname.match(ipv4Regex);
  
  if (match) {
    const octets = [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), parseInt(match[4], 10)];
    return isPrivateIPv4(octets);
  }
  
  // IPv6 地址检查
  return isPrivateIPv6(cleanHostname);
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
   * P2-1 修复：在请求前验证 DNS 解析后的 IP 地址，防止 DNS 重绑定攻击
   * P2-1 修复：使用解析后的 IP 地址发送请求，避免 TOCTOU 漏洞
   */
  private async sendRequest(payload: string): Promise<void> {
    const url = new URL(this.config.url);
    
    // P2-1 修复：DNS 重绑定防护 - 解析并验证 IP 地址
    let resolvedAddress: string;
    try {
      const { address } = await dnsLookup(url.hostname);
      
      if (isPrivateIP(address)) {
        throw new Error(`DNS resolved to private IP address ${address}, possible DNS rebinding attack`);
      }
      
      resolvedAddress = address;
      
      this.logger.debug('DNS resolution validated', { 
        hostname: url.hostname, 
        resolvedIP: address 
      });
    } catch (error) {
      // P0-1 修复：DNS 解析失败应拒绝请求，而非回退到原始 hostname
      // 回退会导致 HTTP 客户端重新进行 DNS 解析，可被绕过
      if (error instanceof Error && error.message.includes('private IP')) {
        throw error; // 重新抛出私有 IP 错误
      }
      throw new Error(`DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return new Promise((resolve, reject) => {
      const isHttps = this.config.url.startsWith('https');
      const client = isHttps ? request : httpRequest;

      // P2-1 修复：使用解析后的 IP 地址构建请求 URL
      // 保留原始 hostname 作为 Host header（用于 SNI 和虚拟主机）
      let requestUrl: string;
      // P2-2 修复：Host header 应包含端口（非标准端口时虚拟主机路由需要）
      const hostHeader = url.port 
        ? `${url.hostname}:${url.port}` 
        : url.hostname;
      const options: RequestOptions = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': hostHeader  // 设置原始 hostname（含端口）作为 Host header
        },
        timeout: this.config.timeout
      };

      if (resolvedAddress !== url.hostname) {
        // P2-1 修复：使用解析后的 IP 地址构建 URL，保留端口号
        // IPv6 地址需要用方括号包裹
        let hostForUrl: string;
        if (url.port) {
          // 有显式端口时，使用 IP:端口
          hostForUrl = isIPv6(resolvedAddress) 
            ? `[${resolvedAddress}]:${url.port}` 
            : `${resolvedAddress}:${url.port}`;
        } else {
          // 无显式端口时，仅使用 IP（浏览器/Node 会使用默认端口）
          hostForUrl = isIPv6(resolvedAddress) 
            ? `[${resolvedAddress}]` 
            : resolvedAddress;
        }
        requestUrl = `${url.protocol}//${hostForUrl}${url.pathname}${url.search}`;
      } else {
        requestUrl = this.config.url;
      }

      const req = client(requestUrl, options, (res) => {
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