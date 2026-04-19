#!/usr/bin/env node
/**
 * F2A Daemon 入口
 */

import { F2ADaemon } from './index.js';

const daemon = new F2ADaemon({
  controlPort: parseInt(process.env.F2A_CONTROL_PORT || '9001'),
});

// 处理信号
process.on('SIGINT', async () => {
  console.log('[Daemon] Received SIGINT, shutting down...');
  await daemon.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Daemon] Received SIGTERM, shutting down...');
  await daemon.stop();
  process.exit(0);
});

// 启动
daemon.start().catch((error: unknown) => {
  console.error('[Daemon] Failed to start:', error);
  process.exit(1);
});