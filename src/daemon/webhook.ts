/**
 * Webhook 通知服务
 */

import { request, RequestOptions } from 'https';
import { request as httpRequest } from 'http';
import { WebhookConfig } from '../types';

export interface WebhookNotification {
  message: string;
  name?: string;
  wakeMode?: 'now' | 'next-heartbeat';
  deliver?: boolean;
}

export class WebhookService {
  private config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = {
      timeout: 5000,
      retries: 3,
      retryDelay: 1000,
      ...config
    };
  }

  /**
   * 发送通知
   */
  async send(notification: WebhookNotification): Promise<{ success: boolean; error?: string }> {
    if (!this.config.token) {
      console.log('[Webhook] Token not set, skipping notification');
      return { success: false, error: 'Token not set' };
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
        console.log(`[Webhook] Notification sent (attempt ${attempt})`);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[Webhook] Attempt ${attempt} failed: ${message}`);

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