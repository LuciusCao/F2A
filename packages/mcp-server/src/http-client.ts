/**
 * F2A MCP Server - HTTP 客户端
 * 封装与 F2A Daemon 的 HTTP 通信
 */

import { request, RequestOptions } from 'http';

/** 获取当前 Daemon 控制端口 */
export function getControlPort(): number {
  return parseInt(process.env.F2A_CONTROL_PORT || '9001');
}

/** HTTP 请求超时时间（毫秒） */
export function getRequestTimeout(): number {
  return parseInt(process.env.F2A_REQUEST_TIMEOUT || '10000');
}

/**
 * 发送 HTTP 请求到 F2A Daemon
 *
 * @param method HTTP 方法
 * @param path API 路径
 * @param body 请求体（可选）
 * @param customHeaders 自定义 headers（可选）
 * @param port 自定义端口（可选，默认从环境变量读取）
 * @returns 响应 JSON 对象
 */
export async function sendRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  customHeaders?: Record<string, string>,
  port?: number
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const controlPort = port ?? getControlPort();
    const requestTimeout = getRequestTimeout();

    const options: RequestOptions = {
      hostname: '127.0.0.1',
      port: controlPort,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...customHeaders,
      },
    };

    if (payload) {
      (options.headers as Record<string, string>)['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ success: false, error: 'Invalid response', raw: data });
        }
      });
    });

    req.setTimeout(requestTimeout, () => {
      req.destroy();
      resolve({
        success: false,
        error: `Request timeout after ${requestTimeout}ms. Daemon may not be responding.`,
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        error: `Connection failed: ${err.message}. Please ensure daemon is running.`,
      });
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
