#!/usr/bin/env node
/**
 * F2A CLI 入口
 * 
 * 提供命令行接口与 F2A Daemon 交互
 */

import { request, RequestOptions } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const CONTROL_PORT = parseInt(process.env.F2A_CONTROL_PORT || '9001');

// ESM 环境下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 获取版本号
 */
function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.5.0';
  } catch {
    return '0.5.0';
  }
}

/**
 * 获取 ControlToken（简化版）
 */
function getControlToken(): string {
  try {
    const dataDir = process.env.F2A_DATA_DIR || join(process.env.HOME || '', '.f2a');
    const tokenPath = join(dataDir, 'control-token');
    return readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return '';
  }
}

interface ControlResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * 发送控制命令
 */
async function sendControlCommand(action: string): Promise<ControlResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ action });
    
    const options: RequestOptions = {
      hostname: '127.0.0.1',
      port: CONTROL_PORT,
      path: '/control',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-F2A-Token': getControlToken(),
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

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
F2A CLI v${getVersion()} - Friend-to-Agent P2P Network

Usage: f2a <command> [options]

Commands:
  init       初始化 F2A 身份
  status     查看状态
  peers      查看连接的 peers
  send       发送消息
  messages   查看消息列表
  agent      管理 Agent 注册
  start      启动 Daemon
  stop       停止 Daemon
  --help     显示帮助
  --version  显示版本
`);
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 无参数或 --help 显示帮助
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  // --version 显示版本
  if (args[0] === '--version' || args[0] === '-v') {
    console.log(getVersion());
    return;
  }

  const command = args[0];

  try {
    const result = await sendControlCommand(command);
    
    if (result.success) {
      console.log(result.message || 'OK');
    } else {
      console.error('Error:', result.error || 'Unknown error');
    }
  } catch (err) {
    console.error('Failed to connect to daemon. Is it running?');
    console.error('Start with: f2ad');
  }
}

main();