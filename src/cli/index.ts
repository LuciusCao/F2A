#!/usr/bin/env node
/**
 * F2A CLI 入口
 */

import { listPending, confirm, reject } from './commands';

interface Args {
  command: string;
  idOrIndex?: string | number;
  reason?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return { command: 'help' };
  }

  const command = args[0];
  
  // 解析 ID 或序号
  let idOrIndex: string | number | undefined;
  if (args[1]) {
    idOrIndex = /^\d+$/.test(args[1]) ? parseInt(args[1]) : args[1];
  }

  // 解析原因
  let reason: string | undefined;
  const reasonIndex = args.indexOf('--reason');
  if (reasonIndex !== -1 && args[reasonIndex + 1]) {
    reason = args[reasonIndex + 1];
  }

  return { command, idOrIndex, reason };
}

function showHelp(): void {
  console.log(`
F2A CLI - Friend-to-Agent P2P Networking

Usage: f2a [command] [options]

Commands:
  pending              查看待确认连接
  confirm [id|index]   确认连接请求
  reject [id|index]    拒绝连接请求
  help                 显示帮助

Options:
  --reason [text]      拒绝原因

Examples:
  f2a pending                    # 列出待确认
  f2a confirm 1                  # 通过序号确认
  f2a confirm abc-123            # 通过 ID 确认
  f2a reject 2 --reason "unknown" # 拒绝并指定原因

Environment Variables:
  F2A_CONTROL_TOKEN    控制服务器认证 Token
  F2A_CONTROL_PORT     控制服务器端口 (默认: 9001)
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  switch (args.command) {
    case 'pending':
      await listPending();
      break;

    case 'confirm':
      if (args.idOrIndex === undefined) {
        console.error('[F2A] 错误: 需要指定 ID 或序号');
        console.error('用法: f2a confirm [id|index]');
        process.exit(1);
      }
      await confirm(args.idOrIndex);
      break;

    case 'reject':
      if (args.idOrIndex === undefined) {
        console.error('[F2A] 错误: 需要指定 ID 或序号');
        console.error('用法: f2a reject [id|index]');
        process.exit(1);
      }
      await reject(args.idOrIndex, args.reason);
      break;

    case 'help':
    default:
      showHelp();
      break;
  }
}

main().catch(err => {
  console.error('[F2A] 错误:', err);
  process.exit(1);
});