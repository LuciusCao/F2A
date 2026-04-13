/**
 * F2A CLI - 消息命令
 * f2a send / f2a messages
 */

import { request, RequestOptions } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getControlTokenLazy } from './control-token.js';

const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 发送 HTTP 请求到 ControlServer
 */
async function sendRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
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
        'X-F2A-Token': getControlTokenLazy()
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

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * 发送消息到指定 Peer
 * f2a send --to <peer_id> [--topic <topic>] <message>
 */
export async function sendMessage(peerId: string, content: string, topic?: string): Promise<void> {
  if (!peerId) {
    console.error('❌ 错误: 缺少 --to 参数');
    console.error('用法: f2a send --to <peer_id> "消息内容"');
    process.exit(1);
  }

  if (!content) {
    console.error('❌ 错误: 缺少消息内容');
    console.error('用法: f2a send --to <peer_id> "消息内容"');
    process.exit(1);
  }

  try {
    const result = await sendRequest('POST', '/api/messages', {
      peerId,
      content,
      topic: topic || 'chat'
    });

    if (result.success) {
      console.log(`✅ 消息已发送`);
      console.log(`   Peer: ${peerId.slice(0, 16)}...`);
      console.log(`   Topic: ${topic || 'chat'}`);
      if (result.messageId) {
        console.log(`   Message ID: ${result.messageId}`);
      }
    } else {
      console.error(`❌ 发送失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}

/**
 * 查看消息
 * f2a messages [--unread] [--from <peer_id>] [--limit <n>]
 */
export async function getMessages(options: {
  unread?: boolean;
  from?: string;
  limit?: number;
  agentId?: string;
}): Promise<void> {
  const agentId = options.agentId || 'default';
  const limit = options.limit || 50;

  try {
    const result = await sendRequest('GET', `/api/messages/${agentId}?limit=${limit}`);

    if (result.success && result.messages) {
      const messages = (result.messages as any[]);
      const filtered = options.unread
        ? messages.filter((m: any) => !m.read)
        : options.from
          ? messages.filter((m: any) => m.from?.includes(options.from!))
          : messages;

      if (filtered.length === 0) {
        console.log('📭 没有消息');
        return;
      }

      console.log(`📨 消息 (${filtered.length} 条):`);
      console.log('');

      for (const msg of filtered.slice(0, limit)) {
        const from = msg.from ? `${msg.from.slice(0, 16)}...` : 'unknown';
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN') : '';
        const topic = msg.topic || 'chat';
        const readStatus = msg.read ? '✓' : '○';

        console.log(`${readStatus} [${topic}] ${from} (${time})`);
        console.log(`   ${msg.content}`);
        console.log('');
      }
    } else {
      console.log('📭 没有消息');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon: ${message}`);
    console.error('请确保 Daemon 正在运行: f2a daemon start');
    process.exit(1);
  }
}
