/**
 * F2A CLI
 * 命令行工具
 */

import { request, RequestOptions } from 'http';

const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');

// 生产环境强制要求设置 F2A_CONTROL_TOKEN
const CONTROL_TOKEN = process.env.F2A_CONTROL_TOKEN;
if (!CONTROL_TOKEN) {
  console.error('[F2A] 错误：必须设置 F2A_CONTROL_TOKEN 环境变量');
  console.error('[F2A] 请运行：export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)');
  console.error('[F2A] 或者在 daemon 启动时设置：F2A_CONTROL_TOKEN=your-secure-token f2a start');
  process.exit(1);
}

// 安全检查：禁止使用不安全的默认值
if (CONTROL_TOKEN === 'f2a-default-token') {
  console.error('[F2A] 错误：F2A_CONTROL_TOKEN 不能使用默认值 "f2a-default-token"');
  console.error('[F2A] 请设置一个安全的 token：export F2A_CONTROL_TOKEN=$(openssl rand -hex 32)');
  process.exit(1);
}

interface ControlResponse {
  success: boolean;
  message?: string;
  pending?: Array<{
    index: number;
    agentIdShort: string;
    address: string;
    port: number;
    remainingMinutes: number;
  }>;
  error?: string;
}

/**
 * 发送控制命令
 */
async function sendControlCommand(
  action: string,
  idOrIndex?: string | number,
  reason?: string
): Promise<ControlResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ action, idOrIndex, reason });

    const options: RequestOptions = {
      hostname: '127.0.0.1',
      port: CONTROL_PORT,
      path: '/control',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-F2A-Token': CONTROL_TOKEN,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ success: false, error: 'Invalid response' });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * 列出待确认连接
 */
export async function listPending(): Promise<void> {
  try {
    const result = await sendControlCommand('list-pending');
    
    if (result.success && result.pending && result.pending.length > 0) {
      console.log(`待确认连接 (${result.pending.length}个):`);
      result.pending.forEach(p => {
        console.log(`${p.index}. ${p.agentIdShort} 来自 ${p.address}:${p.port} [剩余${p.remainingMinutes}分钟]`);
      });
    } else {
      console.log('没有待确认的连接请求');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[F2A] 无法连接到 Daemon: ${message}`);
    console.error('[F2A] 请确保 Daemon 正在运行');
    process.exit(1);
  }
}

/**
 * 确认连接
 */
export async function confirm(idOrIndex: string | number): Promise<void> {
  try {
    const result = await sendControlCommand('confirm', idOrIndex);
    
    if (result.success) {
      console.log(`[F2A] ${result.message}`);
    } else {
      console.error(`[F2A] 错误: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[F2A] 无法连接到 Daemon: ${message}`);
    process.exit(1);
  }
}

/**
 * 拒绝连接
 */
export async function reject(idOrIndex: string | number, reason?: string): Promise<void> {
  try {
    const result = await sendControlCommand('reject', idOrIndex, reason);
    
    if (result.success) {
      console.log(`[F2A] ${result.message}`);
    } else {
      console.error(`[F2A] 错误: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[F2A] 无法连接到 Daemon: ${message}`);
    process.exit(1);
  }
}