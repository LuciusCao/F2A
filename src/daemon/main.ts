#!/usr/bin/env node
/**
 * F2A Daemon 入口
 */

import { F2ADaemon } from './index.js';
import { multiaddr } from '@multiformats/multiaddr';

// 解析引导节点地址
const bootstrapPeers = process.env.BOOTSTRAP_PEERS 
  ? process.env.BOOTSTRAP_PEERS.split(',').map(addr => multiaddr(addr))
  : undefined;

const daemon = new F2ADaemon({
  controlPort: parseInt(process.env.F2A_CONTROL_PORT || '9001'),
  bootstrapPeers,
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
daemon.start().catch((error) => {
  console.error('[Daemon] Failed to start:', error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error('[Daemon] Stack trace:', error.stack);
  }
  process.exit(1);
});