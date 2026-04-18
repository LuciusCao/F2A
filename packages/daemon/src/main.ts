#!/usr/bin/env node
/**
 * F2A Daemon 入口
 */

import { createRequire } from 'module';
import { F2ADaemon } from './index.js';
import { Logger } from '@f2a/network';

const logger = new Logger({ component: 'daemon' });

// RFC 008: 在开发模式下允许私有 IP 地址的 webhook（禁用 undici SSRF 保护）
// 生产环境应保持 SSRF 保护启用
// 注意：必须在同步代码中设置，因为 setGlobalDispatcher 需要在任何 fetch 调用之前生效
// 在 ESM 中使用 createRequire 来同步导入 undici
const require = createRequire(import.meta.url);

const allowLocal = process.env.F2A_ALLOW_LOCAL_WEBHOOK === 'true' || 
                   process.env.NODE_ENV === 'development' ||
                   process.env.NODE_ENV === 'test';

if (allowLocal) {
  // 使用 createRequire 创建的 require 同步导入 undici
  const undici = require('undici');
  if (undici.setGlobalDispatcher && undici.Agent) {
    undici.setGlobalDispatcher(new undici.Agent({
      allowPrivateIPAddresses: true,
    }));
    logger.info('Webhook SSRF protection disabled for development mode');
  }
}

// 解析引导节点地址
const bootstrapPeers = process.env.BOOTSTRAP_PEERS 
  ? process.env.BOOTSTRAP_PEERS.split(',')
  : undefined;

// P2P 端口（默认 0 = 随机分配）
const p2pPort = parseInt(process.env.F2A_P2P_PORT || '0');

const daemon = new F2ADaemon({
  controlPort: parseInt(process.env.F2A_CONTROL_PORT || '9001'),
  displayName: process.env.F2A_AGENT_NAME,
  network: {
    listenPort: p2pPort,
    bootstrapPeers,
  },
});

// 处理信号
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down');
  await daemon.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down');
  await daemon.stop();
  process.exit(0);
});

// 捕获未处理的 Promise rejection
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled Promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: String(promise)
  });
  // 不立即退出，记录日志后继续运行（可根据需要调整策略）
});

// 捕获未处理的异常
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });
  // 对于未捕获异常，安全退出
  daemon.stop().then(() => process.exit(1)).catch(() => process.exit(1));
});

// 启动
daemon.start().catch((error: unknown) => {
  logger.error('Failed to start daemon', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});