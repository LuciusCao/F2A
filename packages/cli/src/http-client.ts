/**
 * F2A CLI - HTTP 客户端
 * 共享的 HTTP 请求函数，避免代码重复
 */

import { request, RequestOptions } from 'http';
import { getControlTokenLazy } from './control-token.js';

/** ControlServer 默认端口 */
export const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');

/** HTTP 请求超时时间（毫秒） */
const REQUEST_TIMEOUT_MS = parseInt(process.env.F2A_REQUEST_TIMEOUT || '10000');

/**
 * 发送 HTTP 请求到 ControlServer
 * 
 * @param method HTTP 方法 (GET, POST, DELETE, PATCH)
 * @param path API 路径 (如 /api/v1/agents, /control)
 * @param body 请求体（可选）
 * @param customHeaders 自定义 headers（可选，如 Authorization）
 * @returns 响应 JSON 对象
 */
export async function sendRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  customHeaders?: Record<string, string>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';

    const options: RequestOptions = {
      hostname: '127.0.0.1',
      port: CONTROL_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-F2A-Token': getControlTokenLazy(),
        ...customHeaders
      }
    };

    if (payload) {
      (options.headers as Record<string, string>)['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ success: false, error: 'Invalid response', raw: data });
        }
      });
    });

    // 设置请求超时
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      resolve({ success: false, error: `Request timeout after ${REQUEST_TIMEOUT_MS}ms. Daemon may not be responding.` });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: `Connection failed: ${err.message}. Please ensure daemon is running.` });
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}