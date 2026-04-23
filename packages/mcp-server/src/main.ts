/**
 * F2A MCP Server 入口
 *
 * 提供 stdio 传输的 Model Context Protocol 服务器，
 * 让 MCP 客户端（如 kimi-code-cli）能够操作 F2A 网络。
 */

import { fileURLToPath } from 'url';
import { F2AMcpServer } from './server.js';

// ESM 环境下获取当前文件路径
const __filename = fileURLToPath(import.meta.url);

async function main(): Promise<void> {
  // 读取环境变量
  const controlPort = parseInt(process.env.F2A_CONTROL_PORT || '9001');
  const defaultAgentId = process.env.F2A_AGENT_ID || undefined;

  const server = new F2AMcpServer({
    controlPort,
    defaultAgentId,
  });

  // 优雅关闭处理
  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[F2A MCP] Received ${signal}, shutting down...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await server.start();
}

main().catch((err) => {
  console.error('[F2A MCP] Fatal error:', err);
  process.exit(1);
});
